// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FlowPayCore
 * @notice Company-scoped employee and credit score state.
 *         Runtime business writes are authorized by a company-owned signer
 *         instead of a shared global admin wallet.
 */
contract FlowPayCore {
    uint256 public constant MAX_SCORE = 1000;
    uint256 public constant DECAY_THRESHOLD = 90 days;

    uint256 public constant POINTS_PAYROLL = 20;
    uint256 public constant POINTS_EMI_REPAID = 30;
    uint256 public constant POINTS_LOAN_CLOSED = 80;
    uint256 public constant PENALTY_EMI_MISSED = 60;
    uint256 public constant DECAY_AMOUNT = 30;

    uint256 public constant TIER_BLOCKED = 300;
    uint256 public constant TIER_MICRO = 500;
    uint256 public constant TIER_STANDARD = 700;
    uint256 public constant TIER_PREMIUM = 850;

    address public systemAdmin;
    address public loanContract;

    uint256 public totalPrincipalDeposited;
    uint256 public totalPrincipalWithdrawn;

    struct Employee {
        uint256 score;
        uint256 monthlySalary;
        uint256 lastPayrollAt;
        uint256 activeLoans;
        bool initialized;
    }

    mapping(bytes32 => address) public companyActors;
    mapping(address => bytes32) public employeeCompany;
    mapping(address => Employee) public employees;

    event Deposit(address indexed from, uint256 amount);
    event Withdrawal(address indexed to, uint256 amount);
    event PayrollExecuted(address indexed employee, uint256 amount);
    event LoanDisbursed(address indexed employee, uint256 amount);
    event TreasuryAllocated(bytes32 indexed companyId, uint256 payroll, uint256 lending, uint256 investment);
    event EmployeeInitialized(
        bytes32 indexed companyId,
        address indexed employee,
        uint256 initialScore,
        uint256 monthlySalary
    );
    event ScoreUpdated(address indexed employee, uint256 oldScore, uint256 newScore, string reason);
    event ScoreDecayed(address indexed employee, uint256 oldScore, uint256 newScore);
    event CompanyActorRegistered(bytes32 indexed companyId, address indexed actor);
    event CompanyActorUpdated(bytes32 indexed companyId, address indexed previousActor, address indexed newActor);
    event LoanContractSet(address indexed loanContract);
    event SystemAdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    modifier onlySystemAdmin() {
        require(msg.sender == systemAdmin, "Not authorized");
        _;
    }

    modifier mustBeInitialized(address employee) {
        require(employees[employee].initialized, "Employee not initialized");
        _;
    }

    modifier onlyCompanyActor(bytes32 companyId) {
        require(_canManageCompany(companyId, msg.sender), "Not authorized");
        _;
    }

    modifier onlyEmployeeCompanyActor(address employee) {
        require(_canManageEmployee(employee, msg.sender), "Not authorized");
        _;
    }

    modifier onlyEmployeeCompanyActorOrLoan(address employee) {
        require(msg.sender == loanContract || _canManageEmployee(employee, msg.sender), "Not authorized");
        _;
    }

    constructor(address _systemAdmin) {
        require(_systemAdmin != address(0), "Invalid system admin");
        systemAdmin = _systemAdmin;
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    function setLoanContract(address _loanContract) external onlySystemAdmin {
        require(_loanContract != address(0), "Invalid address");
        loanContract = _loanContract;
        emit LoanContractSet(_loanContract);
    }

    function registerCompanyActor(bytes32 companyId, address actor) external {
        _registerOrUpdateCompanyActor(companyId, actor);
    }

    function updateCompanyActor(bytes32 companyId, address newActor) external onlyCompanyActor(companyId) {
        require(newActor != address(0), "Invalid actor");
        address previousActor = companyActors[companyId];
        require(previousActor != newActor, "Actor unchanged");
        companyActors[companyId] = newActor;
        emit CompanyActorUpdated(companyId, previousActor, newActor);
    }

    function isCompanyActor(bytes32 companyId, address actor) external view returns (bool) {
        return _canManageCompany(companyId, actor);
    }

    function canManageEmployee(address employee, address actor) external view returns (bool) {
        return _canManageEmployee(employee, actor);
    }

    function getEmployeeCompany(address employee) external view returns (bytes32) {
        return employeeCompany[employee];
    }

    function initializeEmployee(
        bytes32 companyId,
        address employee,
        uint256 monthlySalary,
        uint8 employmentType
    ) external {
        _requireCompanyActorOrSelfRegister(companyId);

        require(employee != address(0), "Invalid address");
        require(!employees[employee].initialized, "Already initialized");
        require(monthlySalary > 0, "Salary must be > 0");
        require(employmentType <= 2, "Invalid employment type");

        bytes32 assignedCompany = employeeCompany[employee];
        require(
            assignedCompany == bytes32(0) || assignedCompany == companyId,
            "Employee assigned to another company"
        );

        uint256 baseScore;
        if (employmentType == 0) {
            baseScore = 300;
        } else if (employmentType == 1) {
            baseScore = 400;
        } else {
            baseScore = 480;
        }

        if (monthlySalary >= 200_000 ether) {
            baseScore += 20;
        } else if (monthlySalary >= 100_000 ether) {
            baseScore += 10;
        } else if (monthlySalary >= 50_000 ether) {
            baseScore += 5;
        }

        employeeCompany[employee] = companyId;
        employees[employee] = Employee({
            score: baseScore,
            monthlySalary: monthlySalary,
            lastPayrollAt: block.timestamp,
            activeLoans: 0,
            initialized: true
        });

        emit EmployeeInitialized(companyId, employee, baseScore, monthlySalary);
    }

    function withdraw(bytes32 companyId, address payable to, uint256 amount) external onlyCompanyActor(companyId) {
        require(amount == 0, "Direct vault withdrawals disabled");
        emit Withdrawal(to, amount);
    }

    function allocate(
        bytes32 companyId,
        uint256 payrollPct,
        uint256 lendingPct,
        uint256 investmentPct
    ) external onlyCompanyActor(companyId) {
        require(payrollPct + lendingPct + investmentPct == 100, "Must total 100%");
        emit TreasuryAllocated(companyId, payrollPct, lendingPct, investmentPct);
    }

    function executePayroll(address payable employee, uint256 amount)
        external
        onlyEmployeeCompanyActor(employee)
        mustBeInitialized(employee)
    {
        require(amount == 0, "Direct vault payroll disabled");

        _addScore(employee, POINTS_PAYROLL, "payroll_received");
        employees[employee].lastPayrollAt = block.timestamp;

        emit PayrollExecuted(employee, amount);
    }

    function disburseLoan(address payable employee, uint256 amount)
        external
        onlyEmployeeCompanyActor(employee)
        mustBeInitialized(employee)
    {
        require(amount == 0, "Direct vault loan disbursal disabled");
        emit LoanDisbursed(employee, amount);
    }

    function recordEMIRepaid(address employee)
        external
        onlyEmployeeCompanyActorOrLoan(employee)
        mustBeInitialized(employee)
    {
        _addScore(employee, POINTS_EMI_REPAID, "emi_repaid");
    }

    function recordLoanClosed(address employee)
        external
        onlyEmployeeCompanyActorOrLoan(employee)
        mustBeInitialized(employee)
    {
        Employee storage e = employees[employee];
        _addScore(employee, POINTS_LOAN_CLOSED, "loan_closed");
        if (e.activeLoans > 0) {
            e.activeLoans -= 1;
        }
    }

    function recordLoanIssued(address employee)
        external
        onlyEmployeeCompanyActorOrLoan(employee)
        mustBeInitialized(employee)
    {
        employees[employee].activeLoans += 1;
    }

    function recordEMIMissed(address employee)
        external
        onlyEmployeeCompanyActor(employee)
        mustBeInitialized(employee)
    {
        _subScore(employee, PENALTY_EMI_MISSED, "emi_missed");
    }

    function decayScore(address employee) external mustBeInitialized(employee) {
        Employee storage e = employees[employee];
        require(block.timestamp >= e.lastPayrollAt + DECAY_THRESHOLD, "Decay threshold not reached");
        uint256 old = e.score;
        e.score = e.score > DECAY_AMOUNT ? e.score - DECAY_AMOUNT : 0;
        e.lastPayrollAt = block.timestamp;
        emit ScoreDecayed(employee, old, e.score);
    }

    function getLoanTerms(address employee)
        external
        view
        mustBeInitialized(employee)
        returns (bool allowed, uint256 maxAmount, uint256 interestRatePct)
    {
        Employee storage e = employees[employee];
        uint256 score = e.score;

        if (e.activeLoans >= 2) {
            score = score > 100 ? score - 100 : 0;
        }

        if (score < TIER_BLOCKED) {
            return (false, 0, 0);
        } else if (score < TIER_MICRO) {
            return (true, e.monthlySalary / 2, 12);
        } else if (score < TIER_STANDARD) {
            return (true, e.monthlySalary, 10);
        } else if (score < TIER_PREMIUM) {
            return (true, e.monthlySalary * 2, 8);
        }

        return (true, e.monthlySalary * 3, 6);
    }

    function getScore(address employee) external view returns (uint256) {
        return employees[employee].score;
    }

    function getEmployee(address employee) external view returns (Employee memory) {
        return employees[employee];
    }

    function getVaultBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function transferSystemAdmin(address newSystemAdmin) external onlySystemAdmin {
        require(newSystemAdmin != address(0), "Invalid address");
        address previousAdmin = systemAdmin;
        systemAdmin = newSystemAdmin;
        emit SystemAdminTransferred(previousAdmin, newSystemAdmin);
    }

    function _registerOrUpdateCompanyActor(bytes32 companyId, address actor) internal {
        require(companyId != bytes32(0), "Invalid company");
        require(actor != address(0), "Invalid actor");

        address currentActor = companyActors[companyId];
        if (currentActor == address(0)) {
            require(msg.sender == actor, "Actor must self-register");
            companyActors[companyId] = actor;
            emit CompanyActorRegistered(companyId, actor);
            return;
        }

        require(msg.sender == currentActor, "Not authorized");
        require(currentActor != actor, "Actor unchanged");
        companyActors[companyId] = actor;
        emit CompanyActorUpdated(companyId, currentActor, actor);
    }

    function _requireCompanyActorOrSelfRegister(bytes32 companyId) internal {
        require(companyId != bytes32(0), "Invalid company");
        address currentActor = companyActors[companyId];
        if (currentActor == address(0)) {
            companyActors[companyId] = msg.sender;
            emit CompanyActorRegistered(companyId, msg.sender);
            return;
        }
        require(currentActor == msg.sender, "Not authorized");
    }

    function _canManageCompany(bytes32 companyId, address actor) internal view returns (bool) {
        return companyId != bytes32(0) && actor != address(0) && companyActors[companyId] == actor;
    }

    function _canManageEmployee(address employee, address actor) internal view returns (bool) {
        bytes32 companyId = employeeCompany[employee];
        return companyId != bytes32(0) && _canManageCompany(companyId, actor);
    }

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
