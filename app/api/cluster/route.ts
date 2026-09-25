import { NextResponse } from 'next/server';
import { getEngine } from '@/engine/vault-engine';

export async function GET() {
  try {
    const engine = getEngine();
    const health = engine.getClusterHealth();
    const config = engine.getConfig();
    const ops = engine.getOperations(20);
    return NextResponse.json({ ...health, config, recentOps: ops });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
