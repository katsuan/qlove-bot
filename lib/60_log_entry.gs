/**
 * 60_log_entry.gs：機能「📝 記録」の受け口（LOgBOT の入口 entry/01_entry.js から）
 * 中身：だれが送ったかから、できることを決める（policy）・文字とボタンの振り分け・Alfred からの記録・決めた時間の知らせ・送る
 *
 * 前の LOgBOT の入口がしていたことのうち、
 *   LINE の Webhook の合言葉・持ち主の登録（#持ち主）・#テスト・「入力中…」 … くらぶボット共通（01_router.gs・04_members.gs・07_test_window.gs）
 *   LINE に送る（LineApiDriver） … くらぶボットの reply_・push_（カードが断られたら文で送りなおす。送れる数を分け合う）
 *   15分ごとの remindIfNoRecord … くらぶボットの1時間おきの見張り（logHourly_。知らせの時刻をすぎた最初の回に送る）
 * スクリプト プロパティ（くらぶボットの入口の）：ALFRED_SECRET（Alfred から呼ぶときの合言葉）・GITHUB_*（60_log_github.gs）・
 *   LOG_REMIND_AT・LOG_REMIND_MODE・LOG_REMIND_OFF・LOG_REMIND_SENT・LOG_TUZUQ_NOTIFY（「# 通知」で変わる）
 * 呼ばれるところ：60_log.gs の onText・onPostback・webhook・hourly
 */

const LOG_MAX_TEXT_LENGTH_ = 2000;

/**
 * だれが送ったかから、できることを決める
 * - 持ち主（くらぶボットの持ち主）が送ったものは、1対1でもグループでも GitHub に書きこむ
 * - ほかの人（持ち主が許した人）のものはシートだけ
 */
function logBuildPolicy_(event, role) {
  const lineId = String((event && event.source && event.source.userId) || '').trim();
  const sourceType = String((event && event.source && event.source.type) || '').trim();
  const sourceApp = String((event && event.meta && event.meta.sourceApp) || '').toLowerCase();
  const isOwner = role === 'owner' && Boolean(lineId) && lineId === ownerUserId_();
  return {
    userId: lineId,
    isOwner,
    canCommitGithub: isOwner && ['user', 'group', 'room'].indexOf(sourceType) >= 0,
    logSource: sourceApp === 'alfred' ? 'ALFRED' : 'LINE',
  };
}

/**
 * 記録の文字・ボタンを1つ受けて、返事のメッセージの並びを返す（使える人だけ。呼ぶ前に確かめる）
 *   「# 通知 …」（知らせの設定）→「# 設定」→ ふつうの記録（60_log_event.gs の logHandleLineEvent_）
 */
function logRouting_(event, role) {
  if (!event) return [];
  logLimitEventText_(event);
  const policy = logBuildPolicy_(event, role);

  // 記録がない日の知らせの設定（# 通知）。記録はしない
  const remindArg = logParseRemindCommand_(event);
  if (remindArg !== null) return [logHandleRemindCommand_(remindArg, policy)];

  // いまの設定（# 設定）。記録はしない
  if (logIsSettingsCommand_(event)) return [logHandleSettingsCommand_(policy)];

  return logHandleLineEvent_(event, policy);
}

/** 長すぎる文字を切る */
function logLimitEventText_(event) {
  if (event && event.message && typeof event.message.text === 'string' && event.message.text.length > LOG_MAX_TEXT_LENGTH_) {
    event.message.text = event.message.text.slice(0, LOG_MAX_TEXT_LENGTH_);
  }
}

/** 知らせ（push）を送る（急ぎでない知らせ。くらぶボットの push_。カードが断られたら文で送りなおす）。送れたら true */
function logPushMessages_(to, messages) {
  if (!to || !messages || !messages.length) return false;
  return push_(to, messages, 'normal');
}

/** LINE の API を GET で読む（読めなければ null）。path は 'v2/bot/message/quota' など */
function logLineApiGet_(path) {
  return lineGet_(String(path).replace(/^v2\/bot\//, ''));
}

/** 1時間おきの見張り：決めた時間の知らせ（持ち主だけ。1日1通まで）。くらぶボットの見張りの形で返す */
function logHourly_(now) {
  const status = logRunReminder_(now instanceof Date ? now : new Date());
  return { checked: status === 'off' || status === 'noone' ? 0 : 1, sent: status === 'sent' ? 1 : 0, failed: status === 'fail' ? 1 : 0, skippedForQuota: 0, status };
}

/* ==================================================
 * Alfred（持ち主の Mac から記録する）
 * 本文 { sourceApp: "alfred", secret, text }。合言葉はスクリプト プロパティの ALFRED_SECRET。
 * 持ち主の記録として、LINE で送ったのと同じに記録する（返事は送らない：返事の合図がないため）
 * ================================================== */

/** Alfred からの呼び出しか（本文の sourceApp）。ちがえば null。合言葉がちがう・持ち主がいない・文がないときは { ok: false } */
function logAlfredWebhook_(body) {
  if (!body || String(body.sourceApp || '').toLowerCase() !== 'alfred') return null;
  const expected = propText_('ALFRED_SECRET');
  const secret = String(body.secret || '').trim();
  const text = String(body.text || '').trim();
  if (!expected || !secret || !sameText_(secret, expected) || !ownerUserId_() || !text) return { ok: false };
  logRouting_(logBuildPseudoLineEventFromAlfred_(text), 'owner');
  return { ok: true, route: 'alfred' };
}

/** Alfred の文を、LINE の出来事と同じ形にする（持ち主の1対1。送られてきた userId は使わない） */
function logBuildPseudoLineEventFromAlfred_(text) {
  return {
    type: 'message',
    replyToken: '', // 返事はしない
    source: { type: 'user', userId: ownerUserId_() },
    message: { type: 'text', text: text },
    meta: { sourceApp: 'alfred' },
  };
}
