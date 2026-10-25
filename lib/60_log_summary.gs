/**
 * 60_log_summary.gs：機能「📝 記録」の、1日のまとめと○（「3つの型」。決まりはシート「log_actions」の type・daily・goal・unit）
 *   型 time  … はじめ〜おわりの時間（分）。出退勤・# s〜# e の作業
 *   型 place … 時間と移動の距離（km）。移動（CarPlay）
 *   型 value … 時間と数値の差（例：充電の％）
 *   型なし   … ふつうの記録（回数。daily が sum なら、+15 などで足した分）
 * その人・その日・その行動の記録から、まとめの数字と、○（まとめ ≥ goal。goal が空なら記録があれば○）を出す。
 * カード・つづく（days の values）・知らせが、ここを読む。前の記録（kind: の行がないもの）も、行動と detail の行から型を決めて読む
 * 呼ばれるところ：60_log_cards.gs（きょうのまとめの行）・60_log_tuzuq.gs（日ごとの数字と○）・60_log_reminder.gs（まだの習慣）
 */

/** その記録の型（detail の kind: の行 → シートの type → 行動と detail の行から） */
function logKindOf_(log) {
  const map = logParseLogDetailMap_(String((log && log.detail) || ''));
  const own = String(map.kind || '').trim();
  if (['time', 'place', 'value'].indexOf(own) >= 0) return own;
  const rule = logActionRule_(log && log.action);
  if (rule && rule.type) return rule.type;
  const action = logNormalizeActionName_(log && log.action);
  if (action === 'trip') return 'place';
  if (action === 'attendance') return 'time';
  if (logNumberOf_(map.value_diff || map.memo_diff) !== null) return 'value';
  if (map.command && map.start && map.end) return 'time';
  return '';
}

/** 「+10%」「12.5km」「-3」などの、はじめの数字（読めなければ null） */
function logNumberOf_(text) {
  const m = String(text === undefined || text === null ? '' : text).match(/[+-]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 1つの記録の数字（型 time：分・place：km・value：差・型なし：分） */
function logValueOf_(log, kind) {
  const map = logParseLogDetailMap_(String((log && log.detail) || ''));
  if (kind === 'place') {
    const km = logNumberOf_(map.distance);
    return km === null ? 0 : km;
  }
  if (kind === 'value') {
    const diff = logNumberOf_(map.value_diff !== undefined ? map.value_diff : map.memo_diff);
    return diff === null ? 0 : diff;
  }
  return Math.max(0, Number(log && log.minutes) || 0);
}

/** まとめの単位（シートの unit → 型から） */
function logSummaryUnit_(rule, kind) {
  if (rule && rule.unit) return rule.unit;
  return { time: '分', place: 'km', value: '%' }[kind] || '回';
}

/**
 * その日の、その行動の記録（logs）のまとめ。{ count, value, done, unit, kind, goal }
 *   daily：sum（合計。型なしなら回数）・count（回数）・max（いちばん大きい）。シートになければ、型があれば sum、なければ count
 */
function logDaySummary_(logs, action) {
  const rule = logActionRule_(action);
  const list = logs || [];
  const kind = list.length ? logKindOf_(list[0]) : (rule && rule.type) || '';
  const daily = (rule && rule.daily) || (kind ? 'sum' : 'count');
  const values = list.map((log) => logValueOf_(log, kind));
  let value = list.length;
  if (daily === 'sum' && kind) value = values.reduce((a, b) => a + b, 0);
  else if (daily === 'sum') value = values.reduce((a, b) => a + b, 0) || list.length;
  else if (daily === 'max') value = values.length ? Math.max(...values) : 0;
  const goal = rule && rule.goal !== null && rule.goal !== undefined ? rule.goal : null;
  const unit = daily === 'count' ? '回' : logSummaryUnit_(rule, kind);
  return { count: list.length, value: Math.round(value * 10) / 10, done: list.length > 0 && (goal === null || value >= goal), unit, kind, goal };
}

/** その記録を数える日：はじめ・おわりのある記録は、はじめの日（detail の start:。日をまたいでも、はじめの日）。ほかは記録した日 */
function logSummaryDay_(log) {
  const start = logParseLogDetailMap_(String((log && log.detail) || '')).start;
  const d = start ? new Date(start) : null;
  return logFormatJST_(d && !isNaN(d.getTime()) ? d : log.date, 'yyyy-MM-dd');
}

/** 記録をまとめて、行動ごと・日ごとに分ける { action: { 'yyyy-MM-dd': [log…] } } */
function logGroupByActionDay_(logs) {
  const out = {};
  (logs || []).forEach((log) => {
    const action = logNormalizeActionName_(log.action);
    const day = logSummaryDay_(log);
    ((out[action] = out[action] || {})[day] = out[action][day] || []).push(log);
  });
  return out;
}

/** まとめの数字を、カード・画面に出す字にする（例：125 分 → 2時間5分・12.3 km・+20%・3回） */
function logFormatSummaryValue_(value, unit) {
  const v = Number(value) || 0;
  if (unit === '分') return logFormatCardMinutes_(v);
  if (unit === '%') return `${v > 0 ? '+' : ''}${v}%`;
  if (unit === '回') return `${v}回`;
  return `${v}${unit}`;
}

/** きょうのまとめの1行（型のある行動・goal のある行動だけ。例：🎯 きょう 2時間5分／目標 30分 ✅）。なければ '' */
function logTodaySummaryLine_(policy, action, now) {
  const rule = logActionRule_(action);
  if (!rule || (!rule.type && (rule.goal === null || rule.goal === undefined))) return '';
  const today = logFormatJST_(now || new Date(), 'yyyy-MM-dd');
  const ids = [String((policy && policy.userId) || '')].concat(policy && policy.isOwner ? logOwnerOldIds_() : []);
  const mine = logGetLogs_().filter((log) => ids.indexOf(String(log.userId || '')) >= 0 && logNormalizeActionName_(log.action) === logNormalizeActionName_(action) && logSummaryDay_(log) === today);
  if (!mine.length) return '';
  const s = logDaySummary_(mine, action);
  const goal = s.goal === null ? '' : `／目標 ${logFormatSummaryValue_(s.goal, s.unit)}`;
  return `🎯 きょう ${logFormatSummaryValue_(s.value, s.unit)}${goal}${s.done ? ' ✅' : ''}`;
}
