import { createHash } from 'node:crypto';

export const COLLECTION_EVIDENCE_VERSION='kai-collection-evidence-v1';
export function authorProviderAssociation({caseId,turn,audioSha,finals,replies,complete=false}) {
  const providerTurns=[...new Set(finals.map(f=>f.turn_id))],links=replies.map(r=>({turn_id:r.turn_id,response_id:r.response_id,model_reply_complete:r.completed===true}));
  const single=providerTurns.length===1&&links.length===1&&links[0].turn_id===providerTurns[0];
  return {version:1,case_id:caseId,author_turn:turn,input_audio_sha256:audioSha,association_basis:'collector_active_input_window',
    status:single?'single':providerTurns.length>1||links.length>1?'fragmented':'unresolved',
    provider_turn_ids:providerTurns.slice(0,4),response_links:links.slice(0,4),truncated:providerTurns.length>4||links.length>4,
    eligible_as_complete_turn:complete&&single&&links[0].model_reply_complete,provider_ids_merged:false,semantic_alignment_verified:false,playback_measured:false};
}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Descriptive amplitude measurements, not VAD, pronunciation or listening proof.
export function measureInputPcm(bytes) {
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length%2)throw new Error('INVALID_EVIDENCE_PCM');
  let energy=0,peak=0,nonzero=0,active=0,first=null,last=null;
  for(let offset=0;offset<bytes.length;offset+=640) {
    let sum=0;const end=Math.min(offset+640,bytes.length);
    for(let i=offset;i<end;i+=2){const v=bytes.readInt16LE(i);sum+=v*v;peak=Math.max(peak,Math.abs(v));if(v)nonzero++;}
    energy+=sum;
    if(Math.sqrt(sum/((end-offset)/2))>=256){active++;first??=offset/32;last=end/32;}
  }
  return {format:'pcm_s16le',sample_rate:16000,bytes:bytes.length,duration_ms:bytes.length/32,
    rms:Math.sqrt(energy/(bytes.length/2)),peak,nonzero_samples:nonzero,
    active_frame_threshold_rms:256,frame_ms:20,active_frames:active,
    first_active_ms:first,last_active_ms:last,speech_content_verified:false};
}

