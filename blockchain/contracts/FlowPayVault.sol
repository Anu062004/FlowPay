// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract FlowPayVault {
    address public admin;

    event Deposit(address indexed from, uint256 amount);
    event Withdrawal(address indexed to, uint256 amount);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not authorized");
        _;
    }

    constructor(address _admin) {
        require(_admin != address(0), "Invalid admin");
        admin = _admin;
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(address payable to, uint256 amount) external onlyAdmin {
        require(address(this).balance >= amount, "Insufficient balance");
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "Withdraw failed");
        emit Withdrawal(to, amount);
    }
}
