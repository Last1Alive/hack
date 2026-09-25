'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Server, Database, Activity, AlertTriangle,
  Upload, RefreshCw, CheckCircle2, XCircle, Trash2,
  Search, Download, Scale, Cpu, HardDrive,
  Wifi, WifiOff, Wrench, ArrowRight,
  Scan, Network,
} from 'lucide-react';
import { toast } from 'sonner';
import LoadingScreen from '@/components/ui/LoadingScreen';

// ─── Types ────────────────────────────────────────────────────────────────────
type NodeStatus = 'healthy' | 'degraded' | 'offline' | 'recovering' | 'rebalancing' | 'corrupted';
type ObjectStatus = 'valid' | 'degraded' | 'corrupted' | 'inconsistent';

interface Node {
  id: string; name: string; status: NodeStatus;
  capacityBytes: number; usedBytes: number;
  objectCount: number; replicaCount: number;
  lastHeartbeat: string; partitions: string[];
}

interface Replica {
  nodeId: string; path: string;
  checksum: string; size: number; status: string;
  version: number; createdAt: string; updatedAt: string;
}

interface ObjectMeta {
  id: string; name: string; mimeType: string;
  logicalSize: number; checksum: string; version: number;
  replicationFactor: number; replicas: Replica[]; integrityStatus: ObjectStatus;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
function truncate(s: string, n = 10): string {
  return s.length > n ? s.slice(0, n) + '···' : s;
}
function statusLabel(s: NodeStatus | string): string {
  const map: Record<string, string> = {
    healthy: 'OPERATIONAL', degraded: 'DEGRADED', offline: 'OFFLINE',
    recovering: 'RECOVERING', rebalancing: 'REBALANCING', corrupted: 'CORRUPTED',
  };
  return map[s] ?? s.toUpperCase();
}
function nodeStatusColor(s: NodeStatus): string {
  const map: Record<NodeStatus, string> = {
    healthy: '#10b981', degraded: '#f59e0b', offline: '#ef4444',
    recovering: '#3b82f6', rebalancing: '#06b6d4', corrupted: '#f43f5e',
  };
  return map[s] ?? '#64748b';
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
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

  // ─── Actions ────────────────────────────────────────────────────────────────
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
      } else { toast.error(data.error || 'Upload failed'); }
    } catch { toast.error('Upload failed'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this object? All replicas will be permanently removed.')) return;
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
      const res = await fetch(`/api/objects/${obj.id}/download`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Download failed'); return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = obj.name;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${obj.name}`);
    } catch { toast.error('Download failed'); }
  };

  const handleFabricNodeClick = useCallback((nodeId: string) => {
    setActiveTab('nodes');
    const node = nodes.find(n => n.id === nodeId);
    if (node) setSelectedNode(node);
  }, [nodes]);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <AnimatePresence>
        {!ready && <LoadingScreen onReady={() => setReady(true)} />}
      </AnimatePresence>

      {/* App content — only mounts AFTER loading screen has finished its exit animation */}
      {!ready && <div className="fixed inset-0 bg-[#050a14] z-[199]" aria-hidden="true" />}
      {ready && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
        className="min-h-screen relative"
      >
        {/* Header */}
        <PremiumHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          health={health}
          onRefresh={refresh}
        />

        {/* Page content with transition */}
        <main className="max-w-screen-2xl mx-auto px-6 py-6 relative z-10">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <DashboardView
                  health={health} nodes={nodes} operations={operations}
                  onRebalance={handleRebalance} onVerifyAll={handleVerifyAll}
                  verifying={verifying} onSelectObject={setSelectedObject}
                  onFabricNodeClick={handleFabricNodeClick}
                />
              </motion.div>
            )}
            {activeTab === 'objects' && (
              <motion.div
                key="objects"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <ObjectsView
                  objects={objects}
                  onUploadOpen={() => setUploadOpen(true)}
                  onDelete={handleDelete}
                  onVerify={handleVerify}
                  onDownload={handleDownload}
                  onSelect={setSelectedObject}
                />
              </motion.div>
            )}
            {activeTab === 'nodes' && (
              <motion.div
                key="nodes"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <NodesView
                  nodes={nodes} selectedNode={selectedNode}
                  onSelectNode={setSelectedNode} onAction={handleNodeAction}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Upload Modal */}
        <AnimatePresence>
          {uploadOpen && (
            <UploadModal
              uploadName={uploadName} setUploadName={setUploadName}
              uploadFile={uploadFile} setUploadFile={setUploadFile}
              replicationFactor={replicationFactor} setReplicationFactor={setReplicationFactor}
              healthyCount={nodes.filter(n => n.status === 'healthy').length}
              onUpload={handleUpload} onClose={() => setUploadOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* Object Detail Modal */}
        <AnimatePresence>
          {selectedObject && (
            <ObjectDetailModal
              obj={selectedObject} nodes={nodes}
              onClose={() => setSelectedObject(null)}
              onVerify={() => { handleVerify(selectedObject.id); setSelectedObject(null); }}
              onDelete={() => { handleDelete(selectedObject.id); setSelectedObject(null); }}
            />
          )}
        </AnimatePresence>
      </motion.div>
      )}

      <div id="toast-container" />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEADER
// ═══════════════════════════════════════════════════════════════════════════════

function PremiumHeader({
  activeTab, setActiveTab, health, onRefresh,
}: {
  activeTab: string;
  setActiveTab: (t: 'dashboard' | 'objects' | 'nodes') => void;
  health: ClusterHealth | null;
  onRefresh: () => void;
}) {
  const tabs: { key: 'dashboard' | 'objects' | 'nodes'; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'objects',   label: 'Objects' },
    { key: 'nodes',     label: 'Nodes' },
  ];
  const tabIdx = tabs.findIndex(t => t.key === activeTab);

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06]">
      <div className="glass-panel !rounded-none !border-l-0 !border-r-0 !border-t-0 !shadow-none">
        <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Shield className="w-5 h-5 text-vault-cyan/70" strokeWidth={1.5} />
              <div className="absolute inset-0 animate-pulse-glow rounded-full opacity-30" />
            </div>
            <span className="vault-title text-lg tracking-tight">VAULT</span>
            <span className="hidden sm:inline text-[10px] text-slate-500 tracking-[0.2em] uppercase font-medium border-l border-white/10 pl-3">
              Fabric
            </span>
          </div>

          {/* Nav */}
          <nav className="relative flex items-center gap-1 bg-white/[0.02] rounded-full px-1 py-1 border border-white/[0.06]">
            <motion.div
              className="absolute top-1 bottom-1 rounded-full bg-white/[0.07] border border-white/[0.1]"
              style={{ width: 'calc(33.33% - 4px)' }}
              animate={{ left: `calc(${tabIdx * 33.33}% + 4px)` }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative z-10 px-5 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  activeTab === tab.key ? 'text-slate-100' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Right */}
          <div className="flex items-center gap-3">
            <span className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-semibold ${
              health?.availability === 100
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : health?.availability === 0
                ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full animate-breath ${
                health?.availability === 100 ? 'bg-emerald-400' : health?.availability === 0 ? 'bg-red-400' : 'bg-amber-400'
              }`} />
              {Math.round(health?.availability ?? 0)}%
            </span>
            <button onClick={onRefresh} className="p-2 rounded-full btn-ghost hover:bg-white/[0.05]" title="Refresh">
              <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD VIEW
// ═══════════════════════════════════════════════════════════════════════════════

function DashboardView({
  health, nodes, operations, onRebalance, onVerifyAll, verifying,
  onSelectObject, onFabricNodeClick,
}: {
  health: ClusterHealth | null; nodes: Node[]; operations: Operation[];
  onRebalance: () => void; onVerifyAll: () => void; verifying: boolean;
  onSelectObject: (o: ObjectMeta) => void;
  onFabricNodeClick: (id: string) => void;
}) {
  if (!health) return <SkeletonDashboard />;

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          icon={Server} label="NODES"
          value={`${health.healthyNodes}/${health.totalNodes}`}
          sub={health.totalNodes - health.healthyNodes > 0
            ? `${health.totalNodes - health.healthyNodes} offline`
            : 'All operational'}
          color="#10b981" glowColor="rgba(16,185,129,"
        />
        <KPICard
          icon={Database} label="OBJECTS"
          value={String(health.totalObjects)}
          sub={`${health.underReplicated} under-replicated`}
          color="#06b6d4" glowColor="rgba(6,182,212,"
        />
        <KPICard
          icon={HardDrive} label="STORAGE"
          value={formatBytes(health.logicalSize)}
          sub={`Physical ${formatBytes(health.physicalSize)} · ${health.storageOverhead.toFixed(1)}×`}
          color="#3b82f6" glowColor="rgba(59,130,246,"
        />
        <KPICard
          icon={AlertTriangle} label="ISSUES"
          value={String(health.corrupted)}
          sub={health.corrupted === 0 ? 'Integrity nominal' : `${health.corrupted} corrupted`}
          color={health.corrupted === 0 ? '#10b981' : '#f43f5e'}
          glowColor={health.corrupted === 0 ? 'rgba(16,185,129,' : 'rgba(244,63,94,'}
        />
      </div>

      {/* Hero: Storage Fabric */}
      <div className="glass-panel rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="section-label mb-1">Storage Fabric</div>
            <h2 className="text-base font-semibold text-slate-200 tracking-wide">Live Topology</h2>
          </div>
          <div className="flex gap-2">
            <FabBtn icon={Scale} label="Rebalance" onClick={onRebalance} />
            <FabBtn icon={Scan} label={verifying ? 'Scanning…' : 'Verify All'} onClick={onVerifyAll} disabled={verifying} />
          </div>
        </div>
        <FabricNetwork nodes={nodes} onNodeClick={onFabricNodeClick} />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass-panel rounded-2xl p-5">
          <div className="section-label mb-4">Storage Overview</div>
          <div className="space-y-3">
            <InfoRow label="Logical Size" value={formatBytes(health.logicalSize)} color="text-cyan-400" />
            <InfoRow label="Physical Size" value={formatBytes(health.physicalSize)} color="text-blue-400" />
            <InfoRow label="Replication Overhead" value={`${health.storageOverhead.toFixed(2)}×`} color="text-violet-400" />
            <div className="h-px bg-white/5 my-1" />
            <InfoRow label="Under-Replicated" value={String(health.underReplicated)} color={health.underReplicated > 0 ? 'text-amber-400' : 'text-emerald-400'} />
            <InfoRow label="Corrupted Objects" value={String(health.corrupted)} color={health.corrupted > 0 ? 'text-rose-400' : 'text-emerald-400'} />
            <InfoRow label="Availability" value={`${Math.round(health.availability)}%`} color="text-emerald-400" />
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
          <div className="section-label mb-4">Recent Operations</div>
          <div className="space-y-0.5 max-h-60 overflow-y-auto pr-1">
            {operations.length === 0 ? (
              <p className="text-xs text-slate-600 text-center py-10">No operations yet. Upload an object to begin.</p>
            ) : (
              operations.slice(0, 20).map(op => <OpRow key={op.id} op={op} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── KPI Card with cursor-following light ──
function KPICard({
  icon: Icon, label, value, sub, color, glowColor,
}: {
  icon: any; label: string; value: string; sub: string; color: string; glowColor: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 50, y: 50 });

  const handleMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      style={{ '--rx': `${pos.x}%`, '--ry': `${pos.y}%` } as React.CSSProperties}
      className="glass-card glow-card rounded-2xl p-4 relative cursor-default overflow-hidden group"
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      {/* Top accent line */}
      <div className="absolute top-0 left-4 right-4 h-px opacity-40"
        style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
      />
      <div className="flex items-start justify-between mb-3">
        <span className="section-label">{label}</span>
        <Icon className="w-4 h-4 opacity-25" style={{ color }} />
      </div>
      <div className="metric-value" style={{ color }}>{value}</div>
      <div className="metric-sub mt-1.5">{sub}</div>
    </motion.div>
  );
}

function FabBtn({ icon: Icon, label, onClick, disabled }: {
  icon: any; label: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="btn-ghost px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 disabled:opacity-40">
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

function InfoRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={`mono font-semibold ${color}`}>{value}</span>
    </div>
  );
}

function OpRow({ op }: { op: Operation }) {
  const tc: Record<string, string> = {
    upload: '#06b6d4', download: '#3b82f6', replicate: '#8b5cf6',
    repair: '#10b981', verify: '#f59e0b', rebalance: '#0ea5e9',
    fail: '#ef4444', recover: '#3b82f6', corrupt: '#f43f5e',
    partition: '#f59e0b', delete: '#64748b',
  };
  const ti: Record<string, any> = {
    upload: Upload, download: Download, replicate: ArrowRight,
    repair: Wrench, verify: CheckCircle2, rebalance: Scale,
    fail: XCircle, recover: RefreshCw, corrupt: AlertTriangle,
    partition: WifiOff, delete: Trash2,
  };
  const Icon = ti[op.type] || Activity;
  const c = tc[op.type] || '#64748b';

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-white/[0.02] transition-colors group">
      <Icon className="w-3.5 h-3.5 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" style={{ color: c }} />
      <span className="text-[10px] text-slate-600 mono shrink-0 w-16">{formatTs(op.timestamp)}</span>
      <span className="text-[11px] font-medium capitalize shrink-0 px-1.5 py-0.5 rounded bg-white/5 text-slate-400">{op.type}</span>
      <span className="text-xs text-slate-400 truncate flex-1">{op.description}</span>
      <span className={`text-[10px] shrink-0 ${op.status === 'completed' ? 'text-emerald-500/70' : op.status === 'failed' ? 'text-red-400/70' : 'text-slate-600'}`}>
        {op.status}
      </span>
    </div>
  );
}

function SkeletonDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="glass-card rounded-2xl p-4">
            <div className="shimmer h-3 w-12 rounded mb-3" />
            <div className="shimmer h-7 w-20 rounded mb-2" />
            <div className="shimmer h-2 w-16 rounded" />
          </div>
        ))}
      </div>
      <div className="glass-card rounded-2xl h-64"><div className="shimmer h-full w-full rounded-2xl" /></div>
      <div className="grid grid-cols-3 gap-4">
        <div className="glass-card rounded-2xl h-48"><div className="shimmer h-full w-full rounded-2xl" /></div>
        <div className="glass-card rounded-2xl lg:col-span-2 h-48"><div className="shimmer h-full w-full rounded-2xl" /></div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STORAGE FABRIC NETWORK
// ═══════════════════════════════════════════════════════════════════════════════

const NODE_POS = [
  { x: 130, y: 80 }, { x: 370, y: 80 },
  { x: 130, y: 260 }, { x: 370, y: 260 },
];

function FabricNetwork({ nodes, onNodeClick }: {
  nodes: Node[]; onNodeClick: (id: string) => void;
}) {
  const dn = nodes.slice(0, 4);

  return (
    <div className="relative w-full" style={{ height: 340 }}>
      <svg className="w-full h-full" viewBox="0 0 500 340" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="vg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(56,189,248,0.06)" />
            <stop offset="50%" stopColor="rgba(139,92,246,0.05)" />
            <stop offset="100%" stopColor="rgba(56,189,248,0.06)" />
          </linearGradient>
          <filter id="ng">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="sg">
            <feGaussianBlur stdDeviation="8" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Connection lines */}
        {dn.map((node, i) =>
          dn.map((node2, j) =>
            j > i ? (
              <line key={`c${i}${j}`}
                x1={NODE_POS[i].x} y1={NODE_POS[i].y}
                x2={NODE_POS[j].x} y2={NODE_POS[j].y}
                stroke="url(#vg)" strokeWidth={1}
                strokeDasharray={(node.partitions.includes(node2.id) || node2.partitions.includes(node.id)) ? '3 5' : undefined}
                opacity={node.status === 'offline' || node2.status === 'offline' ? 0.12 : node.partitions.includes(node2.id) ? 0.3 : 0.45}
              />
            ) : null
          )
        )}

        {/* Partition red overlays */}
        {dn.map((node, i) =>
          node.partitions.map(peerId => {
            const pj = dn.findIndex(n => n.id === peerId);
            if (pj < 0) return null;
            return (
              <line key={`p${i}${pj}`}
                x1={NODE_POS[i].x} y1={NODE_POS[i].y}
                x2={NODE_POS[pj].x} y2={NODE_POS[pj].y}
                stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3 4" opacity="0.35"
              />
            );
          })
        )}

        {/* Data flow particles */}
        {dn.filter(n => n.status !== 'offline').map((_, i) =>
          dn.filter((_, j) => j > i && dn[j]?.status !== 'offline').map((_, j) => (
            <FlowParticle key={`f${i}${j}`}
              x1={NODE_POS[i].x} y1={NODE_POS[i].y}
              x2={NODE_POS[j].x} y2={NODE_POS[j].y}
              delay={i * 0.8 + j * 0.4}
            />
          ))
        )}

        {/* Nodes */}
        {dn.map((node, i) => {
          if (!node) return null;
          const pos = NODE_POS[i];
          const active = node.status === 'healthy';
          const oc = nodeStatusColor(node.status);

          return (
            <g key={node.id} className="cursor-pointer" onClick={() => onNodeClick(node.id)}>
              {/* Ambient glow */}
              {active && (
                <circle cx={pos.x} cy={pos.y} r="56" fill={oc} opacity="0.04" filter="url(#sg)" />
              )}

              {/* Outer orbital ring */}
              <circle cx={pos.x} cy={pos.y} r={active ? 44 : 38}
                fill="none" stroke={oc} strokeWidth={0.7}
                strokeDasharray={active ? '5 7' : '2 5'}
                opacity={active ? 0.35 : 0.15}
                style={{ transformOrigin: `${pos.x}px ${pos.y}px`, animation: 'orbit 22s linear infinite' }}
              />
              {/* Inner orbital ring */}
              <circle cx={pos.x} cy={pos.y} r={active ? 36 : 30}
                fill="none" stroke="rgba(56,189,248,0.12)" strokeWidth={0.5}
                strokeDasharray={active ? '8 5' : '3 5'}
                style={{ transformOrigin: `${pos.x}px ${pos.y}px`, animation: 'orbit 16s linear infinite reverse' }}
              />

              {/* Crystal core */}
              <circle cx={pos.x} cy={pos.y} r={active ? 28 : 24}
                fill="rgba(6,10,20,0.9)" stroke={oc} strokeWidth={active ? 1.5 : 1}
                opacity={active ? 0.9 : 0.4}
                filter={active ? 'url(#ng)' : undefined}
              />
              {/* Core fill gradient */}
              <circle cx={pos.x} cy={pos.y} r={active ? 22 : 18}
                fill={oc} opacity={active ? 0.07 : 0.03}
              />
              {/* Center dot */}
              <circle cx={pos.x} cy={pos.y} r={active ? 5 : 4}
                fill={oc} opacity={active ? 0.85 : 0.35}
              />

              {/* Recovering pulse */}
              {node.status === 'recovering' && (
                <circle cx={pos.x} cy={pos.y} r="28" fill="none" stroke="#3b82f6" strokeWidth="1" opacity="0.3">
                  <animate attributeName="r" values="28;40;28" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
                </circle>
              )}

              {/* Labels */}
              <text x={pos.x} y={pos.y + 56} textAnchor="middle"
                fill={active ? 'rgba(148,163,184,0.75)' : 'rgba(100,116,139,0.45)'}
                fontSize="10" fontFamily="var(--font-mono)" fontWeight="500" letterSpacing="0.08em">
                {node.id.toUpperCase()}
              </text>
              <text x={pos.x} y={pos.y + 69} textAnchor="middle"
                fill="rgba(100,116,139,0.35)" fontSize="8.5" fontFamily="var(--font-mono)">
                {formatBytes(node.usedBytes)} / {formatBytes(node.capacityBytes)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="absolute bottom-2 left-4 flex gap-4 text-[10px] text-slate-500 mono">
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Healthy</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" />Recovering</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />Offline</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Degraded</span>
      </div>
    </div>
  );
}

function FlowParticle({ x1, y1, x2, y2, delay }: {
  x1: number; y1: number; x2: number; y2: number; delay: number;
}) {
  return (
    <circle r="2.5" fill="rgba(56,189,248,0.75)" filter="url(#ng)">
      <animateMotion
        dur={`${2.5 + Math.random() * 2}s`}
        repeatCount="indefinite"
        begin={`${delay}s`}
        path={`M${x1},${y1} L${x2},${y2}`}
      />
    </circle>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// OBJECTS VIEW
// ═══════════════════════════════════════════════════════════════════════════════

function ObjectsView({ objects, onUploadOpen, onDelete, onVerify, onDownload, onSelect }: {
  objects: ObjectMeta[]; onUploadOpen: () => void; onDelete: (id: string) => void;
  onVerify: (id: string) => void; onDownload: (obj: ObjectMeta) => void;
  onSelect: (obj: ObjectMeta) => void;
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() =>
    objects.filter(o =>
      o.name.toLowerCase().includes(search.toLowerCase()) ||
      o.id.slice(0, 8).toLowerCase().includes(search.toLowerCase())
    ),
    [objects, search]
  );

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-vault-cyan/60 transition-colors" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or ID…"
            className="w-full bg-white/[0.03] border border-white/[0.07] rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none
              focus:border-vault-cyan/30 focus:bg-white/[0.05] focus:shadow-[0_0_20px_rgba(56,189,248,0.06)]
              transition-all duration-200 placeholder:text-slate-600"
          />
        </div>
        <motion.button
          onClick={onUploadOpen}
          whileHover={{ scale: 1.03, y: -1 }}
          whileTap={{ scale: 0.97 }}
          className="btn-primary px-5 py-2.5 rounded-xl text-sm flex items-center gap-2 shadow-lg"
        >
          <Upload className="w-4 h-4" /> Upload Object
        </motion.button>
      </div>

      {/* Empty */}
      {filtered.length === 0 ? (
        <div className="glass-panel rounded-2xl p-16 text-center">
          <Database className="w-10 h-10 text-slate-700 mx-auto mb-4 opacity-40" />
          <p className="text-slate-500 text-sm">
            {search ? 'No objects match your search.' : 'Your storage fabric is empty. Upload your first object.'}
          </p>
        </div>
      ) : (
        <div className="glass-panel rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {['Name', 'Size', 'Checksum', 'Replicas', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-5 py-3 text-[10px] font-semibold text-slate-500 uppercase tracking-[0.15em] text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((obj, idx) => (
                <ObjectRow key={obj.id} obj={obj} idx={idx}
                  onDelete={onDelete} onVerify={onVerify} onDownload={onDownload} onSelect={onSelect} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ObjectRow({ obj, idx, onDelete, onVerify, onDownload, onSelect }: {
  obj: ObjectMeta; idx: number;
  onDelete: (id: string) => void; onVerify: (id: string) => void;
  onDownload: (obj: ObjectMeta) => void; onSelect: (obj: ObjectMeta) => void;
}) {
  const validCount = obj.replicas.filter(r => r.status === 'valid').length;
  const sc = obj.integrityStatus === 'valid' ? 'text-emerald-400' :
    obj.integrityStatus === 'degraded' ? 'text-amber-400' :
    obj.integrityStatus === 'corrupted' ? 'text-rose-400' : 'text-slate-500';
  const sbg = obj.integrityStatus === 'valid' ? 'bg-emerald-500/8 border-emerald-500/15' :
    obj.integrityStatus === 'degraded' ? 'bg-amber-500/8 border-amber-500/15' :
    obj.integrityStatus === 'corrupted' ? 'bg-rose-500/8 border-rose-500/15' : 'bg-slate-500/8 border-white/5';

  return (
    <motion.tr
      className={`obj-row border-b border-white/[0.03] ${idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.01]'}`}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: idx * 0.025, duration: 0.25 }}
    >
      <td className="px-5 py-3.5">
        <button onClick={() => onSelect(obj)} className="text-left group">
          <div className="font-medium text-slate-200 group-hover:text-vault-cyan transition-colors truncate max-w-[180px]">{obj.name}</div>
          <div className="text-[10px] text-slate-600 mono mt-0.5">{truncate(obj.id, 12)}</div>
        </button>
      </td>
      <td className="px-5 py-3.5"><span className="text-slate-400 mono text-xs">{formatBytes(obj.logicalSize)}</span></td>
      <td className="px-5 py-3.5"><span className="mono text-[10px] text-slate-600">{truncate(obj.checksum, 10)}</span></td>
      <td className="px-5 py-3.5">
        <div className="flex items-center gap-1">
          {Array.from({ length: obj.replicationFactor }).map((_, i) => (
            <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < validCount ? 'bg-emerald-400' : 'bg-slate-700'}`} />
          ))}
          <span className="mono text-[10px] text-slate-500 ml-1">{validCount}/{obj.replicationFactor}</span>
        </div>
      </td>
      <td className="px-5 py-3.5">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${sbg} ${sc}`}>
          {obj.integrityStatus}
        </span>
      </td>
      <td className="px-5 py-3.5">
        <div className="flex gap-1">
          <RowBtn icon={Download} label="Download" onClick={() => onDownload(obj)} hover="hover:text-vault-cyan hover:bg-vault-cyan/8" />
          <RowBtn icon={Scan} label="Verify" onClick={() => onVerify(obj.id)} hover="hover:text-emerald-400 hover:bg-emerald-500/8" />
          <RowBtn icon={Trash2} label="Delete" onClick={() => onDelete(obj.id)} hover="hover:text-rose-400 hover:bg-rose-500/8" />
        </div>
      </td>
    </motion.tr>
  );
}

