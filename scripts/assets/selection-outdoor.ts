/**
 * Realistic outdoor, street, industrial, coastal, farm, sci-fi and fantasy props from Poly Haven (CC0-1.0),
 * built by the same `--interior` pass as the furniture (`selection-interior.ts`) and ranked by `find_model`.
 * Row: `[Poly Haven id, library id, type, category, biome / style words, name, options]`.
 *
 * `type` is the object ("tree", "rock", "streetlight"); the style words name the world it belongs to
 * (forest, desert, coastal, urban, industrial, farm, scifi, fantasy) so a prompt for a desert gets cacti
 * and sandstone, not pines. Textures ship at 512 px unless the piece is large and close up.
 */
import type { InteriorRow } from './selection-interior';

const hull = { collider: 'hull' as const };
const big = { tex: 1024 as const };

export const OUTDOOR: readonly InteriorRow[] = [
  // forest and temperate woodland (the dense photoscanned trees are over the 32 MB source cap and are left to the procedural trees)
  ['dead_tree_trunk', 'tree-dead-trunk', 'dead-tree', 'nature', 'forest swamp horror wasteland', 'Dead tree trunk', { ...hull, tags: 'snag bare spooky' }],
  ['dead_tree_trunk_02', 'tree-dead-trunk-02', 'dead-tree', 'nature', 'forest swamp horror wasteland', 'Broken dead trunk', { ...hull, tags: 'snag bare spooky' }],
  ['dry_branches_medium_01', 'branches-dry', 'branches', 'nature', 'forest temperate desert wasteland', 'Dry branches', { ...hull, tags: 'sticks twigs fallen deadwood' }],
  ['fern_02', 'fern-02', 'fern', 'plants', 'forest temperate tropical', 'Fern', { ...hull, tags: 'undergrowth frond' }],
  // rocks
  ['boulder_01', 'rock-boulder-01', 'rock', 'rocks', 'forest mountain temperate', 'Boulder', { ...hull, tags: 'stone big' }],
  ['rock_07', 'rock-07', 'rock', 'rocks', 'forest mountain temperate', 'Rock', { ...hull, tags: 'stone' }],
  ['rock_09', 'rock-09', 'rock', 'rocks', 'forest mountain temperate', 'Angular rock', { ...hull, tags: 'stone' }],
  ['stone_01', 'rock-stone-01', 'rock', 'rocks', 'forest garden path', 'Stone', { ...hull, tags: 'pebble small' }],
  ['rock_moss_set_01', 'rocks-moss-01', 'rock', 'rocks', 'forest temperate swamp', 'Mossy rocks', { ...hull, tags: 'stones cluster' }],
  ['rock_moss_set_02', 'rocks-moss-02', 'rock', 'rocks', 'forest temperate swamp', 'Mossy rock group', { ...hull, tags: 'stones cluster' }],
  // desert and arid
  ['quiver_tree_01', 'tree-quiver-01', 'tree', 'nature', 'desert arid', 'Quiver tree', { ...hull, tris: 12000, tags: 'aloe succulent savanna' }],
  ['quiver_tree_02', 'tree-quiver-02', 'tree', 'nature', 'desert arid', 'Tall quiver tree', { ...hull, tris: 12000, tags: 'aloe succulent savanna' }],
  ['dead_quiver_trunk', 'trunk-quiver-dead', 'dead-tree', 'nature', 'desert arid wasteland', 'Dead quiver trunk', { ...hull, tags: 'snag dry' }],
  ['cheiridopsis_succulent', 'succulent-desert', 'succulent', 'plants', 'desert arid', 'Desert succulent', { ...hull, tags: 'cactus stone plant' }],
  ['namaqualand_boulder_02', 'rock-sandstone-boulder', 'rock', 'rocks', 'desert arid canyon', 'Sandstone boulder', { ...hull, tags: 'stone red dry' }],
  ['namaqualand_boulders_01', 'rock-sandstone-group', 'rock', 'rocks', 'desert arid canyon', 'Sandstone boulders', { ...hull, tags: 'stones cluster red dry' }],
  ['namaqualand_rocks_01', 'rock-desert-rubble', 'rock', 'rocks', 'desert arid', 'Desert rocks', { ...hull, tags: 'stones rubble scree' }],
  ['namaqualand_cliff_01', 'cliff-sandstone', 'cliff', 'rocks', 'desert arid canyon', 'Sandstone cliff', { ...hull, tris: 14000, tags: 'rock face wall mesa escarpment' }],
  ['sand_rocks_small_01', 'rock-sand-small', 'rock', 'rocks', 'desert coastal beach', 'Small sandy rocks', { ...hull, tags: 'stones pebbles' }],
  // coast and harbour
  ['dutch_ship_medium', 'ship-dutch-medium', 'ship', 'vehicles', 'coastal harbour historic', 'Dutch merchant ship', { ...hull, tris: 24000, tags: 'sailing galleon boat vessel' }],
  ['ship_pinnace', 'ship-pinnace', 'ship', 'vehicles', 'coastal harbour historic', 'Pinnace sailing boat', { ...hull, tris: 20000, tags: 'sailing boat vessel' }],
  ['wooden_barrels_01', 'barrels-wooden', 'barrel', 'props', 'coastal harbour farm medieval', 'Wooden barrels', { ...hull, omit: 'piece', tags: 'cask keg stack' }],
  ['treasure_chest', 'chest-treasure-real', 'chest', 'props', 'coastal fantasy medieval pirate', 'Treasure chest', { tags: 'loot pirate trunk' }],
  ['cannon_01', 'cannon-iron-real', 'cannon', 'props', 'coastal fantasy medieval pirate', 'Iron cannon', { ...hull, tags: 'artillery gun fort' }],
  ['wooden_crate_01', 'crate-wooden-01', 'crate', 'props', 'coastal harbour farm industrial', 'Wooden crate', { tags: 'box cargo shipping' }],
  ['wooden_bucket_01', 'bucket-wooden', 'bucket', 'props', 'coastal farm medieval', 'Wooden bucket', { ...hull, tags: 'pail' }],
  ['ocean_buoy', 'buoy-ocean', 'buoy', 'props', 'coastal harbour', 'Ocean buoy', { ...hull, tags: 'marker float sea' }],
  ['lifebuoy', 'lifebuoy', 'buoy', 'props', 'coastal harbour', 'Life ring', { ...hull, place: 'wall', tags: 'lifebelt safety ring' }],
  // city and street
  ['street_lamp_01', 'streetlight-01', 'streetlight', 'street', 'urban city', 'Street lamp', { ...hull, tris: 8000, tags: 'lamp post light pole road' }],
  ['fire_hydrant', 'hydrant', 'hydrant', 'street', 'urban city', 'Fire hydrant', { omit: 'aged', tags: 'street sidewalk water' }],
  ['concrete_road_barrier', 'barrier-concrete', 'barrier', 'street', 'urban city industrial', 'Concrete road barrier', { tags: 'jersey roadworks highway' }],
  ['metal_trash_can', 'trash-can-metal', 'trash-can', 'street', 'urban city industrial', 'Metal trash can', { ...hull, omit: 'rust', tags: 'bin garbage rubbish dustbin' }],
  ['utility_box_01', 'utility-box', 'utility-box', 'street', 'urban city industrial', 'Utility box', { tags: 'electrical cabinet junction street' }],
  ['water_manhole_cover', 'manhole-cover', 'manhole', 'street', 'urban city', 'Manhole cover', { tags: 'drain sewer road lid' }],
  ['wooden_picnic_table', 'picnic-table', 'picnic-table', 'street', 'park forest farm', 'Wooden picnic table', { tags: 'garden outdoor bench table' }],
  ['modular_fire_escape', 'fire-escape', 'fire-escape', 'building', 'urban city industrial', 'Fire escape', { ...big, tris: 20000, tags: 'stairs balcony ladder metal' }],
  ['rollershutter_door', 'shutter-door', 'shutter', 'building', 'urban city industrial', 'Roller shutter door', { tex: 512, tags: 'garage shop door metal' }],
  ['large_iron_gate', 'gate-iron', 'gate', 'building', 'urban city fantasy medieval', 'Iron gate', { ...big, tags: 'fence entrance wrought' }],
  ['modular_chainlink_fence', 'fence-chainlink', 'fence', 'street', 'urban industrial', 'Chain-link fence', { tags: 'wire mesh barrier' }],
  ['covered_car', 'car-covered', 'car', 'vehicles', 'urban city', 'Car under a tarp', { ...hull, tags: 'parked abandoned cover vehicle' }],
  ['old_tyre', 'tyre-old', 'tyre', 'props', 'urban industrial farm wasteland', 'Old tyre', { ...hull, tags: 'tire rubber wheel' }],
  ['security_light', 'floodlight-security', 'floodlight', 'lighting', 'urban industrial', 'Security floodlight', { ...hull, place: 'wall', tags: 'lamp wall spotlight' }],
  ['WetFloorSign_01', 'sign-wet-floor', 'sign', 'street', 'urban city office', 'Wet floor sign', { tags: 'caution warning' }],
  // industrial and sci-fi
  ['modular_industrial_pipes_01', 'pipes-industrial', 'pipes', 'props', 'industrial scifi', 'Industrial pipe set', { tags: 'plumbing tube factory refinery' }],
  ['overhead_crane', 'crane-overhead', 'crane', 'props', 'industrial', 'Overhead crane', { ...big, tris: 20000, tags: 'gantry hoist factory' }],
  ['portable_generator', 'generator-portable', 'generator', 'props', 'industrial farm urban', 'Portable generator', { tags: 'engine power' }],
  ['barrel_stove', 'stove-barrel', 'barrel-stove', 'props', 'industrial wasteland rural', 'Barrel stove', { ...hull, tags: 'fire burner heater' }],
  ['caged_hanging_light', 'lamp-caged-hanging', 'lamp', 'lighting', 'industrial scifi', 'Caged hanging light', { place: 'ceiling', tex: 512, tags: 'work light bay cage' }],
  ['vintage_spacecraft_instrument', 'panel-spacecraft', 'instrument-panel', 'props', 'scifi retro', 'Spacecraft instrument', { tags: 'cockpit dial gauge console' }],
  ['power_box_01', 'power-box', 'utility-box', 'props', 'industrial scifi urban', 'Power box', { place: 'wall', tags: 'electrical fuse panel' }],
  ['industrial_storage_cart', 'cart-industrial', 'cart', 'props', 'industrial', 'Storage cart', { tags: 'trolley workshop' }],
  ['hand_truck', 'hand-truck', 'cart', 'props', 'industrial urban', 'Hand truck', { tags: 'dolly trolley' }],
  ['steel_frame_shelves_01', 'rack-steel-01', 'rack', 'furniture', 'industrial scifi', 'Steel shelving rack', { tags: 'warehouse storage shelf' }],
  ['metal_toolbox', 'toolbox-metal', 'toolbox', 'tools', 'industrial farm', 'Metal toolbox', { tags: 'workshop' }],
  ['moon_rock_01', 'rock-moon-01', 'rock', 'rocks', 'scifi moon alien', 'Moon rock', { ...hull, tags: 'lunar space asteroid crater' }],
  ['moon_rock_03', 'rock-moon-03', 'rock', 'rocks', 'scifi moon alien', 'Lunar boulder', { ...hull, tags: 'space asteroid crater' }],
  ['exterior_aircon_unit', 'aircon-exterior', 'aircon', 'props', 'urban industrial', 'Outdoor air-conditioning unit', { place: 'wall', tags: 'hvac condenser' }],
  // farm and garden
  ['planter_box_02', 'planter-box-02', 'planter', 'plants', 'garden farm', 'Wooden planter', { ...hull, tags: 'raised bed trough' }],
  ['watering_can_metal_01', 'watering-can', 'watering-can', 'tools', 'garden farm', 'Metal watering can', { ...hull }],
  ['rusted_spade_01', 'spade-rusted', 'spade', 'tools', 'garden farm', 'Rusted spade', { ...hull, tags: 'shovel digging' }],
  ['garden_gnome', 'gnome-garden', 'gnome', 'decor', 'garden farm', 'Garden gnome', { ...hull, tags: 'statue figurine lawn' }],
  ['compost_bags', 'bags-compost', 'bag', 'props', 'garden farm', 'Compost bags', { ...hull, tags: 'sack soil' }],
  ['ladder_sectioned_01', 'ladder-sectioned', 'ladder', 'tools', 'farm industrial', 'Extension ladder', { tags: 'steps climb' }],
  ['seeding_tray_01', 'tray-seeding', 'tray', 'tools', 'garden farm', 'Seed tray', { ...hull, tags: 'nursery greenhouse' }],
  ['cement_bag', 'bag-cement', 'bag', 'props', 'industrial construction', 'Cement bag', { ...hull, tags: 'sack building site' }],
  ['garden_sprinkler_01', 'sprinkler-garden', 'sprinkler', 'tools', 'garden farm', 'Garden sprinkler', { ...hull, tags: 'irrigation water lawn' }],
  ['wooden_bucket_02', 'bucket-wooden-02', 'bucket', 'props', 'farm medieval', 'Old wooden bucket', { ...hull, tags: 'pail well' }],
  ['plastic_crate_01', 'crate-plastic', 'crate', 'props', 'farm industrial urban', 'Plastic crate', { tags: 'box storage harvest' }],
  // fantasy and medieval
  ['large_castle_door', 'door-castle', 'door', 'building', 'fantasy medieval', 'Castle door', { ...big, tags: 'gate portal entrance wooden' }],
  ['kite_shield', 'shield-kite', 'shield', 'props', 'fantasy medieval', 'Kite shield', { tags: 'knight armour weapon' }],
  ['antique_katana_01', 'sword-katana', 'sword', 'props', 'fantasy medieval asian', 'Katana', { tags: 'blade weapon samurai' }],
  ['antique_estoc', 'sword-estoc', 'sword', 'props', 'fantasy medieval', 'Estoc sword', { tags: 'blade weapon rapier' }],
  ['katana_stand_01', 'stand-katana', 'sword-stand', 'decor', 'fantasy asian', 'Sword stand', { tags: 'rack display weapon' }],
  ['gothic_statue', 'statue-gothic', 'statue', 'decor', 'fantasy medieval gothic', 'Gothic statue', { ...hull, tags: 'sculpture graveyard church' }],
  ['wooden_candlestick', 'candlestick-wooden', 'candle', 'lighting', 'fantasy medieval rustic', 'Wooden candlestick', { ...hull, place: 'surface', tags: 'candle holder' }],
  ['carved_wooden_elephant', 'elephant-carved', 'figurine', 'decor', 'fantasy asian', 'Carved wooden elephant', { ...hull, place: 'surface', tags: 'statue ornament' }],
];
