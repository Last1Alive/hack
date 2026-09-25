import { NextResponse } from 'next/server';
import { getEngine } from '@/engine/vault-engine';

export async function GET() {
  try {
    const engine = getEngine();
    const objects = engine.getObjects();
    return NextResponse.json({ objects });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const engine = getEngine();
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const name = formData.get('name') as string;
    const mimeType = formData.get('mimeType') as string;
    const replicationFactor = parseInt(formData.get('replicationFactor') as string) || 3;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const displayName = name || file.name;
    const result = await engine.uploadObject(displayName, mimeType || 'application/octet-stream', buffer, replicationFactor);

    return NextResponse.json({ ...result, name: displayName });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
