/**
 * 01_sheet.gs：シート（配布用シートのコピー）。機能・使う人・つないだツール・動作の記録と、機能ごとのシート
 * 外から来た文字は、= + - @ で始まると式として動くので safeCell を通して書く（docs/security.md の G1）
 */

/** シート（なければ見出しつきで作る） */
function sheet_(kind) {
  const def = SHEETS_[kind];
  const book = book_();
  let sheet = book.getSheetByName(def.name);
  if (!sheet) {
    sheet = book.insertSheet(def.name);
    sheet.appendRow(def.headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** 行を { 見出し: 値 } で読む（1回の呼び出しで1回だけ） */
function readRows_(kind) {
  if (memo_[kind]) return memo_[kind];
  const values = sheet_(kind).getDataRange().getValues();
  const headers = (values[0] || []).map((h) => String(h).trim());
  memo_[kind] = values.slice(1).map((row) => {
    const out = {};
    headers.forEach((h, j) => {
      out[h] = row[j];
    });
    return out;
  });
  return memo_[kind];
}

function appendRow_(kind, data) {
  const def = SHEETS_[kind];
  withLock_(() => sheet_(kind).appendRow(def.headers.map((h) => safeCell(data[h] === undefined ? '' : data[h]))));
  delete memo_[kind];
}

/** 1つの行の、いくつかの列を書きかえる（keyColumn が key の行） */
function updateRow_(kind, keyColumn, key, changes) {
  const def = SHEETS_[kind];
  return withLock_(() => {
    const sheet = sheet_(kind);
    const values = sheet.getDataRange().getValues();
    const headers = (values[0] || []).map((h) => String(h).trim());
    const keyIndex = headers.indexOf(keyColumn);
    for (let i = 1; i < values.length; i += 1) {
      if (String(values[i][keyIndex] || '').trim() !== key) continue;
      Object.keys(changes).forEach((column) => {
        const j = headers.indexOf(column);
        if (j >= 0) sheet.getRange(i + 1, j + 1).setValue(safeCell(changes[column]));
      });
      const updated = headers.indexOf('updatedAt');
      if (updated >= 0 && def.headers.includes('updatedAt')) sheet.getRange(i + 1, updated + 1).setValue(new Date());
      delete memo_[kind];
      return true;
    }
    return false;
  });
}

const isOn_ = (value) => value === true || String(value).trim().toUpperCase() === 'TRUE';

/** 持ち主が許した人の ID */
function allowedMemberIds_() {
  return readRows_('members')
    .filter((row) => String(row.status).trim() === 'allowed')
    .map((row) => String(row.userId || '').trim())
    .filter(Boolean);
}

function memberRow_(userId) {
  return readRows_('members').find((row) => String(row.userId || '').trim() === userId) || null;
}

/** 動作の記録（システム管理者がシートで見る。LINE の ID は書かない・500 行まで） */
function writeLog_(step, summary) {
  try {
    const sheet = sheet_('log');
    sheet.appendRow([new Date(), safeCell(step), safeCell(String(summary || '').replace(/U[0-9a-f]{32}/g, 'U…'))]);
    const extra = sheet.getLastRow() - 501;
    if (extra > 0) sheet.deleteRows(2, extra);
  } catch (error) {
    console.error(`LOG_FAILED: ${step}`);
  }
}

/** 外から来た文字：決まった長さまで・1行に（絵文字を半分にしない） */
function cleanText_(value, max) {
  return Array.from(String(value === null || value === undefined ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).slice(0, max).join('');
}

/** 外から来た文字を、シートで式にならないようにする（q-oqrn/tools/qtest/selfcheck.gs の safeCell と同じ） */
function safeCell(value) {
  if (typeof value !== 'string') return value;
  if (/^[=+\-@\t\r]/.test(value) && !/^[+-]?\d+(\.\d+)?$/.test(value)) return "'" + value;
  return value;
}
