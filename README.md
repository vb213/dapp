# Project 3 — DEX-NFT Pawning Dapp

**Group:** GROUP_20 — Lenny Briclet (66926), Valentin Barner (66958)
**Course:** Decentralized Computing and Blockchains — 2025/26

A decentralized application combining (i) a DEX marketplace for a fungible
token, (ii) an NFT marketplace with fixed-price sales and auctions, and
(iii) two lending mechanisms (DEX-collateralized and NFT-collateralized with
a third-party DEX backer). All financial logic lives in the Solidity
contracts; an Express server only stores NFT metadata (name, description,
image URL).

A complete description of the architecture, design choices and security
considerations is in [`report/report.pdf`](report/report.pdf).

---

## Requirements coverage

| # | Requirement (project statement)            | Implementation                                                                                | File                              |
| - | ------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------- |
| 1 | DEX marketplace (buy/sell DEX vs. ETH)     | `buyDex()`, `sellDex(amount)`                                                                 | `contracts/DexToken.sol`          |
| 2 | ETH lending with DEX collateral (50% LTV)  | `loanDex`, `makeDexPayment`, `terminateDexLoan`, `checkDexLoan`                               | `contracts/PawningHub.sol`        |
| 3 | NFT marketplace (mint/burn, ETH+DEX, **5% to owner**) | `mint`, `burn` + `listFixed`, `buyFixed`, `_collectPayment` (95/5 split, on-the-fly conversion) | `contracts/NftCollection.sol`, `contracts/PawningHub.sol` |
| 4 | NFT auctions (min price + max wait)        | `listAuction`, `bid`, `finalizeAuction`, `cancelListing` (5% fee on settlement)               | `contracts/PawningHub.sol`        |
| 5 | NFT-backed loans with DEX backer (half interest to backer, NFT+DEX to backer on default) | `requestNftLoan`, `fundNftLoan`, `makeNftPayment`, `terminateNftLoan`, `checkNftLoanBacker` | `contracts/PawningHub.sol`        |
| 6 | Administrator console (owner-only params)  | `setPaymentCycle`, `setInterest`, `setTerminationFee`, `setMaxLoanDuration`, `setDexSwapRate`, `withdrawEth/Dex` + Admin tab in the UI | `contracts/PawningHub.sol`, `frontend/index.html` |

Coverage is exercised by **28 Hardhat tests** (all passing), see `test/`.

---

## Prerequisites

