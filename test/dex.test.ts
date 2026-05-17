import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("DexToken", function () {
  const SWAP_RATE = 1_000_000_000n; // 1 gwei per DEX

  it("deploys with initial pool", async function () {
    const dex = await ethers.deployContract("DexToken", [SWAP_RATE]);
    const pool = await dex.balanceOf(await dex.getAddress());
    expect(pool).to.equal(ethers.parseEther("1"));
  });

  it("buys DEX with ETH", async function () {
    const [owner, buyer] = await ethers.getSigners();
    const dex = await ethers.deployContract("DexToken", [SWAP_RATE]);

    await owner.sendTransaction({
      to: await dex.getAddress(),
      value: ethers.parseEther("10"),
    });

    const ethIn = ethers.parseEther("1");
    await dex.connect(buyer).buyDex({ value: ethIn });

    const expectedDex = ethIn / SWAP_RATE;
    expect(await dex.balanceOf(buyer.address)).to.equal(expectedDex);
  });

  it("sells DEX for ETH", async function () {
    const [owner, seller] = await ethers.getSigners();
    const dex = await ethers.deployContract("DexToken", [SWAP_RATE]);
    const dexAddr = await dex.getAddress();

    await owner.sendTransaction({ to: dexAddr, value: ethers.parseEther("10") });

    const buyAmount = ethers.parseEther("2");
    await dex.connect(seller).buyDex({ value: buyAmount });
    const dexBalance = await dex.balanceOf(seller.address);

    const ethBefore = await ethers.provider.getBalance(seller.address);
    const tx = await dex.connect(seller).sellDex(dexBalance);
    const receipt = await tx.wait();
    const gas = receipt!.gasUsed * receipt!.gasPrice;
    const ethAfter = await ethers.provider.getBalance(seller.address);

    const expectedEth = dexBalance * SWAP_RATE;
    expect(ethAfter + gas - ethBefore).to.equal(expectedEth);
  });
});
