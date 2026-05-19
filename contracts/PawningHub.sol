// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IDexToken is IERC20 {
    function dexSwapRate() external view returns (uint256);
}

/// @title Orchestrates DEX loans, NFT marketplace and auctions (Project 3)
contract PawningHub is Ownable, ReentrancyGuard, IERC721Receiver {
    using SafeERC20 for IERC20;

    IDexToken public immutable dexToken;
    address public immutable nftCollection;

    uint256 public paymentCycle;
    uint256 public interest; // percent, e.g. 10 = 10%
    uint256 public terminationFee;
    uint256 public maxLoanDuration;

    uint256 public loanCounter;
    uint256 public listingCounter;

    enum SaleType {
        FIXED,
        AUCTION
    }

    enum Currency {
        ETH,
        DEX
    }

    struct DexLoan {
        address borrower;
        uint256 collateral;
        uint256 amount;
        uint256 deadline;
        uint256 totalInterest;
        uint256 paymentsMade;
        uint256 totalCycles;
        uint256 nextPaymentDue;
        bool active;
    }

    mapping(uint256 => DexLoan) public dexLoans;

    struct Listing {
        address seller;
        uint256 tokenId;
        SaleType saleType;
        Currency currency;
        uint256 price;
        uint256 endTime;
        uint256 highestBid;
        address highestBidder;
        bool active;
    }

    mapping(uint256 => Listing) public listings;

    event DexLoanCreated(uint256 indexed loanId, address indexed borrower, uint256 amount, uint256 deadline);
    event DexLoanPayment(uint256 indexed loanId, uint256 paymentsMade);
    event DexLoanFinished(uint256 indexed loanId, address indexed borrower);
    event DexLoanLiquidated(uint256 indexed loanId, address indexed borrower);

    event Listed(uint256 indexed listingId, address indexed seller, uint256 tokenId, SaleType saleType, Currency currency, uint256 price);
    event ListingCancelled(uint256 indexed listingId);
    event NftSold(uint256 indexed listingId, address indexed buyer, uint256 price);
    event BidPlaced(uint256 indexed listingId, address indexed bidder, uint256 amount);
    event AuctionFinalized(uint256 indexed listingId, address indexed buyer, uint256 amount);

    constructor(
        address _dexToken,
        address _nftCollection,
        uint256 _paymentCycle,
        uint256 _interest,
        uint256 _terminationFee,
        uint256 _maxLoanDuration
    ) Ownable(msg.sender) {
        require(_dexToken != address(0) && _nftCollection != address(0), "Invalid token");
        require(_paymentCycle > 0 && _maxLoanDuration > 0, "Invalid duration params");

        dexToken = IDexToken(_dexToken);
        nftCollection = _nftCollection;
        paymentCycle = _paymentCycle;
        interest = _interest;
        terminationFee = _terminationFee;
        maxLoanDuration = _maxLoanDuration;
    }

    /// @notice Borrow ETH using DEX as collateral (50% LTV).
    function loanDex(uint256 dexAmount, uint256 duration) external nonReentrant returns (uint256 loanId) {
        require(duration <= maxLoanDuration, "Too long");
        require(dexAmount > 0, "Invalid collateral");

        uint256 swapRate = dexToken.dexSwapRate();
        uint256 ethAmount = (dexAmount * swapRate) / 2;
        require(ethAmount > 0, "Collateral too small");
        require(address(this).balance >= ethAmount, "No liquidity");

        uint256 cycles = duration / paymentCycle;
        require(cycles > 0, "Invalid duration");

        IERC20(address(dexToken)).safeTransferFrom(msg.sender, address(this), dexAmount);

        loanCounter++;
        loanId = loanCounter;

        dexLoans[loanId] = DexLoan({
            borrower: msg.sender,
            collateral: dexAmount,
            amount: ethAmount,
            deadline: block.timestamp + duration,
            totalInterest: (ethAmount * interest) / 100,
            paymentsMade: 0,
            totalCycles: cycles,
            nextPaymentDue: block.timestamp + paymentCycle,
            active: true
        });

        (bool success, ) = msg.sender.call{value: ethAmount}("");
        require(success, "ETH transfer failed");

        emit DexLoanCreated(loanId, msg.sender, ethAmount, block.timestamp + duration);
    }

    /// @notice Pay interest for the current cycle (Project 2 semantics).
    function makeDexPayment(uint256 loanId) external payable nonReentrant {
        DexLoan storage l = dexLoans[loanId];
        require(l.active, "Inactive loan");
        require(msg.sender == l.borrower, "Not borrower");
        require(block.timestamp <= l.deadline, "Expired");

        if (block.timestamp > l.nextPaymentDue) {
            _liquidateDexLoan(loanId);
            return;
        }

        uint256 cyclePayment = l.totalInterest / l.totalCycles;
        require(msg.value == cyclePayment, "Wrong amount");
        require(l.paymentsMade < l.totalCycles, "All payments made");

        l.paymentsMade++;
        l.nextPaymentDue += paymentCycle;
        emit DexLoanPayment(loanId, l.paymentsMade);
    }

    /// @notice Repay principal + remaining interest + fee and recover DEX collateral.
    function terminateDexLoan(uint256 loanId) external payable nonReentrant {
        DexLoan storage l = dexLoans[loanId];
        require(l.active, "Inactive");
        require(msg.sender == l.borrower, "Not borrower");

        uint256 paidInterest = (l.totalInterest / l.totalCycles) * l.paymentsMade;
        uint256 remainingInterest = l.totalInterest - paidInterest;
        uint256 totalDue = l.amount + remainingInterest + terminationFee;
        require(msg.value == totalDue, "Incorrect repayment");

        l.active = false;
        IERC20(address(dexToken)).safeTransfer(msg.sender, l.collateral);

        emit DexLoanFinished(loanId, msg.sender);
        delete dexLoans[loanId];
    }

    /// @notice Owner or anyone can trigger liquidation after the loan deadline.
    function checkDexLoan(uint256 loanId) external {
        DexLoan storage l = dexLoans[loanId];
        require(l.active, "Inactive");
        if (block.timestamp > l.deadline) {
            _liquidateDexLoan(loanId);
        }
    }

    function getDexLoan(uint256 loanId) external view returns (DexLoan memory) {
        return dexLoans[loanId];
    }

    // -------------------------------------------------------------------------
    // NFT marketplace (requirements 3–4)
    // -------------------------------------------------------------------------

    /// @notice List NFT at a fixed price (escrow until sold or cancelled).
    function listFixed(uint256 tokenId, uint256 price, Currency currency)
        external
        nonReentrant
        returns (uint256 listingId)
    {
        require(price > 0, "Invalid price");
        _escrowNft(tokenId);

        listingCounter++;
        listingId = listingCounter;

        listings[listingId] = Listing({
            seller: msg.sender,
            tokenId: tokenId,
            saleType: SaleType.FIXED,
            currency: currency,
            price: price,
            endTime: 0,
            highestBid: 0,
            highestBidder: address(0),
            active: true
        });

        emit Listed(listingId, msg.sender, tokenId, SaleType.FIXED, currency, price);
    }

    /// @notice Buy a fixed-price listing. Pay with ETH (msg.value) or DEX (approve hub first).
    function buyFixed(uint256 listingId) external payable nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Not active");
        require(listing.saleType == SaleType.FIXED, "Not fixed price");

        _collectPayment(listing.seller, listing.currency, listing.price);
        listing.active = false;

        _releaseNft(listing.tokenId, msg.sender);
        emit NftSold(listingId, msg.sender, listing.price);
        delete listings[listingId];
    }

    /// @notice List NFT for auction with minimum price and maximum wait time.
    function listAuction(uint256 tokenId, uint256 minPrice, uint256 maxWaitSeconds, Currency currency)
        external
        nonReentrant
        returns (uint256 listingId)
    {
        require(minPrice > 0, "Invalid min price");
        require(maxWaitSeconds > 0, "Invalid duration");
        _escrowNft(tokenId);

        listingCounter++;
        listingId = listingCounter;

        listings[listingId] = Listing({
            seller: msg.sender,
            tokenId: tokenId,
            saleType: SaleType.AUCTION,
            currency: currency,
            price: minPrice,
            endTime: block.timestamp + maxWaitSeconds,
            highestBid: 0,
            highestBidder: address(0),
            active: true
        });

        emit Listed(listingId, msg.sender, tokenId, SaleType.AUCTION, currency, minPrice);
    }

    /// @notice Place a bid (ETH: send msg.value; DEX: pass dexAmount and approve hub).
    function bid(uint256 listingId, uint256 dexAmount) external payable nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Not active");
        require(listing.saleType == SaleType.AUCTION, "Not auction");
        require(block.timestamp < listing.endTime, "Auction ended");

        uint256 minNextBid = listing.highestBidder == address(0) ? listing.price : listing.highestBid + 1;

        if (listing.currency == Currency.ETH) {
            require(dexAmount == 0, "Use ETH only");
            require(msg.value >= minNextBid, "Bid too low");
            _refundEthBid(listing.highestBidder, listing.highestBid);
            listing.highestBid = msg.value;
        } else {
            require(msg.value == 0, "Use DEX only");
            require(dexAmount >= minNextBid, "Bid too low");
            _pullDexFromSender(msg.sender, dexAmount);
            _refundDexBid(listing.highestBidder, listing.highestBid);
            listing.highestBid = dexAmount;
        }

        listing.highestBidder = msg.sender;
        emit BidPlaced(listingId, msg.sender, listing.highestBid);
    }

    /// @notice Finalize auction after end time; transfers NFT to winner and payment to seller.
    function finalizeAuction(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Not active");
        require(listing.saleType == SaleType.AUCTION, "Not auction");
        require(block.timestamp >= listing.endTime, "Not ended");

        listing.active = false;

        if (listing.highestBidder == address(0)) {
            _releaseNft(listing.tokenId, listing.seller);
            emit ListingCancelled(listingId);
            delete listings[listingId];
            return;
        }

        _paySellerFromEscrow(listing.seller, listing.currency, listing.highestBid);
        _releaseNft(listing.tokenId, listing.highestBidder);

        emit AuctionFinalized(listingId, listing.highestBidder, listing.highestBid);
        delete listings[listingId];
    }

    /// @notice Cancel a fixed listing or an auction with no bids.
    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        require(listing.active, "Not active");
        require(msg.sender == listing.seller, "Not seller");

        if (listing.saleType == SaleType.AUCTION) {
            require(block.timestamp >= listing.endTime || listing.highestBidder == address(0), "Auction active");
            _refundEthBid(listing.highestBidder, listing.highestBid);
            _refundDexBid(listing.highestBidder, listing.highestBid);
        }

        listing.active = false;
        _releaseNft(listing.tokenId, listing.seller);
        emit ListingCancelled(listingId);
        delete listings[listingId];
    }

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function _escrowNft(uint256 tokenId) internal {
        IERC721(nftCollection).safeTransferFrom(msg.sender, address(this), tokenId);
    }

    function _releaseNft(uint256 tokenId, address to) internal {
        IERC721(nftCollection).safeTransferFrom(address(this), to, tokenId);
    }

    /// @dev Seller currency + buyer may pay with ETH (msg.value) or DEX (allowance).
    function _collectPayment(address seller, Currency currency, uint256 price) internal {
        uint256 swapRate = dexToken.dexSwapRate();

        if (currency == Currency.ETH) {
            if (msg.value > 0) {
                require(msg.value == price, "Wrong ETH amount");
                _sendEth(seller, price);
            } else {
                uint256 dexRequired = price / swapRate;
                require(dexRequired * swapRate == price, "DEX amount imprecise");
                IERC20(address(dexToken)).safeTransferFrom(msg.sender, seller, dexRequired);
            }
        } else {
            if (msg.value > 0) {
                uint256 ethRequired = price * swapRate;
                require(msg.value == ethRequired, "Wrong ETH amount");
                _sendEth(seller, ethRequired);
            } else {
                IERC20(address(dexToken)).safeTransferFrom(msg.sender, seller, price);
            }
        }
    }

    function _pullDexFromSender(address from, uint256 amount) internal returns (uint256) {
        IERC20(address(dexToken)).safeTransferFrom(from, address(this), amount);
        return amount;
    }

    function _paySellerFromEscrow(address seller, Currency currency, uint256 amount) internal {
        if (currency == Currency.ETH) {
            _sendEth(seller, amount);
        } else {
            IERC20(address(dexToken)).safeTransfer(seller, amount);
        }
    }

    function _refundEthBid(address bidder, uint256 amount) internal {
        if (bidder != address(0) && amount > 0) {
            _sendEth(bidder, amount);
        }
    }

    function _refundDexBid(address bidder, uint256 amount) internal {
        if (bidder != address(0) && amount > 0) {
            IERC20(address(dexToken)).safeTransfer(bidder, amount);
        }
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool success, ) = to.call{value: amount}("");
        require(success, "ETH transfer failed");
    }

    function _liquidateDexLoan(uint256 loanId) internal {
        DexLoan storage l = dexLoans[loanId];
        if (!l.active) return;

        address borrower = l.borrower;
        uint256 collateral = l.collateral;

        l.active = false;
        delete dexLoans[loanId];

        IERC20(address(dexToken)).safeTransfer(owner(), collateral);
        emit DexLoanLiquidated(loanId, borrower);
    }

    receive() external payable {}
}
