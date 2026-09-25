import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VAULT — Fault-Tolerant Distributed Storage',
  description: 'A fault-tolerant distributed object storage system with replication, integrity verification, automatic repair, and rebalancing.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-foreground min-h-screen">{children}</body>
    </html>
  );
}
