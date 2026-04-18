# Skeleton Health — Backend API

Cloudflare Workers API for the Skeleton Health platform. Handles IPFS storage, blockchain interactions, and access control.

## What It Does

- **Record Management**: Upload encrypted health records to IPFS, retrieve by hash
- **Blockchain Integration**: Register patients, manage access grants/revocations on Polygon
- **Access Control**: Time-limited provider access with on-chain audit trail
- **IPFS Gateway**: Pin and retrieve encrypted patient data from IPFS

## Tech Stack

- Cloudflare Workers (edge runtime)
- Ethers.js v6 (blockchain interactions)
- IPFS HTTP API (decentralized storage)
- Polygon / Hardhat (smart contract network)

## Setup

```bash
# Copy env template
cp .env.example .env

# Edit with your values
# CONTRACT_ADDRESS — from smart-contracts deployment
# RPC_URL — Polygon RPC endpoint
# IPFS_API_URL — IPFS node API URL

# Install dependencies
npm install

# Run locally
npm start
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | API health check |
| GET | `/config` | Contract & network config |
| GET | `/records/:address` | Get patient records |
| POST | `/ipfs/upload` | Upload data to IPFS |
| GET | `/ipfs/:hash` | Retrieve from IPFS |
| GET | `/access/:patient/:provider` | Check access |
| GET | `/audit/:address` | Get audit logs |

## Architecture

See the [full technical architecture doc](https://github.com/skeleton-health/docs/blob/main/02_TECHNICAL_ARCHITECTURE.md).

## License

MIT — see [LICENSE](LICENSE)
