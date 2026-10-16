import { randomUUID,createHash } from 'node:crypto';
import { validateConversationRecord } from '../../../packages/contracts/conversation-record.js';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const owner=i=>JSON.stringify([i.owner_id,i.learner_id]);
const key=(i,s)=>JSON.stringify([owner(i),s]);
export class ConversationStore {
  constructor({clock=()=>Date.now()}={}){this.rows=new Map();this.clock=clock;}
  open(identity,sessionId,mode) {
    if(!id(sessionId)||!['free','sports','topic','mission'].includes(mode))throw new Error('INVALID_CONVERSATION');
    const k=key(identity,sessionId),old=this.rows.get(k);if(old){if(old.mode!==mode)throw new Error('CONVERSATION_CONFLICT');return this.receipt(old);}
    if(this.rows.size>=1000)throw new Error('MOCK_CAPACITY');
    const row={owner:owner(identity),session_id:sessionId,mode,record:null,record_revision:0,receipt_id:randomUUID(),summary_hash:null};this.rows.set(k,row);return this.receipt(row);
  }
  save(identity,input) {
    const record=validateConversationRecord(input),row=this.rows.get(key(identity,record.session_id));if(!row)throw new Error('CONVERSATION_NOT_FOUND');
    const hash=createHash('sha256').update(JSON.stringify(record)).digest('hex');
    if(row.record){if(row.summary_hash===hash)return this.receipt(row);if(row.record.summary.revision>=record.summary.revision)throw new Error('CONVERSATION_CONFLICT');}
    row.record=record;row.summary_hash=hash;row.record_revision++;row.updated_at=new Date(this.clock()).toISOString();return this.receipt(row);
  }
  receipt(row){return {status:row.record?'accepted':'open',session_id:row.session_id,summary_revision:row.record?.summary.revision??null,summary_hash:row.summary_hash,record_revision:row.record_revision,receipt_id:row.receipt_id,mocked:true,persistence:'process_memory'};}
  read(identity,sessionId){if(!id(sessionId))throw new Error('INVALID_CONVERSATION');const row=this.rows.get(key(identity,sessionId));if(!row)throw new Error('CONVERSATION_NOT_FOUND');return {record:structuredClone(row.record),...this.receipt(row)};}
  list(identity){return [...this.rows.values()].filter(r=>r.owner===owner(identity)&&r.record).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)).map(r=>structuredClone(r));}
  erase(identity){for(const [k,r] of this.rows)if(r.owner===owner(identity))this.rows.delete(k);}
  clear(){this.rows.clear();}
}
