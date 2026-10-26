import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {loadProfile} from '../../packages/provider-doubao/probe.js';
import {SLIDES_CASES} from './cases.js';
import {SLIDES_BATCH_CASES} from './batch-cases.js';
import {hash,INPUT_DIRECTORY} from './prepare.js';
import {runSlidesProtocolProbe} from './protocol-probe.js';
const args=process.argv.slice(2),controller=new AbortController();
process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
try{
  if(args.some(arg=>arg!=='--live'&&arg!=='--all'&&arg!=='--static-tools'&&arg!=='--source-evidence'&&arg!=='--capability-epochs'&&!arg.startsWith('--case=')))throw new Error('INVALID_ARGUMENTS');
  const requested=args.filter(a=>a.startsWith('--case='));if(requested.length>1||args.includes('--all')&&requested.length)throw new Error('INVALID_ARGUMENTS');
  const selected=args.includes('--all')?SLIDES_CASES:[...SLIDES_CASES,...SLIDES_BATCH_CASES].filter(c=>c.id===(requested[0]?.slice(7)??'recent'));
  if(!selected.length)throw new Error('INVALID_CASE');
  if(!args.includes('--live')){
    console.log(JSON.stringify({mode:'preflight_only',cases:selected.map(c=>c.id),live:false,production_agent_changed:false}));
  }else{
    const profile=await loadProfile(process.env.DOUBAO_REALTIME_PROFILE),manifest=JSON.parse(await readFile(INPUT_DIRECTORY+'/manifest.json','utf8'));
    const sourcePaths=['scripts/voice-slides-control/cases.js','scripts/voice-slides-control/batch-cases.js','scripts/voice-slides-control/protocol-probe.js','scripts/voice-slides-control/probe.js','scripts/voice-slides-control/source-evidence.js','scripts/voice-slides-control/command-capabilities.js','apps/realtime-gateway/src/slides-command-gate.js','packages/contracts/ui-actions.js'];
    const sourceHashes=Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,hash(await readFile(path))])));
    const samples=[],replies=[];
    for(const testCase of selected){
      if(controller.signal.aborted)break;
      const entry=manifest.entries.find(item=>item.id===testCase.id);
      if(!entry||entry.path!==testCase.id+'.pcm'||entry.script_sha256!==hash(testCase.text))throw new Error('INPUT_MANIFEST_MISMATCH');
      const pcm=await readFile(INPUT_DIRECTORY+'/'+entry.path);
      const report=await runSlidesProtocolProbe({profile,pcm,manifest:{...manifest,...entry},testCase,toolScope:args.includes('--static-tools')?'static':'confirmed',sourceEvidence:args.includes('--source-evidence'),epochCapabilities:args.includes('--capability-epochs'),signal:controller.signal,observeAuthoredReply:reply=>replies.push(reply)});
      samples.push(report);console.error(JSON.stringify({id:report.id,status:report.status,ended:report.ended,asr_match:report.asr_matches_authored,tools:report.tool_calls,final_page:report.final_page}));
      await mkdir(INPUT_DIRECTORY,{recursive:true,mode:0o700});
      const stem=(args.includes('--capability-epochs')?'epoch-':args.includes('--source-evidence')?'source-':'')+(args.includes('--all')?'single-input-suite':testCase.id);
      await writeFile(INPUT_DIRECTORY+'/'+stem+'-report.json',JSON.stringify({version:2,mode:'live',real_provider_connected:samples.some(s=>s.provider_ready),synthetic_viewer:true,synthetic_history:true,browser_audio_tested:false,production_agent_changed:false,
        source_hashes:sourceHashes,samples},null,2)+'\n',{mode:0o600});
      await writeFile(INPUT_DIRECTORY+'/'+stem+'-authored-replies.json',JSON.stringify(replies,null,2)+'\n',{mode:0o600});
      // A rejected configuration/transport must not fan out into the rest of the suite.
      if(!report.provider_ready)break;
    }
    console.log(JSON.stringify({samples:samples.length,observed:samples.filter(s=>s.status==='sample_observed').length,semantics_accepted:false,real_provider_connected:samples.some(s=>s.provider_ready),synthetic_viewer:true,browser_audio_tested:false}));
  }
}catch(error){console.error(/^[A-Z_]+$/.test(error.message)?error.message:'SLIDES_PROTOCOL_PROBE_FAILED');process.exitCode=1;}
