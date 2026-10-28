import { readFileSync } from 'node:fs';
import { createWorld } from '@aether/core';
import { runVerify } from '../lib/headless-world';
for (const n of ['office', 'workshop', 'kitchen']) {
  const w = createWorld(JSON.parse(readFileSync(`${process.argv[2]}/${n}.json`, 'utf8')));
  const r = await runVerify(w);
  console.log(n, r.passed, r.summary.replace(/\s+/g, ' ').slice(0, 700));
}
