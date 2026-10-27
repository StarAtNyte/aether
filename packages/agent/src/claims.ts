/**
 * Wording shared by the tool descriptions and the review prompts about what a report may claim, and about what to do
 * with a refusal. Kept in one place so the prompts, the tool texts and their tests say the same thing.
 */

/**
 * A report claims only what the evidence shows, and names what was not looked at. Added to the lines that end a review
 * and to the `finish` tool.
 */
export const NARROW_CLAIM =
  'Report the narrowest claim the evidence supports: what you measured or saw, at which pose or view and against which limit ("the sofa clears the door swing at 0.9 m under the 0.8 m walkway check"), never a general verdict ("the layout works", "it all fits"). Then list the checks you did not make as "Not checked:" (for example heights and ceiling clearance, the route a piece takes in, contact between meshes, daylight at other hours, views you did not render), and what you left open.';

/** A refusal from a placement or edit tool is information about the room. */
export const REFUSAL_IS_A_CONSTRAINT =
  'A refusal from place_items or edit_items is a constraint of the room, not a failure of the tool: read its reason (the piece blocks a door, is too large for the room, crosses a wall), then solve it: a smaller piece or size, another wall, another room, or fewer pieces. Do not resend the same call, and do not work round it with apply_patches, which would put the piece where the checker said it cannot stand.';

/** An edit that would leave nothing in the world is refused unless the user asked to start over. */
export const NO_EMPTYING =
  'An edit that would remove every entity of the world is refused with a message; remove only the pieces you mean, and use startOver:true on apply_patches only when the user asked to start over.';
