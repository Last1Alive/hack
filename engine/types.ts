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
  partitions: string[];
}

export type ReplicaStatus = 'valid' | 'corrupted' | 'missing' | 'stale';

/**
 * A logical replica is ONE complete copy of an object on ONE node.
 * The old chunk-based model created N×M rows for N chunks and M nodes,
 * which caused the UI to display "453/3" instead of "3/3".
 * This version treats each (objectId + nodeId) pair as exactly one replica.
 */
export interface Replica {
  nodeId: string;
  path: string;
  checksum: string;
  size: number;
  status: ReplicaStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ObjectMetadata {
  id: string;
  name: string;
  mimeType: string;
  logicalSize: number;       // size of the original object data
  checksum: string;          // SHA-256 of the full object
  version: number;
  replicationFactor: number; // how many nodes should hold a copy
  replicas: Replica[];       // ONE entry per node that holds a copy
  integrityStatus: 'valid' | 'degraded' | 'corrupted' | 'inconsistent';
  createdAt: string;
  updatedAt: string;
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
  /** Per-node storage capacity in bytes (default 2 GB). */
  capacityPerNodeBytes: number;
}

export const DEFAULT_REPLICATION_FACTOR = 3;
export const DEFAULT_WRITE_POLICY: 'one' | 'majority' | 'all' = 'majority';
export const DEFAULT_READ_POLICY: 'any' | 'quorum' | 'verified' = 'quorum';
export const DEFAULT_CAPACITY_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB per node

export function computeChecksum(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ts; }
}

export function generateNodeId(index: number): string {
  return `node-${String(index + 1).padStart(2, '0')}`;
}

export function generateOperationId(): string {
  return randomUUID();
}

export function generateObjectId(): string {
  return randomUUID();
}
