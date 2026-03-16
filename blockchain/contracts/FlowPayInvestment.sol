// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IWETHGateway {
    function depositETH(address pool, address onBehalfOf, uint16 referralCode) external payable;
    function withdrawETH(address pool, uint256 amount, address to) external;
}

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract FlowPayInvestment {
    address public constant POOL = 0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951;
    address public constant WETH_GATEWAY = 0xD322A49006FC828F9B5B37Ab215F99B4E5caB19C;
    address public constant A_WETH = 0x5b071b590a59395fE4025A0Ccc1FcC931AAc1830;

    address public admin;
    address public treasuryWallet;
    uint256 public totalPrincipalDeposited;
    uint256 public totalPrincipalWithdrawn;

    event Deposited(uint256 amount);
    event Withdrawn(uint256 amount, address recipient);
    event YieldHarvested(uint256 yield);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not authorized");
        _;
    }

    constructor(address _admin, address _treasuryWallet) {
        require(_admin != address(0), "Invalid admin");
        require(_treasuryWallet != address(0), "Invalid treasury wallet");
        admin = _admin;
        treasuryWallet = _treasuryWallet;
    }

    receive() external payable {}

    function depositToAave() external payable onlyAdmin {
        require(msg.value > 0, "Amount must be > 0");
        IWETHGateway(WETH_GATEWAY).depositETH{value: msg.value}(POOL, address(this), 0);
        totalPrincipalDeposited += msg.value;
        emit Deposited(msg.value);
    }

    function withdrawFromAave(uint256 amount) external onlyAdmin {
        require(amount > 0, "Amount must be > 0");
        IERC20(A_WETH).approve(WETH_GATEWAY, amount);
        IWETHGateway(WETH_GATEWAY).withdrawETH(POOL, amount, address(this));
        (bool sent, ) = treasuryWallet.call{value: address(this).balance}("");
        require(sent, "Treasury transfer failed");

        uint256 outstandingPrincipal = totalPrincipalDeposited - totalPrincipalWithdrawn;
        uint256 principalPortion = amount > outstandingPrincipal ? outstandingPrincipal : amount;
        uint256 yieldPortion = amount > principalPortion ? amount - principalPortion : 0;
        totalPrincipalWithdrawn += principalPortion;

        emit Withdrawn(amount, treasuryWallet);
        if (yieldPortion > 0) {
            emit YieldHarvested(yieldPortion);
        }
    }

    function getATokenBalance() external view returns (uint256) {
        return IERC20(A_WETH).balanceOf(address(this));
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid address");
        admin = newAdmin;
    }
}
