const counters=['sessions','ready','failures','dropped_events','interruptions','restricted','handoffs_delivered','control_rate_limited','mock_records_saved','mock_records_pending','mock_records_failed'];
const timings=['ready_ms','first_audio_ms'];
export class Metrics {
  constructor(){this.groups={};}
  group(kind) {const key=kind==='doubao'?'doubao':'synthetic';return this.groups[key] ??= {counters:{},timings:{}};}
  count(kind,name) {if(!counters.includes(name))throw new Error('INVALID_METRIC');const g=this.group(kind);g.counters[name]=(g.counters[name]??0)+1;}
  observe(kind,name,value) {if(!timings.includes(name) || !Number.isFinite(value) || value<0 || value>600000)throw new Error('INVALID_METRIC');const values=this.group(kind).timings[name] ??= [];values.push(value);if(values.length>1000)values.shift();}
  snapshot() {
    const groups={};
    for(const [kind,group] of Object.entries(this.groups)) {
      const summary={};
      for(const [name,values] of Object.entries(group.timings)){const sorted=[...values].sort((a,b)=>a-b);summary[name]={samples:sorted.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1]};}
      groups[kind]={counters:{...group.counters},timings:summary};
    }
    return {scope:'local_process',window:'latest_1000_samples',contains_transcripts:false,groups};
  }
}
