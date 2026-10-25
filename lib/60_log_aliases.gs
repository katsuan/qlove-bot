/**
 * 60_log_aliases.gs：機能「📝 記録」の行動の言いかえの表（LOgBOT の 03_record/action_aliases.gs から）
 * 中身：言いかえの表（ジム → workout など）の読み書き・行動の名前をそろえる
 * 呼ばれる（LOgBOT のときのファイル名）：記録するとき（text_parser の inferActionFromDetail_）・クエスト
 */

const LOG_ACTION_ALIAS_COLUMNS_ = ['action', 'alias', 'enabled'];

/** 言いかえの表（action_aliases）のシートを返す。なければ作って、ふだんの言いかえを入れる */
function logGetActionAliasSheet_() {
  const ss = book_();
  let sheet = ss.getSheetByName(LOG_SHEET_.aliases);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET_.aliases);
    // qcheck-ok: G1 決まった見出しだけ
    sheet.appendRow(LOG_ACTION_ALIAS_COLUMNS_);
    logSeedDefaultActionAliases_(sheet);
  } else if (sheet.getLastRow() === 0) {
    // qcheck-ok: G1 決まった見出しだけ
    sheet.appendRow(LOG_ACTION_ALIAS_COLUMNS_);
    logSeedDefaultActionAliases_(sheet);
  }
  return sheet;
}

/** 言いかえの表に、ふだんの言いかえ（ジム・筋トレ → workout など）を入れる */
function logSeedDefaultActionAliases_(sheet) {
  const rows = [
    ['workout', 'workout', true],
    ['workout', 'ジム', true],
    ['workout', '筋トレ', true],
    ['workout', 'マッスル', true],
    ['workout', 'トレーニング', true],
    ['workout', '💪', true],
    ['workout', '🤜', true],
    ['workout', '🤛', true],
    ['coding', 'codeing', true],
    ['coding', 'coding', true],
  ];
  // qcheck-ok: G1 コードに書いた決まった文字だけ
  rows.forEach(r => sheet.appendRow(r));
}

/** 言いかえの表を { 行動: [言いかえ…] } にして返す（使わない行は外す） */
function logGetActionAliasMap_() {
  const sheet = logGetActionAliasSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return {};
  const map = {};
  for (let i = 1; i < values.length; i += 1) {
    const row = values[i];
    const action = String(row[0] || '').trim().toLowerCase();
    const alias = String(row[1] || '').trim().toLowerCase();
    const enabled = String(row[2] || 'true').toLowerCase() !== 'false';
    if (!action || !alias || !enabled) continue;
    if (!map[action]) map[action] = [];
    map[action].push(alias);
  }
  return map;
}

/** 行動の名前をそろえる（小文字に。前の書きまちがい codeing は coding に） */
function logNormalizeActionName_(action) {
  const a = String(action || '').trim().toLowerCase();
  if (a === 'codeing') return 'coding';
  return a;
}

/**
 * 記録の本文（# のあと）から、行動名を決める（同義語テーブルで言いかえをそろえる）
 */
function logInferActionFromDetail_(detail) {
  const raw = String(detail || '').trim().toLowerCase();
  if (!raw) return 'chat';
  // 同義語テーブル（action_aliases）で吸収
  const aliasMap = logGetActionAliasMap_();
  const normalizedRaw = raw.replace(/\s+/g, '');
  const actions = Object.keys(aliasMap);
  for (let i = 0; i < actions.length; i += 1) {
    const action = actions[i];
    const aliases = aliasMap[action] || [];
    for (let j = 0; j < aliases.length; j += 1) {
      const alias = String(aliases[j] || '').trim().toLowerCase();
      if (!alias) continue;
      const aliasNoSpace = alias.replace(/\s+/g, '');
      if (normalizedRaw === aliasNoSpace || raw.indexOf(alias) >= 0) {
        return logNormalizeActionName_(action);
      }
    }
  }
  const noEmoji = raw
    .replace(/^((?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)+)\s*/u, '')
    .trim();
  const token = (noEmoji || raw).split(/\s+/)[0];
  if (token === 'coding') return 'coding';
  if (token === 'codeing') return 'coding';
  if (token === 'workout') return 'workout';
  if (token === 'trip') return 'trip';
  if (token === 'attendance') return 'attendance';
  return token || 'chat';
}
