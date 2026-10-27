import {HomeworkPreparations} from './preparations.js';
import {RecordingPermissions} from './recording-permissions.js';
import {AnalysisDelegation} from './analysis-delegation.js';
import {TranscriptStore} from './transcript-store.js';
import {AudioStore} from './audio-store.js';
import {homeworkActors} from './fixtures.js';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {HomeworkRepository} from './repository.js';
import {PresetPlanSource} from '../../../../packages/teacher-assistant/preset.js';
import {ReportAnalyzer,projectReport,validateReport} from '../../../../packages/teacher-assistant/report.js';
import {requireThat,id,key,validPlan,validEvidence,digest} from '../../../../packages/teacher-assistant/contracts.js';
const hash=token=>createHash('sha256').update(token).digest('hex');
export class HomeworkService {
  constructor({path=':memory:',analyzer=new ReportAnalyzer(),planSource=new PresetPlanSource(),actors=homeworkActors,aiPlanSource,recordingPolicy,experimentalAudio=false,now=()=>Date.now()}={}){this.repo=new HomeworkRepository(path);this.analyzer=analyzer;this.now=now;this.plans=planSource;
    for(const actor of actors)if(!this.repo.get('actors',actor.id))this.repo.put('actors',{...actor,active:true,auth_epoch:1,deletion_epoch:1});
    // A crashed running session cannot be resumed or submitted without its evidence fence.
    for(const a of this.repo.all('attempts'))if(a.state==='active')this.repo.put('attempts',{...a,state:'interrupted',version:a.version+1});
    for(const j of this.repo.all('jobs'))if(j.state==='running')this.repo.put('jobs',{...j,state:j.external_started?'failed':'pending',lease_id:null,lease_until:null,error:j.external_started?'EXTERNAL_OUTCOME_UNKNOWN':undefined});
    this.preparations=new HomeworkPreparations(this,aiPlanSource);
    this.recordingPermissions=new RecordingPermissions(this,recordingPolicy);
    this.analysisDelegation=new AnalysisDelegation(this);
    this.transcriptStore=new TranscriptStore(this);
    this.transcriptStore.markInterrupted();
    this.audioStore=experimentalAudio||this.repo.all('audio_segments').length||this.repo.all('audio_manifests').length?new AudioStore(this,{databasePath:path,enabled:experimentalAudio}):null;
  }
  publicActor(a){return {id:a.id,name:a.name,role:a.role,source:'mock_hskai',level:a.level};}
  actor(token){requireThat(typeof token==='string'&&token.length<=128,'UNAUTHORIZED');const s=this.repo.get('sessions',hash(token)),a=s&&this.repo.get('actors',s.actor_id);requireThat(s&&a?.active&&s.expires>this.now()&&s.auth_epoch===a.auth_epoch&&s.deletion_epoch===a.deletion_epoch,'UNAUTHORIZED');return a;}
  role(a,role){requireThat(a.role===role,'FORBIDDEN');}
  assignment(a,assignmentId){const item=this.repo.get('assignments',id(assignmentId));requireThat(item,'NOT_FOUND');const learner=this.repo.get('actors',item.learner_id);requireThat(learner?.active,'AUTHORIZATION_REVOKED');requireThat(a.role==='learner'?a.id===item.learner_id:a.id===item.teacher_id&&a.learners.includes(item.learner_id),'FORBIDDEN');return item;}
  publication(item){const p=this.repo.get('publications',item.publication_id);requireThat(p?.state==='published','ASSIGNMENT_INACTIVE');validPlan(p.plan);requireThat(p.plan.hash===item.plan_hash,'PLAN_HASH_MISMATCH');return p;}
  writable(item){const p=this.publication(item);requireThat(Date.parse(p.due_at)>this.now(),'ASSIGNMENT_EXPIRED');return p;}
  attempt(a,attemptId){const attempt=this.repo.get('attempts',id(attemptId));requireThat(attempt,'NOT_FOUND');this.assignment(a,attempt.assignment_id);return attempt;}
  verifyEpoch(attempt){const a=this.repo.get('actors',attempt.learner_id);requireThat(a?.active&&a.auth_epoch===attempt.auth_epoch&&a.deletion_epoch===attempt.deletion_epoch,'AUTHORIZATION_REVOKED');}
  async call(op,token,input={}){
    if(op==='login'){const a=this.repo.get('actors',id(input.actor_id));requireThat(a?.active,'UNAUTHORIZED');const opaque=randomBytes(32).toString('hex');this.repo.put('sessions',{id:hash(opaque),actor_id:a.id,auth_epoch:a.auth_epoch,deletion_epoch:a.deletion_epoch,expires:this.now()+3600000});return {token:opaque,actor:this.publicActor(a)};}
    const a=this.actor(token);
    if(['audio_authorize','audio_append','audio_read','audio_seal','audio_manifest','audio_discard'].includes(op)){requireThat(this.audioStore,'RECORD_NOT_ENABLED');return this.audioStore.call(op,a,input);}
    if(this.transcriptStore.handles(op))return this.transcriptStore.call(op,a,input);
    if(this.recordingPermissions.handles(op))return this.recordingPermissions.call(op,a,input);
    if(this.preparations.handles(op))return this.preparations.call(op,a,input);
    if(op==='me')return {actor:this.publicActor(a),learners:a.role==='teacher'?a.learners.map(l=>this.publicActor(this.repo.get('actors',l))):[]};
    if(op==='logout'){this.repo.remove('sessions',hash(token));return {ok:true};}
    if(op==='preview'){this.role(a,'teacher');requireThat(a.learners.includes(id(input.learner_id))&&this.repo.get('actors',input.learner_id)?.active,'FORBIDDEN');return this.plans.prepare({topic:input.topic},{learner_id:input.learner_id,level:this.repo.get('actors',input.learner_id).level});}
    if(op==='publish'){
      this.role(a,'teacher');key(input.idempotency_key);requireThat(typeof input.due_at==='string'&&Number.isFinite(Date.parse(input.due_at))&&Date.parse(input.due_at)>this.now()&&input.timezone==='Asia/Shanghai','INVALID_DEADLINE');
      const plan=input.draft_id?this.preparations.planForPublication(a,input):await this.call('preview',token,input);requireThat(input.plan_hash===plan.hash,'PLAN_HASH_MISMATCH');const fingerprint=digest({learner_id:input.learner_id,plan_hash:plan.hash,due_at:input.due_at,timezone:input.timezone});
      return this.repo.transaction(()=>{const prior=this.repo.all('publications').find(p=>p.teacher_id===a.id&&p.idempotency_key===input.idempotency_key);if(prior){requireThat(prior.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT');return prior;}
        if(input.draft_id)this.preparations.planForPublication(a,input);
        const p={id:randomUUID(),state:'published',version:1,teacher_id:a.id,teacher_name:a.name,due_at:input.due_at,timezone:input.timezone,plan,plan_hash:plan.hash,idempotency_key:input.idempotency_key,fingerprint,source:'mock_hskai',created_at:this.now()};
        const assignment={id:randomUUID(),publication_id:p.id,teacher_id:a.id,learner_id:plan.learner_id,plan_hash:plan.hash,version:1};this.repo.put('publications',p);this.repo.put('assignments',assignment);if(input.draft_id)this.preparations.published(a,input,p.id);return {...p,assignment_id:assignment.id};});
    }
    if(op==='list'){return this.repo.all('assignments').filter(i=>a.role==='teacher'?i.teacher_id===a.id&&a.learners.includes(i.learner_id):i.learner_id===a.id).filter(i=>this.repo.get('actors',i.learner_id)?.active).map(i=>{
      const p=this.publication(i),submissions=this.repo.all('submissions').filter(s=>s.assignment_id===i.id);return {...i,teacher_name:p.teacher_name,learner_name:this.repo.get('actors',i.learner_id).name,due_at:p.due_at,timezone:p.timezone,plan:p.plan,source:p.source,submissions:submissions.map(s=>this.submissionView(s,a))};});}
    if(op==='prepare'){
      this.role(a,'learner');const item=this.assignment(a,input.assignment_id),p=this.writable(item);requireThat(!this.repo.all('submissions').some(s=>s.assignment_id===item.id),'ALREADY_SUBMITTED');
      // One active preparation per assignment; replacing it invalidates its lease and late writes.
      for(const old of this.repo.all('attempts'))if(old.assignment_id===item.id&&old.state==='active')this.repo.put('attempts',{...old,state:'superseded',version:old.version+1});
      const attempt={id:randomUUID(),assignment_id:item.id,learner_id:a.id,plan_hash:p.plan.hash,state:'active',version:1,auth_epoch:a.auth_epoch,deletion_epoch:a.deletion_epoch,session_id:null,lease_until:this.now()+30000,created_at:this.now()};this.repo.put('attempts',attempt);
      return {attempt,plan:p.plan,identity:{owner_id:'mock-homework-owner',learner_id:a.id,expires:this.now()+30000,authorization_until:this.now()+600000,scopes:[],memory:[]}};
    }
    if(op==='bind_session') {this.role(a,'learner');const attempt=this.attempt(a,input.attempt_id);requireThat(attempt.state==='active'&&!attempt.session_id&&attempt.lease_until>this.now(),'ATTEMPT_NOT_ACTIVE');this.verifyEpoch(attempt);this.writable(this.assignment(a,attempt.assignment_id));id(input.session_id);this.repo.put('attempts',{...attempt,session_id:input.session_id});return {ok:true};}
    if(op==='authorize_attempt'){this.role(a,'learner');const attempt=this.attempt(a,input.attempt_id);this.verifyEpoch(attempt);requireThat(attempt.state==='active'&&attempt.session_id===input.session_id&&attempt.lease_until>this.now(),'ATTEMPT_NOT_ACTIVE');this.writable(this.assignment(a,attempt.assignment_id));this.repo.put('attempts',{...attempt,lease_until:this.now()+6000});const choice=this.repo.get('recording_choices',attempt.id);return {ok:true,recording:{text:!!choice?.text.allowed&&this.now()<choice.text.expires_at,audio:!!choice?.audio.allowed&&this.now()<choice.audio.expires_at}};}
    if(op==='finalize'){
      this.role(a,'learner');const attempt=this.attempt(a,input.attempt_id);this.verifyEpoch(attempt);this.writable(this.assignment(a,attempt.assignment_id));validEvidence(input.evidence,attempt,this.publication(this.assignment(a,attempt.assignment_id)).plan);const fence=digest(input.evidence);
      if(attempt.state==='ended'){requireThat(attempt.evidence_hash===fence,'EVIDENCE_CONFLICT');return {attempt_id:attempt.id,state:attempt.state,evidence_hash:fence};}
      requireThat(attempt.state==='active'&&attempt.lease_until>this.now(),'ATTEMPT_NOT_ACTIVE');requireThat(!['authorization_revoked','safety_restricted'].includes(input.evidence.end_reason),'EVIDENCE_RESTRICTED');
      this.repo.put('attempts',{...attempt,state:'ended',version:attempt.version+1,evidence:input.evidence,evidence_hash:fence,ended_at:this.now()});return {attempt_id:attempt.id,state:'ended',evidence_hash:fence};
    }
    if(op==='attempt'){let attempt=this.attempt(a,input.attempt_id);if(attempt.state==='active'&&attempt.lease_until<=this.now())attempt=this.repo.put('attempts',{...attempt,state:'interrupted',version:attempt.version+1});return {id:attempt.id,assignment_id:attempt.assignment_id,state:attempt.state,version:attempt.version,evidence_hash:attempt.evidence_hash??null,session_id:attempt.session_id,plan_hash:attempt.plan_hash};}
    if(op==='submit'){
      this.role(a,'learner');key(input.idempotency_key);return this.repo.transaction(()=>{const attempt=this.attempt(a,input.attempt_id);this.verifyEpoch(attempt);this.writable(this.assignment(a,attempt.assignment_id));
        const prior=this.repo.all('submissions').find(s=>s.assignment_id===attempt.assignment_id);if(prior){requireThat(prior.attempt_id===attempt.id,'ALREADY_SUBMITTED');return this.submissionView(prior,a);}
        const duplicate=this.repo.all('submissions').find(s=>s.learner_id===a.id&&s.idempotency_key===input.idempotency_key);requireThat(!duplicate,'IDEMPOTENCY_CONFLICT');
        requireThat(attempt.state==='ended'&&attempt.evidence?.ready&&attempt.evidence.final_turns>0,'NO_SUBMITTABLE_EVIDENCE');requireThat(input.expected_version===attempt.version,'VERSION_CONFLICT');
        let transcript_hash=null,audio_manifest_hash=null;try{transcript_hash=this.transcriptStore.read(a,{attempt_id:attempt.id}).snapshot_hash;}catch{/* Unavailable, expired or declined text must not block submission. */}try{audio_manifest_hash=this.audioStore?.manifest(a,{attempt_id:attempt.id}).manifest_hash??null;}catch{/* Audio can independently be unavailable. */}
        const s={id:randomUUID(),attempt_id:attempt.id,assignment_id:attempt.assignment_id,learner_id:a.id,plan_hash:attempt.plan_hash,evidence_hash:attempt.evidence_hash,transcript_hash,audio_manifest_hash,idempotency_key:input.idempotency_key,submitted_at:this.now(),state:'submitted'};
        this.repo.put('submissions',s);this.repo.put('jobs',{id:s.id,submission_id:s.id,state:'pending',tries:0,transcript_hash,audio_manifest_hash});return this.submissionView(s,a);});
    }
    if(op==='submission'){let s=input.submission_id?this.repo.get('submissions',id(input.submission_id)):this.repo.all('submissions').find(s=>s.attempt_id===input.attempt_id);requireThat(s,'NOT_FOUND');this.assignment(a,s.assignment_id);return this.submissionView(s,a);}
    if(op==='retry_report'){this.role(a,'teacher');const s=this.repo.get('submissions',id(input.submission_id));requireThat(s,'NOT_FOUND');this.assignment(a,s.assignment_id);const job=this.repo.get('jobs',s.id);requireThat(job.state==='failed','REPORT_NOT_FAILED');this.repo.put('jobs',{...job,state:'pending'});return {state:'pending'};}
    if(op==='revoke_learner'){this.role(a,'teacher');requireThat(a.learners.includes(input.learner_id),'FORBIDDEN');const l=this.repo.get('actors',input.learner_id);this.transcriptStore.eraseLearner(l.id);this.repo.put('actors',{...l,active:false,auth_epoch:l.auth_epoch+1});const audio=this.audioStore?.eraseLearner(l.id)??[];return {ok:true,audio_deletion:audio.some(x=>x.state==='failed')?'failed':'deleted'};}
    if(op==='delete_my_data'){this.role(a,'learner');this.preparations.eraseLearner(a.id);const deleted=this.repo.transaction(()=>{this.recordingPermissions.eraseLearner(a.id);this.transcriptStore.eraseLearner(a.id);for(const table of ['attempts','submissions','reports'])for(const row of this.repo.all(table))if(row.learner_id===a.id||table==='reports'&&this.repo.get('submissions',row.submission_id)?.learner_id===a.id){if(table==='submissions'){this.repo.remove('jobs',row.id);this.repo.remove('reports',row.id);}this.repo.remove(table,row.id);}this.repo.put('actors',{...a,active:false,auth_epoch:a.auth_epoch+1,deletion_epoch:a.deletion_epoch+1});return {ok:true};});const audio=this.audioStore?.eraseLearner(a.id)??[];return {...deleted,audio_deletion:audio.some(x=>x.state==='failed')?'failed':'deleted'};}
    throw new Error('NOT_FOUND');
  }
  submissionView(s,a){const job=this.repo.get('jobs',s.id),r=this.repo.get('reports',s.id);return {id:s.id,attempt_id:s.attempt_id,assignment_id:s.assignment_id,state:'submitted',submitted_at:s.submitted_at,report_state:job?.state??'pending',report:r?projectReport(r,a.role):null};}
  async runReports(){if(this.processing)return;this.processing=true;try{for(const job of this.repo.all('jobs').filter(j=>j.state==='pending').slice(0,4)){
    this.repo.put('jobs',{...job,state:'running',tries:job.tries+1});try{const s=this.repo.get('submissions',job.submission_id),attempt=this.repo.get('attempts',s.attempt_id);this.verifyEpoch(attempt);const item=this.repo.get('assignments',s.assignment_id),p=this.publication(item);requireThat(digest(attempt.evidence)===s.evidence_hash,'EVIDENCE_CONFLICT');const report=await this.analyzer.analyze(p.plan,attempt.evidence,attempt);validateReport(report,p.plan,attempt.evidence,attempt);this.repo.transaction(()=>{this.verifyEpoch(attempt);this.publication(item);requireThat(this.repo.get('submissions',s.id)?.evidence_hash===s.evidence_hash,'SOURCE_CHANGED');requireThat(report.plan_hash===s.plan_hash&&report.attempt_id===attempt.id&&report.evidence_hash===s.evidence_hash&&report.grade===null,'INVALID_REPORT');this.repo.put('reports',{...report,id:s.id,submission_id:s.id,learner_id:s.learner_id});this.repo.put('jobs',{...job,state:'complete',tries:job.tries+1});});}catch{if(this.repo.get('jobs',job.id))this.repo.put('jobs',{...job,state:'failed',tries:job.tries+1,error:'REPORT_ANALYSIS_FAILED'});}
  }}finally{this.processing=false;}}
  close(){this.preparations.close();this.audioStore?.close();this.repo.close();}
}
