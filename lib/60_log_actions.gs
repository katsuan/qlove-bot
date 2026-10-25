/**
 * 60_log_actions.gs：機能「📝 記録」の、記録の種類ごとの決まり（シート「log_actions」）
 * 1行に1つの行動（command）。持ち主がシートで直せる（コードを直さずに、新しいコマンドのあつかいを決められる）：
 *   action  … 行動の名前（# coding の coding・# COMMAND の command: battery の battery。小文字）
 *   label   … カードに出す名前（例：充電）。空なら action のまま
 *   icon    … カードに出す絵文字（例：🔋）。空ならふだんの 📝
 *   github  … 持ち主の記録を GitHub に送るか（TRUE／FALSE）
 *   stats   … カードの数（きょう◯件・今週◯件・つづいて◯日）に入れるか
 *   remind  … 決めた時間の知らせで「自分でした記録」として数えるか（移動・出退勤・充電などの自動の記録は FALSE）
 *   enabled … FALSE にすると、この行は使わない（ふつうの記録と同じあつかいにもどる）
 *   type    … 記録の型：time（はじめ〜おわりの時間）・place（時間と移動の距離）・value（時間と数値の差。例：充電の％）・空（ふつうの記録）
 *   daily   … 1日のまとめ方：sum（合計）・count（回数）・max（いちばん大きい）
 *   goal    … その日のまとめがこの数より大きいか同じなら○（つづく・カード・知らせ）。空なら、記録があれば○
 *   unit    … まとめの単位（分・km・%・回）。空なら型から決める
 *   （まとめの計算は 60_log_summary.gs）
 * 行がない行動は、ふつうの記録（GitHub に送る・数に入れる・知らせで数える。# COMMAND の形で来たものは自動の記録）。
 * シートがまだなければ、はじめの行（下の LOG_ACTION_SEEDS_）を入れて作る。言いかえ（ジム → workout）は action_aliases のまま
 * 呼ばれるところ：60_log_github.gs（送るか）・60_log_cards.gs（数・名前）・60_log_reminder.gs（自動の記録か）・60_log_router.gs・60_log_sessions.gs（名前と絵文字）
 */

const LOG_ACTION_COLUMNS_ = ['action', 'label', 'icon', 'github', 'stats', 'remind', 'enabled', 'note', 'type', 'daily', 'goal', 'unit'];
// はじめの行（前の LOgBOT のコードに書いてあった決まりと同じ。type〜unit は「3つの型」のひな形）
const LOG_ACTION_SEEDS_ = [
  ['workout', 'workout', '💪', true, true, true, true, '', '', 'count', 1, '回'],
  ['coding', 'coding', '🧑‍💻', true, true, true, true, '', '', 'count', 1, '回'],
  ['trip', '移動（CarPlay）', '🚙', true, true, false, true, 'CarPlay のショートカットから（# trip）。移動した日に○', 'place', 'sum', '', 'km'],
  ['attendance', '出退勤', '🏢', true, true, false, true, '# attendance start／end。出勤した日に○', 'time', 'sum', '', '分'],
  ['charge', '充電', '🔋', true, true, false, true, '# s charge 20% ／ # e charge 85%。その日に20%以上で○', 'value', 'sum', 20, '%'],
  ['battery', '充電', '🔋', true, true, false, true, '# COMMAND の command: battery。その日に20%以上で○', 'value', 'sum', 20, '%']
];

/** シート「log_actions」（なければ、はじめの行を入れて作る） */
function logActionSheet_() {
  const book = book_();
  let sheet = book.getSheetByName(LOG_SHEET_.actions);
  if (!sheet) {
    sheet = book.insertSheet(LOG_SHEET_.actions);
    sheet.getRange(1, 1, 1 + LOG_ACTION_SEEDS_.length, LOG_ACTION_COLUMNS_.length).setValues([LOG_ACTION_COLUMNS_].concat(LOG_ACTION_SEEDS_)); // qcheck-ok: G1 決まった見出しと、はじめの行だけ
    sheet.setFrozenRows(1);
    return sheet;
  }
  logEnsureActionColumns_(sheet);
  return sheet;
}

