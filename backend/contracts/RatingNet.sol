// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint8, euint32, externalEuint8} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title RatingNet - Anonymous Encrypted Rating Network
/// @notice Stores encrypted rating sums per subject and computes encrypted averages on-chain using FHEVM.
///         Rating range is clamped to [1, 5] fully under encryption. The contract does not store rater identities.
/// @dev Inherits from ZamaEthereumConfig for FHEVM network configuration
contract RatingNet is ZamaEthereumConfig {
    struct Stats {
        euint32 sum;   // Encrypted sum of ratings
        uint32 count;  // Clear count of ratings
    }

    mapping(address => Stats) private _statsBySubject;

    // Scale factor to preserve two decimals: average = floor((sum * SCALE) / count)
    uint32 private constant SCALE = 100;

    /// @notice Submit an encrypted rating for a subject (rating in [1..5]).
    /// @param subject The address being rated.
    /// @param cipherScore Encrypted rating handle (externalEuint8) produced via Relayer SDK.
    /// @param inputProof Input proof associated with the encrypted rating batch.
    function submitEncryptedScore(
        address subject,
        externalEuint8 cipherScore,
        bytes calldata inputProof
    ) external {
        // Import encrypted score provided by the user (Relayer SDK)
        euint8 score = FHE.fromExternal(cipherScore, inputProof);

        // Clamp score to [1..5] entirely under FHE to enforce valid range without leaking information.
        euint8 one = FHE.asEuint8(1);
        euint8 five = FHE.asEuint8(5);
        euint8 clamped = FHE.min(FHE.max(score, one), five);

        // Accumulate on 32-bit encrypted integer
        euint32 clamped32 = FHE.asEuint32(clamped);
        _statsBySubject[subject].sum = FHE.add(_statsBySubject[subject].sum, clamped32);

        unchecked {
            _statsBySubject[subject].count += 1;
        }

        // Allow this contract to operate on the handle in the future (best practice)
        FHE.allowThis(_statsBySubject[subject].sum);
    }

    /// @notice Compute and return the encrypted average rating for a subject.
    ///         Grants decryption permission for the returned handle to msg.sender.
    /// @dev Not marked view because we update ACL to allow msg.sender to decrypt the returned value.
    /// @param subject The address being queried.
    /// @return The encrypted average as an euint32 handle, scaled by SCALE (two decimals).
    function getEncryptedAverage(address subject) external returns (euint32) {
        Stats storage s = _statsBySubject[subject];
        euint32 avg;
        if (s.count == 0) {
            avg = FHE.asEuint32(0);
        } else {
            // Compute floor((sum * SCALE) / count) under FHE
            euint32 scaledSum = FHE.mul(s.sum, FHE.asEuint32(SCALE));
            avg = FHE.div(scaledSum, s.count);
        }

        // Allow caller to decrypt the returned handle using Relayer SDK userDecrypt flow
        FHE.allow(avg, msg.sender);
        FHE.allowThis(avg);
        return avg;
    }

    /// @notice Returns the encrypted sum for a subject (handle). Useful for debugging/advanced clients.
    function getEncryptedSum(address subject) external view returns (euint32) {
        return _statsBySubject[subject].sum;
    }

    /// @notice Returns the clear count for a subject.
    function getCount(address subject) external view returns (uint32) {
        return _statsBySubject[subject].count;
    }
}


