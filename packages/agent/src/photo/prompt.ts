/**
 * Prompts and tool definitions of the photo flow: the vision model reads the picture into a structured room
 * description (with stated assumptions), then judges renders of the built room against the photo item by item.
 */
import { placementGateOn } from './placement-gate';
import { describeParts } from '@aether/arch';
import { MAX_VERDICTS, type ChecklistItem, type Scoreboard } from '@aether/arch/photo';
import type { ToolDef } from '../types';

/** Name of the tool the analysis call answers through. */
export const DESCRIBE_TOOL_NAME = 'describe_room';
/** Name of the tool a compare round reports item verdicts through. */
export const VERDICT_TOOL_NAME = 'report_verdicts';

/** Short identity of the analysis call (the specification travels in the user turn). */
export const ANALYSIS_SYSTEM =
  'You are an architectural photographer and surveyor. You turn a photograph of a room into a precise, measured, structured description that a 3D builder reconstructs exactly. You see carefully, estimate real-world sizes from reference objects, and say plainly what you had to assume. You answer only by calling the describe_room tool.';

/** The tool that carries the description. */
export const DESCRIBE_TOOL: ToolDef = {
  name: DESCRIBE_TOOL_NAME,
  description: 'Submit the structured description of the room in the photograph. It is validated; a refused description says which field to fix, and you call the tool again with the corrected whole description.',
  inputSchema: {
    type: 'object',
    properties: { description: { type: 'object', description: 'The room description (see the instructions for every field).' } },
    required: ['description'],
    additionalProperties: false,
  },
};

/** Name of the tool that reads the colour of a region of the photograph. */
export const SAMPLE_TOOL_NAME = 'sample_photo';

/** The tool that samples the photograph's pixels: the colour of a surface and the nearest finishes of the library. */
export const SAMPLE_TOOL: ToolDef = {
  name: SAMPLE_TOOL_NAME,
  description:
    'Read the colour of regions of the PHOTO from its pixels instead of guessing: the well-lit colour (what to paint with), the mean and the shadow colour of each region, and the nearest finishes of the material library with the tint to give each (tintable finishes take the colour exactly; natural ones keep their own). A region is a named surface of your description ("wall-north", "floor", "ceiling", a piece or opening id) or an explicit box [x0,y0,x1,y1] in 0..1 of the image. Up to 8 regions per call; apply the result with design_plan (walls, floor, finish colours) or edit_items resize (colour params).',
  inputSchema: {
    type: 'object',
    properties: {
      regions: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            surface: { type: 'string', description: 'wall-north | wall-east | wall-south | wall-west | floor | ceiling | a piece or opening id of the description' },
            box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4, description: 'explicit region [x0,y0,x1,y1] in 0..1, origin top-left' },
            kind: { type: 'string', enum: ['wall', 'floor', 'ceiling', 'any'], description: 'what the surface is, to rank finishes (default: from the name)' },
            hint: { type: 'string', description: 'what it looks like in words (striped wallpaper, dark walnut) to prefer that finish' },
          },
        },
      },
    },
    required: ['regions'],
    additionalProperties: false,
  },
};

/** The tool a compare round reports its verdicts through. */
export const VERDICT_TOOL: ToolDef = {
  name: VERDICT_TOOL_NAME,
  description:
    'Report, for EVERY checklist id, whether the render shows that item the way the photo does (pass) or not (fail, with one concrete sentence on what differs and by how much). Judge against the photo, not against the description. Call this once per round, before fixing anything.',
  inputSchema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_VERDICTS,
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, pass: { type: 'boolean' }, note: { type: 'string' } },
          required: ['id', 'pass'],
        },
      },
      summary: { type: 'string', description: 'One sentence: the biggest remaining difference.' },
      closer: { type: 'string', enum: ['new', 'best', 'same'], description: 'When a BEST SO FAR render is shown next to the new one: which is closer to the photo overall. "best" rolls the room back to it. Your eyes decide; no measured number does.' },
    },
    required: ['verdicts'],
    additionalProperties: false,
  },
};

