// Browser playback of an authored provider timeline using silent PCM fixtures.
// These are synthetic browser checks, not human listening or real live audio.
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const run=process.argv[2],candidate=!process.argv.includes('--baseline'),pace=process.argv.includes('--slow')?'slow':'normal';if(!/^[a-z0-9-]{1,40}$/.test(run??'')||process.argv.slice(3).some(a=>!['--candidate','--baseline','--slow'].includes(a))||process.argv.includes('--candidate')&&!candidate)throw Error('RUN_REQUIRED');
const dir='.local/thai-support-spike/caption-sync-'+run;
const files=new Map();
for(const locale of ['th','en'])for(const name of ['audio.js','presentation.js','caption-annotations.js','diagnostics.js','caption-phrases.js'])files.set('/'+locale+'/'+name,new URL(locale==='th'&&(name==='caption-phrases.js'||candidate&&name==='presentation.js')?'../../apps/free-talk-thai/public/'+name:'../../apps/realtime-gateway/public/'+name,import.meta.url));
files.set('/vendor/pinyin-pro.js',new URL('../../node_modules/pinyin-pro/dist/index.js',import.meta.url));files.set('/vendor/pinyin-traditional.js',new URL('../../node_modules/@pinyin-pro/data/dist/traditional.mjs',import.meta.url));
const baselinePhrases=candidate?null:execFileSync('git',['show','cab1354:apps/free-talk-thai/public/caption-phrases.js'],{encoding:'utf8'});
const fixtures=new Map();for(const locale of ['th','en']){
  const events=JSON.parse(await readFile(dir+'/'+locale+'-'+pace+'-authored-replay.json','utf8')).events;
  fixtures.set('/'+locale+'/fixture',events);
}
const server=createServer(async(req,res)=>{try{
  if(req.url==='/th/caption-phrases.js'&&baselinePhrases){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(baselinePhrases);}
  if(files.has(req.url)){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(await readFile(files.get(req.url)));}
  if(fixtures.has(req.url)){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(fixtures.get(req.url)));}
  const match=req.url.match(/^\/(th|en)\/$/);if(!match){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><meta charset="utf-8"><button id="run">run</button><div id="caption"></div><script type="module">
    import {Presentation} from './presentation.js';import {AudioIO} from './audio.js';import {CaptionAnnotations} from './caption-annotations.js';
    const events=await(await fetch('./fixture')).json(),annotations=new CaptionAnnotations(document.querySelector('#caption'));await annotations.ready;
    window.ready=true;document.querySelector('#run').onclick=async()=>{
      const io=new AudioIO({onFailure:()=>{}});await io.prepare();
      const offset=events[0].at_ms,started=performance.now(),rows=[],paints=[];let available=0,allTextAt=null,completion;
      const view=new Presentation({play:(...args)=>io.play(...args),stopAudio:()=>io.stopPlayback(),getPlayback:id=>io.playback(id),
        render:(text,parts)=>{const t=performance.now();annotations.render(text,parts);const paint_ms=performance.now()-t;if(parts.current)paints.push({at_ms:Math.round(performance.now()-started),visible_chars:[...text].length,available_chars:available,thai_visible:/\\p{Script=Thai}/u.test(text),paint_ms});},
        onObserve:(name,f)=>{if(name==='caption.revealed')rows.push({at_ms:Math.round(performance.now()-started),visible_chars:f.visible_chars,cue_at_ms:f.cue_at_ms,played_ms:f.played_pcm_ms,policy:f.caption_policy_version});},
        onMode:mode=>{if(mode==='complete'){completion=performance.now()-started;window.done=true;}}
      });
      for(const e of events)setTimeout(()=>{if(e.type==='response.started')view.begin('reply');if(e.type==='response.text.delta'){available+=[...e.text].length;view.append('reply',e.text);allTextAt=performance.now()-started;}if(e.type==='response.audio.chunk'){const bytes=new Uint8Array(e.bytes);view.audio('reply',btoa(String.fromCharCode(...bytes)),24000);}if(e.type==='response.done')view.done('reply');},Math.max(0,e.at_ms-offset));
      window.finish=async()=>{const stats=io.playback('reply'),result={synthetic_browser_audio:true,real_live_provider:false,human_listening:false,completion_ms:Math.round(completion),last_text_ms:Math.round(allTextAt),first_thai_reveal_ms:paints.find(r=>r.thai_visible)?.at_ms??null,max_paint_ms:Math.max(0,...paints.map(r=>r.paint_ms)),rows,paints,playback:stats};await io.close();return result;};
    };
  </script>`);
}catch{res.writeHead(500);res.end();}});
let browser;
try{
  server.listen(0,'127.0.0.1');await once(server,'listening');browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const samples=await Promise.all(['th','en'].map(async locale=>{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port+'/'+locale+'/');await page.waitForFunction(()=>window.ready);await page.click('#run');await page.waitForFunction(()=>window.done,{},{timeout:60000});const result=await page.evaluate(()=>window.finish());assert.equal(errors.length,0);assert.equal(result.rows[0]?.policy,locale==='en'?'kai-captions-v1':candidate?'kai-thai-captions-v2':'kai-thai-captions-v1');await page.close();return {locale,...result,page_errors:errors.length};}));
  const report={kind:'synthetic_browser_caption_replay',source_run:run,candidate,pace,samples};await writeFile(dir+'/browser-'+(candidate?'candidate':'baseline')+'-'+pace+'-result.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report));
}finally{await browser?.close();server.close();server.closeAllConnections();}
