/**
 * Day/night clock of a voxel world: game hours advance with real time
 * (`dayLength` seconds per day), and drive the sky (preset + time of day
 * for the environment), the terrain's sky-light level and mob spawning.
 */
/** Sky preset for an hour of the day. */
export function skyForHour(hour) {
    const h = ((hour % 24) + 24) % 24;
    if (h < 4.5 || h >= 20.5)
        return 'night';
    if (h < 7)
        return 'dawn';
    if (h < 17.5)
        return 'day';
    return 'sunset';
}
function smooth(e0, e1, x) {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}
/**
 * Sky-light multiplier 0.16 (night) … 1 (day), with smooth dawn and dusk
 * ramps. Night keeps a moonlit floor so terrain stays readable.
 */
export function daylightAt(hour) {
    const h = ((hour % 24) + 24) % 24;
    const up = smooth(4.5, 7.5, h);
    const down = 1 - smooth(17.5, 20.5, h);
    return 0.16 + 0.84 * Math.min(up, down);
}
/** Sky-light tint (linear RGB) for an hour: warm at dawn/dusk, blue at night. */
export function skyTintAt(hour, out) {
    const d = daylightAt(hour);
    const h = ((hour % 24) + 24) % 24;
    // Golden hours: distance to 6:00 or 19:00.
    const golden = Math.max(0, 1 - Math.min(Math.abs(h - 6.2), Math.abs(h - 19)) / 1.6);
    const night = 1 - smooth(0.16, 0.5, d);
    out[0] = 1 - 0.38 * night + 0.06 * golden;
    out[1] = 1 - 0.28 * night - 0.08 * golden;
    out[2] = 1 + 0.05 * night - 0.22 * golden;
    return out;
}
/** The world clock. */
export class DayClock {
    dayLength;
    running;
    /** Hours since the start of day 0. */
    hours;
    constructor(startHour, dayLength, running) {
        this.dayLength = dayLength;
        this.running = running;
        this.hours = Math.max(0, Math.min(24, Number.isFinite(startHour) ? startHour : 8));
    }
    /** Advance by `dt` real seconds. */
    tick(dt) {
        if (!this.running || !(dt > 0))
            return;
        this.hours += (dt / Math.max(1, this.dayLength)) * 24;
    }
    /** Hour of day 0–24. */
    get hour() {
        return this.hours % 24;
    }
    /** Days elapsed. */
    get day() {
        return Math.floor(this.hours / 24);
    }
    /** Night: hostile mobs spawn. */
    get isNight() {
        const h = this.hour;
        return h >= 19.5 || h < 5;
    }
    /** Sky-light multiplier now. */
    get daylight() {
        return daylightAt(this.hour);
    }
    /** Jump to a day and hour (saves, sleeping). */
    set(day, hour) {
        this.hours = Math.max(0, Math.floor(day)) * 24 + Math.max(0, Math.min(24, hour));
    }
}
