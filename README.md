# VAULT — Fault-Tolerant Distributed Object Storage

A fault-tolerant distributed object storage system with configurable replication, integrity verification, automatic repair, and rebalancing — demonstrated through a premium control interface.

## Architecture

Vault implements a **locally executable distributed-storage model** with independently simulated storage nodes. Each node is represented as an isolated directory on the local filesystem, enabling realistic failure simulation while maintaining the full distributed-system semantics.

### Core Components

```
┌─────────────────────────────────────────────┐
│              VAULT Web UI                   │
│         (Next.js 15 + React)                │
└───────────────────┬─────────────────────────┘
                    │
┌───────────────────▼─────────────────────────┐
│           API / Control Plane               │
│        (Next.js Server Routes)              │
└───────────────────┬─────────────────────────┘
                    │
┌───────────────────▼─────────────────────────┐
│          VaultEngine (Coordination Layer)   │
│  • Object chunking & distribution            │
│  • Replication scheduling                    │
│  • Integrity verification                    │
│  • Automatic repair                          │
│  • Background rebalancing                    │
└───────────────────┬─────────────────────────┘
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
 ┌───────┐     ┌───────┐     ┌───────┐
 │NODE 01│     │NODE 02│     │NODE 03│  ...
 │Storage│     │Storage│     │Storage│
 └───────┘     └───────┘     └───────┘
```

### Consistency Model

- **Write Policy**: Majority ACK (data acknowledged after writing to a majority of replicas)
- **Read Policy**: Quorum read (reads require at least 2 valid replicas)
- **Replication**: Configurable factor (1–N nodes), spread across nodes avoiding single points of failure
- **Integrity**: SHA-256 checksums per chunk; full object-level checksum verification
- **Repair**: Automatic background repair cycle detects missing/corrupted replicas and re-replicates from healthy sources
- **Rebalancing**: Background rebalance detects storage imbalance and redistributes chunks

## Features

| Feature | Description |
|---------|-------------|
| **Object Upload** | Chunk-based upload with configurable replication factor |
| **Replication** | Automatic multi-node replica distribution |
| **Node Failure** | Simulate offline nodes; system continues serving from remaining replicas |
| **Data Corruption** | Inject corruption; system detects via SHA-256 verification |
| **Automatic Repair** | Missing/corrupted replicas are recreated from healthy sources |
| **Network Partitions** | Simulate network partitions between node pairs |
| **Rebalancing** | Redistribute data when nodes have uneven storage utilization |
| **Integrity Verification** | Full or per-object checksum verification |
| **Operation Audit** | Live activity stream of all cluster operations |

## Demo Flow

1. **Upload** an object → observe replicas spreading across nodes
2. **Inspect** object details → see replica locations and checksums
3. **Verify** integrity → confirm all replicas are valid
4. **Fail a node** → availability drops, replicas marked as missing
5. **Corrupt a replica** → integrity check detects mismatch
6. **Recover the node** → automatic repair recreates lost/corrupted replica
7. **Rebalance** → redistribute data across evenly-utilized nodes
8. **Return to healthy** → all nodes healthy, all objects valid

## Technology Stack

- **Frontend**: Next.js 15 App Router, React 18, Tailwind CSS, Framer Motion, Radix UI
- **Backend**: Next.js API routes (serverless functions)
- **Storage Engine**: Node.js native `fs` + `crypto` modules
- **Data Integrity**: SHA-256 checksums
- **State Persistence**: JSON metadata file (`.vault-meta.json`)

## Setup & Run

```bash
# Install dependencies
yarn install

# Start development server
yarn dev
# Opens at http://localhost:3001

# Build for production
yarn build
yarn start
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cluster` | Cluster health & metrics |
| GET | `/api/nodes` | List all nodes |
| POST | `/api/nodes/{id}` | Fail / recover a node |
| POST | `/api/nodes/{id}` | Corrupt replica (with objectId, chunkIndex) |
| POST | `/api/nodes/{id}` | Partition / heal network partition |
| GET | `/api/objects` | List all objects with replica status |
| POST | `/api/objects` | Upload new object (multipart/form-data) |
| GET | `/api/objects/{id}` | Get object details |
| DELETE | `/api/objects/{id}` | Delete object |
| POST | `/api/objects/{id}/verify` | Verify integrity of specific object |
| POST | `/api/rebalance` | Trigger manual rebalancing |
| POST | `/api/verify-all` | Run full integrity scan |
| GET | `/api/operations` | Get operation history |

## Project Structure

```
Vault/
├── app/
│   ├── api/                 # API routes
│   ├── page.tsx             # Main dashboard
│   ├── layout.tsx
│   └── globals.css
├── engine/                  # Core storage engine
│   ├── vault-engine.ts      # Main engine class
│   ├── metadata-store.ts    # Persistent metadata
│   ├── node-storage.ts      # Filesystem node simulation
│   └── types.ts             # Type definitions
├── components/              # React UI components
├── storage/                 # Runtime node storage (gitignored)
├── package.json
├── tsconfig.json
└── tailwind.config.js
```

## Limitations

This is a **local simulation** of a distributed storage system, not a production deployment:

- Nodes run on a single machine (no true network distribution)
- "Network partitions" are simulated via in-memory state
- Filesystem-based storage is used instead of a real distributed filesystem
- Limited to ~4 nodes in the default configuration

The architecture is designed to be extensible to a real distributed system by replacing the local filesystem abstraction with network RPC calls between independent processes.
