import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const SWAP_RATE = 1_000_000_000n;
const PAYMENT_CYCLE = 60n;
const INTEREST = 10n;
const TERMINATION_FEE = 1_000_000_000_000_000n; // 0.001 ETH
const MAX_DURATION = 180n;

async function deployFixture() {
  const [owner, borrower] = await ethers.getSigners();

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

  const dexAddr = await dex.getAddress();
  const hubAddr = await hub.getAddress();

  await owner.sendTransaction({ to: dexAddr, value: ethers.parseEther("50") });
  await owner.sendTransaction({ to: hubAddr, value: ethers.parseEther("50") });

  const ethForDex = ethers.parseEther("2");
  await dex.connect(borrower).buyDex({ value: ethForDex });
  const dexCollateral = ethForDex / SWAP_RATE;
  await dex.connect(borrower).approve(hubAddr, dexCollateral);

  return { owner, borrower, dex, hub, dexCollateral, hubAddr };
}

describe("PawningHub — DEX loans", function () {
  it("creates a loan at 50% LTV and transfers ETH to borrower", async function () {
    const { borrower, hub, dexCollateral } = await deployFixture();

    const ethBefore = await ethers.provider.getBalance(borrower.address);
    const tx = await hub.connect(borrower).loanDex(dexCollateral, MAX_DURATION);
    const receipt = await tx.wait();
    const gas = receipt!.gasUsed * receipt!.gasPrice;
    const ethAfter = await ethers.provider.getBalance(borrower.address);

    const expectedEth = (dexCollateral * SWAP_RATE) / 2n;
    expect(ethAfter + gas - ethBefore).to.equal(expectedEth);

    const loan = await hub.getDexLoan(1n);
    expect(loan.borrower).to.equal(borrower.address);
    expect(loan.collateral).to.equal(dexCollateral);
    expect(loan.amount).to.equal(expectedEth);
    expect(loan.active).to.equal(true);
  });

  it("completes loan: payments then terminate with collateral returned", async function () {
    const { borrower, hub, dex, dexCollateral } = await deployFixture();

    await hub.connect(borrower).loanDex(dexCollateral, MAX_DURATION);
    const loan = await hub.getDexLoan(1n);
    const cyclePayment = loan.totalInterest / loan.totalCycles;

    for (let i = 0; i < Number(loan.totalCycles); i++) {
      await hub.connect(borrower).makeDexPayment(1n, { value: cyclePayment });
    }

    const paidInterest = cyclePayment * loan.totalCycles;
    const totalDue = loan.amount + (loan.totalInterest - paidInterest) + TERMINATION_FEE;

    await hub.connect(borrower).terminateDexLoan(1n, { value: totalDue });

    expect(await dex.balanceOf(borrower.address)).to.equal(dexCollateral);
    const closed = await hub.getDexLoan(1n);
    expect(closed.active).to.equal(false);
  });

  it("liquidates on missed payment and sends collateral to owner", async function () {
    const { owner, borrower, hub, dex, dexCollateral } = await deployFixture();

    await hub.connect(borrower).loanDex(dexCollateral, MAX_DURATION);

    await ethers.provider.send("evm_increaseTime", [Number(PAYMENT_CYCLE + 1n)]);
    await ethers.provider.send("evm_mine", []);

    const ownerDexBefore = await dex.balanceOf(owner.address);
    await hub.connect(borrower).makeDexPayment(1n, { value: 0 });

    expect(await dex.balanceOf(owner.address)).to.equal(ownerDexBefore + dexCollateral);
    const loan = await hub.getDexLoan(1n);
    expect(loan.active).to.equal(false);
  });

  it("liquidates via checkDexLoan after deadline", async function () {
    const { owner, borrower, hub, dex, dexCollateral } = await deployFixture();

    await hub.connect(borrower).loanDex(dexCollateral, MAX_DURATION);

    await ethers.provider.send("evm_increaseTime", [Number(MAX_DURATION + 1n)]);
    await ethers.provider.send("evm_mine", []);

    const ownerDexBefore = await dex.balanceOf(owner.address);
    await hub.checkDexLoan(1n);

    expect(await dex.balanceOf(owner.address)).to.equal(ownerDexBefore + dexCollateral);
  });
});
