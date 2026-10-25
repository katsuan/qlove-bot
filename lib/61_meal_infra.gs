/**
 * 61_meal_infra.gs：機能「🍚 しょくじ」の、外とのやりとりと小さな部品（食事記録ボットの 08_infra.gs から）
 *   シート（くらぶボットのシート）・MYメニューの控え（キャッシュ）・1回の呼び出しの覚え書き（mealMemo_）、
 *   LINE の API（返事・push・プロフィール・写真）・しょくじを開く URL・やさしいエラーのことば。
 * 鍵・シート・キャッシュ・ロックは、くらぶボットの入口から渡されたもの（02_config.gs の props_・book_・cache_・scriptLock_）を使う。
 * 本人の確かめは、くらぶボットのツールの受け口（03_tool_api.gs）がすませてから、この機能を呼ぶ（mealUseCaller_）
 * 呼ばれるところ：しょくじの機能のどのファイルからも
 */

const MEAL_NUTRITION_MASTER_CACHE_KEY = 'NUTRITION_MASTER_CACHE';
// しょくじ（q-shoquji）の LIFF。カードのボタン・クイックリプライから、この画面を開く（秘密ではない）
const MEAL_SHOQUJI_LIFF_ID = '2012187502-BVvVhWZM'; // くらぶボットと同じ Q のプロバイダー（つづくと同じチャネル）。前は食事記録ボットの 2010088825-CulmmaFc
const MEAL_SCRIPT_PROPERTY_DRIVE_FOLDER_ID = 'MEAL_DRIVE_FOLDER_ID';
const MEAL_SCRIPT_PROPERTY_REMINDER_STREAKS = 'MEAL_REMINDER_STREAKS';
const MEAL_PENDING_IMAGE_ATTACHMENT_CACHE_PREFIX = 'PENDING_IMAGE_ATTACHMENT:';

// 呼び出し1回（doPost・トリガー1回）の中だけの覚え書き（くらぶボットの memo_ の中。呼び出しのたびに空になる。02_config.gs の useEnv_）。
// 同じシートを何度も読むと遅いので、1回目に読んだものを使い回す。シートに書いたら mealForgetMemo_ で捨てる
function mealState_() {
  if (!memo_.meal) memo_.meal = {};
  return memo_.meal;
}

// 1回の呼び出しの中で、同じものを2回作らない：key で覚えておき、2回目はそれを返す
function mealMemo_(key, build) {
  const state = mealState_();
  if (!Object.prototype.hasOwnProperty.call(state, key)) {
    state[key] = build();
  }
  return state[key];
}

// 覚え書きを1つ消す（書きこんだあとに読みなおすため）
function mealForgetMemo_(key) {
  delete mealState_()[key];
}

// MYメニューの控え（キャッシュと覚え書き）を消す。シートを書きかえたあとに呼ぶ
function mealRefreshNutritionMasterCache_() {
  cache_().remove(MEAL_NUTRITION_MASTER_CACHE_KEY);
  mealForgetMemo_('masters');
  mealForgetMemo_('mastersByKey');
}

// MYメニューを全部返す（控えがあればそれを、なければシートを読んで6時間控える）
function mealGetNutritionMasterCached_() {
  return mealMemo_('masters', () => {
    const cache = cache_();
    const cached = cache.get(MEAL_NUTRITION_MASTER_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }

    const masters = mealGetNutritionMasters_();
    try {
      cache.put(MEAL_NUTRITION_MASTER_CACHE_KEY, JSON.stringify(masters), 600);
    } catch (error) {
      // 100KB を超えるとキャッシュに入らない。そのときは毎回シートから読む
    }
    return masters;
  });
}

// masterKey で MYメニューを1件返す（なければ null）
function mealGetNutritionMasterByKey_(masterKey) {
  if (!masterKey) return null;
  const byKey = mealMemo_('mastersByKey', () => {
    const map = {};
    mealGetNutritionMasterCached_().forEach(master => {
      map[master.masterKey] = master;
    });
    return map;
  });
  return byKey[masterKey] || null;
}

// 記録を入れるスプレッドシート（くらぶボットのシート）
function mealGetSpreadsheet_() {
  return book_();
}

