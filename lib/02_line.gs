/**
 * 02_line.gs：LINE の Messaging API（返事・push・入力中・プロフィール・送れる数）とメッセージの部品
 */

const LINE_API_ = 'https://api.line.me/v2/bot';
const LINE_DATA_API_ = 'https://api-data.line.me/v2/bot';

function lineRequest_(method, path, body, base) {
  const token = lineToken_();
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN がない');
  const options = { method: method, headers: { Authorization: `Bearer ${token}` }, muteHttpExceptions: true };
  if (body !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  return UrlFetchApp.fetch(`${base || LINE_API_}/${path}`, options);
}

function lineGet_(path) {
  try {
    const res = lineRequest_('get', path);
    return res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : null;
  } catch (error) {
    return null;
  }
}

/**
 * 返事。カードが断られたら（400）、文だけの返事にして push で送りなおす（返事の合図は1回しか使えない。ux.md の H5）
 */
function reply_(event, messages) {
  const list = (messages || []).filter(Boolean).slice(0, 5);
  if (!list.length || !event || !event.replyToken) return false;
  const res = lineRequest_('post', 'message/reply', { replyToken: event.replyToken, messages: list });
  const code = res.getResponseCode();
  if (code === 200) return true;
  writeLog_('reply:error', `${code} ${String(res.getContentText()).slice(0, 300)}`);
  if (code === 400 && list.some((m) => m.type === 'flex')) {
    const to = targetOf_(event).targetId;
    if (to) push_(to, [textMessage_(fallbackText_(list))], 'high');
  }
  return false;
}

/**
 * push。priority は 'normal'（急ぎでない知らせ：天気など）か 'high'（持ち主への知らせ・当日の知らせなど）。
 * 今月の送った数が上限の 80%（normal）・95%（high）をこえたら送らない（全部の機能で分け合う）
 */
function push_(to, messages, priority) {
  if (!hasPushRoom_(priority || 'normal')) {
    writeLog_('push:quota', `今月の送れる数が少ないので送らない（${priority || 'normal'}）`);
    return false;
  }
  const res = lineRequest_('post', 'message/push', { to: to, messages: (messages || []).slice(0, 5) });
  const code = res.getResponseCode();
  if (code === 200) {
    countPush_();
    return true;
  }
  writeLog_('push:error', `${code} ${String(res.getContentText()).slice(0, 300)}`);
  if (code === 400 && messages.some((m) => m.type === 'flex')) {
    const again = lineRequest_('post', 'message/push', { to: to, messages: [textMessage_(fallbackText_(messages))] });
    return again.getResponseCode() === 200;
  }
  return false;
}

/** 今月の push に余りがあるか（1回の呼び出しで1回だけ聞く）。上限がない・読めないときは送る */
function hasPushRoom_(priority) {
  if (!memo_.quota) {
    const quota = lineGet_('message/quota');
    const usage = quota && quota.type === 'limited' ? Number((lineGet_('message/quota/consumption') || {}).totalUsage) : NaN;
    memo_.quota = { limit: quota && quota.type === 'limited' ? Number(quota.value) : NaN, usage: usage };
  }
  const q = memo_.quota;
  if (!Number.isFinite(q.limit) || !Number.isFinite(q.usage)) return true;
  return q.usage < q.limit * (QUOTA_RATES_[priority] || QUOTA_RATES_.normal);
}

/** 送ったぶんを数える（同じ呼び出しの中で、続けて送るとき） */
function countPush_() {
  if (memo_.quota && Number.isFinite(memo_.quota.usage)) memo_.quota.usage += 1;
}

// カードが通らなかったときの文（altText をつなぐ）
function fallbackText_(messages) {
  const lines = messages.map((m) => (m.type === 'flex' ? m.altText : m.text)).filter(Boolean);
  return `${lines.join('\n')}\n（カードを出せなかったので、文で送りました）`.slice(0, 4900);
}

/** 返事に時間がかかる前の「入力中…」（1対1 だけ。ux.md の H1） */
function showLoading_(event) {
  const userId = event && event.source && event.source.type === 'user' ? event.source.userId : '';
  if (!userId) return;
  try {
    lineRequest_('post', 'chat/loading/start', { chatId: userId, loadingSeconds: 10 });
  } catch (error) {
    // 出せなくても返事はする
  }
}

function displayNameOf_(userId) {
  const profile = userId ? lineGet_(`profile/${encodeURIComponent(userId)}`) : null;
  return profile ? cleanText_(profile.displayName, 30) : '';
}

/** このトークの送り先（1対1 なら本人、グループ・ルームならそのトーク） */
function targetOf_(event) {
  const source = (event && event.source) || {};
  if (source.type === 'group') return { targetType: 'group', targetId: String(source.groupId || '').trim() };
  if (source.type === 'room') return { targetType: 'room', targetId: String(source.roomId || '').trim() };
  return { targetType: 'user', targetId: String(source.userId || '').trim() };
}

const userIdOf_ = (event) => String((event && event.source && event.source.userId) || '').trim();
const isOneToOne_ = (event) => Boolean(event && event.source && event.source.type === 'user');

// ---- メッセージの部品 ----

function withQuickReply_(message, actions) {
  const list = (actions || []).filter(Boolean).slice(0, 13);
  if (list.length) message.quickReply = { items: list.map((action) => ({ type: 'action', action: action })) };
  return message;
}

function textMessage_(text, actions) {
  return withQuickReply_({ type: 'text', text: String(text).slice(0, 4900) }, actions);
}

/** 押すと返事が来るボタン（postback）。data は「m=機能&a=すること&…」。ラベルは20字まで（クイックリプライ） */
function postback_(label, data, displayText) {
  return { type: 'postback', label: Array.from(label).slice(0, 20).join(''), data: data, displayText: displayText || label };
}

function parsePostback_(data) {
  const out = {};
  String(data || '').split('&').forEach((pair) => {
    const i = pair.indexOf('=');
    if (i > 0) out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
  });
  return out;
}

// ---- カードの部品（形は ux.md の H2：色の帯 → 中身 → 行動のボタン 2つまで） ----

const WEEK_ = ['日', '月', '火', '水', '木', '金', '土'];

/** "2026-10-26" → "10/26（月）" */
function dayLabel_(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEK_[d.getUTCDay()]}）`;
}

function header_(title, sub, color) {
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: color || BOT_COLOR_,
    paddingAll: '14px',
    contents: [
      { type: 'text', text: sub || BOT_NAME_, size: 'xs', color: '#FFFFFF', wrap: true },
      { type: 'text', text: title, size: 'lg', weight: 'bold', color: '#FFFFFF', wrap: true, margin: 'xs' }
    ]
  };
}

function smallText_(text, options) {
  return Object.assign({ type: 'text', text: text, size: 'xs', color: '#6B7280', wrap: true }, options || {});
}

function uriButton_(label, uri) {
  return { type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label: label, uri: uri } };
}

/** カードに置く postback のボタンは、聞き返すだけのものにする（あとで押されても困らない） */
function postbackButton_(label, data) {
  return { type: 'button', style: 'secondary', height: 'sm', action: { type: 'postback', label: label, data: data, displayText: label } };
}

function footer_(buttons) {
  return { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: buttons.filter(Boolean).slice(0, 2) };
}

function bubble_(altText, header, bodyContents, buttons) {
  const card = {
    type: 'flex',
    altText: String(altText).slice(0, 400),
    contents: { type: 'bubble', header: header, body: { type: 'box', layout: 'vertical', paddingAll: '16px', spacing: 'md', contents: bodyContents.filter(Boolean) } }
  };
  if (buttons && buttons.filter(Boolean).length) card.contents.footer = footer_(buttons);
  return card;
}
