/**
 * 60_log_records.gs：機能「📝 記録」の記録そのもの（LOgBOT の 03_record/log.gs から）
 * 中身：記録をシートに書く・読む・書きかえる・時間を足す（確かめつき）・記録 ID
 * 呼ばれる（LOgBOT のときのファイル名）：LINE の返事・つづく・画面・GitHub の入れなおし
 *
 * アクティビティログ（草）の生成・永続化を担当する
 *
 * 役割:
 * - ログオブジェクトの生成（createLog_）
 * - スプレッドシートへの保存（saveLog_）
 * - ログ一覧の取得（getLogs_）
 * - 入力元（HTML / LINE）ごとの差分吸収
 *
 * 設計方針:
 * - ログ構造は常に共通
 * - 入力元依存の判断は「入口関数」に閉じ込める
 * - GitHub 連携は policy で制御
 */


/* ==================================================
 * 定数定義
 * ================================================== */
/**
 * ログのカラム定義（順序保証用）
 */
const LOG_COLUMNS_ = ['ID', 'date', 'action', 'minutes', 'detail', 'source', 'userId'];
const LOG_SESSION_RESUME_WINDOW_MS_ = 5 * 60 * 1000;
const LOG_DETAIL_MAX_ = 2000; // 1回の記録の本文の上限（文字）

/**
 * 1回の実行の中で読んだログのキャッシュ
 * シートを書き換えたら invalidateLogsCache_() で捨てる
 */
let logLogsCache_ = null;

/** 1回の実行の中で覚えたログを捨てる（シートを書きかえたあとに呼ぶ） */
function logInvalidateLogsCache_() {
  logLogsCache_ = null;
}

/* ==================================================
 * コアロジック
 * ================================================== */
/**
 * ログオブジェクトを生成する
 *
 * - date はここで必ず付与
 * - source / userId は入口側の責務
 *
 * @param {{
 *   action: string,
 *   minutes?: number,
 *   detail?: string,
 *   source: string,
 *   userId?: string
 * }}
 * @return {Object}
 */
function logCreateLog_({ action, minutes = 0, detail = '', source, userId = 'sys', }) {
  return { ID: '', date: new Date(), action, minutes, detail, source, userId };
}

/**
 * アクティビティログをスプレッドシートに保存する
 * 
 * - LINE / HTML など複数の入力元から共通利用
 * - ログ構造は LOG_COLUMNS_ に従う
 * 
 * @param {Log} log
 */
function logSaveLog_(log) {
  const sheet = logGetLogSheet_();
  const id = log.ID || logCreateLogId_();
  const rowLog = { ...log, ID: id };
  sheet.appendRow(logToLogRow_(rowLog));
  logInvalidateLogsCache_();
  return rowLog;
}

/**
 * シートに書く1行にする（外から来た文字は式として動かないように safeCell を通す）
 */
function logToLogRow_(log) {
  return LOG_COLUMNS_.map(key => safeCell_(key === 'detail' ? logLimitText_(log[key], LOG_DETAIL_MAX_) : log[key]));
}

/** 長すぎる文字を切る */
function logLimitText_(value, max) {
  if (typeof value !== 'string') return value;
  return value.length > max ? value.slice(0, max) : value;
}

/** 記録 ID の行を、新しい中身で書きかえる。書きかえた記録を返す（なければ null） */
function logUpdateLogById_(logId, nextLog) {
  const id = String(logId || '').trim();
  if (!id) return null;

  const sheet = logGetLogSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return null;

  const idxId = LOG_COLUMNS_.indexOf('ID');
  for (let row = values.length - 1; row >= 1; row -= 1) {
    if (String(values[row][idxId] || '') !== id) continue;
    const rowLog = { ...nextLog, ID: id };
    const nextRow = logToLogRow_(rowLog);
    sheet.getRange(row + 1, 1, 1, nextRow.length).setValues([nextRow]);
    logInvalidateLogsCache_();
    return rowLog;
  }
  return null;
}

/** はじめ・おわりの記録をシートに残す（つづきなら前の行を書きかえる）。GitHub にもつないでいれば書く */
function logPersistSessionLog_(log, policy, resumeLogId) {
  const resumeId = String(resumeLogId || '').trim();
  if (!resumeId) {
    const saved = logSaveLog_(log);
    const target = logResolveGithubTarget_(policy);
    if (target) {
      logCommitLogToGithub_(saved, target);
    }
    return saved;
  }

  const existing = logGetLogById_(resumeId);
  if (!existing) {
    const saved = logSaveLog_(log);
    const target = logResolveGithubTarget_(policy);
    if (target) {
      logCommitLogToGithub_(saved, target);
    }
    return saved;
  }

  const updated = logUpdateLogById_(resumeId, {
    ...existing,
    ...log,
    ID: resumeId,
    date: existing.date || log.date || new Date(),
  });
  const target = logResolveGithubTarget_(policy);
  if (updated && target) {
    logUpsertLogToGithub_(updated, target);
  }
  return updated || existing;
}

