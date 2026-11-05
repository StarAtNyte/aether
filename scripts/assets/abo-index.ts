/**
 * Build `assets/abo.json.gz`: the compact index of the Amazon Berkeley Objects GLB pack (codepawl/abo-glb on Hugging Face,
 * 7,953 real products, CC BY 4.0). Nothing of the 12 GB pack is vendored: the studio streams each product from the
 * pinned Hugging Face revision at runtime. The index holds what search, placement, level of detail and the weight check
 * need: id, a short name, the object type, category and placement, search words, the measured size and pivot offset in
 * millimetres, triangles and kilobytes per level. Paths and the thumbnail URL follow the pack's fixed layout
 * (`paths` in the index).
 *
 *   npm run assets:abo                        fetch metadata.jsonl at the pinned revision and write the index
 *   npm run assets:abo -- --metadata=<file>   use a local copy of metadata.jsonl
 *   npm run assets:abo -- --revision=<sha>    pin another revision (40 hex characters)
 *   npm run assets:abo -- --json=<file>       also write the plain JSON (one product per line) for review
 *
 * The 3D models, images and listing text are by Amazon.com (Amazon Berkeley Objects, CC BY 4.0); the web-optimised
 * GLB files are by CodePawl.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ABO_CATEGORIES, ABO_PLACEMENTS, AboIndex, type AboRow } from '../../packages/assets/src/abo';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, 'assets', 'abo.json.gz');
const REPO = 'codepawl/abo-glb';
const REVISION = 'c7c8293fed3b7ab122ef5d7896521a187e0962d7';

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

interface MetaLod { file: string; triangles: number; texture_px: number; bytes: number }
interface Meta {
  id: string;
  name: string | null;
  product_type: string | null;
  brand: string | null;
  color: string | null;
  material: string | null;
  style: string | null;
  size_metres: [number, number, number];
  bounds_min: [number, number, number];
  triangles: number;
  pack_bytes: number;
  ktx2_bytes: number;
  lods: MetaLod[];
}

/** Brand and store prefixes stripped from names ("Amazon Brand – Stone & Beam Marin Sofa" → "Marin Sofa"). */
const PREFIXES = [
  /^(amazon brand|marca amazon|marque amazon|marchio amazon|amazon marke|marke amazon)\s*[-–—:]*\s*/i,
  /^(amazonbasics|amazon basics|stone & beam|stone and beam|rivet|movian|ravenna home|alkove|eono|solimo|presto|umi\.?|pinzon|amazon essentials|rivet by amazon|eono by amazon)\b\s*[-–—:]*\s*/i,
];

function cleanName(raw: string, brand: string | null): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    for (const re of PREFIXES) s = s.replace(re, '');
    if (brand && s.toLowerCase().startsWith(brand.toLowerCase())) s = s.slice(brand.length).replace(/^\s*[-–—:]*\s*/, '');
  }
  s = s.replace(/^by amazon\s*[-–—:]*\s*/i, '');
  if (s.length > 60) {
    const cut = s.slice(0, 61);
    const sp = cut.lastIndexOf(' ');
    s = (sp > 30 ? cut.slice(0, sp) : cut.slice(0, 60)).replace(/[\s,;:(–—-]+$/, '');
  }
  return s || 'Product';
}

type Cat = (typeof ABO_CATEGORIES)[number];
type Place = (typeof ABO_PLACEMENTS)[number];
interface Rule { re: RegExp; type: string; cat: Cat; place?: Place }

