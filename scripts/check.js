import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { loadScenario, SCENARIOS } from '../packages/provider-replay/index.js';
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes:true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await check(path);
    else if (path.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check',path], { encoding:'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
    } else if (path.endsWith('.json')) JSON.parse(await readFile(path,'utf8'));
  }
}
await check('.');
for (const scenario of SCENARIOS) await loadScenario(scenario.id);
console.log('Syntax, JSON and fixture contracts verified.');
