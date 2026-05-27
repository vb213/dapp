// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
event DebugLog(string message, uint256 value);

interface IDexToken is IERC20 {
    function dexSwapRate() external view returns (uint256);
    function buyDex() external payable;
    function sellDex(uint256 dexAmount) external;
}

interface IDexTokenAdmin {
    function setDexSwapRate(uint256 _dexSwapRate) external;
}

interface INftCollection {
    function tokenValue(uint256 tokenId) external view returns (uint256);
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
    uint256 public nftLoanCounter;
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

    struct NftLoan {
        address borrower;
        address backer;
        uint256 tokenId;
        uint256 dexBacking;
        uint256 amount;
        uint256 deadline;
        uint256 totalInterest;
        uint256 paymentsMade;
        uint256 totalCycles;
        uint256 nextPaymentDue;
        bool funded;
        bool active;
    }

    mapping(uint256 => NftLoan) public nftLoans;

    event DexLoanCreated(uint256 indexed loanId, address indexed borrower, uint256 amount, uint256 deadline);
    event DexLoanPayment(uint256 indexed loanId, uint256 paymentsMade);
    event DexLoanFinished(uint256 indexed loanId, address indexed borrower);
    event DexLoanLiquidated(uint256 indexed loanId, address indexed borrower);

    event Listed(uint256 indexed listingId, address indexed seller, uint256 tokenId, SaleType saleType, Currency currency, uint256 price);
    event ListingCancelled(uint256 indexed listingId);
    event NftSold(uint256 indexed listingId, address indexed buyer, uint256 price);
    event BidPlaced(uint256 indexed listingId, address indexed bidder, uint256 amount);
    event AuctionFinalized(uint256 indexed listingId, address indexed buyer, uint256 amount);

    event NftLoanRequested(uint256 indexed loanId, address indexed borrower, uint256 tokenId, uint256 amount);
    event NftLoanFunded(uint256 indexed loanId, address indexed backer, uint256 dexBacking);
    event NftLoanPayment(uint256 indexed loanId, uint256 paymentsMade);
    event NftLoanFinished(uint256 indexed loanId, address indexed borrower);
    event NftLoanLiquidated(uint256 indexed loanId, address indexed borrower, address indexed backer);
    event NftLoanCancelled(uint256 indexed loanId);

    event PaymentCycleUpdated(uint256 paymentCycle);
    event InterestUpdated(uint256 interest);
    event TerminationFeeUpdated(uint256 terminationFee);
    event MaxLoanDurationUpdated(uint256 maxLoanDuration);
    event DexSwapRateUpdated(uint256 dexSwapRate);
    event EthWithdrawn(address indexed to, uint256 amount);
    event DexWithdrawn(address indexed to, uint256 amount);

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

    // -------------------------------------------------------------------------
    // Administrator console (requirement 6)
    // -------------------------------------------------------------------------

    function setPaymentCycle(uint256 _paymentCycle) external onlyOwner {
        require(_paymentCycle > 0, "Invalid cycle");
        paymentCycle = _paymentCycle;
        emit PaymentCycleUpdated(_paymentCycle);
    }

    function setInterest(uint256 _interest) external onlyOwner {
        interest = _interest;
        emit InterestUpdated(_interest);
    }

    function setTerminationFee(uint256 _terminationFee) external onlyOwner {
        terminationFee = _terminationFee;
        emit TerminationFeeUpdated(_terminationFee);
    }

    function setMaxLoanDuration(uint256 _maxLoanDuration) external onlyOwner {
        require(_maxLoanDuration > 0, "Invalid duration");
        maxLoanDuration = _maxLoanDuration;
        emit MaxLoanDurationUpdated(_maxLoanDuration);
    }

    /// @notice Update DEX/ETH rate (hub must own DexToken — done in deploy script).
    function setDexSwapRate(uint256 _dexSwapRate) external onlyOwner {
        require(_dexSwapRate > 0, "Invalid rate");
        IDexTokenAdmin(address(dexToken)).setDexSwapRate(_dexSwapRate);
        emit DexSwapRateUpdated(_dexSwapRate);
    }

    function withdrawEth(address payable to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid recipient");
        require(amount <= address(this).balance, "Insufficient ETH");
        _sendEth(to, amount);
        emit EthWithdrawn(to, amount);
    }

    function withdrawDex(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid recipient");
        IERC20(address(dexToken)).safeTransfer(to, amount);
        emit DexWithdrawn(to, amount);
    }

    function getEthBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getDexBalance() external view returns (uint256) {
        return IERC20(address(dexToken)).balanceOf(address(this));
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
        emit DebugLog("Loan next payment due", dexLoans[loanId].nextPaymentDue);
        emit DebugLog("Number of cycles", cycles);
        emit DexLoanCreated(loanId, msg.sender, ethAmount, block.timestamp + duration);
    }

