// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IDexToken is IERC20 {
    function dexSwapRate() external view returns (uint256);
}

/// @title Orchestrates DEX-backed ETH loans (Project 3 — requirement 2)
contract PawningHub is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IDexToken public immutable dexToken;
    address public immutable nftCollection;

    uint256 public paymentCycle;
    uint256 public interest; // percent, e.g. 10 = 10%
    uint256 public terminationFee;
    uint256 public maxLoanDuration;

    uint256 public loanCounter;

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

    event DexLoanCreated(uint256 indexed loanId, address indexed borrower, uint256 amount, uint256 deadline);
    event DexLoanPayment(uint256 indexed loanId, uint256 paymentsMade);
    event DexLoanFinished(uint256 indexed loanId, address indexed borrower);
    event DexLoanLiquidated(uint256 indexed loanId, address indexed borrower);

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
