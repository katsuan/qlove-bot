/**
 * 60_log_tuzuq.gs：機能「📝 記録」の、つづく（習慣カレンダー。LIFF）からの呼び出し（LOgBOT の 05_features/tuzuq_api.gs・入口の 05_tuzuq.js から）
 * 中身：記録する（record）・記録した日を読む（days）・いまの設定（status。持ち主だけ）・記録したら持ち主に知らせる
 * 約束（何を送り、何が返るか）は q-tuzuq の docs/linelog-api.md。形は { app: "qlove", v: 1, tool: "tuzuq", action, idToken, … }
 *
 * だれか：くらぶボットのツールの受け口（03_tool_api.gs）が、つづくの LIFF の ID トークンを LINE に確かめ、
 * 「🔗 ツールとつなぐ」でひもづけたボットの人（使える人だけ）として呼ぶ。送られてきた userId は使わない（G4）。
 * 前の LIFF_USER_ID・adoptTuzuqOwner（つづくの持ち主の登録）は、くらぶボットのつなぎ方にまとめた。
 * GitHub に書くのは持ち主の記録だけ（GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO があれば）
 * 呼ばれるところ：60_log.gs の tool・60_log_reminder.gs（覚えた習慣）・60_log_settings.gs
 */

const LOG_TUZUQ_SOURCE_ = 'TUZUQ';
const LOG_TUZUQ_TEXT_MAX_ = 60; // つづくの「送る文」の上限（つづく側と同じ）
const LOG_TUZUQ_NOTE_MAX_ = 600; // つないだツールの中身（キロっくの種目・重さ・回数など）の上限
const LOG_TUZUQ_HABITS_MAX_ = 12; // 1回に読む習慣の数（つづくの習慣の上限と同じ）
const LOG_TUZUQ_READ_DAYS_ = 120; // 読むのは、ここ4か月くらい
const LOG_TUZUQ_WRITES_PER_DAY_MAX_ = 30; // 1日に、つづくから書ける数
const LOG_TUZUQ_BACK_DAYS_ = 7; // 前の日のチェックは、7日前まで記録する（それより前は、つづくの中だけ）
// 記録ではない操作の名前（つづくからは書かない）
const LOG_TUZUQ_RESERVED_ACTIONS_ = ['chat', 'trip', 'attendance', 'command', 'test', 'users', 'admin', 'quest', 'report', 'alfred', 's', 'e', '持ち主', 'もちぬし', 'owner'];

/* ==================================================
 * 入口（60_log.gs の tool から）
 * ================================================== */

/** つづくからの呼び出し（record・days・status）を、ボットの人（user）で動かす。{ ok, … } か { ok: false, error } を返す */
function logTuzuqCall_(action, payload, user) {
  try {
    const isOwner = user.role === 'owner';
    // 持ち主の記録として数える ID（ボットの ID・つづくの自動の記録・前の LOgBOT の ID。60_log_users.gs の logOwnerOldIds_）
    const ids = [user.userId, 'sys'].concat(isOwner ? logOwnerOldIds_() : []);
    const policy = { userId: user.userId, userIds: ids, isOwner, canCommitGithub: isOwner, logSource: LOG_TUZUQ_SOURCE_ };
    if (action === 'record') {
      const res = logTuzuqRecord_(policy, { text: payload.text, date: payload.date, note: payload.note });
      if (res && res.ok && res.added && isOwner) logNotifyTuzuqRecord_(payload.text, res.github);
      return res;
    }
    if (action === 'days') return logTuzuqDays_(policy, { texts: payload.texts });
    // いまの設定：持ち主だけ。トークの「# 設定」と同じ中身（見るだけ。鍵などは「あるか」だけ）
    if (action === 'status') return isOwner ? { ok: true, sections: logBuildSettingsSections_() } : { ok: false, error: 'notyou' };
    return { ok: false, error: 'bad' };
  } catch (err) {
    logLibraryError_('tuzuq_failed', err, {});
    return { ok: false, error: 'fail' };
  }
}

/**
 * つづくで記録したことを、持ち主のトークに知らせる（持ち主だけに。新しく入ったときだけ1通）
 * - push なので LINE の月の上限を使う。はじめは知らせない。持ち主が「# 通知 記録 on」で選ぶ（LOG_TUZUQ_NOTIFY）
 * - 知らせに失敗しても、記録はそのまま
 */
