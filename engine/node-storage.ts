import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, createHash } from 'crypto';
import type { Node } from './types';
import { computeChecksum, formatBytes } from './types';

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage');

function getNodeDir(nodeId: string): string {
  return path.join(STORAGE_ROOT, nodeId);
}

function getChunkDir(nodeId: string): string {
  return path.join(getNodeDir(nodeId), 'chunks');
}

function getObjectDir(nodeId: string): string {
  return path.join(getNodeDir(nodeId), 'objects');
}

export function ensureStorageRoot(): void {
  if (!fs.existsSync(STORAGE_ROOT)) {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  }
}

export function ensureNodeDirs(nodeId: string): void {
  fs.mkdirSync(getNodeDir(nodeId), { recursive: true });
  fs.mkdirSync(getChunkDir(nodeId), { recursive: true });
  fs.mkdirSync(getObjectDir(nodeId), { recursive: true });
}

export function deleteNodeDirs(nodeId: string): boolean {
  const nodeDir = getNodeDir(nodeId);
  if (!fs.existsSync(nodeDir)) return false;
  fs.rmSync(nodeDir, { recursive: true, force: true });
  return true;
}

export function getNodeUsedBytes(nodeId: string): number {
  const chunkDir = getChunkDir(nodeId);
  if (!fs.existsSync(chunkDir)) return 0;
  let total = 0;
  try {
    const files = fs.readdirSync(chunkDir, { recursive: true });
    for (const file of files) {
      const fullPath = path.join(chunkDir, file as string);
      if (fs.statSync(fullPath).isFile()) {
        total += fs.statSync(fullPath).size;
      }
    }
  } catch { /* ignore */ }
  return total;
}

export function getNodeObjectCount(nodeId: string): number {
  const objDir = getObjectDir(nodeId);
  if (!fs.existsSync(objDir)) return 0;
  try {
    return fs.readdirSync(objDir).filter(f => f.endsWith('.meta.json')).length;
  } catch { return 0; }
}

export function getNodeReplicaCount(nodeId: string): number {
  const chunkDir = getChunkDir(nodeId);
  if (!fs.existsSync(chunkDir)) return 0;
  try {
    return fs.readdirSync(chunkDir).length;
  } catch { return 0; }
}

export function writeChunk(nodeId: string, objectId: string, chunkIndex: number, data: Buffer, checksum: string): string {
  const chunkDir = getChunkDir(nodeId);
  const safeName = `${objectId}_${chunkIndex}_${checksum.slice(0, 8)}.chunk`;
  const filePath = path.join(chunkDir, safeName);
  fs.writeFileSync(filePath, data);
  return safeName;
}

export function writeObjectMeta(nodeId: string, meta: Record<string, unknown>): string {
  const objDir = getObjectDir(nodeId);
  const safeName = `${meta.id}.meta.json`;
  const filePath = path.join(objDir, safeName);
  fs.writeFileSync(filePath, JSON.stringify(meta, null, 2));
  return safeName;
}

export function readChunk(nodeId: string, objectId: string, chunkIndex: number): Buffer | null {
  const chunkDir = getChunkDir(nodeId);
  if (!fs.existsSync(chunkDir)) return null;
  const files = fs.readdirSync(chunkDir);
  const match = files.find(f => f.startsWith(`${objectId}_${chunkIndex}_`));
  if (!match) return null;
  try {
    return fs.readFileSync(path.join(chunkDir, match));
  } catch { return null; }
}

export function readFileChecksum(nodeId: string, objectId: string, chunkIndex: number): string | null {
  const data = readChunk(nodeId, objectId, chunkIndex);
  if (!data) return null;
  return computeChecksum(data);
}

export function deleteChunk(nodeId: string, objectId: string, chunkIndex: number): boolean {
  const chunkDir = getChunkDir(nodeId);
  if (!fs.existsSync(chunkDir)) return false;
  const files = fs.readdirSync(chunkDir);
  const match = files.find(f => f.startsWith(`${objectId}_${chunkIndex}_`));
  if (!match) return false;
  try {
    fs.unlinkSync(path.join(chunkDir, match));
    return true;
  } catch { return false; }
}

export function corruptChunk(nodeId: string, objectId: string, chunkIndex: number): boolean {
  const chunkDir = getChunkDir(nodeId);
  if (!fs.existsSync(chunkDir)) return false;
  const files = fs.readdirSync(chunkDir);
  const match = files.find(f => f.startsWith(`${objectId}_${chunkIndex}_`));
  if (!match) return false;
  try {
    const filePath = path.join(chunkDir, match);
    const data = fs.readFileSync(filePath);
    // Flip first byte to corrupt
    const corrupted = Buffer.from(data);
    corrupted[0] = corrupted[0] ^ 0xFF;
    fs.writeFileSync(filePath, corrupted);
    return true;
  } catch { return false; }
}

export function simulateOffline(nodeId: string): void {
  // Create a marker file that prevents reads/writes
  const nodeDir = getNodeDir(nodeId);
  fs.mkdirSync(nodeDir, { recursive: true });
  fs.writeFileSync(path.join(nodeDir, '.offline'), 'true');
}

export function simulateOnline(nodeId: string): void {
  const nodeDir = getNodeDir(nodeId);
  const offlineMarker = path.join(nodeDir, '.offline');
  if (fs.existsSync(offlineMarker)) {
    fs.unlinkSync(offlineMarker);
  }
}

export function isNodeOffline(nodeId: string): boolean {
  const offlineMarker = path.join(getNodeDir(nodeId), '.offline');
  return fs.existsSync(offlineMarker);
}

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
