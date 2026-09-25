'use client';
import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const PHASES = [
  { text: 'INITIALIZING VAULT',       delay: 0    },
  { text: 'DISCOVERING STORAGE FABRIC', delay: 600  },
  { text: 'CONNECTING STORAGE NODES',   delay: 1200 },
  { text: 'VERIFYING DATA INTEGRITY',   delay: 1800 },
  { text: 'ESTABLISHING REPLICATION',   delay: 2400 },
  { text: 'FABRIC ONLINE',              delay: 3000 },
];

export default function LoadingScreen({ onReady }: { onReady: () => void }) {
  const [phase, setPhase] = useState(0);
  const [done, setDone] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    PHASES.forEach((_, i) => {
      timerRef.current.push(setTimeout(() => setPhase(i), PHASES[i].delay));
    });
    // Fade out after last phase
    const exitDelay = Math.max(...PHASES.map(p => p.delay)) + 900;
    timerRef.current.push(setTimeout(() => setDone(true), exitDelay));
    timerRef.current.push(setTimeout(() => onReady(), exitDelay + 500));
    return () => timerRef.current.forEach(clearTimeout);
  }, []);

  return (
    <AnimatePresence>
      {!done && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.6, ease: [0.4, 0, 0.2, 1] } }}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden"
          style={{
            background: 'radial-gradient(ellipse 70% 60% at 50% 45%, rgba(56,189,248,0.06) 0%, #050a14 65%)',
          }}
        >
          {/* Ambient glow behind everything */}
          <motion.div
            animate={{
              scale: [1, 1.15, 1],
              opacity: [0.3, 0.5, 0.3],
            }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute w-[800px] h-[800px] rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, rgba(56,189,248,0.05) 40%, transparent 70%)',
              filter: 'blur(40px)',
            }}
          />

          {/* VAULT Shield — crystal core */}
          <motion.div
            initial={{ opacity: 0, scale: 0.3, filter: 'blur(12px)' }}
            animate={{
              opacity: phase >= 3 ? 1 : 0.15,
              scale: phase >= 3 ? 1 : 0.5,
              filter: phase >= 3 ? 'blur(0px)' : 'blur(12px)',
            }}
            transition={{ duration: 1.2, ease: [0.2, 0.8, 0.2, 1] }}
            className="relative z-10 mb-10"
          >
            {/* Outer ring */}
            <motion.div
              animate={{ rotate: phase >= 3 ? 360 : 0 }}
              transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
              className="absolute -inset-6"
            >
              <svg width="120" height="120" viewBox="0 0 120 120" className="w-[120px] h-[120px]">
                <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(56,189,248,0.15)" strokeWidth="0.5" strokeDasharray="4 6" />
                <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(139,92,246,0.12)" strokeWidth="0.5" strokeDasharray="2 8" />
              </svg>
            </motion.div>

            {/* Shield icon */}
            <ShieldIcon size={56} intensity={phase} />

            {/* Iridescent halo */}
            {phase >= 2 && (
              <>
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.08, 1] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute -inset-4 rounded-full blur-xl"
                  style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.2) 0%, rgba(139,92,246,0.1) 50%, transparent 70%)' }}
                />
              </>
            )}
          </motion.div>

          {/* Tagline */}
          <AnimatePresence>
            {phase >= 1 && (
              <motion.div
                initial={{ opacity: 0, letterSpacing: '0.5em' }}
                animate={{ opacity: 1, letterSpacing: '0.35em' }}
                exit={{ opacity: 0 }}
                className="text-xs tracking-[0.35em] font-semibold text-slate-400 mb-8 uppercase"
              >
                Distributed Storage Fabric
              </motion.div>
            )}
          </AnimatePresence>

          {/* Phase text */}
          <div className="relative z-10 mb-12 h-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={phase}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.35 }}
                className="flex items-center gap-3"
              >
                <span className="mono text-[10px] text-vault-cyan/50 w-16 text-right">
                  {String(phase).padStart(2, '0')}
                </span>
                <span className="text-sm tracking-[0.25em] text-slate-300 font-medium uppercase">
                  {PHASES[phase]?.text}
                </span>
                {phase >= 5 && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="ml-3 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                  >
                    LIVE
                  </motion.span>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Progress bar */}
          <div className="relative z-10 w-64 h-px bg-white/5 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'linear-gradient(90deg, rgba(56,189,248,0.8), rgba(139,92,246,0.6))' }}
              animate={{ width: `${Math.min(100, ((phase + 1) / PHASES.length) * 100)}%` }}
              transition={{ duration: 0.4 }}
            />
          </div>

          {/* Floating particles around shield */}
          {phase >= 2 && (
            <>
              {Array.from({ length: 24 }).map((_, i) => (
                <FloatingParticle key={i} index={i} active={phase >= 2} />
              ))}
            </>
          )}

          {/* Bottom text */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: phase >= 4 ? 0.35 : 0 }}
            className="absolute bottom-10 text-[10px] text-slate-500 tracking-[0.3em] uppercase"
          >
            Aether Systems — Fault-Tolerant Architecture
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ShieldIcon({ size, intensity }: { size: number; intensity: number }) {
  const opacity = 0.5 + (intensity * 0.12);
  return (
    <svg width={size} height={size} viewBox="0 0 56 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Outer glow */}
      <motion.path
        d="M28 2L52 16V34C52 48 28 62 28 62S4 48 4 34V16L28 2Z"
        stroke={`rgba(56,189,248,${opacity * 0.3})`}
        strokeWidth="1"
        fill={`rgba(56,189,248,${opacity * 0.06})`}
      />
      {/* Main shield */}
      <motion.path
        d="M28 2L52 16V34C52 48 28 62 28 62S4 48 4 34V16L28 2Z"
        stroke={`rgba(56,189,248,${opacity * 0.7})`}
        strokeWidth="1.5"
        fill="none"
      />
      {/* Inner vault symbol */}
      <motion.path
        d="M28 14L40 22V34C40 42 28 50 28 50S16 42 16 34V22L28 14Z"
        stroke={`rgba(56,189,248,${opacity * 0.5})`}
        strokeWidth="1"
        fill={`rgba(56,189,248,${opacity * 0.04})`}
      />
      {/* Lock shape */}
      <motion.rect
        x="23" y="28" width="10" height="8" rx="1.5"
        stroke={`rgba(56,189,248,${opacity * 0.9})`}
        strokeWidth="1.2"
        fill={`rgba(56,189,248,${opacity * 0.1})`}
      />
      <motion.path
        d="M25 28V24C25 22.8954 25.8954 22 27 22H29C30.1046 22 31 22.8954 31 24V28"
        stroke={`rgba(56,189,248,${opacity * 0.9})`}
        strokeWidth="1.2"
        fill="none"
      />
      {/* Keyhole dot */}
      <motion.circle cx="28" cy="32" r="1" fill={`rgba(56,189,248,${opacity})`} />
    </svg>
  );
}

function FloatingParticle({ index, active }: { index: number; active: boolean }) {
  const angle = (index / 24) * Math.PI * 2;
  const radius = 90 + (index % 5) * 20;
  const colors = ['rgba(56,189,248,', 'rgba(139,92,246,', 'rgba(99,102,241,'];
  const color = colors[index % colors.length];
  const size = 1.5 + (index % 3);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{
        opacity: active ? [0.2, 0.7, 0.2] : 0,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.5,
      }}
      transition={{
        duration: 2 + (index % 3),
        repeat: Infinity,
        ease: 'easeInOut',
        delay: index * 0.08,
      }}
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{
        width: size,
        height: size,
        background: color + '0.6)',
        boxShadow: `0 0 ${size * 3}px ${color}0.4)`,
      }}
    />
  );
}
