import * as crypto from 'crypto';
import {
  Node, NodeStatus, ObjectMetadata, Replica, ReplicaStatus, Operation, OperationType,
  computeChecksum, chunkData, formatBytes, generateObjectId, generateOperationId,
  DEFAULT_REPLICATION_FACTOR, DEFAULT_WRITE_POLICY, DEFAULT_READ_POLICY, CHUNK_SIZE,
} from './types';
import {
  ensureStorageRoot, ensureNodeDirs, getNodeInfo, getNodeUsedBytes, getNodeObjectCount,
  getNodeReplicaCount, writeChunk, writeObjectMeta, readChunk, deleteChunk,
  corruptChunk, simulateOffline, simulateOnline, isNodeOffline,
} from './node-storage';
import {
  loadMetadata, saveMetadata, getConfig, getObjects, getObject,
  addObject, updateObject, deleteObject, addOperation, getOperations,
} from './metadata-store';

export interface VaultOptions {
  nodeCount?: number;
  capacityPerNodeBytes?: number;
  defaultReplicationFactor?: number;
}

export class VaultEngine {
  private nodes: Map<string, Node> = new Map();
  private options: Required<VaultOptions>;
  private rebalanceTimer: ReturnType<typeof setInterval> | null = null;
  private repairTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: VaultOptions = {}) {
    this.options = {
      nodeCount: opts.nodeCount ?? 4,
      capacityPerNodeBytes: opts.capacityPerNodeBytes ?? (10 * 1024 * 1024 * 1024), // 10GB per node for demo
      defaultReplicationFactor: opts.defaultReplicationFactor ?? 3,
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

    // Load existing object metadata and re-index replicas
    for (const obj of getObjects()) {
      this.reIndexReplicas(obj);
    }

    // Start background maintenance
    this.startBackgroundMaintenance();
  }

  private startBackgroundMaintenance(): void {
    // Repair check every 5 seconds
    this.repairTimer = setInterval(() => this.runRepairCycle(), 5000);
    // Rebalance check every 30 seconds
    this.rebalanceTimer = setInterval(() => this.runRebalanceCheck(), 30000);
  }

  private reIndexReplicas(obj: ObjectMetadata): void {
    // Verify each replica actually exists on disk
    for (const replica of obj.replicas) {
      const data = readChunk(replica.nodeId, obj.id, replica.chunkIndex);
      if (data === null) {
        replica.status = 'missing';
      } else {
        const actualChecksum = computeChecksum(data);
        if (actualChecksum !== replica.checksum) {
          replica.status = 'corrupted';
        } else {
          replica.status = 'valid';
        }
        replica.updatedAt = new Date().toISOString();
      }
    }
    this.updateIntegrityStatus(obj);
    updateObject(obj.id, obj);
  }

  private updateIntegrityStatus(obj: ObjectMetadata): void {
    const valid = obj.replicas.filter(r => r.status === 'valid').length;
    const corrupted = obj.replicas.filter(r => r.status === 'corrupted').length;
    const missing = obj.replicas.filter(r => r.status === 'missing').length;

    if (valid === obj.replicationFactor) {
      obj.integrityStatus = 'valid';
    } else if (corrupted > 0 && valid < obj.replicationFactor - corrupted) {
      obj.integrityStatus = 'corrupted';
    } else if (missing > 0 || corrupted > 0) {
      obj.integrityStatus = 'degraded';
    } else {
      obj.integrityStatus = 'valid';
    }
  }

  // ─── Cluster Info ────────────────────────────────────────────────────────

  getNodes(): Node[] {
    const result: Node[] = [];
    for (let i = 0; i < this.options.nodeCount; i++) {
      const nodeId = `node-${String(i + 1).padStart(2, '0')}`;
      const existing = this.nodes.get(nodeId);
      if (existing) {
        result.push({
          ...existing,
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

  getObjects(): ObjectMetadata[] {
    const result: ObjectMetadata[] = [];
    const offlineNodes = new Set(this.getNodes().filter(n => n.status === 'offline').map(n => n.id));
    for (const obj of getObjects()) {
      // Refresh replica statuses from disk
      for (const replica of obj.replicas) {
        if (offlineNodes.has(replica.nodeId)) {
          replica.status = 'missing';
          replica.updatedAt = new Date().toISOString();
          continue;
        }
        const data = readChunk(replica.nodeId, obj.id, replica.chunkIndex);
        if (data === null) {
          replica.status = 'missing';
        } else {
          const actualChecksum = computeChecksum(data);
          replica.status = actualChecksum === replica.checksum ? 'valid' : 'corrupted';
          replica.checksum = actualChecksum;
          replica.updatedAt = new Date().toISOString();
        }
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

  // ─── Health & Metrics ────────────────────────────────────────────────────

  getClusterHealth() {
    const nodes = this.getNodes();
    const objects = this.getObjects();

    const healthyNodes = nodes.filter(n => n.status === 'healthy').length;
    const totalNodes = nodes.length;
    const totalObjects = objects.length;

    let logicalSize = 0, physicalSize = 0;
    let underReplicated = 0, corrupted = 0;

    for (const obj of objects) {
      logicalSize += obj.logicalSize;
      const validReplicas = obj.replicas.filter(r => r.status === 'valid').length;
      physicalSize += validReplicas * obj.logicalSize / Math.max(1, obj.chunks.length);
      if (validReplicas < obj.replicationFactor) underReplicated++;
      if (obj.integrityStatus === 'corrupted') corrupted++;
    }

    const availableNodes = nodes.filter(n => n.status !== 'offline').length;
    const availability = totalNodes > 0 ? (availableNodes / totalNodes) * 100 : 0;

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
      storageOverhead: logicalSize > 0 ? physicalSize / logicalSize : 1,
    };
  }

  // ─── Object Operations ───────────────────────────────────────────────────

  async uploadObject(
    name: string,
    mimeType: string,
    data: Buffer,
    replicationFactor?: number
  ): Promise<{ id: string; checksum: string; chunks: number }> {
    const id = generateObjectId();
    const rf = replicationFactor ?? this.options.defaultReplicationFactor;
    const chunks = chunkData(data);
    const checksum = computeChecksum(data);
    const now = new Date().toISOString();

    // Select target nodes (exclude offline)
    const availableNodes = this.getNodes().filter(n => n.status !== 'offline').map(n => n.id);
    const targets = this.selectTargets(availableNodes, rf);

    if (targets.length === 0) {
      throw new Error('No available nodes for storage');
    }

    // Write replicas
    const replicas: Replica[] = [];
    const chunkMetas = chunks.map(c => ({ index: c.index, checksum: c.checksum, size: c.size }));

    for (const chunk of chunks) {
      for (const nodeId of targets) {
        const filename = writeChunk(nodeId, id, chunk.index, chunk.data, chunk.checksum);
        replicas.push({
          nodeId,
          chunkIndex: chunk.index,
          path: filename,
          checksum: chunk.checksum,
          size: chunk.data.length,
          status: 'valid',
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    const obj: ObjectMetadata = {
      id,
      name,
      mimeType,
      logicalSize: data.length,
      checksum,
      version: 1,
      replicationFactor: rf,
      chunks: chunkMetas,
      replicas,
      integrityStatus: 'valid',
      createdAt: now,
      updatedAt: now,
    };

    addObject(obj);

    // Write per-node metadata copies
    for (const nodeId of targets) {
      writeObjectMeta(nodeId, obj as unknown as Record<string, unknown>);
    }

    addOperation({
      type: 'upload',
      description: `Uploaded "${name}" (${formatBytes(data.length)}) → ${targets.join(', ')}`,
      objectId: id,
      status: 'completed',
      details: { name, size: data.length, chunks: chunks.length, targets, replicationFactor: rf },
    });

    return { id, checksum, chunks: chunks.length };
  }

  async downloadObject(objectId: string): Promise<{ data: Buffer; meta: ObjectMetadata }> {
    const obj = getObject(objectId);
    if (!obj) throw new Error('Object not found');

    const policy = getConfig().readPolicy;

    // Find a valid replica
    const validReplicas = obj.replicas.filter(r => r.status === 'valid');
    if (validReplicas.length === 0) {
      throw new Error('No valid replicas available');
    }

    // Quorum/verified: need multiple valid replicas
    if ((policy === 'quorum' || policy === 'verified') && validReplicas.length < 2) {
      throw new Error('Insufficient valid replicas for quorum read policy');
    }

    // Reassemble from first valid replica
    const sorted = validReplicas.sort((a, b) => a.chunkIndex - b.chunkIndex);
    const parts: Buffer[] = [];
    for (const replica of sorted) {
      const data = readChunk(replica.nodeId, objectId, replica.chunkIndex);
      if (data) parts.push(data);
    }

    const data = Buffer.concat(parts);

    // Verify top-level checksum
    const computed = computeChecksum(data);
    if (computed !== obj.checksum && obj.logicalSize > 0) {
      addOperation({
        type: 'verify',
        description: `Checksum mismatch on download of "${obj.name}"`,
        objectId: objectId,
        status: 'failed',
        details: { expected: obj.checksum, actual: computed },
      });
    }

    addOperation({
      type: 'download',
      description: `Downloaded "${obj.name}" from ${sorted[0].nodeId}`,
      objectId: objectId,
      status: 'completed',
      details: { fromNode: sorted[0].nodeId, size: data.length },
    });

    return { data, meta: obj };
  }

  async deleteObject(objectId: string): Promise<boolean> {
    const obj = getObject(objectId);
    if (!obj) return false;

    // Remove all replicas from disk
    for (const replica of obj.replicas) {
      deleteChunk(replica.nodeId, objectId, replica.chunkIndex);
    }

    deleteObject(objectId);

    addOperation({
      type: 'delete',
      description: `Deleted "${obj.name}"`,
      objectId: objectId,
      status: 'completed',
    });

    return true;
  }

  // ─── Integrity ───────────────────────────────────────────────────────────

  async verifyObject(objectId: string): Promise<{ status: string; issues: string[] }> {
    const obj = getObject(objectId);
    if (!obj) throw new Error('Object not found');

    const issues: string[] = [];

    for (const replica of obj.replicas) {
      const data = readChunk(replica.nodeId, objectId, replica.chunkIndex);
      if (data === null) {
        replica.status = 'missing';
        issues.push(`Missing chunk ${replica.chunkIndex} on ${replica.nodeId}`);
      } else {
        const actual = computeChecksum(data);
        if (actual !== replica.checksum) {
          replica.status = 'corrupted';
          issues.push(`Corrupted chunk ${replica.chunkIndex} on ${replica.nodeId} (expected ${replica.checksum.slice(0, 16)}..., got ${actual.slice(0, 16)}...)`);
        } else {
          replica.status = 'valid';
        }
        replica.updatedAt = new Date().toISOString();
      }
    }

    this.updateIntegrityStatus(obj);
    updateObject(objectId, obj);

    addOperation({
      type: 'verify',
      description: `Verified "${obj.name}": ${issues.length === 0 ? 'all valid' : `${issues.length} issues found`}`,
      objectId: objectId,
      status: issues.length === 0 ? 'completed' : 'failed',
      details: { issues, status: obj.integrityStatus },
    });

    return { status: obj.integrityStatus, issues };
  }

  // ─── Failure Simulation ──────────────────────────────────────────────────

  failNode(nodeId: string): void {
    if (!this.nodes.has(nodeId)) throw new Error(`Node ${nodeId} not found`);
    simulateOffline(nodeId);
    const node = this.nodes.get(nodeId)!;
    this.nodes.set(nodeId, { ...node, status: 'offline', lastHeartbeat: new Date().toISOString() });

    // Invalidate replicas on this node
    for (const obj of getObjects()) {
      for (const replica of obj.replicas) {
        if (replica.nodeId === nodeId) {
          replica.status = 'missing';
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
    if (!this.nodes.has(nodeId)) throw new Error(`Node ${nodeId} not found`);
    simulateOnline(nodeId);
    const node = this.nodes.get(nodeId)!;
    this.nodes.set(nodeId, {
      ...node,
      status: 'recovering',
      lastHeartbeat: new Date().toISOString(),
    });

    addOperation({
      type: 'recover',
      description: `Node ${nodeId} recovering...`,
      nodeId,
      status: 'completed',
    });

    // Trigger repair for missing replicas on this node
    setTimeout(() => this.performRepairForNode(nodeId), 500);
  }

  corruptReplica(nodeId: string, objectId: string, chunkIndex: number): boolean {
    const obj = getObject(objectId);
    if (!obj) throw new Error('Object not found');

    const replica = obj.replicas.find(r => r.nodeId === nodeId && r.chunkIndex === chunkIndex);
    if (!replica) throw new Error('Replica not found');

    const success = corruptChunk(nodeId, objectId, chunkIndex);
    if (success) {
      replica.status = 'corrupted';
      replica.updatedAt = new Date().toISOString();
      this.updateIntegrityStatus(obj);
      updateObject(objectId, obj);

      addOperation({
        type: 'corrupt',
        description: `Corrupted chunk ${chunkIndex} of "${obj.name}" on ${nodeId}`,
        nodeId,
        objectId,
        status: 'completed',
      });
    }
    return success;
  }

  partitionNodes(fromNodeId: string, toNodeId: string): void {
    const fromNode = this.nodes.get(fromNodeId);
    const toNode = this.nodes.get(toNodeId);
    if (!fromNode || !toNode) throw new Error('Invalid node IDs');

    // Add partition to both
    if (!fromNode.partitions.includes(toNodeId)) {
      this.nodes.set(fromNodeId, { ...fromNode, partitions: [...fromNode.partitions, toNodeId] });
    }
    if (!toNode.partitions.includes(fromNodeId)) {
      this.nodes.set(toNode.id, { ...toNode, partitions: [...toNode.partitions, fromNodeId] });
    }

    addOperation({
      type: 'partition',
      description: `Network partition: ${fromNodeId} ↔ ${toNodeId}`,
      status: 'completed',
      details: { from: fromNodeId, to: toNodeId },
    });
  }

  healPartition(nodeId: string, peerId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    const newPartitions = node.partitions.filter(p => p !== peerId);
    this.nodes.set(nodeId, { ...node, partitions: newPartitions });

    const peer = this.nodes.get(peerId);
    if (peer) {
      const peerNewParts = peer.partitions.filter(p => p !== nodeId);
      this.nodes.set(peerId, { ...peer, partitions: peerNewParts });
    }

    addOperation({
      type: 'partition',
      description: `Partition healed: ${nodeId} ↔ ${peerId}`,
      status: 'completed',
      details: { from: nodeId, to: peerId, action: 'healed' },
    });
  }

  // ─── Repair ──────────────────────────────────────────────────────────────

  private performRepairForNode(targetNodeId: string): void {
    const objects = getObjects();
    let repaired = 0;

    for (const obj of objects) {
      const missingOnTarget = obj.replicas.filter(r => r.nodeId === targetNodeId && r.status !== 'valid');
      if (missingOnTarget.length === 0) continue;

      // Find a valid source replica
      const validReplicas = obj.replicas.filter(r => r.status === 'valid' && r.nodeId !== targetNodeId);
      if (validReplicas.length === 0) continue; // No source available

      for (const missing of missingOnTarget) {
        const source = validReplicas[Math.floor(Math.random() * validReplicas.length)];
        const data = readChunk(source.nodeId, obj.id, missing.chunkIndex);
        if (data) {
          writeChunk(targetNodeId, obj.id, missing.chunkIndex, data, source.checksum);
          missing.status = 'valid';
          missing.checksum = source.checksum;
          missing.updatedAt = new Date().toISOString();
          repaired++;
        }
      }

      this.updateIntegrityStatus(obj);
      updateObject(obj.id, obj);
    }

    // Mark node as healthy after repair
    const node = this.nodes.get(targetNodeId);
    if (node && node.status === 'recovering') {
      this.nodes.set(targetNodeId, { ...node, status: 'healthy' });
    }

    if (repaired > 0) {
      addOperation({
        type: 'repair',
        description: `Repaired ${repaired} replicas on ${targetNodeId}`,
        nodeId: targetNodeId,
        status: 'completed',
        details: { repaired },
      });
    }
  }

  private runRepairCycle(): void {
    const objects = getObjects();
    let needsRepair = false;

    for (const obj of objects) {
      const validReplicas = obj.replicas.filter(r => r.status === 'valid').length;
      const offlineCount = this.getNodes().filter(n => n.status === 'offline').length;

      // If we have enough valid replicas, no urgent repair needed
      if (validReplicas >= Math.max(1, obj.replicationFactor - offlineCount)) continue;

      needsRepair = true;
      // Find nodes with missing/corrupted replicas and try to repair
      for (const replica of obj.replicas) {
        if (replica.status !== 'valid') {
          const availableNodes = this.getNodes()
            .filter(n => n.status === 'healthy' && !n.partitions.includes(replica.nodeId))
            .map(n => n.id);

          // Skip if already has a valid replica elsewhere
          const hasValidElsewhere = obj.replicas.some(r =>
            r.status === 'valid' && r.chunkIndex === replica.chunkIndex && r.nodeId !== replica.nodeId
          );

          if (hasValidElsewhere && availableNodes.length > 0) {
            const source = obj.replicas.find(r => r.status === 'valid' && r.chunkIndex === replica.chunkIndex);
            if (source) {
              const data = readChunk(source.nodeId, obj.id, replica.chunkIndex);
              if (data) {
                writeChunk(replica.nodeId, obj.id, replica.chunkIndex, data, source.checksum);
                replica.status = 'valid';
                replica.checksum = source.checksum;
                replica.updatedAt = new Date().toISOString();
              }
            }
          }
        }
      }
      this.updateIntegrityStatus(obj);
      updateObject(obj.id, obj);
    }

    // Auto-recover offline nodes that are back online
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
    const healthyNodes = nodes.filter(n => n.status !== 'offline');
    if (healthyNodes.length < 2) return;

    const usagePcts = healthyNodes.map(n => ({
      nodeId: n.id,
      usagePct: n.capacityBytes > 0 ? n.usedBytes / n.capacityBytes : 0,
    }));

    const maxUsage = Math.max(...usagePcts.map(u => u.usagePct));
    const minUsage = Math.min(...usagePcts.map(u => u.usagePct));

    // Only rebalance if there's significant imbalance
    if (maxUsage - minUsage < 0.05) return;

    const srcNode = usagePcts.find(u => u.usagePct === maxUsage);
    const dstNode = usagePcts.find(u => u.usagePct === minUsage);
    if (!srcNode || !dstNode) return;

    // Move one object's replicas from overloaded to underloaded
    const objects = getObjects();
    for (const obj of objects) {
      const replicasOnSrc = obj.replicas.filter(r => r.nodeId === srcNode.nodeId && r.status === 'valid');
      if (replicasOnSrc.length === 0) continue;

      // Check if dst can accept more
      const dstNodeInfo = this.nodes.get(dstNode.nodeId);
      if (!dstNodeInfo) continue;
      const dstUsagePct = dstNodeInfo.capacityBytes > 0 ? dstNodeInfo.usedBytes / dstNodeInfo.capacityBytes : 0;
      if (dstUsagePct > 0.9) continue; // Don't overfill

      // Pick a replica to move
      const replica = replicasOnSrc[0];
      const data = readChunk(srcNode.nodeId, obj.id, replica.chunkIndex);
      if (!data) continue;

      // Write to destination
      writeChunk(dstNode.nodeId, obj.id, replica.chunkIndex, data, replica.checksum);

      // Add new replica
      const now = new Date().toISOString();
      obj.replicas.push({
        nodeId: dstNode.nodeId,
        chunkIndex: replica.chunkIndex,
        path: `${obj.id}_${replica.chunkIndex}_moved.chunk`,
        checksum: replica.checksum,
        size: data.length,
        status: 'valid',
        version: obj.version,
        createdAt: now,
        updatedAt: now,
      });

      // Remove from source
      obj.replicas = obj.replicas.filter(r => !(r.nodeId === srcNode.nodeId && r.chunkIndex === replica.chunkIndex));
      deleteChunk(srcNode.nodeId, obj.id, replica.chunkIndex);

      this.updateIntegrityStatus(obj);
      updateObject(obj.id, obj);

      addOperation({
        type: 'rebalance',
        description: `Rebalanced chunk ${replica.chunkIndex} of "${obj.name}": ${srcNode.nodeId} → ${dstNode.nodeId}`,
        status: 'completed',
        details: { from: srcNode.nodeId, to: dstNode.nodeId, objectId: obj.id },
      });

      break; // One move per cycle
    }
  }

  async triggerRebalance(): Promise<{ moved: number; message: string }> {
    let moved = 0;
    const maxMoves = 10;

    for (let i = 0; i < maxMoves; i++) {
      const nodes = this.getNodes();
      const healthyNodes = nodes.filter(n => n.status !== 'offline');
      if (healthyNodes.length < 2) break;

      const usagePcts = healthyNodes.map(n => ({
        nodeId: n.id,
        usagePct: n.capacityBytes > 0 ? n.usedBytes / n.capacityBytes : 0,
      }));

      const maxUsage = Math.max(...usagePcts.map(u => u.usagePct));
      const minUsage = Math.min(...usagePcts.map(u => u.usagePct));
      if (maxUsage - minUsage < 0.02) break; // Well balanced

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
        const data = readChunk(srcNode.nodeId, obj.id, replica.chunkIndex);
        if (!data) continue;

        writeChunk(dstNode.nodeId, obj.id, replica.chunkIndex, data, replica.checksum);
        const now = new Date().toISOString();
        obj.replicas.push({
          nodeId: dstNode.nodeId, chunkIndex: replica.chunkIndex,
          path: `${obj.id}_${replica.chunkIndex}.chunk`,
          checksum: replica.checksum, size: data.length,
          status: 'valid', version: obj.version, createdAt: now, updatedAt: now,
        });
        obj.replicas = obj.replicas.filter(r => !(r.nodeId === srcNode.nodeId && r.chunkIndex === replica.chunkIndex));
        deleteChunk(srcNode.nodeId, obj.id, replica.chunkIndex);
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
      description: `Manual rebalance completed: ${moved} chunks moved`,
      status: 'completed',
      details: { moved },
    });

    return { moved, message: `Moved ${moved} chunks to balance cluster` };
  }

  // ─── Verification ────────────────────────────────────────────────────────

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
      description: `Full integrity scan: ${verified} objects, ${issues} with issues`,
      status: 'completed',
      details: { verified, issues },
    });

    return { verified, issues };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private selectTargets(availableNodes: string[], count: number): string[] {
    // Spread replicas across different nodes, avoiding partitions
    const targets: string[] = [];
    const used = new Set<string>();

    for (let i = 0; i < count && i < availableNodes.length; i++) {
      // Pick node furthest from already-selected ones
      let best = availableNodes[i];
      let bestScore = -1;
      for (const node of availableNodes) {
        if (used.has(node)) continue;
        // Score by how many selected nodes it's NOT partitioned from
        const nodeInfo = this.nodes.get(node);
        if (!nodeInfo) continue;
        let score = 0;
        for (const t of targets) {
          const tInfo = this.nodes.get(t);
          if (tInfo && !tInfo.partitions.includes(node)) score++;
        }
        if (score > bestScore) { bestScore = score; best = node; }
      }
      targets.push(best);
      used.add(best);
    }

    return targets;
  }
}

// Singleton instance
let engine: VaultEngine | null = null;

export function getEngine(): VaultEngine {
  if (!engine) {
    engine = new VaultEngine();
    engine.initialize();
  }
  return engine;
}
