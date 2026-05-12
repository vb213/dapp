import { network } from "hardhat";

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: npx run scripts/SendMoney.ts <recipient-address> <amount-in-ETH>");
  console.error("Example: npx run scripts/SendMoney.ts 0x4659fB4c4eaB5FA704cF9FB1E0F859f9FF79E4d9 0.1");
  process.exit(1);
}

const [recipient, amountEth] = args;

const { ethers } = await network.create("localhost");

const [owner] = await ethers.getSigners();

const tx = await owner.sendTransaction({
  to: recipient,
  value: ethers.parseEther(amountEth)
});

console.log(`Sent ${amountEth} ETH to ${recipient}`);
console.log(`Transaction hash: ${tx.hash}`);