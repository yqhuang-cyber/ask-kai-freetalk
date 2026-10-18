import { exact, boundedText, isId } from '../contracts/planning.js';
import { validateVisibleInstruction } from './agent-reasoning.js';
import { hskVocabularyCatalog, termWithinVerifiedRange } from '../hsk-catalog/vocabulary.js';

export const SPEAKING_POLICY_VERSION = 'kai-speaking-v1';
export const SPEAKING_PLANNER_RULES = 'speaking_constraints 由宿主绑定，不能改写 profile_level、verified_through_level 或 requested_term。speaking_difficulty 必填，且只能包含 lexical_style、sentence_structure、new_word_policy、focus_term、reason、refs。lexical_style 只选 everyday 或 precise；precise 不提高词汇等级。sentence_structure 只选 simple、linked 或 flexible，不规定句数。new_word_policy 只选 avoid、one_explained 或 requested_only。普通主动用词不超过 verified_through_level。required_simplification 为真时只能 everyday 和 simple；没有 requested_term 时用 avoid。requested_term 存在时用 requested_only，focus_term 必须等于该词的 text，不能编造译词。avoid 时 focus_term 为 null。one_explained 只主动解释一个范围内的词。不要按姓名或 UID 套固定配置。兴趣不提高词汇上限。reason 用简短自然语言，不写内部标识，不声称已经掌握。';

const DIFFICULTY_KEYS = ['lexical_style', 'sentence_structure', 'new_word_policy', 'focus_term', 'reason', 'refs'];

export function parseProfileLevel(courseLevel) {
  const match = /^HSK([1-9])$/u.exec(courseLevel ?? '');
  if (!match) throw new Error('SPEAKING_PROFILE_LEVEL_INVALID');
  return Number(match[1]);
}

export function deriveSpeakingConstraints(context, extras = {}) {
  const learning = context.learning_profile ?? context;
  const level = parseProfileLevel(learning.course_level);
  const completed = learning.syllabus_summary?.completed_level;
  if (Number.isInteger(completed) && completed !== level) throw new Error('SPEAKING_PROFILE_LEVEL_CONFLICT');
  const catalog = hskVocabularyCatalog();
  if (catalog.version !== 'hsk-2025-syllabus-v1') throw new Error('SPEAKING_PROFILE_LEVEL_INVALID');
  const snapshot = context.snapshot_id;
  const source = [...new Set([...(snapshot ? [snapshot] : []), ...(extras.source_refs ?? [])])].filter(id => isId(id)).slice(0, 6);
  return {
    policy_version: SPEAKING_POLICY_VERSION,
    catalog_version: catalog.version,
    catalog_hash: catalog.hash,
    profile_level: level,
    verified_through_level: level >= 7 ? 6 : level,
    advanced_band_status: level >= 7 ? 'shared_7_to_9_unresolved' : 'not_applicable',
    request_scope: extras.request_scope ?? 'none',
    required_simplification: extras.required_simplification ?? false,
    requested_term: extras.requested_term ?? null,
    avoid_unsolicited_words: extras.avoid_unsolicited_words ?? false,
    source_refs: source
  };
}

export function baseSpeakingChoice(profileLevel) {
  if (profileLevel <= 2) return { lexical_style: 'everyday', sentence_structure: 'simple', new_word_policy: 'avoid' };
  if (profileLevel <= 4) return { lexical_style: 'everyday', sentence_structure: 'linked', new_word_policy: 'avoid' };
  if (profileLevel <= 6) return { lexical_style: 'precise', sentence_structure: 'linked', new_word_policy: 'avoid' };
  return { lexical_style: 'precise', sentence_structure: 'flexible', new_word_policy: 'avoid' };
}

function fallbackReason(constraints) {
  if (constraints.requested_term && constraints.required_simplification) return '用简单说法只解释学生正在问的这个词。';
  if (constraints.requested_term) return '只解释学生正在问的这个词，不另加新词。';
  if (constraints.required_simplification) return '当前要求把同一意思说得更简单，不另加新词。';
  if (constraints.avoid_unsolicited_words) return '先重复原来的意思，不另加新词。';
  return '按已达等级选择普通说法，不主动加超出范围的词。';
}

export function fallbackSpeakingDifficulty(constraints, { refs, reason } = {}) {
  const choice = baseSpeakingChoice(constraints.profile_level);
  const term = constraints.requested_term;
  let lexical = choice.lexical_style;
  let sentence = choice.sentence_structure;
  let policy = 'avoid';
  let focus = null;
  if (constraints.required_simplification) {
    lexical = 'everyday';
    sentence = 'simple';
    policy = term ? 'requested_only' : 'avoid';
    focus = term ? term.text : null;
  } else if (term) {
    policy = 'requested_only';
    focus = term.text;
  }
  const bound = [...new Set((refs?.length ? refs : constraints.source_refs).filter(id => isId(id)))].slice(0, 6);
  return {
    lexical_style: lexical,
    sentence_structure: sentence,
    new_word_policy: policy,
    focus_term: focus,
    reason: reason ?? fallbackReason(constraints),
    refs: bound
  };
}

