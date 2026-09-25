import { NextResponse } from 'next/server';
import { getEngine } from '@/engine/vault-engine';

export async function GET(request: Request) {
  try {
    const engine = getEngine();
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const ops = engine.getOperations(limit);
    return NextResponse.json({ operations: ops });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
