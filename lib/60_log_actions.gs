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
 * 行がない行動は、ふつうの記録（GitHub に送る・数に入れる・知らせで数える。# COMMAND の形で来たものは自動の記録）。
 * シートがまだなければ、はじめの行（下の LOG_ACTION_SEEDS_）を入れて作る。言いかえ（ジム → workout）は action_aliases のまま
 * 呼ばれるところ：60_log_github.gs（送るか）・60_log_cards.gs（数・名前）・60_log_reminder.gs（自動の記録か）・60_log_router.gs・60_log_sessions.gs（名前と絵文字）
 */

const LOG_ACTION_COLUMNS_ = ['action', 'label', 'icon', 'github', 'stats', 'remind', 'enabled', 'note'];
// はじめの行（前の LOgBOT のコードに書いてあった決まりと同じ）
const LOG_ACTION_SEEDS_ = [
  ['workout', 'workout', '💪', true, true, true, true, ''],
  ['coding', 'coding', '🧑‍💻', true, true, true, true, ''],
  ['trip', '移動（CarPlay）', '🚙', true, true, false, true, 'CarPlay のショートカットから（# trip）'],
  ['attendance', '出退勤', '🏢', true, true, false, true, '# attendance start／end'],
  ['charge', '充電', '🔋', true, true, false, true, '# s charge 20% ／ # e charge 85%'],
  ['battery', '充電', '🔋', true, true, false, true, '# COMMAND の command: battery']
];

/** シート「log_actions」（なければ、はじめの行を入れて作る） */
function logActionSheet_() {
  const book = book_();
  let sheet = book.getSheetByName(LOG_SHEET_.actions);
  if (!sheet) {
    sheet = book.insertSheet(LOG_SHEET_.actions);
    sheet.getRange(1, 1, 1 + LOG_ACTION_SEEDS_.length, LOG_ACTION_COLUMNS_.length).setValues([LOG_ACTION_COLUMNS_].concat(LOG_ACTION_SEEDS_)); // qcheck-ok: G1 決まった見出しと、はじめの行だけ
    sheet.setFrozenRows(1);
  }
  return sheet;
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
        remind: yes(col(row, 'remind'), true)
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
