// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

/// @title ERC721 collection for Project 3 (mint, burn, on-chain valuation)
contract NftCollection is ERC721, ERC721URIStorage {
    uint256 private _nextTokenId;
    mapping(uint256 => uint256) private _tokenValues;

    event NftMinted(address indexed to, uint256 indexed tokenId, uint256 valueInWei, string tokenURI);
    event NftBurned(address indexed owner, uint256 indexed tokenId);

    constructor() ERC721("PawnNFT", "PNFT") {}

    /// @notice Create an NFT owned by the caller.
    /// @param uri Metadata URI (e.g. http://localhost:3001/nft/0)
    /// @param valueInWei Collateral value in wei for NFT-backed loans (50% LTV in PawningHub)
    function mint(string calldata uri, uint256 valueInWei) external returns (uint256) {
        require(valueInWei > 0, "Invalid value");
        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, uri);
        _tokenValues[tokenId] = valueInWei;
        emit NftMinted(msg.sender, tokenId, valueInWei, uri);
        return tokenId;
    }

    /// @notice Destroy an NFT; only the current owner may burn it.
    function burn(uint256 tokenId) external {
        require(ownerOf(tokenId) == msg.sender, "Not owner");
        _burn(tokenId);
        delete _tokenValues[tokenId];
        emit NftBurned(msg.sender, tokenId);
    }

    /// @notice On-chain valuation used for NFT-backed lending.
    function tokenValue(uint256 tokenId) external view returns (uint256) {
        _requireOwned(tokenId);
        return _tokenValues[tokenId];
    }

    function totalMinted() external view returns (uint256) {
        return _nextTokenId;
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
