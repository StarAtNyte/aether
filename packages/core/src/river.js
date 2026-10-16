/**
 * Curves carved by the `terrain` generator — the river valley's riverbed
 * (variant 4) and the canyon's floor (variant 3) — shared so worlds can lay
 * water, boats, race tracks and paths exactly along them without depending
 * on the geometry kernel.
 */
/** Lateral offset (metres, along X) of the riverbed centre at `z` for a river valley of `size` metres. */
export function riverMeander(z, size) {
    return Math.sin((z * 5.1) / size) * size * 0.06 + Math.sin((z * 11.3) / size + 1.3) * size * 0.018;
}
/** Half-width (metres) of the flat riverbed of a river valley of `size` metres. */
export function riverHalfWidth(size) {
    return size * 0.035;
}
/** Lateral offset (metres, along X) of the canyon floor's centre at `z` for a canyon terrain of `size` metres. */
export function canyonMeander(z, size) {
    return Math.sin((z * 4.2) / size) * size * 0.025;
}
/** Half-width (metres) of the canyon's flat floor (before its small noise wobble) for a canyon terrain of `size` metres. */
export function canyonHalfWidth(size) {
    return size * 0.06;
}