/** The fields of the description, written for the model. Kept in step with `RoomDescription`. */
function specification(): string {
  return `## The description (call describe_room with {"description": {...}})
Frame: metres, measured on the INSIDE faces of the walls. The room is the rectangle x 0..width (west to east) by z 0..depth (north to south). Choose the compass so that the camera stands in the SOUTH half of the room and looks toward the NORTH (heading within about ±70°). Size the room from the things in it that have a known size (a single bed is about 0.9 x 1.9 m, a double 1.5 x 2.0 m, a door 0.9 x 2.05 m, a desk 1.2-1.6 m long, ceilings 2.4-2.8 m) and leave a person room to walk: about 0.9 m round doors and 0.7 m between beds, so a bedroom with two beds is about 4 m across or more and a bedroom at all is rarely under 3.5 x 4 m. When your first estimate packs the furniture wall to wall, the estimate is probably too small, not the furniture too big. Do the sum in "assumptions" before you write footprint.width: across the room, the bed(s) you see side by side + the walking gap you see + any desk or wardrobe depth (0.5-0.6 m) + 0.1 m of wall; the room is at least that. A wide-angle lens makes a room look narrower than it is: when the door, the beds or a desk are a large share of the picture, the room is wider than it looks. Hotel and hostel twin rooms are 3.8-4.5 m wide. A wall is named by the compass side it faces from the inside. "along" is the distance in metres from the LEFT corner of a wall, seen from inside facing that wall: north wall from its west corner, east wall from its north corner, south wall from its east corner, west wall from its south corner.
{
 "summary": "one or two sentences: what the picture shows",
 "roomType": "bedroom|living|kitchen|dining|bathroom|office|hall|entry|cafe|meeting|lobby|studio|kids|storage|laundry",
 "style": "modern|scandinavian|industrial|japandi|classic",
 "footprint": {"width": m west-east, "depth": m north-south, "ceiling": m},
 "camera": {"x": m, "z": m, "height": m (eye height), "heading": degrees clockwise from north (0 north, 90 east, -45 north-west), "pitch": degrees up (+) or down (-), "fov": HORIZONTAL field of view in degrees (phone 65-75, wide interior lens 85-100)},
 "walls": {"north": {"color": "#rrggbb", "material": "painted plaster|wallpaper|brick|panelling", "finish": nearest library finish (paint|plaster|wallpaper|wallpaper-stripe|wallpaper-floral|wallpaper-damask|panelling|brick|tile|stone|concrete|fabric|velvet|cladding), "panelling": {"style": "shaker|raised|batten|beadboard|flat", "height": m from the floor, "rail": true} (only when the wall shows panelling or a wainscot), "box": [x0,y0,x1,y1] a patch of that wall in the photo, "visible": true}, "east": {...}, "south": {...}, "west": {...}},
 "floor": {"material": "oak|carpet|tile|concrete|…", "finish": library finish, "color": "#rrggbb", "box": [x0,y0,x1,y1] a patch of floor, "note": ""},
 "ceiling": {"style": "flat|coved|vaulted|barrel|coffered|beamed|tray", "color": "#rrggbb", "box": [x0,y0,x1,y1] a patch of ceiling, "rise": m (vaulted/barrel: ridge above the eaves; coved: radius of the curve), "ridge": "x" or "z", "trusses": number, "beam": "#rrggbb", "coffers": {"nx": panels across, "nz": panels along, "rib": m, "depth": m}, "beams": {"count": n, "dir": "x" or "z", "width": m, "depth": m}, "tray": {"inset": m, "drop": m}, "cornice": {"height": m, "depth": m, "profile": "plain|cove|classic|stepped", "color": "#rrggbb"}  (omit when there is no crown moulding), "downlights": true ONLY when recessed spotlights are visible in the ceiling (omit otherwise: none are added), "pictureRail": {"drop": m below the ceiling, "color": "#rrggbb"}, "vault": {"rise": m, "ridge": "x" or "z", "trusses": number, "color": "#rrggbb"} (a gable ceiling; footprint.ceiling is then the wall height at the eaves; for coffered, beamed and tray ceilings it is the lowest visible ceiling plane)},
 "skirting": {"height": m, "profile": "square|bevel|ogee|stepped", "color": "#rrggbb"} (omit when none is visible),
 "niches": [{"id": "alcove-1", "wall": "north", "along": m (centre), "width": m, "height": m, "sill": m, "depth": m, "shelves": n, "arched": false, "box": [..], "note": ""}] (recesses or alcoves in a wall, e.g. either side of a chimney breast),
 "openings": [{"id": "win-1", "kind": "window|door|opening", "style": windows: "sash|casement|picture|grid|arched|bay|sliding|fixed", doors: "panel|flush|glazed|glass|double|french|arched|slab", "muntins": {"cols": panes across one sash, "rows": panes up one sash} (glazing bars), "frame": "#rrggbb" frame or leaf colour, "casing": true when there is an architrave round it, "bay": {"depth": m, "angle": 35}, "wall": "west", "along": m (centre), "width": m, "height": m, "sill": m (window bottom above the floor), "visible": true, "glow": true when the daylight beyond the glass is bright and glowing in the photo, "daylight": "#rrggbb" colour of that light, "box": [x0,y0,x1,y1], "note": "frame colour, panes, view"}],
 "items": [{"id": "bed", "kind": <a part kind below>, "label": "the piece in plain words", "wall": "north", "along": m (centre along that wall), "gap": m from the wall face to the back of the piece, "at": [x, z] (floor pieces away from walls), "faces": "north|east|south|west" or the id of a piece it faces, "on": id of the piece it stands on, "offset": [across, depth] from the host's centre, "model": id of a real library model for a sofa, chair, table, bed or plant (from find_model; left out, the closest one is chosen and sized to the part's width, height, depth), "opening": window id (curtains), "bottom": m above the floor (wall pieces), "above": id of the piece a wall piece hangs above, "aboveGap": m above that piece's top, "params": {the part's own parameters: sizes in metres, colours as #rrggbb, finishes}, "visible": true, "box": [x0,y0,x1,y1], "confidence": 0..1}],
 "light": {"timeOfDay": 0..24, "sky": "day|dawn|sunset|night|overcast", "from": "west" (the wall whose window the daylight comes through) or "none", "warmth": "cool|neutral|warm", "brightness": 0..1, "note": ""},
 "palette": ["#rrggbb", ...up to 6 dominant colours],
 "assumptions": [{"id": "room-size", "text": "what you assumed and why", "confidence": 0..1, "adjust": "a sentence the user could send to change it, e.g. make the room 4.5 m wide"}]
}
## Rules
- "box" is where the opening or piece APPEARS IN THE PHOTO: [x0, y0, x1, y1] as fractions 0..1 of the image width and height, origin top-left (x0 left edge, y0 top edge), its visible extent (partly hidden or cut off by the frame is fine; curtains: both panels together). Give a box for everything you can see. The builder uses the boxes to fit the camera and to check that what it builds is where the photo has it, so be careful and consistent with the photo's geometry.
- LOOK BACK before you declare. For every opening and piece, look at its box region of the photo once more and confirm what is there: a window is glass with a frame, a sheer curtain across a glass door is a curtain (kind "curtain", style sheer), not a window; a surface is wood, stone or fabric by its grain and edges, not by what such a room usually has. If you cannot clearly see an item (too dark, too small, cut off), OMIT it. Never add a table, rug, picture or chair to complete a scene; a missing piece costs less than an invented one.
- Reconstruct THIS room. No generic or "typical" room: every wall, opening and piece you list must be what the photo shows, at the position it shows. Never invent furniture the photo does not show; a piece you can only infer (behind the camera, hidden) gets "visible": false and a low confidence.
- Estimate sizes from reference objects: doors are 0.8-0.9 × 2.0-2.1 m, standard ceilings 2.4-2.8 m (taller in old buildings: check the window and door proportions), a double bed is 1.4-1.6 m wide and 1.9-2.1 m long, nightstands about 0.5 m, a sofa seat 0.45 m high, switches 1.1 m. Say your uncertainty in "assumptions" (the room size and the camera are always assumptions).
- SHELL-SIZE RECONCILIATION (required): "assumptions" must contain one entry with id "shell-size" whose text is one line: the width you chose, the depth/width evidence given with the photo (a lower bound when the side walls are out of frame; none if absent), and the minimum the furniture needs (bed widths plus a 0.6 m walkway, door swing); then either "adopted <larger>" or the reason you keep the smaller one. You decide the number; the line makes the choice visible.
- List EVERYTHING visible: every window and door, curtains (one curtain item per window; it makes both panels), crown moulding, each picture or mirror separately with its own position, every lamp (floor lamps, table lamps on their table, pendants), TV, rugs, plants, cushions on the bed (bed params), books and small objects only when large enough to matter.
- Build the ROOM SHELL as the photo shows it, with the words of the vocabulary: the ceiling shape (a coved, coffered, beamed, barrel or tray ceiling is not a flat one), the crown moulding and its profile, a picture rail, skirting, wall panelling or wainscot, wallpaper (stripe, floral, damask) instead of paint, alcoves, a fireplace or chimney breast (kind "fireplace"), built-in shelves and wardrobes (kind "bookshelf" or "wardrobe" with params builtin true), and for every window and door its style (a tall window with a meeting rail and small panes is a "sash" with muntins; a door with raised panels is "panel"; two leaves are "double" or "french").
- Curtains: kind "curtain", "opening" is the id of the window, params width = gathered width of ONE panel (0.6-1.2 m), height = floor-length drop or window length (do NOT set panels or gap: the builder hangs one panel each side of the window), color, style (pleated|pinch|eyelet|ripple|sheer), pelmet (none|box|valance|swag), rod (rod|track|none), tieback, closed (0 open .. 1 drawn). Blinds (roller, roman, venetian, shutter): kind "blind" with the same "opening", style and drawn (0..1 lowered). Pictures: kind "art", params width/height (frame outer size), frame finish, subject ("round" for a round photograph on a mat, "abstract", "blank"), matColor, ink; "wall" + "along" + "bottom" (or "above" + "aboveGap"). Lamps on tables: kind "table-lamp" with "on": the table's id.
- Positions: put each piece where the photo puts it relative to the walls, openings and other pieces (the bed against which wall and where along it, the picture over the bed's left third, the lamp beside the headboard). Floor pieces against a wall use "wall"+"along"+"gap"; only free-standing pieces use "at".
- Use the part options that make a piece look like the photo: bed headboardStyle (slab, panel, tufted for quilted/diamond, slats), pattern (floral, stripe, damask) for a printed duvet, canopy for a four-poster, accents for cushions; rug pattern (zigzag, stripes) with accent1-3 colours; nightstand style (cabinet, round, wire) with height and diameter for a side table; plant species palm for fronds (a single small frond: a small height); pictures with their real frame colour and finish. A glowing or sunlit window: say so in its note.
- Heights come from the photo, checked against reference objects: window sill and head against the door, sockets 0.3 m and switches 1.1 m above the floor, pictures hung 0.1-0.5 m above the furniture beneath them, a TV set standing on its cabinet. The builder moves values that cannot be true (a socket at eye height, a picture in the ceiling, two pieces in each other) and says so, so state what you SEE rather than what is typical.
- Colours are the colours the surfaces show in the photo's brighter, well-lit areas as #rrggbb (not the shadow tone). The palette must match the picture. Give a "box" for each wall, the floor and the ceiling (a patch that shows the surface's own colour, away from lamps, windows and furniture): the host samples the real pixels there and shows you the nearest library finish and tint when you compare, so choose the finish (wallpaper vs paint vs panelling, oak vs carpet) by what the surface looks like, and the colour by what you see.
- If no door is visible, do not add one: the builder assumes one behind the camera and tells the user.
- Use ONLY the part kinds listed below and their parameters (unknown parameters are ignored). A piece with no matching part: choose the closest part and say so in "label"/"assumptions".
## Parts (kind [mount] size, then parameters: name=default (range) or {options})
${describeParts()}`;
}

