import { randomUUID, createHash } from 'crypto';

export type NodeStatus = 'healthy' | 'degraded' | 'offline' | 'recovering' | 'rebalancing' | 'corrupted';

export interface Node {
  id: string;
  name: string;
  status: NodeStatus;
  capacityBytes: number;
  usedBytes: number;
  objectCount: number;
  replicaCount: number;
  lastHeartbeat: string;
  partitions: string[];  // node IDs this node cannot reach
}

export type ReplicaStatus = 'valid' | 'corrupted' | 'missing' | 'stale';

export interface Replica {
  nodeId: string;
  chunkIndex: number;
  path: string;
  checksum: string;
  size: number;
  status: ReplicaStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type Chunk = {
  index: number;
  data: Buffer;
  checksum: string;
  size: number;
};

export interface ObjectMetadata {
  id: string;
  name: string;
  mimeType: string;
  logicalSize: number;
  checksum: string;
  version: number;
  replicationFactor: number;
  chunks: ChunkMeta[];
  replicas: Replica[];
  integrityStatus: 'valid' | 'degraded' | 'corrupted' | 'inconsistent';
  createdAt: string;
  updatedAt: string;
}

export interface ChunkMeta {
  index: number;
  checksum: string;
  size: number;
}

export type OperationType = 'upload' | 'download' | 'replicate' | 'repair' | 'verify' | 'rebalance' | 'fail' | 'recover' | 'corrupt' | 'partition' | 'delete';

export interface Operation {
  id: string;
  type: OperationType;
  timestamp: string;
  objectId?: string;
  nodeId?: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  details?: Record<string, unknown>;
}

export interface ClusterConfig {
  defaultReplicationFactor: number;
  writePolicy: 'one' | 'majority' | 'all';
  readPolicy: 'any' | 'quorum' | 'verified';
}

export const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB chunks for demo
export const DEFAULT_REPLICATION_FACTOR = 3;
export const DEFAULT_WRITE_POLICY: 'one' | 'majority' | 'all' = 'majority';
export const DEFAULT_READ_POLICY: 'any' | 'quorum' | 'verified' = 'quorum';

export function computeChecksum(data: Buffer): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function chunkData(data: Buffer, chunkSize: number = CHUNK_SIZE): Chunk[] {
  const chunks: Chunk[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    const checksum = computeChecksum(chunk);
    chunks.push({ index: chunks.length, data: chunk, checksum, size: chunk.length });
  }
  if (chunks.length === 0 && data.length > 0) {
    const checksum = computeChecksum(data);
    chunks.push({ index: 0, data, checksum, size: data.length });
  }
  return chunks;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ts; }
}

export function generateNodeId(index: number): string {
  return `node-${String(index).padStart(2, '0')}`;
}

export function generateOperationId(): string {
  return randomUUID();
}

export function generateObjectId(): string {
  return randomUUID();
}
