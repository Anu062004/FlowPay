// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FlowPayLoan
 * @notice Manages employee loans with automatic credit score integration.
 *         Before issuing a loan, it checks the credit score via FlowPayCore.
 *         After every EMI repayment or loan closure, it updates the score
 *         automatically in the same transaction.
 *
 *         Backend only needs to call issueLoan() and repayEMI().
 *         Everything else is automatic.
 *
 * Deployment order:
 *   1. Deploy FlowPayCore
 *   2. Deploy FlowPayLoan(admin, coreAddress)
 *   3. Call FlowPayCore.setLoanContract(loanAddress)
 */

interface IFlowPayCore {
    function getLoanTerms(address employee)
        external
        view
        returns (bool allowed, uint256 maxAmount, uint256 interestRatePct);

    function recordLoanIssued(address employee) external;
    function recordEMIRepaid(address employee)  external;
    function recordLoanClosed(address employee) external;
}

contract FlowPayLoan {

    // ─── State ────────────────────────────────────────────────────────────────

    address public admin;
    IFlowPayCore public core;             // FlowPayCore reference

    struct Loan {
        address  employee;
        uint256  amount;
        uint256  interestRate;
        uint256  duration;
        uint256  remainingBalance;
        bool     active;
    }

    uint256 public nextLoanId = 1;
    mapping(uint256 => Loan) public loans;

    // ─── Events ───────────────────────────────────────────────────────────────

    event LoanIssued(uint256 indexed loanId, address indexed employee, uint256 amount, uint256 interestRate);
    event EMIRepaid(uint256 indexed loanId, uint256 amount, uint256 remainingBalance);
    event LoanRepaid(uint256 indexed loanId, address indexed employee);
    event LoanRejected(address indexed employee, string reason);

    // ─── Access control ───────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not authorized");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _admin, address _core) {
        require(_admin != address(0), "Invalid admin");
        require(_core  != address(0), "Invalid core address");
        admin = _admin;
        core  = IFlowPayCore(_core);
    }

    // ─── Core functions ───────────────────────────────────────────────────────

    /**
     * @notice Issue a loan to an employee.
     *         Automatically checks credit score via FlowPayCore before proceeding.
     *         If score is too low OR amount exceeds limit → reverts.
     *         On success → notifies FlowPayCore to track active loan count.
     *
     *         Backend calls this ONE function. Score check is automatic.
     *
     * @param employee      Employee wallet address
     * @param amount        Requested loan amount in wei
     * @param duration      Loan duration in months
     */
    function issueLoan(
        address employee,
        uint256 amount,
        uint256 duration
    ) external onlyAdmin returns (uint256) {
        require(employee != address(0), "Invalid employee");
        require(amount > 0,             "Amount must be > 0");
        require(duration > 0,           "Duration must be > 0");

        // ── Automatic credit score check ──────────────────────────────────────
        (bool allowed, uint256 maxAmount, uint256 interestRate) = core.getLoanTerms(employee);

        require(allowed,         "Credit score too low for a loan");
        require(amount <= maxAmount, "Amount exceeds credit limit");
        // ─────────────────────────────────────────────────────────────────────

        uint256 loanId = nextLoanId++;

        // Simple interest: total = principal * (100 + rate) / 100
        uint256 totalWithInterest = (amount * (100 + interestRate)) / 100;

        loans[loanId] = Loan({
            employee:         employee,
            amount:           amount,
            interestRate:     interestRate,
            duration:         duration,
            remainingBalance: totalWithInterest,
            active:           true
        });

        // ── Automatic score update: track active loan ──────────────────────
        core.recordLoanIssued(employee);
        // ─────────────────────────────────────────────────────────────────────

        emit LoanIssued(loanId, employee, amount, interestRate);
        return loanId;
    }

    /**
     * @notice Repay an EMI for a loan.
     *         Automatically updates credit score via FlowPayCore after repayment.
     *         If loan is fully paid → marks closed and gives bonus score points.
     *
     *         Backend calls this ONE function. Score update is automatic.
     *
     * @param loanId  ID of the loan
     * @param amount  EMI amount in wei (must match what was agreed)
     */
    function repayEMI(uint256 loanId, uint256 amount) external onlyAdmin {
        Loan storage loan = loans[loanId];
        require(loan.active,                      "Loan not active");
        require(amount > 0,                       "Amount must be > 0");
        require(amount <= loan.remainingBalance,  "Repayment exceeds balance");

        loan.remainingBalance -= amount;
        emit EMIRepaid(loanId, amount, loan.remainingBalance);

        if (loan.remainingBalance == 0) {
            // Loan fully repaid
            loan.active = false;

            // ── Automatic score update: loan closed (big reward) ───────────
            core.recordLoanClosed(loan.employee);
            // ─────────────────────────────────────────────────────────────────

            emit LoanRepaid(loanId, loan.employee);
        } else {
            // ── Automatic score update: EMI repaid ────────────────────────
            core.recordEMIRepaid(loan.employee);
            // ─────────────────────────────────────────────────────────────────
        }
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }

    /**
     * @notice Check if an employee is eligible for a loan and what terms apply.
     *         Frontend/backend can call this before attempting issueLoan.
     */
    function checkEligibility(address employee)
        external
        view
        returns (bool allowed, uint256 maxAmount, uint256 interestRatePct)
    {
        return core.getLoanTerms(employee);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid address");
        admin = newAdmin;
    }
}