/** The user turn of the analysis call. */
export function analysisUserText(request: string): string {
  return `${specification()}\n\nThe photograph is attached. User request: <request>${request.slice(0, 600)}</request>\nStudy the photo, then call describe_room once with the complete description.`;
}

/** The text sent back when a description is refused. */
export function refusalText(error: string): string {
  return `The description was refused: ${error}\nFix exactly that and call describe_room again with the complete corrected description.`;
}

/** What a difference can be, said once for both forms of the ranking instruction. */
const DIFFERENCE_KINDS =
  'proportion (room and piece sizes, ceiling height), position (what stands where, spacing, alignment), colour, material and finish, lighting (direction, warmth, brightness, window light), and missing or extra items (a piece the photo has that the render lacks, or the reverse)';
/** How to look closer, said once for both forms. */
const LOOK_CLOSER_HINT = 'Use look_closer to see a region of both at the same camera, both whole pictures side by side, or the plan from above with ids and dimensions, instead of guessing from a small picture.';

/**
 * The biggest-difference step of every compare round: rank before fixing. One line the model writes first, so the largest
 * difference (by how much of the picture it changes, not by how easy it is to fix) goes first. Used when the round has no
 * differences ledger; with one, {@link rankDifferencesText} is the same step as a `report_differences` call.
 */