/**
 * 前に作ったシート（列が8つ）に、あとから足した列（type・daily・goal・unit）を足す。
 * はじめの行の行動で、足した列が空のものは、ひな形の値を入れる（持ち主が書いた値は変えない）
 */
function logEnsureActionColumns_(sheet) {
  const width = Math.max(sheet.getLastColumn(), 1);
  const head = sheet.getRange(1, 1, 1, width).getValues()[0].map((h) => String(h).trim());
  const missing = LOG_ACTION_COLUMNS_.filter((c) => head.indexOf(c) < 0);
  if (!missing.length) return;
  withLock_(() => {
    sheet.getRange(1, head.length + 1, 1, missing.length).setValues([missing]); // qcheck-ok: G1 決まった見出しだけ
    const all = head.concat(missing);
    const rows = sheet.getLastRow();
    for (let r = 2; r <= rows; r += 1) {
      const action = String(sheet.getRange(r, all.indexOf('action') + 1).getValue() || '').trim();
      const seed = LOG_ACTION_SEEDS_.find((x) => x[0] === action);
      if (!seed) continue;
      missing.forEach((c) => sheet.getRange(r, all.indexOf(c) + 1).setValue(seed[LOG_ACTION_COLUMNS_.indexOf(c)]));
    }
  });
}

/** 行動ごとの決まり { action: { label, icon, github, stats, remind } }（1回の呼び出しで1回だけ読む） */
function logActionRules_() {
  if (memo_.logActionRules) return memo_.logActionRules;
  const out = {};
  try {
    const values = logActionSheet_().getDataRange().getValues();
    const head = (values[0] || []).map((h) => String(h).trim());
    const col = (row, name) => row[head.indexOf(name)];
    const yes = (v, dflt) => (v === '' || v === undefined || v === null ? dflt : isOn_(v));
    values.slice(1).forEach((row) => {
      const action = logNormalizeActionName_(String(col(row, 'action') || '').trim());
      if (!action || !yes(col(row, 'enabled'), true)) return;
      out[action] = {
        label: cleanText_(col(row, 'label'), 30),
        icon: cleanText_(col(row, 'icon'), 4),
        github: yes(col(row, 'github'), true),
        stats: yes(col(row, 'stats'), true),
        remind: yes(col(row, 'remind'), true),
        type: ['time', 'place', 'value'].indexOf(String(col(row, 'type') || '').trim()) >= 0 ? String(col(row, 'type')).trim() : '',
        daily: ['sum', 'count', 'max'].indexOf(String(col(row, 'daily') || '').trim()) >= 0 ? String(col(row, 'daily')).trim() : '',
        goal: col(row, 'goal') === '' || col(row, 'goal') === undefined || col(row, 'goal') === null || !Number.isFinite(Number(col(row, 'goal'))) ? null : Number(col(row, 'goal')),
        unit: cleanText_(col(row, 'unit'), 6)
      };
    });
  } catch (error) {
    // シートが読めなくても、ふつうの記録として続ける
  }
  memo_.logActionRules = out;
  return out;
}

/** その行動の決まり（シートに行がなければ null） */
function logActionRule_(action) {
  return logActionRules_()[logNormalizeActionName_(String(action || ''))] || null;
}

/** その記録（log：action・detail）を GitHub に送るか */
function logActionSendsGithub_(log) {
  const rule = logActionRule_(log && log.action);
  return rule ? rule.github : true;
}

/** その記録を、カードの数（きょう・今週・つづいて）に入れるか */
function logActionCountsStats_(log) {
  const rule = logActionRule_(log && log.action);
  return rule ? rule.stats : true;
}
