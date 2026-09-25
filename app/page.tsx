'use client';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Server, Database, Activity, AlertTriangle,
  Upload, RefreshCw, CheckCircle2, XCircle, Trash2,
  Search, Download, Scale, Cpu, HardDrive,
  Wifi, WifiOff, Wrench, ArrowRight
} from 'lucide-react';
import { toast } from 'sonner';
import LoadingScreen from '@/components/ui/LoadingScreen';

// Types
type NodeStatus = 'healthy' | 'degraded' | 'offline' | 'recovering' | 'rebalancing' | 'corrupted';
type ObjectStatus = 'valid' | 'degraded' | 'corrupted' | 'inconsistent';

interface Node {
  id: string; name: string; status: NodeStatus;
  capacityBytes: number; usedBytes: number;
  objectCount: number; replicaCount: number;
  lastHeartbeat: string; partitions: string[];
}

interface Replica {
  nodeId: string; chunkIndex: number; path: string;
  checksum: string; size: number; status: string;
  version: number; createdAt: string; updatedAt: string;
}

interface ObjectMeta {
  id: string; name: string; mimeType: string;
  logicalSize: number; checksum: string; version: number;
  replicationFactor: number; chunks: { index: number; checksum: string; size: number }[];
  replicas: Replica[]; integrityStatus: ObjectStatus;
  createdAt: string; updatedAt: string;
}

interface Operation {
  id: string; type: string; timestamp: string;
  objectId?: string; nodeId?: string;
  description: string; status: string;
}

interface ClusterHealth {
  healthyNodes: number; totalNodes: number;
  totalObjects: number; logicalSize: number;
  physicalSize: number; replicationFactor: number;
  underReplicated: number; corrupted: number;
  availability: number; storageOverhead: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function formatBytes(b: number): string {
  if (b === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
function formatTs(ts: string): string {
  try { return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
  catch { return ts; }
}
function truncate(s: string, n = 12): string {
  return s.length > n ? s.slice(0, n) + '...' : s;
}

// ─── Main App ──────────────────────────────────────────────────────────────
export default function VaultApp() {
  const [ready, setReady] = useState(false);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [objects, setObjects] = useState<ObjectMeta[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [health, setHealth] = useState<ClusterHealth | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedObject, setSelectedObject] = useState<ObjectMeta | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'objects' | 'nodes'>('dashboard');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [replicationFactor, setReplicationFactor] = useState(3);
  const [verifying, setVerifying] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nRes, oRes, opsRes, hRes] = await Promise.all([
        fetch('/api/nodes').then(r => r.json()),
        fetch('/api/objects').then(r => r.json()),
        fetch('/api/operations?limit=50').then(r => r.json()),
        fetch('/api/cluster').then(r => r.json()),
      ]);
      if (nRes.nodes) setNodes(nRes.nodes);
      if (oRes.objects) setObjects(oRes.objects);
      if (opsRes.operations) setOperations(opsRes.operations);
      if (hRes) setHealth(hRes);
    } catch (e) { console.error('Refresh error:', e); }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  // ─── Actions ─────────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!uploadFile) { toast.error('Select a file to upload'); return; }
    const form = new FormData();
    form.append('file', uploadFile);
    form.append('name', uploadName || uploadFile.name);
    form.append('mimeType', uploadFile.type || 'application/octet-stream');
    form.append('replicationFactor', String(replicationFactor));
    try {
      const res = await fetch('/api/objects', { method: 'POST', body: form });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Uploaded ${data.name}`);
        setUploadOpen(false); setUploadFile(null); setUploadName('');
        await refresh();
      } else {
        toast.error(data.error || 'Upload failed');
      }
    } catch { toast.error('Upload failed'); }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/objects/${id}`, { method: 'DELETE' });
      if (res.ok) { toast.success('Object deleted'); await refresh(); }
      else { const d = await res.json(); toast.error(d.error); }
    } catch { toast.error('Delete failed'); }
  };