export const BIGGEST_DIFFERENCE_TEXT = `BIGGEST DIFFERENCE FIRST. Before any edit, write one line that ranks what differs between the photo and the render, largest first, across: ${DIFFERENCE_KINDS}. Name the single largest difference, say by how much (metres, share of the picture, which hue), and fix THAT first; then the next. ${LOOK_CLOSER_HINT}`;

/**
 * The one ranking instruction of a round that keeps a differences ledger (it replaces both the written one-line ranking and
 * a separate "list the differences" instruction, which used to say the same thing twice). Round 1 asks for the list across the
 * kinds, with amounts and sizes, largest first; later rounds ask for every earlier id to be judged on the new render, what is new
 * to be added, and a different approach for a difference that did not shrink.
 */
export function rankDifferencesText(round: number): string {
  return round <= 1
    ? `BIGGEST DIFFERENCE FIRST. Before any edit, look at the photo and the render together and call report_differences with every difference you can see, across: ${DIFFERENCE_KINDS}. Give each a kind, where, what with the amount (metres, share of the picture, which hue) and a size 1..5. The single largest goes first: fix THAT first, one change per difference, then the next. ${LOOK_CLOSER_HINT}`
    : `BIGGEST DIFFERENCE FIRST, AGAIN. Your list is above. Before editing, call report_differences: judge each earlier id on THIS render only (status: fixed, smaller, same, worse) and add what is new, across ${DIFFERENCE_KINDS}. If a difference you worked on last round did not shrink, change the approach. Then fix the largest open one next, by how much of the picture it changes. ${LOOK_CLOSER_HINT}`;
}

