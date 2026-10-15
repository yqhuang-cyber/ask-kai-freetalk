import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { signAssertion,verifyAssertion,validateMemoryRecord,MEMORY_FIELDS } from '../../../packages/hskai-bridge/identity.js';
import { InMemoryLearnerStore } from '../../../packages/hskai-bridge/memory.js';
import { SPORTS_RESOURCE,missionResource,learnerFixture } from './planning-fixtures.js';
import { validateLearningRecord } from '../../../packages/contracts/planning.js';
import { MOCK_LEARNERS,mockLearner,accountContext,accountSyllabusInventory,accountMemory,LEARNER_FIXTURE_VERSION } from './learner-accounts.js';
import { LEARNER_PARTS,learnerPart } from '../../../packages/contracts/learner-data.js';

export const MOCK_IDENTITY=Object.freeze({owner_id:'poc-owner',learner_id:'poc-learner',market:'SG'});
export const MOCK_MISSION=Object.freeze({id:'poc-sports-mission',completion_id:'poc-fixture-completion',completed:true,title:'示例 Mission：我喜欢足球',targets:Object.freeze(['用「我喜欢……」表达喜好'])});
const scopes=['session:create','session:revoke','memory:read','memory:write','memory:delete','privacy:export','privacy:erase','privacy:read','context:read','curriculum:read','learning:write',...Object.values(LEARNER_PARTS).map(p=>p.scope)];
const key=identity=>JSON.stringify([identity.owner_id,identity.learner_id]);
const id=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>24576)throw new Error('INVALID_REQUEST');chunks.push(chunk);}const value=JSON.parse(Buffer.concat(chunks).toString());if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('INVALID_REQUEST');return value;}

