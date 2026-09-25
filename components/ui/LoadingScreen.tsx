import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Server, Database, CheckCircle2 } from 'lucide-react';

const checks = [
  { icon: Shield, label: 'Initializing control plane' },
  { icon: Server, label: 'Discovering storage nodes' },
  { icon: Database, label: 'Loading metadata store' },
  { icon: Shield, label: 'Verifying integrity' },
  { icon: Server, label: 'Checking replication policies' },
];

export default function LoadingScreen({ onReady }: { onReady: () => void }) {
  const [progress, setProgress] = useState(0);
  const [activeCheck, setActiveCheck] = useState(-1);

  useEffect(() => {
    let current = 0;
    const interval = setInterval(() => {
      current++;
      setProgress(Math.min(current * 20, 100));
      if (current < checks.length) setActiveCheck(current);
    }, 300);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      setProgress(100);
      setTimeout(onReady, 400);
    }, 2000);

    return () => { clearTimeout(timeout); clearInterval(interval); };
  }, [onReady]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center loading-screen"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      {/* Logo */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="mb-12 text-center"
      >
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="relative">
            <Shield className="w-12 h-12 text-cyan-400" />
            <div className="absolute inset-0 animate-pulse-glow rounded-full" />
          </div>
          <h1 className="text-5xl font-bold tracking-tight">
            <span className="text-cyan-400 cyan-glow">VAULT</span>
          </h1>
        </div>
        <p className="text-slate-500 text-sm tracking-widest uppercase font-mono">
          Fault-Tolerant Distributed Storage
        </p>
      </motion.div>

      {/* Progress bar */}
      <div className="w-80 mb-6">
        <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-cyan-500 to-blue-500"
            initial={{ width: '0%' }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Checks */}
      <div className="space-y-2 w-80">
        <AnimatePresence>
          {checks.map((check, i) => (
            <motion.div
              key={check.label}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-3 text-sm"
            >
              {i < activeCheck ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : i === activeCheck ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full shrink-0"
                />
              ) : (
                <div className="w-4 h-4 rounded-full border border-slate-700 shrink-0" />
              )}
              <span className={i <= activeCheck ? "text-slate-300" : "text-slate-600"}>
                {check.label}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Status */}
      <motion.p
        className="mt-8 text-xs tracking-widest uppercase font-mono"
        animate={{ color: progress === 100 ? "#10b981" : "#64748b" }}
      >
        {progress === 100 ? "STORAGE FABRIC ONLINE" : "INITIALIZING..."}
      </motion.p>
    </motion.div>
  );
}
