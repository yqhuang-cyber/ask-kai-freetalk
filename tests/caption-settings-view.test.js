import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CaptionSettingsView} from '../apps/realtime-gateway/public/caption-settings.js';
function fixture(ready=Promise.resolve(true)){
 const reports=[],changes=[],toggle={},hint={};const v=new CaptionSettingsView({annotations:{ready,setEnabled:x=>changes.push(x)},toggle,hint,send:p=>reports.push(p)});v.reset('session');return{v,reports,changes,toggle,hint};
}
const packet=(revision,enabled=false)=>({session_id:'session',request_id:'request-'+revision,revision,pinyin_enabled:enabled});
test('UI receipts preserve session/revision and cannot apply another session or a stale request',async()=>{
 const f=fixture();assert.equal(await f.v.receive({...packet(1),session_id:'other'}),false);assert.equal(f.reports.length,0);await f.v.receive(packet(2));assert.equal(f.toggle.checked,false);assert.equal(await f.v.receive(packet(1,true)),false);assert.equal(f.reports.at(-1).revision,2);
});
test('asynchronous enabling cannot emit an old receipt after a new disable or session reset',async()=>{
 let release;const f=fixture(new Promise(r=>release=r)),pending=f.v.receive(packet(1,true));await f.v.receive(packet(2,false));release(true);assert.equal(await pending,false);assert.equal(f.reports.length,1);assert.equal(f.reports[0].pinyin_enabled,false);
 let finish;const g=fixture(new Promise(r=>finish=r)),old=g.v.receive(packet(1,true));g.v.reset('new-session');finish(true);assert.equal(await old,false);assert.equal(g.reports.length,0);assert.equal(g.toggle.checked,true);
});
test('annotation load failure reports unavailable while disable remains available',async()=>{
 const f=fixture(Promise.resolve(false));await f.v.receive(packet(1,true));assert.equal(f.reports[0].status,'unavailable');assert.match(f.hint.textContent,/中文/);await f.v.receive(packet(2,false));assert.equal(f.reports[1].status,'applied');
});
