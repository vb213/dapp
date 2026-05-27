/* global ethers */
const METADATA_BASE = "http://localhost:3001";
const Currency = { ETH: 0, DEX: 1 };

let addresses = {};
let abis = {};
let provider;
let signer;
let dex;
let nft;
let hub;
let userAddress;

function log(msg) {
  const el = document.getElementById("log");
  const line = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  el.textContent = line + el.textContent;
  console.log(msg);
}

/** Format any integer/BigNumber with "." as thousand separator: 1000000000 -> 1.000.000.000 */
function fmt(value) {
  if (value === null || value === undefined) return "-";
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Format a wei BigNumber as ETH with up to 6 decimals, dot separators. */
function fmtEth(weiBN) {
  if (!weiBN) return "-";
  const str = ethers.utils.formatEther(weiBN);
  const [intPart, decPart = ""] = str.split(".");
  const intFmt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dec = decPart.replace(/0+$/, "").slice(0, 6);
  return dec ? `${intFmt},${dec} ETH` : `${intFmt} ETH`;
}

function shortAddr(addr) {
  if (!addr || addr === ethers.constants.AddressZero) return "-";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Extract a human-friendly message from an ethers/MetaMask error. */
function formatTxError(err) {
  if (err?.message && err.message.startsWith("You don't own"))
    return err.message;
  if (err?.message && err.message.includes("does not exist"))
    return err.message;
  const reason =
    err?.error?.data?.message ||
    err?.data?.message ||
    err?.reason ||
    err?.message;
  if (!reason) return "Transaction failed";
  const match = reason.match(/'([^']+)'/);
  return match ? match[1] : reason;
}

/** Wrap an async handler so any error is logged cleanly instead of crashing silently. */
function safeHandler(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(err);
      log(`Error: ${formatTxError(err)}`);
    }
  };
}

// Catch-all so any rejection from an onclick handler ends up in the UI log
window.addEventListener("unhandledrejection", (event) => {
  console.error(event.reason);
  log(`Error: ${formatTxError(event.reason)}`);
  event.preventDefault();
});

/** Convert a user-typed amount to the on-chain value based on currency.
 *  ETH: "2"   -> 2 * 10^18 wei
 *  DEX: "2.000.000.000" -> 2_000_000_000 (raw units, dots are stripped) */
function priceToOnChain(input, currency) {
  const trimmed = String(input).replace(/\./g, "").trim();
  if (currency === Currency.ETH) {
    // For ETH, keep decimal handling via parseEther on the user's original input
    return ethers.utils.parseEther(String(input).trim());
  }
  return ethers.BigNumber.from(trimmed);
}

/** Read an integer-only input, stripping thousand-separator dots. */
function rawInt(id) {
  return document.getElementById(id).value.replace(/\./g, "").trim();
}

