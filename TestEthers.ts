import { network } from "hardhat";
import CounterArtifact from "../artifacts/contracts/Counter.sol/Counter.json" with { type: "json" }; 

(async () => {
  console.log("Script started");
  try {
    const { ethers } = await network.create("localhost");

    const blockNumber = await ethers.provider.getBlockNumber();
    console.log("Block number:", blockNumber);

    // Create wallet with private key
    //Account #0:  0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 (10000 ETH)
    //Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
    const wallet = new ethers.Wallet(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      ethers.provider
    );

    const contractAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    console.log("Counter deployed at:", contractAddress);

    // Get contract instance
    const counter = new ethers.Contract(
      contractAddress,
      CounterArtifact.abi,
      wallet
    );

    // Read initial value
    const initialValue = await counter.x();
    console.log("Initial value:", initialValue);

    // Call increment
    const tx = await counter.inc();
    console.log("Increment tx:", tx.hash);

    await tx.wait();

    // Read new value
    const newValue = await counter.x();
    console.log("New value after increment:", newValue);

  } catch (error) {
    console.error("Error:", error);
  }
})();