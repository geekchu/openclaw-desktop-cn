export { createLoggedPairingApprovalNotifier, createPairingPrefixStripper, createTextPairingAdapter, } from "../channels/plugins/pairing-adapters.js";
import { issuePairingChallenge } from "../pairing/pairing-challenge.js";
import { createScopedPairingAccess } from "./pairing-access.js";
/** Pre-bind the channel id and storage sink for pairing challenges. */
export function createChannelPairingChallengeIssuer(params) {
    return (challenge) => issuePairingChallenge({
        channel: params.channel,
        upsertPairingRequest: params.upsertPairingRequest,
        ...challenge,
    });
}
/** Build the full scoped pairing controller used by channel runtime code. */
export function createChannelPairingController(params) {
    const access = createScopedPairingAccess(params);
    return {
        ...access,
        issueChallenge: createChannelPairingChallengeIssuer({
            channel: params.channel,
            upsertPairingRequest: access.upsertPairingRequest,
        }),
    };
}