- **Node.js 22.x** (Hardhat 3 — Node 18 and 24 are not supported)
- npm
- [MetaMask](https://metamask.io/) browser extension (Chromium-based browser or Firefox)

If Node is older, install nvm and switch:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
cd dapp && nvm install && nvm use
```

---

## Install

```bash
cd dapp
nvm use            # optional, picks the version from .nvmrc
npm install
```

---

## Commands

| Command             | Description                                                      |
| ------------------- | ---------------------------------------------------------------- |
| `npm run compile`   | Compile Solidity contracts                                       |
| `npm test`          | Run the 28 Hardhat tests                                         |
| `npm run node`      | Start a local Hardhat blockchain (chain ID `31337`)              |
| `npm run deploy`    | Deploy contracts → writes `frontend/addresses.json`              |
| `npm run server`    | NFT metadata server on port 3001                                 |
| `npm run frontend`  | Static web UI on http://localhost:8080                           |
| `npm run copy-abis` | Refresh `frontend/js/abis.json` after a recompile                |

---

## Run the full stack (4 terminals)

All commands from `dapp/`.

| Terminal | Command            | Notes                                                             |
| -------- | ------------------ | ----------------------------------------------------------------- |
| **1**    | `npm run node`     | Leave open. RPC: `http://127.0.0.1:8545`, chain ID `31337`.       |
| **2**    | `npm run deploy`   | Run once after terminal 1 is up. Re-run if you restart terminal 1.|
| **3**    | `npm run server`   | Required so the NFT mint flow can persist metadata.               |
| **4**    | `npm run frontend` | Open http://localhost:8080 (do not open the HTML via `file://`).  |

**Automated tests only** (no MetaMask, no running node):

```bash
npm test
```

---

## MetaMask setup (one-time, ~2 minutes)

The dapp expects an account that holds ETH on the local Hardhat chain. The
only accounts with test ETH are the ones printed by `npm run node`.

### 1. Start Hardhat and pick an account

```bash
npm run node
```

The output lists 20 accounts with their private keys. Use:

| Account | Role                   | Suggested usage                                |
| ------- | ---------------------- | ---------------------------------------------- |
| #0      | Deployer / hub `owner` | Admin tab, withdrawals, parameter changes      |
| #1      | Alice                  | Borrower, seller, DEX-loan flows               |
| #2      | Bob                    | Buyer, auction bidder, NFT-loan backer         |

### 2. Add the Hardhat Local network

MetaMask → network dropdown → **Add a custom network**:

| Field           | Value                   |
| --------------- | ----------------------- |
| Network name    | `Hardhat Local`         |
| RPC URL         | `http://127.0.0.1:8545` |
| Chain ID        | `31337`                 |
| Currency symbol | `ETH`                   |

### 3. Import a test account

MetaMask → account menu → **Add account or hardware wallet** → **Import
account** → paste the private key copied from Step 1. The resulting address
must match the terminal output.

### 4. Deploy and open the dapp

```bash
npm run deploy
npm run server
npm run frontend
```

Open http://localhost:8080, click **Connect MetaMask**, and approve.

A successful connection shows in the on-page log:

```text
Loaded addresses.json
Connected on chain 31337 — ETH: 10000.0
DEX balance: 0
```

---

## Manual demo (covers the 6 requirements)

Default swap rate after deploy: **1 DEX = 1 gwei**. Use Account #1 unless
noted.

1. **DEX marketplace.** Tab **DEX** → buy `1` ETH worth of DEX
   (balance ≈ `1 000 000 000`); optionally sell some back.
2. **DEX loan.** Tab **DEX Loans** → collateral `2 000 000 000`,
   duration `180` → **Open loan** (two MetaMask txs: `approve`, then
   `loanDex`). Borrowed: 1 ETH, 3 interest cycles. Wait 60 s between each
   cycle → **Pay interest cycle** ×3 → **Terminate loan** to recover the
   collateral.
3. **NFT mint.** Tab **NFT** → name/description → **Mint NFT**. The
   metadata server stores the off-chain JSON; verify with
   `curl http://localhost:3001/nft/0`.
4. **Fixed-price sale.** As Account #1, list token `0` for
   `1000000000000000000` wei (1 ETH). As Account #2, **Buy** listing `1`.
   Seller receives 0.95 ETH, the contract owner receives 0.05 ETH.
5. **Auction.** As Account #2, **Start auction** (min `1`, max wait `120 s`).
   As Account #1, **Place bid** (≥ min) before the deadline.
   **Finalize auction** after the wait elapses → 95% to seller, 5% to owner.
6. **NFT loan with backer.** As Account #1, **Request loan** on an owned
   token. As Account #2, **Fund loan** (DEX backing). Pay interest cycles;
   **Terminate** to recover the NFT and return the DEX to the backer. On
   default, the NFT and the DEX backing are both transferred to the backer.
7. **Administrator console.** Connect as Account #0 (deployer) → **Admin**
   tab (only visible to the contract owner) → adjust parameters or withdraw.

---

## MetaMask troubleshooting

| Symptom                                | Cause                                     | Fix                                                       |
| -------------------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| `Insufficient funds`                   | Personal wallet with 0 ETH on chain 31337 | Import Account #1 from the `npm run node` output          |
| `DEX balance: -` and no `Connected`    | Wrong network or node not running         | Select Hardhat Local; start `npm run node`                |
| `Wrong network: chain 1, need 31337`   | Connected to Ethereum Mainnet             | Switch to Hardhat Local before clicking Connect           |
| `underlying network changed`           | Network switched mid-connect              | Select Hardhat Local first, refresh, Connect again        |
| Transactions fail after a node restart | New chain state, stale `addresses.json`   | Re-run `npm run deploy`, then refresh the dapp            |
| MetaMask HTTP warning                  | Local dev over `http://localhost`         | Safe to confirm for local testing only                    |

---

## Metadata server API

| Method | Route      | Body                                                                         |
| ------ | ---------- | ---------------------------------------------------------------------------- |
| `POST` | `/nft`     | `{ "tokenId": "0", "name": "...", "description": "...", "imageUrl": "..." }` |
| `GET`  | `/nft/:id` | —                                                                            |

The frontend POSTs metadata right after a mint; the on-chain `tokenURI`
points at `http://localhost:3001/nft/{id}`. The server holds **no funds**
and makes **no financial decision**.

---

## Project structure

```
contracts/   DexToken.sol, NftCollection.sol, PawningHub.sol
scripts/     deploy.ts, copy-abis.js
test/        Hardhat tests (28 passing)
frontend/    Static web UI (HTML + ethers v5 + MetaMask)
server/      Express metadata API (port 3001)
report/      report.pdf (architecture + AI-usage section), report.tex, figures/
docs/        Original project statement (dcb26-proj3.pdf)
```

---

## Security notes

- All money handling is on-chain. The metadata server holds no funds.
- The hub uses OpenZeppelin's `ReentrancyGuard`, `SafeERC20` and `Ownable`;
  state updates always precede external calls (Checks-Effects-Interactions).
- The private keys printed by `npm run node` are **public test keys**.
  Use them only on the local Hardhat network — never on a public chain.
