'use client';
import { useState, useEffect, useCallback } from 'react';
import Particles from '@tsparticles/react';
import { loadSlim } from '@tsparticles/slim';
import type { Engine } from '@tsparticles/engine';

let initialized = false;

export default function AmbientParticles({
  id = 'vault-particles',
  className = '',
  active = true,
}: {
  id?: string;
  className?: string;
  active?: boolean;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (initialized) { setReady(true); return; }
    initialized = true;
    loadSlim(window as unknown as Engine).then(() => setReady(true)).catch(() => setReady(true));
  }, []);

  const options = useCallback(() => ({
    fullScreen: { enable: false },
    fpsLimit: 60,
    particles: {
      number: { value: 28, density: { enable: true, area: 1200 } },
      color: { value: ['#38bdf8', '#6366f1', '#8b5cf6', '#06b6d4'] },
      shape: { type: 'circle' },
      opacity: { value: { min: 0.04, max: 0.2 }, animation: { enable: true, speed: 0.3, sync: false } },
      size: { value: { min: 0.4, max: 1.8 }, animation: { enable: true, speed: 0.4, sync: false } },
      move: {
        enable: true,
        speed: { min: 0.1, max: 0.35 },
        direction: 'none' as const,
        random: true,
        straight: false,
        outModes: { default: 'out' as const },
      },
    },
    detectRetina: true,
    interactivity: {
      events: {
        onHover: { enable: true, mode: 'bubble' as const },
        resize: true,
      },
      modes: { bubble: { distance: 80, size: 3, opacity: 0.25 } },
    },
  }), []);

  if (!active || !ready) return null;

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <Particles id={id} options={options()} />
    </div>
  );
}
