import { NextResponse } from 'next/server';
import { getEngine } from '@/engine/vault-engine';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const engine = getEngine();
    const { action, nodeId, peerId, objectId } = body;

    switch (action) {
      case 'fail':
        engine.failNode(nodeId);
        break;
      case 'recover':
        engine.recoverNode(nodeId);
        break;
      case 'verify':
        if (objectId) {
          await engine.verifyObject(objectId);
        }
        break;
      case 'corrupt':
        if (!objectId || !nodeId) {
          return NextResponse.json({ error: 'objectId and nodeId required' }, { status: 400 });
        }
        engine.corruptReplica(nodeId, objectId);
        break;
      case 'partition':
        if (!nodeId || !peerId) {
          return NextResponse.json({ error: 'nodeId and peerId required' }, { status: 400 });
        }
        engine.partitionNodes(nodeId, peerId);
        break;
      case 'heal':
        if (!nodeId || !peerId) {
          return NextResponse.json({ error: 'nodeId and peerId required' }, { status: 400 });
        }
        engine.healPartition(nodeId, peerId);
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const nodes = engine.getNodes();
    return NextResponse.json({ nodes });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
