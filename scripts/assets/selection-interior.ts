/**
 * Realistic interior models from Poly Haven (CC0-1.0), shipped through the same catalog as the
 * rest of the library. Each row: `[Poly Haven id, library id, interior type, category, styles, name, options]`.
 *
 * `type` is the object an LLM or a planner asks for ("sofa", "bed", "table"); `styles` are
 * design styles used to rank variants. Colour names and the dominant colour are measured from the
 * model's own base-colour texture by the build, not written here.
 */
import type { AssetCategory, AssetPlacement } from '../../packages/assets/src/schema';

export interface InteriorOpts {
  place?: AssetPlacement;
  collider?: 'box' | 'hull';
  /** Texture side in px for the shipped file (default: 1024 for large pieces, 512 for small). */
  tex?: 256 | 512 | 1024;
  /** Turn the model about Y (degrees) so its front faces +Z; found with `thumbs.ts --front`. */
  rot?: number;
  /** Triangle budget of the main file (default 20k). */
  tris?: number;
  /** Drop the top-level nodes of the source scene whose name matches this regular expression (files that lay variants side by side). */
  omit?: string;
  /** Extra search words. */
  tags?: string;
  /** Target height in metres for models whose source scale is off. */
  h?: number;
  /** Pivot at the back-centre mount point of a wall or ceiling model (see `mountSpec`). */
  mount?: { kind: 'wall' | 'ceiling'; anchor: number; y: number };
}
export type InteriorRow = readonly [string, string, string, AssetCategory, string, string, InteriorOpts?];

const wall: InteriorOpts = { place: 'wall', tex: 512 };
const ceil: InteriorOpts = { place: 'ceiling', tex: 512 };
const top: InteriorOpts = { place: 'surface', tex: 512, collider: 'hull' };

