import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {READING_CASES,CUSTOM_READINGS} from './cases.js';
import {takeCaptionPhrase} from '../../apps/realtime-gateway/public/caption-phrases.js';
const require=createRequire(new URL('../../.local/pinyin-caption-spike/package.json',import.meta.url));
const mode=process.argv[2]??'base';if(!['base','modern','complete','custom','custom-traditional'].includes(mode))throw Error('INVALID_SPIKE_MODE');
const boot=performance.now(),lib=require('pinyin-pro');let dictionary;
if(['modern','complete'].includes(mode)){dictionary=require('@pinyin-pro/data/'+mode);lib.addDict(dictionary);}
if(mode.startsWith('custom'))lib.customPinyin(CUSTOM_READINGS);
let traditionalDictionary;
if(mode==='custom-traditional'){traditionalDictionary=require('@pinyin-pro/data/traditional');lib.addTraditionalDict(traditionalDictionary);}
const bootMs=performance.now()-boot;
const convert=text=>lib.pinyin(text,{type:'all',toneType:'symbol',toneSandhi:false,traditional:mode==='custom-traditional'});
const readings=text=>convert(text).filter(c=>c.isZh).map(c=>c.pinyin).join(' ');
const results=READING_CASES.map(c=>{const rows=convert(c.text),actual=rows.filter(r=>r.isZh).map(r=>r.pinyin).join(' ');return {id:c.id,passed:actual===c.expected,expected:c.expected,actual,source_preserved:rows.map(r=>r.origin).join('')===c.text};});
const timings=[];
for(let n=0;n<1200;n++){const c=READING_CASES[n%READING_CASES.length],start=performance.now();convert(c.text);timings.push(performance.now()-start);}timings.sort((a,b)=>a-b);
// Demonstrate a real stream context hazard using the existing phrase splitter.
const splitCases=['我想去银行，找银行行长。','我还没还书。','重复一次，再去重庆。'];
const streaming=splitCases.map(text=>{
 let buffer='',parts=[];for(const char of text){buffer+=char;let p;while((p=takeCaptionPhrase(buffer))){parts.push(p);buffer=buffer.slice(p.length);}}
 if(buffer)parts.push(buffer);
 return {text,parts,whole:readings(text),per_phrase:parts.map(readings).filter(Boolean).join(' '),per_character:[...text].map(readings).filter(Boolean).join(' ')};
});
const assets={};for(const f of ['dist/index.mjs','dist/index.js']){const data=await readFile(new URL('../../.local/pinyin-caption-spike/node_modules/pinyin-pro/'+f,import.meta.url));assets[f]={bytes:data.length,gzip_bytes:gzipSync(data).length};}
if(dictionary){const data=Buffer.from(JSON.stringify(dictionary));assets.dictionary_json={bytes:data.length,gzip_bytes:gzipSync(data).length,entries:Object.keys(dictionary).length};}
if(traditionalDictionary){const data=Buffer.from(JSON.stringify(traditionalDictionary));assets.traditional_json={bytes:data.length,gzip_bytes:gzipSync(data).length,entries:Object.keys(traditionalDictionary).length};}
const report={version:1,kind:'offline_authored_conversion_spike',mode,pinyin_pro:'3.29.5',data_package:['modern','complete','custom-traditional'].includes(mode)?'1.3.1':null,production_agent_changed:false,real_provider:false,browser_tested:false,audio_tested:false,policy:{toneSandhi:false,description:'dictionary tones; not measured audio pronunciation'},passed:results.filter(r=>r.passed).length,total:results.length,source_preserved:results.every(r=>r.source_preserved),results,streaming,metrics:{node_boot_ms:bootMs,iterations:timings.length,conversion_p50_ms:timings[600],conversion_p95_ms:timings[1140],conversion_max_ms:timings.at(-1)},assets,fixture_sha256:createHash('sha256').update(JSON.stringify(READING_CASES)).digest('hex'),custom_readings_are_in_sample:mode.startsWith('custom')};
await mkdir('.local/pinyin-caption-spike',{recursive:true,mode:0o700});await writeFile('.local/pinyin-caption-spike/conversion-'+mode+'.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report,null,2));