function logNotifyTuzuqRecord_(text, github) {
  if (!logTuzuqNotifyOn_() || !ownerUserId_()) return;
  try {
    const line = String(text || '').trim().slice(0, 60);
    const altText = logSeasonal_(`✅ つづくで記録しました：${line}${github ? '（GitHub にも）' : ''}`);
    const card = logBuildInfoCardOrNull_({
      tag: '✅ つづくで記録しました',
      title: line.replace(/^\s*[#＃]\s*/, '') || '記録',
      kind: 'end',
      sections: [{ rows: [github ? '🌱 GitHub にも記録しました' : 'くらぶボットのシートに記録しました'] }],
      buttons: [{ label: '📊 ふりかえり', text: '# REPORT' }, { label: '⚙️ 設定', text: '# 設定' }],
      altText,
    });
    logPushMessages_(ownerUserId_(), [card || { type: 'text', text: altText }]);
  } catch (ex) {
    console.error(`tuzuq notify failed: ${String(ex && ex.message ? ex.message : ex)}`);
  }
}

/**
 * いまの設定（ライブラリが持っている分）。トークの「# 設定」と、つづくの画面の両方で使う
 * - 中身（鍵・ID・URL）は返さない。「あるか」だけ
 * @return {{tuzuqOwner: boolean, github: boolean, habits: string[], admin: {githubToken: boolean}}}
 */
function logGetLogbotStatus_() {
  let github = false;
  try {
    github = !!logResolveGithubTarget_({ canCommitGithub: true });
  } catch (e) {
    github = false;
  }
  const owner = ownerUserId_();
  return {
    tuzuqOwner: Boolean(owner) && readRows_('links').some(r => String(r.userId || '').trim() === owner && String(r.tool || '').includes('つづく')),
    github,
    habits: logReadTuzuqHabits_().map(h => h.t).slice(0, LOG_TUZUQ_HABITS_MAX_),
    admin: { githubToken: !!logGetConfigProperty_('GITHUB_TOKEN') },
  };
}

/* ==================================================
 * 持ち主の登録（GAS エディタで実行する。システム管理者だけ）
 * 1. LINE の中でつづくを開き、この GAS の URL を入れる（「登録を受けつけました」と出る）
 * 2. 10分以内に、GAS エディタで adoptTuzuqOwner を実行する（実行ログに名前が出る。実行する関数は 0_setup.gs）
 * ================================================== */




/* ==================================================
 * 書く・読む
 * ================================================== */

/**
 * つづくの「送る文」（例：# workout、＃💪筋トレ）を、記録の行動名と本文にする
 * - 形がちがう・長すぎる・記録ではない操作なら null
 * @param {string} text
 * @return {{action: string, detail: string}|null}
 */
function logParseTuzuqText_(text, options) {
  if (typeof text !== 'string') return null;
  const raw = text.trim();
  if (!raw || raw.length > LOG_TUZUQ_TEXT_MAX_ || /[\r\n]/.test(raw)) return null;
  // 先頭の # ／ ＃ と空白をとる（LINE の記録と同じ読み方）
  const detail = raw.replace(/^\s*[#＃]\s*/u, '').trim();
  if (!detail) return null;
  // 「s coding」「e coding」（はじめ・おわり）や「+15」（分を足す）は、記録ではない
  if (/^[se]\s+\S+/i.test(detail) || /^[+＋]\d/.test(detail)) return null;
  const action = logNormalizeActionName_(logInferActionFromDetail_(detail));
  if (!/^[\p{L}\p{N}_.-]{1,32}$/u.test(action)) return null;
  // 記録ではない操作は、つづくからは書かない。読むとき（days）は、出退勤・移動・充電などの記録した日も出す（3つの型）
  const reading = options && options.read;
  if (LOG_TUZUQ_RESERVED_ACTIONS_.indexOf(action) >= 0 && !(reading && ['trip', 'attendance'].indexOf(action) >= 0)) return null;
  return { action, detail };
}

/**
 * つないだツールの中身を、本文に入れてよい形に（文字だけ・行と長さに上限。なければ ''）
 * - 中身はその人の端末の記録から、つづくが作る。読めない形なら入れない（記録はする）
 */
function logCleanTuzuqNote_(note) {
  if (typeof note !== 'string') return '';
  const lines = note
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 20);
  return logLimitText_(lines.join('\n'), LOG_TUZUQ_NOTE_MAX_);
}

/** その記録が、この人のものか（policy.userIds のどれか） */
function logIsTuzuqMine_(log, policy) {
  const ids = policy.userIds && policy.userIds.length ? policy.userIds : [policy.userId];
  return ids.indexOf(String(log.userId || '')) >= 0;
}

/**
 * ○を押した習慣を記録する（今日の日本時間の日付だけ）
 * @param {{userId: string, userIds?: string[], canCommitGithub: boolean}} policy 確かめた本人
 * @param {{text: string, date: string}} input
 * @param {{now?: Date}=} options
 * @return {{ok: boolean, error?: string, added?: boolean, date?: string, github?: boolean}}
 */
function logTuzuqRecord_(policy, input, options) {
  const uid = String((policy && policy.userId) || '').trim();
  if (!uid) return { ok: false, error: 'auth' };
  const now = (options && options.now instanceof Date) ? options.now : new Date();
  const today = logFormatJST_(now, 'yyyy-MM-dd');
  const parsed = logParseTuzuqText_(input && input.text);
  if (!parsed) return { ok: false, error: 'bad' };
  // 今日から7日前まで（未来の日・それより前は、つづくの中だけに残す）
  const date = String((input && input.date) || '');
  const back = logDaysBack_(date, today);
  if (back == null || back < 0 || back > LOG_TUZUQ_BACK_DAYS_) return { ok: false, error: 'day' };
  // 前の日は、その日の 12:00 として記録する（草もその日に付く）。本文に「（あとから）」
  const at = back === 0 ? now : new Date(`${date}T12:00:00+09:00`);
  // つないだツールの中身（例：キロっくの種目・重さ・回数）は、2行目から本文に足す（シートと GitHub に残る）
  const note = logCleanTuzuqNote_(input && input.note);
  const detail = `${back === 0 ? parsed.detail : `${parsed.detail}（あとから）`}${note ? `\n${note}` : ''}`;

  const lock = scriptLock_();
  lock.waitLock(20000);
  let saved = null;
  let existing = null;
  try {
    logInvalidateLogsCache_();
    const mineToday = logGetLogs_().filter(log => logIsTuzuqMine_(log, policy) && logFormatJST_(log.date, 'yyyy-MM-dd') === date);
    existing = mineToday.find(log => logNormalizeActionName_(log.action) === parsed.action) || null;
    if (!existing) {
      const fromTuzuq = mineToday.filter(log => log.source === LOG_TUZUQ_SOURCE_).length;
      if (fromTuzuq >= LOG_TUZUQ_WRITES_PER_DAY_MAX_) return { ok: false, error: 'many' };
      saved = logSaveLog_({ ...logCreateLog_({ action: parsed.action, detail, source: LOG_TUZUQ_SOURCE_, userId: uid }), date: at });
    }
  } finally {
    lock.releaseLock();
  }

  // GitHub（シートのあと。つないでいなければ書かない。失敗しても記録は残し、次に同じ○が来たとき・入れなおしで入れる）
  let github = false;
  const target = logResolveGithubTarget_(policy);
  if (target) {
    try {
      logEnsureLogOnGithub_(saved || existing, target, back > 0);
      github = true;
    } catch (err) {
      logLibraryError_('tuzuq_github_failed', err, {});
    }
  }
  return { ok: true, added: !!saved, date, github };
}

/** 「yyyy-MM-dd」が today の何日前か（形がちがえば null。未来はマイナス） */
function logDaysBack_(date, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
  const d = new Date(`${date}T12:00:00+09:00`);
  if (isNaN(d.getTime()) || logFormatJST_(d, 'yyyy-MM-dd') !== date) return null; // 2月30日など
  return Math.round((new Date(`${today}T12:00:00+09:00`) - d) / LOG_DAY_MS);
}

/**
 * 本人の、習慣ごとの記録した日（ここ数か月）
 * @param {{userId: string, userIds?: string[]}} policy 確かめた本人
 * @param {{texts: string[]}} input つづくの習慣の「送る文」（12こまで）
 * @param {{now?: Date}=} options
 * @return {{ok: boolean, error?: string, days?: string[][], today?: string, github?: boolean}}
 *   days[i] は texts[i] の行動を記録した日（yyyy-MM-dd、古い順）。読めない文は []
 */
function logTuzuqDays_(policy, input, options) {
  const uid = String((policy && policy.userId) || '').trim();
  if (!uid) return { ok: false, error: 'auth' };
  const texts = input && Array.isArray(input.texts) ? input.texts : null;
  if (!texts || texts.length > LOG_TUZUQ_HABITS_MAX_) return { ok: false, error: 'bad' };
  const now = (options && options.now instanceof Date) ? options.now : new Date();
  const since = new Date(now.getTime() - LOG_TUZUQ_READ_DAYS_ * LOG_DAY_MS);

  // 行動ごと・日ごとの記録 → その日のまとめ（60_log_summary.gs）。○は「まとめ ≥ goal」の日（goal がなければ記録がある日）
  const byAction = logGroupByActionDay_(logGetLogs_().filter(log => logIsTuzuqMine_(log, policy) && log.date >= since && log.date <= now));
  const days = [];
  const values = []; // 日ごとの数字（型のある行動だけ。例：{ "2026-10-25": 95 }）。前のつづくは読まないだけ
  const units = [];
  texts.forEach(text => {
    const parsed = logParseTuzuqText_(text, { read: true });
    const byDay = parsed ? byAction[parsed.action] || {} : {};
    const rule = parsed ? logActionRule_(parsed.action) : null;
    const done = [];
    const nums = {};
    let unit = '';
    Object.keys(byDay).sort().forEach(day => {
      const s = logDaySummary_(byDay[day], parsed.action);
      if (s.done) done.push(day);
      if (rule && rule.type) {
        nums[day] = s.value;
        unit = s.unit;
      }
    });
    days.push(done);
    values.push(nums);
    units.push(unit);
  });
  logRememberTuzuqHabits_(texts);
  return { ok: true, days, values, units, today: logFormatJST_(now, 'yyyy-MM-dd'), github: !!logResolveGithubTarget_(policy) };
}

/**
 * 持ち主がつづくで見ている習慣（行動名と送る文）を覚える。記録がない日の知らせで「まだの習慣」を出すため
 * - 覚えるのは文だけ（ID は入れない）。変わったときだけ書く
 */
const LOG_TUZUQ_HABITS_PROP_ = 'LOG_TUZUQ_HABITS';
/** つづくで見ている習慣（送る文）を覚える（ID は入れない） */
function logRememberTuzuqHabits_(texts) {
  const seen = {};
  const habits = [];
  (texts || []).forEach(text => {
    const parsed = logParseTuzuqText_(text);
    if (!parsed || seen[parsed.action]) return;
    seen[parsed.action] = true;
    habits.push({ a: parsed.action, t: String(text).trim() });
  });
  const props = props_();
  const next = JSON.stringify(habits.slice(0, LOG_TUZUQ_HABITS_MAX_));
  if (props.getProperty(LOG_TUZUQ_HABITS_PROP_) !== next) props.setProperty(LOG_TUZUQ_HABITS_PROP_, next);
}

/** 覚えておいた、つづくで見ている習慣を読む */
function logReadTuzuqHabits_() {
  try {
    const list = JSON.parse(props_().getProperty(LOG_TUZUQ_HABITS_PROP_) || '[]');
    return Array.isArray(list) ? list.filter(h => h && typeof h.a === 'string' && typeof h.t === 'string') : [];
  } catch (e) {
    return [];
  }
}

/**
 * その記録が GitHub のその日の jsonl になければ足す（同じ ID は2回入れない）
 */
function logEnsureLogOnGithub_(log, target, backdated) {
  if (!log || !String(log.ID || '').trim()) return;
  // 前の日の分は、コミットの日時をその日にする（草がその日に付く。入れなおしと同じ）
  const identity = backdated ? logFetchGithubCommitIdentity_(target.token) : null;
  logWriteLogToGithub_(log, target, 'ensure', identity);
}
