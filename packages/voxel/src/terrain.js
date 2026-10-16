import { rng } from '@aether/core';
import { AIR, CHUNK, CHUNK_VOLUME, HEIGHT, LAYER, SEA_LEVEL } from './constants';
import { hash2, hash3, SimplexNoise, smoothstep, unit } from './noise';
/** Biome ids for compact per-column storage. */
export const BIOMES = ['ocean', 'beach', 'plains', 'forest', 'desert', 'snow', 'mountains'];
const PRESETS = {
    survival: { bias: 0.14, mountains: 1, hills: 1, caves: true, trees: true },
    plains: { bias: 0.7, mountains: 0.12, hills: 0.7, biome: 'plains', caves: true, trees: true },
    forest: { bias: 0.7, mountains: 0.25, hills: 1, biome: 'forest', caves: true, trees: true },
    desert: { bias: 0.7, mountains: 0.2, hills: 0.8, biome: 'desert', caves: true, trees: true },
    snow: { bias: 0.55, mountains: 0.7, hills: 1, biome: 'snow', caves: true, trees: true },
    mountains: { bias: 0.6, mountains: 1.9, hills: 1.2, caves: true, trees: true },
    islands: { bias: -0.3, mountains: 0.35, hills: 1.1, caves: true, trees: true },
};
/** Surface height of the flat preset (top grass block y). */
export const FLAT_HEIGHT = SEA_LEVEL + 3;
/** Cave sample spacing (blocks) for the interpolated cave field. */
const CAVE_STEP = 4;
const CAVE_NX = CHUNK / CAVE_STEP + 1;
const CAVE_NY = HEIGHT / CAVE_STEP + 1;
/** Seeded terrain generator for one world (immutable; safe to share). */
export class TerrainGenerator {
    seed;
    preset;
    reg;
    cont;
    hills;
    ridge;
    climate;
    cave;
    shape;
    b;
    /** Interpolated cave field scratch (CAVE_NX × CAVE_NX × CAVE_NY). */
    caveField = new Float32Array(CAVE_NX * CAVE_NX * CAVE_NY);
    heights = new Int16Array(LAYER);
    biomes = new Uint8Array(LAYER);
    constructor(seed, preset, reg) {
        this.seed = seed;
        this.preset = preset;
        this.reg = reg;
        this.cont = new SimplexNoise(seed ^ 0x1234567);
        this.hills = new SimplexNoise(seed ^ 0x2345671);
        this.ridge = new SimplexNoise(seed ^ 0x3456712);
        this.climate = new SimplexNoise(seed ^ 0x4567123);
        this.cave = new SimplexNoise(seed ^ 0x5671234);
        this.shape = preset === 'flat' || preset === 'void' ? null : PRESETS[preset];
        const names = [
            'stone', 'dirt', 'grass', 'snowy_grass', 'sand', 'gravel', 'clay', 'sandstone', 'snow', 'ice', 'water', 'lava', 'bedrock',
            'oak_log', 'oak_leaves', 'birch_log', 'birch_leaves', 'spruce_log', 'spruce_leaves', 'cactus', 'dead_bush', 'tall_grass', 'poppy',
            'dandelion', 'cornflower', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'coarse_dirt', 'packed_ice',
        ];
        this.b = {};
        for (const n of names)
            this.b[n] = reg.idOr(n);
    }
    id(name) {
        return this.b[name] ?? AIR;
    }
    /** Top solid block y of the natural terrain at column (x, z); −1 when there is none (void). */
    height(x, z) {
        const shape = this.shape;
        if (!shape)
            return this.preset === 'flat' ? FLAT_HEIGHT : -1;
        const c = this.cont.fbm2(x * 0.0013, z * 0.0013, 4) + shape.bias;
        const land = smoothstep(-0.3, 0.04, c);
        const hills = this.hills.fbm2(x * 0.0105, z * 0.0105, 4) * shape.hills;
        const detail = this.hills.noise2(x * 0.06 + 400, z * 0.06 - 300);
        let h = SEA_LEVEL - 15 + land * 21 + hills * (3 + 7 * land) + detail * 1.1;
        if (shape.mountains > 0) {
            const inland = smoothstep(0.08, 0.62, c + this.ridge.fbm2(x * 0.003 + 900, z * 0.003 - 600, 2) * 0.3);
            const ridge = this.ridge.ridged2(x * 0.0055 + 1200, z * 0.0055 + 300, 4);
            h += Math.pow(ridge, 2.3) * 72 * inland * land * shape.mountains;
        }
        if (shape.biome === 'desert' || (!shape.biome && this.isHotDry(x, z)))
            h += Math.abs(this.hills.noise2(x * 0.045, z * 0.021)) * 2.5 * land;
        return Math.max(4, Math.min(HEIGHT - 8, Math.round(h)));
    }
    isHotDry(x, z) {
        return this.temperature(x, z) > 0.28 && this.humidity(x, z) < 0.05;
    }
    temperature(x, z) {
        return this.climate.fbm2(x * 0.0009 + 3000, z * 0.0009 - 1700, 2);
    }
    humidity(x, z) {
        return this.climate.fbm2(x * 0.0012 - 2100, z * 0.0012 + 900, 2);
    }
    /** Biome of column (x, z) with natural height `h`. */
    biome(x, z, h = this.height(x, z)) {
        if (this.preset === 'flat' || this.preset === 'void')
            return 'plains';
        const shape = this.shape;
        const temp = this.temperature(x, z);
        if (h < SEA_LEVEL - 1)
            return 'ocean';
        if (h <= SEA_LEVEL + 1 && shape.biome !== 'snow' && shape.biome !== 'desert' && temp > -0.35)
            return 'beach';
        if (shape.biome)
            return h > 96 && shape.biome !== 'desert' ? 'mountains' : shape.biome;
        if (h > 90)
            return 'mountains';
        if (temp < -0.3)
            return 'snow';
        if (temp > 0.28 && this.humidity(x, z) < 0.05)
            return 'desert';
        if (this.humidity(x, z) > 0.12)
            return 'forest';
        return 'plains';
    }
    /**
     * First free y above the natural ground at (x, z), never below the sea
     * surface (structures anchored "on the surface" float on water, not under it).
     */
    groundLevel(x, z) {
        const h = this.height(x, z);
        if (h < 0)
            return SEA_LEVEL;
        return Math.max(h + 1, SEA_LEVEL);
    }
    /** Fill `out` (CHUNK_VOLUME cells) with the natural terrain of chunk (cx, cz). */
    generate(cx, cz, out) {
        out.fill(AIR, 0, CHUNK_VOLUME);
        if (this.preset === 'void')
            return;
        const x0 = cx * CHUNK;
        const z0 = cz * CHUNK;
        if (this.preset === 'flat') {
            this.flat(out);
            this.plants(x0, z0, out, true);
            return;
        }
        const heights = this.heights;
        const biomes = this.biomes;
        for (let lz = 0; lz < CHUNK; lz++) {
            for (let lx = 0; lx < CHUNK; lx++) {
                const h = this.height(x0 + lx, z0 + lz);
                heights[lx + lz * CHUNK] = h;
                biomes[lx + lz * CHUNK] = BIOMES.indexOf(this.biome(x0 + lx, z0 + lz, h));
            }
        }
        for (let lz = 0; lz < CHUNK; lz++)
            for (let lx = 0; lx < CHUNK; lx++)
                this.column(lx, lz, x0 + lx, z0 + lz, out);
        const shape = this.shape;
        if (shape.caves)
            this.caves(x0, z0, out);
        this.ores(cx, cz, out);
        this.plants(x0, z0, out, false);
        if (shape.trees)
            this.trees(x0, z0, out);
    }
    flat(out) {
        const bedrock = this.id('bedrock');
        const stone = this.id('stone');
        const dirt = this.id('dirt');
        const grass = this.id('grass');
        for (let y = 0; y <= FLAT_HEIGHT; y++) {
            const block = y === 0 ? bedrock : y < FLAT_HEIGHT - 3 ? stone : y < FLAT_HEIGHT ? dirt : grass;
            out.fill(block, y * LAYER, (y + 1) * LAYER);
        }
    }
    column(lx, lz, x, z, out) {
        const i = lx + lz * CHUNK;
        const h = this.heights[i];
        const biome = BIOMES[this.biomes[i]];
        const r = hash2(x, z, this.seed);
        const stone = this.id('stone');
        let top = this.id('grass');
        let filler = this.id('dirt');
        let depth = 3 + (r & 1);
        switch (biome) {
            case 'ocean': {
                const n = this.hills.noise2(x * 0.08, z * 0.08);
                top = n > 0.45 ? this.id('gravel') : n < -0.5 ? this.id('clay') : this.id('sand');
                filler = this.id('sand');
                break;
            }
            case 'beach':
                top = this.id('sand');
                filler = this.id('sand');
                depth = 4;
                break;
            case 'desert':
                top = this.id('sand');
                filler = this.id('sand');
                depth = 4;
                break;
            case 'snow':
                top = this.id('snowy_grass');
                break;
            case 'mountains':
                if (h > 100 - ((r >>> 3) & 3)) {
                    top = this.id('snow');
                    filler = stone;
                    depth = 1;
                }
                else if (h > 84) {
                    top = (r & 7) === 0 ? this.id('gravel') : stone;
                    filler = stone;
                    depth = 1;
                }
                break;
            default:
                if (h < SEA_LEVEL) {
                    top = this.id('dirt');
                }
                if (biome === 'forest' && ((r >>> 5) & 15) === 0)
                    top = this.id('coarse_dirt');
        }
        const bedrock = this.id('bedrock');
        let idx = lx + lz * CHUNK;
        for (let y = 0; y <= h; y++, idx += LAYER) {
            let block;
            if (y === 0 || (y <= 2 && ((r >>> (y * 3)) & 3) === 0))
                block = bedrock;
            else if (y === h)
                block = top;
            else if (y > h - depth)
                block = filler;
            else if (biome === 'desert' && y > h - depth - 4)
                block = this.id('sandstone');
            else
                block = stone;
            out[idx] = block;
        }
        if (h < SEA_LEVEL - 1) {
            const water = this.id('water');
            const frozen = this.temperature(x, z) < -0.35 || this.shape?.biome === 'snow';
            for (let y = h + 1; y < SEA_LEVEL; y++)
                out[lx + lz * CHUNK + y * LAYER] = frozen && y === SEA_LEVEL - 1 ? this.id('ice') : water;
        }
    }
    /** Spaghetti tunnels + cheese caverns, interpolated from a coarse 3D noise grid; lava below y = 10. */
    caves(x0, z0, out) {
        const f = this.caveField;
        const n = this.cave;
        for (let iy = 0; iy < CAVE_NY; iy++) {
            const y = iy * CAVE_STEP;
            for (let iz = 0; iz < CAVE_NX; iz++) {
                for (let ix = 0; ix < CAVE_NX; ix++) {
                    const x = x0 + ix * CAVE_STEP;
                    const z = z0 + iz * CAVE_STEP;
                    const a = n.noise3(x / 26, y / 15, z / 26);
                    const b = n.noise3(x / 26 + 71.3, y / 15 + 13.1, z / 26 - 37.7);
                    let v = (a * a + b * b) / 0.016 - 1;
                    if (y < 44) {
                        const c = n.noise3(x / 52 + 11.7, y / 30, z / 52 + 5.3);
                        v = Math.min(v, (0.58 - c) / 0.12);
                    }
                    f[ix + iz * CAVE_NX + iy * CAVE_NX * CAVE_NX] = v;
                }
            }
        }
        const lava = this.id('lava');
        const water = this.id('water');
        const heights = this.heights;
        const sxy = CAVE_NX * CAVE_NX;
        for (let lz = 0; lz < CHUNK; lz++) {
            const iz = lz >> 2;
            const tz = (lz & 3) / CAVE_STEP;
            for (let lx = 0; lx < CHUNK; lx++) {
                const ix = lx >> 2;
                const tx = (lx & 3) / CAVE_STEP;
                const h = heights[lx + lz * CHUNK];
                const ceiling = Math.min(h - 5, HEIGHT - 2);
                for (let y = 2; y <= ceiling; y++) {
                    const iy = y >> 2;
                    const ty = (y & 3) / CAVE_STEP;
                    const o = ix + iz * CAVE_NX + iy * sxy;
                    const c00 = lerp(f[o], f[o + 1], tx);
                    const c10 = lerp(f[o + CAVE_NX], f[o + CAVE_NX + 1], tx);
                    const c01 = lerp(f[o + sxy], f[o + sxy + 1], tx);
                    const c11 = lerp(f[o + sxy + CAVE_NX], f[o + sxy + CAVE_NX + 1], tx);
                    const v = lerp(lerp(c00, c10, tz), lerp(c01, c11, tz), ty);
                    if (v >= 0)
                        continue;
                    const idx = lx + lz * CHUNK + y * LAYER;
                    const cur = out[idx];
                    if (cur === water || cur === AIR)
                        continue;
                    out[idx] = y <= 10 ? lava : AIR;
                }
            }
        }
    }
    /** Ore veins (random-walk blobs) replacing stone, seeded per chunk. */
    ores(cx, cz, out) {
        const random = rng(hash2(cx, cz, this.seed ^ 0x0e5));
        const stone = this.id('stone');
        const vein = (block, count, size, maxY) => {
            for (let v = 0; v < count; v++) {
                let x = Math.floor(random() * CHUNK);
                let y = 3 + Math.floor(random() * (maxY - 3));
                let z = Math.floor(random() * CHUNK);
                const n = Math.max(1, Math.round(size * (0.6 + random() * 0.8)));
                for (let k = 0; k < n; k++) {
                    if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK && y > 0 && y < HEIGHT) {
                        const idx = x + z * CHUNK + y * LAYER;
                        if (out[idx] === stone)
                            out[idx] = block;
                    }
                    const d = Math.floor(random() * 6);
                    if (d === 0)
                        x++;
                    else if (d === 1)
                        x--;
                    else if (d === 2)
                        y++;
                    else if (d === 3)
                        y--;
                    else if (d === 4)
                        z++;
                    else
                        z--;
                }
            }
        };
        vein(this.id('coal_ore'), 14, 9, 96);
        vein(this.id('iron_ore'), 9, 6, 64);
        vein(this.id('gold_ore'), 2, 5, 32);
        vein(this.id('diamond_ore'), 1, 4, 16);
    }
    /** Grass tufts, flowers and dead bushes on top of the surface (inside the chunk). */
    plants(x0, z0, out, flat) {
        const grass = this.id('grass');
        const sand = this.id('sand');
        for (let lz = 0; lz < CHUNK; lz++) {
            for (let lx = 0; lx < CHUNK; lx++) {
                const x = x0 + lx;
                const z = z0 + lz;
                const h = flat ? FLAT_HEIGHT : this.heights[lx + lz * CHUNK];
                if (h < SEA_LEVEL - 1 || h >= HEIGHT - 2)
                    continue;
                const surface = out[lx + lz * CHUNK + h * LAYER];
                const above = lx + lz * CHUNK + (h + 1) * LAYER;
                if (out[above] !== AIR)
                    continue;
                const biome = flat ? 'plains' : BIOMES[this.biomes[lx + lz * CHUNK]];
                const r = unit(hash2(x, z, this.seed ^ 0x9137));
                if (surface === grass) {
                    const grassChance = biome === 'plains' ? (flat ? 0.08 : 0.22) : biome === 'forest' ? 0.12 : biome === 'mountains' ? 0.08 : 0.05;
                    const flowerChance = biome === 'plains' ? 0.035 : biome === 'forest' ? 0.012 : 0.004;
                    if (r < flowerChance) {
                        // Flowers grow in patches of one color.
                        const patch = this.climate.noise2(x * 0.07 + 50, z * 0.07 - 50);
                        out[above] = patch > 0.25 ? this.id('poppy') : patch < -0.25 ? this.id('cornflower') : this.id('dandelion');
                    }
                    else if (r < flowerChance + grassChance) {
                        out[above] = this.id('tall_grass');
                    }
                }
                else if (surface === sand && biome === 'desert' && r < 0.012) {
                    out[above] = this.id('dead_bush');
                }
            }
        }
    }
    /** Trees and cacti from a jittered 4 × 4 candidate grid (border-crossing crowns are clipped per chunk). */
    trees(x0, z0, out) {
        const G = 4;
        const R = 3;
        const gx0 = Math.floor((x0 - R) / G);
        const gx1 = Math.floor((x0 + CHUNK - 1 + R) / G);
        const gz0 = Math.floor((z0 - R) / G);
        const gz1 = Math.floor((z0 + CHUNK - 1 + R) / G);
        for (let gz = gz0; gz <= gz1; gz++) {
            for (let gx = gx0; gx <= gx1; gx++) {
                const r = hash2(gx, gz, this.seed ^ 0x7ee5);
                const x = gx * G + (r & 3);
                const z = gz * G + ((r >>> 2) & 3);
                const h = this.height(x, z);
                if (h < SEA_LEVEL || h > HEIGHT - 14)
                    continue;
                const biome = this.biome(x, z, h);
                const chance = biome === 'forest' ? 0.62 : biome === 'plains' ? 0.05 : biome === 'snow' ? 0.3 : biome === 'mountains' ? (h < 84 ? 0.1 : 0) : biome === 'desert' ? 0.09 : 0;
                if (unit(hash2(gx, gz, this.seed ^ 0x51ee)) >= chance)
                    continue;
                const kind = (r >>> 4) & 15;
                const tall = (r >>> 8) & 3;
                if (biome === 'desert')
                    this.cactus(x, h, z, 1 + (tall % 3), x0, z0, out);
                else if (biome === 'snow' || (biome === 'mountains' && kind < 10))
                    this.spruce(x, h, z, 6 + tall, x0, z0, out);
                else if (biome === 'forest' && kind < 5)
                    this.leafy(x, h, z, 5 + tall, this.id('birch_log'), this.id('birch_leaves'), x0, z0, out);
                else
                    this.leafy(x, h, z, 4 + tall, this.id('oak_log'), this.id('oak_leaves'), x0, z0, out);
            }
        }
    }
    put(x, y, z, block, x0, z0, out, overwrite) {
        const lx = x - x0;
        const lz = z - z0;
        if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 0 || y >= HEIGHT)
            return;
        const idx = lx + lz * CHUNK + y * LAYER;
        const cur = out[idx];
        if (overwrite || cur === AIR || this.reg.render[cur] === 3)
            out[idx] = block;
    }
    leafy(x, h, z, height, log, leaves, x0, z0, out) {
        const top = h + height;
        for (let y = top - 3; y <= top + 1; y++) {
            const radius = y >= top ? 1 : 2;
            for (let dz = -radius; dz <= radius; dz++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
                    if (corner && (radius === 1 ? y === top + 1 : (hash3(x + dx, y, z + dz, this.seed) & 1) === 0))
                        continue;
                    if (y === top + 1 && radius === 1 && dx !== 0 && dz !== 0)
                        continue;
                    this.put(x + dx, y, z + dz, leaves, x0, z0, out, false);
                }
            }
        }
        for (let y = h + 1; y <= top; y++)
            this.put(x, y, z, log, x0, z0, out, true);
        this.put(x, h, z, this.id('dirt'), x0, z0, out, true);
    }
    spruce(x, h, z, height, x0, z0, out) {
        const log = this.id('spruce_log');
        const leaves = this.id('spruce_leaves');
        const top = h + height;
        for (let y = h + 3; y <= top + 1; y++) {
            const fromTop = top + 1 - y;
            const radius = fromTop === 0 ? 0 : fromTop % 2 === 1 ? 1 : Math.min(2, 1 + Math.floor(fromTop / 3));
            for (let dz = -radius; dz <= radius; dz++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2)
                        continue;
                    this.put(x + dx, y, z + dz, leaves, x0, z0, out, false);
                }
            }
        }
        for (let y = h + 1; y <= top; y++)
            this.put(x, y, z, log, x0, z0, out, true);
    }
    cactus(x, h, z, height, x0, z0, out) {
        const c = this.id('cactus');
        for (let y = h + 1; y <= h + height; y++)
            this.put(x, y, z, c, x0, z0, out, true);
    }
}
function lerp(a, b, t) {
    return a + (b - a) * t;
}
