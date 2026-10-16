/**
 * Physically based clear-sky model (pure, no three.js): single scattering by air molecules (Rayleigh)
 * and aerosols (Mie) integrated along the view ray through a spherical atmosphere, with the sunlight
 * attenuated on its way in (Nishita 1993; the same integral every real-time "atmosphere" uses). It
 * gives, with no art-directed colour keys, the blue zenith and pale horizon of noon, the orange
 * horizon and purple belt of dusk, the bright aureole around the sun and the dark side opposite it,
 * all as a function of the sun's elevation alone.
 *
 * The result is mapped to display values with a soft exposure curve, so the sky never clips to white
 * and a sun below the horizon fades smoothly into twilight. Cost: ~100 transmittance evaluations per
 * direction, so a 10 k-vertex dome is a few milliseconds, paid only when the environment changes.
 */
/** Planet and atmosphere radii (metres). */
const EARTH_R = 6_371_000;
const ATMOSPHERE_R = 6_471_000;
/** Scale heights (metres) of the Rayleigh and Mie densities. */
const H_RAYLEIGH = 8_000;
const H_MIE = 1_200;
/** Sea-level scattering coefficients per metre (R, G, B). */
const BETA_RAYLEIGH = [5.8e-6, 13.5e-6, 33.1e-6];
const BETA_MIE = 21e-6;
/** Ozone absorption per metre (R, G, B) at the layer's peak, a tent of half-width OZONE_WIDTH around OZONE_PEAK. */
const BETA_OZONE = [1.3e-6, 3.3e-6, 0.1e-6];
const OZONE_PEAK = 25_000;
const OZONE_WIDTH = 15_000;
/** Mie extinction relative to its scattering. */
const MIE_EXTINCTION = 1.1;
/** Mie phase asymmetry (forward scattering). */
const MIE_G = 0.76;
/** Radiance of the sun disc fed into the integral. */
const SUN_RADIANCE = 22;
/** Samples along the view ray and towards the sun. */
const VIEW_STEPS = 12;
const LIGHT_STEPS = 5;
/** Observer height above the ground (metres). */
const EYE_HEIGHT = 2;
/** Distance from point `p` along unit direction `d` to the top of the atmosphere. */
function atmosphereExit(px, py, pz, dx, dy, dz) {
    const b = px * dx + py * dy + pz * dz;
    const c = px * px + py * py + pz * pz - ATMOSPHERE_R * ATMOSPHERE_R;
    const disc = b * b - c;
    return disc <= 0 ? 0 : -b + Math.sqrt(disc);
}
/** Relative ozone density at height `h` (m). */
function ozoneDensity(h) {
    return Math.max(0, 1 - Math.abs(h - OZONE_PEAK) / OZONE_WIDTH);
}
/** Optical depths (Rayleigh, Mie, ozone) of the ray from `p` toward the sun; false when the planet blocks it. */
function sunOpticalDepth(px, py, pz, sx, sy, sz, out) {
    const len = atmosphereExit(px, py, pz, sx, sy, sz);
    const step = len / LIGHT_STEPS;
    let dR = 0;
    let dM = 0;
    let dO = 0;
    for (let i = 0; i < LIGHT_STEPS; i++) {
        const t = (i + 0.5) * step;
        const x = px + sx * t;
        const y = py + sy * t;
        const z = pz + sz * t;
        const h = Math.sqrt(x * x + y * y + z * z) - EARTH_R;
        if (h < 0)
            return false;
        dR += Math.exp(-h / H_RAYLEIGH) * step;
        dM += Math.exp(-h / H_MIE) * step;
        dO += ozoneDensity(h) * step;
    }
    out[0] = dR;
    out[1] = dM;
    out[2] = dO;
    return true;
}
const _od = [0, 0, 0];
/**
 * Sky radiance seen along the unit direction `(dx, dy, dz)` with the sun at unit direction `(sx, sy, sz)`
 * (y up). Directions below the horizon are clamped to it. `turbidity` scales the aerosols (1 = clear
 * air, 3 = hazy). Writes and returns `out`.
 */
