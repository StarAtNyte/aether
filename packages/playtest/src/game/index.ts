/** Game checks (flow and balance) for worlds that are games; see `review.ts`. */
export { gameShape, isGameWorld, templateOf, type GameShape, type WaveSpawn } from './shape';
export { playGame, SKILL_PROFILES, type GameRun, type PlayOptions, type SkillProfile } from './bot';
export { reviewGame, NOVICE_SURVIVE_SECONDS, AVERAGE_WAVE_SHARE, type GameReview, type GameReviewOptions } from './review';