/** First match wins: specific phrases before the general noun. Matched against "name | product type | style". */
const RULES: Rule[] = [
  { re: /\b(wall art|canvas|framed print|art print|poster|painting|reprint|photo(graph)? of|wall decor|wall sculpture|wall hanging|tapestry|neon (light )?sign|botanical print)\b/, type: 'picture', cat: 'decor', place: 'wall' },
  { re: /\b(picture frame|photo frame|portafoto|cadre photo|bilderrahmen)\b/, type: 'picture-frame', cat: 'decor', place: 'surface' },
  { re: /\b(rug|rugs|carpet|alfombra|tappeto|tapis|teppich|doormat|door mat)\b/, type: 'rug', cat: 'decor', place: 'floor' },
  { re: /\b(curtain|curtains|drape|drapes|tenda|rideau)\b/, type: 'curtain', cat: 'decor', place: 'wall' },
  { re: /\b(fan|ventilador|ventilatore|ventilateur)\b/, type: 'fan', cat: 'props' },
  { re: /\b(floor lamp|standing lamp|torchiere|arc lamp|stehlampe|lampadaire|l[aá]mpara de pie|lampada da terra)\b/, type: 'lamp', cat: 'lighting', place: 'floor' },
  { re: /\b(table lamp|desk lamp|task lamp|bedside lamp|accent lamp|buffet lamp|l[aá]mpara de mesa|lampada da tavolo|lampe de table|tischlampe|tischleuchte)\b/, type: 'lamp', cat: 'lighting', place: 'surface' },
  { re: /\b(pendant|chandelier|ceiling|flush mount|flush-mount|semi-flush|lampadario|plafonnier|deckenleuchte|l[aá]mpara de techo)\b/, type: 'lamp', cat: 'lighting', place: 'ceiling' },
  { re: /\b(sconce|wall light|wall lamp|vanity light|vanity fixture|bath light|bathroom light|aplique|applique|wandleuchte)\b/, type: 'lamp', cat: 'lighting', place: 'wall' },
  { re: /\bheadboard\b/, type: 'headboard', cat: 'furniture', place: 'floor' },
  { re: /\bmattress\b/, type: 'mattress', cat: 'furniture', place: 'floor' },
  { re: /\b(nightstand|night stand|bedside table|bedside cabinet|comodino|table de chevet|mesita de noche|nachttisch)\b/, type: 'nightstand', cat: 'furniture', place: 'floor' },
  { re: /\b(bed frame|platform bed|bunk bed|daybed|day bed|bed|beds|letto|cama|lit)\b(?! (and|&) bath)/, type: 'bed', cat: 'furniture', place: 'floor' },
  { re: /\b(coffee table|cocktail table|tavolino da caff[eè]|mesa de centro|table basse|couchtisch)\b/, type: 'coffee-table', cat: 'furniture', place: 'floor' },
  { re: /\b(side table|end table|accent table|nesting tables?|nest of tables|c-table|c table|sofa side|tavolino|beistelltisch|mesa auxiliar|table d'appoint)\b/, type: 'side-table', cat: 'furniture', place: 'floor' },
  { re: /\b(console table|sofa table|entryway table|hall table)\b/, type: 'console', cat: 'furniture', place: 'floor' },
  { re: /\b(tv stand|tv unit|tv cabinet|tv bench|media console|media cabinet|entertainment center|entertainment centre|mueble para tv|meuble tv|mobile porta tv|tv-board|lowboard)\b/, type: 'sideboard', cat: 'furniture', place: 'floor' },
  { re: /\b(sideboard|buffet|credenza|aparador|credenza)\b/, type: 'sideboard', cat: 'furniture', place: 'floor' },
  { re: /\b(desk|writing table|computer table|escritorio|scrivania|bureau|schreibtisch|vanity table|dressing table)\b/, type: 'desk', cat: 'furniture', place: 'floor' },
  { re: /\b(dresser|chest of drawers|drawer chest|commode|c[oó]moda|kommode|cassettiera|tallboy|lowboy)\b/, type: 'dresser', cat: 'furniture', place: 'floor' },
  { re: /\b(wardrobe|armoire|armario|guardaroba|kleiderschrank|closet)\b/, type: 'wardrobe', cat: 'furniture', place: 'floor' },
  { re: /\b(bookcase|bookshelf|book shelf|etagere|étagère|shelving unit|cube storage|cube organizer|ladder shelf|libreria|estantería|bücherregal|bibliothèque)\b/, type: 'bookshelf', cat: 'furniture', place: 'floor' },
  { re: /\b(shelf|shelves|shelving|regal|mensola)\b/, type: 'shelf', cat: 'furniture' },
  { re: /\b(cabinet|cupboard|storage unit|hutch|pantry|locker)\b/, type: 'cabinet', cat: 'furniture', place: 'floor' },
  { re: /\b(bar stool|barstool|counter stool|counter-height stool|bar-stool|taburete|sgabello|tabouret|hocker|stool|stools|stool seating)\b/, type: 'stool', cat: 'furniture', place: 'floor' },
  { re: /\b(ottoman|pouf|pouffe|footstool|foot stool|poggiapiedi|puf|reposapi[eé]s)\b/, type: 'ottoman', cat: 'furniture', place: 'floor' },
  { re: /\b(bean bag|beanbag)\b/, type: 'armchair', cat: 'furniture', place: 'floor' },
  { re: /\b(sofa|couch|loveseat|love seat|sectional|settee|futon|sleeper|divano|canap[eé]|chesterfield|chaise lounge|chaise longue)\b/, type: 'sofa', cat: 'furniture', place: 'floor' },
  { re: /\b(armchair|arm chair|accent chair|club chair|lounge chair|wingback|wing chair|recliner|rocking chair|rocker|glider|slipper chair|barrel chair|butaca|sillón|poltrona|fauteuil|sessel)\b/, type: 'armchair', cat: 'furniture', place: 'floor' },
  { re: /\b(bench|banco|panca|banc|sitzbank)\b/, type: 'bench', cat: 'furniture', place: 'floor' },
  { re: /\b(office chair|desk chair|task chair|gaming chair|executive chair|swivel chair|chair|chairs|silla|sedia|chaise|stuhl)\b/, type: 'chair', cat: 'furniture', place: 'floor' },
  { re: /\b(dining table|kitchen table|dining room table|bar table|pub table|bistro table|dining set|mesa de comedor|tavolo|table de salle|esstisch|table)\b/, type: 'table', cat: 'furniture', place: 'floor' },
  { re: /\b(lamp|lamps|lantern|light fixture|lighting|l[aá]mpara|lampada|lampe|leuchte)\b/, type: 'lamp', cat: 'lighting' },
  { re: /\b(mirror|espejo|specchio|miroir|spiegel)\b/, type: 'mirror', cat: 'decor' },
  { re: /\b(clock|reloj|orologio|horloge|uhr)\b/, type: 'clock', cat: 'decor' },
  { re: /\b(pillow|cushion|cojin|cojín|cuscino|coussin|kissen)\b/, type: 'pillow', cat: 'decor', place: 'surface' },
  { re: /\b(throw blanket|blanket|quilt|duvet|comforter)\b/, type: 'blanket', cat: 'decor', place: 'surface' },
  { re: /\b(artificial|faux|fake) (plant|tree|fern|succulent|flowers?|palm)\b/, type: 'plant', cat: 'plants' },
  { re: /\b(planter|planters|plant pot|flower pot|plant stand|vaso per piante|maceta|cache-pot|blumentopf)\b/, type: 'planter', cat: 'plants' },
  { re: /\b(vase|vases|jarr[oó]n|florero)\b/, type: 'vase', cat: 'decor', place: 'surface' },
  { re: /\b(candle holder|candleholder|candlestick|candle|lantern)\b/, type: 'candle', cat: 'decor', place: 'surface' },
  { re: /\b(basket|baskets|storage box|storage bin|bin|hamper|cesta|cesto|panier)\b/, type: 'basket', cat: 'decor' },
  { re: /\b(tray|bowl|canister|jar|platter|dish|plate)\b/, type: 'bowl', cat: 'kitchen', place: 'surface' },
  { re: /\b(fry pan|frying pan|saute|skillet|pot|kettle|cookware)\b/, type: 'cookware', cat: 'kitchen', place: 'surface' },
  { re: /\b(air conditioner|dehumidifier|humidifier|heater)\b/, type: 'appliance', cat: 'props', place: 'floor' },
  { re: /\b(clothes rack|garment rack|coat rack|coat stand|hall tree|hat stand|towel rack)\b/, type: 'rack', cat: 'furniture', place: 'floor' },
  { re: /\b(ladder)\b/, type: 'ladder', cat: 'props', place: 'floor' },
  { re: /\b(gazebo|canopy|shelter|pergola|tent)\b/, type: 'gazebo', cat: 'street', place: 'floor' },
  { re: /\b(statue|sculpture|figurine|bust|bookend|bookends|decorative object|object)\b/, type: 'statue', cat: 'decor', place: 'surface' },
  { re: /\b(tv mount|monitor mount|monitor stand|laptop stand|phone stand|tablet stand|mount)\b/, type: 'stand', cat: 'props', place: 'surface' },
];

const STYLE_WORDS: ReadonlyArray<[RegExp, string[]]> = [
  [/\bmid[- ]century\b/, ['modern', 'retro', 'mid-century']],
  [/\b(modern|moderno|moderne|modernes)\b/, ['modern']],
  [/\bcontemporary\b/, ['contemporary', 'modern']],
  [/\btransitional\b/, ['contemporary', 'classic']],
  [/\bindustrial\b/, ['industrial', 'loft']],
  [/\brustic\b/, ['rustic']],
  [/\bfarmhouse\b/, ['farmhouse', 'rustic']],
  [/\b(traditional|tradicional|tradizionale)\b/, ['traditional', 'classic']],
  [/\b(classic|cl[aá]sico|classico)\b/, ['classic']],
  [/\b(vintage|antique|retro)\b/, ['vintage', 'retro']],
  [/\b(scandinavian|nordic|scandi)\b/, ['scandinavian', 'minimal']],
  [/\b(minimalist|minimal)\b/, ['minimal', 'modern']],
  [/\b(bohemian|boho)\b/, ['bohemian']],
  [/\b(coastal|nautical)\b/, ['coastal']],
  [/\b(glam|art deco)\b/, ['glam', 'classic']],
  [/\b(asian|japanese|oriental)\b/, ['asian']],
];

/** Colour words of the listing → the library's colour vocabulary and an approximate sRGB value. */
const COLOURS: ReadonlyArray<[RegExp, string, [number, number, number]]> = [
  [/\b(matte black|black|negro|nero|noir|schwarz|ebony|onyx)\b/, 'black', [28, 28, 30]],
  [/\b(white|blanco|bianco|blanc|weiss|weiß|snow|cloud dancer)\b/, 'white', [236, 234, 228]],
  [/\b(ivory|cream|crema|off-white|off white|eggshell)\b/, 'cream', [232, 222, 198]],
  [/\b(charcoal|graphite|anthracite|antracite)\b/, 'black', [52, 52, 56]],
  [/\b(dark grey|dark gray|slate)\b/, 'grey', [72, 74, 78]],
  [/\b(grey|gray|gris|grigio|grau|dove|pewter|stone|ash|silver grey|heather)\b/, 'grey', [140, 140, 138]],
  [/\b(espresso|dark brown|walnut|dark walnut|chocolate|mocha|java)\b/, 'dark-brown', [62, 42, 30]],
  [/\b(brown|cognac|saddle|chestnut|mahogany|cherry|teak|acacia|caramel|marrón|marrone|braun|brun|bronze|dark bronze)\b/, 'brown', [120, 82, 52]],
  [/\b(oak|birch|pine|maple|natural|honey|light wood|driftwood|bamboo|rattan|wicker|jute|hemp|sand|tan|camel|khaki)\b/, 'tan', [188, 156, 112]],
  [/\b(beige|linen|taupe|oatmeal|greige|mushroom|stone beige|wheat|natural linen)\b/, 'beige', [204, 190, 166]],
  [/\b(navy|indigo|denim|midnight)\b/, 'navy', [34, 44, 82]],
  [/\b(blue|azul|blu|bleu|blau|cobalt|sky blue|light blue)\b/, 'blue', [70, 110, 170]],
  [/\b(teal|aqua|turquoise|peacock)\b/, 'teal', [40, 128, 128]],
  [/\b(olive|sage|moss)\b/, 'olive', [118, 124, 76]],
  [/\b(green|verde|vert|grün|emerald|hunter green|forest)\b/, 'green', [52, 112, 70]],
  [/\b(red|rojo|rosso|rouge|rot|burgundy|wine|crimson|rust|terracotta)\b/, 'red', [150, 50, 42]],
  [/\b(pink|blush|rose|rosa|mauve)\b/, 'pink', [214, 156, 160]],
  [/\b(orange|naranja|arancione|coral|amber)\b/, 'orange', [214, 120, 48]],
  [/\b(yellow|mustard|ochre|amarillo|giallo|jaune|gelb)\b/, 'yellow', [214, 176, 52]],
  [/\b(gold|brass|golden|oro|dorado)\b/, 'gold', [196, 158, 76]],
  [/\b(silver|chrome|nickel|brushed nickel|steel|stainless|plata|argento)\b/, 'silver', [176, 178, 182]],
  [/\b(purple|violet|lavender|plum|lilac)\b/, 'purple', [110, 70, 130]],
];

const MATERIAL_WORDS = /\b(wood|wooden|solid wood|oak|walnut|pine|acacia|teak|bamboo|rattan|wicker|metal|steel|iron|brass|aluminium|aluminum|glass|marble|stone|ceramic|stoneware|porcelain|concrete|leather|faux leather|velvet|linen|wool|cotton|jute|fabric|boucle|bouclé|plastic|acrylic|resin)\b/g;

/** Listings that are not furnishings (cables, hubs, phone cases, office and medical supplies): not indexed. */
const OFF_TOPIC = new Set([
  'office products', 'multiport hub', 'electronic cable', 'battery', 'electronic adapter', 'wireless accessory', 'computer add on', 'computer', 'ce accessory',
  'portable electronic device cover', 'portable electronic device mount', 'portable electronic device stand', 'mouse pad', 'auto accessory', 'animal collar', 'handbag',
  'carrying case or bag', 'file folder', 'paper product', 'janitorial supply', 'professional healthcare', 'biss', 'instrument parts and accessories', 'sound and recording equipment',
  'accessory or part or supply', 'tools', 'building material',
]);

const STOP = new Set(['and', 'with', 'for', 'the', 'a', 'of', 'in', 'x', 'by', 'to', 'set', 'pack', 'inch', 'inches', 'cm', 'w', 'h', 'l', 'd', 'amazon', 'brand', 'marca', 'marque']);

function classify(m: Meta, name: string): { type: string; cat: Cat; place: Place } {
  const text = `${(m.name ?? '').toLowerCase()} | ${(m.product_type ?? '').toLowerCase()} | ${(m.style ?? '').toLowerCase()}`;
  const [w, h, d] = m.size_metres;
  const minY = m.bounds_min[1];
  const backOnZ = Math.abs(m.bounds_min[2]) < 0.002 && d < Math.min(w, h) * 0.5;
  const hangs = minY < -0.01;
  // The product type first when it is specific (a "wall art" listing named "Empire State Building, Black Frame").
  const pt = (m.product_type ?? '').toLowerCase();
  const byType: Record<string, Rule> = {
    'wall art': { re: /./, type: 'picture', cat: 'decor', place: 'wall' },
    rug: { re: /./, type: 'rug', cat: 'decor', place: 'floor' },
    pillow: { re: /./, type: 'pillow', cat: 'decor', place: 'surface' },
    headboard: { re: /./, type: 'headboard', cat: 'furniture', place: 'floor' },
    'home mirror': { re: /./, type: 'mirror', cat: 'decor' },
    'stool seating': { re: /./, type: 'stool', cat: 'furniture', place: 'floor' },
    ottoman: { re: /./, type: 'ottoman', cat: 'furniture', place: 'floor' },
    mattress: { re: /./, type: 'mattress', cat: 'furniture', place: 'floor' },
  };
  let rule: Rule | undefined = byType[pt];
  // The name first: a "table" or "bed" listing may be a chest of drawers, a wardrobe or a bookshelf. Then the product type.
  const named = `${(m.name ?? '').toLowerCase()} | ${(m.style ?? '').toLowerCase()}`;
  if (!rule) rule = RULES.find((r) => r.re.test(named)) ?? RULES.find((r) => r.re.test(text));
  if (!rule) rule = { re: /./, type: (pt.replace(/[^a-z]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 23) || 'object').replace(/-+$/, ''), cat: 'props' };
  let place: Place | undefined = rule.place;
  if (!place) {
    if (hangs && backOnZ) place = 'wall';
    else if (hangs && rule.type === 'lamp') place = 'ceiling';
    else if (hangs) place = 'wall';
    else if (h < 0.45 && w < 0.6 && d < 0.6 && rule.cat !== 'furniture') place = 'surface';
    else place = 'floor';
  }
  // Mirrors and lamps: hanging copies go on the wall or ceiling, standing ones on the floor.
  if (rule.type === 'mirror' && !hangs && h > 1.2) place = 'floor';
  if (rule.type === 'lamp' && place === 'ceiling' && !hangs && h < 0.9) place = 'surface';
  if (rule.type === 'lamp' && place === 'surface' && h > 1.25) place = 'floor';
  if (rule.type === 'shelf' && hangs) place = 'wall';
  if (rule.type === 'planter' && hangs) place = 'wall';
  if (rule.type === 'clock' && !hangs && !backOnZ) place = 'surface';
  void name;
  return { type: rule.type, cat: rule.cat, place };
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9-]+/)
    .filter((t) => t.length > 1 && t.length <= 24 && !STOP.has(t) && !/^\d/.test(t));
}

