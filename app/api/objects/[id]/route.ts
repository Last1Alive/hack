import { NextResponse } from 'next/server';
import { getEngine } from '@/engine/vault-engine';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const engine = getEngine();
    const obj = engine.getObject(id);
    if (!obj) return NextResponse.json({ error: 'Object not found' }, { status: 404 });
    return NextResponse.json({ object: obj });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const engine = getEngine();
    const deleted = await engine.deleteObject(id);
    if (!deleted) return NextResponse.json({ error: 'Object not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