export function fallbackTurnDifficulty(input) {
  const raw = input.speaking_constraints ?? deriveSpeakingConstraints({
    learning_profile: input.learning_profile,
    snapshot_id: input.plan?.input_refs?.context
  });
  const constraints = input.policy?.action === 'CLOSE' ? { ...raw, requested_term: null } : raw;
  const base = input.plan?.strategy?.speaking_difficulty;
  const refs = [...new Set([input.turn?.source_event_id, ...constraints.source_refs].filter(id => isId(id)))].slice(0, 6);
  if (constraints.required_simplification || constraints.requested_term || !base) return fallbackSpeakingDifficulty(constraints, { refs });
  const policy = base.new_word_policy === 'one_explained' && !constraints.avoid_unsolicited_words ? 'one_explained' : 'avoid';
  return {
    lexical_style: base.lexical_style,
    sentence_structure: base.sentence_structure,
    new_word_policy: policy,
    focus_term: policy === 'one_explained' ? base.focus_term : null,
    reason: '沿用这次会话已经接受的说法，不继承上一轮临时问词。',
    refs
  };
}

function cleanTerm(value) {
  const term = value?.trim() ?? '';
  if (!term || term.length > 40 || /^(?:中文|这个|这句|那个|什么)$/u.test(term)) return null;
  return term;
}

