import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import type { ObjectMetadata, Replica, Operation } from './types';
import { computeChecksum, formatBytes, generateObjectId, generateOperationId, DEFAULT_CAPACITY_BYTES } from './types';

const META_PATH = path.resolve(process.cwd(), '.vault-meta.json');

let objects: Map<string, ObjectMetadata> = new Map();
let operations: Operation[] = [];
let config = { defaultReplicationFactor: 3, writePolicy: 'majority' as const, readPolicy: 'quorum' as const, capacityPerNodeBytes: DEFAULT_CAPACITY_BYTES };

export function loadMetadata(): void {
  try {
    if (fs.existsSync(META_PATH)) {
      const data = JSON.parse(fs.readFileSync(META_PATH, 'utf-8'));
      objects = new Map(Object.entries(data.objects || {}).map(([k, v]) => [k, v as ObjectMetadata]));
      operations = (data.operations || []).slice(-500);
      if (data.config) config = { ...config, ...data.config };
    }
  } catch { /* fresh start */ }
}

export function saveMetadata(): void {
  const snapshot = {
    objects: Object.fromEntries(objects),
    operations: operations.slice(-500),
    config,
  };
  fs.writeFileSync(META_PATH, JSON.stringify(snapshot, null, 2));
}

export function getConfig() { return { ...config }; }
export function setConfig(newConfig: Partial<typeof config>): void {
  config = { ...config, ...newConfig };
  saveMetadata();
}

export function getObjects(): ObjectMetadata[] {
  return Array.from(objects.values());
}

export function getObject(id: string): ObjectMetadata | undefined {
  return objects.get(id);
}

export function addObject(meta: ObjectMetadata): void {
  objects.set(meta.id, meta);
  saveMetadata();
}

export function updateObject(id: string, update: Partial<ObjectMetadata>): void {
  const obj = objects.get(id);
  if (obj) {
    objects.set(id, { ...obj, ...update, updatedAt: new Date().toISOString() });
    saveMetadata();
  }
}

export function deleteObject(id: string): boolean {
  if (objects.has(id)) {
    objects.delete(id);
    saveMetadata();
    return true;
  }
  return false;
}

export function addOperation(op: Omit<Operation, 'id' | 'timestamp'>): Operation {
  const operation: Operation = {
    ...op,
    id: generateOperationId(),
    timestamp: new Date().toISOString(),
  };
  operations.push(operation);
  if (operations.length > 500) operations = operations.slice(-500);
  saveMetadata();
  return operation;
}

export function getOperations(limit: number = 50): Operation[] {
  return operations.slice(-limit).reverse();
}

export function clearOperations(): void {
  operations = [];
  saveMetadata();
}

export function getClusterHealth() {
  let healthy = 0, offline = 0, degraded = 0, total = 0;
  for (const obj of objects.values()) {
    total++;
    const validReplicas = obj.replicas.filter(r => r.status === 'valid').length;
    if (validReplicas === obj.replicationFactor) healthy++;
    else if (validReplicas > 0) degraded++;
  }
  return { healthyObjects: healthy, degradedObjects: degraded, totalObjects: total };
}