// Actual local HTTP contract double, never an external HSKai account or human queue.
export function createMockHskai({secret,clock=()=>Date.now(),initialMemory,mission=MOCK_MISSION,fixtureVariant,fixtureIdentities=[],topicResources}={}) {
  if(typeof secret!=='string' || secret.length<32)throw new Error('BRIDGE_SECRET_REQUIRED');
  const memory=new InMemoryLearnerStore(),used=new Map(),privacy=new Map(),handoffs=new Map();
  const fixtureAt=clock();
  const learners=new Map([...MOCK_LEARNERS.map(i=>[key(i),undefined]),[key(MOCK_IDENTITY),fixtureVariant],...fixtureIdentities.map(i=>[key(i),i.variant])]),revisions=new Map(),learningRecords=new Map();
  const bump=identity=>revisions.set(key(identity),(revisions.get(key(identity))??1)+1);
  const fixture={field:'interest',value:'足球',source:'authorized_hskai_profile',updated_at:new Date(clock()).toISOString(),expires_at:new Date(clock()+30*86400000).toISOString()};
  const records=initialMemory===undefined?[fixture]:initialMemory;
  if(!Array.isArray(records) || records.length>MEMORY_FIELDS.length || new Set(records.map(r=>r?.field)).size!==records.length)throw new Error('INVALID_MOCK_FIXTURE');
  memory.records.set(key(MOCK_IDENTITY),records.map(r=>validateMemoryRecord(r,clock())));
  for(const learner of MOCK_LEARNERS)if(learner.learner_id!==MOCK_IDENTITY.learner_id)memory.records.set(key(learner),accountMemory(learner.uid,clock()));
  const contextFor=async identity=> {
    const revision=revisions.get(key(identity))??1,options={revision,memory:await memory.read(identity),now:clock(),fixtureAt,records:[...learningRecords.values()].filter(r=>r.owner===key(identity))};
    return learners.get(key(identity))!==undefined?learnerFixture(identity,{...options,variant:learners.get(key(identity))}):accountContext(identity,options);
  };
  const server=createServer(async(req,res)=> {
    if(!/^127\.0\.0\.1:\d+$/.test(req.headers.host??'') || req.headers.origin || req.headers['sec-fetch-site'])return json(res,403,{error:'INTERNAL_LOOPBACK_REQUIRED'});
    if(req.method!=='POST')return json(res,405,{error:'METHOD_NOT_ALLOWED'});
    const audiences={'/internal/ask-kai/launch':'hskai-launch','/internal/ask-kai/memory':'hskai-memory','/internal/ask-kai/privacy':'hskai-privacy','/internal/ask-kai/safeguarding':'hskai-safeguarding','/internal/ask-kai/planning':'hskai-planning',...Object.fromEntries(Object.keys(LEARNER_PARTS).map(p=>[`/internal/ask-kai/${p}`,`hskai-${p}`]))};
    if(!Object.hasOwn(audiences,req.url))return json(res,404,{error:'NOT_FOUND'});
    const audience=audiences[req.url];
    let identity;
    try {
      if(!req.headers.authorization?.startsWith('Bearer '))throw new Error('UNAUTHORIZED');
      identity=verifyAssertion(req.headers.authorization.slice(7),secret,{issuer:'ask-kai',audience,clock});
      for(const [nonce,expires] of used)if(expires<=clock())used.delete(nonce);
      if(used.has(identity.jti) || used.size>=10000)throw new Error('UNAUTHORIZED');
      used.set(identity.jti,identity.exp*1000);
    }catch{return json(res,401,{error:'UNAUTHORIZED'});}
    let input;try{input=await body(req);}catch{return json(res,400,{error:'INVALID_REQUEST'});}
    try {
      const part=Object.keys(LEARNER_PARTS).find(p=>audience===`hskai-${p}`);
      if(part) {
        if(!learners.has(key(identity))||!identity.scopes?.includes(LEARNER_PARTS[part].scope))return json(res,403,{error:'LEARNER_DATA_AUTHORIZATION_REQUIRED'});
        if(identity.operation!=='read'||input.operation!=='read'||Object.keys(input).some(k=>k!=='operation'))return json(res,400,{error:'INVALID_OPERATION'});
        return json(res,200,learnerPart(await contextFor(identity),part,learners.get(key(identity))!==undefined?'legacy-fixture-v1':LEARNER_FIXTURE_VERSION,part==='learning-profile'&&learners.get(key(identity))===undefined?accountSyllabusInventory(identity,{fixtureAt}):undefined));
      }
      if(audience==='hskai-planning') {
        const fields={context:['operation'],resource:['operation','mode','resource_id'],append:['operation','record','idempotency_key']};
        const scope=input.operation==='append'?'learning:write':input.operation==='resource'?'curriculum:read':'context:read';
        if(!learners.has(key(identity))||!identity.scopes?.includes(scope))return json(res,403,{error:'PLANNING_AUTHORIZATION_REQUIRED'});
        if(!fields[input.operation]||identity.operation!==input.operation||Object.keys(input).some(k=>!fields[input.operation].includes(k)))return json(res,400,{error:'INVALID_OPERATION'});
        if(input.operation==='context')return json(res,200,await contextFor(identity));
        if(input.operation==='resource') {
          const resource=input.mode==='mission'&&input.resource_id===mission?.id?missionResource(mission):['topic','sports'].includes(input.mode)&&input.resource_id==='sports'?SPORTS_RESOURCE:null;
          return json(res,resource?200:404,resource??{error:'RESOURCE_UNAVAILABLE'});
        }
        const record=validateLearningRecord(input.record);
        if(input.idempotency_key!==record.session_id)return json(res,400,{error:'INVALID_IDEMPOTENCY_KEY'});
        let r=record.resource_ref===null?null:record.resource_ref.id==='sports'&&record.resource_ref.version===SPORTS_RESOURCE.version?SPORTS_RESOURCE:record.resource_ref.id===mission?.id?missionResource(mission):undefined;
        if(r===undefined&&topicResources)try{r=await topicResources.read(record.resource_ref.id,{version:record.resource_ref.version});}catch{return json(res,400,{error:'INVALID_RECORD_RESOURCE'});}
        if(r===undefined||r&&r.version!==record.resource_ref.version||record.observations.some(o=>!r?.key_points.some(k=>k.id===o.kp_id&&k.evidence_rule!=='unassessed'&&(record.schema_version!=='learning-record-v2'||k.evidence_rule===o.attempt_rule_ref&&r.goals.some(g=>g.id===o.goal_id&&g.kp_ids.includes(k.id))))))return json(res,400,{error:'INVALID_RECORD_RESOURCE'});
        const recordKey=JSON.stringify([key(identity),record.session_id]);let stored=learningRecords.get(recordKey);
        if(stored&&JSON.stringify(stored.record)!==JSON.stringify(record))return json(res,409,{error:'RECORD_CONFLICT'});
        if(!stored){if(learningRecords.size>=1000)throw new Error('MOCK_CAPACITY');bump(identity);stored={owner:key(identity),record,receipt_id:randomUUID(),revision:revisions.get(key(identity)),updated_at:new Date(clock()).toISOString()};learningRecords.set(recordKey,stored);}
        return json(res,200,{status:'accepted',session_id:record.session_id,receipt_id:stored.receipt_id,revision:stored.revision,mocked:true,persistence:'process_memory'});
      }
      if(audience==='hskai-launch') {
        if(identity.owner_id!==MOCK_IDENTITY.owner_id||!mockLearner(identity.learner_id)||Object.keys(input).length)return json(res,400,{error:'INVALID_LAUNCH'});
        if(identity.operation==='list'&&identity.learner_id===MOCK_IDENTITY.learner_id)return json(res,200,{source:'mock_hskai',fixture_version:LEARNER_FIXTURE_VERSION,learners:MOCK_LEARNERS});
        if(identity.operation!=='issue')return json(res,400,{error:'INVALID_LAUNCH'});
        const now=Math.floor(clock()/1000);
        const assertion=signAssertion({v:1,iss:'hskai',aud:'ask-kai',owner_id:identity.owner_id,learner_id:identity.learner_id,market:'SG',jti:randomUUID(),iat:now,exp:now+60,authorization_until:now+600,minor:false,consent:{voice:true,guardian:false},scopes,memory:await memory.read(identity),mission},secret);
        return json(res,200,{assertion,source:'mock_hskai'});
      }
      if(audience==='hskai-memory') {
        const fields={read:['operation'],write:['operation','record'],delete:['operation','field']};
        if(!Object.hasOwn(fields,input.operation) || identity.operation!==input.operation || Object.keys(input).some(k=>!fields[input.operation].includes(k)))return json(res,400,{error:'INVALID_OPERATION'});
        if(input.operation==='read')return json(res,200,{records:await memory.read(identity)});
        if(input.operation==='write'){await memory.write(identity,validateMemoryRecord(input.record,clock()));bump(identity);}
        if(input.operation==='delete'){if(input.field!==null && !MEMORY_FIELDS.includes(input.field))return json(res,400,{error:'INVALID_MEMORY'});await memory.delete(identity,input.field);bump(identity);}
        return json(res,200,{});
      }
      if(audience==='hskai-privacy') {
        if(!['export','erase','status'].includes(input.operation) || identity.operation!==input.operation || Object.keys(input).some(k=>!['operation','request_id'].includes(k)))return json(res,400,{error:'INVALID_OPERATION'});
        if(input.operation==='status') {
          const entry=privacy.get(input.request_id);if(!entry || entry.owner!==key(identity))return json(res,404,{error:'NOT_FOUND'});
          if(entry.status==='pending'){if(entry.operation==='erase'){await memory.delete(identity);for(const [k,r] of learningRecords)if(r.owner===key(identity))learningRecords.delete(k);bump(identity);}entry.status='completed';}
          return json(res,200,{request_id:input.request_id,status:entry.status,mocked:true});
        }
        if(privacy.size>=1000)throw new Error('MOCK_CAPACITY');
        const request_id=randomUUID();privacy.set(request_id,{owner:key(identity),operation:input.operation,status:'pending'});
        return json(res,200,{request_id,status:'pending',mocked:true});
      }
      if(Object.keys(input).some(k=>!['request_id','session_id','source_event_id','reason','policy_version'].includes(k)) || !['self_harm','abuse','adult_content','privacy'].includes(input.reason) || ![input.request_id,input.session_id,input.source_event_id,input.policy_version].every(id))return json(res,400,{error:'INVALID_HANDOFF'});
      const expected=`${input.session_id}-${input.source_event_id}`;
      if(req.headers['idempotency-key']!==expected)return json(res,400,{error:'INVALID_IDEMPOTENCY_KEY'});
      const handoffKey=JSON.stringify([key(identity),expected]);
      if(!handoffs.has(handoffKey)){if(handoffs.size>=1000)throw new Error('MOCK_CAPACITY');handoffs.set(handoffKey,`mock-${randomUUID()}`);}
      return json(res,200,{accepted:true,case_id:handoffs.get(handoffKey),assigned_team:'poc-mock-no-human',mocked:true});
    }catch{return json(res,400,{error:'MOCK_REQUEST_FAILED'});}
  });
  server.requestTimeout=5000;server.headersTimeout=5000;
  server.on('close',()=>{memory.records.clear();used.clear();privacy.clear();handoffs.clear();learningRecords.clear();revisions.clear();});
  return server;
}