/** Format a digit string with "." as thousand separator. */
function formatIntStr(str) {
  const digits = String(str).replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Attach live thousand-separator formatting on every input[data-fmt-int]. */
function attachIntFormatters() {
  document.querySelectorAll("[data-fmt-int]").forEach((el) => {
    el.value = formatIntStr(el.value);
    el.setAttribute("inputmode", "numeric");
    el.addEventListener("input", () => {
      const before = el.value;
      const caret = el.selectionStart || 0;
      const digitsBefore = before.slice(0, caret).replace(/[^\d]/g, "").length;
      const formatted = formatIntStr(before);
      el.value = formatted;
      let cursor = 0;
      let digitsSeen = 0;
      for (let i = 0; i < formatted.length && digitsSeen < digitsBefore; i++) {
        if (/\d/.test(formatted[i])) digitsSeen++;
        cursor = i + 1;
      }
      el.setSelectionRange(cursor, cursor);
    });
  });
}

async function loadConfig() {
  const res = await fetch("addresses.json");
  addresses = await res.json();
  const abiRes = await fetch("js/abis.json");
  abis = await abiRes.json();
  log("Loaded addresses.json");
}

function freshProvider() {
  return new ethers.providers.Web3Provider(window.ethereum);
}

function waitForChain(expectedDecimal) {
  const expectedHex = "0x" + Number(expectedDecimal).toString(16);
  return new Promise((resolve) => {
    if (window.ethereum.chainId?.toLowerCase() === expectedHex.toLowerCase()) {
      resolve();
      return;
    }
    const onChain = () => {
      window.ethereum.removeListener("chainChanged", onChain);
      resolve();
    };
    window.ethereum.on("chainChanged", onChain);
    setTimeout(resolve, 1000);
  });
}

/** Switch MetaMask to Hardhat (31337) and return a new provider (required after chain change). */
async function ensureLocalNetwork() {
  const expected = addresses.chainId || "31337";
  const chainIdHex = "0x" + Number(expected).toString(16);

  let p = freshProvider();
  let net = await p.getNetwork();
  if (net.chainId.toString() === expected) return p;

  log(
    `Wrong network: MetaMask is on chain ${net.chainId}, need ${expected} (Hardhat local)`,
  );

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (switchErr) {
    if (switchErr.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0x7a69",
            chainName: "Hardhat Local",
            rpcUrls: ["http://127.0.0.1:8545"],
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          },
        ],
      });
    } else if (switchErr.code === 4001) {
      throw new Error(
        "Network switch rejected. Select Hardhat Local (31337) in MetaMask.",
      );
    } else {
      throw switchErr;
    }
  }

  await waitForChain(expected);
  p = freshProvider();
  net = await p.getNetwork();
  if (net.chainId.toString() !== expected) {
    throw new Error(
      `Still on chain ${net.chainId}. In MetaMask choose "Hardhat Local" (31337), then click Connect again.`,
    );
  }
  log("Network OK: Hardhat local (31337)");
  return p;
}

async function connectWallet() {
  if (!window.ethereum) {
    alert("Install MetaMask");
    return;
  }
  if (!addresses.dexToken) {
    log("Wait: addresses.json not loaded yet. Refresh the page.");
    return;
  }

  try {
    await window.ethereum.request({ method: "eth_requestAccounts" });

    provider = await ensureLocalNetwork();
    signer = provider.getSigner();
    userAddress = await signer.getAddress();

    document.getElementById(
      "walletStatus",
    ).textContent = `Wallet: ${userAddress.slice(0, 6)}...${userAddress.slice(
      -4,
    )} (chain 31337)`;

    dex = new ethers.Contract(addresses.dexToken, abis.DexToken, signer);
    nft = new ethers.Contract(
      addresses.nftCollection,
      abis.NftCollection,
      signer,
    );
    hub = new ethers.Contract(addresses.pawningHub, abis.PawningHub, signer);

    await refreshDexBalance();

    const owner = await hub.owner();
    if (owner.toLowerCase() === userAddress.toLowerCase()) {
      document.getElementById("tabAdmin").style.display = "inline-block";
      await refreshAdminBalances();
    }

    const ethBal = await provider.getBalance(userAddress);
    log(
      `Connected on chain ${
        addresses.chainId
      } — ETH: ${ethers.utils.formatEther(ethBal)}`,
    );
    try {
      await refreshAccountsAndNfts();
    } catch (_) {}
  } catch (e) {
    log("Connect failed: " + (e.message || e));
    console.error(e);
    document.getElementById("dexBalance").textContent = "-";
  }
  hub.on("DebugLog", (message, value) => {
    console.log(`Contract: ${message} = ${value}`);
  });
}

async function refreshDexBalance() {
  if (!dex || !userAddress) return;
  const bal = await dex.balanceOf(userAddress);
  document.getElementById("dexBalance").textContent = fmt(bal);
}

