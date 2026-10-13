#!/usr/bin/env node
// Entry for a future `npx aether-bridge`: runs the TypeScript sources through tsx.
import { register } from 'tsx/esm/api';
register();
await import('../src/main.ts');