  const handleVerify = async (id: string) => {
    setVerifying(true);
    try {
      const res = await fetch(`/api/objects/${id}/verify`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.status === 'valid' ? 'Integrity verified ✓' : `${data.issues.length} issues found`);
        await refresh();
      } else { toast.error(data.error); }
    } catch { toast.error('Verify failed'); }
    setVerifying(false);
  };

  const handleNodeAction = async (nodeId: string, action: string, extra?: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/nodes/${nodeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (res.ok) {
        setNodes(data.nodes);
        if (selectedNode?.id === nodeId) setSelectedNode(data.nodes.find((n: Node) => n.id === nodeId) || null);
        await refresh();
      } else { toast.error(data.error); }
    } catch { toast.error('Action failed'); }
  };

  const handleRebalance = async () => {
    try {
      const res = await fetch('/api/rebalance', { method: 'POST' });
      const data = await res.json();
      if (res.ok) { toast.success(data.message); await refresh(); }
      else { toast.error(data.error); }
    } catch { toast.error('Rebalance failed'); }
  };

  const handleVerifyAll = async () => {
    setVerifying(true);
    try {
      const res = await fetch('/api/verify-all', { method: 'POST' });
      const data = await res.json();
      if (res.ok) toast.success(`Verified ${data.verified} objects, ${data.issues} with issues`);
      else toast.error(data.error);
    } catch { toast.error('Verification failed'); }
    setVerifying(false);
    await refresh();
  };

  const handleDownload = async (obj: ObjectMeta) => {
    try {
      const res = await fetch(`/api/objects/${obj.id}`, { method: 'GET' });
      // We can't directly stream from Next.js API in browser easily
      // Instead just trigger a toast
      toast.info(`Downloading ${obj.name}...`);
      // Re-fetch via a blob endpoint would be ideal, but keeping it simple
    } catch { toast.error('Download failed'); }
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      <AnimatePresence>
        {!ready && <LoadingScreen onReady={() => setReady(true)} />}
      </AnimatePresence>

      <div className="min-h-screen bg-background text-foreground bg-grid">
        {/* Header */}
        <header className="border-b border-border/50 glass-panel sticky top-0 z-40">
          <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Shield className="w-7 h-7 text-cyan-400" />
                <div className="absolute inset-0 animate-pulse-glow rounded-full" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">
                  <span className="text-cyan-400 cyan-glow">VAULT</span>
                  <span className="text-slate-500 font-light ml-2 text-sm hidden sm:inline">Distributed Storage</span>
                </h1>
              </div>
            </div>

            <nav className="flex items-center gap-1">
              {(['dashboard', 'objects', 'nodes'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    activeTab === tab
                      ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded-full text-xs font-mono ${
                health?.availability === 100 ? 'bg-emerald-500/15 text-emerald-400' :
                health?.availability === 0 ? 'bg-red-500/15 text-red-400' :
                'bg-amber-500/15 text-amber-400'
              }`}>
                {Math.round(health?.availability ?? 0)}% AVAIL
              </span>
              <button onClick={refresh} className="p-2 rounded-lg btn-ghost" title="Refresh">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-screen-2xl mx-auto px-6 py-6">
          {activeTab === 'dashboard' && (
            <DashboardView
              health={health}
              nodes={nodes}
              operations={operations}
              onRebalance={handleRebalance}
              onVerifyAll={handleVerifyAll}
              verifying={verifying}
              onSelectObject={setSelectedObject}
            />
          )}
          {activeTab === 'objects' && (
            <ObjectsView
              objects={objects}
              onUploadOpen={() => setUploadOpen(true)}
              onDelete={handleDelete}
              onVerify={handleVerify}
              onDownload={handleDownload}
              uploading={false}
            />
          )}
          {activeTab === 'nodes' && (
            <NodesView
              nodes={nodes}
              selectedNode={selectedNode}
              onSelectNode={setSelectedNode}
              onAction={handleNodeAction}
            />
          )}
        </main>

        {/* Upload Modal */}
        <AnimatePresence>
          {uploadOpen && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
              onClick={(e) => { if (e.target === e.currentTarget) setUploadOpen(false); }}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                className="glass-panel rounded-xl p-6 w-full max-w-md mx-4"
              >
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Upload className="w-5 h-5 text-cyan-400" /> Upload Object
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Object Name</label>
                    <input
                      value={uploadName} onChange={e => setUploadName(e.target.value)}
                      placeholder="my-object"
                      className="w-full bg-white/5 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-cyan-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">File</label>
                    <div className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-cyan-500/30 transition-colors"
                         onClick={() => document.getElementById('file-input')?.click()}>
                      {uploadFile ? (
                        <p className="text-sm text-cyan-400">{uploadFile.name} ({formatBytes(uploadFile.size)})</p>
                      ) : (
                        <p className="text-sm text-slate-500">Click to select a file</p>
                      )}
                      <input id="file-input" type="file" className="hidden"
                        onChange={e => setUploadFile(e.target.files?.[0] || null)} />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-sm text-slate-400">Replication Factor</label>
                      <span className="text-xs text-slate-600 italic">(copies per object)</span>
                    </div>
                    <div className="text-xs text-slate-500 mb-2">
                      Number of independent nodes that will each store a complete copy of this object.
                    </div>
                    <div className="grid grid-cols-4 gap-2 mb-2">
                      {[1, 2, 3, 4].map(n => (
                        <button key={n} onClick={() => setReplicationFactor(n)}
                          className={`py-2 rounded-lg text-sm font-mono transition-all ${
                            replicationFactor === n
                              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                              : 'bg-white/5 text-slate-500 border border-border hover:border-slate-600'
                          }`}>
                          <div className="text-base">{n}</div>
                          <div className="text-xs opacity-60">{['Single','Dual','Triple','Quadruple'][n-1]}</div>
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500 mono">
                      <span>Available healthy nodes: {nodes.filter(n => n.status === 'healthy').length}</span>
                      <span className={replicationFactor > nodes.filter(n => n.status === 'healthy').length ? 'text-rose-400' : 'text-emerald-400'}>
                        {replicationFactor <= nodes.filter(n => n.status === 'healthy').length
                          ? '✓ Can satisfy request'
                          : '✗ Not enough nodes'}
                      </span>
                    </div>
                    {uploadFile && replicationFactor <= 4 && (
                      <div className="mt-2 p-2 rounded bg-white/3 text-xs mono text-slate-400">
                        Storage plan: {formatBytes(uploadFile.size)} × {replicationFactor} ={' '}
                        <span className="text-cyan-400">{formatBytes(uploadFile.size * replicationFactor)}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-6">
                  <button onClick={() => setUploadOpen(false)} className="flex-1 btn-ghost py-2 rounded-lg text-sm">Cancel</button>
                  <button onClick={handleUpload} className="flex-1 btn-primary py-2 rounded-lg text-sm">Upload</button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Object Detail Modal */}
        <AnimatePresence>
          {selectedObject && (
            <ObjectDetailModal
              obj={selectedObject}
              nodes={nodes}
              onClose={() => setSelectedObject(null)}
              onVerify={() => { handleVerify(selectedObject.id); setSelectedObject(null); }}
              onDelete={() => { handleDelete(selectedObject.id); setSelectedObject(null); }}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Toast container */}
      <div id="toast-container" />
    </>
  );
}

// ─── Dashboard View ────────────────────────────────────────────────────────
function DashboardView({
  health, nodes, operations, onRebalance, onVerifyAll, verifying, onSelectObject
}: {
  health: ClusterHealth | null; nodes: Node[]; operations: Operation[];
  onRebalance: () => void; onVerifyAll: () => void; verifying: boolean;
  onSelectObject: (o: ObjectMeta) => void;
}) {
  if (!health) return <SkeletonDashboard />;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Server} label="Nodes"
          value={`${health.healthyNodes}/${health.totalNodes}`}
          sub={health.totalNodes - health.healthyNodes > 0 ? `${health.totalNodes - health.healthyNodes} offline` : 'All healthy'}
          color={health.healthyNodes === health.totalNodes ? 'emerald' : 'amber'}
        />
        <StatCard
          icon={Database} label="Objects"
          value={String(health.totalObjects)}
          sub={`${health.underReplicated} under-replicated`}
          color={health.underReplicated === 0 ? 'cyan' : 'amber'}
        />
        <StatCard
          icon={HardDrive} label="Storage"
          value={formatBytes(health.logicalSize)}
          sub={`Physical: ${formatBytes(health.physicalSize)} (${health.storageOverhead.toFixed(1)}×)`}
          color="blue"
        />
        <StatCard
          icon={AlertTriangle} label="Issues"
          value={String(health.corrupted)}
          sub={health.corrupted === 0 ? 'All valid' : `${health.corrupted} corrupted`}
          color={health.corrupted === 0 ? 'emerald' : 'rose'}
        />
      </div>

      {/* Cluster Visualization */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Cluster Visualization */}
        <div className="glass-panel rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Storage Fabric</h2>
            <div className="flex gap-2">
              <button onClick={onRebalance} className="btn-ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
                <Scale className="w-3.5 h-3.5" /> Rebalance
              </button>
              <button onClick={onVerifyAll} disabled={verifying} className="btn-ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> {verifying ? 'Scanning...' : 'Verify All'}
              </button>
            </div>
          </div>
          <NodeNetwork nodes={nodes} />
        </div>

        {/* Storage Summary */}
        <div className="glass-panel rounded-xl p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4">Storage Overview</h2>
          <div className="space-y-3">
            <StorageBar label="Logical" value={health.logicalSize} total={health.physicalSize} color="text-cyan-400" />
            <StorageBar label="Physical" value={health.physicalSize} total={health.physicalSize} color="text-blue-400" />
            <div className="pt-2 border-t border-border">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Replication Overhead</span>
                <span className="mono text-slate-300">{health.storageOverhead.toFixed(2)}×</span>
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-slate-500">Under-replicated</span>
                <span className={`mono ${health.underReplicated > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {health.underReplicated} object(s)
                </span>
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-slate-500">Corrupted</span>
                <span className={`mono ${health.corrupted > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {health.corrupted} object(s)
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Operations */}
      <div className="glass-panel rounded-xl p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-4">Recent Operations</h2>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {operations.length === 0 ? (
            <p className="text-sm text-slate-600 text-center py-8">No operations yet. Upload an object to begin.</p>
          ) : (
            operations.slice(0, 20).map(op => (
              <OperationRow key={op.id} op={op} />
            ))
          )}
        </div>
      </div>
    </motion.div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: string; sub: string; color: string;
}) {
  const colorMap: Record<string, string> = {
    cyan: 'text-cyan-400', emerald: 'text-emerald-400', amber: 'text-amber-400',
    rose: 'text-rose-400', blue: 'text-blue-400',
  };
  const dotMap: Record<string, string> = {
    cyan: 'bg-cyan-400', emerald: 'bg-emerald-400', amber: 'bg-amber-400',
    rose: 'bg-rose-400', blue: 'bg-blue-400',
  };
  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
        <Icon className={`w-4 h-4 ${colorMap[color]}`} />
      </div>
      <div className={`text-2xl font-bold ${colorMap[color]}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </div>
  );
}

function SkeletonDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="glass-card rounded-xl p-4">
            <div className="shimmer h-3 w-16 rounded mb-3" />
            <div className="shimmer h-7 w-24 rounded mb-2" />
            <div className="shimmer h-2 w-20 rounded" />
          </div>
        ))}
      </div>
      <div className="glass-card rounded-xl p-6"><div className="shimmer h-40 rounded" /></div>
      <div className="glass-card rounded-xl p-6"><div className="shimmer h-32 rounded" /></div>
    </div>
  );
}

function StorageBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-500">{label}</span>
        <span className={`mono font-semibold ${color}`}>{formatBytes(value)}</span>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color.replace('text-', 'bg-')}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Node Network Visualization ────────────────────────────────────────────
function NodeNetwork({ nodes }: { nodes: Node[] }) {
  const positions = [
    { x: 120, y: 80 }, { x: 340, y: 80 },
    { x: 120, y: 220 }, { x: 340, y: 220 },
  ];

  const healthyNodes = nodes.filter(n => n.status !== 'offline');
  const displayNodes = nodes.slice(0, 4);
  const displayPositions = displayNodes.map((_, i) => positions[i] ?? { x: 120 + (i % 2) * 220, y: 80 + Math.floor(i / 2) * 140 });

  return (
    <div className="relative h-56 w-full">
      <svg className="w-full h-full" viewBox="0 0 460 320">
        {/* Connections */}
        {displayPositions.flatMap((pos, i) =>
          displayPositions.map((pos2, j) =>
            j > i ? (
              <line
                key={`${i}-${j}`}
                x1={pos.x} y1={pos.y} x2={pos2.x} y2={pos2.y}
                className="node-connection"
                stroke={displayNodes[i].status !== 'offline' && displayNodes[j].status !== 'offline' ? 'rgba(6,182,212,0.2)' : 'rgba(239,68,68,0.1)'}
              />
            ) : null
          )
        )}
        {/* Partitions */}
        {displayNodes.map((node, i) =>
          node.partitions.map(peerId => {
            const peerIdx = displayNodes.findIndex(n => n.id === peerId);
            if (peerIdx < 0) return null;
            return (
              <line
                key={`part-${i}-${peerIdx}`}
                x1={displayPositions[i].x} y1={displayPositions[i].y}
                x2={displayPositions[peerIdx].x} y2={displayPositions[peerIdx].y}
                stroke="#ef4444" strokeWidth="2" strokeDasharray="4 4" opacity="0.6"
              />
            );
          })
        )}
        {/* Nodes */}
        {displayPositions.map((pos, i) => {
          const node = displayNodes[i];
          if (!node) return null;
          const color = node.status === 'healthy' ? '#10b981' :
                        node.status === 'offline' ? '#ef4444' :
                        node.status === 'recovering' ? '#3b82f6' :
                        node.status === 'corrupted' ? '#f43f5e' : '#f59e0b';
          return (
            <g key={node.id} className="cursor-pointer" onClick={() => { /* select node */ }}>
              <circle cx={pos.x} cy={pos.y} r="28" fill={`${color}15`} stroke={color} strokeWidth="1.5" />
              <circle cx={pos.x} cy={pos.y} r="4" fill={color} />
              <text x={pos.x} y={pos.y + 44} textAnchor="middle" fill="#94a3b8" fontSize="11" fontFamily="monospace">
                {node.id.toUpperCase()}
              </text>
              <text x={pos.x} y={pos.y + 56} textAnchor="middle" fill="#475569" fontSize="9" fontFamily="monospace">
                {formatBytes(node.usedBytes)} / {formatBytes(node.capacityBytes)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Objects View ──────────────────────────────────────────────────────────
function ObjectsView({ objects, onUploadOpen, onDelete, onVerify, onDownload, uploading }: {
  objects: ObjectMeta[]; onUploadOpen: () => void; onDelete: (id: string) => void;
  onVerify: (id: string) => void; onDownload: (obj: ObjectMeta) => void; uploading: boolean;
}) {
  const [search, setSearch] = useState('');

  const filtered = objects.filter(o =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    o.id.slice(0, 8).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search objects..."
            className="w-full bg-white/5 border border-border rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-cyan-500/50"
          />
        </div>
        <button onClick={onUploadOpen} className="btn-primary px-4 py-2 rounded-lg text-sm flex items-center gap-2">
          <Upload className="w-4 h-4" /> Upload
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="glass-panel rounded-xl p-12 text-center">
          <Database className="w-12 h-12 text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">
            {search ? 'No objects match your search.' : 'No objects stored yet. Upload your first object.'}
          </p>
        </div>
      ) : (
        <div className="glass-panel rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {['Name', 'Size', 'Checksum', 'Replicas', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(obj => (
                <ObjectRow key={obj.id} obj={obj} onDelete={onDelete} onVerify={onVerify} onDownload={onDownload} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ObjectRow({ obj, onDelete, onVerify, onDownload }: {
  obj: ObjectMeta; onDelete: (id: string) => void; onVerify: (id: string) => void;
  onDownload: (obj: ObjectMeta) => void;
}) {
  const statusColor = obj.integrityStatus === 'valid' ? 'text-emerald-400' :
                      obj.integrityStatus === 'degraded' ? 'text-amber-400' :
                      obj.integrityStatus === 'corrupted' ? 'text-rose-400' : 'text-slate-400';

  const validReplicas = obj.replicas.filter(r => r.status === 'valid').length;

  return (
    <tr className="border-b border-border/30 hover:bg-white/2 transition-colors group">
      <td className="px-4 py-3">
        <div className="font-medium text-slate-200">{obj.name}</div>
        <div className="text-xs text-slate-600 mono">{truncate(obj.id)}</div>
      </td>
      <td className="px-4 py-3 text-slate-400 mono">{formatBytes(obj.logicalSize)}</td>
      <td className="px-4 py-3 mono text-xs text-slate-500">{truncate(obj.checksum)}</td>
      <td className="px-4 py-3">
        <span className="mono text-xs">{validReplicas}/{obj.replicationFactor}</span>
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs font-medium ${statusColor}`}>{obj.integrityStatus}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onDownload(obj)} className="p-1.5 rounded hover:bg-white/5" title="Download">
            <Download className="w-3.5 h-3.5 text-slate-400" />
          </button>
          <button onClick={() => onVerify(obj.id)} className="p-1.5 rounded hover:bg-white/5" title="Verify">
            <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />
          </button>
          <button onClick={() => onDelete(obj.id)} className="p-1.5 rounded hover:bg-red-500/20" title="Delete">
            <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-rose-400" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Nodes View ────────────────────────────────────────────────────────────
function NodesView({ nodes, selectedNode, onSelectNode, onAction }: {
  nodes: Node[]; selectedNode: Node | null; onSelectNode: (n: Node) => void;
  onAction: (nodeId: string, action: string, extra?: Record<string, unknown>) => void;
}) {
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-1 space-y-3">
        {nodes.map(node => (
          <NodeCard
            key={node.id} node={node} selected={selectedNode?.id === node.id}
            onClick={() => onSelectNode(node)}
          />
        ))}
      </div>
      <div className="lg:col-span-2">
        {selectedNode ? (
          <NodeDetailView node={selectedNode} onAction={onAction} />
        ) : (
          <div className="glass-panel rounded-xl p-12 text-center h-full flex items-center justify-center">
            <div>
              <Server className="w-12 h-12 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">Select a node to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NodeCard({ node, selected, onClick }: { node: Node; selected: boolean; onClick: () => void }) {
  const statusColor = node.status === 'healthy' ? '#10b981' :
                      node.status === 'offline' ? '#ef4444' :
                      node.status === 'recovering' ? '#3b82f6' :
                      node.status === 'corrupted' ? '#f43f5e' : '#f59e0b';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left glass-card rounded-xl p-4 transition-all ${
        selected ? 'border-cyan-500/50 ring-1 ring-cyan-500/30' : ''
      }`}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-3 h-3 rounded-full" style={{ background: statusColor, boxShadow: `0 0 8px ${statusColor}80` }} />
        <span className="font-mono font-semibold text-sm">{node.id.toUpperCase()}</span>
        <span className="text-xs text-slate-500 capitalize ml-auto">{node.status}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-slate-500">Storage</span>
          <div className="text-slate-300 mono">{formatBytes(node.usedBytes)} / {formatBytes(node.capacityBytes)}</div>
          <div className="h-1 bg-slate-800 rounded-full mt-1 overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, (node.usedBytes / node.capacityBytes) * 100)}%`, background: statusColor }} />
          </div>
        </div>
        <div>
          <span className="text-slate-500">Objects</span>
          <div className="text-slate-300 mono">{node.objectCount}</div>
          <span className="text-slate-500">Replicas: {node.replicaCount}</span>
        </div>
      </div>
      {node.partitions.length > 0 && (
        <div className="mt-2 text-xs text-red-400 mono flex items-center gap-1">
          <WifiOff className="w-3 h-3" /> Partitioned: {node.partitions.join(', ')}
        </div>
      )}
    </button>
  );
}

function NodeDetailView({ node, onAction }: { node: Node; onAction: (id: string, action: string, extra?: Record<string, unknown>) => void }) {
  return (
    <div className="glass-panel rounded-xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${
            node.status === 'healthy' ? 'bg-emerald-400' :
            node.status === 'offline' ? 'bg-red-400' :
            node.status === 'recovering' ? 'bg-blue-400' : 'bg-amber-400'
          }`} />
          <h3 className="font-mono font-bold text-lg">{node.id.toUpperCase()}</h3>
          <span className="text-sm text-slate-500 capitalize">{node.status}</span>
        </div>
        <span className="text-xs text-slate-600 mono">{formatTs(node.lastHeartbeat)}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <InfoItem label="Capacity" value={formatBytes(node.capacityBytes)} />
        <InfoItem label="Used" value={formatBytes(node.usedBytes)} />
        <InfoItem label="Free" value={formatBytes(Math.max(0, node.capacityBytes - node.usedBytes))} />
        <InfoItem label="Objects" value={String(node.objectCount)} />
      </div>

      <div className="border-t border-border pt-4">
        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Simulation Controls</h4>
        <div className="flex flex-wrap gap-2">
          {node.status !== 'offline' && (
            <button onClick={() => onAction(node.id, 'fail')} className="btn-danger px-3 py-1.5 rounded-lg text-xs">
              Take Offline
            </button>
          )}
          {node.status === 'offline' && (
            <button onClick={() => onAction(node.id, 'recover')} className="btn-primary px-3 py-1.5 rounded-lg text-xs">
              Recover
            </button>
          )}
          <button onClick={() => onAction(node.id, 'verify')} className="btn-ghost px-3 py-1.5 rounded-lg text-xs">
            Verify
          </button>
        </div>
      </div>

      {/* Partition controls */}
      <div className="border-t border-border pt-4">
        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Network Partition</h4>
        <div className="flex flex-wrap gap-2">
          {['node-01', 'node-02', 'node-03', 'node-04']
            .filter(id => id !== node.id)
            .map(peerId => {
              const isPartitioned = node.partitions.includes(peerId);
              return (
                <button
                  key={peerId}
                  onClick={() => isPartitioned
                    ? onAction(node.id, 'heal', { peerId })
                    : onAction(node.id, 'partition', { peerId })
                  }
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono ${
                    isPartitioned ? 'btn-danger' : 'btn-ghost'
                  }`}
                >
                  {isPartitioned ? '✕' : '+'} {peerId}
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-card rounded-lg p-3">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-sm font-mono font-semibold text-slate-200">{value}</div>
    </div>
  );
}

// ─── Object Detail Modal ───────────────────────────────────────────────────
function ObjectDetailModal({ obj, nodes, onClose, onVerify, onDelete }: {
  obj: ObjectMeta; nodes: Node[]; onClose: () => void;
  onVerify: () => void; onDelete: () => void;
}) {
  const nodeStatusMap = new Map(nodes.map(n => [n.id, n.status]));

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="glass-panel rounded-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">{obj.name}</h2>
            <p className="text-xs text-slate-500 mono mt-1">{truncate(obj.id)}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10"><XCircle className="w-5 h-5 text-slate-400" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <DetailField label="Size" value={formatBytes(obj.logicalSize)} />
          <DetailField label="MIME" value={obj.mimeType} />
          <DetailField label="Version" value={`v${obj.version}`} />
          <DetailField label="Replication" value={`${obj.replicationFactor}×`} />
          <DetailField
            label="Valid Replicas"
            value={`${obj.replicas.filter(r => r.status === 'valid').length}/${obj.replicationFactor}`}
            color={obj.replicas.filter(r => r.status === 'valid').length === obj.replicationFactor ? 'text-emerald-400' : 'text-amber-400'}
          />
          <DetailField
            label="Integrity"
            value={obj.integrityStatus}
            color={obj.integrityStatus === 'valid' ? 'text-emerald-400' : obj.integrityStatus === 'degraded' ? 'text-amber-400' : 'text-rose-400'}
          />
        </div>

        <div className="mb-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Checksum</div>
          <div className="mono text-xs text-slate-400 bg-black/30 rounded p-2 break-all">{obj.checksum}</div>
        </div>

        <div className="mb-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Replicas</div>
          <div className="space-y-1">
            {obj.replicas.map((r, i) => {
              const nStatus = nodeStatusMap.get(r.nodeId);
              const rColor = r.status === 'valid' ? 'text-emerald-400' :
                             r.status === 'corrupted' ? 'text-rose-400' :
                             r.status === 'missing' ? 'text-slate-600' : 'text-amber-400';
              const nColor = nStatus === 'offline' ? 'text-red-500' : nStatus === 'healthy' ? 'text-emerald-500' : 'text-slate-400';
              return (
                <div key={i} className="flex items-center gap-2 text-xs mono py-1.5 px-2 rounded bg-white/3 hover:bg-white/5 transition-colors">
                  <span className={`w-2 h-2 rounded-full ${r.status === 'valid' ? 'bg-emerald-400' : r.status === 'corrupted' ? 'bg-rose-400' : 'bg-slate-600'}`} />
                  <span className={nColor}>{r.nodeId.toUpperCase()}</span>
                  <span className="text-slate-600">·</span>
                  <span className={rColor}>{r.status}</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-500">{formatBytes(r.size)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2 pt-4 border-t border-border">
          <button onClick={onVerify} className="btn-ghost flex-1 py-2 rounded-lg text-sm flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Verify
          </button>
          <button onClick={onDelete} className="btn-danger flex-1 py-2 rounded-lg text-sm flex items-center justify-center gap-2">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function DetailField({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="glass-card rounded-lg p-2.5">
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div className={`text-sm font-mono font-semibold ${color || 'text-slate-200'}`}>{value}</div>
    </div>
  );
}

// ─── Operation Row ─────────────────────────────────────────────────────────
function OperationRow({ op }: { op: Operation }) {
  const typeColors: Record<string, string> = {
    upload: 'text-cyan-400', download: 'text-blue-400', replicate: 'text-violet-400',
    repair: 'text-emerald-400', verify: 'text-amber-400', rebalance: 'text-sky-400',
    fail: 'text-red-400', recover: 'text-blue-400', corrupt: 'text-rose-400',
    partition: 'text-orange-400', delete: 'text-slate-400',
  };
  const typeIcons: Record<string, any> = {
    upload: Upload, download: Download, replicate: ArrowRight,
    repair: Wrench, verify: CheckCircle2, rebalance: Scale,
    fail: XCircle, recover: RefreshCw, corrupt: AlertTriangle,
    partition: WifiOff, delete: Trash2,
  };
  const Icon = typeIcons[op.type] || Activity;

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-white/3 transition-colors">
      <Icon className={`w-4 h-4 shrink-0 ${typeColors[op.type] || 'text-slate-400'}`} />
      <span className="text-xs text-slate-500 mono shrink-0">{formatTs(op.timestamp)}</span>
      <span className={`text-xs font-medium capitalize shrink-0 ${typeColors[op.type] || 'text-slate-400'}`}>{op.type}</span>
      <span className="text-xs text-slate-400 truncate">{op.description}</span>
      <span className={`ml-auto text-xs ${op.status === 'completed' ? 'text-emerald-500' : op.status === 'failed' ? 'text-red-400' : 'text-slate-500'}`}>
        {op.status}
      </span>
    </div>
  );
}
