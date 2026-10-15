import { createHash } from 'node:crypto';
/** Official POST /api/public/scores; exports numeric results only, no conversation text. */
export async function exportLangfuseScores({report,baseUrl,publicKey,secretKey,traceIds,runId,fetcher=fetch}) {
  const url=new URL(baseUrl);
  if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash || !publicKey || !secretKey || !/^[A-Za-z0-9_-]{1,100}$/.test(runId))throw new Error('INVALID_LANGFUSE_CONFIG');
  if(!Array.isArray(report.results) || !report.results.length || report.results.length>500)throw new Error('INVALID_SCORE_REPORT');
  const endpoint=new URL('/api/public/scores',url);
  const ids=[];
  for(const result of report.results) {
    const traceId=traceIds[result.case_id];
    if(typeof traceId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(traceId))throw new Error('LANGFUSE_TRACE_MAPPING_REQUIRED');
    for(const [name,value] of Object.entries({...result.scores,overall:result.score,critical_failure:result.critical_failure?1:0})) {
      if(value===null)continue;
      if(!Number.isFinite(value) || value<0 || value>100 || !/^[a-z_]{1,40}$/.test(name))throw new Error('INVALID_SCORE_REPORT');
      const id=createHash('sha256').update(`${runId}:${result.case_id}:${name}`).digest('hex');
      const response=await fetcher(endpoint.href,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:`Basic ${Buffer.from(publicKey+':'+secretKey).toString('base64')}`,'Content-Type':'application/json'},body:JSON.stringify({id,traceId,name:`ask_kai_${name}`,value,dataType:name==='critical_failure'?'BOOLEAN':'NUMERIC'})});
      if(!response.ok)throw new Error('LANGFUSE_EXPORT_FAILED');
      await response.body?.cancel();ids.push(id);
    }
  }
  return {submitted:ids.length,ids,persistence_verified:false};
}
