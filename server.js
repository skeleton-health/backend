import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IPFS_STORAGE = path.join(__dirname, 'ipfs_storage');

// Create IPFS storage directory
if (!fs.existsSync(IPFS_STORAGE)) {
  fs.mkdirSync(IPFS_STORAGE, { recursive: true });
}

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize ethers provider
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

// Contract ABI (simplified for core functions)
const CONTRACT_ABI = [
  'function registerPatient(string memory _did, bytes memory _publicKey) public',
  'function addHealthRecord(string memory _recordType, string memory _ipfsHash) public',
  'function grantAccess(address _provider, uint256 _durationDays) public',
  'function revokeAccess(address _provider) public',
  'function getPatientRecords(address _patient) public view returns (tuple(address patient, string recordType, string ipfsHash, uint256 timestamp)[])',
  'function hasAccess(address _patient, address _provider) public view returns (bool)',
  'function getAuditLogs(address _patient) public view returns (bytes32[])'
];

// Helper to serialize BigInt
function serializeBigInt(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (typeof obj === 'object') {
    if (Array.isArray(obj)) {
      return obj.map(serializeBigInt);
    }
    const result = {};
    for (const key in obj) {
      result[key] = serializeBigInt(obj[key]);
    }
    return result;
  }
  return obj;
}

// AES-256-GCM Encryption/Decryption
function deriveKey(privateKey) {
  // Derive a 32-byte key from the private key using PBKDF2
  const salt = Buffer.from('skeleton-poc-salt', 'utf-8');
  return crypto.pbkdf2Sync(privateKey, salt, 100000, 32, 'sha256');
}

function encryptRecord(data, privateKey) {
  const key = deriveKey(privateKey);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Return IV + authTag + encrypted data (needed for decryption)
  return {
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    data: encrypted
  };
}

function decryptRecord(encryptedObj, privateKey) {
  const key = deriveKey(privateKey);
  const iv = Buffer.from(encryptedObj.iv, 'hex');
  const authTag = Buffer.from(encryptedObj.authTag, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedObj.data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

// Simulate IPFS with file-based storage
const simulateIPFS = {
  add: async (content) => {
    const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 46);
    const filePath = path.join(IPFS_STORAGE, hash);
    fs.writeFileSync(filePath, content);
    return { path: hash };
  },
  cat: async (hash) => {
    const filePath = path.join(IPFS_STORAGE, hash);
    if (!fs.existsSync(filePath)) {
      throw new Error('IPFS hash not found');
    }
    return [fs.readFileSync(filePath)];
  }
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Skeleton API running', timestamp: new Date().toISOString() });
});