/* ==================================================
 * エントリーポイント
 * ================================================== */
/**
 * HTML フォームからのログ登録
 * 
 * - 常に GitHub にも記録する
 */
function logFromHtml_(data) {
  const log = logCreateLog_({ ...data, source: 'HTML' });
  const saved = logSaveLog_(log);
  logCommitLogToGithub_(saved);
}

/**
 * LINE メッセージからのログ登録
 * 
 * - GitHub 連携可否は policy に依存
 */
function logFromLINE_(data, policy) {
  const log = logCreateLog_({
    ...data,
    action: String(data && data.action || 'chat'),
    source: String(policy && policy.logSource || 'LINE'),
    userId: policy.userId,
  });

  const saved = logSaveLog_(log);
  const target = logResolveGithubTarget_(policy);
  if (target) {
    logCommitLogToGithub_(saved, target);
  }
  return saved;
}

/* ==================================================
 * 内部ユーティリティ
 * ================================================== */
/**
 * ログ保存用スプレッドシートを取得する（内部用）
 * 
 * - 設定値は getAppConfig_ に集約
 * - 毎回取得することで初期化順序問題を回避
 */
function logGetLogSheet_() {
  const book = book_();
  let sheet = book.getSheetByName(LOG_SHEET_.logs);
  if (!sheet) {
    sheet = book.insertSheet(LOG_SHEET_.logs);
    sheet.appendRow(LOG_COLUMNS_); // qcheck-ok: G1 決まった見出しだけ
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * アクティビティログを取得する（内部用）
 * 
 * @private
 * @return {Array<{
 *   date: Date,
 *   action: string,
 *   minutes: number,
 *   detail: string,
 *   source: string,
 *   userId: string,
 * }>}
 */
function logGetLogs_() {
  if (!logLogsCache_) logLogsCache_ = logReadLogsFromSheet_();
  return logLogsCache_.slice();
}

/** 記録のシートを読んで、ログの並びにする（日付の読めない行は外す） */
function logReadLogsFromSheet_() {
  const sheet = logGetLogSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const indexMap = logHeaderIndexMap_(values[0]);

  const idxDate = indexMap.date;
  const idxAction = indexMap.action;
  const idxMinutes = indexMap.minutes;
  const idxDetail = indexMap.detail;
  const idxSource = indexMap.source;
  const idxUserId = indexMap.userId != null ? indexMap.userId : indexMap.user;
  const idxID = indexMap.ID;

  return values.slice(1).map(row => {
    const rawDate = idxDate != null ? row[idxDate] : null;
    const date = rawDate instanceof Date ? rawDate : new Date(rawDate);
    return {
      ID: idxID != null ? row[idxID] : '',
      date: isNaN(date.getTime()) ? null : date,
      action: idxAction != null ? row[idxAction] : '',
      minutes: idxMinutes != null ? Number(row[idxMinutes]) || 0 : 0,
      detail: idxDetail != null ? row[idxDetail] : '',
      source: idxSource != null ? row[idxSource] : '',
      userId: idxUserId != null ? row[idxUserId] : '',
    };
  }).filter(log => log.date);
}

/**
 * 今日の最新 LINE ログの minutes を増減する
 *
 * @param {string} userId
 * @param {number} deltaMinutes
 * @param {Date=} now
 * @return {{before:number, after:number}|null}
 */
function logAdjustLatestLogMinutesFromLINE_(userId, deltaMinutes, now) {
  const base = now instanceof Date ? now : new Date();
  const sheet = logGetLogSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return null;

  const indexMap = logHeaderIndexMap_(values[0]);

  const idxDate = indexMap.date;
  const idxSource = indexMap.source;
  const idxUser = indexMap.userId;
  const idxMinutes = indexMap.minutes;
  if ([idxDate, idxSource, idxUser, idxMinutes].some(v => v == null)) return null;

  const candidates = [];
  for (let row = values.length - 1; row >= 1; row -= 1) {
    const record = values[row];
    const isLine = record[idxSource] === 'LINE';
    const sameDay = logIsSameDay_(new Date(record[idxDate]), base);
    if (!isLine || !sameDay) continue;
    candidates.push({ row, record });
  }

  // ほかの人の記録は変えない
  const fallback = candidates.find(item => String(item.record[idxUser] || '') === String(userId || ''));
  if (!fallback) return null;

  const before = Number(fallback.record[idxMinutes]) || 0;
  const after = Math.max(0, before + (Number(deltaMinutes) || 0));
  sheet.getRange(fallback.row + 1, idxMinutes + 1).setValue(after);
  logInvalidateLogsCache_();
  return { before, after, id: String(fallback.record[indexMap.ID] || '') };
}

/** 記録 ID の行の分を足す（ほかの人の記録は変えない）。{before, after, id} か null */
function logAdjustLogMinutesById_(logId, deltaMinutes, userId) {
  const id = String(logId || '').trim();
  if (!id) return null;
  const uid = String(userId || '');
  const sheet = logGetLogSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return null;

  const indexMap = logHeaderIndexMap_(values[0]);
  const idxID = indexMap.ID;
  const idxMinutes = indexMap.minutes;
  if (idxID == null || idxMinutes == null) return null;

  for (let row = values.length - 1; row >= 1; row -= 1) {
    const record = values[row];
    if (String(record[idxID] || '') !== id) continue;
    if (indexMap.userId != null && String(record[indexMap.userId] || '') !== uid) return null; // ほかの人の記録は変えない
    const before = Number(record[idxMinutes]) || 0;
    const after = Math.max(0, before + (Number(deltaMinutes) || 0));
    sheet.getRange(row + 1, idxMinutes + 1).setValue(after);
    logInvalidateLogsCache_();
    return { before, after, id };
  }
  return null;
}

const LOG_ADJUST_MAX_AGE_DAYS_ = 7; // 時間を足せるのは、この日数までの記録（カードは何日もあとに押されることがある）

/**
 * カードのボタン（postback）から、特定の記録の時間を足す。押されるたびに、いまの記録を見て決める（ux.md の H2）
 * @param {string} logId
 * @param {number} delta 足す分
 * @param {string} userId 押した人
 * @param {number|null} base カードを出したときの分（ちがえば、もう足してある）
 * @param {Date=} now
 * @return {{status: 'ok'|'missing'|'other'|'old'|'done', before?: number, after?: number, log?: Object}}
 */
function logAdjustLogMinutesChecked_(logId, delta, userId, base, now) {
  const id = String(logId || '').trim();
  if (!id) return { status: 'missing' };
  const sheet = logGetLogSheet_();
  const values = sheet.getDataRange().getValues();
  const idx = logHeaderIndexMap_(values[0] || []);
  if (idx.ID == null || idx.minutes == null) return { status: 'missing' };
  for (let row = values.length - 1; row >= 1; row -= 1) {
    const record = values[row];
    if (String(record[idx.ID] || '') !== id) continue;
    const log = LOG_COLUMNS_.reduce((o, key) => ({ ...o, [key]: idx[key] != null ? record[idx[key]] : '' }), {});
    const before = Number(log.minutes) || 0;
    if (idx.userId != null && String(log.userId || '') !== String(userId || '')) return { status: 'other' };
    const date = log.date instanceof Date ? log.date : new Date(log.date);
    const base0 = now instanceof Date ? now : new Date();
    if (isNaN(date.getTime()) || base0.getTime() - date.getTime() > LOG_ADJUST_MAX_AGE_DAYS_ * LOG_DAY_MS) return { status: 'old', before, log };
    if (base != null && base !== '' && Number(base) !== before) return { status: 'done', before, after: before, log };
    const after = Math.max(0, before + (Number(delta) || 0));
    sheet.getRange(row + 1, idx.minutes + 1).setValue(after);
    logInvalidateLogsCache_();
    return { status: 'ok', before, after, log: { ...log, minutes: after } };
  }
  return { status: 'missing' };
}

/** 記録 ID のログを返す（なければ null） */
function logGetLogById_(logId) {
  const id = String(logId || '').trim();
  if (!id) return null;
  const logs = logGetLogs_();
  const found = logs.find(log => String(log.ID || '') === id);
  return found || null;
}

/** シートの1行目（見出し）→ { 見出し: 列の番号（0から） } */
function logHeaderIndexMap_(headerRow) {
  const map = {};
  (headerRow || []).forEach((name, i) => { map[String(name == null ? '' : name).trim()] = i; });
  return map;
}

/** 新しい記録 ID（L＋日時＋4けたの数）を作る */
function logCreateLogId_() {
  const stamp = logFormatJST_(new Date(), 'yyyyMMddHHmmss');
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `L${stamp}${rand}`;
}