function row(m: Meta): AboRow {
  const name = cleanName(m.name ?? m.product_type ?? m.id, m.brand);
  const { type, cat, place } = classify(m, name);
  const text = `${(m.name ?? '').toLowerCase()} ${(m.color ?? '').toLowerCase()} ${(m.style ?? '').toLowerCase()}`;
  const styles = [...new Set(STYLE_WORDS.flatMap(([re, s]) => (re.test(text) ? s : [])))].slice(0, 6);
  const colourText = `${(m.color ?? '').toLowerCase()} ${(m.name ?? '').toLowerCase()}`;
  const colours: string[] = [];
  let rgb: [number, number, number] | null = null;
  // The listing's colour field first: the name may mention other colours ("Black Frame").
  for (const src of [(m.color ?? '').toLowerCase(), colourText]) {
    for (const [re, c, v] of COLOURS) {
      if (re.test(src) && !colours.includes(c)) {
        colours.push(c);
        rgb ??= v;
      }
    }
    if (colours.length > 0) break;
  }
  const mats = [...new Set([...`${(m.material ?? '').toLowerCase()} ${(m.name ?? '').toLowerCase()}`.matchAll(MATERIAL_WORDS)].map((x) => x[1]!.replace(/[ ]+/g, '-')))].slice(0, 4);
  // Search words not already in the name: the product type, colour and material of the listing.
  const nameWords = new Set(words(name));
  const extra = [...new Set([...words(m.product_type ?? ''), ...words(m.color ?? ''), ...mats, type])].filter((t) => !nameWords.has(t)).slice(0, 10);
  const mm = (v: number): number => Math.round(v * 1000);
  const [w, h, d] = m.size_metres;
  const [x0, y0, z0] = m.bounds_min;
  // Offset that puts the model's base on y = 0 and centres it on X/Z (most products already are: 0).
  const off: [number, number, number] = [mm(x0 + w / 2), mm(y0), mm(z0 + d / 2)];
  const kb = (b: number): number => Math.max(1, Math.round(b / 1024));
  const lod = (n: number): MetaLod => {
    const l = m.lods.find((x) => x.file.endsWith(`_lod${n}.glb`));
    if (!l) throw new Error(`${m.id}: no lod${n}`);
    return l;
  };
  return [
    m.id,
    name,
    type,
    ABO_CATEGORIES.indexOf(cat),
    ABO_PLACEMENTS.indexOf(place),
    extra.join(' '),
    styles.join(' '),
    colours.slice(0, 4).join(' '),
    rgb ? (rgb[0] << 16) | (rgb[1] << 8) | rgb[2] : -1,
    [mm(w), mm(h), mm(d)],
    off[0] === 0 && off[1] === 0 && off[2] === 0 ? 0 : off,
    [m.triangles, lod(1).triangles, lod(2).triangles, lod(3).triangles],
    [kb(m.pack_bytes), kb(m.ktx2_bytes), kb(lod(1).bytes), kb(lod(2).bytes), kb(lod(3).bytes)],
  ];
}

