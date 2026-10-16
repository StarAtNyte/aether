/**
 * Relative colour changes: "a bit darker", "warmer", "less saturated".
 */
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from './lexicon';
function hueToward(h, target, amount) {
    let d = target - h;
    if (d > 0.5)
        d -= 1;
    else if (d < -0.5)
        d += 1;
    return h + d * amount;
}
/** Apply a relative change to a colour. */
export function adjustColor(hex, dir, amount) {
    let [h, s, l] = rgbToHsl(...hexToRgb(hex));
    switch (dir) {
        case 'darker':
            l *= 1 - amount;
            break;
        case 'lighter':
            l += (1 - l) * amount;
            break;
        case 'brighter':
            s = Math.min(1, s * (1 + amount));
            l = Math.min(0.9, l * (1 + amount * 0.4));
            break;
        case 'duller':
            s *= 1 - amount;
            break;
        case 'warmer':
            h = hueToward(h, 0.07, amount);
            break;
        case 'cooler':
            h = hueToward(h, 0.58, amount);
            break;
    }
    h = ((h % 1) + 1) % 1;
    return rgbToHex(...hslToRgb(h, s, l));
}
