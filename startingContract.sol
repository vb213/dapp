// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";


/*
Lenny Briclet
Valentin Barner
========================================
HOW TO RUN & USE THE CONTRACT
========================================

This contract implements a simple DeFi system:
- Users can buy/sell DEX tokens
- Use DEX as collateral to borrow ETH
- Repay loans via periodic interest payments
- Recover collateral after full repayment

----------------------------------------
1. DEPLOYMENT
----------------------------------------

Deploy the contract with the constructor parameters:

- _dexSwapRate: price of 1 DEX in Wei (e.g., 2 means 1 DEX = 2 wei)
- _paymentCycle: duration between payments (e.g., 60 = 1 minute)
- _interest: interest rate in % (e.g., 10 = 10%)
- _terminationFee: fixed fee for closing loan early or at the end

Example:
deploy(2, 60, 10, 5)

Contract will:
- Mint 10^18 DEX tokens to itself
- Act as a liquidity pool

----------------------------------------
2. BUYING DEX
----------------------------------------

Function: buyDex()

- Send ETH to receive DEX tokens
- Conversion:
    DEX = msg.value / dexSwapRate

Example:
send 1000 wei → receive 500 DEX (if rate = 2)

----------------------------------------
3. SELLING DEX
----------------------------------------

Function: sellDex(uint256 dexAmount)

- Send DEX tokens back to contract
- Receive ETH:
    ETH = dexAmount * dexSwapRate

Requires:
- Contract must have enough ETH liquidity

----------------------------------------
4. TAKING A LOAN
----------------------------------------

Function: loan(uint256 dexAmount, uint256 duration)

Steps:
1. User provides DEX as collateral
2. Contract gives ETH loan

Rules:
- Loan = 50% of collateral value
- duration must be ≤ maxLoanDuration
- duration determines number of payment cycles

Example:
loan(500 DEX, 180 seconds)
→ receives 500 wei (if rate = 2)

----------------------------------------
5. MAKING PAYMENTS
----------------------------------------

Function: makePayment(uint256 loanId)

- Must be called every paymentCycle
- Pays ONLY interest (not principal)
- Payment amount must be EXACT

Formula:
cyclePayment = totalInterest / totalCycles

IMPORTANT:
- Missing a payment → loan is liquidated
- Collateral is lost

----------------------------------------
6. TERMINATING (CLOSING) LOAN
----------------------------------------

Function: terminateLoan(uint256 loanId)

- Final repayment step
- Must send:
    principal + remaining interest + terminationFee

After success:
- Loan is closed
- User gets back collateral (DEX)

----------------------------------------
7. LOAN FAILURE (LIQUIDATION)
----------------------------------------

Occurs when:
- Payment is missed
- Loan deadline passes

Effect:
- Loan is deleted
- Collateral is lost

----------------------------------------
8. OWNER FUNCTIONS
----------------------------------------

checkLoan(loanId)
- Allows owner to enforce liquidation if expired

getBalance()
- Returns contract ETH balance

----------------------------------------
9. USER FUNCTIONS
----------------------------------------

getDexBalance()
- Returns caller's DEX token balance

----------------------------------------
10. FULL EXAMPLE FLOW
----------------------------------------

1. buyDex(1000 wei) → get 500 DEX
2. loan(500, 180 sec) → get 500 wei
3. makePayment(loanId) → pay interest
4. makePayment(loanId)
5. makePayment(loanId)
6. terminateLoan(loanId) → repay loan + fee → get 500 DEX back

----------------------------------------
NOTES
----------------------------------------

- makePayment = interest only
- terminateLoan = full repayment + unlock collateral
- Missing payments = loss of collateral
- All ETH payments must match exact required values

========================================
*/
contract DecentralizedFinance is ERC20 {

    address public owner;

    uint256 public paymentCycle;
    uint256 public interest;          // e.g., 10 = 10%
    uint256 public terminationFee;
    uint256 public maxLoanDuration;
    uint256 public dexSwapRate;

    uint256 public loanCounter;

    struct Loan {
        address borrower;
        uint256 collateral;       // DEX tokens
        uint256 amount;           // ETH borrowed
        uint256 duration;         // total duration
        uint256 deadline;         // timestamp
        uint256 totalInterest;
        uint256 paymentsMade;
        uint256 totalCycles;
        uint256 nextPaymentDue;
        bool active;
    }

    mapping(uint256 => Loan) public loans;

    // EVENTS
    event loanCreated(address borrower, uint256 amount, uint256 deadline);
    event loanFinished(address borrower, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(uint256 _dexSwapRate, uint256 _paymentCycle, uint256 _interest, uint256 _terminationFee) ERC20("DEX", "DEX") {
        owner = msg.sender;

        dexSwapRate = _dexSwapRate;
        paymentCycle = _paymentCycle;
        interest = _interest;
        terminationFee = _terminationFee;

        maxLoanDuration = 30 minutes;

        _mint(address(this), 10**18);
    }

    // -------------------------
    // BUY / SELL
    // -------------------------

    function buyDex() external payable {
        require(msg.value > 0, "Send ETH");

        uint256 dexAmount = msg.value / dexSwapRate;
        _transfer(address(this), msg.sender, dexAmount);
    }

    function sellDex(uint256 dexAmount) external {
        require(dexAmount > 0, "Invalid amount");

        uint256 ethAmount = dexAmount * dexSwapRate;
        require(address(this).balance >= ethAmount, "Insufficient ETH");

        _transfer(msg.sender, address(this), dexAmount);

        (bool success, ) = msg.sender.call{value: ethAmount}("");
        require(success, "ETH transfer failed");
    }

    // -------------------------
    // LOAN
    // -------------------------

    function loan(uint256 dexAmount, uint256 duration)
        external
        returns (uint256)
    {
        require(duration <= maxLoanDuration, "Too long");

        // 50% LTV
        uint256 ethAmount = (dexAmount * dexSwapRate) / 2;
        require(address(this).balance >= ethAmount, "No liquidity");

        _transfer(msg.sender, address(this), dexAmount);

        uint256 cycles = duration / paymentCycle;
        require(cycles > 0, "Invalid duration");

        uint256 totalInterest = (ethAmount * interest) / 100;
        uint256 deadline = block.timestamp + duration;

        loanCounter++;

        loans[loanCounter] = Loan({
            borrower: msg.sender,
            collateral: dexAmount,
            amount: ethAmount,
            duration: duration,
            deadline: deadline,
            totalInterest: totalInterest,
            paymentsMade: 0,
            totalCycles: cycles,
            nextPaymentDue: block.timestamp + paymentCycle,
            active: true
        });
        
        (bool success, ) = msg.sender.call{value: ethAmount}("");
        require(success, "Transfer failed");

        emit loanCreated(msg.sender, ethAmount, deadline);

        return loanCounter;
    }

    // -------------------------
    // PAYMENTS
    // -------------------------

    function makePayment(uint256 loanId) external payable {
        Loan storage l = loans[loanId];

        require(l.active, "Inactive loan");
        require(msg.sender == l.borrower, "Not borrower");
        require(block.timestamp <= l.deadline, "Expired");

        // check missed payment
        if (block.timestamp > l.nextPaymentDue) {
            liquidate(loanId);
            return;
        }

        uint256 cyclePayment = l.totalInterest / l.totalCycles;
        require(msg.value == cyclePayment, "Wrong amount");
        require(l.paymentsMade < l.totalCycles, "All payments made");

        l.paymentsMade++;
        l.nextPaymentDue += paymentCycle;
    }

    // -------------------------
    // TERMINATION
    // -------------------------

    function terminateLoan(uint256 loanId) external payable  {
        Loan storage l = loans[loanId];

        require(l.active, "Inactive");
        require(msg.sender == l.borrower, "Not borrower");

        uint256 remainingInterest =
            l.totalInterest - ((l.totalInterest / l.totalCycles) * l.paymentsMade);

        uint256 totalDue = l.amount + remainingInterest + terminationFee;

        require(msg.value == totalDue, "Incorrect repayment");

        l.active = false;

        _transfer(address(this), msg.sender, l.collateral);

        emit loanFinished(msg.sender, l.amount);

        delete loans[loanId];
    }

    // -------------------------
    // LOAN CHECK
    // -------------------------

    function checkLoan(uint256 loanId) external onlyOwner {
        Loan storage l = loans[loanId];

        require(l.active, "Inactive");

        if (block.timestamp > l.deadline) {
            liquidate(loanId);
        }
    }

    function liquidate(uint256 loanId) internal {
        Loan storage l = loans[loanId];

        l.active = false;

        // _transfer(address(this), owner, l.collateral);

        delete loans[loanId];
    }

    // -------------------------
    // GETTERS
    // -------------------------

    function getBalance() external view onlyOwner returns (uint256) {
        return address(this).balance;
    }

    function getDexBalance() external view returns (uint256) {
        return balanceOf(msg.sender);
    }

    // allow contract to receive ETH
    receive() external payable {}
}