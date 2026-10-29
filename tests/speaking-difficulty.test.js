import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnerFixture, SPORTS_RESOURCE } from '../apps/hskai-mock/src/planning-fixtures.js';
import { accountContext, MOCK_LEARNERS } from '../apps/hskai-mock/src/learner-accounts.js';
import { ConversationInitializer, conservativeConversation } from '../packages/agent-core/conversation-initializer.js';
import { PlanningState, conservativeTurn } from '../packages/agent-core/planning-state.js';
import { validateConversation, validateTurn } from '../packages/agent-core/plan-validator.js';
import { fullContractMessages } from '../packages/agent-core/planner-full-contract.js';
import { draftSchema, plannerMessages } from '../packages/agent-core/planner-draft.js';
import { compileContextSnapshot } from '../packages/agent-core/context-snapshot.js';
import { termWithinVerifiedRange } from '../packages/hsk-catalog/vocabulary.js';
import {
  SpeakingPolicyState, deriveSpeakingConstraints, fallbackSpeakingDifficulty, assertSpeakingChoice, classifySpeakingRequest, compileSpeakingRequirement
} from '../packages/agent-core/speaking-policy.js';

const identity = learner => ({ owner_id: learner.owner_id, learner_id: learner.learner_id, scopes: ['session:create', 'context:read'], authorization_until: Date.now() + 60000 });
const contextFor = name => accountContext(identity(MOCK_LEARNERS.find(learner => learner.name === name)));
const choice = (overrides, ref) => ({ lexical_style: 'everyday', sentence_structure: 'simple', new_word_policy: 'avoid', focus_term: null, reason: '按当前需要选择说法。', refs: [ref], ...overrides });

test('vocabulary ceiling follows completed level and keeps the shared advanced band unresolved', () => {
  const levels = { Alex: [1, 1, 'not_applicable'], Maya: [3, 3, 'not_applicable'], Dao: [1, 1, 'not_applicable'], Leo: [5, 5, 'not_applicable'], Nina: [7, 6, 'shared_7_to_9_unresolved'] };
  for (const [name, [profile, verified, band]] of Object.entries(levels)) {
    const constraints = deriveSpeakingConstraints(contextFor(name));
    assert.equal(constraints.profile_level, profile);
    assert.equal(constraints.verified_through_level, verified);
    assert.equal(constraints.advanced_band_status, band);
    assert.equal(constraints.catalog_version, 'hsk-2025-syllabus-v1');
  }
  assert.equal(termWithinVerifiedRange('游泳', 1).ok, false);
  assert.equal(termWithinVerifiedRange('游泳', 3).ok, true);
  assert.equal(termWithinVerifiedRange('跑龙套', 6).ok, false);
  assert.equal(termWithinVerifiedRange('自造词', 6).reason, 'unknown');
  assert.throws(() => deriveSpeakingConstraints({ learning_profile: { course_level: 'unknown' } }), /SPEAKING_PROFILE_LEVEL_INVALID/);
  assert.throws(() => deriveSpeakingConstraints({ learning_profile: { course_level: 'HSK1', syllabus_summary: { completed_level: 3 } } }), /SPEAKING_PROFILE_LEVEL_CONFLICT/);
});

test('fallback follows level bands and not learner names', () => {
  for (const [level, expected] of [[1, 'simple'], [3, 'linked'], [5, 'linked'], [7, 'flexible']]) {
    const constraints = deriveSpeakingConstraints({ learning_profile: { course_level: `HSK${level}` }, snapshot_id: 'ctx-level' });
    const difficulty = fallbackSpeakingDifficulty(constraints);
    assert.equal(difficulty.sentence_structure, expected);
    assert.equal(difficulty.new_word_policy, 'avoid');
    assert.equal(JSON.stringify(difficulty).includes('Alex'), false);
  }
});

