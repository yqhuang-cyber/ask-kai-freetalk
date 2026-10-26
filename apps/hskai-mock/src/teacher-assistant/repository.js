import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';import {dirname} from 'node:path';
const tables=['actors','sessions','publications','assignments','attempts','submissions','jobs','reports','drafts','preparation_jobs'];
// All business state is owned by the Mock HSKai process, never by the voice loop.
export class HomeworkRepository {
  constructor(path){if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});this.db=new DatabaseSync(path);if(path!==':memory:')chmodSync(path,0o600);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY)');
    for(const table of tables)this.db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY, body TEXT NOT NULL)`);
    this.db.exec('INSERT OR IGNORE INTO migrations VALUES(1); INSERT OR IGNORE INTO migrations VALUES(2)');
  }
  table(t){if(!tables.includes(t))throw new Error('INVALID_TABLE');return t;}
  get(t,id){const row=this.db.prepare(`SELECT body FROM ${this.table(t)} WHERE id=?`).get(id);return row?JSON.parse(row.body):null;}
  all(t){return this.db.prepare(`SELECT body FROM ${this.table(t)}`).all().map(r=>JSON.parse(r.body));}
  put(t,value){this.db.prepare(`INSERT INTO ${this.table(t)}(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body`).run(value.id,JSON.stringify(value));return value;}
  remove(t,id){this.db.prepare(`DELETE FROM ${this.table(t)} WHERE id=?`).run(id);}
  transaction(work){this.db.exec('BEGIN IMMEDIATE');try{const result=work();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  close(){this.db.close();}
}
