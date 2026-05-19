import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

// 1 DEX = 1 gwei (easy to test locally)
const DEX_SWAP_RATE = 1_000_000_000n;
const PAYMENT_CYCLE = 60n; // seconds
const INTEREST_PERCENT = 10n;
const TERMINATION_FEE = 1_000_000_000_000_000n; // 0.001 ETH
const MAX_LOAN_DURATION = 1800n; // 30 minutes

async function main() {
  const { ethers } = await network.create();
  const [deployer] = await ethers.getSigners();

  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  const dexToken = await ethers.deployContract("DexToken", [DEX_SWAP_RATE]);
  await dexToken.waitForDeployment();
  const dexAddress = await dexToken.getAddress();

  const nftCollection = await ethers.deployContract("NftCollection");
  await nftCollection.waitForDeployment();
  const nftAddress = await nftCollection.getAddress();

  const pawningHub = await ethers.deployContract("PawningHub", [
    dexAddress,
    nftAddress,
    PAYMENT_CYCLE,
    INTEREST_PERCENT,
    TERMINATION_FEE,
    MAX_LOAN_DURATION,
  ]);
  await pawningHub.waitForDeployment();
  const hubAddress = await pawningHub.getAddress();

  // Hub admin also controls DEX swap rate (requirement 6)
  await dexToken.transferOwnership(hubAddress);
  console.log("DexToken ownership -> PawningHub");

  // Seed contracts with ETH (DEX sells + loan liquidity)
  for (const target of [dexAddress, hubAddress]) {
    const seedTx = await deployer.sendTransaction({
      to: target,
      value: ethers.parseEther("100"),
    });
    await seedTx.wait();
  }

  const addresses = {
    network: network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    dexToken: dexAddress,
    nftCollection: nftAddress,
    pawningHub: hubAddress,
    dexSwapRate: DEX_SWAP_RATE.toString(),
    paymentCycle: PAYMENT_CYCLE.toString(),
    interestPercent: INTEREST_PERCENT.toString(),
    terminationFee: TERMINATION_FEE.toString(),
    maxLoanDuration: MAX_LOAN_DURATION.toString(),
    deployedAt: new Date().toISOString(),
  };

  const outPath = join(rootDir, "frontend", "addresses.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(addresses, null, 2));

  console.log("\nDeployed contracts:");
  console.log("  DexToken:", dexAddress);
  console.log("  NftCollection:", nftAddress);
  console.log("  PawningHub:", hubAddress);
  console.log("  addresses.json ->", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
