import { createHash,randomUUID } from 'node:crypto';
import { mkdir,open,readFile,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { requireIdentity } from '../../../packages/contracts/planning.js';

const keyOf=identity=>createHash('sha256').update(JSON.stringify([identity.owner_id,identity.learner_id])).digest('hex');
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
const bytes=value=>Buffer.byteLength(JSON.stringify(value));
export class ObservationReports {
  constructor({directory=null,limit=20,maxReportBytes=1048576}={}){Object.assign(this,{directory,limit,maxReportBytes});this.memory=new Map();this.jobs=new Map();}
  async readBucket(key){
    if(!this.directory)return structuredClone(this.memory.get(key)??[]);
    try{const value=await readFile(join(this.directory,key+'.json'));if(value.length>this.limit*this.maxReportBytes+65536)throw new Error('OBSERVATION_REPORT_STORAGE_INVALID');const rows=JSON.parse(value);if(!Array.isArray(rows)||rows.length>this.limit||rows.some(r=>r.schema_version!=='conversation-observation-v1'||!validId(r.id)||bytes(r)>this.maxReportBytes))throw new Error('OBSERVATION_REPORT_STORAGE_INVALID');return rows;}
    catch(error){if(error.code==='ENOENT')return [];throw error;}
  }
  async writeBucket(key,rows){
    if(!this.directory){this.memory.set(key,structuredClone(rows));return;}
    await mkdir(this.directory,{recursive:true,mode:0o700});
    const path=join(this.directory,key+'.json'),temporary=path+'.'+randomUUID()+'.tmp';
    const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(rows));}finally{await file.close();}await rename(temporary,path);
  }
  async transact(identity,work){
    requireIdentity(identity,'session:create');const key=keyOf(identity),previous=this.jobs.get(key)??Promise.resolve();
    const next=previous.catch(()=>{}).then(async()=>{requireIdentity(identity,'session:create');return work(key);});
    this.jobs.set(key,next);try{return await next;}finally{if(this.jobs.get(key)===next)this.jobs.delete(key);}
  }
  save(identity,report){return this.transact(identity,async key=>{
    if(report?.schema_version!=='conversation-observation-v1'||!validId(report.id)||!report.ended_at||!Array.isArray(report.turns)||report.turns.length>5||bytes(report)>this.maxReportBytes)throw new Error('INVALID_OBSERVATION_REPORT');
    const rows=await this.readBucket(key),old=rows.find(r=>r.id===report.id);
    if(old)return {status:'saved',id:report.id,persistent:!!this.directory};
    rows.unshift(structuredClone(report));rows.sort((a,b)=>b.ended_at.localeCompare(a.ended_at));await this.writeBucket(key,rows.slice(0,this.limit));
    return {status:'saved',id:report.id,persistent:!!this.directory};
  });}
  list(identity){return this.transact(identity,async key=>(await this.readBucket(key)).map(r=>({id:r.id,started_at:r.started_at,ended_at:r.ended_at,state:r.state,error_code:r.error_code,turn_count:r.turns.length,turn_limit:r.turn_limit,learner:r.learner,log_id:r.provider.log_id,synthetic:r.provider.synthetic})));}
  get(identity,id){return this.transact(identity,async key=>{if(!validId(id))throw new Error('OBSERVATION_REPORT_NOT_FOUND');const report=(await this.readBucket(key)).find(r=>r.id===id);if(!report)throw new Error('OBSERVATION_REPORT_NOT_FOUND');return structuredClone(report);});}
  review(identity,id,patch){return this.transact(identity,async key=>{
    if(!validId(id)||!patch||Object.keys(patch).length!==1||!Array.isArray(patch.reviews)||patch.reviews.length>20)throw new Error('INVALID_OBSERVATION_REVIEW');
    const rows=await this.readBucket(key),report=rows.find(r=>r.id===id);if(!report)throw new Error('OBSERVATION_REPORT_NOT_FOUND');
    const responses=[...report.turns.flatMap(t=>t.responses),...report.unassigned_responses],seen=new Set();
    for(const item of patch.reviews){
      if(!item||Object.keys(item).length!==4||!['response_id','expected_response','expected_effect','notes'].every(k=>Object.hasOwn(item,k))||!validId(item.response_id)||seen.has(item.response_id)||!['expected_response','expected_effect','notes'].every(k=>item[k]===null||typeof item[k]==='string'&&item[k].length<=3000))throw new Error('INVALID_OBSERVATION_REVIEW');
      const response=responses.find(r=>r.response_id===item.response_id);if(!response)throw new Error('INVALID_OBSERVATION_REVIEW');seen.add(item.response_id);
      response.review=Object.fromEntries(['expected_response','expected_effect','notes'].map(k=>[k,item[k]?.trim()||null]));
    }
    if(bytes(report)>this.maxReportBytes)throw new Error('INVALID_OBSERVATION_REVIEW');await this.writeBucket(key,rows);return structuredClone(report);
  });}
}
