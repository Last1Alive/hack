import { NextResponse } from 'next/server';
import { getEngine } from '@/engine/vault-engine';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const engine = getEngine();
    const result = await engine.verifyObject(id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