/** The first compare message: what was built, the checklist, how to answer. */
export function compareIntroText(opts: { summary: string; checklist: readonly ChecklistItem[]; notes: readonly string[]; hasObjective: boolean; plan?: string; framing?: string; judged?: boolean; measured?: string; ledger?: boolean }): string {
  return [
    'COMPARE AND CORRECT. You described the photographed room; it has been built from your description with the design tools. You now see the PHOTO (first image) and a RENDER of the built room from the photo\'s own camera position (second image, with numbered boxes on every piece and opening; the legend follows).',
    `Room: ${opts.summary}`,
    opts.notes.length > 0 ? `Builder notes:\n${opts.notes.map((n) => `- ${n}`).join('\n')}` : '',
    `Checklist (answer every id):\n${opts.checklist.map((c) => `- ${c.id}${c.structural ? ' [structural]' : ''}: ${c.text}`).join('\n')}`,
    'How to judge: the render is a plain preview, not a photograph. Its light is flatter than the photo\'s (no bounce, no glare, the view through the window is a flat sky colour), so NEVER fail an item only because it looks flatter, a little darker or less glossy. Judge what the tools can change: shape, size, position, proportion, hue, and lightness RELATIVE to the things around it (a pale chair next to a dark wall in the photo must be pale next to a dark wall in the render). Do not repaint a surface to compensate for the preview\'s light. When the whole picture reads warmer, cooler, darker, brighter or flatter than the photo, that is the world\'s LOOK, not its surfaces: set it with tune_look (exposure, white balance, saturation, contrast, fog, light and foliage tints, interior warmth) after looking at both pictures, a little at a time, and check the next render. Exposure stays near 1 (0.8 to 1.3): a room that needs 2 or more is lit or coloured wrongly (a lamp or the sun too weak, an albedo too dark, ambient doing the sun\'s work), so fix that and keep the exposure, rather than cranking exposure, ambient and sun until a dark room reads bright. Also judge the light the way a person standing in the room at eye height (1.6-1.7 m) sees it: does each lamp or fixture visibly light the wall, table or ceiling beside it (a bright pool that fades), or is it a flat glowing blob; is a corridor, entry or corner too dark, is a window blown out, is the ambient flat with no contrast. Fix with tune_look and by adjusting lights near the fixtures, then check the next render. The look evidence that follows is measured data to help you; your eyes decide.',
    opts.judged
      ? 'Each round: (1) independent judges have already scored the render against the photo item by item (their consensus and the measured differences follow); you may call report_verdicts with your own notes, but their scores decide. (2) Fix every item they found different with edit_items / place_items / query_scene (the numbers on the render are pieces; the legend names them; a wall query gives exact positions). Fix the shell and openings first, then furniture, then decor, then materials and lighting. Make the smallest change that works, never rebuild a room to move one piece. (3) The host renders again; the judges compare the new render with the accepted one, and a change they do not prefer is rolled back. When nothing more can be improved, call finish.'
      : 'Each round: (1) call report_verdicts with a verdict for EVERY id, judging the render against the photo as a strict reviewer: right place, right size, right colour, right material, right proportion. (2) For every failing item, fix it in the same reply with edit_items / place_items / query_scene (the numbers on the render are pieces; the legend names them; a wall query gives exact positions). Fix the shell and openings first, then furniture, then decor, then materials and lighting. Make the smallest change that works, never rebuild a room to move one piece. (3) The host renders again and you judge again. When every item passes, call finish.',
    // With a ledger the ranking instruction comes once, after the kit (differencesProcedure).
    opts.ledger === true ? '' : BIGGEST_DIFFERENCE_TEXT,
    opts.hasObjective ? 'The host also measures the room deterministically against your description and the photo (openings, inventory, placement, sizes, colours, clearance, framing, pixel similarity); they are evidence for you, not a verdict: nothing is accepted or rolled back because of a measured number, only because of what you (or the judges) see.' : '',
    opts.measured ?? '',
    'Check the SCALE against the photo before you fix single pieces, and again whenever the pieces look too big or too small for the room: the room\'s width, depth and ceiling height are the numbers a flat picture gives you worst. Compare the render with the photo for how much of the wall the door, the windows and the bed take up, how much floor shows in front of the furniture, and how high the ceiling is above the window head and the tallest piece; where the render and the photo disagree, correct the shell (and the heights of the pieces) first and say which number you changed and why. If the shell-size item fails, change a room dimension; do not leave it failing while you move furniture. A failed shell-size item (or a piece still refused for lack of space) must be answered THIS round: resend design_plan with a changed size, or call declare_repair with keep_shell set to the reason the size stays (it is recorded as an assumption); finish is not accepted before one of the two. When a piece is refused for lack of space (a door that cannot open, no path, an overlap), the shell is probably too small: widen or lengthen it with design_plan (0.3-0.6 m at a time) and place the piece again; do not drop the piece. Check the beds, door and ceiling against their known sizes (bed 0.9-1.0 m wide, door 2.0-2.1 m high, ceiling 2.4-2.7 m).',
    ...(placementGateOn() ? [    'MEASURED PLACEMENT IS THE DEFAULT: pieces linked to a measured object stand where the measurements put them, at the measured size and facing. To move one more than about 15 cm away from that pose, resize it more than 15 percent or turn it more than 20 degrees, add "reason" to that edit and cite evidence (for example "perception mask occluded by the bed so the measured footprint is unreliable", "collides with the wall", "the photo shows it behind the curtain"); without one the edit is not applied. Moving back toward the measured pose needs no reason. Edits a measured comparison says made a piece worse are put back.'] : []),
    'Edits to the shell (room size, wall colour, floor, a window\'s size or place) are made by resending design_plan with the corrected plan (pieces you placed stay). Sizes, colours and finishes of pieces change with edit_items resize (params).',
    'The shell has a vocabulary beyond size and colour (query_scene {q:"vocabulary"} lists it): ceiling style (coved, barrel, coffered, beamed, tray), cornice profile, picture rail, skirting, panelled dados, wall coverings (wallpaper, panelling, brick), niches, and window/door styles with glazing bars (sash, arched, bay, panel, french, double), all set on the room and its openings in design_plan. If the render misses one of these that the photo shows (a plain flat ceiling where the photo has coffers, a plain pane where it has a sash with bars, paint where it has wallpaper), add it. sample_photo reads the real colour of a region of the photo and the nearest finish and tint; query_scene {q:"finishes", near:"#rrggbb"} does the same for any colour.',
    'Real models: pieces of the room are real photographed models where the library has a close one. When a piece looks wrong in shape, style or colour, call find_model {what, style, color, size} with what the photo shows, judge the candidates by their facts against the photo, then remove the piece and place_items {kind:"model:<id>", fit:[w,h,d]} (colour with params.color on upholstery). Cabinets, wardrobes and kitchens stay parts.',
    'Textures: the surfaces the photo shows clearly were already sampled from it (marked photographed in the credits). make_texture {target, prompt?, from_photo_region?, source?} changes one: another region of the photo, an AI image model when one is connected (give a prompt), or the library finish (source "procedural"). Keep a texture only if it looks like the photo\'s surface at the same scale and colour; if a sampled one reads wrong (wrong scale, blotchy, a stray object in it) revert it. Say which source each surface has when you report.',
    opts.framing ? `${opts.framing}` : '',
    opts.plan ? `The plan the shell was built from (resend it with changes):\n${opts.plan}` : '',
  ]
    .filter((l) => l.length > 0)
    .join('\n');
}

