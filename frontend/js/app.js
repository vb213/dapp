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

  log(`Wrong network: MetaMask is on chain ${net.chainId}, need ${expected} (Hardhat local)`);

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (switchErr) {
    if (switchErr.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x7a69",
          chainName: "Hardhat Local",
          rpcUrls: ["http://127.0.0.1:8545"],
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        }],
      });
    } else if (switchErr.code === 4001) {
      throw new Error("Network switch rejected. Select Hardhat Local (31337) in MetaMask.");
    } else {
      throw switchErr;
    }
  }

  await waitForChain(expected);
  p = freshProvider();
  net = await p.getNetwork();
  if (net.chainId.toString() !== expected) {
    throw new Error(
      `Still on chain ${net.chainId}. In MetaMask choose "Hardhat Local" (31337), then click Connect again.`
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

    document.getElementById("walletStatus").textContent =
      `Wallet: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)} (chain 31337)`;

    dex = new ethers.Contract(addresses.dexToken, abis.DexToken, signer);
    nft = new ethers.Contract(addresses.nftCollection, abis.NftCollection, signer);
    hub = new ethers.Contract(addresses.pawningHub, abis.PawningHub, signer);

    await refreshDexBalance();

    const owner = await hub.owner();
    if (owner.toLowerCase() === userAddress.toLowerCase()) {
      document.getElementById("tabAdmin").style.display = "inline-block";
      await refreshAdminBalances();
    }

    const ethBal = await provider.getBalance(userAddress);
    log(`Connected on chain ${addresses.chainId} — ETH: ${ethers.utils.formatEther(ethBal)}`);
  } catch (e) {
    log("Connect failed: " + (e.message || e));
    console.error(e);
    document.getElementById("dexBalance").textContent = "-";
  }
}

async function refreshDexBalance() {
  if (!dex || !userAddress) return;
  const bal = await dex.balanceOf(userAddress);
  document.getElementById("dexBalance").textContent = bal.toString();
}

async function waitTx(tx) {
  log(`Tx sent: ${tx.hash}`);
  const receipt = await tx.wait();
  log(`Mined block ${receipt.blockNumber}`);
  return receipt;
}

async function approveDex(spender, amount) {
  const tx = await dex.approve(spender, amount);
  await waitTx(tx);
}

async function approveNft(tokenId) {
  const tx = await nft.approve(addresses.pawningHub, tokenId);
  await waitTx(tx);
}

// --- DEX ---
document.getElementById("btnBuyDex").onclick = async () => {
  const eth = ethers.utils.parseEther(document.getElementById("buyEthAmount").value);
  await waitTx(await dex.buyDex({ value: eth }));
  await refreshDexBalance();
};

document.getElementById("btnSellDex").onclick = async () => {
  const amount = document.getElementById("sellDexAmount").value;
  await waitTx(await dex.sellDex(amount));
  await refreshDexBalance();
};

// --- DEX loans ---
document.getElementById("btnLoanDex").onclick = async () => {
  const amount = document.getElementById("loanDexAmount").value;
  const duration = document.getElementById("loanDuration").value;
  await approveDex(addresses.pawningHub, amount);
  const tx = await hub.loanDex(amount, duration);
  const receipt = await waitTx(tx);
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
  const id = document.getElementById("dexLoanId").value;
  const loan = await hub.getDexLoan(id);
  document.getElementById("dexLoanInfo").textContent = JSON.stringify(loan, null, 2);
};

// --- NFT ---
document.getElementById("btnMintNft").onclick = async () => {
  const valueWei = ethers.utils.parseEther(document.getElementById("nftValueEth").value);
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
  const price = document.getElementById("listPrice").value;
  const currency = document.getElementById("listCurrency").value;
  const tx = await hub.listFixed(tokenId, price, currency);
  const receipt = await waitTx(tx);
  log("Listed - check listing ID in transaction log");
};

document.getElementById("btnBuyFixed").onclick = async () => {
  const listingId = document.getElementById("buyListingId").value;
  const listing = await hub.getListing(listingId);
  const mode = document.getElementById("buyPayMode").value;
  const rate = ethers.BigNumber.from(addresses.dexSwapRate || (await dex.dexSwapRate()));

  const cur = listing.currency.toNumber ? listing.currency.toNumber() : Number(listing.currency);
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
  const tx = await hub.listAuction(
    tokenId,
    document.getElementById("aucMinPrice").value,
    document.getElementById("aucWait").value,
    document.getElementById("aucCurrency").value
  );
  await waitTx(tx);
};

document.getElementById("btnBid").onclick = async () => {
  const listingId = document.getElementById("aucListingId").value;
  const listing = await hub.getListing(listingId);
  const amount = document.getElementById("aucBidAmount").value;

  const cur = listing.currency.toNumber ? listing.currency.toNumber() : Number(listing.currency);
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
  const tx = await hub.requestNftLoan(tokenId, document.getElementById("nftLoanDuration").value);
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

document.getElementById("btnCancelNftRequest").onclick = async () => {
  const id = document.getElementById("nftLoanId").value;
  await waitTx(await hub.cancelNftLoanRequest(id));
};

// --- Admin ---
async function refreshAdminBalances() {
  document.getElementById("hubEth").textContent = (await hub.getEthBalance()).toString();
  document.getElementById("hubDex").textContent = (await hub.getDexBalance()).toString();
}

document.getElementById("btnSetParams").onclick = async () => {
  await waitTx(await hub.setPaymentCycle(document.getElementById("admCycle").value));
  await waitTx(await hub.setInterest(document.getElementById("admInterest").value));
  await waitTx(await hub.setTerminationFee(document.getElementById("admFee").value));
  await waitTx(await hub.setMaxLoanDuration(document.getElementById("admMaxDur").value));
  await waitTx(await hub.setDexSwapRate(document.getElementById("admRate").value));
  log("Parameters updated");
};

document.getElementById("btnWithdrawEth").onclick = async () => {
  const amt = document.getElementById("admWithdrawEth").value;
  await waitTx(await hub.withdrawEth(userAddress, amt));
  await refreshAdminBalances();
};

document.getElementById("btnWithdrawDex").onclick = async () => {
  const amt = document.getElementById("admWithdrawDex").value;
  await waitTx(await hub.withdrawDex(userAddress, amt));
  await refreshAdminBalances();
  await refreshDexBalance();
};

// --- Navigation ---
document.getElementById("nav").onclick = (e) => {
  if (e.target.tagName !== "BUTTON") return;
  document.querySelectorAll("#nav button").forEach((b) => b.classList.remove("active"));
  e.target.classList.add("active");
  document.querySelectorAll("section").forEach((s) => s.classList.remove("visible"));
  document.getElementById(e.target.dataset.tab).classList.add("visible");
};

document.getElementById("btnConnect").onclick = connectWallet;

loadConfig().catch((e) => log("Load error: " + e.message));
