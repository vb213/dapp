import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const SWAP_RATE = 1_000_000_000n;
const PAYMENT_CYCLE = 60n;
const INTEREST = 10n;
const TERMINATION_FEE = 1_000_000_000_000_000n;
const MAX_DURATION = 180n;

const Currency = { ETH: 0, DEX: 1 } as const;
const SaleType = { FIXED: 0, AUCTION: 1 } as const;

async function deployMarketFixture() {
  const [owner, seller, buyer, bidder2] = await ethers.getSigners();

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

  const nftAddr = await nft.getAddress();
  const hubAddr = await hub.getAddress();
  const dexAddr = await dex.getAddress();

  await owner.sendTransaction({ to: dexAddr, value: ethers.parseEther("20") });
  await owner.sendTransaction({ to: hubAddr, value: ethers.parseEther("20") });

  const value = ethers.parseEther("1");
  await nft.connect(seller).mint("http://localhost:3001/nft/0", value);
  const tokenId = 0n;

  await nft.connect(seller).approve(hubAddr, tokenId);

  const ethForDex = ethers.parseEther("5");
  await dex.connect(buyer).buyDex({ value: ethForDex });
  await dex.connect(bidder2).buyDex({ value: ethForDex });
  await dex.connect(buyer).approve(hubAddr, ethForDex);
  await dex.connect(bidder2).approve(hubAddr, ethForDex);

  return { owner, seller, buyer, bidder2, dex, nft, hub, hubAddr, tokenId };
}

// The protocol takes 5% of every NFT sale (fixed-price + auction); seller keeps 95%.
const FEE_NUM = 5n;
const FEE_DEN = 100n;