// しょくじの LIFF の ID（決まった値）
function mealGetLiffId_() {
  return MEAL_SHOQUJI_LIFF_ID;
}

// LINE の Messaging API の鍵（くらぶボットのもの。なければ ""）
function mealGetLineChannelAccessToken_() {
  return lineToken_();
}

// 管理者（くらぶボットの持ち主）の LINE のユーザー ID の一覧
function mealGetAdminUserIds_() {
  return [ownerUserId_()].filter(Boolean);
}

// 写真を置くドライブのフォルダ ID（MEAL_DRIVE_FOLDER_ID。なければ ""＝マイドライブ）
function mealGetDriveFolderId_() {
  return props_().getProperty(MEAL_SCRIPT_PROPERTY_DRIVE_FOLDER_ID) || '';
}

// 20時のお知らせを何日続けて送ったか（人ごと）を返す
function mealGetReminderStreaks_() {
  const raw = props_().getProperty(MEAL_SCRIPT_PROPERTY_REMINDER_STREAKS) || '{}';
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

// 20時のお知らせを何日続けて送ったか（人ごと）を書く
function mealSetReminderStreaks_(streaks) {
  props_().setProperty(
    MEAL_SCRIPT_PROPERTY_REMINDER_STREAKS,
    JSON.stringify(streaks || {})
  );
}

// 日付を日本時間の「2026-10-25」の形にする（なければきょう）
function mealBuildScriptDateKey_(date) {
  return Utilities.formatDate(date || new Date(), MEAL_APP_TIMEZONE, 'yyyy-MM-dd');
}

// 前の日（yyyy-MM-dd）。日本の昼の時刻から 24 時間ひく（GAS のタイムゾーンの設定によらない）
function mealGetPreviousDateKey_(dateKey) {
  const date = new Date(`${String(dateKey || '').trim()}T12:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return '';
  return mealBuildScriptDateKey_(new Date(date.getTime() - 86400000));
}

// しょくじからの呼び出しの本人：くらぶボットのツールの受け口が LINE に確かめて、つないだボットの人（03_tool_api.gs）。
// 送られてきた userId は使わない（G4）。名前は、しょくじの人のシートにあるもの（なければ LINE のプロフィール）
function mealUseCaller_(user) {
  const known = mealGetUserById_(user.userId);
  mealState_().caller = { userId: user.userId, displayName: known && known.displayName ? known.displayName : displayNameOf_(user.userId), verified: true, verificationError: '' };
}

// 本人：mealUseCaller_ で決めた人（なければ断る）
function mealVerifyLiffIdentity_() {
  const caller = mealState_().caller;
  if (!caller || !caller.userId) throw mealUserError_('LINE でアプリを開きなおしてください（本人確認ができませんでした）');
  return caller;
}

// LINE の Messaging API を呼ぶ（鍵をつけて）。返事の JSON を返し、失敗ならエラーにする
function mealCallLineApi_(path, method, payload) {
  const accessToken = mealGetLineChannelAccessToken_();
  if (!accessToken) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  }

  const options = {
    method: method || 'get',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    muteHttpExceptions: true,
  };

  if (payload != null) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(`https://api.line.me${path}`, options);
  const statusCode = response.getResponseCode();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`LINE API error ${statusCode}: ${response.getContentText()}`);
  }

  const body = response.getContentText();
  return body ? JSON.parse(body) : {};
}

// 返事を送る。カードが受けつけられなかったときは、黙らずに文字だけで返す（H5）。
// 原因は LAST_LINE_ERRORS に残し、文字には管理者にだけ短く添える（ふつうの人には仕組みの言葉を出さない）
function mealReplyLineMessages_(replyToken, messages) {
  if (!replyToken || !messages || !messages.length) return;
  messages = withToolSender_('meal', messages); // 送り主は「しょくじ〜ShoQuji〜」（61_meal.gs の sender）
  try {
    mealCallLineApi_('/v2/bot/message/reply', 'post', {
      replyToken: replyToken,
      messages: messages,
    });
  } catch (error) {
    mealRememberLineError_('reply', error, messages);
    if (messages.every(message => message.type === 'text')) throw error;
    // 一度断られると返事の合図（reply token）は使えなくなるので、文字はその人あてに push で送る
    const userId = mealState_().lineEventUserId || '';
    if (!userId) throw error;
    try {
      mealCallLineApi_('/v2/bot/message/push', 'post', {
        to: userId,
        messages: [mealBuildFallbackText_(messages, error, userId)],
      });
    } catch (fallbackError) {
      mealRememberLineError_('push-fallback', fallbackError, []);
      throw new Error(`カード：${String(error && error.message || error).slice(0, 300)} ／ 文字：${String(fallbackError && fallbackError.message || fallbackError).slice(0, 200)}`);
    }
  }
}