export function skyRadiance(dx, dy, dz, sx, sy, sz, turbidity, out) {
    const mieScale = Math.max(0.2, Math.min(6, Number.isFinite(turbidity) ? turbidity : 1.6));
    const dyc = Math.max(0.004, dy);
    const norm = Math.hypot(dx, dyc, dz) || 1;
    const vx = dx / norm;
    const vy = dyc / norm;
    const vz = dz / norm;
    const oy = EARTH_R + EYE_HEIGHT;
    const len = atmosphereExit(0, oy, 0, vx, vy, vz);
    const step = len / VIEW_STEPS;
    const mu = vx * sx + vy * sy + vz * sz;
    const phaseR = (3 / (16 * Math.PI)) * (1 + mu * mu);
    const g2 = MIE_G * MIE_G;
    const phaseM = ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + mu * mu))) / ((2 + g2) * Math.pow(1 + g2 - 2 * MIE_G * mu, 1.5));
    let odR = 0;
    let odM = 0;
    let odO = 0;
    let r0 = 0;
    let r1 = 0;
    let r2 = 0;
    let m0 = 0;
    let m1 = 0;
    let m2 = 0;
    for (let i = 0; i < VIEW_STEPS; i++) {
        const t = (i + 0.5) * step;
        const px = vx * t;
        const py = oy + vy * t;
        const pz = vz * t;
        const h = Math.sqrt(px * px + py * py + pz * pz) - EARTH_R;
        const hr = Math.exp(-h / H_RAYLEIGH) * step;
        const hm = Math.exp(-h / H_MIE) * step * mieScale;
        odR += hr;
        odM += hm;
        odO += ozoneDensity(h) * step;
        if (!sunOpticalDepth(px, py, pz, sx, sy, sz, _od))
            continue;
        const lR = _od[0];
        const lM = _od[1] * mieScale;
        const mie = BETA_MIE * MIE_EXTINCTION * (odM + lM);
        const oz = odO + _od[2];
        const a0 = Math.exp(-(BETA_RAYLEIGH[0] * (odR + lR) + mie + BETA_OZONE[0] * oz));
        const a1 = Math.exp(-(BETA_RAYLEIGH[1] * (odR + lR) + mie + BETA_OZONE[1] * oz));
        const a2 = Math.exp(-(BETA_RAYLEIGH[2] * (odR + lR) + mie + BETA_OZONE[2] * oz));
        r0 += a0 * hr;
        r1 += a1 * hr;
        r2 += a2 * hr;
        m0 += a0 * hm;
        m1 += a1 * hm;
        m2 += a2 * hm;
    }
    out[0] = SUN_RADIANCE * (r0 * BETA_RAYLEIGH[0] * phaseR + m0 * BETA_MIE * phaseM);
    out[1] = SUN_RADIANCE * (r1 * BETA_RAYLEIGH[1] * phaseR + m1 * BETA_MIE * phaseM);
    out[2] = SUN_RADIANCE * (r2 * BETA_RAYLEIGH[2] * phaseR + m2 * BETA_MIE * phaseM);
    return out;
}
/** Exposure of the luminance curve of {@link skyDisplay}. */
export const SKY_EXPOSURE = 2.1;
/** Saturation applied around the luminance (single scattering alone is a little washed out). */
const SKY_SATURATION = 1.28;
/** Soft exposure curve: radiance → display value in [0, 1) (linear light, before the sRGB encode). */
export function exposeSky(v, exposure = SKY_EXPOSURE) {
    return 1 - Math.exp(-Math.max(0, v) * exposure);
}
/**
 * Sky as display-referred linear RGB in [0, 1] for a direction. The exposure curve acts on the
 * luminance (so a bright sun-side sky keeps its hue instead of clipping to white), then a mild
 * saturation lift and a correction of the green cast single scattering leaves on a long daytime
 * horizon path (multiple scattering would fill it with blue) are applied.
 */
export function skyDisplay(dx, dy, dz, sx, sy, sz, turbidity, out) {
    skyRadiance(dx, dy, dz, sx, sy, sz, turbidity, out);
    let r = out[0];
    let g = out[1];
    let b = out[2];
    // Multiple-scattering stand-in: a high sun's long horizon path loses red, never the blue.
    if (g > r) {
        const k = Math.min(1, ((g - r) / Math.max(g, 1e-6)) * 3);
        if (b < g)
            b += (g - b) * 0.85 * k;
        r += (g - r) * 0.55 * k * Math.max(0, 1 - Math.max(0, dy) * 3.5);
    }
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (y <= 1e-9) {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        return out;
    }
    const ye = exposeSky(y);
    const k = ye / y;
    r = r * k;
    g = g * k;
    b = b * k;
    r = ye + (r - ye) * SKY_SATURATION;
    g = ye + (g - ye) * SKY_SATURATION;
    b = ye + (b - ye) * SKY_SATURATION;
    // Skylight fills the shadow side of the colour: dusk is orange and rose, never yellow-green.
    b = Math.max(b, g * 0.34, r * 0.1);
    out[0] = Math.max(0, Math.min(1, r));
    out[1] = Math.max(0, Math.min(1, g));
    out[2] = Math.max(0, Math.min(1, b));
    return out;
}
/**
 * Colour of direct sunlight for an elevation (degrees): white-gold at noon, deep orange as the sun nears
 * the horizon (the blue is scattered out of the path). Linear RGB, brightest channel 1.
 */
export function sunTransmittance(elevationDeg, out) {
    const e = (Math.max(-3, Math.min(90, elevationDeg)) * Math.PI) / 180;
    const sy = Math.sin(e);
    const sx = Math.cos(e);
    const oy = EARTH_R + EYE_HEIGHT;
    const l = atmosphereExit(0, oy, 0, sx, sy, 0);
    const steps = 16;
    const step = l / steps;
    let dR = 0;
    let dM = 0;
    let dO = 0;
    for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) * step;
        const x = sx * t;
        const y = oy + sy * t;
        const h = Math.max(0, Math.sqrt(x * x + y * y) - EARTH_R);
        dR += Math.exp(-h / H_RAYLEIGH) * step;
        dM += Math.exp(-h / H_MIE) * step;
        dO += ozoneDensity(h) * step;
    }
    for (let c = 0; c < 3; c++)
        out[c] = Math.exp(-(BETA_RAYLEIGH[c] * dR + BETA_MIE * MIE_EXTINCTION * dM + BETA_OZONE[c] * dO));
    const m = Math.max(out[0], out[1], out[2], 1e-9);
    out[0] /= m;
    out[1] /= m;
    out[2] /= m;
    return out;
}
/**
 * Representative zenith and horizon colours (display-referred linear RGB) for a sun elevation, used to
 * keep the gradient-based consumers (ambient light, reflections, fog, cloud shading) in step with the
 * dome. The horizon is sampled 55° away from the sun's azimuth and a few degrees up, where fog is seen.
 */
export function skyKeys(elevationDeg, turbidity = 1.6) {
    const e = (elevationDeg * Math.PI) / 180;
    const sy = Math.sin(e);
    const sz = Math.cos(e);
    const zenith = skyDisplay(0, 1, 0, 0, sy, sz, turbidity, [0, 0, 0]);
    const a = (55 * Math.PI) / 180;
    const el = (5 * Math.PI) / 180;
    const horizon = skyDisplay(Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el), 0, sy, sz, turbidity, [0, 0, 0]);
    return { zenith, horizon };
}
