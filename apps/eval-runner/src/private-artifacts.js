import { writeFile,rename,rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// Keep the previous complete checkpoint if a process stops during a write.
// Callers only use fresh, private .local directories, never tracked artifacts.
export async function atomicPrivateJson(path,value) {
  const temporary=`${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
    await rename(temporary,path);
  }finally{await rm(temporary,{force:true});}
}
