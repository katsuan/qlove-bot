/**
 * 60_log_remind.gs：機能「📝 記録」の、決めた時間の知らせ（LOgBOT の入口 entry/04_remind.js から）
 * 中身：# 通知 の返事と設定・今月の知らせの残り・知らせを送る（logRunReminder_）
 * 呼ばれるところ：60_log_entry.gs（# 通知・1時間おきの見張り）・60_log_settings.gs
 */

/* ==================================================
 * 決めた時間の知らせ（このボットから持ち主だけに。1日1通まで）
 * - くらぶボットの1時間おきの見張りが動き、知らせの時刻（はじめは 20:00）をすぎた最初の回に、1日1回だけ中身を作って push（21:30 なら 22時台）
 * - 送り方（LOG_REMIND_MODE）：daily（はじめ。毎日まとめ）・missing（まだの習慣があるときだけ）・weekly（日曜にふりかえり）
 * - 連続が途切れそう・週の目標が途切れそう・記録のない日がつづく、で言葉を変える（60_log_reminder.gs）
 * - つづくで見ている習慣がわかれば、そのうち今日まだのものを並べる（全部すんでいれば送らない）
 * - わからなければ、自分でした記録が1件もない日に知らせる（CarPlay・出退勤・充電などの自動の記録は数えない）
 * - LINE で「# 通知 21:30」「# 通知 毎日／週／まだのときだけ」「# 通知 off」「# 通知 on」、いまの設定は「# 通知」（持ち主だけ）
 * ================================================== */

/** 決めた時間の知らせを止めているか */
function logIsRemindOff_() {
  return propText_('LOG_REMIND_OFF') === '1';
}

