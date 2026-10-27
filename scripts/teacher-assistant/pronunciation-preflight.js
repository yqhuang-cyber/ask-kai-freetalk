import {tencentReadiness} from '../../packages/teacher-assistant/teaching-record/tencent-readiness.js';
// Only booleans and public documentation metadata are printed; never credentials or signed URLs.
console.log(JSON.stringify(tencentReadiness(process.env),null,2));
