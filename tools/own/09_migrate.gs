/**
 * 09_migrate.gs：持ち主のボットだけに入れる、引っこしの関数（前の LOgBOT・食事記録ボットから写した記録を、いまの形にする）
 * 配布用シートにもライブラリにも入れない（tools/publish.sh own が、入口の 00_setup.gs・01_entry.gs といっしょに送る）。
 * ライブラリを使わず、このファイルだけで動く（ライブラリの中だけの関数は、入口から呼べないため）。引っこしが済んだら、このファイルごと消す
 *
 * 使い方
 *   1. upgradeOldRecordsPreview … 直すところを数えるだけ（何も書かない）
 *   2. シートの控えを取る（ファイル → コピーを作成。もとにはもどせないため）
 *   3. upgradeOldRecords … 書きかえる。「のこり ◯ 行」と出たら、出なくなるまで、もう一度
 * 書きかえるもの
 *   logs（記録）        … 行動 codeing → coding／出退勤・移動・はじめ／おわりのある記録に型の行（kind:。数字の memo なら値の行も）／
 *                          移動の緯度経度を 0.01 度に丸め、地名（start_place・end_place）がなければ足す（国土地理院・そらくるの市区町村の表）
 *   action_aliases       … 行動 codeing → coding
 *   log_actions          … type・daily・goal・unit の列がなければ足し、はじめの行にひな形を入れる
 *   meal_users           … 列が1つずれた古い行を、いまの列にそろえる
 */

const MIGRATE_MAX_ROWS = 200;
const MIGRATE_LOG_COLUMNS = ['ID', 'date', 'action', 'minutes', 'detail', 'source', 'userId'];
const MIGRATE_ACTION_EXTRA = ['type', 'daily', 'goal', 'unit'];
// log_actions のひな形（ライブラリの 60_log_actions.gs の LOG_ACTION_SEEDS_ の type〜unit と同じ）
const MIGRATE_ACTION_SEEDS = { workout: ['', 'count', 1, '回'], coding: ['', 'count', 1, '回'], trip: ['place', 'sum', '', 'km'], attendance: ['time', 'sum', '', '分'], charge: ['value', 'sum', 20, '%'], battery: ['value', 'sum', 20, '%'] };
// meal_users のいまの列（ライブラリの 61_meal_base.gs の MEAL_USER_COLUMNS と同じ）と、列が1つずれた古い行の並び
const MIGRATE_MEAL_USER_COLUMNS = ['userId', 'displayName', 'calorieTarget', 'goalType', 'notify', 'status', 'createdAt', 'updatedAt', 'pictureUrl', 'favorites', 'richMenuId', 'richMenuKey'];
const MIGRATE_MEAL_USER_SHIFTED = ['userId', 'displayName', 'pictureUrl', 'calorieTarget', 'goalType', 'notify', 'status', 'createdAt', 'updatedAt'];
const MIGRATE_MUNI_URL = 'https://katsuan.github.io/soraqru/data/muni.json';
const MIGRATE_GSI_URL = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress';

/** 直すところを数えるだけ（何も書かない）。結果は実行ログに */
function upgradeOldRecordsPreview() {
  return migrateRun_(true);
}

/** 前の形の記録を、いまの形に書きかえる（実行する前にシートの控えを取る。1回に200行まで） */
function upgradeOldRecords() {
  return migrateRun_(false);
}

/** 書きかえ（dryRun なら数えるだけ）。{ logs, changed, places, left, aliases, actions, mealUsers } を返し、実行ログに出す */
function migrateRun_(dryRun) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const out = { logs: 0, changed: 0, places: 0, left: 0, aliases: 0, actions: false, mealUsers: 0 };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    migrateLogs_(book, dryRun, out);
    migrateAliases_(book, dryRun, out);
    migrateActions_(book, dryRun, out);
    migrateMealUsers_(book, dryRun, out);
  } finally {
    lock.releaseLock();
  }
  console.log([
    dryRun ? '🔎 見るだけ（何も書いていません）' : '✅ 書きかえました',
    `記録 ${out.logs} 行のうち ${dryRun ? '直す' : '直した'}行：${out.changed}（地名${dryRun ? 'を調べる' : 'を足した'}ところ：${out.places}）${out.left ? `・のこり ${out.left} 行（もう一度実行）` : ''}`,
    `言いかえの codeing：${out.aliases}`,
    `記録の種類の列：${out.actions ? (dryRun ? '足す' : '足した') : 'そろっている'}`,
    `しょくじの人の、列のずれた行：${out.mealUsers}`,
    dryRun ? '書きかえるときは、シートの控え（ファイル → コピーを作成）を取ってから upgradeOldRecords' : ''
  ].filter(Boolean).join('\n'));
  return out;
}

