import {ReportAnalyzer} from '../../../packages/teacher-assistant/report.js';

// No database or user session is opened in this process. This first stage only
// moves the existing bounded rule report; model and pronunciation paths remain off.
process.once('message',({endpoint,secret})=>{
  let stopping=false,timer;const analyzer=new ReportAnalyzer();
  const call=async(op,input={})=>{const response=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify({op,input}),signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('ANALYSIS_API_ERROR');return response.json();};
  const poll=async()=>{if(stopping)return;try{const job=await call('claim');if(job.state==='claimed'){const ref={job_id:job.job_id,lease_id:job.lease_id};try{const report=await analyzer.analyze(job.plan,job.evidence,job.attempt);await call('commit',{...ref,source_hash:job.source_hash,report});}catch{try{await call('fail',ref);}catch{/* lease or authorization no longer valid */}}}}catch{/* data service can recover independently */}finally{if(!stopping)timer=setTimeout(poll,300);}};
  const stop=()=>{stopping=true;clearTimeout(timer);process.exit(0);};process.once('disconnect',stop);process.once('SIGTERM',stop);process.send?.({ready:true});void poll();
});
