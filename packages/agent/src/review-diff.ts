/**
 * The differences step of the review loop for worlds built from a prompt: the render is compared with what the user
 * asked for (and with any reference pictures they attached), the gaps are written down, ranked and fixed largest first,
 * and each is confirmed on the next render (see `photo/differences.ts`, which keeps the list). Texts only; the
 * method is in the tool's description.
 */

/** Seed of the independent seat of the review. */
export const REVIEW_CROSSCHECK_SEED = 9931;

/** Tools that only read: a round may use them before it has listed its differences. */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(['query_scene', 'query_level', 'inspect', 'search_assets', 'find_model', 'simready_search', 'run_verification', 'finish', 'report_differences']);

/** System prompt of the independent seat that checks a finished world against the request, with fresh eyes. */
export const REVIEW_CROSSCHECK_SYSTEM =
  'You are an independent reviewer. You did not build this 3D world and you have not seen how it was built. You are given what the user asked for, renders of the world (with numbered marks on pieces), measured findings from a checker (advisory data, not a verdict) and sometimes reference pictures the user attached. Look at the images with fresh eyes and call report_differences once with every real gap between the request (and references) and what the renders show: missing or extra items, wrong proportion or scale, position, colour, material, lighting and mood. Be concrete (which piece or area, how much) and rank by size (5 = obvious at first glance). Do not list the preview\'s flat light as a difference and do not invent gaps: when the world matches, send an empty list.';

/** What the model is asked to check in each round: the request, point by point, against the images. */
export function requirementText(request: string, hasRefs: boolean, round: number, hasList: boolean): string {
  return [
    `COMPARE WITH THE REQUEST. The user asked for: <request>${request.slice(0, 900)}</request>`,
    hasRefs ? 'REFERENCE pictures the user attached are shown next to the renders (left: reference, right: render): match them in proportion, layout, colour, material and mood.' : '',
    round === 1 || !hasList
      ? 'Take the request apart into what it asks for (each object, quantity, size, place, colour, material, mood, anything it must do) and look for each in the images. Call report_differences with every gap (kind, where, what with the amount, size 1..5), then fix the LARGEST first, one change per gap.'
      : 'Your list is above. Judge each earlier id on THESE renders only (status: fixed, smaller, same, worse), add what is new, and call report_differences before editing. If a gap you worked on did not shrink, change the approach; then fix the largest open one next.',
  ]
    .filter((l) => l.length > 0)
    .join('\n');
}

/** The user turn of the independent seat. */
export function reviewCrossCheckText(request: string, findings: string, legend: string, hasRefs: boolean): string {
  return [
    `REQUEST: <request>${request.slice(0, 900)}</request>`,
    hasRefs ? 'Reference pictures from the user are shown first, then the renders.' : '',
    findings ? `Measured by the checker (advisory):\n${findings}` : '',
    legend ? `Numbers on the images:\n${legend}` : '',
    'Compare the request (and references) with the renders, then call report_differences.',
  ]
    .filter((l) => l.length > 0)
    .join('\n');
}
