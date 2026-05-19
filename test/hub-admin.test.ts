import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const SWAP_RATE = 1_000_000_000n;
const PAYMENT_CYCLE = 60n;
const INTEREST = 10n;
const TERMINATION_FEE = 1_000_000_000_000_000n;
const MAX_DURATION = 1800n;

async function deployAdminFixture() {
  const [owner, stranger] = await ethers.getSigners();

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
  await dex.transferOwnership(hubAddr);

  await owner.sendTransaction({ to: hubAddr, value: ethers.parseEther("1") });

  return { owner, stranger, dex, hub, hubAddr };
}

describe("PawningHub — admin console", function () {
  it("updates hub parameters as owner", async function () {
    const { hub } = await deployAdminFixture();

    await hub.setPaymentCycle(120n);
    expect(await hub.paymentCycle()).to.equal(120n);

    await hub.setInterest(15n);
    expect(await hub.interest()).to.equal(15n);

    await hub.setTerminationFee(2_000_000_000_000_000n);
    expect(await hub.terminationFee()).to.equal(2_000_000_000_000_000n);

    await hub.setMaxLoanDuration(3600n);
    expect(await hub.maxLoanDuration()).to.equal(3600n);
  });

  it("updates DEX swap rate via hub", async function () {
    const { hub, dex } = await deployAdminFixture();

    const newRate = 2_000_000_000n;
    await hub.setDexSwapRate(newRate);
    expect(await dex.dexSwapRate()).to.equal(newRate);
  });

  it("withdraws ETH and DEX from hub treasury", async function () {
    const { owner, hub, hubAddr, dex } = await deployAdminFixture();

    const ethForDex = ethers.parseEther("1");
    await dex.connect(owner).buyDex({ value: ethForDex });
    const ownerDex = await dex.balanceOf(owner.address);
    await dex.connect(owner).transfer(hubAddr, ownerDex / 2n);

    const withdrawDex = ownerDex / 4n;
    const dexBefore = await dex.balanceOf(owner.address);
    await hub.withdrawDex(owner.address, withdrawDex);
    expect(await dex.balanceOf(owner.address)).to.equal(dexBefore + withdrawDex);

    const withdrawEth = ethers.parseEther("0.1");
    const ethBefore = await ethers.provider.getBalance(owner.address);
    const tx = await hub.withdrawEth(owner.address, withdrawEth);
    const receipt = await tx.wait();
    const gas = receipt!.gasUsed * receipt!.gasPrice;
    const ethAfter = await ethers.provider.getBalance(owner.address);
    expect(ethAfter + gas - ethBefore).to.equal(withdrawEth);
  });

  it("rejects admin calls from non-owner", async function () {
    const { stranger, hub } = await deployAdminFixture();

    await expect(hub.connect(stranger).setInterest(5n)).to.be.revertedWithCustomError(
      hub,
      "OwnableUnauthorizedAccount"
    );
    await expect(hub.connect(stranger).withdrawEth(stranger.address, 1n)).to.be.revertedWithCustomError(
      hub,
      "OwnableUnauthorizedAccount"
    );
  });
});