    /// @notice Pay interest for the current cycle (Project 2 semantics).
    function makeDexPayment(uint256 loanId) external payable nonReentrant {
        DexLoan storage l = dexLoans[loanId];
        require(l.active, "Inactive loan");
        require(msg.sender == l.borrower, "Not borrower");
        require(block.timestamp <= l.deadline, "Expired");
        emit DebugLog("Current time", block.timestamp);
        emit DebugLog("Next payment due", l.nextPaymentDue);
        if (block.timestamp > l.nextPaymentDue) {
            _liquidateDexLoan(loanId);
            emit DebugLog("Payment overdue, loan liquidated", loanId);
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
        // also liquidate if cycle is missed
        else if (block.timestamp > l.nextPaymentDue) {
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
        uint feePercentage = 5;

        Listing storage listing = listings[listingId];
        require(listing.active, "Not active");
        require(listing.saleType == SaleType.FIXED, "Not fixed price");

        _collectPayment(listing.seller, listing.currency, listing.price, feePercentage);
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

    // -------------------------------------------------------------------------
    // NFT-backed loans with DEX backer (requirement 5)
    // -------------------------------------------------------------------------

    /// @notice Request ETH loan using an NFT as collateral (waits for a DEX backer).
    function requestNftLoan(uint256 tokenId, uint256 duration)
        external
        nonReentrant
        returns (uint256 loanId)
    {
        require(duration <= maxLoanDuration, "Too long");
        require(IERC721(nftCollection).ownerOf(tokenId) == msg.sender, "Not NFT owner");

        uint256 nftValue = INftCollection(nftCollection).tokenValue(tokenId);
        require(nftValue > 0, "Invalid NFT value");

        uint256 cycles = duration / paymentCycle;
        require(cycles > 0, "Invalid duration");

        uint256 ethAmount = nftValue / 2;
        require(ethAmount > 0, "Loan too small");

        _escrowNft(tokenId);

        nftLoanCounter++;
        loanId = nftLoanCounter;

        nftLoans[loanId] = NftLoan({
            borrower: msg.sender,
            backer: address(0),
            tokenId: tokenId,
            dexBacking: 0,
            amount: ethAmount,
            deadline: block.timestamp + duration,
            totalInterest: (ethAmount * interest) / 100,
            paymentsMade: 0,
            totalCycles: cycles,
            nextPaymentDue: 0,
            funded: false,
            active: false
        });

        emit DebugLog("Loan duration", duration);

        emit NftLoanRequested(loanId, msg.sender, tokenId, ethAmount);
    }

    /// @notice Backer provides DEX; borrower receives ETH (50% NFT value).
    function fundNftLoan(uint256 loanId) external nonReentrant {
        NftLoan storage l = nftLoans[loanId];
        require(l.borrower != address(0), "Invalid loan");
        require(!l.funded, "Already funded");

        uint256 swapRate = dexToken.dexSwapRate();
        uint256 requiredDex = l.amount / swapRate;
        require(requiredDex > 0, "Invalid DEX amount");

        IERC20(address(dexToken)).safeTransferFrom(msg.sender, address(this), requiredDex);
        require(address(this).balance >= l.amount, "Hub has no liquidity");

        l.backer = msg.sender;
        l.dexBacking = requiredDex;
        l.funded = true;
        l.active = true;
        l.nextPaymentDue = block.timestamp + paymentCycle;

        (bool success, ) = l.borrower.call{value: l.amount}("");
        require(success, "ETH transfer failed");

        emit NftLoanFunded(loanId, msg.sender, requiredDex);
    }

    /// @notice Pay interest cycle; 50% to backer, 50% retained by hub.
    function makeNftPayment(uint256 loanId) external payable nonReentrant {
        NftLoan storage l = nftLoans[loanId];
        require(l.funded && l.active, "Inactive loan");
        require(msg.sender == l.borrower, "Not borrower");
        require(block.timestamp <= l.deadline, "Expired");

        if (block.timestamp > l.nextPaymentDue) {
            _liquidateNftLoan(loanId);
            return;
        }

        uint256 cyclePayment = l.totalInterest / l.totalCycles;
        require(msg.value == cyclePayment, "Wrong amount");
        require(l.paymentsMade < l.totalCycles, "All payments made");

        uint256 toBacker = cyclePayment / 2;
        _sendEth(l.backer, toBacker);

        l.paymentsMade++;
        l.nextPaymentDue += paymentCycle;
        emit NftLoanPayment(loanId, l.paymentsMade);
    }

    /// @notice Repay loan; 50% of remaining interest + fee to backer; NFT and DEX returned.
    function terminateNftLoan(uint256 loanId) external payable nonReentrant {
        NftLoan storage l = nftLoans[loanId];
        require(l.funded && l.active, "Inactive");
        require(msg.sender == l.borrower, "Not borrower");

        uint256 paidInterest = (l.totalInterest / l.totalCycles) * l.paymentsMade;
        uint256 remainingInterest = l.totalInterest - paidInterest;
        uint256 totalDue = l.amount + remainingInterest + terminationFee;
        require(msg.value == totalDue, "Incorrect repayment");

        uint256 backerShare = (remainingInterest + terminationFee) / 2;
        _sendEth(l.backer, backerShare);

        address borrower = l.borrower;
        address backer = l.backer;
        uint256 tokenId = l.tokenId;
        uint256 dexBacking = l.dexBacking;

        l.active = false;
        delete nftLoans[loanId];

        _releaseNft(tokenId, borrower);
        IERC20(address(dexToken)).safeTransfer(backer, dexBacking);

        emit NftLoanFinished(loanId, borrower);
    }

    /// @notice Backer can check if the loan already expired, and force it to
    // transfer the nft to him
    function checkNftLoanBacker(uint256 loanId) external nonReentrant {
        NftLoan storage l = nftLoans[loanId];
        require(block.timestamp > l.deadline, "Not expired yet");

        require(l.funded && l.active, "Inactive");
        require(msg.sender == l.backer, "Not backer");
        uint256 tokenId = l.tokenId;
        address backer = l.backer;
        address borrower = l.borrower;
        _releaseNft(tokenId, backer);

        l.active = false;
        delete nftLoans[loanId];

        emit NftLoanFinished(loanId, borrower);
    }

    /// @notice Cancel unfunded loan request; NFT returned to borrower.
    function cancelNftLoanRequest(uint256 loanId) external nonReentrant {
        NftLoan storage l = nftLoans[loanId];
        require(!l.funded, "Already funded");
        require(msg.sender == l.borrower, "Not borrower");

        uint256 tokenId = l.tokenId;
        delete nftLoans[loanId];

        _releaseNft(tokenId, msg.sender);
        emit NftLoanCancelled(loanId);
    }

    /// @notice Liquidate NFT loan after deadline.
    function checkNftLoan(uint256 loanId) external {
        NftLoan storage l = nftLoans[loanId];
        require(l.funded && l.active, "Inactive");
        if (block.timestamp > l.deadline) {
            _liquidateNftLoan(loanId);
        }
    }

    function getNftLoan(uint256 loanId) external view returns (NftLoan memory) {
        return nftLoans[loanId];
    }

    function requiredDexBacking(uint256 loanId) external view returns (uint256) {
        NftLoan storage l = nftLoans[loanId];
        require(l.borrower != address(0) && !l.funded, "Not pending");
        return l.amount / dexToken.dexSwapRate();
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

    /// @dev Seller receives the listing currency; buyer may pay with ETH or DEX.
    /// @dev Seller receives 95%, contract owner receives 5%
function _collectPayment(address seller, Currency currency, uint256 price, uint feePercentage) internal {
    uint256 swapRate = dexToken.dexSwapRate();
    require(feePercentage >= 0);
    require(feePercentage <=100);
    uint256 fee = (price * feePercentage) / 100;
    uint256 sellerAmount = price - fee;

    if (currency == Currency.ETH) {

        if (msg.value > 0) {
            require(msg.value == price, "Wrong ETH amount");

            _sendEth(seller, sellerAmount);
            _sendEth(owner(), fee);

        } else {
            uint256 dexRequired = price / swapRate;

            require(dexRequired * swapRate == price, "DEX amount imprecise");

            IERC20(address(dexToken)).safeTransferFrom(
                msg.sender,
                address(this),
                dexRequired
            );

            dexToken.sellDex(dexRequired);

            _sendEth(seller, sellerAmount);
            _sendEth(owner(), fee);
        }

    } else {

        if (msg.value > 0) {
            uint256 ethRequired = price * swapRate;

            require(msg.value == ethRequired, "Wrong ETH amount");

            dexToken.buyDex{value: ethRequired}();

            IERC20(address(dexToken)).safeTransfer(seller, sellerAmount);
            IERC20(address(dexToken)).safeTransfer(owner(), fee);

        } else {
            IERC20(address(dexToken)).safeTransferFrom(
                msg.sender,
                seller,
                sellerAmount
            );

            IERC20(address(dexToken)).safeTransferFrom(
                msg.sender,
                owner(),
                fee
            );
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

    function _liquidateNftLoan(uint256 loanId) internal {
        NftLoan storage l = nftLoans[loanId];
        if (!l.active) return;

        address borrower = l.borrower;
        address backer = l.backer;
        uint256 tokenId = l.tokenId;
        uint256 dexBacking = l.dexBacking;

        l.active = false;
        delete nftLoans[loanId];

        _releaseNft(tokenId, backer);
        IERC20(address(dexToken)).safeTransfer(backer, dexBacking);

        emit NftLoanLiquidated(loanId, borrower, backer);
    }

    receive() external payable {}
}
