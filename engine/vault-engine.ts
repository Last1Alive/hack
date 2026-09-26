import * as path from 'path';
import {
  Node, ObjectMetadata, Replica, Operation, OperationType,
  computeChecksum, formatBytes, generateObjectId, generateOperationId,
  DEFAULT_REPLICATION_FACTOR, DEFAULT_WRITE_POLICY, DEFAULT_READ_POLICY,
  DEFAULT_CAPACITY_BYTES,
} from './types';
import {
  ensureStorageRoot, ensureNodeDirs, getNodeInfo, getNodeUsedBytes,
  getNodeObjectCount, getNodeReplicaCount, getNodeDir,
  writeObject, readObject, deleteObject as deleteNodeObject,
  corruptObject as corruptNodeObject,
  simulateOffline, simulateOnline, isNodeOffline,
} from './node-storage';
import {
  loadMetadata, saveMetadata, getConfig, getObjects, getObject,
  addObject, updateObject, deleteObject, addOperation, getOperations,
} from './metadata-store';

export interface VaultOptions {
  nodeCount?: number;
  capacityPerNodeBytes?: number;
  defaultReplicationFactor?: number;
  initialCapacityPerNodeBytes?: number;
}

/** One replica = one complete copy of the object on one node. */
export class VaultEngine {
  private nodes: Map<string, Node> = new Map();
  private options: Required<VaultOptions>;
  private rebalanceTimer: ReturnType<typeof setInterval> | null = null;
  private repairTimer: ReturnType<typeof setInterval> | null = null;
  /** Track in-flight operations to prevent races. */
  private busyObjects: Set<string> = new Set();

  constructor(opts: VaultOptions = {}) {
    this.options = {
      nodeCount: opts.nodeCount ?? 4,
      /** 2 GB per node — realistic for a demo cluster. */
      capacityPerNodeBytes: opts.initialCapacityPerNodeBytes ?? opts.capacityPerNodeBytes ?? DEFAULT_CAPACITY_BYTES,
      defaultReplicationFactor: opts.defaultReplicationFactor ?? DEFAULT_REPLICATION_FACTOR,
      initialCapacityPerNodeBytes: opts.initialCapacityPerNodeBytes,
    };
  }

  initialize(): void {
    ensureStorageRoot();
    loadMetadata();

    for (let i = 0; i < this.options.nodeCount; i++) {
      const nodeId = `node-${String(i + 1).padStart(2, '0')}`;
      ensureNodeDirs(nodeId);
      const node = getNodeInfo(nodeId, this.options.capacityPerNodeBytes);
      this.nodes.set(nodeId, node);
    }

    // Re-index all existing objects: verify each replica against disk
    for (const obj of getObjects()) {
      this.reIndexReplicas(obj);
    }

    this.startBackgroundMaintenance();
  }

  private startBackgroundMaintenance(): void {
    this.repairTimer = setInterval(() => this.runRepairCycle(), 5000);
    this.rebalanceTimer = setInterval(() => this.runRebalanceCheck(), 30000);
  }

  // ─── Replication helpers ─────────────────────────────────────────────────

  /**
   * Given a list of available healthy node IDs and a desired count,
   * return exactly `count` distinct node IDs spread across the cluster.
   * Respects network partitions: avoids pairing already-partitioned nodes.
   */
  private selectTargets(availableNodes: string[], count: number): string[] {
    const targets: string[] = [];
    const used = new Set<string>();

    for (let i = 0; i < count && i < availableNodes.length; i++) {
      let best = availableNodes[i];
      let bestScore = -Infinity;
      for (const nid of availableNodes) {
        if (used.has(nid)) continue;
        const nInfo = this.nodes.get(nid);
        if (!nInfo) continue;
        // Prefer nodes that are NOT partitioned from any already-selected target
        let score = 0;
        for (const t of targets) {
          const tInfo = this.nodes.get(t);
          if (tInfo && !tInfo.partitions.includes(nid)) score += 10;
        }
        // Slight randomization to spread evenly
        score += Math.random() * 2;
        if (score > bestScore) { bestScore = score; best = nid; }
      }
      targets.push(best);
      used.add(best);
    }
    return targets;
  }

