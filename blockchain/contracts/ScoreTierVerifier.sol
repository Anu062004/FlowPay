// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ScoreTierGroth16Verifier.sol";

contract ScoreTierVerifier is Groth16Verifier {
    uint256 private constant PUB_IN_TIER = 0;
    uint256 private constant PUB_TIER_MIN = 1;
    uint256 private constant PUB_TIER_MAX = 2;
    uint256 private constant PUB_EMPLOYEE_COMMIT = 3;

    mapping(bytes32 => address) public companyActors;
    mapping(address => bytes32) public employeeCompany;
    mapping(address => uint256) public employeeCommits;
    mapping(bytes32 => bool) public usedProofs;

    event EmployeeCommitRegistered(
        bytes32 indexed companyId,
        address indexed employeeAddr,
        uint256 employeeCommit
    );
    event TierVerified(address indexed employeeAddr, uint256 tierMin, uint256 tierMax, uint256 timestamp);
    event CompanyActorRegistered(bytes32 indexed companyId, address indexed actor);
    event CompanyActorUpdated(bytes32 indexed companyId, address indexed previousActor, address indexed newActor);

    modifier onlyCompanyActor(bytes32 companyId) {
        require(_canManageCompany(companyId, msg.sender), "Not authorized");
        _;
    }

    modifier onlyEmployeeCompanyActor(address employeeAddr) {
        require(_canManageEmployee(employeeAddr, msg.sender), "Not authorized");
        _;
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

    function getEmployeeCompany(address employeeAddr) external view returns (bytes32) {
        return employeeCompany[employeeAddr];
    }

    function registerEmployeeCommit(
        bytes32 companyId,
        address employeeAddr,
        uint256 employeeCommit
    ) external {
        _requireCompanyActorOrSelfRegister(companyId);

        require(employeeAddr != address(0), "Invalid employee");
        require(employeeCommit != 0, "Invalid commitment");

        bytes32 assignedCompany = employeeCompany[employeeAddr];
        require(
            assignedCompany == bytes32(0) || assignedCompany == companyId,
            "Employee assigned to another company"
        );

        employeeCompany[employeeAddr] = companyId;
        employeeCommits[employeeAddr] = employeeCommit;
        emit EmployeeCommitRegistered(companyId, employeeAddr, employeeCommit);
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
    ) external onlyEmployeeCompanyActor(employeeAddr) returns (bool) {
        bytes32 proofHash = keccak256(abi.encode(pA, pB, pC, pubSignals, employeeAddr));
        require(!usedProofs[proofHash], "Proof already used");
        require(previewVerifyScoreTier(pA, pB, pC, pubSignals, employeeAddr), "Invalid tier proof");

        usedProofs[proofHash] = true;
        emit TierVerified(employeeAddr, pubSignals[PUB_TIER_MIN], pubSignals[PUB_TIER_MAX], block.timestamp);
        return true;
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

    function _canManageEmployee(address employeeAddr, address actor) internal view returns (bool) {
        bytes32 companyId = employeeCompany[employeeAddr];
        return companyId != bytes32(0) && _canManageCompany(companyId, actor);
    }
}
