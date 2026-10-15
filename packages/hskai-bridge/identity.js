import { createHmac,timingSafeEqual } from 'node:crypto';
const id=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export const MEMORY_FIELDS=Object.freeze(['interest','correction_preference','support_language','chinese_comprehension','known_expressions']);
const fields=new Set(MEMORY_FIELDS);
export function validateMemoryRecord(record,now=Date.now()) {
  if(!record || !fields.has(record.field))throw new Error('INVALID_MEMORY');
  if(record.field==='known_expressions') {
    if(!Array.isArray(record.value) || record.value.length<1 || record.value.length>12 || new Set(record.value).size!==record.value.length || !record.value.every(v=>typeof v==='string' && /^[\p{Script=Han}，。！？、· ]{1,16}$/u.test(v) && v===v.trim() && /\p{Script=Han}/u.test(v)))throw new Error('INVALID_MEMORY');
  } else if(typeof record.value!=='string' || record.value.length<1 || record.value.length>80 || /[\r\n]/.test(record.value))throw new Error('INVALID_MEMORY');
  if(record.field==='correction_preference' && !['gentle','on_request'].includes(record.value))throw new Error('INVALID_MEMORY');
  if(record.field==='support_language' && !['auto','zh','zh_en'].includes(record.value))throw new Error('INVALID_MEMORY');
  if(record.field==='chinese_comprehension' && !['beginner','comfortable'].includes(record.value))throw new Error('INVALID_MEMORY');
  if(!['student_correction','authorized_hskai_profile'].includes(record.source) || !Number.isFinite(Date.parse(record.updated_at)) || !Number.isFinite(Date.parse(record.expires_at)) || Date.parse(record.updated_at)>now+5000 || Date.parse(record.expires_at)<=now || Date.parse(record.expires_at)-now>90*86400000)throw new Error('INVALID_MEMORY_PROVENANCE');
  return {field:record.field,value:structuredClone(record.value),source:record.source,updated_at:record.updated_at,expires_at:record.expires_at};
}
/** Issued only by the authenticated HSKai BFF after owner/consent/course checks. */
export function signAssertion(claims,secret) {
  if(typeof secret!=='string' || secret.length<32)throw new Error('BRIDGE_SECRET_REQUIRED');
  const body=Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${createHmac('sha256',secret).update(body).digest('base64url')}`;
}
export function verifyAssertion(token,secret,{issuer,audience,clock=()=>Date.now()}={}) {
  if(typeof token!=='string' || token.length>8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))throw new Error('UNAUTHORIZED');
  const [body,signature]=token.split('.');
  const actual=Buffer.from(signature,'base64url'),expected=createHmac('sha256',secret).update(body).digest();
  if(actual.length!==expected.length || !timingSafeEqual(actual,expected))throw new Error('UNAUTHORIZED');
  let claims;try{claims=JSON.parse(Buffer.from(body,'base64url').toString());}catch{throw new Error('UNAUTHORIZED');}
  const now=Math.floor(clock()/1000);
  if(!claims || claims.v!==1 || claims.iss!==issuer || claims.aud!==audience || !id(claims.owner_id) || !id(claims.learner_id) || !id(claims.jti) || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat>now+5 || claims.exp<=now || claims.exp-claims.iat>60)throw new Error('UNAUTHORIZED');
  return claims;
}
export class HskaiBridge {
  constructor({secret,markets=[],clock=()=>Date.now()}) {
    if(typeof secret!=='string' || secret.length<32)throw new Error('HSKAI_BRIDGE_NOT_CONFIGURED');
    Object.assign(this,{secret,markets:new Set(markets),clock});this.used=new Map();
  }
  verify(token,scope) {
    const claims=verifyAssertion(token,this.secret,{issuer:'hskai',audience:'ask-kai',clock:this.clock});
    const now=Math.floor(this.clock()/1000);
    if(!claims || claims.v!==1 || claims.iss!=='hskai' || claims.aud!=='ask-kai' || !id(claims.owner_id) || !id(claims.learner_id) || !id(claims.jti) || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat>now+5 || claims.exp<=now || claims.exp-claims.iat>60 || !Array.isArray(claims.scopes) || !claims.scopes.includes(scope))throw new Error('UNAUTHORIZED');
    if(scope==='session:create' && (!this.markets.has(claims.market) || claims.consent?.voice!==true || typeof claims.minor!=='boolean' || (claims.minor && claims.consent.guardian!==true)))throw new Error('CONSENT_OR_MARKET_DENIED');
    const memory=(claims.memory ?? []).filter(r=>Date.parse(r.expires_at)>this.clock()).map(r=>validateMemoryRecord(r,this.clock()));
    if(memory.length>MEMORY_FIELDS.length || new Set(memory.map(r=>r.field)).size!==memory.length)throw new Error('INVALID_MEMORY');
    let mission=null;
    if(claims.mission) {
      const m=claims.mission;
      if(!id(m.id) || !id(m.completion_id) || m.completed!==true || typeof m.title!=='string' || m.title.length<1 || m.title.length>100 || !Array.isArray(m.targets) || m.targets.length<1 || m.targets.length>2 || !m.targets.every(t=>typeof t==='string' && t.length>0 && t.length<=100))throw new Error('INVALID_TRUSTED_MISSION');
      mission={id:m.id,completion_id:m.completion_id,title:m.title,targets:[...m.targets],completed:true};
    }
    const horizon=claims.authorization_until ?? claims.exp;
    if(!Number.isSafeInteger(horizon) || horizon<claims.exp || horizon>claims.iat+600)throw new Error('INVALID_AUTHORIZATION_HORIZON');
    return {owner_id:claims.owner_id,learner_id:claims.learner_id,market:claims.market,expires:claims.exp*1000,authorization_until:horizon*1000,jti:claims.jti,scopes:[...claims.scopes],memory,mission};
  }
  authorize(req,scope) {
    const header=req.headers.authorization;
    const cookie=(req.headers.cookie ?? '').split(';').map(s=>s.trim()).find(s=>s.startsWith('ask_kai_launch='))?.slice(15);
    const token=header?.startsWith('Bearer ') ? header.slice(7):cookie;
    return this.verify(token,scope);
  }
  consume(identity) {
    for(const [jti,expires] of this.used)if(expires<=this.clock())this.used.delete(jti);
    if(identity.expires<=this.clock() || this.used.has(identity.jti) || this.used.size>=10000)throw new Error('LAUNCH_ALREADY_USED');
    this.used.set(identity.jti,identity.expires);
  }
}
