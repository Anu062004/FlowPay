pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

template ScoreTierProof() {
    signal input actualScore;
    signal input salt;
    signal input employeeAddress;

    signal input tierMin;
    signal input tierMax;
    signal input employeeCommit;

    signal output inTier;

    component minCheck = GreaterEqThan(32);
    minCheck.in[0] <== actualScore;
    minCheck.in[1] <== tierMin;

    component maxCheck = LessThan(32);
    maxCheck.in[0] <== actualScore;
    maxCheck.in[1] <== tierMax + 1;

    component floorCheck = GreaterEqThan(32);
    floorCheck.in[0] <== actualScore;
    floorCheck.in[1] <== 450;

    component commitHash = Poseidon(2);
    commitHash.inputs[0] <== employeeAddress;
    commitHash.inputs[1] <== salt;
    commitHash.out === employeeCommit;

    inTier <== minCheck.out * maxCheck.out;
    inTier === 1;
    floorCheck.out === 1;
}

component main { public [tierMin, tierMax, employeeCommit] } = ScoreTierProof();
