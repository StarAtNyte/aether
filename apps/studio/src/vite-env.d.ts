/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The player address share links point at (engine/publish.ts). */
  readonly VITE_AETHER_PLAYER_URL?: string;
  /** `1`: force the hosted variant (onboarding/firstRun.ts). */
  readonly VITE_AETHER_HOSTED?: string;
  /** The deployment's Supabase project (shared visits on a static host, player copresence/supabase.ts); public. */
  readonly VITE_SUPABASE_URL?: string;
  /** Its public anon key (row-level security keeps the database closed); public. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Its publishable key, used when there is no anon key; public. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

/** The build is for a static host without the server's shared-visit relay (vite.config.ts). */
declare const __AETHER_NO_RELAY__: boolean | undefined;