test('current requests tighten without becoming a permanent profile or a quoted command', () => {
  const state = new SpeakingPolicyState(contextFor('Nina'));
  const event = (id, text) => ({ event_id: id, turn_id: id, payload: { text } });
  state.observe('刚才那句没听懂，说简单一点。', event('turn-repair', ''));
  assert.equal(state.constraints().required_simplification, true);
  assert.equal(state.constraints().request_scope, 'reply');
  state.observe('你今天忙吗？', event('turn-next', ''));
  assert.equal(state.constraints().required_simplification, false);
  state.observe('接下来都说简单一点。', event('turn-session', ''));
  state.observe('比赛结果公平吗？', event('turn-later', ''));
  assert.equal(state.constraints().request_scope, 'session');
  assert.equal(state.constraints().required_simplification, true);
  state.observe('现在恢复原来的说法吧。', event('turn-restore', ''));
  assert.equal(state.constraints().required_simplification, false);
  const quoted = new SpeakingPolicyState(contextFor('Nina'));
  quoted.observe('他说‘以后都说简单点’，我不用改。', event('turn-quote', ''));
  assert.equal(quoted.constraints().required_simplification, false);
  quoted.observe('不要把我的话改成简单中文。', event('turn-no', ''));
  assert.equal(quoted.constraints().required_simplification, false);
  quoted.observe('‘swimming’中文怎么说', event('turn-term', ''));
  assert.equal(quoted.constraints().requested_term.text, 'swimming');
  assert.equal(classifySpeakingRequest('声音没听清，麻烦再说一遍。').audio, true);
  assert.equal(classifySpeakingRequest('声音没听清，麻烦再说一遍。').replySimplify, false);
});

test('host rejects a looser choice, an out-of-range active word, and a forged level', () => {
  const context = contextFor('Alex');
  const constraints = deriveSpeakingConstraints(context);
  const allowed = new Set([context.snapshot_id]);
  assert.throws(() => assertSpeakingChoice(choice({ lexical_style: 'precise', sentence_structure: 'flexible', new_word_policy: 'one_explained', focus_term: '游泳' }, context.snapshot_id), { constraints: { ...constraints, required_simplification: true, avoid_unsolicited_words: true }, allowedRefs: allowed }), /SPEAKING_CONSTRAINT_CONFLICT|SPEAKING_TERM_OUT_OF_SCOPE/);
  assert.throws(() => assertSpeakingChoice(choice({ new_word_policy: 'one_explained', focus_term: '游泳' }, context.snapshot_id), { constraints, allowedRefs: allowed }), /SPEAKING_TERM_OUT_OF_SCOPE/);
  assert.throws(() => assertSpeakingChoice({ ...choice({}, context.snapshot_id), profile_level: 3 }, { constraints, allowedRefs: allowed }), /INVALID_SPEAKING_DIFFICULTY/);
  const maya = contextFor('Maya');
  assertSpeakingChoice(choice({ sentence_structure: 'linked', new_word_policy: 'one_explained', focus_term: '游泳' }, maya.snapshot_id), { constraints: deriveSpeakingConstraints(maya), allowedRefs: new Set([maya.snapshot_id]), kind: 'turn', newPoints: 1 });
  const asked = { ...constraints, requested_term: { text: 'swimming', source_event_id: 'term-1' } };
  assertSpeakingChoice(choice({ new_word_policy: 'requested_only', focus_term: 'swimming' }, context.snapshot_id), { constraints: asked, allowedRefs: allowed });
});