/** 「名前: 値」の行を { 名前（小文字）: 値 } にする */
function migrateDetailMap_(detail) {
  const map = {};
  String(detail || '').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) map[m[1].trim().toLowerCase()] = m[2].trim();
  });
  return map;
}

/** はじめの数字（読めなければ null） */
function migrateNumber_(text) {
  const m = String(text === undefined || text === null ? '' : text).match(/[+-]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 位置の地名（市区町村）。国土地理院で市区町村のコードを聞き、そらくるの表で名前にする。わからなければ '' */
function migratePlace_(lat, lng, memo) {
  const key = `${Math.round(lat * 100) / 100},${Math.round(lng * 100) / 100}`;
  if (Object.prototype.hasOwnProperty.call(memo.places, key)) return memo.places[key];
  let name = '';
  try {
    if (!memo.table) {
      const res = UrlFetchApp.fetch(MIGRATE_MUNI_URL, { muteHttpExceptions: true });
      memo.table = res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : {};
    }
    const geo = UrlFetchApp.fetch(`${MIGRATE_GSI_URL}?lat=${lat.toFixed(3)}&lon=${lng.toFixed(3)}`, { muteHttpExceptions: true });
    if (geo.getResponseCode() === 200) {
      const cd = ((JSON.parse(geo.getContentText()) || {}).results || {}).muniCd;
      const code = typeof cd === 'string' && /^\d{4,6}$/.test(cd) ? String(Number(cd)) : '';
      const found = code && Object.prototype.hasOwnProperty.call(memo.table, code) ? memo.table[code] : '';
      name = typeof found === 'string' ? found.slice(0, 20) : '';
    }
  } catch (error) {
    name = ''; // 地名を調べられないときは、丸めた位置だけ
  }
  memo.places[key] = name;
  return name;
}

/** 1つの記録の行動と中身を、いまの形にする。{ action, detail, changed, places, needPlaces } */
function migrateRecord_(action, detail, dryRun, memo) {
  let a = String(action || '');
  let d = String(detail || '');
  if (/^codeing$/i.test(a.trim())) a = 'coding';
  d = d.replace(/codeing/gi, 'coding');
  const name = a.trim().toLowerCase();
  const lines = d.split('\n');
  const map = migrateDetailMap_(d);
  let places = 0;
  let needPlaces = 0;
  if (!map.kind) {
    if (name === 'trip') lines.push('kind: place');
    else if (name === 'attendance' && map.start && map.end) lines.push('kind: time');
    else if (map.command && map.start && map.end) {
      const from = migrateNumber_(map.memo_start);
      const to = migrateNumber_(map.memo_end);
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
      lines[i] = `${m[1]}${m[2]}: ${Math.round(Number(m[3]) * 100) / 100}`;
    }
    ['start', 'end'].forEach((side) => {
      if (map[`${side}_place`] || typeof fine[`${side}_lat`] !== 'number' || typeof fine[`${side}_lng`] !== 'number') return;
      needPlaces += 1;
      if (dryRun) return;
      const place = migratePlace_(fine[`${side}_lat`], fine[`${side}_lng`], memo);
      if (!place) return;
      const at = lines.findIndex((line) => new RegExp(`^\\s*${side}_lng\\s*:`, 'i').test(line));
      lines.splice(at + 1, 0, `${side}_place: ${place}`);
      places += 1;
    });
  }
  const next = lines.join('\n');
  return { action: a, detail: next, changed: a !== String(action || '') || next !== String(detail || '') || (dryRun && needPlaces > 0), places, needPlaces };
}

/** 外から来た文字を、シートで式にならないようにする（ライブラリの safeCell_ と同じ） */
function migrateSafe_(value) {
  return typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** シート logs */
function migrateLogs_(book, dryRun, out) {
  const sheet = book.getSheetByName('logs');
  if (!sheet) return;
  const values = sheet.getDataRange().getValues();
  const col = { action: MIGRATE_LOG_COLUMNS.indexOf('action'), detail: MIGRATE_LOG_COLUMNS.indexOf('detail') };
  const memo = { places: {}, table: null };
  for (let i = 1; i < values.length; i += 1) {
    out.logs += 1;
    const r = migrateRecord_(values[i][col.action], values[i][col.detail], dryRun, memo);
    if (!r.changed) continue;
    if (out.changed >= MIGRATE_MAX_ROWS) {
      out.left += 1;
      continue;
    }
    out.changed += 1;
    out.places += dryRun ? r.needPlaces : r.places;
    if (dryRun) continue;
    if (r.action !== values[i][col.action]) sheet.getRange(i + 1, col.action + 1).setValue(migrateSafe_(r.action));
    sheet.getRange(i + 1, col.detail + 1).setValue(migrateSafe_(r.detail));
  }
}

/** シート action_aliases：codeing → coding */
function migrateAliases_(book, dryRun, out) {
  const sheet = book.getSheetByName('action_aliases');
  if (!sheet) return;
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i += 1) {
    if (String(rows[i][0] || '').trim().toLowerCase() !== 'codeing') continue;
    out.aliases += 1;
    if (!dryRun) sheet.getRange(i + 1, 1).setValue('coding'); // qcheck-ok: G1 決まった文字だけ
  }
}

/** シート log_actions：足りない列（type・daily・goal・unit）と、はじめの行のひな形 */
function migrateActions_(book, dryRun, out) {
  const sheet = book.getSheetByName('log_actions');
  if (!sheet) return;
  const head = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map((h) => String(h).trim());
  const missing = MIGRATE_ACTION_EXTRA.filter((c) => head.indexOf(c) < 0);
  out.actions = missing.length > 0;
  if (!missing.length || dryRun) return;
  sheet.getRange(1, head.length + 1, 1, missing.length).setValues([missing]); // qcheck-ok: G1 決まった見出しだけ
  const all = head.concat(missing);
  for (let r = 2; r <= sheet.getLastRow(); r += 1) {
    const seed = MIGRATE_ACTION_SEEDS[String(sheet.getRange(r, all.indexOf('action') + 1).getValue() || '').trim()];
    if (!seed) continue;
    missing.forEach((c) => sheet.getRange(r, all.indexOf(c) + 1).setValue(seed[MIGRATE_ACTION_EXTRA.indexOf(c)])); // qcheck-ok: G1 コードに書いたひな形の値だけ
  }
}

/** シート meal_users：列が1つずれた古い行（許可のようすが、いまの列の位置になく、1つ右にある）を、いまの列にそろえる */
function migrateMealUsers_(book, dryRun, out) {
  const sheet = book.getSheetByName('meal_users');
  if (!sheet) return;
  const known = ['active', 'inactive', 'pending'];
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const nowStatus = String(row[MIGRATE_MEAL_USER_COLUMNS.indexOf('status')] || '').trim();
    const oldStatus = String(row[MIGRATE_MEAL_USER_SHIFTED.indexOf('status')] || '').trim();
    const nowTarget = row[MIGRATE_MEAL_USER_COLUMNS.indexOf('calorieTarget')];
    if (known.indexOf(nowStatus) >= 0 || known.indexOf(oldStatus) < 0 || (nowTarget !== '' && nowTarget !== null && nowTarget !== undefined)) continue;
    out.mealUsers += 1;
    if (dryRun) continue;
    const obj = {};
    MIGRATE_MEAL_USER_SHIFTED.forEach((k, j) => (obj[k] = row[j]));
    const next = MIGRATE_MEAL_USER_COLUMNS.map((k) => (k === 'favorites' ? '[]' : obj[k] === undefined ? '' : obj[k]));
    sheet.getRange(i + 1, 1, 1, next.length).setValues([next.map(migrateSafe_)]); // qcheck-ok: G1 migrateSafe_ を通した行
  }
}
