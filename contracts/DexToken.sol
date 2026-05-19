// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title DEX fungible token with ETH marketplace (Project 3 - Phase 0/1 base)
contract DexToken is ERC20, Ownable {
    uint256 public dexSwapRate;

    event DexPurchased(address indexed buyer, uint256 ethIn, uint256 dexOut);
    event DexSold(address indexed seller, uint256 dexIn, uint256 ethOut);

    constructor(uint256 _dexSwapRate) ERC20("DEX", "DEX") Ownable(msg.sender) {
        require(_dexSwapRate > 0, "Invalid rate");
        dexSwapRate = _dexSwapRate;
        _mint(address(this), 10 ** 18);
    }

    function setDexSwapRate(uint256 _dexSwapRate) external onlyOwner {
        require(_dexSwapRate > 0, "Invalid rate");
        dexSwapRate = _dexSwapRate;
    }

    function buyDex() external payable {
        require(msg.value > 0, "Send ETH");
        uint256 dexAmount = msg.value / dexSwapRate;
        require(dexAmount > 0, "Amount too small");
        _transfer(address(this), msg.sender, dexAmount);
        emit DexPurchased(msg.sender, msg.value, dexAmount);
    }

    function sellDex(uint256 dexAmount) external {
        require(dexAmount > 0, "Invalid amount");
        uint256 ethAmount = dexAmount * dexSwapRate;
        require(address(this).balance >= ethAmount, "Insufficient ETH");
        _transfer(msg.sender, address(this), dexAmount);
        (bool success, ) = msg.sender.call{value: ethAmount}("");
        require(success, "ETH transfer failed");
        emit DexSold(msg.sender, dexAmount, ethAmount);
    }

    receive() external payable {}
}