/** The text of a later round. */
export function compareRoundText(round: number, score: Scoreboard | null, objective: number | null, legend: string, refusals: readonly string[], framing = '', measured = '', judged = false, ledger = false): string {
  return [
    `COMPARE round ${round}. The render below shows the room after your last changes${refusals.length > 0 ? ' (some were refused, see below)' : ''}; the photo is shown again for reference.`,
    score ? `Last round: ${score.passed}/${score.total} items passed.` : '',
    objective !== null ? `Measured fidelity to the photo: ${Math.round(objective * 100)}%.` : '',
    framing,
    measured,
    refusals.length > 0 ? `Refused last time:\n${refusals.map((r) => `- ${r}`).join('\n')}` : '',
    `Legend:\n${legend}`,
    ledger ? '' : 'Rank the differences again (proportion, position, colour, material, lighting, missing or extra items): name the largest, fix it first; look_closer shows a region of both, the two side by side, or the plan.',
    judged
      ? 'Fix what the judges and the measures found different (report_verdicts is optional: your own notes). Call finish when everything matches or when the remaining differences cannot be fixed with the tools (say why).'
      : 'Call report_verdicts for EVERY id again (judge only what you see now), then fix what fails. Call finish when everything passes or when the remaining differences cannot be fixed with the tools (say why).',
  ]
    .filter((l) => l.length > 0)
    .join('\n');
}

