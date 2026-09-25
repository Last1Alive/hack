import { NextResponse } from 'next/server';
import { getEngine } from '@/engine/vault-engine';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const engine = getEngine();
    const { id: nodeId } = await params;
    const node = engine.getNode(nodeId);
    if (!node) return NextResponse.json({ error: 'Node not found' }, { status: 404 });
    return NextResponse.json({ node });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const engine = getEngine();
    const { id: nodeId } = await params;
    const body = await request.json();
    const { action, objectId } = body;

    switch (action) {
      case 'fail':
        engine.failNode(nodeId);
        break;
      case 'recover':
        engine.recoverNode(nodeId);
        break;
      case 'corrupt':
        if (!objectId) {
          return NextResponse.json({ error: 'objectId required for corrupt' }, { status: 400 });
        }
        engine.corruptReplica(nodeId, objectId);
        break;
      case 'partition': {
        const { peerId } = body;
        if (!peerId) return NextResponse.json({ error: 'peerId required for partition' }, { status: 400 });
        engine.partitionNodes(nodeId, peerId);
        break;
      }
      case 'heal': {
        const { peerId } = body;
        if (!peerId) return NextResponse.json({ error: 'peerId required for heal' }, { status: 400 });
        engine.healPartition(nodeId, peerId);
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
