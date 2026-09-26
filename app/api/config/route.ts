import { NextResponse } from 'next/server';
import { getEngine } from '@/engine/vault-engine';
import { setConfig } from '@/engine/metadata-store';
import { DEFAULT_CAPACITY_BYTES } from '@/engine/types';
import { execSync } from 'child_process';

/** Min 100 MB */
const MIN_CAPACITY = 100 * 1024 * 1024; // 100 MB

/** Get free disk space in bytes (cross-platform, no native deps). */
function getFreeDiskBytes(): number {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      // Windows: wmic logicaldisk where "DeviceID='C:'" get FreeSpace
      const out = execSync('wmic logicaldisk get FreeSpace,Size /format:csv', { encoding: 'utf-8' });
      const lines = out.trim().split('\n').slice(1); // skip header
      let totalFree = 0;
      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 2) {
          const free = parseInt(parts[1]?.trim() || '0', 10);
          if (Number.isFinite(free)) totalFree += free;
        }
      }
      return totalFree > 0 ? totalFree : 10 * 1024 * 1024 * 1024;
    } else {
      // Linux / macOS: df -B1 <path>
      const out = execSync(`df -B1 "${process.cwd()}" 2>/dev/null | tail -1`, { encoding: 'utf-8' });
      const cols = out.trim().split(/\s+/);
      // cols: Filesystem 1K-blocks Used Available Capacity Mounted
      const available = parseInt(cols[3] || '0', 10);
      return Number.isFinite(available) && available > 0 ? available * 1024 : 10 * 1024 * 1024 * 1024;
    }
  } catch {
    return 10 * 1024 * 1024 * 1024; // fallback: 10 GB
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export async function GET() {
  try {
    const engine = getEngine();
    const config = engine.getConfig();
    const freeBytes = getFreeDiskBytes();
    return NextResponse.json({
      ...config,
      minCapacityBytes: MIN_CAPACITY,
      maxCapacityBytes: Math.min(freeBytes, 100 * 1024 * 1024 * 1024), // cap at 100 GB for safety
      freeDiskBytes: freeBytes,
      presets: [
        { label: '500 MB',  bytes: 500 * 1024 * 1024 },
        { label: '1 GB',    bytes: 1 * 1024 * 1024 * 1024 },
        { label: '2 GB',    bytes: 2 * 1024 * 1024 * 1024 },
        { label: '5 GB',    bytes: 5 * 1024 * 1024 * 1024 },
        { label: '10 GB',   bytes: 10 * 1024 * 1024 * 1024 },
        { label: '25 GB',   bytes: 25 * 1024 * 1024 * 1024 },
        { label: '50 GB',   bytes: 50 * 1024 * 1024 * 1024 },
        { label: '100 GB',  bytes: 100 * 1024 * 1024 * 1024 },
      ],
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const engine = getEngine();
    const currentConfig = engine.getConfig();
    const freeBytes = getFreeDiskBytes();
    const maxAllowed = Math.min(freeBytes, 100 * 1024 * 1024 * 1024);

    const updates: Record<string, unknown> = {};

    if (body.defaultReplicationFactor !== undefined) {
      const rf = Number(body.defaultReplicationFactor);
      if (!Number.isInteger(rf) || rf < 1 || rf > 8) {
        return NextResponse.json(
          { error: 'defaultReplicationFactor must be an integer between 1 and 8' },
          { status: 400 }
        );
      }
      updates.defaultReplicationFactor = rf;
    }

    if (body.capacityPerNodeBytes !== undefined) {
      let bytes = Number(body.capacityPerNodeBytes);
      if (!Number.isFinite(bytes) || bytes < MIN_CAPACITY) {
        return NextResponse.json(
          { error: `capacityPerNodeBytes must be at least ${formatBytes(MIN_CAPACITY)}` },
          { status: 400 }
        );
      }
      if (bytes > maxAllowed) {
        return NextResponse.json(
          {
            error: `Requested capacity exceeds available disk space (${formatBytes(maxAllowed)})`,
            maxAllowedBytes: maxAllowed,
            requestedBytes: bytes,
          },
          { status: 400 }
        );
      }
      updates.capacityPerNodeBytes = bytes;
    }

    if (body.writePolicy !== undefined) {
      if (!['one', 'majority', 'all'].includes(body.writePolicy)) {
        return NextResponse.json(
          { error: 'writePolicy must be one of: one, majority, all' },
          { status: 400 }
        );
      }
      updates.writePolicy = body.writePolicy;
    }

    if (body.readPolicy !== undefined) {
      if (!['any', 'quorum', 'verified'].includes(body.readPolicy)) {
        return NextResponse.json(
          { error: 'readPolicy must be one of: any, quorum, verified' },
          { status: 400 }
        );
      }
      updates.readPolicy = body.readPolicy;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    setConfig(updates);

    const newConfig = { ...currentConfig, ...updates };
    return NextResponse.json({ config: newConfig, message: 'Configuration updated' });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
