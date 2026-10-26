import {requireThat} from './contracts.js';
export async function readJson(req,limit=65536){requireThat((req.headers['content-type']??'').startsWith('application/json'),'JSON_REQUIRED');let size=0,body='';for await(const chunk of req){size+=chunk.length;requireThat(size<=limit,'REQUEST_TOO_LARGE');body+=chunk;}try{return JSON.parse(body);}catch{throw new Error('INVALID_JSON');}}
export function json(res,status,value,headers={}){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});res.end(JSON.stringify(value));}
export function errorStatus(code){return /UNAUTHORIZED/.test(code)?401:/FORBIDDEN|REVOKED/.test(code)?403:code==='NOT_FOUND'?404:/CONFLICT|ACTIVE|EXPIRED|SUBMITTED|VERSION|EVIDENCE/.test(code)?409:400;}
