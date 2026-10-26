import {fork} from 'node:child_process';import {randomBytes} from 'node:crypto';
export class HomeworkPort {
  constructor({endpoint,secret}){this.endpoint=endpoint;this.secret=secret;}
  async call(op,token,input={}){let response;try{response=await fetch(this.endpoint,{method:'POST',headers:{authorization:`Bearer ${this.secret}`,'content-type':'application/json'},body:JSON.stringify({op,token,input}),signal:AbortSignal.timeout(2500)});}catch{throw new Error('HOMEWORK_SERVICE_UNAVAILABLE');}const value=await response.json();if(!response.ok)throw new Error(value.error??'HOMEWORK_SERVICE_ERROR');return value;}
}
export async function startHomeworkBackend({path='.local/teacher-assistant/homework.sqlite'}={}){
  const secret=randomBytes(32).toString('hex');const child=fork(new URL('../../apps/hskai-mock/src/teacher-assistant/worker.js',import.meta.url),[],{env:{PATH:process.env.PATH},stdio:['ignore','ignore','inherit','ipc']});
  const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('HOMEWORK_SERVICE_START_TIMEOUT'));},8000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('HOMEWORK_SERVICE_START_FAILED'));});child.once('message',v=>{clearTimeout(timer);if(v.error){child.kill();reject(new Error(v.error));}else resolve(v);});child.send({path,secret});});
  return {port:new HomeworkPort({endpoint:`http://127.0.0.1:${ready.port}/homework`,secret}),child,close:()=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill();})};
}
