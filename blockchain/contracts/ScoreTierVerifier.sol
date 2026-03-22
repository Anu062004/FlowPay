// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ScoreTierGroth16Verifier.sol";

contract ScoreTierVerifier is Groth16Verifier {
    address public admin;

    uint256 private constant PUB_IN_TIER = 0;
    uint256 private constant PUB_TIER_MIN = 1;
    uint256 private constant PUB_TIER_MAX = 2;
    uint256 private constant PUB_EMPLOYEE_COMMIT = 3;

    mapping(address => uint256) public employeeCommits;
    mapping(bytes32 => bool) public usedProofs;

    event EmployeeCommitRegistered(address indexed employeeAddr, uint256 employeeCommit);
    event TierVerified(address indexed employeeAddr, uint256 tierMin, uint256 tierMax, uint256 timestamp);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not authorized");
        _;
    }

    constructor(address _admin) {
        require(_admin != address(0), "Invalid admin");
        admin = _admin;
    }

    function registerEmployeeCommit(address employeeAddr, uint256 employeeCommit) external onlyAdmin {
        require(employeeAddr != address(0), "Invalid employee");
        require(employeeCommit != 0, "Invalid commitment");
        employeeCommits[employeeAddr] = employeeCommit;
        emit EmployeeCommitRegistered(employeeAddr, employeeCommit);
    }

    function previewVerifyScoreTier(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[4] calldata pubSignals,
        address employeeAddr
    ) public view returns (bool) {
        if (employeeAddr == address(0)) return false;
        if (pubSignals[PUB_IN_TIER] != 1) return false;
        if (employeeCommits[employeeAddr] == 0) return false;
        if (employeeCommits[employeeAddr] != pubSignals[PUB_EMPLOYEE_COMMIT]) return false;
        return verifyProof(pA, pB, pC, pubSignals);
    }

    function verifyScoreTier(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[4] calldata pubSignals,
        address employeeAddr
    ) external onlyAdmin returns (bool) {
        bytes32 proofHash = keccak256(abi.encode(pA, pB, pC, pubSignals, employeeAddr));
        require(!usedProofs[proofHash], "Proof already used");
        require(previewVerifyScoreTier(pA, pB, pC, pubSignals, employeeAddr), "Invalid tier proof");

        usedProofs[proofHash] = true;
        emit TierVerified(employeeAddr, pubSignals[PUB_TIER_MIN], pubSignals[PUB_TIER_MAX], block.timestamp);
        return true;
    }
}
