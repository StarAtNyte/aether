/**
 * The lazily loaded part of the small-edit engine. The agent imports this
 * module dynamically on the first prompt, so the parser, the lexicon and the
 * edit operations (well over 100 KB) stay out of the first-frame bundle.
 */
export { planFineEdit } from './plan';
export { classifyScope, auditPatches } from './guard';
