/**
 * Models imported from NVIDIA SimReady Central (USD packages on Hugging Face), one row per package. Each is pinned to a
 * dataset revision, checked against the SHA-256 recorded in `assets/sources.json` (`simready.packages`), converted by the
 * dev-time `usd2glb.py` and then built exactly like the Poly Haven interior rows (same budgets, tiers and catalog facts).
 *
 * Find candidates with `npm run assets:simready -- search "<text>"`, import with `-- fetch <repo>@<revision>/<package>`,
 * add the source to `assets/sources.json` and a row here, then `npx tsx scripts/assets/build.ts --simready`.
 * Only licences the library accepts (CC0-1.0, CC-BY-4.0) can be added; `assets/sources.json` is validated on every read.
 */
import type { InteriorRow } from './selection-interior';

export interface SimreadyItem {
  /** `[package folder, library id, interior type, category, styles, name, options]` (the Poly Haven row shape). */
  row: InteriorRow;
  /** `id` of the matching `simready.packages` entry in `assets/sources.json`. */
  source: string;
  /** Extra `usd2glb.py` options. `--resmooth=<deg>` welds the positions and recomputes crease-angle normals (CAD tessellation). */
  convert?: readonly string[];
  /** Colour names the finder ranks on, when the measured dominant colour of the largest material misleads (a black body is not "dark-brown"). */
  colors?: readonly string[];
}

