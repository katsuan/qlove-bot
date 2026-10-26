/**
 * 60_log_users.gs：機能「📝 記録」の使う人の表（LOgBOT の 03_record/user_registry.gs から）
 * 中身：使う人の表（users）の読み書き・LINE の名前の読みこみ・画面からの名前の直し
 * 呼ばれる（LOgBOT のときのファイル名）：line_event（LINE で来た人を入れる）・管理画面
 *
 * ユーザー管理テーブル（users）を管理する。
 *
 * 方針:
 * - 初回のみ displayName を取得して保存
 * - 以降は lastSeenAt のみ更新
 * - 名前は管理画面から上書き可能
 */

const LOG_USER_COLUMNS_ = ['userId', 'displayName', 'createdAt', 'lastSeenAt', 'status', 'memo', 'sourceType', 'groupId', 'roomId'];

/** 使う人の表（users）のシートを返す。なければ作り、見出しをそろえる */
function logGetUserSheet_() {
  const ss = book_();
  let sheet = ss.getSheetByName(LOG_SHEET_.users);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET_.users);
    sheet.appendRow(LOG_USER_COLUMNS_);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(LOG_USER_COLUMNS_);
  } else {
    logEnsureUserSheetHeader_(sheet);
  }
  return sheet;
}

/** 使う人の表に、足りない見出しを右に足す */
function logEnsureUserSheetHeader_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || '').trim());
  LOG_USER_COLUMNS_.forEach(col => {
    if (header.indexOf(col) >= 0) return;
    sheet.getRange(1, sheet.getLastColumn() + 1).setValue(col);
  });
}

/** 使う人の表を { LINE の ID: 行の中身 } にして返す */
function logGetUsersMap_() {
  const sheet = logGetUserSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return {};
  const idx = logHeaderIndexMap_(values[0]);
  const out = {};
  for (let r = 1; r < values.length; r += 1) {
    const row = values[r];
    const uid = String(row[idx.userId] || '').trim();
    if (!uid) continue;
    out[uid] = {
      row: r + 1,
      userId: uid,
      displayName: String(row[idx.displayName] || ''),
      createdAt: row[idx.createdAt],
      lastSeenAt: row[idx.lastSeenAt],
      status: String(row[idx.status] || 'active'),
      memo: String(row[idx.memo] || ''),
      sourceType: idx.sourceType >= 0 ? String(row[idx.sourceType] || '') : '',
      groupId: idx.groupId >= 0 ? String(row[idx.groupId] || '') : '',
      roomId: idx.roomId >= 0 ? String(row[idx.roomId] || '') : '',
    };
  }
  return out;
}

/** LINE で送ってきた人を、使う人の表に入れる（いれば最後に来た日時だけ直す） */
function logRegisterUserIfNeeded_(event, policy) {
  const uid = String(
    (event && event.source && event.source.userId) ||
    (policy && policy.userId) ||
    ''
  ).trim();
  if (!uid) return;

  const sheet = logGetUserSheet_();
  const users = logGetUsersMap_();
  const now = new Date();
  const existing = users[uid];
  if (existing) {
    // lastSeenAt 更新 + source情報更新
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idxLastSeen = header.indexOf('lastSeenAt') + 1;
    const idxName = header.indexOf('displayName') + 1;
    const idxSourceType = header.indexOf('sourceType') + 1;
    const idxGroupId = header.indexOf('groupId') + 1;
    const idxRoomId = header.indexOf('roomId') + 1;
    if (idxLastSeen > 0) sheet.getRange(existing.row, idxLastSeen).setValue(now);
    if (idxSourceType > 0) sheet.getRange(existing.row, idxSourceType).setValue(safeCell_(String(event && event.source && event.source.type || existing.sourceType || '')));
    if (idxGroupId > 0) sheet.getRange(existing.row, idxGroupId).setValue(safeCell_(String(event && event.source && event.source.groupId || existing.groupId || '')));
    if (idxRoomId > 0) sheet.getRange(existing.row, idxRoomId).setValue(safeCell_(String(event && event.source && event.source.roomId || existing.roomId || '')));

    // displayName 未取得ユーザーは通過時に再取得を試みる
    if (!String(existing.displayName || '').trim() && idxName > 0) {
      const refreshed = logTryFetchLineDisplayName_(uid, event && event.source ? event.source : {
        type: existing.sourceType || '',
        groupId: existing.groupId || '',
        roomId: existing.roomId || '',
      });
      if (String(refreshed || '').trim()) {
        sheet.getRange(existing.row, idxName).setValue(safeCell_(logLimitText_(String(refreshed).trim(), 60)));
      }
    }
    return;
  }

  const displayName = logTryFetchLineDisplayName_(uid, event && event.source ? event.source : null);
  const sourceType = String(event && event.source && event.source.type || '');
  const groupId = String(event && event.source && event.source.groupId || '');
  const roomId = String(event && event.source && event.source.roomId || '');
  const row = [safeCell_(uid), safeCell_(logLimitText_(displayName || '', 60)), now, now, 'active', '', safeCell_(sourceType), safeCell_(groupId), safeCell_(roomId)];
  sheet.appendRow(row);
}

/** LINE の名前を読む（鍵があるときだけ。グループ・ルームでも）。読めなければ '' */
function logTryFetchLineDisplayName_(userId, source) {
  // 子ライブラリ単体でも動くよう、トークンがあるときだけ実行
  const token = lineToken_();
  if (!token) return '';

  const headers = { Authorization: `Bearer ${token}` };
  const urls = [];

  // グループ/ルーム内の送信者は member profile API の方が取得成功率が高い
  if (source && source.type === 'group' && source.groupId) {
    urls.push(`https://api.line.me/v2/bot/group/${encodeURIComponent(source.groupId)}/member/${encodeURIComponent(userId)}`);
  }
  if (source && source.type === 'room' && source.roomId) {
    urls.push(`https://api.line.me/v2/bot/room/${encodeURIComponent(source.roomId)}/member/${encodeURIComponent(userId)}`);
  }
  urls.push(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`);

  for (let i = 0; i < urls.length; i += 1) {
    try {
      const res = UrlFetchApp.fetch(urls[i], {
        method: 'get',
        headers: headers,
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() !== 200) continue;
      const json = JSON.parse(res.getContentText() || '{}');
      const name = String(json.displayName || '').trim();
      if (name) return name;
    } catch (e) {
      // try next endpoint
    }
  }
  return '';
}

/* ==================================================
 * 前の LOgBOT からの引っこし（持ち主の記録の ID）
 * LINE の ID はプロバイダーごとにちがうので、前の LOgBOT のトーク（user_id）・つづく（LIFF_USER_ID）の ID で入った記録は、
 * くらぶボットの持ち主の ID とちがう。スクリプト プロパティ LOG_OLD_OWNER_IDS（「,」区切り）に前の ID を入れると、
 *   - 入れたあいだは、その ID の記録も持ち主の記録として数える（つづくの記録した日・知らせ）
 * ================================================== */

/** 前の LOgBOT の持ち主の ID（LOG_OLD_OWNER_IDS。LINE の ID の形のものだけ） */
function logOwnerOldIds_() {
  return String(props_().getProperty('LOG_OLD_OWNER_IDS') || '')
    .split(',')
    .map(v => v.trim())
    .filter(v => /^U[0-9a-f]{32}$/.test(v) && v !== ownerUserId_());
}

