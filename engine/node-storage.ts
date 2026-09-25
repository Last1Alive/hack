import * as fs from 'fs';
import * as path from 'path';
import type { Node } from './types';
import { computeChecksum, formatBytes } from './types';

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage');

/** Each node stores its objects directly in storage/<nodeId>/objects/ */
export function getNodeDir(nodeId: string): string {
  return path.join(STORAGE_ROOT, nodeId);
}

export function ensureStorageRoot(): void {
  if (!fs.existsSync(STORAGE_ROOT)) {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  }
}

export function ensureNodeDirs(nodeId: string): void {
  fs.mkdirSync(getNodeDir(nodeId), { recursive: true });
}

/** Compute actual bytes stored on a node by summing all .obj files on disk. */
export function getNodeUsedBytes(nodeId: string): number {
  const dir = getNodeDir(nodeId);
  if (!fs.existsSync(dir)) return 0;
  try {
    const files = fs.readdirSync(dir, { recursive: true });
    let total = 0;
    for (const file of files) {
      if (typeof file !== 'string') continue;
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && file.endsWith('.obj')) {
          total += stat.size;
        }
      } catch { /* skip unreadable files */ }
    }
    return total;
  } catch { return 0; }
}

/** Count unique objects stored on this node by counting .obj files. */
export function getNodeObjectCount(nodeId: string): number {
  const dir = getNodeDir(nodeId);
  if (!fs.existsSync(dir)) return 0;
  try {
    const files = fs.readdirSync(dir, { recursive: true });
    return files.filter(f => typeof f === 'string' && f.endsWith('.obj')).length;
  } catch { return 0; }
}

/** Count replica entries — same as object count since each object = one replica per node. */
export function getNodeReplicaCount(nodeId: string): number {
  return getNodeObjectCount(nodeId);
}

/**
 * Write a complete object copy to a node.
 * Filename: <objectId>.obj
 */
export function writeObject(nodeId: string, objectId: string, data: Buffer): string {
  const filePath = path.join(getNodeDir(nodeId), `${objectId}.obj`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
  return filePath;
}

/** Read the full object copy from a node. */
export function readObject(nodeId: string, objectId: string): Buffer | null {
  const filePath = path.join(getNodeDir(nodeId), `${objectId}.obj`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath);
  } catch { return null; }
}

/** Get the checksum of an object stored on a node. */
export function getObjectChecksum(nodeId: string, objectId: string): string | null {
  const data = readObject(nodeId, objectId);
  if (!data) return null;
  return computeChecksum(data);
}

/** Delete an object copy from a node. */
export function deleteObject(nodeId: string, objectId: string): boolean {
  const filePath = path.join(getNodeDir(nodeId), `${objectId}.obj`);
  if (!fs.existsSync(filePath)) return false;
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch { return false; }
}

/**
 * Corrupt an object on a node by flipping bits in the stored file.
 * The file remains on disk (so we can demonstrate repair), but its checksum changes.
 */
export function corruptObject(nodeId: string, objectId: string): boolean {
  const filePath = path.join(getNodeDir(nodeId), `${objectId}.obj`);
  if (!fs.existsSync(filePath)) return false;
  try {
    const data = fs.readFileSync(filePath);
    const corrupted = Buffer.from(data);
    // Flip several bytes to make corruption obvious
    for (let i = 0; i < Math.min(16, corrupted.length); i++) {
      corrupted[i] = corrupted[i] ^ 0xFF;
    }
    fs.writeFileSync(filePath, corrupted);
    return true;
  } catch { return false; }
}

/** Mark a node as offline via a marker file. */
export function simulateOffline(nodeId: string): void {
  const nodeDir = getNodeDir(nodeId);
  fs.mkdirSync(nodeDir, { recursive: true });
  fs.writeFileSync(path.join(nodeDir, '.offline'), 'true');
}

/** Clear the offline marker. */
export function simulateOnline(nodeId: string): void {
  const nodeDir = getNodeDir(nodeId);
  const offlineMarker = path.join(nodeDir, '.offline');
  if (fs.existsSync(offlineMarker)) {
    fs.unlinkSync(offlineMarker);
  }
}

/** Check whether a node is marked offline. */
export function isNodeOffline(nodeId: string): boolean {
  return fs.existsSync(path.join(getNodeDir(nodeId), '.offline'));
}

/** Build a Node info snapshot from disk state. */
export function getNodeInfo(nodeId: string, capacityBytes: number): Node {
  const usedBytes = getNodeUsedBytes(nodeId);
  const objectCount = getNodeObjectCount(nodeId);
  const replicaCount = getNodeReplicaCount(nodeId);
  const offline = isNodeOffline(nodeId);

  let status: Node['status'] = 'healthy';
  if (offline) status = 'offline';

  return {
    id: nodeId,
    name: nodeId,
    status,
    capacityBytes,
    usedBytes,
    objectCount,
    replicaCount,
    lastHeartbeat: new Date().toISOString(),
    partitions: [],
  };
}