async function waitTx(tx) {
  log(`Tx sent: ${tx.hash}`);
  const receipt = await tx.wait();
  log(`Mined block ${receipt.blockNumber}`);
  try {
    if (typeof refreshAccountsAndNfts === "function")
      await refreshAccountsAndNfts();
  } catch (e) {
    console.error("Global refresh failed:", e);
  }
  return receipt;
}

async function approveDex(spender, amount) {
  const tx = await dex.approve(spender, amount);
  await waitTx(tx);
}

async function approveNft(tokenId) {
  // Pre-checks to give a clear error instead of a raw revert
  let owner;
  try {
    owner = await nft.ownerOf(tokenId);
  } catch (_e) {
    throw new Error(
      `NFT #${tokenId} does not exist. Check "Refresh NFT list" to see existing IDs.`,
    );
  }
  const me = (await signer.getAddress()).toLowerCase();
  if (owner.toLowerCase() !== me) {
    throw new Error(
      `You don't own NFT #${tokenId}. Current owner: ${shortAddr(
        owner,
      )}. Switch MetaMask account or pick another token.`,
    );
  }
  const tx = await nft.approve(addresses.pawningHub, tokenId);
  await waitTx(tx);
}

// --- DEX ---
document.getElementById("btnBuyDex").onclick = async () => {
  const eth = ethers.utils.parseEther(
    document.getElementById("buyEthAmount").value,
  );
  await waitTx(await dex.buyDex({ value: eth }));
  await refreshDexBalance();
};

document.getElementById("btnSellDex").onclick = async () => {
  const amount = rawInt("sellDexAmount");
  await waitTx(await dex.sellDex(amount));
  await refreshDexBalance();
};

// --- DEX loans ---
document.getElementById("btnLoanDex").onclick = async () => {
  const amount = rawInt("loanDexAmount");
  const duration = document.getElementById("loanDuration").value;
  await approveDex(addresses.pawningHub, amount);
  const tx = await hub.loanDex(amount, duration);
  await waitTx(tx);
  log("Loan opened - check loan ID in events");
};

document.getElementById("btnDexPayment").onclick = async () => {
  const id = document.getElementById("dexLoanId").value;
  const loan = await hub.getDexLoan(id);
  const cycle = loan.totalInterest.div(loan.totalCycles);
  await waitTx(await hub.makeDexPayment(id, { value: cycle }));
};

document.getElementById("btnTerminateDex").onclick = async () => {
  const id = document.getElementById("dexLoanId").value;
  const loan = await hub.getDexLoan(id);
  const paid = loan.totalInterest.div(loan.totalCycles).mul(loan.paymentsMade);
  const remaining = loan.totalInterest.sub(paid);
  const fee = await hub.terminationFee();
  const total = loan.amount.add(remaining).add(fee);
  await waitTx(await hub.terminateDexLoan(id, { value: total }));
  await refreshDexBalance();
};

document.getElementById("btnRefreshDexLoan").onclick = async () => {
  if (!provider) provider = freshProvider();
  const infoEl = document.getElementById("dexLoanInfo");
  try {
    const counterBn = await hub.loanCounter();
    const count = counterBn.toNumber ? counterBn.toNumber() : Number(counterBn);
    if (count === 0) {
      infoEl.innerHTML = "<p>No loans</p>";
      return;
    }

    const latestBlock = await provider.getBlock("latest");
    const now = latestBlock.timestamp;

    let html =
      '<table class="loan-table"><thead><tr><th>Loan ID</th><th>Seconds Until Expired</th><th>Payments Made</th><th>Active</th><th>Borrower</th></tr></thead><tbody>';

    for (let i = 1; i <= count; i++) {
      try {
        const loan = await hub.getDexLoan(i);
        const borrower = loan.borrower;
        const paymentsMade = loan.paymentsMade.toString
          ? loan.paymentsMade.toString()
          : String(loan.paymentsMade);
        const active = loan.active;
        const deadline = loan.deadline.toNumber
          ? loan.deadline.toNumber()
          : Number(loan.deadline);
        const secondsUntilExpired = Math.max(0, deadline - now);

        const rowClass = active ? "" : "inactive";
        html += `<tr class="${rowClass}"><td>${i}</td><td>${secondsUntilExpired}</td><td>${paymentsMade}</td><td>${active}</td><td>${borrower}</td></tr>`;
      } catch (err) {
        html += `<tr><td>${i}</td><td colspan=4>Error</td></tr>`;
      }
    }

    html += "</tbody></table>";
    infoEl.innerHTML = html;
  } catch (e) {
    infoEl.textContent = "Error refreshing loans: " + (e.message || e);
  }
};

