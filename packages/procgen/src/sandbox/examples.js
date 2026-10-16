const lighthouse = {
    id: 'lighthouse',
    description: 'Striped lighthouse with a gallery, railing and a glowing lamp room.',
    params: {
        height: { type: 'number', default: 10, min: 3, max: 40, description: 'tower height in meters' },
        stripeColor: { type: 'color', default: '#d1453b', description: 'stripe color' },
        lightColor: { type: 'color', default: '#fff2a8', description: 'lamp color' },
    },
    source: `const h = params.height;
const r = h * 0.12;
const tower = api.cylinder(r * 0.7, r, h, 16).translate(0, h / 2, 0);
tower.vertexColor((x, y, z) => (Math.floor(y / (h / 6)) % 2 === 0 ? '#f4f1ea' : params.stripeColor));
api.add(tower, { preset: 'concrete', roughness: 0.8, flatShading: true });
api.add(api.cylinder(r * 1.3, r * 1.4, h * 0.06, 16).translate(0, h * 0.03, 0), { preset: 'stone', color: '#8a8580' });
const metal = { preset: 'metal', color: '#2f3238', metalness: 0.7, roughness: 0.4 };
api.add(api.cylinder(r * 1.1, r * 1.1, h * 0.03, 16).translate(0, h + h * 0.015, 0), metal);
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2;
  api.add(api.box(0.05, h * 0.05, 0.05).translate(Math.cos(a) * r * 1.05, h + h * 0.055, Math.sin(a) * r * 1.05), metal);
}
api.add(api.torus(r * 1.05, 0.03).rotate(90, 0, 0).translate(0, h + h * 0.08, 0), metal);
const lamp = api.cylinder(r * 0.55, r * 0.55, h * 0.1, 12).translate(0, h + h * 0.08, 0);
api.add(lamp, { preset: 'emissive', color: params.lightColor, emissive: params.lightColor, emissiveIntensity: 4 });
api.add(api.cone(r * 0.75, h * 0.1, 12).translate(0, h + h * 0.18, 0), metal);
api.collider({ kind: 'cylinder', radius: r, halfHeight: h * 0.62, offset: [0, h * 0.62, 0] });
return api.build();`,
};
const bookshelf = {
    id: 'bookshelf',
    description: 'Wooden bookshelf filled with books of random sizes and colors (all books share one material via vertex colors).',
    params: {
        width: { type: 'number', default: 1.2, min: 0.5, max: 4, description: 'width in meters' },
        height: { type: 'number', default: 2, min: 0.6, max: 4, description: 'height in meters' },
        shelves: { type: 'int', default: 5, min: 1, max: 10, description: 'number of shelves' },
        woodColor: { type: 'color', default: '#8b5a2b', description: 'wood color' },
    },
    source: `const w = params.width;
const h = params.height;
const d = 0.35;
const t = 0.04;
const n = params.shelves;
const wood = { preset: 'wood', color: params.woodColor, roughness: 0.8 };
api.add(api.box(t, h, d).translate(-w / 2 + t / 2, h / 2, 0), wood);
api.add(api.box(t, h, d).translate(w / 2 - t / 2, h / 2, 0), wood);
api.add(api.box(w, h, t).translate(0, h / 2, -d / 2 + t / 2), wood);
const palette = ['#7a2e2e', '#2e4a7a', '#2f6b3a', '#c49a3c', '#5b3a6b', '#2b2b2b', '#b8562f'];
const gap = (h - t) / n;
for (let s = 0; s <= n; s++) {
  api.add(api.box(w, t, d).translate(0, s * gap + t / 2, 0), wood);
}
for (let s = 0; s < n; s++) {
  let x = -w / 2 + t + 0.01;
  const floor = s * gap + t;
  while (x < w / 2 - t - 0.05) {
    const bw = 0.025 + api.rng() * 0.035;
    const bh = gap * (0.6 + api.rng() * 0.3);
    const bd = d * (0.7 + api.rng() * 0.2);
    const color = palette[Math.floor(api.rng() * palette.length)];
    const book = api.box(bw, bh, bd).translate(x + bw / 2, floor + bh / 2, 0.02);
    if (api.rng() < 0.12) book.rotate(0, 0, 8);
    book.vertexColor(() => color);
    api.add(book, { preset: 'fabric', roughness: 0.9 });
    x += bw + 0.004;
  }
}
api.collider({ kind: 'box', halfExtents: [w / 2, h / 2, d / 2], offset: [0, h / 2, 0] });
return api.build();`,
};
const rocket = {
    id: 'rocket',
    description: 'Retro rocket standing on three fins with a porthole, accent nose cone and nozzle.',
    params: {
        height: { type: 'number', default: 6, min: 1, max: 40, description: 'height in meters' },
        bodyColor: { type: 'color', default: '#e8e8ee', description: 'body color' },
        accentColor: { type: 'color', default: '#d1453b', description: 'nose and fin color' },
    },
    source: `const h = params.height;
const r = h * 0.11;
const profile = [[0, h * 0.12], [r * 0.85, h * 0.12], [r, h * 0.3], [r, h * 0.62], [r * 0.7, h * 0.82], [r * 0.25, h * 0.95], [0, h]];
const body = api.lathe(profile, 20);
body.vertexColor((x, y, z) => (y > h * 0.8 ? params.accentColor : params.bodyColor));
api.add(body, { preset: 'metal', metalness: 0.4, roughness: 0.35 });
const fin = [[0, 0], [r * 1.4, 0], [r * 0.2, h * 0.38], [0, h * 0.38]];
for (let i = 0; i < 3; i++) {
  const f = api.extrude(fin, r * 0.12).translate(r * 0.6, 0, 0).rotate(0, i * 120, 0);
  api.add(f, { preset: 'metal', color: params.accentColor, metalness: 0.3, roughness: 0.4 });
}
api.add(api.cylinder(r * 0.55, r * 0.75, h * 0.08, 16).translate(0, h * 0.09, 0), { preset: 'metal', color: '#3b3e44', metalness: 0.8, roughness: 0.3 });
const ring = api.torus(r * 0.32, r * 0.06).translate(0, h * 0.58, r * 0.98);
api.add(ring, { preset: 'metal', color: '#c9ced6', metalness: 0.9, roughness: 0.2 });
api.add(api.sphere(r * 0.28, 2).scale(1, 1, 0.4).translate(0, h * 0.58, r * 0.95), { preset: 'glass', color: '#7fc8ff', emissive: '#1a5a8a', emissiveIntensity: 0.6, opacity: 0.85 });
api.autoColliders('hull');
return api.build();`,
};
const fountain = {
    id: 'fountain',
    description: 'Tiered stone fountain with a round basin, pedestal, upper bowl and shimmering water.',
    params: {
        radius: { type: 'number', default: 2, min: 0.5, max: 10, description: 'basin radius in meters' },
        stoneColor: { type: 'color', default: '#b9b2a6', description: 'stone color' },
        waterColor: { type: 'color', default: '#4fa8e0', description: 'water color' },
    },
    source: `const R = params.radius;
const stone = { preset: 'stone', roughness: 0.9, flatShading: true };
const basin = api.lathe([[0, 0], [R, 0], [R, R * 0.25], [R * 0.9, R * 0.25], [R * 0.9, R * 0.08], [0, R * 0.08]], 24);
basin.vertexColor((x, y, z) => api.mix(params.stoneColor, '#6f6a62', 0.25 + 0.25 * api.noise3(x * 2, y * 2, z * 2)));
api.add(basin, stone);
const water = { preset: 'water', color: params.waterColor, opacity: 0.8, roughness: 0.05, emissive: params.waterColor, emissiveIntensity: 0.15 };
api.add(api.cylinder(R * 0.9, R * 0.9, 0.04, 24).translate(0, R * 0.2, 0), water);
const pillar = api.lathe([[0, 0], [R * 0.16, 0], [R * 0.11, R * 0.4], [R * 0.13, R * 0.75], [0, R * 0.75]], 12);
pillar.vertexColor(() => params.stoneColor);
api.add(pillar, stone);
const bowl = api.lathe([[0, R * 0.7], [R * 0.45, R * 0.75], [R * 0.5, R * 0.9], [R * 0.44, R * 0.9], [R * 0.4, R * 0.8], [0, R * 0.8]], 18);
bowl.vertexColor(() => params.stoneColor);
api.add(bowl, stone);
api.add(api.cylinder(R * 0.4, R * 0.4, 0.03, 18).translate(0, R * 0.86, 0), water);
const jet = api.cone(R * 0.06, R * 0.45, 8).translate(0, R * 1.08, 0);
api.add(jet, { preset: 'water', color: '#cfefff', emissive: '#9fdcff', emissiveIntensity: 0.8, opacity: 0.7 });
api.collider({ kind: 'cylinder', radius: R, halfHeight: R * 0.125, offset: [0, R * 0.125, 0] });
api.collider({ kind: 'cylinder', radius: R * 0.16, halfHeight: R * 0.45, offset: [0, R * 0.45, 0] });
return api.build();`,
};
/** Few-shot examples (prompt → generator definition), all verified by tests. */
export const GENERATOR_EXAMPLES = [
    { prompt: 'a red and white striped lighthouse with a glowing lamp', def: lighthouse },
    { prompt: 'a bookshelf full of colorful books', def: bookshelf },
    { prompt: 'a retro rocket ship ready for launch', def: rocket },
    { prompt: 'a tiered stone fountain in a town square', def: fountain },
];
