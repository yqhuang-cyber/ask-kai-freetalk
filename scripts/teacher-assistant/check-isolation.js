import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const baseline=JSON.parse(readFileSync(new URL('./freetalk-baseline.json',import.meta.url)));
for(const [path,expected] of Object.entries(baseline.files))assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),expected,`FreeTalk baseline changed: ${path}`);
console.log(JSON.stringify({baseline:baseline.commit,protected_files:Object.keys(baseline.files).length,unchanged:true,shared_realtime_seam:'checked separately by default-host regression tests'}));
