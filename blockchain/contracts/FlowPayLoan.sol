// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract FlowPayLoan {
    address public admin;

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

    event LoanIssued(uint256 indexed loanId, address indexed employee, uint256 amount);
    event EMIRepaid(uint256 indexed loanId, uint256 amount, uint256 remainingBalance);
    event LoanRepaid(uint256 indexed loanId);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not authorized");
        _;
    }

    constructor(address _admin) {
        require(_admin != address(0), "Invalid admin");
        admin = _admin;
    }

    function issueLoan(address employee, uint256 amount, uint256 interestRate, uint256 duration) external onlyAdmin returns (uint256) {
        uint256 loanId = nextLoanId++;
        
        // Simple interest: total = principal * (100 + rate) / 100
        // (Rate is assumed to be an integer percentage like 5 for 5%)
        uint256 totalWithInterest = (amount * (100 + interestRate)) / 100;

        loans[loanId] = Loan({
            employee: employee,
            amount: amount,
            interestRate: interestRate,
            duration: duration,
            remainingBalance: totalWithInterest,
            active: true
        });

        emit LoanIssued(loanId, employee, amount);
        return loanId;
    }

    function repayEMI(uint256 loanId, uint256 amount) external onlyAdmin {
        Loan storage loan = loans[loanId];
        require(loan.active, "Loan not active");
        require(amount <= loan.remainingBalance, "Repayment exceeds balance");

        loan.remainingBalance -= amount;
        emit EMIRepaid(loanId, amount, loan.remainingBalance);

        if (loan.remainingBalance == 0) {
            loan.active = false;
            emit LoanRepaid(loanId);
        }
    }

    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }
}