// 1. Register patient
app.post('/api/patient/register', async (req, res) => {
  try {
    const { privateKey, did, publicKey } = req.body;

    if (!privateKey || !did || !publicKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, CONTRACT_ABI, wallet);

    const tx = await contract.registerPatient(did, publicKey);
    const receipt = await tx.wait();

    res.json({ success: true, txHash: tx.hash, blockNumber: receipt.blockNumber });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Upload record to file-based IPFS (with AES-256-GCM encryption)
app.post('/api/records/upload', async (req, res) => {
  try {
    const { data, privateKey } = req.body;

    if (!data) {
      return res.status(400).json({ error: 'Missing data' });
    }

    if (!privateKey) {
      return res.status(400).json({ error: 'Missing privateKey for encryption' });
    }

    // Encrypt the data using patient's private key
    const encrypted = encryptRecord(data, privateKey);

    // Store encrypted data in IPFS
    const result = await simulateIPFS.add(JSON.stringify(encrypted));
    const ipfsHash = result.path;

    res.json({ success: true, ipfsHash, encrypted: true, message: 'Record encrypted with AES-256-GCM' });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Add record (call smart contract)
app.post('/api/records/add', async (req, res) => {
  try {
    const { privateKey, recordType, ipfsHash } = req.body;

    if (!privateKey || !recordType || !ipfsHash) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, CONTRACT_ABI, wallet);

    const tx = await contract.addHealthRecord(recordType, ipfsHash);
    const receipt = await tx.wait();

    res.json({ success: true, txHash: tx.hash, blockNumber: receipt.blockNumber });
  } catch (error) {
    console.error('Add record error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Get patient records
app.get('/api/records/:patientAddress', async (req, res) => {
  try {
    const { patientAddress } = req.params;

    const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, CONTRACT_ABI, provider);
    const rawRecords = await contract.getPatientRecords(patientAddress);

    // Convert tuple results to proper objects
    const records = rawRecords.map(r => ({
      patient: r.patient,
      recordType: r.recordType,
      ipfsHash: r.ipfsHash,
      timestamp: r.timestamp.toString()
    }));

    res.json({ success: true, records });
  } catch (error) {
    console.error('Get records error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 5. Grant access
app.post('/api/access/grant', async (req, res) => {
  try {
    const { privateKey, providerAddress, durationDays } = req.body;

    if (!privateKey || !providerAddress || !durationDays) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, CONTRACT_ABI, wallet);

    const tx = await contract.grantAccess(providerAddress, durationDays);
    const receipt = await tx.wait();

    res.json({ success: true, txHash: tx.hash, blockNumber: receipt.blockNumber });
  } catch (error) {
    console.error('Grant access error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. Revoke access
app.post('/api/access/revoke', async (req, res) => {
  try {
    const { privateKey, providerAddress } = req.body;

    if (!privateKey || !providerAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, CONTRACT_ABI, wallet);

    const tx = await contract.revokeAccess(providerAddress);
    const receipt = await tx.wait();

    res.json({ success: true, txHash: tx.hash, blockNumber: receipt.blockNumber });
  } catch (error) {
    console.error('Revoke access error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. Check access
app.get('/api/access/:patientAddress/:providerAddress', async (req, res) => {
  try {
    const { patientAddress, providerAddress } = req.params;

    const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, CONTRACT_ABI, provider);
    const hasAccess = await contract.hasAccess(patientAddress, providerAddress);

    res.json({ success: true, hasAccess });
  } catch (error) {
    console.error('Check access error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 8. Get audit logs
app.get('/api/audit/:patientAddress', async (req, res) => {
  try {
    const { patientAddress } = req.params;

    const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, CONTRACT_ABI, provider);
    const logs = await contract.getAuditLogs(patientAddress);

    res.json({ success: true, logCount: logs.length, logs: serializeBigInt(logs) });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 9. Get record content from file-based IPFS (with decryption support)
app.post('/api/ipfs/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const { privateKey } = req.body;

    const chunks = await simulateIPFS.cat(hash);
    const stored = Buffer.concat(chunks).toString('utf-8');
    const storedObj = JSON.parse(stored);

    // Check if data is encrypted (has iv, authTag, data fields)
    if (storedObj.iv && storedObj.authTag && storedObj.data && privateKey) {
      // Decrypt using patient's private key
      const decrypted = decryptRecord(storedObj, privateKey);
      res.json({ success: true, content: decrypted, encrypted: true, decryptedWith: 'AES-256-GCM' });
    } else if (privateKey && storedObj.iv) {
      // Try to decrypt even if not explicitly marked as encrypted
      try {
        const decrypted = decryptRecord(storedObj, privateKey);
        res.json({ success: true, content: decrypted, encrypted: true, decryptedWith: 'AES-256-GCM' });
      } catch (e) {
        // Not encrypted, return as-is
        res.json({ success: true, content: storedObj, encrypted: false });
      }
    } else {
      // Not encrypted or no key provided
      res.json({ success: true, content: storedObj, encrypted: false });
    }
  } catch (error) {
    console.error('IPFS read error:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`\n✓ Skeleton API running on http://localhost:${PORT}`);
  console.log(`Contract: ${process.env.CONTRACT_ADDRESS}`);
  console.log(`RPC: ${process.env.RPC_URL}`);
  console.log(`Storage: File-based (${IPFS_STORAGE})\n`);
});
