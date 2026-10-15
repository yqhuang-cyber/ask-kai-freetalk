import { readFile } from 'node:fs/promises';
import { checkPreparedDataset } from '../apps/eval-runner/src/prepared-dataset.js';

const path=process.argv[2];
if(!path)throw new Error('Usage: npm run eval:dataset:check -- /absolute/path/prepared.json');
console.log(JSON.stringify(checkPreparedDataset(JSON.parse(await readFile(path,'utf8'))),null,2));
