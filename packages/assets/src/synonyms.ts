/**
 * Synonym groups for asset search. Each group is a set of words that name
 * the same thing; the first word is the canonical term stored in catalog
 * tags. Queries are expanded through these groups, so "couch" finds the
 * sofa and "automobile" finds the cars.
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['sofa', 'couch', 'settee', 'loveseat', 'divan', 'chesterfield'],
  ['armchair', 'lounge chair', 'easy chair', 'recliner', 'club chair'],
  ['chair', 'seat', 'stool'],
  ['cane chair', 'rattan chair', 'wicker chair', 'bentwood chair', 'rattan stool', 'cane stool'],
  ['table', 'desk', 'counter'],
  ['coffee table', 'side table', 'end table'],
  ['bed', 'bunk', 'cot', 'mattress'],
  ['bookcase', 'bookshelf', 'shelf', 'shelving'],
  ['cabinet', 'cupboard', 'dresser', 'drawer', 'commode', 'nightstand', 'wardrobe', 'closet'],
  ['lamp', 'light', 'lantern', 'lighting', 'luminaire'],
  ['ceiling light', 'pendant', 'chandelier'],
  ['rug', 'carpet', 'mat'],
  ['plant', 'houseplant', 'potted plant', 'pot plant', 'succulent', 'greenery'],
  ['tree', 'oak', 'pine', 'fir', 'palm'],
  ['bush', 'shrub', 'hedge'],
  ['flower', 'flowers', 'bloom', 'blossom'],
  ['rock', 'stone', 'boulder', 'pebble'],
  ['cliff', 'crag', 'outcrop'],
  ['tv', 'television', 'screen', 'monitor'],
  ['computer', 'pc', 'laptop', 'keyboard'],
  ['fridge', 'refrigerator', 'freezer'],
  ['stove', 'oven', 'cooker', 'range', 'hob'],
  ['sink', 'basin', 'washbasin', 'wash basin', 'handbasin', 'hand basin', 'pedestal sink', 'pedestal basin', 'vessel sink'],
  ['toilet', 'wc', 'lavatory'],
  ['bathtub', 'bath', 'tub'],
  ['shower', 'cubicle'],
  ['washer', 'washing machine', 'laundry', 'dryer'],
  ['car', 'automobile', 'vehicle', 'sedan', 'auto'],
  ['truck', 'lorry', 'pickup', 'van'],
  ['police', 'cop', 'patrol'],
  ['taxi', 'cab'],
  ['ambulance', 'paramedic'],
  ['firetruck', 'fire engine', 'fire truck'],
  ['boat', 'ship', 'vessel', 'sailboat', 'galleon'],
  ['house', 'home', 'cottage', 'villa', 'dwelling'],
  ['building', 'shop', 'store', 'office', 'tower'],
  ['skyscraper', 'highrise', 'high-rise', 'tower block'],
  ['road', 'street', 'lane', 'avenue'],
  ['streetlight', 'street lamp', 'lamppost', 'lamp post', 'light post'],
  ['traffic light', 'stoplight', 'signal'],
  ['cone', 'traffic cone', 'pylon'],
  ['sign', 'signpost', 'signboard'],
  ['fence', 'railing', 'barrier', 'palisade'],
  ['character', 'person', 'human', 'npc', 'people', 'man', 'woman', 'villager', 'citizen'],
  ['zombie', 'undead', 'monster'],
  ['ghost', 'spirit', 'phantom'],
  ['skeleton', 'bones'],
  ['dog', 'puppy', 'hound'],
  ['cat', 'kitten', 'kitty'],
  ['bunny', 'rabbit', 'hare'],
  ['cow', 'cattle', 'bull'],
  ['pig', 'hog', 'boar'],
  ['chick', 'chicken', 'hen', 'bird'],
  ['parrot', 'bird'],
  ['penguin', 'bird'],
  ['bear', 'teddy'],
  ['deer', 'stag', 'reindeer'],
  ['fish', 'trout', 'salmon'],
  ['apple', 'fruit'],
  ['banana', 'fruit'],
  ['burger', 'hamburger', 'cheeseburger'],
  ['cake', 'dessert', 'pastry'],
  ['bread', 'loaf', 'baguette'],
  ['cup', 'mug', 'teacup'],
  ['bottle', 'flask'],
  ['plate', 'dish'],
  ['pot', 'pan', 'cookware'],
  ['axe', 'hatchet'],
  ['hammer', 'mallet'],
  ['shovel', 'spade'],
  ['pickaxe', 'pick'],
  ['chest', 'treasure', 'trunk', 'coffer'],
  ['crate', 'box', 'container'],
  ['barrel', 'cask', 'keg'],
  ['tent', 'camp'],
  ['campfire', 'bonfire', 'fire pit'],
  ['statue', 'sculpture', 'bust', 'monument'],
  ['fountain', 'well'],
  ['grave', 'gravestone', 'tombstone', 'headstone'],
  ['coffin', 'casket', 'sarcophagus'],
  ['pumpkin', 'jack-o-lantern', 'gourd'],
  ['cannon', 'artillery'],
  ['windmill', 'mill'],
  ['market', 'stall', 'stand', 'kiosk'],
  ['cart', 'wagon', 'trolley'],
  ['bench', 'seat bench'],
  ['vase', 'urn', 'jar'],
  ['speaker', 'radio', 'stereo'],
  ['mirror', 'looking glass'],
  ['trash', 'bin', 'garbage', 'rubbish', 'dumpster', 'trashcan'],
  ['hydrant', 'fire hydrant', 'standpipe'],
  ['manhole', 'sewer cover', 'drain cover', 'manhole cover'],
  ['power-pole', 'power pole', 'utility pole', 'electricity pole', 'telegraph pole', 'telephone pole'],
  ['facade', 'frontage', 'building front', 'apartment block'],
  ['pier', 'jetty', 'wharf', 'boardwalk', 'quay'],
  ['dead-tree', 'dead tree', 'snag', 'withered tree', 'bare tree'],
  ['stump', 'tree stump', 'chopped tree'],
  ['succulent', 'cactus', 'aloe', 'agave'],
  ['sword', 'blade', 'katana', 'rapier', 'cutlass'],
  ['picnic-table', 'picnic table', 'beer table'],
  ['watering-can', 'watering can', 'sprinkling can'],
  ['floodlight', 'spotlight', 'security light', 'searchlight'],
  ['pipes', 'pipe', 'piping', 'conduit'],
  ['crane', 'gantry', 'hoist'],
  ['buoy', 'lifebuoy', 'life ring', 'channel marker'],
  ['sky', 'hdri', 'environment', 'skybox'],
];

let index: Map<string, readonly string[]> | null = null;

/** Every word the given term is synonymous with (including itself), lowercase. */
export function synonymsOf(term: string): readonly string[] {
  if (!index) {
    index = new Map();
    for (const group of SYNONYM_GROUPS) {
      for (const word of group) {
        const prev = index.get(word);
        index.set(word, prev ? [...new Set([...prev, ...group])] : group);
      }
    }
  }
  return index.get(term.toLowerCase()) ?? [term.toLowerCase()];
}

/** The canonical (first) word of each group a term belongs to — used to tag catalog entries. */
export function canonicalTags(term: string): string[] {
  const t = term.toLowerCase();
  const out: string[] = [];
  for (const group of SYNONYM_GROUPS) if (group.includes(t)) out.push(...group.filter((w) => !w.includes(' ')));
  return [...new Set(out)];
}