async function main(): Promise<void> {
  const revision = arg('revision') ?? REVISION;
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('--revision must be a 40-hex commit');
  const local = arg('metadata');
  const text = local
    ? readFileSync(resolve(local), 'utf8')
    : await fetch(`https://huggingface.co/datasets/${REPO}/resolve/${revision}/metadata.jsonl`).then((r) => {
        if (!r.ok) throw new Error(`metadata.jsonl: HTTP ${r.status}`);
        return r.text();
      });
  const metas = text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Meta);
  // Two sofas of the pack are modelled in centimetres (221 m wide): products past 8 m or without a size are left out.
  const items = metas
    .filter((m) => /^[A-Z0-9]{10}$/.test(m.id) && m.lods.length === 3 && m.size_metres.every((v) => v > 0.001 && v <= 8) && !OFF_TOPIC.has((m.product_type ?? '').toLowerCase()))
    .map(row).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const index = AboIndex.parse({
    version: 1,
    repo: REPO,
    revision,
    licence: 'CC-BY-4.0',
    credit: '3D models by Amazon.com, Amazon Berkeley Objects (CC BY 4.0); web-optimised GLB by CodePawl',
    items,
  });
  // One product per line (readable diffs when the index is rebuilt).
  const { items: rowsOut, ...head } = index;
  const json = `${JSON.stringify(head).slice(0, -1)},"items":[\n${rowsOut.map((r) => JSON.stringify(r)).join(',\n')}\n]}`;
  // Stored gzipped (the studio fetches and inflates it); `--json=<file>` also writes the plain text for review.
  const gzBytes = gzipSync(`${json}\n`, { level: 9 });
  writeFileSync(OUT, gzBytes);
  const plain = arg('json');
  if (plain) writeFileSync(resolve(plain), `${json}\n`);
  const raw = Buffer.byteLength(json);
  const gz = gzBytes.byteLength;
  const types = new Map<string, number>();
  for (const it of items) types.set(it[2], (types.get(it[2]) ?? 0) + 1);
  console.log(`${items.length} products of ${metas.length} → ${OUT} (${(raw / 1024).toFixed(0)} KB, ${(gz / 1024).toFixed(0)} KB gzipped)`);
  console.log([...types].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([t, n]) => `${t} ${n}`).join(', '));
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
