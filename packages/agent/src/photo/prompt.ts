/**
 * Prompts and tool definitions of the photo flow: the vision model reads the picture into a structured room
 * description (with stated assumptions), then judges renders of the built room against the photo item by item.
 */
import { describeParts } from '@aether/arch';
import type { ChecklistItem, Scoreboard } from '@aether/arch';
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
        maxItems: 120,
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, pass: { type: 'boolean' }, note: { type: 'string' } },
          required: ['id', 'pass'],
        },
      },
      summary: { type: 'string', description: 'One sentence: the biggest remaining difference.' },
    },
    required: ['verdicts'],
    additionalProperties: false,
  },
};

/** The fields of the description, written for the model. Kept in step with `RoomDescription`. */
function specification(): string {
  return `## The description (call describe_room with {"description": {...}})
Frame: metres, measured on the INSIDE faces of the walls. The room is the rectangle x 0..width (west to east) by z 0..depth (north to south). Choose the compass so that the camera stands in the SOUTH half of the room and looks toward the NORTH (heading within about ±70°). A wall is named by the compass side it faces from the inside. "along" is the distance in metres from the LEFT corner of a wall, seen from inside facing that wall: north wall from its west corner, east wall from its north corner, south wall from its east corner, west wall from its south corner.
{
 "summary": "one or two sentences: what the picture shows",
 "roomType": "bedroom|living|kitchen|dining|bathroom|office|hall|entry|cafe|meeting|lobby|studio|kids|storage|laundry",
 "style": "modern|scandinavian|industrial|japandi|classic",
 "footprint": {"width": m west-east, "depth": m north-south, "ceiling": m},
 "camera": {"x": m, "z": m, "height": m (eye height), "heading": degrees clockwise from north (0 north, 90 east, -45 north-west), "pitch": degrees up (+) or down (-), "fov": HORIZONTAL field of view in degrees (phone 65-75, wide interior lens 85-100)},
 "walls": {"north": {"color": "#rrggbb", "material": "painted plaster|wallpaper|brick|panelling", "visible": true}, "east": {...}, "south": {...}, "west": {...}},
 "floor": {"material": "oak|carpet|tile|concrete|…", "color": "#rrggbb", "note": ""},
 "ceiling": {"color": "#rrggbb", "cornice": {"height": m, "depth": m, "color": "#rrggbb"}  (omit when there is no crown moulding)},
 "openings": [{"id": "win-1", "kind": "window|door|opening", "wall": "west", "along": m (centre), "width": m, "height": m, "sill": m (window bottom above the floor), "visible": true, "box": [x0,y0,x1,y1], "note": "frame colour, panes, view"}],
 "items": [{"id": "bed", "kind": <a part kind below>, "label": "the piece in plain words", "wall": "north", "along": m (centre along that wall), "gap": m from the wall face to the back of the piece, "at": [x, z] (floor pieces away from walls), "faces": "north|east|south|west" or the id of a piece it faces, "on": id of the piece it stands on, "offset": [across, depth] from the host's centre, "opening": window id (curtains), "bottom": m above the floor (wall pieces), "above": id of the piece a wall piece hangs above, "aboveGap": m above that piece's top, "params": {the part's own parameters: sizes in metres, colours as #rrggbb, finishes}, "visible": true, "box": [x0,y0,x1,y1], "confidence": 0..1}],
 "light": {"timeOfDay": 0..24, "sky": "day|dawn|sunset|night|overcast", "from": "west" (the wall whose window the daylight comes through) or "none", "warmth": "cool|neutral|warm", "brightness": 0..1, "note": ""},
 "palette": ["#rrggbb", ...up to 6 dominant colours],
 "assumptions": [{"id": "room-size", "text": "what you assumed and why", "confidence": 0..1, "adjust": "a sentence the user could send to change it, e.g. make the room 4.5 m wide"}]
}
## Rules
- "box" is where the opening or piece APPEARS IN THE PHOTO: [x0, y0, x1, y1] as fractions 0..1 of the image width and height, origin top-left (x0 left edge, y0 top edge), its visible extent (partly hidden or cut off by the frame is fine; curtains: both panels together). Give a box for everything you can see. The builder uses the boxes to fit the camera and to check that what it builds is where the photo has it, so be careful and consistent with the photo's geometry.
- Reconstruct THIS room. No generic or "typical" room: every wall, opening and piece you list must be what the photo shows, at the position it shows. Never invent furniture the photo does not show; a piece you can only infer (behind the camera, hidden) gets "visible": false and a low confidence.
- Estimate sizes from reference objects: doors are 0.8-0.9 × 2.0-2.1 m, standard ceilings 2.4-2.8 m (taller in old buildings: check the window and door proportions), a double bed is 1.4-1.6 m wide and 1.9-2.1 m long, nightstands about 0.5 m, a sofa seat 0.45 m high, switches 1.1 m. Say your uncertainty in "assumptions" (the room size and the camera are always assumptions).
- List EVERYTHING visible: every window and door, curtains (one curtain item per window; it makes both panels), crown moulding, each picture or mirror separately with its own position, every lamp (floor lamps, table lamps on their table, pendants), TV, rugs, plants, cushions on the bed (bed params), books and small objects only when large enough to matter.
- Curtains: kind "curtain", "opening" is the id of the window, params width = gathered width of ONE panel (0.6-1.2 m), height = floor-length drop or window length, color. Pictures: kind "art", params width/height (frame outer size), frame finish, subject ("round" for a round photograph on a mat, "abstract", "blank"), matColor, ink; "wall" + "along" + "bottom" (or "above" + "aboveGap"). Lamps on tables: kind "table-lamp" with "on": the table's id.
- Positions: put each piece where the photo puts it relative to the walls, openings and other pieces (the bed against which wall and where along it, the picture over the bed's left third, the lamp beside the headboard). Floor pieces against a wall use "wall"+"along"+"gap"; only free-standing pieces use "at".
- Colours are the colours the surfaces show in the photo's brighter, well-lit areas as #rrggbb (not the shadow tone). The palette must match the picture.
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

/** The first compare message: what was built, the checklist, how to answer. */
export function compareIntroText(opts: { summary: string; checklist: readonly ChecklistItem[]; notes: readonly string[]; hasObjective: boolean; plan?: string; framing?: string }): string {
  return [
    'COMPARE AND CORRECT. You described the photographed room; it has been built from your description with the design tools. You now see the PHOTO (first image) and a RENDER of the built room from the photo\'s own camera position (second image, with numbered boxes on every piece and opening; the legend follows).',
    `Room: ${opts.summary}`,
    opts.notes.length > 0 ? `Builder notes:\n${opts.notes.map((n) => `- ${n}`).join('\n')}` : '',
    `Checklist (answer every id):\n${opts.checklist.map((c) => `- ${c.id}${c.structural ? ' [structural]' : ''}: ${c.text}`).join('\n')}`,
    'How to judge: the render is a plain preview, not a photograph. Its light is flatter than the photo\'s (no bounce, no glare, the view through the window is a flat sky colour), so NEVER fail an item only because it looks flatter, a little darker or less glossy. Judge what the tools can change: shape, size, position, proportion, hue, and lightness RELATIVE to the things around it (a pale chair next to a dark wall in the photo must be pale next to a dark wall in the render). Do not repaint a surface to compensate for the preview\'s light.',
    'Each round: (1) call report_verdicts with a verdict for EVERY id, judging the render against the photo as a strict reviewer: right place, right size, right colour, right material, right proportion. (2) For every failing item, fix it in the same reply with edit_items / place_items / query_scene (the numbers on the render are pieces; the legend names them; a wall query gives exact positions). Fix the shell and openings first, then furniture, then decor, then materials and lighting. Make the smallest change that works, never rebuild a room to move one piece. (3) The host renders again and you judge again. When every item passes, call finish.',
    opts.hasObjective ? 'The host also measures an objective similarity of the render to the photo (colour, structure, edges); it rolls back a round that made things worse.' : '',
    'Edits to the shell (room size, wall colour, floor, a window\'s size or place) are made by resending design_plan with the corrected plan (pieces you placed stay). Sizes, colours and finishes of pieces change with edit_items resize (params).',
    opts.framing ? `${opts.framing}` : '',
    opts.plan ? `The plan the shell was built from (resend it with changes):\n${opts.plan}` : '',
  ]
    .filter((l) => l.length > 0)
    .join('\n');
}

/** The text of a later round. */
export function compareRoundText(round: number, score: Scoreboard | null, objective: number | null, legend: string, refusals: readonly string[], framing = ''): string {
  return [
    `COMPARE round ${round}. The render below shows the room after your last changes${refusals.length > 0 ? ' (some were refused, see below)' : ''}; the photo is shown again for reference.`,
    score ? `Last round: ${score.passed}/${score.total} items passed.` : '',
    objective !== null ? `Measured agreement with the photo: ${Math.round(objective * 100)}%.` : '',
    framing,
    refusals.length > 0 ? `Refused last time:\n${refusals.map((r) => `- ${r}`).join('\n')}` : '',
    `Legend:\n${legend}`,
    'Call report_verdicts for EVERY id again (judge only what you see now), then fix what fails. Call finish when everything passes or when the remaining differences cannot be fixed with the tools (say why).',
  ]
    .filter((l) => l.length > 0)
    .join('\n');
}