function RowBtn({ icon: Icon, label, onClick, hover }: {
  icon: any; label: string; onClick: () => void; hover: string;
}) {
  return (
    <button onClick={onClick} title={label}
      className={`p-1.5 rounded-lg text-slate-500 transition-all duration-150 ${hover}`}>
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// NODES VIEW
// ═══════════════════════════════════════════════════════════════════════════════

function NodesView({ nodes, selectedNode, onSelectNode, onAction }: {
  nodes: Node[]; selectedNode: Node | null; onSelectNode: (n: Node) => void;
  onAction: (nodeId: string, action: string, extra?: Record<string, unknown>) => void;
}) {
  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-4">
      <div className="space-y-2">
        <div className="section-label mb-3">Fleet ({nodes.length})</div>
        {nodes.map(node => (
          <NodeTile key={node.id} node={node}
            selected={selectedNode?.id === node.id}
            onClick={() => onSelectNode(node)}
          />
        ))}
      </div>
      <div>
        {selectedNode ? (
          <motion.div key={selectedNode.id}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <NodeConsole node={selectedNode} onAction={onAction} />
          </motion.div>
        ) : (
          <EmptyNodePanel />
        )}
      </div>
    </div>
  );
}

function NodeTile({ node, selected, onClick }: {
  node: Node; selected: boolean; onClick: () => void;
}) {
  const sc = nodeStatusColor(node.status);
  const pct = Math.min(100, (node.usedBytes / node.capacityBytes) * 100);

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ x: 4 }}
      whileTap={{ scale: 0.98 }}
      className={`w-full text-left glass-card rounded-xl p-4 transition-all duration-200 relative overflow-hidden ${
        selected ? 'ring-1 ring-vault-cyan/30 border-vault-cyan/20' : ''
      }`}
    >
      {/* Left accent */}
      <div className="absolute left-0 top-0 bottom-0 w-px" style={{ background: `linear-gradient(to bottom, ${sc}, transparent)` }} />

      <div className="flex items-center gap-3 mb-3 pl-2">
        <span className="status-dot" style={{ backgroundColor: sc, boxShadow: `0 0 8px ${sc}80` }} />
        <span className="font-mono font-semibold text-sm text-slate-200">{node.id.toUpperCase()}</span>
        <span className="text-[10px] text-slate-500 uppercase tracking-wider ml-auto font-medium">{node.status}</span>
      </div>

      <div className="pl-2 space-y-2">
        <div className="flex justify-between text-[10px] text-slate-500 mono">
          <span>{formatBytes(node.usedBytes)} used</span>
          <span>{pct.toFixed(0)}%</span>
        </div>
        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: sc, opacity: 0.65 }}
            initial={{ width: 0 }} animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-slate-600 mono pl-1">
          <span>{node.objectCount} objects</span>
          <span>{node.replicaCount} replicas</span>
        </div>
      </div>

      {node.partitions.length > 0 && (
        <div className="mt-2 pl-2 text-[10px] text-red-400/70 mono flex items-center gap-1">
          <WifiOff className="w-3 h-3" /> Partitioned: {node.partitions.join(', ')}
        </div>
      )}
    </motion.button>
  );
}