  /** Verify each replica record against actual disk content and update status. */
  private reIndexReplicas(obj: ObjectMetadata): void {
    for (const replica of obj.replicas) {
      // Offline nodes: treat replica as missing even if file exists on disk
      if (isNodeOffline(replica.nodeId)) {
        replica.status = 'missing';
        continue;
      }
      const data = readObject(replica.nodeId, obj.id);
      if (data === null) {
        replica.status = 'missing';
      } else {
        const actualChecksum = computeChecksum(data);
        // Compare BEFORE overwriting -- stored checksum is ground truth
        const storedChecksum = replica.checksum;
        replica.status = actualChecksum === storedChecksum ? 'valid' : 'corrupted';
        replica.size = data.length;
        replica.updatedAt = new Date().toISOString();
        // Only update checksum if stored one was stale/empty
        if (!storedChecksum || storedChecksum.length !== 64) {
          replica.checksum = actualChecksum;
        }
      }
    }
    this.updateIntegrityStatus(obj);
    updateObject(obj.id, obj);
  }

  /** Compute integrity status based on valid replica count vs replication factor. */
  private updateIntegrityStatus(obj: ObjectMetadata): void {
    const valid = obj.replicas.filter(r => r.status === 'valid').length;
    const corrupted = obj.replicas.filter(r => r.status === 'corrupted').length;
    const missing = obj.replicas.filter(r => r.status === 'missing').length;

    if (valid >= obj.replicationFactor) {
      obj.integrityStatus = 'valid';
    } else if (corrupted > 0 && valid + corrupted < obj.replicationFactor) {
      // Not enough good replicas to satisfy RF
      obj.integrityStatus = 'corrupted';
    } else if (missing > 0 || corrupted > 0) {
      obj.integrityStatus = 'degraded';
    } else {
      obj.integrityStatus = 'valid';
    }
  }

  // ─── Cluster info ────────────────────────────────────────────────────────

  getNodes(): Node[] {
    const result: Node[] = [];
    const cfg = getConfig();
    const capacityBytes = cfg.capacityPerNodeBytes ?? this.options.capacityPerNodeBytes;
    for (let i = 0; i < this.options.nodeCount; i++) {
      const nodeId = `node-${String(i + 1).padStart(2, '0')}`;
      const existing = this.nodes.get(nodeId);
      if (existing) {
        result.push({
          ...existing,
          capacityBytes,
          usedBytes: getNodeUsedBytes(nodeId),
          objectCount: getNodeObjectCount(nodeId),
          replicaCount: getNodeReplicaCount(nodeId),
          lastHeartbeat: new Date().toISOString(),
        });
      }
    }
    return result;
  }

  getNode(nodeId: string): Node | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Return all objects with their replica statuses refreshed from disk.
   * Offline replicas are marked 'missing' regardless of disk state.
   */
  getObjects(): ObjectMetadata[] {
    const result: ObjectMetadata[] = [];
    const offlineNodes = new Set(
      this.getNodes().filter(n => n.status === 'offline').map(n => n.id)
    );

    for (const obj of getObjects()) {
      for (const replica of obj.replicas) {
        // If the node is offline, the replica is unavailable
        if (offlineNodes.has(replica.nodeId)) {
          replica.status = 'missing';
          replica.updatedAt = new Date().toISOString();
          continue;
        }
        // Otherwise check actual disk
        const data = readObject(replica.nodeId, obj.id);
        if (data === null) {
          replica.status = 'missing';
        } else {
          const actual = computeChecksum(data);
          const expected = replica.checksum; // preserve for comparison
          replica.checksum = actual; // sync to disk reality
          replica.size = data.length;
          replica.status = actual === expected ? 'valid' : 'corrupted';
        }
        replica.updatedAt = new Date().toISOString();
      }
      this.updateIntegrityStatus(obj);
      updateObject(obj.id, obj);
      result.push(obj);
    }
    return result;
  }

