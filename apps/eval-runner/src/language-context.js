import { LanguageSupport } from './evaluation-language-v3.js';
import { validateMemoryRecord,MEMORY_FIELDS } from '../../../packages/hskai-bridge/identity.js';

// Expected support comes from approved initial data and preceding student turns,
// never the tested Kai output, reference replies or future student utterances.
export function languageContexts(testCase) {
  const initial=testCase.initial_memory??[];
  const at=testCase.profile_at===undefined?Date.now():Date.parse(testCase.profile_at);
  if(!Number.isFinite(at) || (testCase.profile_at!==undefined && (typeof testCase.profile_at!=='string' || testCase.profile_at.length>40)) || !Array.isArray(initial) || initial.length>MEMORY_FIELDS.length || new Set(initial.map(r=>r?.field)).size!==initial.length || (initial.length && testCase.profile_at===undefined))throw new Error('INVALID_EVAL_LANGUAGE_PROFILE');
  const memory=initial.map(r=>validateMemoryRecord(r,at));
  const language=new LanguageSupport({memory,clock:()=>at});
  const rows=[];let version=1;
  testCase.turns.forEach((turn,index)=> {
    if(turn.role==='student') {
      version++;
      const event={session_id:testCase.id,event_id:`eval-${index}`,turn_id:`turn-${index}`,payload:{text:turn.text}};
      language.observe(turn.text,{turn_id:event.turn_id,source_event_id:event.event_id,context_version:version});
    } else rows.push({turn_index:index,policy:language.snapshot()});
  });
  return rows;
}