describe("PawningHub — NFT marketplace & auctions", function () {
  it("sells at fixed price in ETH (seller 95% / owner 5%)", async function () {
    const { owner, seller, buyer, nft, hub, tokenId } = await deployMarketFixture();

    const price = ethers.parseEther("1");
    const fee = (price * FEE_NUM) / FEE_DEN;
    const sellerShare = price - fee;

    await hub.connect(seller).listFixed(tokenId, price, Currency.ETH);

    const sellerEthBefore = await ethers.provider.getBalance(seller.address);
    const ownerEthBefore = await ethers.provider.getBalance(owner.address);
    await hub.connect(buyer).buyFixed(1n, { value: price });

    expect(await nft.ownerOf(tokenId)).to.equal(buyer.address);
    expect((await ethers.provider.getBalance(seller.address)) - sellerEthBefore).to.equal(sellerShare);
    expect((await ethers.provider.getBalance(owner.address)) - ownerEthBefore).to.equal(fee);
    const listing = await hub.getListing(1n);
    expect(listing.active).to.equal(false);
  });

  it("sells at fixed price in ETH with DEX conversion (seller 95% / owner 5%)", async function () {
    const { owner, seller, buyer, dex, nft, hub, tokenId } = await deployMarketFixture();

    const price = ethers.parseEther("1");
    const fee = (price * FEE_NUM) / FEE_DEN;
    const sellerShare = price - fee;
    const dexRequired = price / SWAP_RATE;
    await hub.connect(seller).listFixed(tokenId, price, Currency.ETH);

    const sellerEthBefore = await ethers.provider.getBalance(seller.address);
    const ownerEthBefore = await ethers.provider.getBalance(owner.address);
    await hub.connect(buyer).buyFixed(1n);

    expect(await nft.ownerOf(tokenId)).to.equal(buyer.address);
    expect((await ethers.provider.getBalance(seller.address)) - sellerEthBefore).to.equal(sellerShare);
    expect((await ethers.provider.getBalance(owner.address)) - ownerEthBefore).to.equal(fee);
    expect(await dex.balanceOf(seller.address)).to.equal(0n);
    expect(await dex.balanceOf(buyer.address)).to.equal(ethers.parseEther("5") / SWAP_RATE - dexRequired);
  });

  it("sells at fixed price in DEX with ETH conversion (seller 95% / owner 5%)", async function () {
    const { owner, seller, buyer, dex, hub, nft, tokenId } = await deployMarketFixture();

    const dexPrice = 2_000_000_000n; // DEX units (2 ETH worth at swap rate)
    const fee = (dexPrice * FEE_NUM) / FEE_DEN;
    const sellerShare = dexPrice - fee;
    await hub.connect(seller).listFixed(tokenId, dexPrice, Currency.DEX);

    const ethRequired = dexPrice * SWAP_RATE;
    const sellerDexBefore = await dex.balanceOf(seller.address);
    const ownerDexBefore = await dex.balanceOf(owner.address);

    await hub.connect(buyer).buyFixed(1n, { value: ethRequired });

    expect(await nft.ownerOf(tokenId)).to.equal(buyer.address);
    expect((await dex.balanceOf(seller.address)) - sellerDexBefore).to.equal(sellerShare);
    expect((await dex.balanceOf(owner.address)) - ownerDexBefore).to.equal(fee);
  });

  it("cancels a fixed listing and returns NFT to seller", async function () {
    const { seller, hub, nft, tokenId } = await deployMarketFixture();

    await hub.connect(seller).listFixed(tokenId, ethers.parseEther("1"), Currency.ETH);
    await hub.connect(seller).cancelListing(1n);

    expect(await nft.ownerOf(tokenId)).to.equal(seller.address);
  });

  it("runs an ETH auction and finalizes to highest bidder", async function () {
    const { seller, buyer, bidder2, hub, nft, tokenId } = await deployMarketFixture();

    const minPrice = ethers.parseEther("0.5");
    await hub.connect(seller).listAuction(tokenId, minPrice, 120n, Currency.ETH);

    await hub.connect(buyer).bid(1n, 0n, { value: ethers.parseEther("0.6") });
    await hub.connect(bidder2).bid(1n, 0n, { value: ethers.parseEther("0.8") });

    await ethers.provider.send("evm_increaseTime", [121]);
    await ethers.provider.send("evm_mine", []);

    const sellerEthBefore = await ethers.provider.getBalance(seller.address);
    await hub.finalizeAuction(1n);

    expect(await nft.ownerOf(tokenId)).to.equal(bidder2.address);
    const sellerEthAfter = await ethers.provider.getBalance(seller.address);
    expect(sellerEthAfter).to.be.gt(sellerEthBefore);
  });

  it("returns NFT to seller when auction ends with no bids", async function () {
    const { seller, hub, nft, tokenId } = await deployMarketFixture();

    await hub.connect(seller).listAuction(tokenId, ethers.parseEther("0.5"), 60n, Currency.ETH);

    await ethers.provider.send("evm_increaseTime", [61]);
    await ethers.provider.send("evm_mine", []);

    await hub.finalizeAuction(1n);
    expect(await nft.ownerOf(tokenId)).to.equal(seller.address);
  });

  it("runs a DEX auction with refund on outbid", async function () {
    const { seller, buyer, bidder2, dex, hub, nft, tokenId } = await deployMarketFixture();

    const minDex = 1_000_000_000n;
    await hub.connect(seller).listAuction(tokenId, minDex, 120n, Currency.DEX);

    await hub.connect(buyer).bid(1n, 1_200_000_000n);
    const buyerDexAfterFirst = await dex.balanceOf(buyer.address);

    await hub.connect(bidder2).bid(1n, 1_500_000_000n);

    expect(await dex.balanceOf(buyer.address)).to.be.gt(buyerDexAfterFirst);

    await ethers.provider.send("evm_increaseTime", [121]);
    await ethers.provider.send("evm_mine", []);

    await hub.finalizeAuction(1n);
    expect(await nft.ownerOf(tokenId)).to.equal(bidder2.address);
  });
});
