import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("NftCollection", function () {
  const TOKEN_URI = "http://localhost:3001/nft/0";
  const VALUE = ethers.parseEther("2");

  it("deploys with zero minted tokens", async function () {
    const nft = await ethers.deployContract("NftCollection");
    expect(await nft.totalMinted()).to.equal(0n);
  });

  it("mints an NFT with URI and value", async function () {
    const [alice] = await ethers.getSigners();
    const nft = await ethers.deployContract("NftCollection");

    await expect(nft.connect(alice).mint(TOKEN_URI, VALUE))
      .to.emit(nft, "NftMinted")
      .withArgs(alice.address, 0n, VALUE, TOKEN_URI);

    expect(await nft.ownerOf(0n)).to.equal(alice.address);
    expect(await nft.tokenURI(0n)).to.equal(TOKEN_URI);
    expect(await nft.tokenValue(0n)).to.equal(VALUE);
    expect(await nft.totalMinted()).to.equal(1n);
  });

  it("increments token ids on multiple mints", async function () {
    const [alice, bob] = await ethers.getSigners();
    const nft = await ethers.deployContract("NftCollection");

    await nft.connect(alice).mint("http://localhost:3001/nft/0", VALUE);
    await nft.connect(bob).mint("http://localhost:3001/nft/1", ethers.parseEther("1"));

    expect(await nft.ownerOf(0n)).to.equal(alice.address);
    expect(await nft.ownerOf(1n)).to.equal(bob.address);
    expect(await nft.totalMinted()).to.equal(2n);
  });

  it("rejects mint with zero value", async function () {
    const [alice] = await ethers.getSigners();
    const nft = await ethers.deployContract("NftCollection");

    await expect(nft.connect(alice).mint(TOKEN_URI, 0n)).to.be.revertedWith("Invalid value");
  });

  it("burns an NFT owned by the caller", async function () {
    const [alice] = await ethers.getSigners();
    const nft = await ethers.deployContract("NftCollection");

    await nft.connect(alice).mint(TOKEN_URI, VALUE);
    await expect(nft.connect(alice).burn(0n))
      .to.emit(nft, "NftBurned")
      .withArgs(alice.address, 0n);

    await expect(nft.ownerOf(0n)).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken");
    await expect(nft.tokenValue(0n)).to.be.revertedWithCustomError(nft, "ERC721NonexistentToken");
  });

  it("rejects burn by non-owner", async function () {
    const [alice, bob] = await ethers.getSigners();
    const nft = await ethers.deployContract("NftCollection");

    await nft.connect(alice).mint(TOKEN_URI, VALUE);
    await expect(nft.connect(bob).burn(0n)).to.be.revertedWith("Not owner");
  });
});