const LOG_REMIND_DEFAULT_AT_ = '20:00';
const LOG_REMIND_PATTERN_ = /^\s*[#＃]\s*(通知|リマインド|remind)\s*(.*)$/iu;

/** 「# 通知 …」なら、その後ろの文字（なければ ''）。ちがえば null */
function logParseRemindCommand_(event) {
  if (!event || event.type !== 'message' || !event.message || event.message.type !== 'text') return null;
  const m = String(event.message.text || '').match(LOG_REMIND_PATTERN_);
  return m ? String(m[2] || '').trim() : null;
}

/** 決めた時間の知らせの時刻（REMIND_AT。なければ 20:00） */
function logRemindAt_() {
  const at = propText_('LOG_REMIND_AT');
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(at) ? at : LOG_REMIND_DEFAULT_AT_;
}

/** 「21:30」「21時」「9:05」→「21:30」「21:00」「09:05」。ちがえば '' */
function logNormalizeRemindTime_(text) {
  const t = String(text || '').replace(/：/g, ':').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).trim();
  let m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) m = t.match(/^(\d{1,2})\s*時(?:\s*(\d{1,2})\s*分?)?$/);
  if (!m) return '';
  const h = Number(m[1]);
  const mi = Number(m[2] || 0);
  if (h > 23 || mi > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

const LOG_REMIND_MODES_ = { daily: 'きょうと今週のまとめ', missing: 'まだの習慣があるときだけ', weekly: '今週のふりかえり' };

/** 知らせの送り方（daily・missing・weekly。なければ daily） */
function logRemindMode_() {
  const mode = propText_('LOG_REMIND_MODE');
  return LOG_REMIND_MODES_[mode] ? mode : 'daily';
}

/** 「毎日」「週」「まだのときだけ」→ daily・weekly・missing。ちがえば '' */
function logParseRemindMode_(word) {
  const w = String(word || '').trim().toLowerCase();
  if (/^(毎日|まいにち|毎晩|daily|まとめ)$/.test(w)) return 'daily';
  if (/^(週|週次|毎週|まいしゅう|weekly|週ごと)$/.test(w)) return 'weekly';
  if (/^(まだのときだけ|まだ|未記録|missing|ないとき)$/.test(w)) return 'missing';
  return '';
}

/** 知らせの時刻と送り方を、1行の文にする */
function logDescribeRemind_() {
  const mode = logRemindMode_();
  return `🔔 ${mode === 'weekly' ? `日曜の ${logRemindAt_()}` : `毎日 ${logRemindAt_()}`} に、${LOG_REMIND_MODES_[mode]}を送ります。`;
}

/** つづくで記録したときに、トークへ知らせるか（はじめは知らせない。push の数を使うため） */
function logTuzuqNotifyOn_() {
  return propText_('LOG_TUZUQ_NOTIFY').toLowerCase() === 'on';
}

/** つづくで記録したときの知らせが、あるかないかを1行の文にする */
function logDescribeTuzuqNotify_() {
  return `📨 つづくで記録したときの知らせ：${logTuzuqNotifyOn_() ? 'あり（記録のたびに1通）' : 'なし'}`;
}

/** 「# 通知」の返事のクイックリプライ：押すだけで設定を変えられる（いまの設定は出さない） */
function logRemindQuickReply_() {
  const off = logIsRemindOff_();
  const mode = logRemindMode_();
  const at = logRemindAt_();
  const item = (label, text) => ({ type: 'action', action: { type: 'message', label, text } });
  const items = [item('🔔 知らせの見本', '# 通知 ためす')];
  if (mode !== 'daily') items.push(item('🗓 毎日まとめ', '# 通知 毎日'));
  if (mode !== 'weekly') items.push(item('📅 週ごと（日曜）', '# 通知 週'));
  if (mode !== 'missing') items.push(item('⬜ まだのときだけ', '# 通知 まだのときだけ'));
  ['20:00', '21:00', '22:00'].filter(t => t !== at).forEach(t => items.push(item(`🕗 ${Number(t.slice(0, 2))}時にする`, `# 通知 ${t}`)));
  items.push(logTuzuqNotifyOn_() ? item('📭 記録のたびは知らせない', '# 通知 記録 off') : item('📨 記録のたびに知らせる', '# 通知 記録 on'));
  items.push(off ? item('🔔 また送る', '# 通知 on') : item('🔕 止める', '# 通知 off'));
  return { items };
}

/** 「# 通知 …」の返事（持ち主だけ。変えるボタンつき） */
function logHandleRemindCommand_(arg, policy) {
  if (!policy.isOwner) return { type: 'text', text: '知らせの設定は、このボットの持ち主だけが変えられます。' };
  const reply = logHandleRemindCommandText_(arg);
  // 見本（クイックリプライつき）はそのまま。ほかは、押すだけで変えられるクイックリプライを付ける
  if (!reply.quickReply) reply.quickReply = logRemindQuickReply_();
  return reply;
}

/**
 * 今月、このボットから送れる知らせ（push）の残り（LINE の API の答えから）。読めなければ ''
 * - GET /v2/bot/message/quota（上限）と /quota/consumption（今月使った数）。返事（reply）は数えない
 */
function logDescribePushQuota_() {
  const quota = logLineApiGet_('v2/bot/message/quota');
  const used = logLineApiGet_('v2/bot/message/quota/consumption');
  if (!quota || !used || typeof used.totalUsage !== 'number') return '';
  if (quota.type !== 'limited' || typeof quota.value !== 'number') return `📮 今月の知らせ：${used.totalUsage}通 送りました（上限なし）`;
  const left = Math.max(0, quota.value - used.totalUsage);
  return `📮 今月の知らせ：のこり ${left}通（${quota.value}通のうち ${used.totalUsage}通 使用。返事は数えません）${left <= Math.ceil(quota.value / 10) ? '\n⚠️ のこりが少なめです。「# 通知 記録 off」で、記録のたびの知らせを止められます' : ''}`;
}

/** 「# 通知 …」のあとの言葉で、知らせの設定を見る・変える。返事を返す */
function logHandleRemindCommandText_(arg) {
  const help = '変える：# 通知 21:30 ／ # 通知 毎日・週・まだのときだけ\nつづくの記録：# 通知 記録 on ／ off\n見本：# 通知 ためす\n止める：# 通知 off';
  const note = logHasReminderTrigger_() ? '' : '\n（見張りがまだ動いていません。GAS エディタで setupBot を1回実行してください）';
  if (!arg) {
    const off = logIsRemindOff_();
    const quota = logDescribePushQuota_();
    const status = [off ? '🔕 知らせは止めています。' : logDescribeRemind_(), logDescribeTuzuqNotify_()].concat(quota ? [quota] : []);
    const card = logBuildInfoCardOrNull_({
      tag: '🔔 知らせの設定',
      title: off ? '知らせは止めています' : `${logRemindAt_()} に知らせます`,
      kind: off ? 'warning' : 'report',
      sections: [{ title: 'いま', rows: status }, { title: '変える', rows: ['下のボタンを押すだけで変わります'].concat(note ? [note.trim()] : []) }],
      buttons: [{ label: '🧪 見本を見る', text: '# 通知 ためす' }, { label: '⚙️ いまの設定', text: '# 設定' }],
      altText: `🔔 知らせの設定：${status[0]}`,
    });
    return card || { type: 'text', text: `${status.join('\n')}\n\n${help}${note}` };
  }
  // つづくで記録したときの知らせ（push）を、持ち主が選ぶ
  const notify = String(arg).match(/^記録\s*(on|オン|あり|する|知らせる|off|オフ|なし|しない|知らせない)$/i);
  if (notify) {
    const on = /^(on|オン|あり|する|知らせる)$/i.test(notify[1]);
    props_().setProperty('LOG_TUZUQ_NOTIFY', on ? 'on' : 'off');
    return { type: 'text', text: `${logDescribeTuzuqNotify_()}${on ? '\n（LINE の月の上限の数を使います）' : ''}` };
  }
  // 今夜の知らせを、いま返事で見る（push ではないので、月の上限を使わない。送った印も付けない）
  if (/^(ためす|試す|test|テスト|みる|見る)$/i.test(arg)) {
    const reminder = logBuildNoRecordReminder_([ownerUserId_()], new Date(), logRemindMode_());
    if (!reminder || !reminder.send) return { type: 'text', text: `🔕 いまの設定（${LOG_REMIND_MODES_[logRemindMode_()]}）だと、きょうは送りません。` };
    if (reminder.card) {
      // 見本：届くものと同じカード。押すだけで変えられるクイックリプライを付ける
      return Object.assign({}, reminder.card, { altText: `🧪 見本：${reminder.card.altText}`, quickReply: logRemindQuickReply_() });
    }
    return {
      type: 'text',
      text: `🧪 知らせの見本（決めた時間に届くもの）\n\n${reminder.text}`,
      quickReply: { items: reminder.quick.map(q => ({ type: 'action', action: { type: 'uri', label: q.label, uri: q.uri } })) },
    };
  }
  if (/^(off|オフ|なし|止める|とめる|やめる)$/i.test(arg)) {
    props_().setProperty('LOG_REMIND_OFF', '1');
    return { type: 'text', text: '🔕 知らせを止めました。また使うときは「# 通知 on」と送ってね。' };
  }
  // 「週 21:00」のように、まとめて送ってもよい
  let at = '';
  let mode = '';
  let bad = false;
  arg.split(/[\s　、,]+/).filter(Boolean).forEach(word => {
    if (/^(on|オン)$/i.test(word)) return;
    const m = logParseRemindMode_(word);
    const t = m ? '' : logNormalizeRemindTime_(word);
    if (m) mode = m;
    else if (t) at = t;
    else bad = true;
  });
  if (bad) return { type: 'text', text: `うまく読めませんでした。\n${help}` };
  if (at) props_().setProperty('LOG_REMIND_AT', at);
  if (mode) props_().setProperty('LOG_REMIND_MODE', mode);
  props_().deleteProperty('LOG_REMIND_OFF');
  return { type: 'text', text: `${logDescribeRemind_()}${note}` };
}

/** くらぶボットの1時間おきの見張りが動いているか（前回が2時間以内か） */
function logHasReminderTrigger_() {
  const last = props_().getProperty(HEARTBEAT_PROP_);
  return Boolean(last) && Date.now() - new Date(last).getTime() < 130 * 60000;
}

/**
 * @param {Date} now
 * @return {string} 何をしたか（off・early・done・had・sent・noone・fail）
 */
function logRunReminder_(now) {
  if (logIsRemindOff_()) return 'off';
  if (!ownerUserId_()) return 'noone';
  const today = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd');
  const hm = Utilities.formatDate(now, 'Asia/Tokyo', 'HH:mm');
  if (hm < logRemindAt_()) return 'early';
  if (props_().getProperty('LOG_REMIND_SENT') === today) return 'done';
  try {
    // 今日もう見たことにする（記録があっても、なくても。1日1回だけ）
    props_().setProperty('LOG_REMIND_SENT', today);
    // 中身は 60_log_reminder.gs：その日のようすで見出しを選び、言葉を日ごとに入れかえる
    const reminder = logBuildNoRecordReminder_([ownerUserId_()], now, logRemindMode_());
    if (!reminder || !reminder.send) return 'had';
    // カード（ライブラリが作る）。作れないときは文で
    const sent = logPushMessages_(ownerUserId_(), [reminder.card || {
      type: 'text',
      text: `${reminder.text}\n\n止める：# 通知 off`,
      quickReply: { items: reminder.quick.map(q => ({ type: 'action', action: { type: 'uri', label: q.label, uri: q.uri } })) },
    }]);
    return sent ? 'sent' : 'fail';
  } catch (ex) {
    console.error(`remind failed: ${String(ex && ex.message ? ex.message : ex)}`);
    return 'fail';
  }
}
