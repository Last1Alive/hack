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
    // Show first phase immediately
    timers.current.push(setTimeout(() => setPhase(0), 100));
    PHASES.forEach((_, i) => {
      timers.current.push(setTimeout(() => setPhase(i + 1), PHASES[i].delay));
    });
    // Fade out after last phase
    const exitAt = Math.max(...PHASES.map(p => p.delay)) + 1000;
    timers.current.push(setTimeout(() => setExit(true), exitAt));
    timers.current.push(setTimeout(() => onReady(), exitAt + 600));
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const progress = Math.min(100, ((phase + 1) / PHASES.length) * 100);

  return (
    <AnimatePresence>
      {!exit && (
        <motion.div
          key="loading"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.6, ease: [0.4, 0, 0.2, 1] } }}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden bg-[#050a14]"
          style={{ background: '#050a14', backdropFilter: 'none' }}
        >
          {/* ── Ambient atmospheric glow ── */}
          <motion.div
            animate={{
              scale: [1, 1.12, 1],
              opacity: [0.25, 0.45, 0.25],
            }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute w-[900px] h-[900px] rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(99,102,241,0.10) 0%, rgba(56,189,248,0.04) 35%, transparent 65%)',
              filter: 'blur(50px)',
            }}
          />

          {/* ── Grid of storage nodes (appears at phase 2) ── */}
          {phase >= 1 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: phase >= 2 ? 0.6 : 0.15 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <svg width="420" height="320" viewBox="0 0 420 320" className="opacity-30">
                {/* Connection lines */}
                {[
                  [70, 60, 350, 60], [70, 60, 70, 260], [70, 60, 350, 260],
                  [350, 60, 70, 260], [350, 60, 350, 260], [70, 260, 350, 260],
                ].map(([x1, y1, x2, y2], i) => (
                  <motion.line
                    key={i}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke="rgba(56,189,248,0.25)"
                    strokeWidth="0.8"
                    strokeDasharray={phase >= 3 ? "none" : "6 4"}
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{
                      pathLength: phase >= 2 ? 1 : 0,
                      opacity: phase >= 2 ? 0.5 : 0,
                    }}
                    transition={{ duration: 0.8, delay: i * 0.1, ease: 'easeOut' }}
                  />
                ))}
                {/* Node dots */}
                {[{ x: 70, y: 60, label: 'N1' }, { x: 350, y: 60, label: 'N2' },
                  { x: 70, y: 260, label: 'N3' }, { x: 350, y: 260, label: 'N4' }].map((n, i) => (
                  <motion.g key={i}>
                    <motion.circle
                      cx={n.x} cy={n.y} r="6"
                      fill="rgba(56,189,248,0.15)"
                      stroke="rgba(56,189,248,0.5)"
                      strokeWidth="1"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{
                        scale: phase >= 2 ? 1 : 0,
                        opacity: phase >= 2 ? 1 : 0,
                      }}
                      transition={{ delay: 0.4 + i * 0.12, duration: 0.5 }}
                    />
                    <motion.circle
                      cx={n.x} cy={n.y} r="2"
                      fill="rgba(56,189,248,0.8)"
                      initial={{ scale: 0 }}
                      animate={{ scale: phase >= 2 ? 1 : 0 }}
                      transition={{ delay: 0.5 + i * 0.12 }}
                    />
                    <motion.text
                      x={n.x} y={n.y + 20}
                      textAnchor="middle"
                      fill="rgba(148,163,184,0.4)"
                      fontSize="9"
                      fontFamily="monospace"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: phase >= 2 ? 0.5 : 0 }}
                      transition={{ delay: 0.6 + i * 0.1 }}
                    >
                      {n.label}
                    </motion.text>
                  </motion.g>
                ))}
              </svg>
            </motion.div>
          )}

          {/* ── Floating particles ── */}
          {phase >= 0 && Array.from({ length: 20 }).map((_, i) => (
            <FloatingParticle key={i} index={i} phase={phase} />
          ))}

          {/* ── Central Shield ── */}
          <div className="relative z-10 mb-8">
            {/* Pulsing aura */}
            <motion.div
              animate={{
                scale: [1, 1.18, 1],
                opacity: [0.2, 0.4, 0.2],
              }}
              transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute -inset-12 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(56,189,248,0.12) 0%, rgba(99,102,241,0.06) 40%, transparent 70%)',
                filter: 'blur(24px)',
              }}
            />
            {/* Rotating outer ring */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
              className="absolute -inset-4"
            >
              <svg width="140" height="140" viewBox="0 0 140 140" className="w-[140px] h-[140px]">
                <circle cx="70" cy="70" r="64" fill="none"
                  stroke="rgba(56,189,248,0.12)" strokeWidth="0.5"
                  strokeDasharray="3 7" />
                <circle cx="70" cy="70" r="58" fill="none"
                  stroke="rgba(139,92,246,0.10)" strokeWidth="0.5"
                  strokeDasharray="2 9" />
              </svg>
            </motion.div>
            {/* Shield icon */}
            <ShieldSVG size={64} phase={phase} />
          </div>

          {/* ── Title ── */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: phase >= 0 ? 1 : 0, y: phase >= 0 ? 0 : 8 }}
            className="relative z-10 mb-2"
          >
            <span className="text-3xl font-extrabold tracking-tight text-white/90"
              style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
              VAULT
            </span>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: phase >= 1 ? 0.4 : 0 }}
            className="text-[10px] tracking-[0.3em] uppercase text-slate-400 mb-8 relative z-10"
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
                <span className="text-xs tracking-[0.22em] text-slate-300 font-medium uppercase">
                  {phase >= 0 && phase <= 5 ? PHASES[phase - 1]?.label ?? '' : 'FABRIC ONLINE'}
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
          <div className="relative z-10 w-56 h-px bg-white/8 rounded-full overflow-hidden mb-6">
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
  return (
    <svg width={size} height={size + 8} viewBox="0 0 56 64" fill="none">
      {/* Outer shield outline */}
      <motion.path
        d="M28 3L51 17V35C51 49 28 62 28 62S5 49 5 35V17L28 3Z"
        stroke={`rgba(56,189,248,${Math.min(op + 0.1, 0.8)})`}
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
  const angle = (index / 20) * Math.PI * 2;
  const radius = 100 + (index % 4) * 25;
  const hue = index % 3 === 0 ? '56,189,248' : index % 3 === 1 ? '139,92,246' : '99,102,241';
  const size = 1.2 + (index % 3) * 0.8;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{
        opacity: phase >= 1 ? [0.15, 0.5, 0.15] : 0,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.45,
      }}
      transition={{
        duration: 2.5 + (index % 4),
        repeat: Infinity,
        ease: 'easeInOut',
        delay: index * 0.1,
      }}
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{
        width: size,
        height: size,
        background: `rgba(${hue},0.5)`,
        boxShadow: `0 0 ${size * 4}px rgba(${hue},0.3)`,
      }}
    />
  );
}