// 今のできごとを送ってきた人（管理者かどうかで、失敗の添え書きを変える）
function mealSetLineEventUser_(userId) {
  mealState_().lineEventUserId = String(userId || '');
  mealSetMasterViewer_(userId);
}

// カードの代わりの文字（カードの altText をつなげる。最後のクイックリプライは引きつぐ）
function mealBuildFallbackText_(messages, error, toUserId) {
  const altText = messages.map(message => message.altText || message.text || '').filter(Boolean).join('\n');
  const userId = toUserId || mealState_().lineEventUserId || '';
  const note = userId && mealIsAdminUser_(userId)
    ? `（管理者へ：カードを出せませんでした。${String(error && error.message || '').slice(0, 300)}）`
    : '';
  const fallback = {
    type: 'text',
    text: [altText || '記録しました', note].filter(Boolean).join('\n\n').slice(0, 4900),
  };
  const last = messages[messages.length - 1];
  if (last && last.quickReply) fallback.quickReply = last.quickReply;
  return fallback;
}

// 文字1通だけで返す
function mealReplyText_(replyToken, text) {
  mealReplyLineMessages_(replyToken, [{ type: 'text', text: text }]);
}

// 最後の LINE のエラー（5件）を Script Properties の LAST_LINE_ERRORS に残す（GAS の画面から見られる）
function mealRememberLineError_(kind, error, messages) {
  try {
    const props = props_();
    const list = JSON.parse(props.getProperty('LAST_LINE_ERRORS') || '[]');
    list.unshift({
      at: Utilities.formatDate(new Date(), MEAL_APP_TIMEZONE, 'yyyy-MM-dd HH:mm:ss'),
      kind: kind,
      error: String(error && error.message || error).slice(0, 800),
      sample: JSON.stringify(messages || []).slice(0, 400),
    });
    props.setProperty('LAST_LINE_ERRORS', JSON.stringify(list.slice(0, 5)));
  } catch (ignored) {
    // 残せなくても止めない
  }
}

// その人へメッセージを送る（push。くらぶボットの push_。送れる数を分け合う。使う人がしたことの返事なので 'high'）。
// カードが断られたら文で送りなおす（push_ の中で）。送れなかったらエラーにする（呼んだ側が「送れたか」を返すため）
function mealPushLineMessages_(userId, messages) {
  if (!userId || !messages || !messages.length) return;
  if (!push_(userId, withToolSender_('meal', messages), 'high')) throw new Error('push できませんでした');
}

// LINE に送られた写真の中身を取ってくる
function mealFetchLineMessageContentBlob_(messageId) {
  const accessToken = mealGetLineChannelAccessToken_();
  if (!accessToken) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  }
  const response = UrlFetchApp.fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
    method: 'get',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(`LINE content API error ${response.getResponseCode()}: ${response.getContentText()}`);
  }
  return response.getBlob();
}

// 写真をドライブ（決めたフォルダか、マイドライブ）に置き、ファイルを返す
function mealSaveLineImageToDrive_(blob, fileName) {
  const folderId = mealGetDriveFolderId_();
  const targetFileName = String(fileName || '').trim() || `line-image-${Utilities.getUuid()}`;
  const driveFile = folderId
    ? DriveApp.getFolderById(folderId).createFile(blob.setName(targetFileName))
    : DriveApp.createFile(blob.setName(targetFileName));
  driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return {
    fileId: driveFile.getId(),
    url: driveFile.getUrl(),
    name: driveFile.getName(),
  };
}

// 写真の付け先をえらぶあいだ、写真のことを10分だけ覚えて、そのための印を返す
function mealCachePendingImageAttachment_(payload) {
  const token = Utilities.getUuid();
  cache_().put(
    `${MEAL_PENDING_IMAGE_ATTACHMENT_CACHE_PREFIX}${token}`,
    JSON.stringify(payload || {}),
    60 * 60 * 6
  );
  return token;
}

