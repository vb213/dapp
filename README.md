# Project 3 — DEX-NFT Pawning Dapp

**Group:** GROUP_20 — Lenny Briclet, Valentin Barner  
**Course:** Decentralized Computing and Blockchains (2025/26)

## Prerequisites

- **Node.js v22.13+** (required by Hardhat 3 — Node 18 will not work)
- npm
- MetaMask (for frontend, later phases)

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

## Install (one command)

```bash
cd PROJECT3/dapp
chmod +x setup.sh
./setup.sh
```

Or manually after `nvm use` (Node 22 required):

```bash
cd PROJECT3/dapp
nvm use
npm install
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile Solidity contracts |
| `npm test` | Run Hardhat tests |
| `npm run node` | Start local blockchain (terminal 1) |
| `npm run deploy` | Deploy to localhost (terminal 2) |

## Quick start (Phase 0)

**Terminal 1** — local chain:

```bash
npm run node
```

**Terminal 2** — deploy:

```bash
npm run deploy
```

This writes `frontend/addresses.json` with the `DexToken` address.

**Terminal 2** — run tests (no node needed, uses built-in simulator):

```bash
npm test
```

## Project structure

```
contracts/     Solidity (DexToken, later NftCollection + PawningHub)
scripts/       deploy.ts
test/          Hardhat tests
frontend/      Web UI (MetaMask + ethers, LAB5 style)
legacy/        Original lab files (Counter, startingContract)
docs/          Project PDF
```

## Phase status

- [x] **Phase 0** — Hardhat setup, DexToken deploy, tests
- [x] **Step 1** — NftCollection (mint / burn / tokenValue) + tests
- [x] **Step 2** — PawningHub DEX loans (loanDex, makeDexPayment, terminateDexLoan, liquidate)
- [x] **Step 3** — Marketplace NFT + enchères (listFixed, buyFixed, listAuction, bid, finalizeAuction)
- [x] **Step 4** — Prêts NFT + backer DEX (requestNftLoan, fundNftLoan, makeNftPayment, terminateNftLoan)
- [ ] **Phase 1** — Frontend
- [ ] **Phase 2** — NFT mint/marketplace
- [ ] **Phase 3** — Auctions
- [ ] **Phase 4** — NFT-backed loans with DEX backer
- [ ] **Phase 5** — Admin console
- [ ] **Phase 6–7** — Full UI, report, Moodle zip

## Git — commit & push (only this folder)

The Git repository root is **`PROJECT3/dapp`**, not `TPs/` nor `BLOCKCHAINS/`.

Remote: `git@github.com:vb213/dapp.git`

Always run Git from inside `dapp`:

```bash
cd PROJECT3/dapp
git status
git add .
git commit -m "your message"
git push
```

**In Cursor:** open the workspace file `PROJECT3/dapp.code-workspace` (or open the `dapp` folder directly).  
Then Source Control only tracks files inside `dapp`.

Files ignored on purpose: `node_modules/`, `cache/`, `artifacts/`, `types/`, `frontend/addresses.json` (use `addresses.example.json` as template).

## Legacy files

Original starter files are in `legacy/` (`startingContract.sol`, LAB5 Counter examples).