/** Seed of the independent cross-check seat. */
export const CROSSCHECK_SEED = 9917;

/** System prompt of the independent cross-check seat: fresh eyes, records differences, fixes nothing. */
export const CROSSCHECK_SYSTEM =
  'You are an independent reviewer of a 3D reconstruction. You did not build it and you have not seen how it was built. You are shown a REFERENCE photograph and a RENDER of the reconstruction from the same camera, side by side, then zoomed crops of the same regions in both, and a colour readout. Look at everything with fresh eyes and call report_differences once with every real difference you can see: proportion, position, colour, material, lighting, missing or extra items, scale. Be concrete (which piece or surface, how much) and rank by size (5 = obvious at first glance). The render is a plain preview: do not list its flatter light, softer shadows or lack of glare as differences, but do list a wall that is clearly a different hue, a piece that is the wrong size or in the wrong place, or something that is missing. Do not invent differences: when the render matches, send an empty list.';

/** The user turn of the cross-check seat. The images follow it (labelled by the caller). */
export function crossCheckText(opts: { summary: string; readout: string }): string {
  return [`REFERENCE and RENDER, ${opts.summary ? `the room: ${opts.summary}` : 'same camera'}. Compare them region by region, then call report_differences.`, opts.readout].filter((l) => l.length > 0).join('\n');
}

