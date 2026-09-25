'use client';
import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Phase timing — all relative delays in ms
const PHASES = [
  { label: 'INITIALIZING VAULT',           delay: 400  },
  { label: 'DISCOVERING STORAGE FABRIC',   delay: 1000 },
  { label: 'CONNECTING STORAGE NODES',     delay: 1800 },
  { label: 'VERIFYING DATA INTEGRITY',     delay: 2600 },
  { label: 'ESTABLISHING REPLICATION',     delay: 3400 },
  { label: 'FABRIC ONLINE',                delay: 4200 },
];

export default function LoadingScreen({ onReady }: { onReady: () => void }) {
  const [phase, setPhase] = useState(-1);
  const [exit, setExit] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    timers.current.push(setTimeout(() => setPhase(0), 100));
    PHASES.forEach((_, i) => {
      timers.current.push(setTimeout(() => setPhase(i + 1), PHASES[i].delay));
    });
    const exitAt = Math.max(...PHASES.map(p => p.delay)) + 1000;
    timers.current.push(setTimeout(() => setExit(true), exitAt));
    timers.current.push(setTimeout(() => onReady(), exitAt + 600));
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const progress = Math.min(100, ((phase + 1) / PHASES.length) * 100);
  const currentLabel = phase >= 0 && phase <= 5 ? PHASES[phase - 1]?.label ?? '' : 'FABRIC ONLINE';

  return (
    <AnimatePresence>
      {!exit && (
        <motion.div
          key="loading"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.6, ease: [0.4, 0, 0.2, 1] } }}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden"
          style={{ background: '#050a14' }}
        >
          {/* ── Deep atmospheric glow layers ── */}
          <motion.div
            animate={{ scale: [1, 1.08, 1], opacity: [0.2, 0.35, 0.2] }}
            transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute w-[700px] h-[700px] rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(56,189,248,0.08) 0%, rgba(99,102,241,0.04) 30%, transparent 65%)',
              filter: 'blur(60px)',
            }}
          />
          <motion.div
            animate={{ scale: [1, 1.15, 1], opacity: [0.1, 0.22, 0.1] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
            className="absolute w-[500px] h-[500px] rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 60%)',
              filter: 'blur(40px)',
            }}
          />
          {/* Subtle crimson rim light */}
          <motion.div
            animate={{ opacity: [0.03, 0.08, 0.03] }}
            transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute w-[400px] h-[400px] rounded-full"
            style={{
              background: 'radial-gradient(circle, transparent 40%, rgba(220,38,38,0.06) 70%, transparent 100%)',
              filter: 'blur(30px)',
            }}
          />

          {/* ── Fabric node grid (appears at phase 1) ── */}
          {phase >= 1 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: phase >= 2 ? 0.5 : 0.12 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <svg width="420" height="320" viewBox="0 0 420 320" className="opacity-30">
                {[
                  [70, 60, 350, 60], [70, 60, 70, 260], [70, 60, 350, 260],
                  [350, 60, 70, 260], [350, 60, 350, 260], [70, 260, 350, 260],
                ].map(([x1, y1, x2, y2], i) => (
                  <motion.line
                    key={i}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke="rgba(56,189,248,0.25)" strokeWidth="0.8"
                    strokeDasharray={phase >= 3 ? "none" : "6 4"}
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: phase >= 2 ? 1 : 0, opacity: phase >= 2 ? 0.5 : 0 }}
                    transition={{ duration: 0.8, delay: i * 0.1, ease: 'easeOut' }}
                  />
                ))}
                {[{ x: 70, y: 60, label: 'N1' }, { x: 350, y: 60, label: 'N2' },
                  { x: 70, y: 260, label: 'N3' }, { x: 350, y: 260, label: 'N4' }].map((n, i) => (
                  <motion.g key={i}>
                    <motion.circle cx={n.x} cy={n.y} r="6"
                      fill="rgba(56,189,248,0.15)" stroke="rgba(56,189,248,0.5)" strokeWidth="1"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: phase >= 2 ? 1 : 0, opacity: phase >= 2 ? 1 : 0 }}
                      transition={{ delay: 0.4 + i * 0.12, duration: 0.5 }}
                    />
                    <motion.circle cx={n.x} cy={n.y} r="2"
                      fill="rgba(56,189,248,0.8)"
                      initial={{ scale: 0 }}
                      animate={{ scale: phase >= 2 ? 1 : 0 }}
                      transition={{ delay: 0.5 + i * 0.12 }}
                    />
                    <motion.text x={n.x} y={n.y + 20} textAnchor="middle"
                      fill="rgba(148,163,184,0.4)" fontSize="9" fontFamily="monospace"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: phase >= 2 ? 0.5 : 0 }}
                      transition={{ delay: 0.6 + i * 0.1 }}
                    >{n.label}</motion.text>
                  </motion.g>
                ))}
              </svg>
            </motion.div>
          )}

          {/* ── Floating particles ── */}
          {Array.from({ length: 24 }).map((_, i) => (
            <FloatingParticle key={i} index={i} phase={phase} />
          ))}

          {/* ── Central emblem area ── */}
          <div className="relative z-10 mb-6">

            {/* ── Outer dotted ring (phase 1+) ── */}
            {phase >= 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: phase >= 1 ? 0.35 : 0.08, scale: 1 }}
                transition={{ duration: 1, ease: 'easeOut' }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ width: 260, height: 260 }}
              >
                <svg width="260" height="260" viewBox="0 0 260 260" className="animate-[spin_30s_linear_infinite] origin-center">
                  <circle cx="130" cy="130" r="122" fill="none"
                    stroke="rgba(56,189,248,0.15)" strokeWidth="0.6"
                    strokeDasharray="2 8" />
                </svg>
              </motion.div>
            )}

            {/* ── Secondary dashed ring (phase 2+) ── */}
            {phase >= 1 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: phase >= 2 ? 0.4 : 0.1, scale: 1 }}
                transition={{ duration: 1, ease: 'easeOut', delay: 0.2 }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ width: 210, height: 210 }}
              >
                <svg width="210" height="210" viewBox="0 0 210 210"
                  className="animate-[spin_22s_linear_infinite_reverse] origin-center">
                  <circle cx="105" cy="105" r="98" fill="none"
                    stroke="rgba(139,92,246,0.18)" strokeWidth="0.8"
                    strokeDasharray="6 5" />
                  {/* Tick marks */}
                  {Array.from({ length: 24 }).map((_, i) => {
                    const a = (i / 24) * Math.PI * 2;
                    const r1 = 98, r2 = i % 6 === 0 ? 91 : 94;
                    return (
                      <line key={i}
                        x1={105 + Math.cos(a) * r1} y1={105 + Math.sin(a) * r1}
                        x2={105 + Math.cos(a) * r2} y2={105 + Math.sin(a) * r2}
                        stroke="rgba(139,92,246,0.2)" strokeWidth={i % 6 === 0 ? 1 : 0.5}
                      />
                    );
                  })}
                </svg>
              </motion.div>
            )}

            {/* ── Inner technical ring (phase 3+) ── */}
            {phase >= 2 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: phase >= 3 ? 0.5 : 0.12, scale: 1 }}
                transition={{ duration: 0.8, ease: 'easeOut', delay: 0.3 }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ width: 165, height: 165 }}
              >
                <svg width="165" height="165" viewBox="0 0 165 165"
                  className="animate-[spin_16s_linear_infinite] origin-center">
                  <circle cx="82.5" cy="82.5" r="75" fill="none"
                    stroke="rgba(56,189,248,0.22)" strokeWidth="0.5"
                    strokeDasharray="12 4" />
                  <circle cx="82.5" cy="82.5" r="68" fill="none"
                    stroke="rgba(6,182,212,0.12)" strokeWidth="0.4"
                    strokeDasharray="3 12" />
                </svg>
              </motion.div>
            )}

            {/* ── Light pulse traveling along inner ring (phase 4+) ── */}
            {phase >= 3 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.4 }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ width: 165, height: 165 }}
              >
                <svg width="165" height="165" viewBox="0 0 165 165">
                  <circle cx="82.5" cy="82.5" r="75" fill="none"
                    stroke="rgba(56,189,248,0.6)" strokeWidth="1.5"
                    strokeDasharray="8 450" strokeLinecap="round"
                    style={{ transformOrigin: '82.5px 82.5px', animation: 'spin 3s linear infinite' }}
                    filter="url(#lg)"
                  />
                  <defs>
                    <filter id="lg">
                      <feGaussianBlur stdDeviation="2" result="b" />
                      <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>
                </svg>
              </motion.div>
            )}

            {/* ── Second pulse opposite direction (phase 5+) ── */}
            {phase >= 4 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.7 }}
                transition={{ duration: 0.6 }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ width: 210, height: 210 }}
              >
                <svg width="210" height="210" viewBox="0 0 210 210">
                  <circle cx="105" cy="105" r="98" fill="none"
                    stroke="rgba(139,92,246,0.5)" strokeWidth="1"
                    strokeDasharray="5 580" strokeLinecap="round"
                    style={{ transformOrigin: '105px 105px', animation: 'spin 4s linear infinite reverse' }}
                    filter="url(#lg2)"
                  />
                  <defs>
                    <filter id="lg2">
                      <feGaussianBlur stdDeviation="2" result="b" />
                      <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>
                </svg>
              </motion.div>
            )}

            {/* ── Pulsing aura behind logo ── */}
            <motion.div
              animate={{ scale: [1, 1.22, 1], opacity: [0.15, 0.35, 0.15] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[160px] h-[160px] rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(56,189,248,0.12) 0%, rgba(99,102,241,0.05) 40%, transparent 70%)',
                filter: 'blur(20px)',
              }}
            />

            {/* ── Shield logo — large & centered ── */}
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: phase >= 0 ? 1 : 0.7, opacity: 1 }}
              transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
              className="relative"
            >
              <ShieldSVG size={112} phase={phase} />
              {/* Subtle ground reflection */}
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-[80px] h-3 rounded-full blur-md"
                style={{ background: 'radial-gradient(ellipse, rgba(56,189,248,0.12) 0%, transparent 70%)' }}
              />
            </motion.div>
          </div>

          {/* ── Title ── */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: phase >= 0 ? 1 : 0, y: phase >= 0 ? 0 : 10 }}
            className="relative z-10 mb-1"
          >
            <span className="cinematic-title text-[38px] font-bold tracking-[0.22em]">
              VAULT
            </span>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: phase >= 1 ? 0.35 : 0 }}
            className="text-[10px] tracking-[0.32em] uppercase text-slate-400 mb-8 relative z-10"
            style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
          >
            Distributed Storage Fabric
          </motion.p>

          {/* ── Phase text ── */}
          <div className="relative z-10 h-5 mb-6 flex items-center gap-3">
            <AnimatePresence mode="wait">
              <motion.div
                key={phase}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
                className="flex items-center gap-3"
              >
                <span className="mono text-[10px] text-vault-cyan/40 w-12 text-right tabular-nums">
                  {String(Math.max(0, phase)).padStart(2, '0')}
                </span>
                <span className="text-xs tracking-[0.22em] text-slate-300 font-medium uppercase"
                  style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
                  {currentLabel}
                </span>
                {phase >= 5 && (
                  <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/12 text-emerald-400 border border-emerald-500/20 animate-breath">
                    LIVE
                  </span>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* ── Progress bar ── */}
          <div className="relative z-10 w-64 h-px bg-white/8 rounded-full overflow-hidden mb-6">
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, #06b6d4, #6366f1)' }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>

          {/* ── Bottom brand ── */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: phase >= 4 ? 0.3 : 0 }}
            className="absolute bottom-8 text-[10px] text-slate-500 tracking-[0.3em] uppercase relative z-10"
            style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
          >
            Fault-Tolerant Architecture
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ShieldSVG({ size, phase }: { size: number; phase: number }) {
  const op = 0.55 + phase * 0.09;
  const s = size;
  const cx = s / 2;
  const cy = (s + 8) / 2;
  // Scale path coords to fit the requested size
  const sc = s / 56;
  const cyOff = (s + 8 - s) / 2; // small vertical adjust

  return (
    <svg width={s} height={s + 8} viewBox="0 0 56 64" fill="none" className="drop-shadow-lg">
      {/* Outer shield outline */}
      <motion.path
        d="M28 3L51 17V35C51 49 28 62 28 62S5 49 5 35V17L28 3Z"
        stroke={`rgba(56,189,248,${Math.min(op + 0.1, 0.85)})`}
        strokeWidth="1.4"
        fill={`rgba(56,189,248,${Math.min(op * 0.06, 0.12)})`}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      />
      {/* Inner shield */}
      <motion.path
        d="M28 15L42 24V36C42 44 28 52 28 52S14 44 14 36V24L28 15Z"
        stroke={`rgba(56,189,248,${Math.min(op * 0.6, 0.5)})`}
        strokeWidth="0.8"
        fill="none"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 1 ? 1 : 0 }}
        transition={{ duration: 0.7, delay: 0.3 }}
      />
      {/* Lock body */}
      <motion.rect
        x="22" y="30" width="12" height="9" rx="1.5"
        stroke={`rgba(56,189,248,${Math.min(op + 0.15, 0.85)})`}
        strokeWidth="1.2"
        fill={`rgba(56,189,248,${Math.min(op * 0.1, 0.15)})`}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: phase >= 2 ? 1 : 0, scale: phase >= 2 ? 1 : 0.8 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      />
      {/* Lock shackle */}
      <motion.path
        d="M24 30V26C24 24.9 24.9 24 26 24H30C31.1 24 32 24.9 32 26V30"
        stroke={`rgba(56,189,248,${Math.min(op + 0.15, 0.85)})`}
        strokeWidth="1.2"
        fill="none"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: phase >= 2 ? 1 : 0 }}
        transition={{ duration: 0.5, delay: 0.6 }}
      />
      {/* Keyhole */}
      {phase >= 3 && (
        <motion.circle cx="28" cy="34.5" r="1.2"
          fill="rgba(56,189,248,0.9)"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        />
      )}
    </svg>
  );
}

function FloatingParticle({ index, phase }: { index: number; phase: number }) {
  const angle = (index / 24) * Math.PI * 2;
  const radius = 120 + (index % 5) * 22;
  const hue = index % 3 === 0 ? '56,189,248' : index % 3 === 1 ? '139,92,246' : '99,102,241';
  const size = 1 + (index % 3) * 0.6;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{
        opacity: phase >= 1 ? [0.12, 0.45, 0.12] : 0,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.42,
      }}
      transition={{
        duration: 3 + (index % 5),
        repeat: Infinity,
        ease: 'easeInOut',
        delay: index * 0.08,
      }}
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{
        width: size,
        height: size,
        background: `rgba(${hue},0.5)`,
        boxShadow: `0 0 ${size * 5}px rgba(${hue},0.3)`,
      }}
    />
  );
}
