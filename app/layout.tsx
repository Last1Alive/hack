import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VAULT — Fault-Tolerant Distributed Storage',
  description: 'A fault-tolerant distributed object storage system with replication, integrity verification, automatic repair, and rebalancing.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#050a14] text-foreground min-h-screen relative overflow-x-hidden">
        {/* Layered background */}
        <div className="page-bg fixed inset-0 z-[-1]" />
        <div className="page-grid fixed inset-0 z-0 pointer-events-none" />
        <div className="page-grain fixed inset-0 z-[1] pointer-events-none" />

        {children}
      </body>
    </html>
  );
}
