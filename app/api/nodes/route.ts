import { NextResponse } from 'next/server';
import { getEngine } from '@/engine/vault-engine';

export async function GET() {
  try {
    const engine = getEngine();
    const nodes = engine.getNodes();
    return NextResponse.json({ nodes });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const engine = getEngine();
    const { nodeId, action } = body;

    if (!nodeId || !action) {
      return NextResponse.json({ error: 'nodeId and action required' }, { status: 400 });
    }

    switch (action) {
      case 'fail':
        engine.failNode(nodeId);
        break;
      case 'recover':
        engine.recoverNode(nodeId);
        break;
      case 'verify': {
        const objects = engine.getObjects();
        for (const obj of objects) {
          if (obj.replicas.some(r => r.nodeId === nodeId)) {
            await engine.verifyObject(obj.id);
          }
        }
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const nodes = engine.getNodes();
    return NextResponse.json({ nodes });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