/** What the model is asked to do with the compare kit each round (the tool's own description has the details). */
export function differencesProcedure(round: number, hasKit: boolean): string {
  return [
    hasKit
      ? 'COMPARE KIT: besides the single views you have the PHOTO and the RENDER side by side in one image (same camera) and zoomed crops of the same region in both; look at the crops for colour, material, edges and size, and at the side-by-side for position and proportion.'
      : '',
    rankDifferencesText(round),
  ]
    .filter((l) => l.length > 0)
    .join('\n');
}

/**
 * The staged procedure of a harness run, in the user turn (the system prompt stays small): the stage verdicts and the repair
 * order. Detail of each tool lives in its description.
 */
export function harnessProcedure(round: number, overall: number): string {
  return [
    'STAGES AND REPAIR ORDER. This rebuild runs in stages and every claim needs evidence.',
    round === 1 && overall === 1
      ? 'First look: call stage_gate once with a verdict for evidence, camera, shell, furniture, materials and lighting, each with one sentence naming what you looked at and found. Pass only what you see matching. A stage you cannot judge from these pictures is "fail" with what is missing; "blocked" only when you cannot go on without something from the user.'
      : 'Call stage_gate again for any stage whose verdict changed on this render.',
    'When you list differences give each a cause: camera (framing, field of view, eye height, heading, pitch: use set_photo_camera), geometry (sizes, positions, missing or extra pieces: design_plan, place_items, edit_items), materials (colour, finish, texture), lighting (sun, lamps, exposure, white balance: tune_look). Repair them in that order: while a difference of size 3 or more is open in an earlier class, do not repair a later one. Before each edit call declare_repair {difference, cause, why}; the edit tools must fit the cause.',
    'Make a conservative guess for anything the photo cannot show and say so; do not stop to ask the user unless a stage is truly blocked.',
  ].join('\n');
}
