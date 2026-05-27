# Project 3 — DEX-NFT Pawning Dapp

**Group:** GROUP_20 — Lenny Briclet, Valentin Barner  
**Course:** Decentralized Computing and Blockchains (2025/26)

## Prerequisites

- **Node.js v22.13+** (required by Hardhat 3 — Node 18 will not work, Node 24 will also not work)
- npm
- [MetaMask](https://metamask.io/) browser extension
- A Chromium-based browser or Firefox (for the extension)

### Node.js too old? (error on `npm run node`)

If you see `You are using Node.js 18.x which is not supported by Hardhat`, upgrade Node:

**Option A — nvm (recommended)**

```bash
# Install nvm (once)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc   # or restart the terminal

# In PROJECT3/dapp
nvm install
nvm use
node -v          # must show v22.x
npm install
npm run node
```

**Option B — NodeSource (system-wide)**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v          # must show v22.x
```

## Install

```bash
cd PROJECT3/dapp
nvm use
npm install
```

Or use the helper script:

```bash
chmod +x setup.sh
./setup.sh
```

## Commands

| Command             | Description                                                      |
| ------------------- | ---------------------------------------------------------------- |
| `npm run compile`   | Compile Solidity contracts                                       |
| `npm test`          | Run Hardhat tests (27 tests)                                     |
| `npm run node`      | Start local blockchain — **keep running** (terminal 1)           |
| `npm run deploy`    | Deploy contracts to localhost → writes `frontend/addresses.json` |
| `npm run server`    | NFT metadata server on port 3001                                 |
| `npm run frontend`  | Web UI on http://localhost:8080                                  |
| `npm run copy-abis` | Refresh `frontend/js/abis.json` after compile                    |

---

## Run the full stack (4 terminals)

All commands from `PROJECT3/dapp` after `nvm use`.

| Terminal | Command            | Notes                                                             |
| -------- | ------------------ | ----------------------------------------------------------------- |
| **1**    | `npm run node`     | Leave open. RPC: `http://127.0.0.1:8545`                          |
| **2**    | `npm run deploy`   | Run once after terminal 1 is up. Re-run if you restart terminal 1 |
| **3**    | `npm run server`   | Required for NFT mint metadata                                    |
| **4**    | `npm run frontend` | Open http://localhost:8080 (do not use `file://`)                 |

**Automated tests** (no MetaMask needed):

```bash
npm test
```

---

## MetaMask setup (step by step)

This section covers the setup that often blocks first-time runs: **no ETH on local chain**, **wrong network**, or **wrong imported account**.

### Important rules

1. **Only accounts printed by `npm run node` have 10,000 test ETH** on the local chain.
2. **Do not copy private keys from the internet** — Hardhat 3 may use different keys than older tutorials. Always copy from **your** terminal after `npm run node`.
3. Your personal MetaMask account (e.g. `0x90FE...`) has **0 ETH** on Hardhat Local unless someone sends test ETH to it.
4. **“Add funds” / “Buy” in MetaMask does not work** on Hardhat Local — it is not a public network.
5. Use **Import account** (private key), not **Import tokens**.

### Step 1 — Start Hardhat and copy Account #1

Terminal 1:

```bash
npm run node
```

You should see:

```text
Started HTTP and WebSocket JSON-RPC server at http://127.0.0.1:8545/

Accounts
========
Account #0:  0xf39f...  (10000 ETH)
Private Key: 0xac09...

Account #1:  0x70997970c51812dc3a010c7d01b50e0d17dc79c8 (10000 ETH)
Private Key: 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
...
```

**Copy the private key of Account #1** (or #0 for admin tests) from this output.

After import, the address **must** match (e.g. `0x70997970...79c8`). If you see a different address (e.g. `0x1c8A7...`), you pasted the wrong key.

| Account | Role                   | Typical use                            |
| ------- | ---------------------- | -------------------------------------- |
| #0      | Deployer / hub `owner` | Admin tab, deploy                      |
| #1      | Alice                  | Borrower, seller, DEX tests            |
| #2      | Bob                    | Buyer, auction bidder, NFT loan backer |

### Step 2 — Add the Hardhat Local network in MetaMask

1. Open MetaMask → click the **network** dropdown (top).
2. **Add a custom network** / **Add network manually**.
3. Enter:

| Field           | Value                   |
| --------------- | ----------------------- |
| Network name    | `Hardhat Local`         |
| RPC URL         | `http://127.0.0.1:8545` |
| Chain ID        | `31337`                 |
| Currency symbol | `ETH`                   |

4. Save and **select Hardhat Local**.

### Step 3 — Import the test account

1. MetaMask → click the **account icon** or account name (top left).
2. **Add account or hardware wallet** → **Import account**.
3. Paste the **private key from Step 1** (Account #1).
4. Confirm import.
5. Select that account and verify:
   - Network: **Hardhat Local**
   - Balance: about **10,000 ETH** (USD may show $0 — that is normal on a local chain; check the **ETH** line).

### Step 4 — Deploy contracts and open the dapp

Terminal 2 (while terminal 1 still runs):

```bash
npm run deploy
```

Terminals 3 & 4: `npm run server` and `npm run frontend`.

Browser: http://localhost:8080

1. Hard refresh: `Ctrl + Shift + R`
2. Click **Connect MetaMask**
3. Approve connection; if prompted, **switch to Hardhat Local (31337)**

**Success looks like:**

```text
Loaded addresses.json
Connected on chain 31337 — ETH: 10000.0
DEX balance: 0
```

If you see `ETH: 0.0`, you are on the wrong account or wrong network.

### Step 5 — First transaction (Buy DEX)

1. Tab **DEX**
2. **ETH to buy DEX**: `1`
3. **Buy DEX** → MetaMask → **Review alert** (HTTP localhost warning is normal) → **Confirm**
4. Log should show `Tx sent` → `Mined block ...`
5. **DEX balance** should become about `1000000000` (1 ETH worth of DEX at the default swap rate)

---

## MetaMask troubleshooting

| Symptom                                | Cause                                     | Fix                                                       |
| -------------------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| `Insufficient funds`                   | Personal wallet with 0 ETH on chain 31337 | Import Account #1 from `npm run node` output              |
| `DEX balance: -` and no `Connected`    | Wrong network or node not running         | Select Hardhat Local; start `npm run node`                |
| `Wrong network: chain 1, need 31337`   | On Ethereum Mainnet                       | Switch to Hardhat Local before Connect                    |
| `underlying network changed`           | Network switched mid-connect              | Select Hardhat Local first, refresh page, Connect again   |
| Imported account shows `$0` but no ETH | Wrong private key                         | Re-import; address must match terminal (e.g. `0x7099...`) |
| Transactions fail after restart        | New chain state, old `addresses.json`     | `npm run deploy` again, refresh dapp                      |
| `Import tokens` / `Add funds`          | Wrong MetaMask menu                       | Use **Import account** + private key only                 |
| MetaMask HTTP warning                  | Local dev over http://localhost           | Safe to confirm for local testing                         |

---

## Manual UI test flow (short)

Use **Account #1** unless noted. Default swap rate: **1 DEX = 1 gwei**.

### 1. DEX marketplace

- **Buy DEX** with `1` ETH → balance ≈ `1000000000`
- Optional: **Sell DEX** part of balance

### 2. DEX loan (ETH backed by DEX collateral)

- Buy more DEX if needed (e.g. `2` ETH total ≈ `2e9` DEX)
- Tab **DEX Loans** → collateral `2000000000`, duration `180` → **Open loan**
  - Two MetaMask txs: `approve` + `loanDex`
  - Borrowed: **1 ETH**; 3 interest cycles (60 s each)
- **Loan ID** `1` → **Refresh loan info** → `active: true`, `paymentsMade: 0`, `totalCycles: 3`
- Wait **~60 s** between each → **Pay interest cycle** × 3
- **Terminate loan** → DEX collateral returned

### 3. NFT mint

- Terminal 3: `npm run server` must be running
- Tab **NFT** → fill name/description → **Mint NFT**
- Check: `curl http://localhost:3001/nft/0`

### 4. Fixed-price sale

- **Account #1**: list token `0`, price `1000000000000000000` (1 ETH), currency ETH
- **Account #2** (import from terminal): **Buy** listing `1`

### 5. Auction

- **Account #2**: start auction, wait **≥ max wait** (e.g. 120 s), **Finalize**
- **Account #1**: place bid before finalize

### 6. NFT loan

- **Account #1**: **Request loan** on owned token
- **Account #2**: **Fund loan** (needs DEX backing)
- **Account #1**: interest payments → **Terminate**

### 7. Admin (Account #0 only)

- Connect deployer → **Admin** tab → set params / withdraw

---

## Metadata server API

| Method | Route      | Body                                                                         |
| ------ | ---------- | ---------------------------------------------------------------------------- |
| `POST` | `/nft`     | `{ "tokenId": "0", "name": "...", "description": "...", "imageUrl": "..." }` |
| `GET`  | `/nft/:id` | —                                                                            |

The frontend posts metadata after mint; on-chain `tokenURI` points to `http://localhost:3001/nft/{id}`.

---

## Project structure

```
contracts/     DexToken, NftCollection, PawningHub
scripts/       deploy.ts, copy-abis.js
test/          Hardhat tests
frontend/      Web UI (MetaMask + ethers v5)
server/        Express metadata API (port 3001)
legacy/        Original lab starters
docs/          Project PDF
```

## Phase status

- [x] Hardhat + contracts + tests
- [x] Metadata server
- [x] Frontend (English UI)
- [ ] Report + Moodle zip (Step 10)

## Git — commit & push (only this folder)

Repository root: **`PROJECT3/dapp`**  
Remote: `git@github.com:vb213/dapp.git`

```bash
cd PROJECT3/dapp
git status
git add .
git commit -m "your message"
git push
```

**Cursor:** open `PROJECT3/dapp.code-workspace` so Git tracks only `dapp/`.

Ignored: `node_modules/`, `cache/`, `artifacts/`, `types/`, `frontend/addresses.json` (template: `addresses.example.json`), `server/data/metadata.json`.

## Security note

Private keys shown by `npm run node` are **public test keys**. Use them **only** on the local Hardhat network. Never send real funds to these addresses or reuse these keys on mainnet.

## Legacy files

Original starter files are in `legacy/` (`startingContract.sol`, LAB5 Counter examples).