// --- NFT ---
document.getElementById("btnMintNft").onclick = async () => {
  const valueWei = ethers.utils.parseEther(
    document.getElementById("nftValueEth").value,
  );
  const before = await nft.totalMinted();
  const uri = `${METADATA_BASE}/nft/${before}`;

  const tx = await nft.mint(uri, valueWei);
  await waitTx(tx);
  const tokenId = before.toString();

  await fetch(`${METADATA_BASE}/nft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenId,
      name: document.getElementById("nftName").value,
      description: document.getElementById("nftDesc").value,
      imageUrl: document.getElementById("nftImage").value,
    }),
  });
  log(`Minted NFT #${tokenId} - metadata saved`);
};

document.getElementById("btnBurnNft").onclick = async () => {
  const id = document.getElementById("burnTokenId").value;
  await waitTx(await nft.burn(id));
};

// --- Marketplace ---
document.getElementById("btnListFixed").onclick = async () => {
  const tokenId = document.getElementById("listTokenId").value;
  await approveNft(tokenId);
  const currency = Number(document.getElementById("listCurrency").value);
  const price = priceToOnChain(
    document.getElementById("listPrice").value,
    currency,
  );
  const tx = await hub.listFixed(tokenId, price, currency);
  await waitTx(tx);
  log(
    `Listed token #${tokenId} for ${
      currency === Currency.ETH ? fmtEth(price) : fmt(price) + " DEX"
    }`,
  );
};

document.getElementById("btnBuyFixed").onclick = async () => {
  const listingId = document.getElementById("buyListingId").value;
  const listing = await hub.getListing(listingId);
  const mode = document.getElementById("buyPayMode").value;
  const rate = ethers.BigNumber.from(
    addresses.dexSwapRate || (await dex.dexSwapRate()),
  );

  const cur = listing.currency.toNumber
    ? listing.currency.toNumber()
    : Number(listing.currency);
  if (cur === Currency.ETH) {
    if (mode === "eth") {
      await waitTx(await hub.buyFixed(listingId, { value: listing.price }));
    } else {
      const dexAmt = listing.price.div(rate);
      await approveDex(addresses.pawningHub, dexAmt);
      await waitTx(await hub.buyFixed(listingId));
    }
  } else {
    if (mode === "eth") {
      const eth = listing.price.mul(rate);
      await waitTx(await hub.buyFixed(listingId, { value: eth }));
    } else {
      await approveDex(addresses.pawningHub, listing.price);
      await waitTx(await hub.buyFixed(listingId));
    }
  }
  await refreshDexBalance();
};

document.getElementById("btnCancelListing").onclick = async () => {
  const id = document.getElementById("buyListingId").value;
  await waitTx(await hub.cancelListing(id));
};

// --- Auctions ---
document.getElementById("btnListAuction").onclick = async () => {
  const tokenId = document.getElementById("aucTokenId").value;
  await approveNft(tokenId);
  const currency = Number(document.getElementById("aucCurrency").value);
  const minPrice = priceToOnChain(
    document.getElementById("aucMinPrice").value,
    currency,
  );
  const wait = document.getElementById("aucWait").value;
  const tx = await hub.listAuction(tokenId, minPrice, wait, currency);
  await waitTx(tx);
  log(
    `Auction started for token #${tokenId}, min ${
      currency === Currency.ETH ? fmtEth(minPrice) : fmt(minPrice) + " DEX"
    }`,
  );
};

document.getElementById("btnBid").onclick = async () => {
  const listingId = document.getElementById("aucListingId").value;
  const listing = await hub.getListing(listingId);
  const cur = listing.currency.toNumber
    ? listing.currency.toNumber()
    : Number(listing.currency);
  const amount = priceToOnChain(
    document.getElementById("aucBidAmount").value,
    cur,
  );

  if (cur === Currency.ETH) {
    await waitTx(await hub.bid(listingId, 0, { value: amount }));
  } else {
    await approveDex(addresses.pawningHub, amount);
    await waitTx(await hub.bid(listingId, amount));
  }
};

document.getElementById("btnFinalize").onclick = async () => {
  const id = document.getElementById("aucListingId").value;
  await waitTx(await hub.finalizeAuction(id));
};

// --- NFT loans ---
document.getElementById("btnRequestNftLoan").onclick = async () => {
  const tokenId = document.getElementById("nftLoanTokenId").value;
  await approveNft(tokenId);
  const tx = await hub.requestNftLoan(
    tokenId,
    document.getElementById("nftLoanDuration").value,
  );
  await waitTx(tx);
};

document.getElementById("btnFundNftLoan").onclick = async () => {
  const loanId = document.getElementById("nftLoanId").value;
  const required = await hub.requiredDexBacking(loanId);
  await approveDex(addresses.pawningHub, required);
  await waitTx(await hub.fundNftLoan(loanId));
  await refreshDexBalance();
};

document.getElementById("btnNftPayment").onclick = async () => {
  const id = document.getElementById("nftLoanId").value;
  const loan = await hub.getNftLoan(id);
  const cycle = loan.totalInterest.div(loan.totalCycles);
  await waitTx(await hub.makeNftPayment(id, { value: cycle }));
};

document.getElementById("btnTerminateNft").onclick = async () => {
  const id = document.getElementById("nftLoanId").value;
  const loan = await hub.getNftLoan(id);
  const paid = loan.totalInterest.div(loan.totalCycles).mul(loan.paymentsMade);
  const remaining = loan.totalInterest.sub(paid);
  const fee = await hub.terminationFee();
  const total = loan.amount.add(remaining).add(fee);
  await waitTx(await hub.terminateNftLoan(id, { value: total }));
};

document.getElementById("btnCheckNftLoan").onclick = async () => {
  const id = document.getElementById("nftLoanId").value;
  const loan = await hub.getNftLoan(id);
  await waitTx(await hub.checkNftLoanBacker(id));
};

document.getElementById("btnCancelNftRequest").onclick = async () => {
  const id = document.getElementById("nftLoanId").value;
  await waitTx(await hub.cancelNftLoanRequest(id));
};

// --- NFT loans: refresh panel ---
document.getElementById("btnRefreshNftLoans").onclick = async () => {
  if (!provider) provider = freshProvider();
  const panel = document.getElementById("nftLoansPanel");
  try {
    const counterBn = await hub.nftLoanCounter();
    const count = counterBn.toNumber ? counterBn.toNumber() : Number(counterBn);
    const latestBlock = await provider.getBlock("latest");
    const now = latestBlock.timestamp;

    const fundedRows = [];
    const pendingRows = [];

    for (let i = 1; i <= count; i++) {
      try {
        const l = await hub.getNftLoan(i);
        const borrower = l.borrower;
        if (!borrower || borrower === ethers.constants.AddressZero) continue;
        const tokenId = l.tokenId.toString
          ? l.tokenId.toString()
          : String(l.tokenId);
        const amount = l.amount;
        const paymentsMade = l.paymentsMade.toString
          ? l.paymentsMade.toString()
          : String(l.paymentsMade);
        const backer =
          l.backer && l.backer !== ethers.constants.AddressZero
            ? l.backer
            : "-";
        const deadline = l.deadline.toNumber
          ? l.deadline.toNumber()
          : Number(l.deadline);
        const secondsUntilExpired = Math.max(0, deadline - now);

        if (l.funded) {
          fundedRows.push([
            i,
            shortAddr(borrower),
            shortAddr(backer),
            fmtEth(amount),
            tokenId,
            paymentsMade,
            `${secondsUntilExpired}s`,
          ]);
        } else {
          pendingRows.push([i, shortAddr(borrower), tokenId, fmtEth(amount)]);
        }
      } catch (err) {
        // skip errors per-entry
      }
    }

    let html = "";
    if (fundedRows.length > 0) {
      html += renderTable(
        [
          "Loan ID",
          "Borrower",
          "Backer",
          "Amount",
          "Token ID",
          "Payments Made",
          "Seconds Until Expiration",
        ],
        fundedRows,
      );
    } else {
      html += "<p>No funded NFT loans.</p>";
    }

    html += "<hr/>";

    if (pendingRows.length > 0) {
      html += renderTable(
        ["Loan ID", "Borrower", "Token ID", "Amount"],
        pendingRows,
      );
    } else {
      html += "<p>No pending NFT loan requests.</p>";
    }

    panel.innerHTML = html;
  } catch (e) {
    panel.textContent = "Error refreshing NFT loans: " + (e.message || e);
  }
};

// --- Admin ---
async function refreshAdminBalances() {
  document.getElementById("hubEth").textContent = fmtEth(
    await hub.getEthBalance(),
  );
  document.getElementById("hubDex").textContent = fmt(
    await hub.getDexBalance(),
  );
}

// --- NFT list (global view) ---
async function refreshNftList() {
  if (!nft) {
    log("Connect MetaMask first");
    return;
  }
  const container = document.getElementById("nftListContainer");
  container.innerHTML = "<em>Loading…</em>";

  const total = Number(await nft.totalMinted());
  if (total === 0) {
    container.innerHTML = "<em>No NFTs minted yet.</em>";
    return;
  }

  const rows = [];
  for (let id = 0; id < total; id++) {
    try {
      const owner = await nft.ownerOf(id);
      const value = await nft.tokenValue(id);
      let name = "(no metadata)";
      try {
        const uri = await nft.tokenURI(id);
        const res = await fetch(uri);
        if (res.ok) {
          const meta = await res.json();
          name = meta.name || name;
        }
      } catch (_) {}
      const ownerLabel =
        owner.toLowerCase() === addresses.pawningHub.toLowerCase()
          ? "Hub (escrow)"
          : owner.toLowerCase() === userAddress?.toLowerCase()
          ? `You (${shortAddr(owner)})`
          : shortAddr(owner);
      rows.push({
        id,
        name,
        owner: ownerLabel,
        value: fmtEth(value),
        status: "active",
      });
    } catch (_) {
      rows.push({ id, name: "—", owner: "—", value: "—", status: "BURNED" });
    }
  }

  container.innerHTML = renderTable(
    ["ID", "Name", "Owner", "Value", "Status"],
    rows.map((r) => [r.id, r.name, r.owner, r.value, r.status]),
  );
}

// --- Global panel: accounts + NFT list ---
async function refreshAccountsAndNfts() {
  const accountsEl = document.getElementById("accountsContainer");
  const nftsEl = document.getElementById("nftListContainer");
  accountsEl.innerHTML = "<em>Loading…</em>";
  nftsEl.innerHTML = "<em>Loading…</em>";

  if (!provider) provider = freshProvider();
  try {
    const ethAccounts = await provider.listAccounts();
    if (!ethAccounts || ethAccounts.length === 0) {
      accountsEl.innerHTML = "<em>No accounts connected</em>";
    } else {
      const rows = [];
      for (const a of ethAccounts) {
        const ethBal = await provider.getBalance(a);
        const dexBal = await dex.balanceOf(a);
        rows.push([shortAddr(a), fmtEth(ethBal), fmt(dexBal)]);
      }
      accountsEl.innerHTML = renderTable(["Account", "ETH", "DEX"], rows);
    }

    // reuse existing NFT list function but write into global container
    const total = Number(await nft.totalMinted());
    if (total === 0) {
      nftsEl.innerHTML = "<em>No NFTs minted yet.</em>";
    } else {
      const rows = [];
      for (let id = 0; id < total; id++) {
        try {
          const owner = await nft.ownerOf(id);
          const value = await nft.tokenValue(id);
          let name = "(no metadata)";
          try {
            const uri = await nft.tokenURI(id);
            const res = await fetch(uri);
            if (res.ok) {
              const meta = await res.json();
              name = meta.name || name;
            }
          } catch (_) {}
          const ownerLabel =
            owner.toLowerCase() === addresses.pawningHub.toLowerCase()
              ? "Hub (escrow)"
              : owner.toLowerCase() === userAddress?.toLowerCase()
              ? `You (${shortAddr(owner)})`
              : shortAddr(owner);
          rows.push({
            id,
            name,
            owner: ownerLabel,
            value: fmtEth(value),
            status: "active",
          });
        } catch (_) {
          rows.push({
            id,
            name: "—",
            owner: "—",
            value: "—",
            status: "BURNED",
          });
        }
      }
      nftsEl.innerHTML = renderTable(
        ["ID", "Name", "Owner", "Value", "Status"],
        rows.map((r) => [r.id, r.name, r.owner, r.value, r.status]),
      );
    }
  } catch (e) {
    accountsEl.textContent = "Error: " + (e.message || e);
    nftsEl.textContent = "Error: " + (e.message || e);
  }
}

// --- Listings list (Marketplace + Auctions) ---
async function fetchAllListings() {
  const total = Number(await hub.listingCounter());
  const out = [];
  for (let id = 1; id <= total; id++) {
    const l = await hub.getListing(id);
    if (l.seller === ethers.constants.AddressZero || !l.active) continue;
    out.push({
      id,
      saleType: Number(l.saleType),
      currency: Number(l.currency),
      tokenId: l.tokenId.toString(),
      price: l.price,
      seller: l.seller,
      endTime: Number(l.endTime),
      highestBid: l.highestBid,
      highestBidder: l.highestBidder,
    });
  }
  return out;
}

function formatListingPrice(l) {
  const cur = l.currency === Currency.ETH ? "ETH" : "DEX";
  if (l.currency === Currency.ETH) return `${fmtEth(l.price)} (${cur})`;
  return `${fmt(l.price)} DEX`;
}

async function refreshMarketList() {
  if (!hub) {
    log("Connect MetaMask first");
    return;
  }
  const container = document.getElementById("marketListContainer");
  container.innerHTML = "<em>Loading…</em>";

  const listings = (await fetchAllListings()).filter((l) => l.saleType === 0);
  if (listings.length === 0) {
    container.innerHTML = "<em>No fixed-price listings.</em>";
    return;
  }

  container.innerHTML = renderTable(
    ["ID", "Token", "Price", "Seller"],
    listings.map((l) => [
      l.id,
      l.tokenId,
      formatListingPrice(l),
      shortAddr(l.seller),
    ]),
  );
}

async function refreshAuctionList() {
  if (!hub) {
    log("Connect MetaMask first");
    return;
  }
  const container = document.getElementById("auctionListContainer");
  container.innerHTML = "<em>Loading…</em>";

  const listings = (await fetchAllListings()).filter((l) => l.saleType === 1);
  if (listings.length === 0) {
    container.innerHTML = "<em>No active auctions.</em>";
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  container.innerHTML = renderTable(
    ["ID", "Token", "Min price", "Highest bid", "Ends in", "Seller"],
    listings.map((l) => {
      const remaining = l.endTime - now;
      const endsIn = remaining > 0 ? `${remaining}s` : "ENDED";
      const bid = l.highestBid.isZero()
        ? "—"
        : formatListingPrice({ ...l, price: l.highestBid });
      return [
        l.id,
        l.tokenId,
        formatListingPrice(l),
        bid,
        endsIn,
        shortAddr(l.seller),
      ];
    }),
  );
}

function renderTable(headers, rows) {
  const head = headers.map((h) => `<th>${h}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

document.getElementById("btnSetParams").onclick = async () => {
  await waitTx(await hub.setPaymentCycle(rawInt("admCycle")));
  await waitTx(await hub.setInterest(rawInt("admInterest")));
  await waitTx(await hub.setTerminationFee(rawInt("admFee")));
  await waitTx(await hub.setMaxLoanDuration(rawInt("admMaxDur")));
  await waitTx(await hub.setDexSwapRate(rawInt("admRate")));
  log("Parameters updated");
};

document.getElementById("btnWithdrawEth").onclick = async () => {
  await waitTx(await hub.withdrawEth(userAddress, rawInt("admWithdrawEth")));
  await refreshAdminBalances();
};

document.getElementById("btnWithdrawDex").onclick = async () => {
  await waitTx(await hub.withdrawDex(userAddress, rawInt("admWithdrawDex")));
  await refreshAdminBalances();
  await refreshDexBalance();
};

// --- List refresh buttons ---
document.getElementById("btnRefreshMarket").onclick = refreshMarketList;
document.getElementById("btnRefreshAuctions").onclick = refreshAuctionList;
document.getElementById("btnRefreshGlobal").onclick = refreshAccountsAndNfts;

// --- Navigation ---
document.getElementById("nav").onclick = (e) => {
  if (e.target.tagName !== "BUTTON") return;
  document
    .querySelectorAll("#nav button")
    .forEach((b) => b.classList.remove("active"));
  e.target.classList.add("active");
  document
    .querySelectorAll("section")
    .forEach((s) => s.classList.remove("visible"));
  document.getElementById(e.target.dataset.tab).classList.add("visible");

  if (!hub || !userAddress) return;
  const tab = e.target.dataset.tab;
  if (tab === "nft")
    refreshNftList().catch((err) => log("List error: " + err.message));
  if (tab === "market")
    refreshMarketList().catch((err) => log("List error: " + err.message));
  if (tab === "auctions")
    refreshAuctionList().catch((err) => log("List error: " + err.message));
};

document.getElementById("btnConnect").onclick = connectWallet;

attachIntFormatters();
loadConfig().catch((e) => log("Load error: " + e.message));

// console helper functions
async function listAllNfts() {
  const total = Number(await nft.totalMinted());
  console.log(`Total minted: ${total} (some may be burned)`);

  const rows = [];
  for (let id = 0; id < total; id++) {
    try {
      const owner = await nft.ownerOf(id);
      const uri = await nft.tokenURI(id);
      const value = (await nft.tokenValue(id)).toString();

      let name = "(no metadata)";
      try {
        const res = await fetch(uri);
        if (res.ok) {
          const meta = await res.json();
          name = meta.name || "(no name)";
        }
      } catch (_) {}

      rows.push({ id, owner, name, valueWei: value, uri });
    } catch (e) {
      rows.push({ id, status: "BURNED" });
    }
  }

  console.table(rows);
  return rows;
}

async function showAllBalances() {
  const accounts = {
    "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266": "#0 admin",
    "0x70997970c51812dc3a010c7d01b50e0d17dc79c8": "#1 Alice",
    "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc": "#2 Bob",
    [addresses.pawningHub.toLowerCase()]: "Hub treasury",
    [addresses.dexToken.toLowerCase()]: "DexToken pool",
  };
  provider = freshProvider();
  const rows = [];
  for (const [addr, label] of Object.entries(accounts)) {
    const eth = await provider.getBalance(addr);
    const dexBal = await dex.balanceOf(addr);
    rows.push({
      label,
      ETH: ethers.utils.formatEther(eth),
      DEX: dexBal.toString(),
    });
  }
  console.table(rows);
}
