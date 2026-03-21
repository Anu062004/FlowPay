// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FlowPayCore
 * @notice Combines FlowPayVault + FlowPayCreditScore into one contract.
 *         Every payroll execution automatically updates the credit score
 *         in the same transaction — no manual step, no backend overhead.
 *
 * Deployment order:
 *   1. Deploy FlowPayCore
 *   2. Deploy FlowPayLoan(coreAddress)
 *   3. Call FlowPayCore.setLoanContract(loanAddress)
 *      → After this, FlowPayLoan can auto-update scores on EMI/close
 */
contract FlowPayCore {

    // ─── Credit Score Constants ───────────────────────────────────────────────

    uint256 public constant MAX_SCORE            = 1000;
    uint256 public constant DECAY_THRESHOLD      = 90 days;

    uint256 public constant POINTS_PAYROLL       = 20;
    uint256 public constant POINTS_EMI_REPAID    = 30;
    uint256 public constant POINTS_LOAN_CLOSED   = 80;
    uint256 public constant PENALTY_EMI_MISSED   = 60;
    uint256 public constant DECAY_AMOUNT         = 30;

    // Score tier ceilings
    uint256 public constant TIER_BLOCKED         = 300;   // 0   – 299  : no loan
    uint256 public constant TIER_MICRO           = 500;   // 300 – 499  : micro
    uint256 public constant TIER_STANDARD        = 700;   // 500 – 699  : standard
    uint256 public constant TIER_PREMIUM         = 850;   // 700 – 849  : premium
                                                          // 850 – 1000 : elite

    // ─── State ────────────────────────────────────────────────────────────────

    address public admin;
    address public loanContract;          // set after FlowPayLoan is deployed

    uint256 public totalPrincipalDeposited;
    uint256 public totalPrincipalWithdrawn;

    struct Employee {
        uint256 score;
        uint256 monthlySalary;            // in wei
        uint256 lastPayrollAt;            // timestamp of last payroll
        uint256 activeLoans;              // how many loans currently open
        bool    initialized;
    }

    mapping(address => Employee) public employees;

    // ─── Events ───────────────────────────────────────────────────────────────

    // Vault events
    event Deposit(address indexed from, uint256 amount);
    event Withdrawal(address indexed to, uint256 amount);
    event PayrollExecuted(address indexed employee, uint256 amount);
    event LoanDisbursed(address indexed employee, uint256 amount);
    event TreasuryAllocated(uint256 payroll, uint256 lending, uint256 investment);

    // Credit score events
    event EmployeeInitialized(address indexed employee, uint256 initialScore, uint256 monthlySalary);
    event ScoreUpdated(address indexed employee, uint256 oldScore, uint256 newScore, string reason);
    event ScoreDecayed(address indexed employee, uint256 oldScore, uint256 newScore);

    // ─── Access control ───────────────────────────────────────────────────────

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not authorized");
        _;
    }

    /**
     * @dev Allows admin OR the wired FlowPayLoan contract to call score
     *      update functions. This is what makes everything automatic —
     *      FlowPayLoan calls back into Core without needing admin.
     */
    modifier onlyAdminOrLoan() {
        require(
            msg.sender == admin || msg.sender == loanContract,
            "Not authorized"
        );
        _;
    }

    modifier mustBeInitialized(address employee) {
        require(employees[employee].initialized, "Employee not initialized");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _admin) {
        require(_admin != address(0), "Invalid admin");
        admin = _admin;
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    // ─── Wiring ───────────────────────────────────────────────────────────────

    /**
     * @notice Set the FlowPayLoan contract address after it is deployed.
     *         Call this once. After this, FlowPayLoan can auto-update scores.
     */
    function setLoanContract(address _loanContract) external onlyAdmin {
        require(_loanContract != address(0), "Invalid address");
        loanContract = _loanContract;
    }

    // ─── Cold Start: employer vouches for employee ────────────────────────────

    /**
     * @notice Initialize a new employee with a vouched starting score.
     *         This solves the cold-start problem — no bureau data needed.
     *         The employer's attestation of employment type + salary IS the signal.
     *
     * @param employee        Wallet address of the employee
     * @param monthlySalary   Gross monthly salary in wei
     * @param employmentType  0 = Contract/Gig  → base 300
     *                        1 = Permanent     → base 400
     *                        2 = Senior/Mgmt   → base 480
     */
    function initializeEmployee(
        address employee,
        uint256 monthlySalary,
        uint8   employmentType
    ) external onlyAdmin {
        require(employee != address(0),           "Invalid address");
        require(!employees[employee].initialized, "Already initialized");
        require(monthlySalary > 0,                "Salary must be > 0");
        require(employmentType <= 2,              "Invalid employment type");

        uint256 baseScore;
        if      (employmentType == 0) baseScore = 300;
        else if (employmentType == 1) baseScore = 400;
        else                          baseScore = 480;

        // Small salary-tier bonus (up to +20 pts) — rewards formal income proof
        if      (monthlySalary >= 200_000 ether) baseScore += 20;
        else if (monthlySalary >= 100_000 ether) baseScore += 10;
        else if (monthlySalary >= 50_000 ether)  baseScore += 5;

        employees[employee] = Employee({
            score:         baseScore,
            monthlySalary: monthlySalary,
            lastPayrollAt: block.timestamp,
            activeLoans:   0,
            initialized:   true
        });

        emit EmployeeInitialized(employee, baseScore, monthlySalary);
    }

    // ─── Vault: fund management ───────────────────────────────────────────────

    function withdraw(address payable to, uint256 amount) external onlyAdmin {
        require(address(this).balance >= amount, "Insufficient balance");
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "Withdraw failed");
        emit Withdrawal(to, amount);
    }

    function allocate(
        uint256 payrollPct,
        uint256 lendingPct,
        uint256 investmentPct
    ) external onlyAdmin {
        require(payrollPct + lendingPct + investmentPct == 100, "Must total 100%");
        emit TreasuryAllocated(payrollPct, lendingPct, investmentPct);
    }

    // ─── Payroll: the core automatic function ────────────────────────────────

    /**
     * @notice Execute payroll for an employee.
     *         Transfers ETH to employee AND updates credit score in one tx.
     *         Backend calls this ONE function — everything else is automatic.
     *
     * @param employee  Employee wallet address
     * @param amount    Payroll amount in wei
     */
    function executePayroll(
        address payable employee,
        uint256 amount
    ) external onlyAdmin mustBeInitialized(employee) {
        require(address(this).balance >= amount, "Insufficient balance");

        // Transfer salary
        (bool sent, ) = employee.call{value: amount}("");
        require(sent, "Payroll transfer failed");

        // Auto-update credit score in the same transaction
        _addScore(employee, POINTS_PAYROLL, "payroll_received");
        employees[employee].lastPayrollAt = block.timestamp;

        emit PayrollExecuted(employee, amount);
    }

    /**
     * @notice Disburse a loan amount to an employee from the vault.
     *         Called by admin after FlowPayLoan.issueLoan approves the loan.
     */
    function disburseLoan(
        address payable employee,
        uint256 amount
    ) external onlyAdmin mustBeInitialized(employee) {
        require(address(this).balance >= amount, "Insufficient balance");
        (bool sent, ) = employee.call{value: amount}("");
        require(sent, "Loan disbursement failed");
        emit LoanDisbursed(employee, amount);
    }

    // ─── Credit score: called automatically by FlowPayLoan ───────────────────

    /**
     * @notice Called by FlowPayLoan when an EMI is repaid.
     *         Automatic — no backend step needed.
     */
    function recordEMIRepaid(address employee)
        external
        onlyAdminOrLoan
        mustBeInitialized(employee)
    {
        _addScore(employee, POINTS_EMI_REPAID, "emi_repaid");
    }

    /**
     * @notice Called by FlowPayLoan when a loan is fully closed.
     *         Automatic — no backend step needed.
     */
    function recordLoanClosed(address employee)
        external
        onlyAdminOrLoan
        mustBeInitialized(employee)
    {
        Employee storage e = employees[employee];
        _addScore(employee, POINTS_LOAN_CLOSED, "loan_closed");
        if (e.activeLoans > 0) e.activeLoans -= 1;
    }

    /**
     * @notice Called by FlowPayLoan when a new loan is issued.
     *         Automatic — tracks active loan count for risk scoring.
     */
    function recordLoanIssued(address employee)
        external
        onlyAdminOrLoan
        mustBeInitialized(employee)
    {
        employees[employee].activeLoans += 1;
    }

    /**
     * @notice Called by admin when an EMI is missed.
     */
    function recordEMIMissed(address employee)
        external
        onlyAdmin
        mustBeInitialized(employee)
    {
        _subScore(employee, PENALTY_EMI_MISSED, "emi_missed");
    }

    /**
     * @notice Decay score if no payroll received for DECAY_THRESHOLD (90 days).
     *         Anyone can trigger — trustless, no admin needed.
     */
    function decayScore(address employee)
        external
        mustBeInitialized(employee)
    {
        Employee storage e = employees[employee];
        require(
            block.timestamp >= e.lastPayrollAt + DECAY_THRESHOLD,
            "Decay threshold not reached"
        );
        uint256 old = e.score;
        e.score         = e.score > DECAY_AMOUNT ? e.score - DECAY_AMOUNT : 0;
        e.lastPayrollAt = block.timestamp;
        emit ScoreDecayed(employee, old, e.score);
    }

    // ─── Loan gating: called by FlowPayLoan before issuing ───────────────────

    /**
     * @notice Returns loan eligibility and terms based on credit score.
     *         FlowPayLoan calls this automatically before every issueLoan.
     *
     * @return allowed          true if loan is permitted
     * @return maxAmount        max loan amount in wei
     * @return interestRatePct  annual interest rate as integer (e.g. 10 = 10%)
     */
    function getLoanTerms(address employee)
        external
        view
        mustBeInitialized(employee)
        returns (bool allowed, uint256 maxAmount, uint256 interestRatePct)
    {
        Employee storage e = employees[employee];
        uint256 score = e.score;

        // Multiple active loans → penalise effective score
        if (e.activeLoans >= 2) {
            score = score > 100 ? score - 100 : 0;
        }

        if      (score < TIER_BLOCKED)  return (false, 0, 0);
        else if (score < TIER_MICRO)    return (true, e.monthlySalary / 2,  12);
        else if (score < TIER_STANDARD) return (true, e.monthlySalary,      10);
        else if (score < TIER_PREMIUM)  return (true, e.monthlySalary * 2,  8);
        else                            return (true, e.monthlySalary * 3,  6);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getScore(address employee) external view returns (uint256) {
        return employees[employee].score;
    }

    function getEmployee(address employee) external view returns (Employee memory) {
        return employees[employee];
    }

    function getVaultBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid address");
        admin = newAdmin;
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    function _addScore(address employee, uint256 delta, string memory reason) internal {
        uint256 old = employees[employee].score;
        uint256 next = old + delta;
        employees[employee].score = next > MAX_SCORE ? MAX_SCORE : next;
        emit ScoreUpdated(employee, old, employees[employee].score, reason);
    }

    function _subScore(address employee, uint256 delta, string memory reason) internal {
        uint256 old = employees[employee].score;
        employees[employee].score = old > delta ? old - delta : 0;
        emit ScoreUpdated(employee, old, employees[employee].score, reason);
    }
}
