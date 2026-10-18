import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

// Opt-in, session-owned memory only. Never attach credentials, audio or reasoning.
const scope=new AsyncLocalStorage();
const hidden=/^(?:authorization|cookie|set-cookie|headers|api[_-]?key|.*secret.*|ticket|audio_data|pcm|reasoning_content)$/i;
function clean(value,depth=0) {
  if(depth>24)return '[depth limit]';
  if(typeof value==='string')return value.replace(/Bearer\s+[^\s"\\]+/gi,'Bearer [redacted]').replace(/\bsk-[A-Za-z0-9_-]{12,}/g,'[redacted]');
  if(value===null||typeof value==='number'||typeof value==='boolean')return value;
  if(Array.isArray(value))return value.map(v=>clean(v,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!hidden.test(k)).map(([k,v])=>[k,clean(v,depth+1)]));
  return null;
}
export class PlanningTrace {
  constructor({limit=160,maxBytes=2097152,maxRowBytes=131072,now=()=>performance.now()}={}) {
    Object.assign(this,{limit,maxBytes,maxRowBytes,now});this.id=randomUUID();this.started=now();this.rows=[];this.bytes=0;this.seq=0;this.discarded=0;this.listeners=new Set();
  }
  record(stage,data={}) {
    try {
      if(this.closed)return;
      let detail=clean(data),bytes=Buffer.byteLength(JSON.stringify(detail)),truncated=false;
      if(bytes>this.maxRowBytes){detail={omitted:true,reason:'row_size_limit',original_bytes:bytes};bytes=Buffer.byteLength(JSON.stringify(detail));truncated=true;}
      const row={trace_id:this.id,seq:++this.seq,at_ms:Math.round(this.now()-this.started),stage,data:detail,...(truncated?{truncated:true}:{})};
      while(this.rows.length&&(this.rows.length>=this.limit||this.bytes+bytes>this.maxBytes)){this.bytes-=this.rows.shift().bytes;this.discarded++;}
      if(bytes>this.maxBytes){this.discarded++;return;}
      this.rows.push({row,bytes});this.bytes+=bytes;
      for(const listener of this.listeners)try{listener(row);}catch{/* Observation cannot control the session. */}
    }catch{/* Observation cannot control the session. */}
  }
  snapshot(){return {trace_id:this.id,discarded:this.discarded,contains_text:true,contains_audio:false,storage:'memory_only',rows:this.rows.map(x=>x.row)};}
  subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  clear(){this.closed=true;this.rows=[];this.bytes=0;this.listeners.clear();}
}
export function withPlanningTrace(trace,fields,work) {
  if(!trace)return work();
  return scope.run({trace,fields,active:true},work);
}
export function planningTraceEvent(stage,data={}) {
  try{const current=scope.getStore();if(current?.active)current.trace.record(stage,{...current.fields,...(typeof data==='function'?data():data)});}catch{/* Observation cannot control planning. */}
}
export function planningTraceFields(fields){const current=scope.getStore();if(current)current.fields={...current.fields,...fields};}
export function closePlanningTraceScope(){const current=scope.getStore();if(current)current.active=false;}
