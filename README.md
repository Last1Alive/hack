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
- **Integrity**: SHA-256 checksums per object; full object-level checksum verification
- **Repair**: Automatic background repair cycle detects missing/corrupted replicas and re-replicates from healthy sources
- **Rebalancing**: Background rebalance detects storage imbalance and redistributes objects

## Features

| Feature | Description |
|---------|-------------|
| **Object Upload** | Full-file upload with configurable replication factor |
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

- **Frontend**: Next.js 15 App Router, React 18, Tailwind CSS v3, Framer Motion, Radix UI, tsParticles
- **Backend**: Next.js Serverless Functions
- **Storage Engine**: Node.js native `fs` + `crypto` modules
- **Data Integrity**: SHA-256 checksums
- **State Persistence**: JSON metadata file (`.vault-meta.json`)

---

## Local Setup & Run

```bash
# Install dependencies
yarn install

# Start development server (port 3001)
yarn dev
# Opens at http://localhost:3001

# Build for production
yarn build
yarn start
```

## Deploy to Vercel

This project deploys as a Vercel **Edge Function** stack with serverless API routes.

### One-click deploy

1. Push code to GitHub (this repo)
2. Import at https://vercel.com/new
3. Select this repository → **Deploy**

No additional environment variables are required. Default values are:

| Variable | Default | Note |
|----------|---------|------|
| `VAULT_DEFAULT_REPLICATION_FACTOR` | `3` | How many replicas per object |
| `VAULT_CAPACITY_PER_NODE_BYTES` | `2147483648` | 2 GB per node |
| `VAULT_STORAGE_PATH` | `./storage` | **⚠️ Ephemeral on Vercel** — see notes below |

### ⚠️ Important: Vercel Storage Limitation

Vercel's serverless functions have an **ephemeral filesystem**. Data written to `./storage/` persists across function invocations **within the same container**, but is **lost on redeploy, scale-to-zero, or container rotation**.

For a **persistent production deployment** on Vercel, integrate Vercel KV:

```bash
# Add Vercel KV persistence (optional)
yarn add @vercel/kv

# Then replace metadata-store.ts and node-storage.ts 
# to use KV instead of local filesystem
```

For a **demonstration / showcase** (this project's intended use case), the default file-based storage is fine — uploads work end-to-end and survive page refreshes within a session.

### Production (persistent) alternative

If you need persistent storage across redeployments, deploy as a **Vercel Container** (Pro plan):

```bash
# Set VERCEL_REGION and enable containers in vercel.json
```

Or use a separate storage backend (S3, Supabase, etc.).

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cluster` | Cluster health & metrics |
| GET | `/api/nodes` | List all nodes |
| POST | `/api/nodes` | Fail / recover a node (body: `{nodeId, action}`) |
| GET | `/api/objects` | List all objects with replica status |
| POST | `/api/objects` | Upload new object (multipart/form-data) |
| GET | `/api/objects/{id}` | Get object details |
| DELETE | `/api/objects/{id}` | Delete object |
| POST | `/api/objects/{id}/verify` | Verify integrity of specific object |
| POST | `/api/objects/{id}/download` | Download object data |
| POST | `/api/rebalance` | Trigger manual rebalancing |
| POST | `/api/verify-all` | Run full integrity scan |
| GET | `/api/operations` | Get operation history |
| GET/PUT | `/api/config` | View / update cluster configuration |

---

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
├── vercel.json              # Vercel deployment config
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
- Vercel serverless: storage is ephemeral across scale events

The architecture is designed to be extensible to a real distributed system by replacing the local filesystem abstraction with network RPC calls between independent processes.
