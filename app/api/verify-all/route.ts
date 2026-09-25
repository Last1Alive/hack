import { NextResponse } from 'next/server';
import { getEngine } from '@/engine/vault-engine';

export async function POST() {
  try {
    const engine = getEngine();
    const result = await engine.verifyAll();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
