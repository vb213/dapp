import express from "express";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const DATA_FILE = join(DATA_DIR, "metadata.json");

const PORT = Number(process.env.PORT) || 3001;

function loadStore() {
  if (!existsSync(DATA_FILE)) {
    return {};
  }
  return JSON.parse(readFileSync(DATA_FILE, "utf8"));
}

function saveStore(store) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "nft-metadata" });
});

/// Store off-chain metadata for an NFT (no financial logic).
app.post("/nft", (req, res) => {
  const { tokenId, name, description, imageUrl } = req.body ?? {};

  if (tokenId === undefined || tokenId === null) {
    return res.status(400).json({ error: "tokenId is required" });
  }
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "name is required" });
  }

  const id = String(tokenId);
  const store = loadStore();

  store[id] = {
    tokenId: id,
    name,
    description: description ?? "",
    imageUrl: imageUrl ?? "",
    updatedAt: new Date().toISOString(),
  };

  saveStore(store);
  res.status(201).json(store[id]);
});

app.get("/nft/:id", (req, res) => {
  const store = loadStore();
  const entry = store[req.params.id];

  if (!entry) {
    return res.status(404).json({ error: "NFT metadata not found" });
  }

  res.json(entry);
});

const server = app.listen(PORT, () => {
  console.log(`NFT metadata server http://localhost:${PORT}`);
  console.log(`  POST /nft   — save metadata`);
  console.log(`  GET  /nft/:id — read metadata`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    console.error(`  Stop the other process:  fuser -k ${PORT}/tcp`);
    console.error(`  Or use another port:     PORT=3002 npm run server`);
    process.exit(1);
  }
  throw err;
});
