// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFlowPayCore {
    function getLoanTerms(address employee)
        external
        view
        returns (bool allowed, uint256 maxAmount, uint256 interestRatePct);

    function recordLoanIssued(address employee) external;
    function recordEMIRepaid(address employee) external;
    function recordLoanClosed(address employee) external;
    function canManageEmployee(address employee, address actor) external view returns (bool);
}

/**
 * @title FlowPayLoan
 * @notice Loan state where runtime writes are authorized by each company's
 *         own signer instead of a shared backend admin wallet.
 */
contract FlowPayLoan {
    IFlowPayCore public core;

    struct Loan {
        address employee;
        uint256 amount;
        uint256 interestRate;
        uint256 duration;
        uint256 remainingBalance;
        bool active;
    }

    uint256 public nextLoanId = 1;
    mapping(uint256 => Loan) public loans;

    event LoanIssued(uint256 indexed loanId, address indexed employee, uint256 amount, uint256 interestRate);
    event EMIRepaid(uint256 indexed loanId, uint256 amount, uint256 remainingBalance);
    event LoanRepaid(uint256 indexed loanId, address indexed employee);
    event LoanRejected(address indexed employee, string reason);

    modifier onlyEmployeeCompanyActor(address employee) {
        require(core.canManageEmployee(employee, msg.sender), "Not authorized");
        _;
    }

    constructor(address _core) {
        require(_core != address(0), "Invalid core address");
        core = IFlowPayCore(_core);
    }

    function issueLoan(
        address employee,
        uint256 amount,
        uint256 duration
    ) external onlyEmployeeCompanyActor(employee) returns (uint256) {
        require(employee != address(0), "Invalid employee");
        require(amount > 0, "Amount must be > 0");
        require(duration > 0, "Duration must be > 0");

        (bool allowed, uint256 maxAmount, uint256 interestRate) = core.getLoanTerms(employee);
        require(allowed, "Credit score too low for a loan");
        require(amount <= maxAmount, "Amount exceeds credit limit");

        uint256 loanId = nextLoanId++;
        uint256 totalWithInterest = (amount * (100 + interestRate)) / 100;

        loans[loanId] = Loan({
            employee: employee,
            amount: amount,
            interestRate: interestRate,
            duration: duration,
            remainingBalance: totalWithInterest,
            active: true
        });

        core.recordLoanIssued(employee);

        emit LoanIssued(loanId, employee, amount, interestRate);
        return loanId;
    }

    function repayEMI(uint256 loanId, uint256 amount) external {
        Loan storage loan = loans[loanId];
        require(core.canManageEmployee(loan.employee, msg.sender), "Not authorized");
        require(loan.active, "Loan not active");
        require(amount > 0, "Amount must be > 0");
        require(amount <= loan.remainingBalance, "Repayment exceeds balance");

        loan.remainingBalance -= amount;
        emit EMIRepaid(loanId, amount, loan.remainingBalance);

        if (loan.remainingBalance == 0) {
            loan.active = false;
            core.recordLoanClosed(loan.employee);
            emit LoanRepaid(loanId, loan.employee);
        } else {
            core.recordEMIRepaid(loan.employee);
        }
    }

    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }

    function checkEligibility(address employee)
        external
        view
        returns (bool allowed, uint256 maxAmount, uint256 interestRatePct)
    {
        return core.getLoanTerms(employee);
    }
}