// 印で覚えておいた写真のことを取り出して消す（1回だけ使える。なければ null）
function mealTakePendingImageAttachment_(token) {
  const key = `${MEAL_PENDING_IMAGE_ATTACHMENT_CACHE_PREFIX}${String(token || '').trim()}`;
  const cache = cache_();
  const raw = cache.get(key);
  if (!raw) return null;
  cache.remove(key);
  return JSON.parse(raw);
}

// トークに「入力中…」を出す（返事をするときだけ）
function mealShowLineLoadingAnimation_(chatId, loadingSeconds) {
  if (!chatId) return;
  mealCallLineApi_('/v2/bot/chat/loading/start', 'post', {
    chatId: chatId,
    loadingSeconds: mealNormalizeLoadingSeconds_(loadingSeconds),
  });
}

// 「入力中…」を出す秒数を 5〜60 にそろえる
function mealNormalizeLoadingSeconds_(value) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds)) return 5;
  return Math.max(5, Math.min(60, Math.round(seconds)));
}

// LINE の名前とアイコンを LINE に聞く（鍵がなければ null）
function mealGetLineProfile_(userId) {
  if (!userId || !mealGetLineChannelAccessToken_()) return null;
  return mealCallLineApi_(`/v2/bot/profile/${encodeURIComponent(userId)}`, 'get');
}

// しょくじ（LIFF）を、params の指定つきで開く URL を作る
function mealBuildLiffUrl_(params) {
  const query = mealBuildQueryString_(params || {});
  return `https://liff.line.me/${encodeURIComponent(mealGetLiffId_())}${query ? `?${query}` : ''}`;
}

// オブジェクトを「a=1&b=2」の形にする（空の値はのぞく）
function mealBuildQueryString_(params) {
  return Object.keys(params)
    .filter(key => params[key] != null && String(params[key]).trim() !== '')
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join('&');
}

// 「a=1&b=2」をオブジェクトにする（ボタンの data を読む）
function mealParseQueryString_(value) {
  return String(value || '')
    .split('&')
    .filter(Boolean)
    .reduce((acc, pair) => {
      const delimiterIndex = pair.indexOf('=');
      const rawKey = delimiterIndex >= 0 ? pair.slice(0, delimiterIndex) : pair;
      const rawValue = delimiterIndex >= 0 ? pair.slice(delimiterIndex + 1) : '';
      acc[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue);
      return acc;
    }, {});
}

// ---- 外から来た文字をシートに書く・長さをそろえる・同時に書く ----

// 外から来た文字の長さの上限
const MEAL_TEXT_LIMIT = { name: 60, flavor: 40, unit: 40, note: 200, displayName: 60, url: 500, key: 64, query: 60 };

// 文字を前後の空白なしで、max 字までにする
function mealClampText_(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

// 1行を、列の並びでシートに書ける形に（文字は safeCell を通して、式として動かないように。selfcheck.gs）
function mealToSheetRow_(columns, record) {
  return columns.map(key => safeCell_(record[key] ?? null));
}

// 使う人に見せてよいエラー。これ以外のエラーは、やさしい言葉に置きかえ、中身は実行ログにだけ出す
function mealUserError_(message) {
  const error = new Error(message);
  error.forUser = true;
  return error;
}

// 使う人に出すエラーのことば（やさしいことば。中身は実行ログにだけ残す）
function mealPublicErrorMessage_(error) {
  if (error && error.forUser) return String(error.message || '');
  console.error(`[meal] ${error && error.stack || error}`);
  return 'うまくいきませんでした。少し待って、もう一度ためしてね。';
}

// 行の番号が変わる書きこみ（足す・直す・消す）は1人ずつ。中で呼びなおしても待たない
function mealWithSheetLock_(fn) {
  const state = mealState_();
  if (state.sheetLocked) return fn();
  const lock = scriptLock_();
  lock.waitLock(20000);
  state.sheetLocked = true;
  try {
    return fn();
  } finally {
    state.sheetLocked = false;
    lock.releaseLock();
  }
}
