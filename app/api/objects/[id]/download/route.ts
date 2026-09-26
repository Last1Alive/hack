import { NextResponse } from 'next/server';
import { getEngine } from '@/engine/vault-engine';
import { readObject } from '@/engine/node-storage';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const engine = getEngine();
    const obj = engine.getObject(id);
    if (!obj) return NextResponse.json({ error: 'Object not found' }, { status: 404 });

    // Read the object data from the first healthy replica
    const validReplica = obj.replicas.find(r => r.status === 'valid');
    if (!validReplica) return NextResponse.json({ error: 'No valid replicas available' }, { status: 404 });

    const data = readObject(validReplica.nodeId, id);
    if (!data) return NextResponse.json({ error: 'Data not found on storage node' }, { status: 404 });

    // Sanitize filename for HTTP headers (remove control chars, newlines)
    const safeFilename = (obj.name || 'file').replace(/[\r\n\t]/g, '_').slice(0, 200);

    return new NextResponse(data, {
      headers: {
        'Content-Type': obj.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
        'Content-Length': String(data.length),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
