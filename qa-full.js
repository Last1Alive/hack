const BASE = 'http://localhost:3001';
const fs = require('fs');
const path = require('path');

// Reset engine state before each test run by clearing the singleton cache
function resetEngine() {
  // Clear the require cache so next import gets a fresh instance
  const modulePath = path.join(process.cwd(), 'engine/vault-engine');
  delete require.cache[require.resolve(modulePath)];
  // Also clear metadata-store singleton
  const metaPath = path.join(process.cwd(), 'engine/metadata-store');
  delete require.cache[require.resolve(metaPath)];
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    return true;
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    return false;
  }
}

async function nodeAction(action, body = {}) {
  const res = await fetch(BASE + '/api/node-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  });
  if (!res.ok) throw new Error(`nodeAction ${action} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function expect(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

async function fetchJSON(method, path2, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path2, opts);
  if (!res.ok) throw new Error(`${method} ${path2} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const results = [];

  // ── Clean slate: remove old storage and metadata ──
  try { fs.rmSync(path.join(process.cwd(), 'storage'), { recursive: true, force: true }); } catch {}
  try { fs.unlinkSync(path.join(process.cwd(), '.vault-meta.json')); } catch {}

  // ── Test 1: Fresh start defaults ──
  results.push(await test('Fresh start: 4 healthy nodes, default 2GB capacity', async () => {
    const h = await fetchJSON('GET', '/api/cluster');
    expect(h.totalNodes === 4, `Expected 4 nodes, got ${h.totalNodes}`);
    expect(h.healthyNodes === 4, `Expected 4 healthy, got ${h.healthyNodes}`);
    expect(h.availability === 100, `Expected 100%, got ${h.availability}%`);
    expect(h.config.capacityPerNodeBytes === 2 * 1024 ** 3,
      `Default capacity wrong: expected ${2*1024**3}, got ${h.config.capacityPerNodeBytes}`);
  }));

  // ── Test 2: Config API ──
  results.push(await test('Config GET: returns presets and disk info', async () => {
    const cfg = await fetchJSON('GET', '/api/config');
    expect(cfg.presets.length >= 8, `Expected ≥8 presets, got ${cfg.presets.length}`);
    expect(cfg.minCapacityBytes === 100 * 1024 ** 2, 'Wrong min capacity');
    expect(cfg.maxCapacityBytes > 0, 'maxCapacityBytes should be positive');
    expect(cfg.freeDiskBytes > 0, 'freeDiskBytes should be positive');
    expect(cfg.defaultReplicationFactor === 3, 'Wrong default RF');
    expect(cfg.capacityPerNodeBytes === 2 * 1024 ** 3, 'Wrong default capacity in config');
  }));

  // ── Test 3: Increase capacity via PUT ──
  results.push(await test('Config PUT: increase capacity to 5GB', async () => {
    const r = await fetchJSON('PUT', '/api/config', { capacityPerNodeBytes: 5 * 1024 ** 3 });
    expect(r.config.capacityPerNodeBytes === 5 * 1024 ** 3,
      `Capacity not updated: ${r.config.capacityPerNodeBytes}`);
    // Verify it persisted
    const cfg2 = await fetchJSON('GET', '/api/config');
    expect(cfg2.capacityPerNodeBytes === 5 * 1024 ** 3, 'Capacity change not persisted');
  }));

  // ── Test 4: Reject invalid capacity ──
  results.push(await test('Config PUT: reject capacity below minimum', async () => {
    let err = '';
    try {
      await fetchJSON('PUT', '/api/config', { capacityPerNodeBytes: 1024 }); // 1KB
    } catch (e) { err = e.message; }
    expect(err.includes('400') || err.includes('at least'), `Expected validation error, got: ${err}`);
  }));

  // ── Reset capacity back to 2GB for remaining tests ──
  await fetchJSON('PUT', '/api/config', { capacityPerNodeBytes: 2 * 1024 ** 3 });
  await sleep(500);

  // ── Test 5: Upload with RF=3 ──
  results.push(await test('Upload 5MB file RF=3', async () => {
    const buf = Buffer.alloc(5 * 1024 ** 2, 'A');
    const fd = new FormData();
    fd.append('file', new Blob([buf]), 'test-5mb.bin');
    fd.append('name', 'test-5mb.bin');
    fd.append('mimeType', 'application/octet-stream');
    fd.append('replicationFactor', '3');
    const res = await fetch(BASE + '/api/objects', { method: 'POST', body: fd });
    const text = await res.text();
    expect(res.ok, `Upload failed: ${res.status} ${text}`);
    const r = JSON.parse(text);
    expect(r.id, 'Missing id');
    expect(r.replicaCount === 3, `Expected 3 replicas, got ${r.replicaCount}`);
    expect(r.checksum.length === 64, `Bad checksum length: ${r.checksum.length}`);
    await sleep(2000);
  }));

  // ── Test 6: RF=1 ──
  results.push(await test('Upload with RF=1', async () => {
    const buf = Buffer.alloc(1024 * 1024, 'B');
    const fd = new FormData();
    fd.append('file', new Blob([buf]), 'test-rf1.bin');
    fd.append('name', 'test-rf1.bin');
    fd.append('replicationFactor', '1');
    const res = await fetch(BASE + '/api/objects', { method: 'POST', body: fd });
    expect(res.ok, `RF=1 upload failed: ${res.status}`);
    const r = await res.json();
    expect(r.replicaCount === 1, `Expected 1 replica, got ${r.replicaCount}`);
  }));

  // ── Test 7: RF=2 ──
  results.push(await test('Upload with RF=2', async () => {
    const buf = Buffer.alloc(1024 * 1024, 'C');
    const fd = new FormData();
    fd.append('file', new Blob([buf]), 'test-rf2.bin');
    fd.append('name', 'test-rf2.bin');
    fd.append('replicationFactor', '2');
    const res = await fetch(BASE + '/api/objects', { method: 'POST', body: fd });
    expect(res.ok, `RF=2 upload failed: ${res.status}`);
    const r = await res.json();
    expect(r.replicaCount === 2, `Expected 2 replicas, got ${r.replicaCount}`);
  }));

  // ── Test 8: RF=4 ──
  results.push(await test('Upload with RF=4', async () => {
    const buf = Buffer.alloc(1024 * 1024, 'D');
    const fd = new FormData();
    fd.append('file', new Blob([buf]), 'test-rf4.bin');
    fd.append('name', 'test-rf4.bin');
    fd.append('replicationFactor', '4');
    const res = await fetch(BASE + '/api/objects', { method: 'POST', body: fd });
    expect(res.ok, `RF=4 upload failed: ${res.status}`);
    const r = await res.json();
    expect(r.replicaCount === 4, `Expected 4 replicas, got ${r.replicaCount}`);
  }));

  // ── Test 9: Download matches content ──
  results.push(await test('Download: 5MB file integrity preserved', async () => {
    const objs = await fetchJSON('GET', '/api/objects');
    const obj = objs.objects.find(o => o.name === 'test-5mb.bin');
    expect(obj, 'Object test-5mb.bin not found');
    const dl = await fetch(BASE + '/api/objects/' + obj.id + '/download');
    expect(dl.headers.get('content-type'), 'application/octet-stream');
    expect(dl.headers.get('content-disposition').includes('test-5mb.bin'), 'Wrong filename in Content-Disposition');
    const buf = Buffer.from(await dl.arrayBuffer());
    expect(buf.length === 5 * 1024 ** 2, `Size mismatch: ${buf.length} vs ${5 * 1024 ** 2}`);
    expect(buf.every(b => b === 0x41), 'Content corruption: not all A\'s');
  }));

  // ── Test 10: Verify all objects ──
  results.push(await test('Verify all: all valid after upload', async () => {
    const r = await fetchJSON('POST', '/api/verify-all');
    expect(r.verified >= 4, `Expected ≥4 verified, got ${r.verified}`);
    expect(r.issues === 0, `Expected 0 issues, got ${r.issues}`);
  }));

  // ── Test 11: Node offline ──
  results.push(await test('Node failure: take node-03 offline', async () => {
    const r = await fetchJSON('POST', '/api/nodes', { nodeId: 'node-03', action: 'fail' });
    expect(r.nodes.some(n => n.id === 'node-03' && n.status === 'offline'), 'node-03 not marked offline');
    await sleep(1500);
    const h = await fetchJSON('GET', '/api/cluster');
    expect(h.healthyNodes, 3, `Expected 3 healthy after fail, got ${h.healthyNodes}`);
    expect(h.availability, 75, `Expected 75% after fail, got ${h.availability}%`);
  }));

  // ── Test 12: Download works with one node down ──
  results.push(await test('Download: still works with node-03 offline', async () => {
    const objs = await fetchJSON('GET', '/api/objects');
    const obj = objs.objects.find(o => o.name === 'test-5mb.bin');
    const dl = await fetch(BASE + '/api/objects/' + obj.id + '/download');
    const buf = Buffer.from(await dl.arrayBuffer());
    expect(buf.length === 5 * 1024 ** 2, `Size mismatch after node failure: ${buf.length}`);
    expect(buf.every(b => b === 0x41), 'Content corrupted after node failure');
  }));

  // ── Test 13: Corrupt replica on a node that has the object
  results.push(await test('Corruption: corrupt replica on valid node', async () => {
    const objs = await fetchJSON('GET', '/api/objects');
    const obj = objs.objects.find(o => o.name === 'test-5mb.bin');
    const validReplica = obj.replicas.find(r => r.status === 'valid');
    expect(validReplica, 'No valid replica found');
    // Use the API to corrupt (must go through HTTP so singleton is shared)
    const cr = await nodeAction('corrupt', { nodeId: validReplica.nodeId, objectId: obj.id });
    expect(cr.nodes, 'Corrupt failed via API');
    await sleep(1000);
    // Verify should detect the corruption
    const v = await fetchJSON('POST', '/api/verify-all');
    expect(v.issues > 0, `Expected issues after corruption, got ${v.issues}`);
  }));

  // ── Test 14: Auto-repair fixes corrupted replica
  results.push(await test('Auto-repair: corrupted replica restored', async () => {
    await sleep(8000); // wait for repair cycle (runs every 5s)
    // Bring node-03 back so we can verify zero issues
    await nodeAction('recover', { nodeId: 'node-03' });
    await sleep(3000);
    const v = await fetchJSON('POST', '/api/verify-all');
    expect(v.issues === 0, `Expected 0 issues after repair, got ${v.issues}`);
    // Verify data still downloadable
    const objs = await fetchJSON('GET', '/api/objects');
    const obj = objs.objects.find(o => o.name === 'test-5mb.bin');
    const dl = await fetch(BASE + '/api/objects/' + obj.id + '/download');
    const buf = Buffer.from(await dl.arrayBuffer());
    expect(buf.length === 5 * 1024 ** 2, `Size mismatch after repair: ${buf.length}`);
    expect(buf.every(b => b === 0x41), 'Content not restored after repair');
  }));

  // ── Test 15: Verify cluster is fully healthy after recovery ──
  results.push(await test('Cluster health: all nodes healthy after repair', async () => {
    const h = await fetchJSON('GET', '/api/cluster');
    expect(h.healthyNodes === 4, `Expected 4 healthy, got ${h.healthyNodes}`);
    expect(h.availability === 100, `Expected 100%, got ${h.availability}%`);
  }));

  // ── Test 16: Network partition ──
  results.push(await test('Network partition: node-01 ↔ node-04', async () => {
    const r = await nodeAction('partition', { nodeId: 'node-01', peerId: 'node-04' });
    expect(r.nodes, 'Partition failed');
    await sleep(1000);
    const nodes = await fetchJSON('GET', '/api/nodes');
    const n1 = nodes.nodes.find(n => n.id === 'node-01');
    const n4 = nodes.nodes.find(n => n.id === 'node-04');
    expect(n1.partitions.includes('node-04'), 'Partition not on node-01');
    expect(n4.partitions.includes('node-01'), 'Partition not on node-04');
    // Data still accessible via other paths
    const objs = await fetchJSON('GET', '/api/objects');
    const obj = objs.objects.find(o => o.name === 'test-5mb.bin');
    const validReplicas = obj.replicas.filter(r => r.status === 'valid').length;
    expect(validReplicas >= 2, `Only ${validReplicas} valid replicas after partition`);
  }));

  // ── Test 17: Heal partition ──
  results.push(await test('Heal partition: node-01 ↔ node-04', async () => {
    const r = await nodeAction('heal', { nodeId: 'node-01', peerId: 'node-04' });
    expect(r.nodes, 'Heal failed');
    await sleep(1000);
    const nodes = await fetchJSON('GET', '/api/nodes');
    const n1 = nodes.nodes.find(n => n.id === 'node-01');
    expect(n1.partitions.length === 0, `Partition still present: ${n1.partitions}`);
    const v = await fetchJSON('POST', '/api/verify-all');
    expect(v.issues === 0, `Issues after healing: ${v.issues}`);
  }));

  // ── Test 18: Rebalance ──
  results.push(await test('Rebalance: completes without error', async () => {
    const r = await fetchJSON('POST', '/api/rebalance');
    expect('moved' in r, 'Missing moved field in rebalance response');
    expect(typeof r.moved === 'number', 'Moved should be a number');
  }));

  // ── Test 19: Persistence check ──
  results.push(await test('Persistence: metadata file intact', async () => {
    const metaPath = path.join(process.cwd(), '.vault-meta.json');
    expect(fs.existsSync(metaPath), 'Metadata file missing');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    expect(Object.keys(meta.objects).length >= 3,
      `Expected ≥3 objects in metadata, got ${Object.keys(meta.objects).length}`);
    expect(meta.config.capacityPerNodeBytes === 2 * 1024 ** 3,
      `Capacity not persisted: ${meta.config.capacityPerNodeBytes}`);
  }));

  // ── Test 20: Delete object ──
  results.push(await test('Delete: explicit delete removes object', async () => {
    const objs = await fetchJSON('GET', '/api/objects');
    // Find the first RF=1 object to delete
    const toDel = objs.objects.find(o => o.name === 'test-rf1.bin');
    expect(toDel, 'No RF=1 object to delete');
    const r = await fetchJSON('DELETE', `/api/objects/${toDel.id}`);
    expect(r.success === true, 'Delete returned non-success');
    await sleep(500);
    const after = await fetchJSON('GET', '/api/objects');
    expect(after.objects.every(o => o.id !== toDel.id), 'Object still exists after delete');
  }));

  // ── Test 21: Storage accounting ──
  results.push(await test('Storage: used ≤ capacity on all nodes', async () => {
    const nodes = await fetchJSON('GET', '/api/nodes');
    for (const n of nodes.nodes) {
      expect(n.usedBytes >= 0, `Negative usedBytes on ${n.id}`);
      expect(n.capacityBytes > 0, `Zero capacity on ${n.id}`);
      expect(n.usedBytes <= n.capacityBytes,
        `Used (${n.usedBytes}) exceeds capacity (${n.capacityBytes}) on ${n.id}`);
    }
  }));

  // ── Test 22: No auto-scan — only explicitly uploaded files ──
  results.push(await test('Isolation: only user-uploaded files in storage', async () => {
    const storageRoot = path.join(process.cwd(), 'storage');
    if (!fs.existsSync(storageRoot)) {
      expect(true, 'No storage directory (expected after clean)');
      return;
    }
    const dirs = fs.readdirSync(storageRoot);
    // Should only have node-XX directories
    for (const d of dirs) {
      expect(d.startsWith('node-'), `Unexpected directory in storage: ${d}`);
    }
    // Count .obj files — should match our uploaded objects
    let objCount = 0;
    for (const d of dirs) {
      const ndir = path.join(storageRoot, d);
      if (!fs.existsSync(ndir)) continue;
      const files = fs.readdirSync(ndir);
      objCount += files.filter(f => f.endsWith('.obj')).length;
    }
    const objs = await fetchJSON('GET', '/api/objects');
    // Each object has RF replicas, so total files = sum of all replication factors
    let expectedFiles = 0;
    for (const o of objs.objects) {
      expectedFiles += o.replicas.filter(r => r.status === 'valid').length;
    }
    expect(objCount === expectedFiles,
      `Storage file count (${objCount}) != expected replicas (${expectedFiles})`);
  }));

  // Summary
  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed}/${total} tests passed`);
  if (passed === total) {
    console.log('ALL TESTS PASSED ✅');
  } else {
    console.log(`${total - passed} test(s) FAILED ❌`);
  }
  console.log('='.repeat(50));
  process.exitCode = passed === total ? 0 : 1;
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
