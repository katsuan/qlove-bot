/**
 * 60_log_upgrade.gs：前の形の記録を、いまの形に1回だけ書きかえる（持ち主が入口の upgradeOldRecordsPreview → upgradeOldRecords で実行）
 * 書きかえたあとは、前の形を読む処理（型の推し量り・memo_diff・codeing・列のずれた meal_users など）を消すので、このファイルも消す。
 *   logs（記録）
 *     - 行動 codeing → coding（行動の列と中身）
 *     - 出退勤・移動・はじめ／おわりのある記録に、型の行（kind:）。数字の memo なら start_value・end_value・value_diff・unit も
 *     - 移動の緯度経度を 0.01 度に丸め、地名（start_place・end_place）がなければ足す（距離はもう出してあるので、そのまま）
 *   action_aliases（言いかえ）… 行動 codeing → coding
 *   log_actions（記録の種類）… type・daily・goal・unit の列がなければ足す
 *   meal_users（しょくじの人）… 列が1つずれた古い行を、いまの列にそろえる
 * 1回に直す記録は200行まで（地名を調べるのに時間がかかるため。のこりは、もう一度実行）
 * 呼ばれるところ：00_public.gs の botUpgradeOldRecords
 */

const LOG_UPGRADE_MAX_ROWS_ = 200;

/** 1つの記録の行動と中身を、いまの形にする。{ action, detail, changed, places, needPlaces } */
function logUpgradeRecord_(action, detail, dryRun) {
  let a = String(action || '');
  let d = String(detail || '');
  if (/^codeing$/i.test(a.trim())) a = 'coding';
  d = d.replace(/codeing/gi, 'coding');
  const name = logNormalizeActionName_(a);
  const lines = d.split('\n');
  const map = logParseLogDetailMap_(d);
  let places = 0;
  let needPlaces = 0;
  if (!map.kind) {
    if (name === 'trip') lines.push('kind: place');
    else if (name === 'attendance' && map.start && map.end) lines.push('kind: time');
    else if (map.command && map.start && map.end) {
      const from = logNumberOf_(map.memo_start);
      const to = logNumberOf_(map.memo_end);
      if (from !== null && to !== null) {
        lines.push('kind: value', `start_value: ${from}`, `end_value: ${to}`, `value_diff: ${Math.round((to - from) * 10) / 10}`);
        if (/%/.test(`${map.memo_start || ''}${map.memo_end || ''}`)) lines.push('unit: %');
      } else {
        lines.push('kind: time');
      }
    }
  }
  if (name === 'trip') {
    const fine = {};
    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].match(/^(\s*)((?:start|end)_(?:lat|lng))\s*:\s*(-?\d+(?:\.\d+)?)\s*$/i);
      if (!m) continue;
      fine[m[2].toLowerCase()] = Number(m[3]);
      lines[i] = `${m[1]}${m[2]}: ${logRoundCoord_(m[3])}`;
    }
    ['start', 'end'].forEach((side) => {
      if (map[`${side}_place`] || typeof fine[`${side}_lat`] !== 'number' || typeof fine[`${side}_lng`] !== 'number') return;
      needPlaces += 1;
      if (dryRun) return;
      const place = logTripPlace_(fine[`${side}_lat`], fine[`${side}_lng`], '');
      if (!place) return; // 地名を調べられないときは、丸めた位置だけ
      const at = lines.findIndex((line) => new RegExp(`^\\s*${side}_lng\\s*:`, 'i').test(line));
      lines.splice(at + 1, 0, `${side}_place: ${place}`);
      places += 1;
    });
  }
  const next = lines.join('\n');
  return { action: a, detail: next, changed: a !== String(action || '') || next !== String(detail || '') || (dryRun && needPlaces > 0), places, needPlaces };
}

/** 前の形の記録を、いまの形にする（dryRun なら数えるだけ）。{ logs, changed, places, left, aliases, actions, mealUsers } */
function logUpgradeOldRecords_(dryRun) {
  const out = { logs: 0, changed: 0, places: 0, left: 0, aliases: 0, actions: false, mealUsers: 0 };
  // logs
  const sheet = logGetLogSheet_();
  const values = sheet.getDataRange().getValues();
  const col = { action: LOG_COLUMNS_.indexOf('action'), detail: LOG_COLUMNS_.indexOf('detail') };
  for (let i = 1; i < values.length; i += 1) {
    out.logs += 1;
    const r = logUpgradeRecord_(values[i][col.action], values[i][col.detail], dryRun);
    if (!r.changed) continue;
    if (out.changed >= LOG_UPGRADE_MAX_ROWS_) {
      out.left += 1;
      continue;
    }
    out.changed += 1;
    out.places += dryRun ? r.needPlaces : r.places;
    if (dryRun) continue;
    if (r.action !== values[i][col.action]) sheet.getRange(i + 1, col.action + 1).setValue(safeCell_(r.action));
    sheet.getRange(i + 1, col.detail + 1).setValue(safeCell_(r.detail));
  }
  if (!dryRun) logInvalidateLogsCache_();
  // action_aliases：codeing → coding
  const aliases = book_().getSheetByName(LOG_SHEET_.aliases);
  if (aliases) {
    const rows = aliases.getDataRange().getValues();
    for (let i = 1; i < rows.length; i += 1) {
      if (String(rows[i][0] || '').trim().toLowerCase() !== 'codeing') continue;
      out.aliases += 1;
      if (!dryRun) aliases.getRange(i + 1, 1).setValue('coding'); // qcheck-ok: G1 決まった文字だけ
    }
  }
  // log_actions：足りない列
  const actions = book_().getSheetByName(LOG_SHEET_.actions);
  if (actions) {
    const head = actions.getRange(1, 1, 1, Math.max(actions.getLastColumn(), 1)).getValues()[0].map((h) => String(h).trim());
    out.actions = LOG_ACTION_COLUMNS_.some((c) => head.indexOf(c) < 0);
    if (out.actions && !dryRun) logEnsureActionColumns_(actions);
  }
  // meal_users：列が1つずれた古い行
  const users = book_().getSheetByName(MEAL_SHEET.USERS);
  if (users) {
    const rows = users.getDataRange().getValues();
    for (let i = 1; i < rows.length; i += 1) {
      const row = rows[i];
      const now = mealMapUserRow_(row);
      // いまの列のまま読めた行は、そのまま（列のずれた古い行は、許可のようすの列が、いまの列の位置にない）
      if (String(row[MEAL_USER_COL_INDEX.status - 1] || '').trim() === now.status) continue;
      out.mealUsers += 1;
      if (!dryRun) users.getRange(i + 1, 1, 1, MEAL_USER_COLUMNS.length).setValues([mealToSheetRow_(MEAL_USER_COLUMNS, Object.assign({}, now, { favorites: JSON.stringify(now.favorites || []) }))]); // qcheck-ok: G1 safeCell を通した行
    }
    if (!dryRun) mealForgetMemo_('users');
  }
  return out;
}
