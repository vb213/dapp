import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { network } from "hardhat";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

// 1 DEX = 1 gwei (easy to test locally)
const DEX_SWAP_RATE = 1_000_000_000n;

async function main() {
  const { ethers } = await network.create();
  const [deployer] = await ethers.getSigners();

  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  const dexToken = await ethers.deployContract("DexToken", [DEX_SWAP_RATE]);
  await dexToken.waitForDeployment();
  const dexAddress = await dexToken.getAddress();

  // Seed contract with ETH so users can sell DEX back
  const seedTx = await deployer.sendTransaction({
    to: dexAddress,
    value: ethers.parseEther("100"),
  });
  await seedTx.wait();

  const addresses = {
    network: network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    dexToken: dexAddress,
    dexSwapRate: DEX_SWAP_RATE.toString(),
    deployedAt: new Date().toISOString(),
  };

  const outPath = join(rootDir, "frontend", "addresses.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(addresses, null, 2));

  console.log("\nDeployed contracts:");
  console.log("  DexToken:", dexAddress);
  console.log("  addresses.json ->", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
