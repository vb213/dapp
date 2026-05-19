import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const SWAP_RATE = 1_000_000_000n;
const PAYMENT_CYCLE = 60n;
const INTEREST = 10n;
const TERMINATION_FEE = 1_000_000_000_000_000n;
const MAX_DURATION = 180n;

async function deployNftLoanFixture() {
  const [owner, borrower, backer] = await ethers.getSigners();

  const dex = await ethers.deployContract("DexToken", [SWAP_RATE]);
  const nft = await ethers.deployContract("NftCollection");
  const hub = await ethers.deployContract("PawningHub", [
    await dex.getAddress(),
    await nft.getAddress(),
    PAYMENT_CYCLE,
    INTEREST,
    TERMINATION_FEE,
    MAX_DURATION,
  ]);

  const hubAddr = await hub.getAddress();
  const dexAddr = await dex.getAddress();

  await owner.sendTransaction({ to: dexAddr, value: ethers.parseEther("50") });
  await owner.sendTransaction({ to: hubAddr, value: ethers.parseEther("50") });

  const nftValue = ethers.parseEther("4"); // 2 ETH loan at 50% LTV
  await nft.connect(borrower).mint("http://localhost:3001/nft/loan0", nftValue);
  const tokenId = 0n;

  await nft.connect(borrower).approve(hubAddr, tokenId);

  const ethForDex = ethers.parseEther("10");
  await dex.connect(backer).buyDex({ value: ethForDex });
  await dex.connect(backer).approve(hubAddr, ethForDex);

  return { owner, borrower, backer, dex, nft, hub, hubAddr, tokenId, nftValue };
}

describe("PawningHub — NFT loans with DEX backer", function () {
  it("requests a loan and funds it with DEX backing", async function () {
    const { borrower, backer, hub, nft, tokenId, nftValue } = await deployNftLoanFixture();

    await hub.connect(borrower).requestNftLoan(tokenId, MAX_DURATION);

    const requiredDex = await hub.requiredDexBacking(1n);
    const ethLoan = nftValue / 2n;
    expect(requiredDex).to.equal(ethLoan / SWAP_RATE);

    const borrowerEthBefore = await ethers.provider.getBalance(borrower.address);
    await hub.connect(backer).fundNftLoan(1n);
    const borrowerEthAfter = await ethers.provider.getBalance(borrower.address);

    expect(borrowerEthAfter).to.be.gt(borrowerEthBefore);
    expect(await nft.ownerOf(tokenId)).to.equal(await hub.getAddress());

    const loan = await hub.getNftLoan(1n);
    expect(loan.funded).to.equal(true);
    expect(loan.backer).to.equal(backer.address);
  });

  it("completes NFT loan: payments (50% to backer) and termination", async function () {
    const { borrower, backer, hub, nft, dex, tokenId } = await deployNftLoanFixture();

    await hub.connect(borrower).requestNftLoan(tokenId, MAX_DURATION);
    const requiredDex = await hub.requiredDexBacking(1n);
    await hub.connect(backer).fundNftLoan(1n);

    const loan = await hub.getNftLoan(1n);
    const cyclePayment = loan.totalInterest / loan.totalCycles;
    const backerEthBefore = await ethers.provider.getBalance(backer.address);

    for (let i = 0; i < Number(loan.totalCycles); i++) {
      await hub.connect(borrower).makeNftPayment(1n, { value: cyclePayment });
    }

    const backerEthAfterPayments = await ethers.provider.getBalance(backer.address);
    expect(backerEthAfterPayments).to.be.gt(backerEthBefore);

    const paidInterest = cyclePayment * loan.totalCycles;
    const remainingInterest = loan.totalInterest - paidInterest;
    const totalDue = loan.amount + remainingInterest + TERMINATION_FEE;

    await hub.connect(borrower).terminateNftLoan(1n, { value: totalDue });

    expect(await nft.ownerOf(tokenId)).to.equal(borrower.address);
    expect(await dex.balanceOf(backer.address)).to.be.gte(requiredDex);
  });

  it("liquidates on missed payment: NFT and DEX go to backer", async function () {
    const { borrower, backer, hub, nft, dex, tokenId } = await deployNftLoanFixture();

    await hub.connect(borrower).requestNftLoan(tokenId, MAX_DURATION);
    const requiredDex = await hub.requiredDexBacking(1n);
    await hub.connect(backer).fundNftLoan(1n);

    const backerDexBefore = await dex.balanceOf(backer.address);

    await ethers.provider.send("evm_increaseTime", [Number(PAYMENT_CYCLE + 1n)]);
    await ethers.provider.send("evm_mine", []);

    await hub.connect(borrower).makeNftPayment(1n, { value: 0 });

    expect(await nft.ownerOf(tokenId)).to.equal(backer.address);
    expect(await dex.balanceOf(backer.address)).to.equal(backerDexBefore + requiredDex);
  });

  it("allows borrower to cancel unfunded request", async function () {
    const { borrower, hub, nft, tokenId } = await deployNftLoanFixture();

    await hub.connect(borrower).requestNftLoan(tokenId, MAX_DURATION);
    await hub.connect(borrower).cancelNftLoanRequest(1n);

    expect(await nft.ownerOf(tokenId)).to.equal(borrower.address);
  });
});