  getObject(id: string): ObjectMetadata | undefined {
    return getObject(id);
  }

  getOperations(limit: number = 50): Operation[] {
    return getOperations(limit);
  }

  getConfig() { return getConfig(); }

  // ─── Health & metrics ────────────────────────────────────────────────────

  getClusterHealth() {
    const nodes = this.getNodes();
    const objects = this.getObjects();

    const healthyNodes = nodes.filter(n => n.status === 'healthy').length;
    const totalNodes = nodes.length;
    const totalObjects = objects.length;

    let logicalSize = 0;
    let physicalSize = 0;
    let underReplicated = 0;
    let corrupted = 0;

    for (const obj of objects) {
      logicalSize += obj.logicalSize;
      // Physical size = sum of ALL valid replica file sizes on disk
      for (const replica of obj.replicas) {
        if (replica.status === 'valid') {
          physicalSize += replica.size;
        }
      }
      const validCount = obj.replicas.filter(r => r.status === 'valid').length;
      if (validCount < obj.replicationFactor) underReplicated++;
      if (obj.integrityStatus === 'corrupted') corrupted++;
    }

    const availableNodes = nodes.filter(n => n.status !== 'offline').length;
    const availability = totalNodes > 0 ? (availableNodes / totalNodes) * 100 : 0;
    const storageOverhead = logicalSize > 0 ? physicalSize / logicalSize : 1;

    return {
      healthyNodes,
      totalNodes,
      totalObjects,
      logicalSize,
      physicalSize,
      replicationFactor: this.options.defaultReplicationFactor,
      underReplicated,
      corrupted,
      availability,
      storageOverhead,
    };
  }

  // ─── Object operations ───────────────────────────────────────────────────