export const SIMREADY: readonly SimreadyItem[] = [
  {
    source: 'simready-lgelectronics-cooking-ldgl6924s',
    convert: ['--resmooth=50'],
    colors: ['black', 'silver'],
    row: [
      'cooking_ldgl6924s',
      'simready-range-cooker-lg',
      'cooker',
      'kitchen',
      'modern contemporary',
      'Range cooker',
      { tex: 512, tris: 20000, rot: 270, tags: 'range cooker stove cooktop oven range cooker hob kitchen appliance freestanding lg stainless steel' },
    ],
  },
  {
    source: 'simready-nvidia-chair-office-fabric-manager-a01',
    row: ['chair_office_fabric_manager_a01', 'simready-office-chair-manager', 'chair', 'furniture', 'modern contemporary', 'Office chair, manager', { rot: 180, tex: 512, tris: 9000, tags: 'office chair swivel desk chair task chair computer chair' }],
  },
  {
    source: 'simready-nvidia-chair-office-amf-black-a01',
    row: ['chair_office_amf_black_a01', 'simready-office-chair-black', 'chair', 'furniture', 'modern contemporary', 'Office chair, black', { rot: 180, tex: 512, tris: 9000, tags: 'office chair swivel desk chair mesh chair' }],
  },
  {
    source: 'simready-nvidia-stool-mobile-padded-vinyl-a01',
    row: ['stool_mobile_padded_vinyl_a01', 'simready-stool-padded-vinyl', 'stool', 'furniture', 'modern contemporary', 'Padded stool', { tex: 512, tris: 6000, tags: 'stool rolling stool lab stool seat' }],
  },
  {
    source: 'simready-nvidia-desk-a01',
    row: ['desk_a01', 'simready-desk-office', 'desk', 'furniture', 'modern contemporary', 'Office desk', { rot: 270, tex: 512, tris: 9000, tags: 'desk writing desk computer desk workstation' }],
  },
  {
    source: 'simready-nvidia-furniture-table-coffee-low-a01',
    row: ['furniture_table_coffee_low_a01', 'simready-table-coffee-low', 'table', 'furniture', 'modern contemporary', 'Low coffee table', { rot: 270, tex: 512, tris: 6000, tags: 'coffee table low table living room' }],
  },
  {
    source: 'simready-nvidia-table-metal-stainless-a03',
    row: ['table_metal_stainless_a03', 'simready-table-stainless', 'table', 'kitchen', 'modern contemporary', 'Stainless steel table', { tex: 512, tris: 6000, tags: 'steel table prep table kitchen table work table' }],
  },
  {
    source: 'simready-nvidia-furniture-workbench-standard-e01',
    row: ['furniture_workbench_standard_e01', 'simready-workbench-standard', 'table', 'furniture', 'modern contemporary', 'Workbench', { rot: 270, tex: 512, tris: 9000, tags: 'workbench work table garage workshop bench' }],
  },
  {
    source: 'simready-nvidia-cabinet-file-a02',
    row: ['cabinet_file_a02', 'simready-cabinet-filing', 'cabinet', 'furniture', 'modern contemporary', 'Filing cabinet', { rot: 270, tex: 512, tris: 6000, tags: 'file cabinet filing cabinet office drawers metal cabinet' }],
  },
  {
    source: 'simready-nvidia-storage-shelf-basic-b01',
    row: ['storage_shelf_basic_b01', 'simready-shelf-storage-basic', 'shelf', 'furniture', 'modern contemporary', 'Storage shelf', { rot: 270, tex: 512, tris: 9000, tags: 'shelf shelving rack bookshelf bookcase storage rack warehouse' }],
  },
  {
    source: 'simready-nvidia-sofa-soft-b01',
    row: ['sofa_soft_b01', 'simready-sofa-soft-01', 'sofa', 'furniture', 'modern contemporary', 'Soft sofa', { rot: 270, tex: 512, tris: 12000, tags: 'sofa couch settee lounge waiting room' }],
  },
  {
    source: 'simready-nvidia-sofa-soft-b02',
    row: ['sofa_soft_b02', 'simready-sofa-soft-02', 'sofa', 'furniture', 'modern contemporary', 'Soft sofa, two seat', { rot: 270, tex: 512, tris: 12000, tags: 'sofa couch loveseat lounge waiting room' }],
  },
  {
    source: 'simready-nvidia-lamp-table-bedside-a01',
    row: ['lamp_table_bedside_a01', 'simready-lamp-bedside', 'lamp', 'lighting', 'modern contemporary', 'Bedside lamp', { tex: 512, tris: 4000, place: 'surface', collider: 'hull', tags: 'table lamp bedside lamp desk lamp light' }],
  },
  {
    source: 'simready-forgecad-desk-lamp',
    row: ['desk_lamp', 'simready-lamp-desk-arm', 'lamp', 'lighting', 'modern contemporary', 'Desk lamp', { tex: 512, tris: 4000, place: 'surface', collider: 'hull', tags: 'desk lamp task lamp reading lamp light' }],
  },
  {
    source: 'simready-nvidia-lighting-tasklight-tripodflood-a01',
    row: ['lighting_taskLight_tripodFlood_a01', 'simready-light-work-tripod', 'lamp', 'lighting', 'modern contemporary', 'Work light on a tripod', { tex: 512, tris: 6000, tags: 'floor lamp work light flood light tripod light site light' }],
  },
  {
    source: 'simready-nvidia-computer-monitor-office-a01',
    colors: ['black'],
    row: ['computer_monitor_office_a01', 'simready-monitor-office', 'monitor', 'props', 'modern contemporary', 'Computer monitor', { tex: 512, tris: 4000, place: 'surface', collider: 'hull', tags: 'monitor screen display computer pc desk' }],
  },
  {
    source: 'simready-nvidia-computer-keyboard-a01',
    colors: ['black'],
    row: ['computer_keyboard_a01', 'simready-keyboard-computer', 'keyboard', 'props', 'modern contemporary', 'Computer keyboard', { tex: 512, tris: 5000, place: 'surface', collider: 'hull', tags: 'keyboard computer keys pc typing' }],
  },
  {
    source: 'simready-nvidia-bin-waste-a04',
    colors: ['white', 'cream'],
    row: ['bin_waste_a04', 'simready-bin-waste', 'bin', 'props', 'modern contemporary', 'Waste bin', { rot: 270, tex: 512, tris: 4000, tags: 'trash bin rubbish bin garbage can waste basket' }],
  },
  {
    source: 'simready-forgecad-pedal-trash-can',
    row: ['pedal_trash_can', 'simready-bin-pedal', 'bin', 'props', 'modern contemporary', 'Pedal bin', { tex: 512, tris: 5000, tags: 'trash can pedal bin kitchen bin rubbish garbage' }],
  },
  {
    source: 'simready-forgecad-mug',
    row: ['mug', 'simready-mug-ceramic', 'mug', 'kitchen', 'modern contemporary', 'Mug', { tex: 512, tris: 3000, place: 'surface', collider: 'hull', tags: 'mug cup coffee cup tea cup kitchen' }],
  },
  {
    source: 'simready-forgecad-plate',
    row: ['plate', 'simready-plate-dinner', 'plate', 'kitchen', 'modern contemporary', 'Plate', { tex: 512, tris: 2500, place: 'surface', collider: 'hull', tags: 'plate dish dinner plate tableware kitchen' }],
  },
  {
    source: 'simready-nvidia-bucket-utility-red-a01',
    row: ['bucket_utility_red_a01', 'simready-bucket-red', 'bucket', 'props', 'modern contemporary', 'Utility bucket', { tex: 512, tris: 4000, tags: 'bucket pail container mop bucket' }],
  },
  {
    source: 'simready-nvidia-box-cardboard-b02',
    row: ['box_cardboard_b02', 'simready-box-cardboard', 'box', 'props', 'modern contemporary', 'Cardboard box', { tex: 512, tris: 3000, tags: 'cardboard box carton package parcel storage' }],
  },
  {
    source: 'simready-forgecad-shipping-box',
    row: ['shipping_box', 'simready-box-shipping', 'box', 'props', 'modern contemporary', 'Shipping box', { tex: 512, tris: 3000, tags: 'box shipping box carton parcel package' }],
  },
  {
    source: 'simready-forgecad-hammer',
    row: ['hammer', 'simready-hammer-claw', 'hammer', 'tools', 'modern contemporary', 'Hammer', { rot: 270, tex: 512, tris: 4000, place: 'surface', collider: 'hull', tags: 'hammer claw hammer tool carpentry' }],
  },
  {
    source: 'simready-nvidia-handtool-wrench-adjustable-a01',
    row: ['handTool_wrench_adjustable_a01', 'simready-wrench-adjustable', 'wrench', 'tools', 'modern contemporary', 'Adjustable wrench', { tex: 512, tris: 4000, place: 'surface', collider: 'hull', tags: 'wrench spanner adjustable wrench tool' }],
  },
  {
    source: 'simready-forgecad-toolbox',
    row: ['toolbox', 'simready-toolbox-metal', 'toolbox', 'tools', 'modern contemporary', 'Toolbox', { tex: 512, tris: 6000, tags: 'toolbox tool box tool chest storage' }],
  },
  {
    source: 'simready-nvidia-storage-toolbox-standard-hardcase-d01',
    colors: ['black', 'yellow'],
    row: ['storage_toolbox_standard_hardCase_d01', 'simready-toolbox-hardcase', 'toolbox', 'tools', 'modern contemporary', 'Hard-case toolbox', { rot: 270, tex: 512, tris: 6000, tags: 'toolbox tool box tool case hard case' }],
  },
  {
    source: 'simready-nvidia-equipment-rolling-tool-cabinet-a01',
    row: ['equipment_rolling_tool_cabinet_a01', 'simready-tool-cabinet-rolling', 'cabinet', 'tools', 'modern contemporary', 'Rolling tool cabinet', { rot: 270, tex: 512, tris: 9000, tags: 'tool cabinet tool chest rolling cabinet garage workshop mechanic' }],
  },
];