function EmptyNodePanel() {
  return (
    <div className="glass-panel rounded-2xl p-12 text-center h-full min-h-[400px] flex flex-col items-center justify-center">
      <Network className="w-10 h-10 text-slate-700 mb-4 opacity-30" />
      <p className="text-slate-500 text-sm">Select a node from the fleet to inspect its state and controls.</p>
    </div>
  );
}

function NodeConsole({ node, onAction }: {
  node: Node; onAction: (id: string, action: string, extra?: Record<string, unknown>) => void;
}) {
  const sc = nodeStatusColor(node.status);
  const freeBytes = Math.max(0, node.capacityBytes - node.usedBytes);
  const pct = Math.min(100, (node.usedBytes / node.capacityBytes) * 100);

  return (
    <div className="space-y-4">
      {/* Identity */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="status-dot animate-breath" style={{ backgroundColor: sc, boxShadow: `0 0 12px ${sc}60` }} />
            <div>
              <h3 className="font-mono font-bold text-base text-slate-100">{node.id.toUpperCase()}</h3>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">{statusLabel(node.status)}</span>
            </div>
          </div>
          <span className="text-[10px] text-slate-600 mono">{formatTs(node.lastHeartbeat)}</span>
        </div>
      </div>

      {/* Capacity */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="section-label mb-4">Capacity &amp; Storage</div>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <MetricBox label="Total Capacity" value={formatBytes(node.capacityBytes)} />
          <MetricBox label="Used" value={formatBytes(node.usedBytes)} accent="text-vault-cyan" />
          <MetricBox label="Free" value={formatBytes(freeBytes)} accent="text-emerald-400" />
          <MetricBox label="Objects" value={String(node.objectCount)} accent="text-violet-400" />
        </div>
        <div className="h-2 bg-white/5 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, background: `linear-gradient(90deg, #06b6d4, #6366f1)` }}
            initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-slate-600 mono mt-1">
          <span>0 B</span><span>{pct.toFixed(1)}%</span><span>{formatBytes(node.capacityBytes)}</span>
        </div>
      </div>

      {/* Simulation controls */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="section-label mb-4">Simulation Controls</div>
        <div className="flex flex-wrap gap-2">
          {node.status !== 'offline' && (
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={() => onAction(node.id, 'fail')} className="btn-danger px-4 py-2 rounded-xl text-xs font-medium">
              Take Offline
            </motion.button>
          )}
          {node.status === 'offline' && (
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={() => onAction(node.id, 'recover')} className="btn-primary px-4 py-2 rounded-xl text-xs font-medium">
              Recover Node
            </motion.button>
          )}
          <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
            onClick={() => onAction(node.id, 'verify')} className="btn-ghost px-4 py-2 rounded-xl text-xs font-medium">
            Verify Integrity
          </motion.button>
        </div>
      </div>

      {/* Partitions */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="section-label mb-4">Network Partitions</div>
        <div className="grid grid-cols-2 gap-2">
          {['node-01', 'node-02', 'node-03', 'node-04']
            .filter(id => id !== node.id)
            .map(peerId => {
              const part = node.partitions.includes(peerId);
              return (
                <motion.button key={peerId} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => onAction(node.id, part ? 'heal' : 'partition', { peerId })}
                  className={`px-3 py-2 rounded-xl text-xs font-mono flex items-center gap-2 transition-all ${
                    part ? 'bg-red-500/10 border border-red-500/25 text-red-400' : 'btn-ghost'
                  }`}>
                  {part ? <WifiOff className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
                  {peerId.toUpperCase()}
                  <span className="ml-auto text-[10px] opacity-50">{part ? 'BREAK' : 'LINK'}</span>
                </motion.button>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function MetricBox({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="glass-card rounded-xl p-3">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-sm font-mono font-semibold ${accent ?? 'text-slate-200'}`}>{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function UploadModal({
  uploadName, setUploadName, uploadFile, setUploadFile,
  replicationFactor, setReplicationFactor, healthyCount, onUpload, onClose,
}: {
  uploadName: string; setUploadName: (s: string) => void;
  uploadFile: File | null; setUploadFile: (f: File | null) => void;
  replicationFactor: number; setReplicationFactor: (n: number) => void;
  healthyCount: number; onUpload: () => void; onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0, y: 24 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.92, opacity: 0, y: 24 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="glass-panel rounded-2xl p-6 w-full max-w-md shadow-2xl"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-8 rounded-lg bg-vault-cyan/15 flex items-center justify-center border border-vault-cyan/25">
            <Upload className="w-4 h-4 text-vault-cyan" />
          </div>
          <h2 className="text-base font-semibold text-slate-100">Upload Object</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1.5 uppercase tracking-wider">Object Name</label>
            <input
              value={uploadName} onChange={e => setUploadName(e.target.value)}
              placeholder="my-object"
              className="w-full bg-white/4 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm outline-none
                focus:border-vault-cyan/40 focus:ring-1 focus:ring-vault-cyan/20 transition-all"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1.5 uppercase tracking-wider">File</label>
            <div
              className="border-2 border-dashed border-white/8 rounded-xl p-5 text-center cursor-pointer
                hover:border-vault-cyan/30 hover:bg-vault-cyan/3 transition-all duration-200"
              onClick={() => document.getElementById('file-input')?.click()}
            >
              {uploadFile ? (
                <div>
                  <Download className="w-6 h-6 text-vault-cyan mx-auto mb-2 opacity-60" />
                  <p className="text-sm text-slate-200 font-medium">{uploadFile.name}</p>
                  <p className="text-xs text-slate-500 mono mt-1">{formatBytes(uploadFile.size)}</p>
                </div>
              ) : (
                <div>
                  <Upload className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">Click to select a file</p>
                </div>
              )}
              <input id="file-input" type="file" className="hidden"
                onChange={e => setUploadFile(e.target.files?.[0] || null)} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-slate-500 uppercase tracking-wider">Replication Factor</label>
              <span className="text-[10px] text-slate-600 mono">{replicationFactor} / {healthyCount} nodes</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map(n => {
                const ok = n <= healthyCount;
                const sel = replicationFactor === n;
                return (
                  <button key={n} onClick={() => setReplicationFactor(n)}
                    className={`relative py-2.5 rounded-xl text-center transition-all duration-200 ${
                      sel
                        ? 'bg-vault-cyan/15 border border-vault-cyan/40 text-vault-cyan shadow-[0_0_20px_rgba(6,182,212,0.15)]'
                        : ok
                        ? 'bg-white/4 border border-white/8 text-slate-400 hover:border-white/15 hover:text-slate-300'
                        : 'bg-white/2 border border-white/5 text-slate-700 cursor-not-allowed'
                    }`}>
                    <div className="text-lg font-bold font-mono">{n}</div>
                    <div className="text-[9px] opacity-50 mt-0.5">{['Single','Dual','Triple','Quad'][n-1]}</div>
                    {!ok && <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full text-[8px] flex items-center justify-center text-white">!</span>}
                  </button>
                );
              })}
            </div>
            {uploadFile && (
              <div className="mt-2 p-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-xs mono text-slate-400">
                Plan:{' '}
                {formatBytes(uploadFile.size)} × {replicationFactor}{' '}
                <span className="text-vault-cyan/70">= {formatBytes(uploadFile.size * replicationFactor)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 btn-ghost py-2.5 rounded-xl text-sm">Cancel</button>
          <button
            onClick={onUpload}
            disabled={!uploadFile || replicationFactor > healthyCount}
            className="flex-1 btn-primary py-2.5 rounded-xl text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Upload
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// OBJECT DETAIL MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function ObjectDetailModal({ obj, nodes, onClose, onVerify, onDelete }: {
  obj: ObjectMeta; nodes: Node[]; onClose: () => void;
  onVerify: () => void; onDelete: () => void;
}) {
  const nodeStatusMap = new Map(nodes.map(n => [n.id, n.status]));
  const vc = obj.replicas.filter(r => r.status === 'valid').length;
  const sc = obj.integrityStatus === 'valid' ? 'text-emerald-400' :
    obj.integrityStatus === 'degraded' ? 'text-amber-400' : 'text-rose-400';
  const sbg = obj.integrityStatus === 'valid' ? 'bg-emerald-500/10 border-emerald-500/20' :
    obj.integrityStatus === 'degraded' ? 'bg-amber-500/10 border-amber-500/20' : 'bg-rose-500/10 border-rose-500/20';

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0, y: 20 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="glass-panel rounded-2xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-vault-cyan/10 border border-vault-cyan/20 flex items-center justify-center">
              <Database className="w-4 h-4 text-vault-cyan" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">{obj.name}</h2>
              <p className="text-[10px] text-slate-500 mono mt-0.5">{obj.id}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <XCircle className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          <DChip label="Size" value={formatBytes(obj.logicalSize)} />
          <DChip label="Version" value={`v${obj.version}`} />
          <DChip label="Integrity" value={obj.integrityStatus} className={sc} borderColor="border-white/10" />
        </div>

        {/* Checksum */}
        <div className="mb-5">
          <div className="section-label mb-2">Checksum (SHA-256)</div>
          <div className="mono text-[10px] text-slate-400 bg-black/30 rounded-xl p-3 border border-white/5 break-all leading-relaxed">
            {obj.checksum}
          </div>
        </div>

        {/* Replicas */}
        <div className="mb-5">
          <div className="section-label mb-2 flex items-center gap-2">
            Replicas
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${sbg} ${sc}`}>
              {vc}/{obj.replicationFactor} valid
            </span>
          </div>
          <div className="space-y-1">
            {obj.replicas.map((r, i) => {
              const ns = nodeStatusMap.get(r.nodeId);
              const off = ns === 'offline';
              const rv = r.status === 'valid';
              return (
                <div key={i}
                  className={`flex items-center gap-2.5 text-xs mono py-2 px-3 rounded-xl border transition-colors ${
                    rv ? 'bg-emerald-500/5 border-emerald-500/10 text-slate-300' :
                    off ? 'bg-red-500/5 border-red-500/10 text-slate-500' :
                    'bg-white/[0.02] border-white/5 text-slate-400'
                  }`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${rv ? 'bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.6)]' : off ? 'bg-red-400' : 'bg-slate-600'}`} />
                  <span className={off ? 'text-red-400/70' : rv ? 'text-slate-200' : 'text-slate-500'}>
                    {r.nodeId.toUpperCase()}
                  </span>
                  <span className="text-slate-700">·</span>
                  <span className={rv ? 'text-emerald-400/80' : 'text-slate-500'}>{r.status}</span>
                  <span className="text-slate-700">·</span>
                  <span className="text-slate-500">{formatBytes(r.size)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t border-white/6">
          <button onClick={onVerify} className="btn-ghost flex-1 py-2.5 rounded-xl text-sm flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Verify
          </button>
          <button onClick={onDelete} className="btn-danger flex-1 py-2.5 rounded-xl text-sm flex items-center justify-center gap-2">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function DChip({ label, value, className = '', borderColor = 'border-white/10' }: {
  label: string; value: string; className?: string; borderColor?: string;
}) {
  return (
    <div className={`glass-card rounded-xl p-3 ${borderColor}`}>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-sm font-mono font-semibold ${className || 'text-slate-200'}`}>{value}</div>
    </div>
  );
}