export class CollectionEvidence {
  constructor({now=()=>performance.now()}={}) {
    this.now=now;this.started=now();this.current=null;this.turns=new Map();this.sessionEvents=[];this.truncated=false;
  }
  at(){return this.now()-this.started;}
  begin(turn,bytes) {
    const row={turn,queued_at_ms:this.at(),audio:measureInputPcm(bytes),enqueued_bytes:0,flushed_bytes:0,
      first_audio_enqueue_at_ms:null,last_audio_enqueue_at_ms:null,transport_flushed_at_ms:null,
      enqueue_intervals:{count:0,total_ms:0,min_ms:null,max_ms:null,over_40ms:0},
      enqueued_sha256:null,events:[],event_counts:{},truncated:false,hash:createHash('sha256')};
    this.turns.set(turn,row);this.current=turn;return row;
  }
  enqueue(row,bytes) {
    if(!bytes.length)return;
    const at=this.at();
    if(row.last_audio_enqueue_at_ms!==null){const gap=at-row.last_audio_enqueue_at_ms,stats=row.enqueue_intervals;stats.count++;stats.total_ms+=gap;stats.min_ms=Math.min(stats.min_ms??gap,gap);stats.max_ms=Math.max(stats.max_ms??gap,gap);if(gap>40)stats.over_40ms++;}
    row.first_audio_enqueue_at_ms??=at;row.last_audio_enqueue_at_ms=at;
    row.enqueued_bytes+=bytes.length;row.hash.update(bytes);
    if(row.enqueued_bytes===row.audio.bytes){row.enqueued_sha256=row.hash.digest('hex');this.event('collector','input.enqueued');}
  }
  flushed(row,bytes,error) {
    if(error){this.event('collector','input.transport_error');return;}
    row.flushed_bytes+=bytes;
    if(row.flushed_bytes===row.audio.bytes)row.transport_flushed_at_ms=this.at();
  }
  event(site,name,ids={}) {
    // Never retain event payloads, text, audio, credentials or raw wire packets.
    if(!['collector','provider_adapter','gateway_client'].includes(site)||typeof name!=='string'||!/^[a-z][a-z._]{0,79}$/.test(name))return;
    const row=this.turns.get(this.current),key=`${site}:${name}`,event={site,name,at_ms:this.at(),collector_turn:this.current};
    for(const field of ['turn_id','response_id'])if(/^[A-Za-z0-9_-]{1,128}$/.test(ids[field]??''))event[field]=ids[field];
    if(row){
      event.remaining_input_bytes=row.audio.bytes-row.enqueued_bytes;
      const count=row.event_counts[key]??={count:0,first_at_ms:event.at_ms,last_at_ms:event.at_ms};count.count++;count.last_at_ms=event.at_ms;
      // Keep first streamed delta only; the counts retain first/last timing.
      if(['user.partial','response.audio.chunk','response.text.delta'].includes(name)&&count.count>1)return;
      if(row.events.length<256)row.events.push(event);else row.truncated=true;
    }
    if(this.sessionEvents.length<2048)this.sessionEvents.push(event);else this.truncated=true;
  }
  snapshot(turn) {
    const row=this.turns.get(turn);if(!row)return null;
    const {hash,...safe}=row;
    const providerFinal=row.events.find(e=>e.site==='provider_adapter'&&e.name==='user.final');
    const replyStart=row.events.find(e=>e.site==='provider_adapter'&&e.name==='response.started');
    return structuredClone({...safe,version:COLLECTION_EVIDENCE_VERSION,
      all_input_enqueued:row.enqueued_bytes===row.audio.bytes,all_input_transport_flushed:row.flushed_bytes===row.audio.bytes,
      provider_final_before_input_end:providerFinal?providerFinal.remaining_input_bytes>0:null,
      provider_reply_before_input_end:replyStart?replyStart.remaining_input_bytes>0:null,
      provider_receipt_proven:false,playback_measured:false});
  }
  finishTurn(){this.event('collector','turn.completed');this.current=null;}
  snapshotSession(){return {version:COLLECTION_EVIDENCE_VERSION,clock:'collector_monotonic_session',events:structuredClone(this.sessionEvents),truncated:this.truncated};}
}

// Transparent observer of the existing authorized port. No added reads/writes,
// no access to internal TeachingSession state, no promotion of ASR to memory.
export function observeMemoryPort(port,{now=()=>performance.now()}={}) {
  const started=now(),calls=[];let owner=null,truncated=false;
  const wrapped={};
  for(const operation of ['read','write','delete'])wrapped[operation]=async(...args)=>{
    const identity=args[0],key=JSON.stringify([identity.owner_id,identity.learner_id]);owner??=key;
    const row={operation,at_ms:now()-started,owner_matches_first_call:key===owner,
      field:operation==='write'?args[1]?.field??null:operation==='delete'?args[1]??null:null,status:'pending'};
    if(calls.length<256)calls.push(row);else truncated=true;
    try {
      const result=await port[operation](...args);row.status='completed';row.completed_at_ms=now()-started;
      if(operation==='read')row.records=result.map(r=>({field:r.field,value_sha256:digest(r.value),source:r.source}));
      return result;
    }catch(error){row.status='failed';row.completed_at_ms=now()-started;throw error;}
  };
  return {port:wrapped,snapshot:()=>({version:COLLECTION_EVIDENCE_VERSION,scope:'authorized_mock_memory_port_calls_only',
    calls:structuredClone(calls),truncated,internal_session_memory_observed:false,
    values_retained:false,added_port_calls:0,write_calls:calls.filter(c=>c.operation==='write').length,
    delete_calls:calls.filter(c=>c.operation==='delete').length})};
}
