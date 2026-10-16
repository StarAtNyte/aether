/**
 * Honesty guard for what the assistant says about checks. A model (or the offline planner) may write "all checks
 * passed" or "I verified it" in its closing words; when no verification ran this turn and none is about to run, the
 * claim is not backed by anything, so the reply carries a plain note saying so.
 */
/** Wording that claims the world was tested, verified or proved. */
const CLAIM = /\b(?:(?:all |the |every )?(?:tests?|checks?|verification|physics)\s+(?:all\s+)?(?:pass(?:ed|es)?|succeed(?:ed)?|ok)|(?:i|we)(?:'ve| have)?\s+(?:verified|tested|proved|proven|checked)|(?:verified|proved|proven)\s+(?:that|it|the|playable|working)|checks? passed|tests? passed|passes? all)\b/i;
/** True when `message` claims the world was verified. */
export function claimsVerification(message) {
    return CLAIM.test(message);
}
/** Note appended to a reply that claims checks which did not run. */
export const UNVERIFIED_NOTE = ' (Note: no checks were run for this reply, so this is not a verified result.)';
/**
 * The message to show: unchanged when it claims nothing or a verification ran (or will run right after this reply),
 * else with {@link UNVERIFIED_NOTE} appended.
 */
export function guardVerificationClaim(message, verification) {
    if (verification.ran || verification.pending || !claimsVerification(message))
        return message;
    return message.endsWith(UNVERIFIED_NOTE) ? message : `${message}${UNVERIFIED_NOTE}`;
}