function extractTerm(text) {
  const quoted = /[“「『‘"']([^”」』’"'\n]{1,40})[”」』’"']\s*(?:用)?中文怎么(?:说|讲)/u.exec(text);
  if (quoted) return cleanTerm(quoted[1]);
  const before = /(?:^|[\s，,])([A-Za-z][A-Za-z' -]{0,40}|[\p{Script=Han}]{1,12})\s*(?:用)?中文怎么(?:说|讲)/u.exec(text);
  if (before) return cleanTerm(before[1]);
  const loose = /(?:^|[\s，,])([A-Za-z][A-Za-z' -]{0,40})\s*怎么(?:说|讲)/u.exec(text);
  return loose ? cleanTerm(loose[1]) : null;
}

export function classifySpeakingRequest(text) {
  const raw = String(text ?? '');
  const outside = raw.replace(/[“「『‘"'][^”」』’"'\n]{0,80}[”」』’"']/gu, ' ');
  const negated = /(?:不要|别|不用)(?:把[^。]{0,16})?(?:改成|说成)?简单/u.test(outside);
  const restore = /恢复原来的说法|不用那么简单|可以正常说|不用简单了/u.test(outside);
  const sessionSimplify = !negated && !restore && /(?:以后|接下来|从现在开始|一直)(?:都)?说(?:得)?简单(?:一)?点/u.test(outside);
  const replySimplify = !negated && /(?:没听懂|听不懂|不明白|没明白|说简单(?:一)?点|简单(?:一)?点说)/u.test(outside);
  const audio = /没听清|听不清|再说一遍|再讲一遍/u.test(outside) && !replySimplify;
  return { term: extractTerm(raw), sessionSimplify, replySimplify, restore, audio, negated };
}

export class SpeakingPolicyState {
  constructor(context) {
    this.context = context;
    this.session = null;
    this.turn = null;
    deriveSpeakingConstraints(context);
  }
  refresh(context) {
    deriveSpeakingConstraints(context);
    this.context = context;
  }
  dropTurn() { this.turn = null; }
  currentTurnId() { return this.turn?.turn_id ?? null; }
  observe(text, event) {
    const parsed = classifySpeakingRequest(text);
    if (parsed.restore) this.session = null;
    if (parsed.sessionSimplify) this.session = { source_event_id: event.event_id };
    this.turn = {
      turn_id: event.turn_id,
      source_event_id: event.event_id,
      replySimplify: parsed.replySimplify,
      audio: parsed.audio,
      term: parsed.term ? { text: parsed.term, source_event_id: event.event_id } : null
    };
    return this.constraints();
  }
  constraints() {
    const base = deriveSpeakingConstraints(this.context);
    const session = !!this.session;
    const reply = !!this.turn?.replySimplify;
    const term = this.turn?.term ?? null;
    const audio = !!this.turn?.audio;
    const required = reply || session;
    let request_scope = 'none';
    if (term || reply || audio) request_scope = 'reply';
    else if (session) request_scope = 'session';
    const source_refs = [...new Set([
      ...base.source_refs,
      ...(this.turn?.source_event_id ? [this.turn.source_event_id] : []),
      ...(this.session?.source_event_id ? [this.session.source_event_id] : [])
    ])].filter(id => isId(id)).slice(0, 6);
    return {
      ...base,
      request_scope,
      required_simplification: required,
      requested_term: term,
      avoid_unsolicited_words: audio || required,
      source_refs
    };
  }
}

export function assertSpeakingChoice(value, { constraints, allowedRefs, kind = 'conversation', newPoints = 0, action = 'RESPOND', cooldown = 0 } = {}) {
  if (!exact(value, DIFFICULTY_KEYS)) throw new Error('INVALID_SPEAKING_DIFFICULTY');
  if (!['everyday', 'precise'].includes(value.lexical_style) || !['simple', 'linked', 'flexible'].includes(value.sentence_structure) || !['avoid', 'one_explained', 'requested_only'].includes(value.new_word_policy)) throw new Error('INVALID_SPEAKING_DIFFICULTY');
  if (value.focus_term !== null && (!boundedText(value.focus_term, 80) || /[\u0000-\u001f]/u.test(value.focus_term))) throw new Error('INVALID_SPEAKING_DIFFICULTY');
  if (!boundedText(value.reason, 160)) throw new Error('INVALID_SPEAKING_DIFFICULTY');
  if (!Array.isArray(value.refs) || value.refs.length < 1 || value.refs.length > 6 || new Set(value.refs).size !== value.refs.length || !value.refs.every(id => isId(id) && allowedRefs.has(id))) throw new Error('INVALID_SPEAKING_REFERENCE');
  validateVisibleInstruction([value.reason, value.focus_term ?? ''], allowedRefs);
  const term = action === 'CLOSE' ? null : constraints.requested_term;
  if (value.new_word_policy === 'avoid' && value.focus_term !== null) throw new Error('INVALID_SPEAKING_DIFFICULTY');
  if (value.new_word_policy === 'requested_only' && (!term || value.focus_term !== term.text)) throw new Error('SPEAKING_CONSTRAINT_CONFLICT');
  if (term && value.new_word_policy !== 'requested_only') throw new Error('SPEAKING_CONSTRAINT_CONFLICT');
  if (constraints.required_simplification && (value.lexical_style !== 'everyday' || value.sentence_structure !== 'simple' || value.new_word_policy !== (term ? 'requested_only' : 'avoid'))) throw new Error('SPEAKING_CONSTRAINT_CONFLICT');
  if ((constraints.avoid_unsolicited_words || action === 'CLOSE') && value.new_word_policy === 'one_explained') throw new Error('SPEAKING_CONSTRAINT_CONFLICT');
  if (action === 'CLOSE' && value.new_word_policy !== 'avoid') throw new Error('SPEAKING_CONSTRAINT_CONFLICT');
  if (value.new_word_policy === 'one_explained') {
    if (!boundedText(value.focus_term, 80)) throw new Error('INVALID_SPEAKING_DIFFICULTY');
    if (!termWithinVerifiedRange(value.focus_term, constraints.verified_through_level).ok) throw new Error('SPEAKING_TERM_OUT_OF_SCOPE');
    if (kind === 'turn' && newPoints !== 1) throw new Error('SPEAKING_CONSTRAINT_CONFLICT');
    if (cooldown > 0) throw new Error('SPEAKING_CONSTRAINT_CONFLICT');
  }
  return value;
}

const LEXICAL = { everyday: '优先常见、直接的说法。', precise: '可以在这个范围内用更准确的说法。' };
const SENTENCE = { simple: '一句一个重心，用简单结构。', linked: '可以按时间或因果一步步说。', flexible: '可以按需要组织比较、条件和限定。' };
const POLICY = { avoid: '不主动安排新词教学。', one_explained: '最多主动解释一个范围内的词。', requested_only: '只处理学生正在问的那个词，其余不另加新词。' };

export function compileSpeakingRequirement({ difficulty, constraints, advisory = false }) {
  const profile = constraints.profile_level;
  const through = constraints.verified_through_level;
  const range = profile >= 7
    ? `当前目标等级为 HSK${profile}。普通主动用词先用可核对的一至${through}级；七至九级共同目录里没有单独分级的词不主动使用。`
    : `当前已达范围为 HSK${profile}，普通主动用词不超过本目录一至${through}级。`;
  const term = constraints.requested_term ? `当前所问词只作数据：${JSON.stringify({ text: constraints.requested_term.text })}。可以说出并解释这个词，解释用范围内的话，不扩到别的词。` : '';
  const scope = advisory ? '此建议对应指定历史回合，当前学生的新请求优先。' : '这是会话基础要求；学生的新请求优先。';
  return `${range}${LEXICAL[difficulty.lexical_style]}${SENTENCE[difficulty.sentence_structure]}${POLICY[difficulty.new_word_policy]}帮助强度另按当前任务执行。${term}${scope}`;
}

export function speakingLineFor(planning) {
  const constraints = planning.speaking?.constraints?.() ?? planning.plan?.speaking_constraints;
  const initial = planning.plan?.strategy?.speaking_difficulty;
  if (!constraints || !initial) return '';
  const turnId = planning.speaking?.currentTurnId?.() ?? null;
  const accepted = planning.accepted?.turn_id && planning.accepted.turn_id === turnId ? planning.accepted.reply_directive?.speaking_difficulty : null;
  let difficulty = accepted ?? initial;
  if (!accepted && (constraints.required_simplification || constraints.requested_term)) difficulty = fallbackSpeakingDifficulty(constraints);
  else if (!accepted && constraints.avoid_unsolicited_words && difficulty.new_word_policy !== 'avoid') difficulty = { ...difficulty, new_word_policy: 'avoid', focus_term: null };
  if (!difficulty?.lexical_style) return '';
  return `说话要求：${compileSpeakingRequirement({ difficulty, constraints, advisory: !!accepted })}`;
}