test('free plans carry speaking difficulty through fallback, prompts, and the voice instruction', async () => {
  const learner = { owner_id: 'owner', learner_id: 'learner', scopes: ['session:create', 'context:read'], authorization_until: Date.now() + 60000 };
  const port = { read: async () => learnerFixture(learner), getResource: async () => { throw new Error('CURRICULUM_FORBIDDEN'); } };
  const prepared = await new ConversationInitializer({ port, planner: null }).prepare({ mode: 'free' }, learner);
  const difficulty = prepared.plan.strategy.speaking_difficulty;
  assert.equal(prepared.plan.schema_version, 'conversation-plan-v3');
  assert.equal(prepared.plan.planner_kind, 'rule');
  assert.equal(difficulty.lexical_style, 'everyday');
  assert.equal(difficulty.sentence_structure, 'simple');
  assert.equal(prepared.plan.speaking_constraints.verified_through_level, 1);
  assert.equal(prepared.plan.primary_goal_id, null);
  const state = new PlanningState({ plan: { ...prepared.plan, session_id: 's' }, context: prepared.context, resource: null, planner: { planTurn: async input => ({ ...conservativeTurn(input), reply_directive: { ...conservativeTurn(input).reply_directive, speaking_difficulty: choice({ lexical_style: 'precise', sentence_structure: 'flexible' }, input.turn.source_event_id) } }) } });
  const repair = { version: 1, event_id: 'repair-1', session_id: 's', turn_id: 'repair', seq: 1, at_ms: 0, type: 'user.final', payload: { text: '刚才那句没听懂，说简单一点。' } };
  const accepted = await state.acceptInput(repair, { action: 'RESPOND', reason: 'student_understanding_help', teaching_paused: false, teaching_cooldown: 0, clarification_pending: false }, { policy_version: 'kai-language-v6' });
  assert.equal(accepted.planner_kind, 'rule');
  assert.equal(accepted.reply_directive.speaking_difficulty.lexical_style, 'everyday');
  assert.equal(accepted.reply_directive.speaking_difficulty.sentence_structure, 'simple');
  assert.equal(accepted.schema_version, 'turn-plan-v2');
  const term = { ...repair, event_id: 'term-1', turn_id: 'term', payload: { text: 'swimming 中文怎么说？' } };
  const answered = await state.acceptInput(term, { action: 'RESPOND', reason: 'student_requested_help', teaching_paused: false, teaching_cooldown: 0, clarification_pending: false }, { policy_version: 'kai-language-v6' });
  assert.equal(answered.reply_directive.speaking_difficulty.new_word_policy, 'requested_only');
  assert.equal(answered.reply_directive.speaking_difficulty.focus_term, 'swimming');
  const prompt = fullContractMessages('conversation', { entry: { mode: 'free' }, speaking_constraints: prepared.plan.speaking_constraints });
  assert.match(prompt[0].content, /speaking_difficulty/);
  assert.equal(fullContractMessages('conversation', { entry: { mode: 'topic' } })[0].content.includes('speaking_difficulty'), false);
  assert.ok(draftSchema('turn', { plan: { mode: 'free' } }).properties.speaking_difficulty);
  assert.equal(draftSchema('turn', { plan: { mode: 'topic' } }).properties.speaking_difficulty, undefined);
  assert.match(plannerMessages('turn', { plan: prepared.plan, turn: { source_event_id: 'term-1' } })[0].content, /verified_through_level/);
  const line = compileSpeakingRequirement({ difficulty, constraints: prepared.plan.speaking_constraints });
  assert.match(line, /HSK1/);
  assert.equal(line.includes(prepared.plan.speaking_constraints.catalog_hash), false);
  const snapshot = compileContextSnapshot({ sessionId: 's', version: 1, mode: 'free', stage: 'warmup', speechInstructions: '慢。', languageInstructions: '中文。', language: { policy_version: 'kai-language-v6' }, teachingContext: '无。', memory: [], planning: state });
  assert.match(snapshot.instructions, /说话要求/);
  assert.match(snapshot.instructions, /服从当前说话要求/);
  const topic = conservativeConversation({ mode: 'topic', topic_id: 'sports' }, learnerFixture(learner), SPORTS_RESOURCE);
  assert.equal(topic.strategy.speaking_difficulty, undefined);
  assert.throws(() => validateConversation({ ...topic, primary_goal_id: null, key_points: [] }, { entry: { mode: 'free' }, context: learnerFixture(learner) }), /INVALID_SPEAKING_DIFFICULTY/);
  assert.throws(() => validateTurn({ ...conservativeTurn({ plan: prepared.plan, turn: { source_event_id: 'repair-1' }, policy: { action: 'RESPOND', teaching_paused: false }, speaking_constraints: prepared.plan.speaking_constraints }), reply_directive: { task: '重述', support_level: 'none', new_points: 0, budget_ref: accepted.reply_directive.budget_ref } }, { plan: prepared.plan, input: { text: '没听懂', source_event_id: 'repair-1', expires_at: Date.now() + 1000 }, policy: { action: 'RESPOND', teaching_paused: false, teaching_cooldown: 0 }, allowedRefs: new Set(['repair-1', learnerFixture(learner).snapshot_id]), context: learnerFixture(learner), speakingConstraints: { ...prepared.plan.speaking_constraints, required_simplification: true, avoid_unsolicited_words: true } }), /INVALID_SPEAKING_DIFFICULTY/);
});