export const INTERIOR: readonly InteriorRow[] = [
  // sofas
  ['sofa_02', 'sofa-02', 'sofa', 'furniture', 'modern contemporary', 'Modern sofa', { tags: 'couch living room fabric' }],
  ['sofa_03', 'sofa-03', 'sofa', 'furniture', 'modern scandinavian', 'Compact sofa', { tags: 'couch loveseat living room' }],
  ['chinese_sofa', 'sofa-chinese', 'sofa', 'furniture', 'asian traditional', 'Carved wood sofa', { tags: 'couch oriental' }],
  ['painted_wooden_sofa', 'sofa-painted-wood', 'sofa', 'furniture', 'rustic farmhouse', 'Painted wooden sofa', { tags: 'couch cottage' }],
  // armchairs
  ['modern_arm_chair_01', 'armchair-modern-01', 'armchair', 'furniture', 'modern contemporary', 'Modern armchair', { tags: 'lounge' }],
  ['mid_century_lounge_chair', 'armchair-mid-century', 'armchair', 'furniture', 'mid-century retro', 'Mid-century lounge chair', { tags: 'eames leather' }],
  ['chinese_armchair', 'armchair-chinese', 'armchair', 'furniture', 'asian traditional', 'Carved wood armchair'],
  ['Rockingchair_01', 'rocking-chair', 'armchair', 'furniture', 'rustic traditional', 'Rocking chair'],
  ['GreenChair_01', 'armchair-green', 'armchair', 'furniture', 'classic vintage', 'Green upholstered chair'],
  ['BarberShopChair_01', 'barber-chair', 'armchair', 'furniture', 'vintage industrial', 'Barber chair', { tex: 512 }],
  // dining and desk chairs, stools
  ['dining_chair_02', 'chair-dining-02', 'chair', 'furniture', 'modern scandinavian', 'Dining chair', { tex: 512 }],
  ['painted_wooden_chair_01', 'chair-painted-01', 'chair', 'furniture', 'rustic farmhouse', 'Painted chair', { tex: 512 }],
  ['painted_wooden_chair_02', 'chair-painted-02', 'chair', 'furniture', 'rustic farmhouse', 'Painted ladder chair', { tex: 512 }],
  ['gallinera_chair', 'chair-gallinera', 'chair', 'furniture', 'rustic garden', 'Slatted chair', { tex: 512 }],
  ['plastic_monobloc_chair_01', 'chair-monobloc', 'chair', 'furniture', 'casual outdoor', 'Plastic chair', { tex: 512 }],
  ['SchoolChair_01', 'chair-school', 'chair', 'furniture', 'vintage industrial', 'School chair', { tex: 512 }],
  ['bar_chair_round_01', 'bar-chair-round', 'stool', 'furniture', 'modern industrial', 'Round bar chair', { tex: 512, tags: 'bar stool kitchen counter' }],
  ['wooden_stool_01', 'stool-wooden-01', 'stool', 'furniture', 'rustic traditional', 'Wooden stool', { tex: 512 }],
  ['wooden_stool_02', 'stool-wooden-02', 'stool', 'furniture', 'rustic traditional', 'Turned wooden stool', { tex: 512 }],
  ['painted_wooden_stool', 'stool-painted', 'stool', 'furniture', 'rustic farmhouse', 'Painted stool', { tex: 512 }],
  ['metal_stool_01', 'stool-metal-01', 'stool', 'furniture', 'industrial', 'Metal stool', { tex: 512 }],
  ['chinese_stool', 'stool-chinese', 'stool', 'furniture', 'asian traditional', 'Carved stool', { tex: 512 }],
  ['Ottoman_01', 'ottoman-01', 'ottoman', 'furniture', 'classic traditional', 'Upholstered ottoman', { tex: 512, tags: 'pouf footstool' }],
  // beds
  ['GothicBed_01', 'bed-gothic', 'bed', 'furniture', 'gothic classic', 'Gothic double bed', { tags: 'bedroom bedstead carved' }],
  ['old_bed_frame', 'bed-old-frame', 'bed', 'furniture', 'industrial vintage', 'Old iron bed frame', { tags: 'bedroom bedstead' }],
  ['vintage_day_bed', 'bed-day-vintage', 'bed', 'furniture', 'vintage classic', 'Vintage day bed', { tags: 'daybed chaise couch' }],
  // tables
  ['dining_table', 'table-dining-modern', 'table', 'furniture', 'modern contemporary', 'Dining table', { tags: 'dining room' }],
  ['WoodenTable_01', 'table-wooden-01', 'table', 'furniture', 'rustic traditional', 'Wooden table', { tags: 'dining kitchen' }],
  ['painted_wooden_table', 'table-painted', 'table', 'furniture', 'rustic farmhouse', 'Painted table', { tags: 'dining kitchen' }],
  ['round_wooden_table_01', 'table-round-01', 'table', 'furniture', 'rustic traditional', 'Round wooden table', { tags: 'dining bistro' }],
  ['round_wooden_table_02', 'table-round-02', 'table', 'furniture', 'classic traditional', 'Round pedestal table', { tags: 'dining' }],
  ['wooden_table_02', 'table-wooden-02', 'table', 'furniture', 'rustic traditional', 'Plank table', { tags: 'dining farmhouse' }],
  ['gallinera_table', 'table-gallinera', 'table', 'furniture', 'rustic garden', 'Slatted table', { tags: 'garden terrace outdoor' }],
  ['small_wooden_table_01', 'table-small-01', 'table', 'furniture', 'rustic traditional', 'Small wooden table', { tags: 'kitchen bistro' }],
  ['metal_office_desk', 'desk-metal-office', 'desk', 'furniture', 'industrial office', 'Metal office desk', { tags: 'workstation study' }],
  ['SchoolDesk_01', 'desk-school', 'desk', 'furniture', 'vintage industrial', 'School desk', { tex: 512, tags: 'study' }],
  // coffee, side, nightstand, console
  ['CoffeeTable_01', 'coffee-table-01', 'coffee-table', 'furniture', 'classic traditional', 'Coffee table', { tex: 512, tags: 'living room' }],
  ['modern_coffee_table_01', 'coffee-table-modern-01', 'coffee-table', 'furniture', 'modern contemporary', 'Modern coffee table', { tex: 512, rot: 90 }],
  ['modern_coffee_table_02', 'coffee-table-modern-02', 'coffee-table', 'furniture', 'modern minimal', 'Low coffee table', { tex: 512 }],
  ['industrial_coffee_table', 'coffee-table-industrial', 'coffee-table', 'furniture', 'industrial loft', 'Industrial coffee table', { tex: 512 }],
  ['gothic_coffee_table', 'coffee-table-gothic', 'coffee-table', 'furniture', 'gothic classic', 'Carved coffee table', { tex: 512 }],
  ['chinese_tea_table', 'coffee-table-chinese', 'coffee-table', 'furniture', 'asian traditional', 'Tea table', { tex: 512 }],
  ['side_table_01', 'side-table-01', 'side-table', 'furniture', 'modern contemporary', 'Side table', { tex: 512, tags: 'end table' }],
  ['side_table_tall_01', 'side-table-tall', 'side-table', 'furniture', 'modern contemporary', 'Tall side table', { tex: 512, tags: 'end table' }],
  ['painted_wooden_nightstand', 'nightstand-painted', 'nightstand', 'furniture', 'rustic farmhouse', 'Painted nightstand', { tex: 512, tags: 'bedside' }],
  ['ClassicConsole_01', 'console-classic', 'console', 'furniture', 'classic traditional', 'Console table', { tex: 512, tags: 'hallway entry sideboard' }],
  ['chinese_console_table', 'console-chinese', 'console', 'furniture', 'asian traditional', 'Carved console table', { tex: 512, tags: 'hallway sideboard' }],
  // storage: wardrobes, cabinets, drawers
  ['GothicCabinet_01', 'wardrobe-gothic', 'wardrobe', 'furniture', 'gothic classic', 'Gothic cabinet', { tags: 'cupboard closet armoire bedroom' }],
  ['chinese_cabinet', 'wardrobe-chinese', 'wardrobe', 'furniture', 'asian traditional', 'Chinese cabinet', { tags: 'cupboard closet armoire' }],
  ['painted_wooden_cabinet', 'wardrobe-painted-01', 'wardrobe', 'furniture', 'rustic farmhouse', 'Painted cabinet', { tags: 'cupboard closet armoire' }],
  ['painted_wooden_cabinet_02', 'wardrobe-painted-02', 'wardrobe', 'furniture', 'rustic farmhouse', 'Painted tall cabinet', { tags: 'cupboard closet armoire' }],
  ['vintage_cabinet_01', 'wardrobe-vintage', 'wardrobe', 'furniture', 'vintage classic', 'Vintage cabinet', { tags: 'cupboard closet armoire' }],
  ['modern_wooden_cabinet', 'sideboard-modern', 'sideboard', 'furniture', 'modern scandinavian', 'Modern wooden cabinet', { tags: 'credenza tv stand storage' }],
  ['drawer_cabinet', 'dresser-drawer', 'dresser', 'furniture', 'modern contemporary', 'Drawer cabinet', { tags: 'chest of drawers commode bedroom' }],
  ['GothicCommode_01', 'dresser-gothic', 'dresser', 'furniture', 'gothic classic', 'Gothic commode', { tags: 'chest of drawers bedroom' }],
  ['chinese_commode', 'dresser-chinese', 'dresser', 'furniture', 'asian traditional', 'Chinese commode', { tags: 'chest of drawers' }],
  ['vintage_wooden_drawer_01', 'dresser-vintage', 'dresser', 'furniture', 'vintage rustic', 'Vintage drawer unit', { tags: 'chest of drawers' }],
  // shelves
  ['Shelf_01', 'shelf-wall-01', 'shelf', 'furniture', 'rustic traditional', 'Wall shelf', { tex: 512 }],
  ['painted_wooden_shelves', 'bookshelf-painted', 'bookshelf', 'furniture', 'rustic farmhouse', 'Painted shelves', { tags: 'bookcase' }],
  ['wooden_bookshelf_worn', 'bookshelf-worn', 'bookshelf', 'furniture', 'rustic vintage', 'Worn wooden bookshelf', { tags: 'bookcase' }],
  ['wooden_display_shelves_01', 'bookshelf-display', 'bookshelf', 'furniture', 'modern scandinavian', 'Display shelves', { rot: 270, tags: 'bookcase' }],
  ['steel_frame_shelves_03', 'bookshelf-steel', 'bookshelf', 'furniture', 'industrial loft', 'Steel frame shelves', { tags: 'bookcase rack' }],
  // lamps
  ['desk_lamp_arm_01', 'lamp-desk-arm', 'lamp', 'lighting', 'modern industrial', 'Arm desk lamp', { ...top, tags: 'desk light task' }],
  ['Chandelier_01', 'chandelier-01', 'lamp', 'lighting', 'classic traditional', 'Chandelier', { ...ceil, tags: 'ceiling light hanging' }],
  ['Chandelier_02', 'chandelier-02', 'lamp', 'lighting', 'classic', 'Crystal chandelier', { ...ceil, tags: 'ceiling light hanging' }],
  ['hanging_industrial_lamp', 'lamp-pendant-industrial', 'lamp', 'lighting', 'industrial loft', 'Industrial pendant lamp', { ...ceil, tags: 'ceiling light hanging' }],
  ['lantern_chandelier_01', 'lamp-lantern-chandelier', 'lamp', 'lighting', 'rustic traditional', 'Lantern chandelier', { ...ceil, tags: 'ceiling light hanging' }],
  ['industrial_wall_sconce', 'lamp-wall-sconce', 'lamp', 'lighting', 'industrial', 'Wall sconce', { ...wall, tags: 'wall light' }],
  ['vintage_oil_lamp', 'lamp-oil-vintage', 'lamp', 'lighting', 'vintage rustic', 'Oil lamp', { ...top, tags: 'table light' }],
  // plants
  ['potted_plant_01', 'plant-potted-01', 'plant', 'plants', 'modern', 'Potted plant', { ...top, place: 'floor', tex: 512, tags: 'houseplant indoor' }],
  ['potted_plant_02', 'plant-potted-02', 'plant', 'plants', 'modern', 'Potted leafy plant', { ...top, place: 'floor', tex: 512, tags: 'houseplant indoor' }],
  ['planter_box_01', 'planter-box-01', 'plant', 'plants', 'rustic', 'Planter box', { collider: 'hull', tex: 512, tags: 'garden flowers planter trough' }],
  // tv and electronics
  ['television_02', 'tv-crt-02', 'tv', 'decor', 'vintage retro', 'Old television', { ...top, tags: 'crt television set' }],
  ['classic_laptop', 'laptop-classic', 'laptop', 'decor', 'vintage retro', 'Classic laptop', { ...top, tags: 'computer' }],
  ['boombox', 'boombox', 'radio', 'decor', 'retro', 'Boombox', { ...top, tags: 'stereo music speaker' }],
  ['vintage_radio_transceiver', 'radio-vintage', 'radio', 'decor', 'vintage retro', 'Vintage radio', { ...top, tags: 'music' }],
  ['gaming_console', 'gaming-console', 'console-game', 'decor', 'modern', 'Game console', { ...top, tags: 'video game' }],
  // books and small decor
  ['book_encyclopedia_set_01', 'books-encyclopedia', 'books', 'decor', 'classic traditional', 'Encyclopedia set', { ...top, tags: 'book library shelf' }],
  ['ceramic_vase_02', 'vase-ceramic-02', 'vase', 'decor', 'modern', 'Ceramic vase', top],
  ['ceramic_vase_03', 'vase-ceramic-03', 'vase', 'decor', 'modern', 'Tall ceramic vase', top],
  ['ceramic_vase_04', 'vase-ceramic-04', 'vase', 'decor', 'modern', 'Round ceramic vase', top],
  ['brass_vase_01', 'vase-brass-01', 'vase', 'decor', 'classic traditional', 'Brass vase', top],
  ['antique_ceramic_vase_01', 'vase-antique', 'vase', 'decor', 'classic traditional', 'Antique vase', top],
  ['throw_pillows_01', 'pillows-throw', 'pillow', 'decor', 'modern contemporary', 'Throw pillows', { ...top, tags: 'cushion sofa bed' }],
  ['ornate_mirror_01', 'mirror-ornate', 'mirror', 'decor', 'classic traditional', 'Ornate mirror', { ...wall, tags: 'wall decor' }],
  ['fancy_picture_frame_01', 'frame-fancy-01', 'picture', 'decor', 'classic traditional', 'Gilded picture frame', { ...wall, tags: 'painting art portrait wall decor' }],
  ['wall_clock', 'clock-wall', 'clock', 'decor', 'modern', 'Wall clock', { ...wall }],
  ['mantel_clock_01', 'clock-mantel', 'clock', 'decor', 'classic vintage', 'Mantel clock', { ...top }],
  ['wicker_basket_02', 'basket-wicker', 'basket', 'decor', 'rustic natural', 'Wicker basket', { collider: 'hull', tex: 512 }],
  ['wooden_bowl_01', 'bowl-wooden-01', 'bowl', 'decor', 'rustic natural', 'Wooden bowl', top],
  ['marble_bust_01', 'bust-marble', 'statue', 'decor', 'classic', 'Marble bust', top],
  ['brass_candleholders', 'candleholders-brass', 'candle', 'decor', 'classic traditional', 'Brass candleholders', { ...top, tags: 'candlestick' }],
  ['chess_set', 'chess-set', 'game', 'decor', 'classic', 'Chess set', { ...top, tags: 'board game' }],
  // appliances
  ['electric_stove', 'cooker-electric', 'cooker', 'kitchen', 'modern', 'Electric cooker', { tags: 'stove oven hob range kitchen', tex: 512 }],
  ['vintage_microwave', 'microwave-vintage', 'microwave', 'kitchen', 'vintage retro', 'Vintage microwave', { ...top, tags: 'kitchen oven' }],
  ['vintage_electric_kettle', 'kettle-vintage', 'kettle', 'kitchen', 'vintage retro', 'Vintage kettle', { ...top, tags: 'kitchen' }],
  ['ceiling_fan', 'ceiling-fan-realistic', 'fan', 'lighting', 'modern', 'Ceiling fan', { ...ceil }],
  ['scandinavian_masonry_heater', 'stove-masonry', 'fireplace', 'furniture', 'scandinavian rustic', 'Masonry heater', { tex: 512, tags: 'fireplace stove tiled heater' }],
];

/** Interior facts for realistic models added before this selection: `[library id, interior type, styles]`. */
export const EXISTING_FACTS: ReadonlyArray<readonly [string, string, string]> = [
  ['sofa-classic', 'sofa', 'classic traditional'],
  ['armchair-classic', 'armchair', 'classic traditional'],
  ['coffee-table-round', 'coffee-table', 'modern scandinavian classic'],
  ['nightstand-classic', 'nightstand', 'classic traditional'],
  ['side-table-wood', 'side-table', 'rustic traditional'],
  ['bench-painted', 'bench', 'rustic farmhouse'],
  ['pendant-lamp', 'lamp', 'modern scandinavian industrial'],
  ['lantern-wood', 'lamp', 'rustic traditional'],
  ['succulent', 'plant', 'modern'],
  ['vase', 'vase', 'modern'],
  ['tv-retro', 'tv', 'vintage retro'],
];