  /**
   * Upload an object: write the FULL buffer to exactly `rf` distinct healthy nodes.
   * Returns error if not enough healthy nodes exist for the requested RF.
   */
  async uploadObject(
    name: string,
    mimeType: string,
    data: Buffer,
    replicationFactor?: number,
  ): Promise<{ id: string; checksum: string; replicaCount: number }> {
    const id = generateObjectId();
    const rf = Math.min(
      Math.max(1, replicationFactor ?? this.options.defaultReplicationFactor),
      this.options.nodeCount,
    );
    const checksum = computeChecksum(data);
    const now = new Date().toISOString();

    // Select exactly `rf` distinct healthy nodes
    const allNodes = this.getNodes();
    const availableNodes = allNodes
      .filter(n => n.status === 'healthy')
      .map(n => n.id);

    if (availableNodes.length < rf) {
      throw new Error(
        `Replication factor ${rf} requires ${rf} healthy nodes, but only ${availableNodes.length} are currently available.`
      );
    }

    const targets = this.selectTargets(availableNodes, rf);

    // Validate capacity on each target node
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));
    for (const nodeId of targets) {
      const node = nodeMap.get(nodeId);
      if (!node) continue;
      const freeBytes = node.capacityBytes - node.usedBytes;
      if (freeBytes < data.length) {
        throw new Error(
          `Insufficient storage on ${nodeId}: need ${formatBytes(data.length)}, free ${formatBytes(freeBytes)}`
        );
      }
    }

    // Write the complete object to each target node
    const replicas: Replica[] = [];
    for (const nodeId of targets) {
      const filePath = writeObject(nodeId, id, data);
      replicas.push({
        nodeId,
        path: filePath,
        checksum,
        size: data.length,
        status: 'valid',
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    }

    const obj: ObjectMetadata = {
      id,
      name,
      mimeType,
      logicalSize: data.length,
      checksum,
      version: 1,
      replicationFactor: rf,
      replicas,
      integrityStatus: 'valid',
      createdAt: now,
      updatedAt: now,
    };

    addObject(obj);

    addOperation({
      type: 'upload',
      description: `Uploaded "${name}" (${formatBytes(data.length)}) → ${targets.join(', ')}`,
      objectId: id,
      status: 'completed',
      details: { name, size: data.length, replicaCount: targets.length, targets, replicationFactor: rf },
    });

    return { id, checksum, replicaCount: targets.length };
  }

  /** Delete an object: remove metadata AND all physical replica files. */
  async deleteObject(objectId: string): Promise<boolean> {
    const obj = getObject(objectId);
    if (!obj) return false;

    // Physically remove all replicas from all nodes
    for (const replica of obj.replicas) {
      deleteNodeObject(replica.nodeId, objectId);
    }

    deleteObject(objectId);

    addOperation({
      type: 'delete',
      description: `Deleted "${obj.name}" (${obj.replicas.length} replica(s) removed)`,
      objectId,
      status: 'completed',
    });

    return true;
  }

  // ─── Integrity verification ──────────────────────────────────────────────

  /**
   * Verify a single object by reading each replica from disk and comparing checksums.
   * Marks replicas as 'corrupted' or 'valid' based on actual SHA-256 comparison.
   */
  async verifyObject(objectId: string): Promise<{ status: string; issues: string[] }> {
    const obj = getObject(objectId);
    if (!obj) throw new Error('Object not found');

    const issues: string[] = [];

    for (const replica of obj.replicas) {
      // Offline nodes have their replicas treated as unavailable
      if (isNodeOffline(replica.nodeId)) {
        replica.status = 'missing';
        issues.push(`Missing replica on ${replica.nodeId} (node offline)`);
        continue;
      }
      const actualData = readObject(replica.nodeId, objectId);
      if (actualData === null) {
        replica.status = 'missing';
        issues.push(`Missing replica on ${replica.nodeId}`);
      } else {
        const actualChecksum = computeChecksum(actualData);
        if (actualChecksum !== replica.checksum) {
          replica.status = 'corrupted';
          issues.push(
            `Corrupted replica on ${replica.nodeId} (expected ${replica.checksum.slice(0, 16)}…, got ${actualChecksum.slice(0, 16)}…)`
          );
        } else {
          replica.status = 'valid';
        }
        // Only update metadata for valid replicas
        if (replica.status === 'valid') {
          replica.checksum = actualChecksum;
          replica.size = actualData.length;
          replica.updatedAt = new Date().toISOString();
        }
      }
    }

    this.updateIntegrityStatus(obj);
    updateObject(objectId, obj);

    addOperation({
      type: 'verify',
      description: `Verified "${obj.name}": ${issues.length === 0 ? 'all valid' : `${issues.length} issue(s) found`}`,
      objectId,
      status: issues.length === 0 ? 'completed' : 'failed',
      details: { issues, status: obj.integrityStatus, total: obj.replicas.length },
    });

    return { status: obj.integrityStatus, issues };
  }

  // ─── Failure simulation ──────────────────────────────────────────────────

  failNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    simulateOffline(nodeId);
    this.nodes.set(nodeId, {
      ...node,
      status: 'offline' as const,
      lastHeartbeat: new Date().toISOString(),
    });

    // Mark replicas on this node as missing in metadata
    for (const obj of getObjects()) {
      for (const replica of obj.replicas) {
        if (replica.nodeId === nodeId) {
          replica.status = 'missing';
          replica.updatedAt = new Date().toISOString();
        }
      }
      this.updateIntegrityStatus(obj);
      updateObject(obj.id, obj);
    }

    addOperation({
      type: 'fail',
      description: `Node ${nodeId} taken offline`,
      nodeId,
      status: 'completed',
    });
  }

  recoverNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    simulateOnline(nodeId);
    this.nodes.set(nodeId, {
      ...node,
      status: 'recovering' as const,
      lastHeartbeat: new Date().toISOString(),
    });

    addOperation({
      type: 'recover',
      description: `Node ${nodeId} recovering…`,
      nodeId,
      status: 'completed',
    });

    // Kick off repair for this node after a short delay
    setTimeout(() => this.performRepairForNode(nodeId), 800);
  }

  /**
   * Corrupt the actual stored file on a node for a given object.
   * The metadata is NOT updated here — verification will detect the mismatch.
   */
  corruptReplica(nodeId: string, objectId: string): boolean {
    const obj = getObject(objectId);
    if (!obj) throw new Error('Object not found');

    // Check that this node actually holds a replica
    const replica = obj.replicas.find(r => r.nodeId === nodeId);
    if (!replica) throw new Error(`No replica of "${obj.name}" on ${nodeId}`);

    const success = corruptNodeObject(nodeId, objectId);
    if (success) {
      replica.status = 'corrupted';
      replica.updatedAt = new Date().toISOString();
      this.updateIntegrityStatus(obj);
      updateObject(objectId, obj);

      addOperation({
        type: 'corrupt',
        description: `Corrupted replica of "${obj.name}" on ${nodeId}`,
        nodeId,
        objectId,
        status: 'completed',
      });
    }
    return success;
  }

  /**
   * Simulate a network partition between two nodes.
   * Both nodes record the other as unreachable.
   */
  partitionNodes(fromNodeId: string, toNodeId: string): void {
    const fromNode = this.nodes.get(fromNodeId);
    const toNode = this.nodes.get(toNodeId);
    if (!fromNode || !toNode) throw new Error('Invalid node IDs');

    // Add bidirectional partition
    if (!fromNode.partitions.includes(toNodeId)) {
      this.nodes.set(fromNodeId, {
        ...fromNode,
        partitions: [...fromNode.partitions, toNodeId],
      });
    }
    if (!toNode.partitions.includes(fromNodeId)) {
      this.nodes.set(toNode.id, {
        ...toNode,
        partitions: [...toNode.partitions, fromNodeId],
      });
    }

    addOperation({
      type: 'partition',
      description: `Network partition: ${fromNodeId} ↔ ${toNodeId}`,
      status: 'completed',
      details: { from: fromNodeId, to: toNodeId },
    });
  }

  /** Heal a network partition between two nodes. */
  healPartition(nodeId: string, peerId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    this.nodes.set(nodeId, {
      ...node,
      partitions: node.partitions.filter(p => p !== peerId),
    });

    const peer = this.nodes.get(peerId);
    if (peer) {
      this.nodes.set(peerId, {
        ...peer,
        partitions: peer.partitions.filter(p => p !== nodeId),
      });
    }

    addOperation({
      type: 'partition',
      description: `Partition healed: ${nodeId} ↔ ${peerId}`,
      status: 'completed',
      details: { from: nodeId, to: peerId, action: 'healed' },
    });
  }

  // ─── Automatic repair ────────────────────────────────────────────────────

  /**
   * For each object that has missing or corrupted replicas on `targetNodeId`,
   * copy a valid replica from another healthy node onto `targetNodeId`.
   */
  private performRepairForNode(targetNodeId: string): void {
    const objects = getObjects();
    let repaired = 0;

    for (const obj of objects) {
      // Find replicas on target node that need fixing
      const badReplicas = obj.replicas.filter(
        r => r.nodeId === targetNodeId && r.status !== 'valid'
      );
      if (badReplicas.length === 0) continue;

      // Find a healthy source replica on a different node
      const source = obj.replicas.find(
        r => r.status === 'valid' && r.nodeId !== targetNodeId
      );
      if (!source) continue; // No valid source available

      const data = readObject(source.nodeId, obj.id);
      if (!data) continue;

      // Write fresh replica to target node
      writeObject(targetNodeId, obj.id, data);

      for (const bad of badReplicas) {
        bad.status = 'valid';
        bad.checksum = source.checksum;
        bad.size = data.length;
        bad.path = path.join(getNodeDir(targetNodeId), `${obj.id}.obj`);
        bad.updatedAt = new Date().toISOString();
        repaired++;
      }

      this.updateIntegrityStatus(obj);
      updateObject(obj.id, obj);
    }

    // Mark node healthy once repair finishes
    const node = this.nodes.get(targetNodeId);
    if (node && node.status === 'recovering') {
      this.nodes.set(targetNodeId, { ...node, status: 'healthy' });
    }

    if (repaired > 0) {
      addOperation({
        type: 'repair',
        description: `Repaired ${repaired} replica(s) on ${targetNodeId}`,
        nodeId: targetNodeId,
        status: 'completed',
        details: { repaired },
      });
    }
  }

  /**
   * Background repair cycle: detect objects with insufficient valid replicas
   * and attempt to restore them from healthy sources.
   */
  private runRepairCycle(): void {
    const objects = getObjects();

    for (const obj of objects) {
      // For each missing or corrupted replica, try to recreate from a valid source
      let needsRepair = false;
      for (const replica of obj.replicas) {
        if (replica.status === 'valid') continue;
        needsRepair = true;

        // Find a valid source on a DIFFERENT healthy node
        const source = obj.replicas.find(
          r => r.status === 'valid' && r.nodeId !== replica.nodeId
        );
        if (!source) continue; // No source available yet

        const data = readObject(source.nodeId, obj.id);
        if (!data) continue;

        // Write to the bad replica's node
        writeObject(replica.nodeId, obj.id, data);
        replica.status = 'valid';
        replica.checksum = source.checksum;
        replica.size = data.length;
        replica.updatedAt = new Date().toISOString();
      }

      this.updateIntegrityStatus(obj);
      updateObject(obj.id, obj);
    }

    // Auto-detect offline nodes that came back online
    for (const [nodeId, node] of this.nodes) {
      if (node.status === 'offline' && !isNodeOffline(nodeId)) {
        this.nodes.set(nodeId, { ...node, status: 'recovering' });
        this.performRepairForNode(nodeId);
      }
    }
  }

  // ─── Rebalancing ─────────────────────────────────────────────────────────

  private runRebalanceCheck(): void {
    const nodes = this.getNodes();
    const healthyNodes = nodes.filter(n => n.status === 'healthy');
    if (healthyNodes.length < 2) return;

    const usagePcts = healthyNodes.map(n => ({
      nodeId: n.id,
      usagePct: n.capacityBytes > 0 ? n.usedBytes / n.capacityBytes : 0,
    }));

    const maxUsage = Math.max(...usagePcts.map(u => u.usagePct));
    const minUsage = Math.min(...usagePcts.map(u => u.usagePct));
    if (maxUsage - minUsage < 0.05) return; // Already balanced

    const srcNode = usagePcts.find(u => u.usagePct === maxUsage);
    const dstNode = usagePcts.find(u => u.usagePct === minUsage);
    if (!srcNode || !dstNode) return;

    // Move one object's replica from overloaded to underloaded
    const objects = getObjects();
    for (const obj of objects) {
      const replicasOnSrc = obj.replicas.filter(r => r.nodeId === srcNode.nodeId && r.status === 'valid');
      if (replicasOnSrc.length === 0) continue;

      const dstInfo = this.nodes.get(dstNode.nodeId);
      if (!dstInfo) continue;
      if (dstInfo.capacityBytes > 0 ? dstInfo.usedBytes / dstInfo.capacityBytes > 0.9 : false) continue;

      const replica = replicasOnSrc[0];
      const data = readObject(srcNode.nodeId, obj.id);
      if (!data) continue;

      // Write to destination
      writeObject(dstNode.nodeId, obj.id, data);

      // Add new replica record
      const now = new Date().toISOString();
      obj.replicas.push({
        nodeId: dstNode.nodeId,
        path: path.join(getNodeDir(dstNode.nodeId), `${obj.id}.obj`),
        checksum: replica.checksum,
        size: data.length,
        status: 'valid',
        version: obj.version,
        createdAt: now,
        updatedAt: now,
      });

      // Remove from source
      obj.replicas = obj.replicas.filter(r => r.nodeId !== srcNode.nodeId);
      deleteNodeObject(srcNode.nodeId, obj.id);

      this.updateIntegrityStatus(obj);
      updateObject(obj.id, obj);

      addOperation({
        type: 'rebalance',
        description: `Rebalanced "${obj.name}": ${srcNode.nodeId} → ${dstNode.nodeId}`,
        status: 'completed',
        details: { from: srcNode.nodeId, to: dstNode.nodeId, objectId: obj.id },
      });
      break;
    }
  }

  /** Manually trigger rebalancing across the cluster. */
  async triggerRebalance(): Promise<{ moved: number; message: string }> {
    let moved = 0;
    const maxMoves = 20;

    for (let i = 0; i < maxMoves; i++) {
      const nodes = this.getNodes();
      const healthyNodes = nodes.filter(n => n.status === 'healthy');
      if (healthyNodes.length < 2) break;

      const usagePcts = healthyNodes.map(n => ({
        nodeId: n.id,
        usagePct: n.capacityBytes > 0 ? n.usedBytes / n.capacityBytes : 0,
      }));

      const maxUsage = Math.max(...usagePcts.map(u => u.usagePct));
      const minUsage = Math.min(...usagePcts.map(u => u.usagePct));
      if (maxUsage - minUsage < 0.02) break;

      const srcNode = usagePcts.find(u => u.usagePct === maxUsage);
      const dstNode = usagePcts.find(u => u.usagePct === minUsage);
      if (!srcNode || !dstNode) break;

      const objects = getObjects();
      let movedThisRound = false;

      for (const obj of objects) {
        const replicasOnSrc = obj.replicas.filter(r => r.nodeId === srcNode.nodeId && r.status === 'valid');
        if (replicasOnSrc.length === 0) continue;

        const dstInfo = this.nodes.get(dstNode.nodeId);
        if (!dstInfo) break;
        if (dstInfo.capacityBytes > 0 ? dstInfo.usedBytes / dstInfo.capacityBytes > 0.95 : false) break;

        const replica = replicasOnSrc[0];
        const data = readObject(srcNode.nodeId, obj.id);
        if (!data) continue;

        writeObject(dstNode.nodeId, obj.id, data);
        const now = new Date().toISOString();
        obj.replicas.push({
          nodeId: dstNode.nodeId,
          path: path.join(getNodeDir(dstNode.nodeId), `${obj.id}.obj`),
          checksum: replica.checksum,
          size: data.length,
          status: 'valid',
          version: obj.version,
          createdAt: now,
          updatedAt: now,
        });
        obj.replicas = obj.replicas.filter(r => r.nodeId !== srcNode.nodeId);
        deleteNodeObject(srcNode.nodeId, obj.id);
        this.updateIntegrityStatus(obj);
        updateObject(obj.id, obj);

        moved++;
        movedThisRound = true;
        break;
      }

      if (!movedThisRound) break;
    }

    addOperation({
      type: 'rebalance',
      description: `Manual rebalance completed: ${moved} replica(s) moved`,
      status: 'completed',
      details: { moved },
    });

    return { moved, message: `Moved ${moved} replica(s) to balance cluster` };
  }

  // ─── Full verification ───────────────────────────────────────────────────

  async verifyAll(): Promise<{ verified: number; issues: number }> {
    const objects = getObjects();
    let verified = 0, issues = 0;

    for (const obj of objects) {
      const result = await this.verifyObject(obj.id);
      verified++;
      if (result.issues.length > 0) issues++;
    }

    addOperation({
      type: 'verify',
      description: `Full integrity scan: ${verified} object(s), ${issues} with issues`,
      status: 'completed',
      details: { verified, issues },
    });

    return { verified, issues };
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────
let engine: VaultEngine | null = null;

export function getEngine(): VaultEngine {
  if (!engine) {
    engine = new VaultEngine();
    engine.initialize();
  }
  return engine;
}
