/**
 * 01_router.gs：受け口は1つ（ウェブアプリの URL）。ここで振り分ける
 *
 *   ?key=WEBHOOK_KEY つき        … LINE の Webhook。合言葉が合わなければ何もしない
 *   本文が { app: "qlove", … }   … くらぶのツール（ページ）からの呼び出し（03_tool_api.gs）
 *   機能の webhook が受けるもの  … 例：記録の Alfred（{ sourceApp: "alfred", secret, text }。合言葉は機能が確かめる）
 *   それ以外                     … 何もしない（いつも同じ空の返事）
 *
 * LINE の出来事の振り分け
 *   postback  … data の m=（core か機能の key）。使っていない機能なら、そう返す
 *   位置情報  … 機能を順番（order）に聞き、受けとった機能が返事する（天気：「📍 地点を足す」を押した人の位置情報）
 *   写真      … 機能を順番に聞く（しょくじ：食事の写真を記録に付ける）
 *   文字      … 決まった順：#持ち主 → #テスト（持ち主）→ くらぶの言葉（メニュー）→ 機能の言葉（order 順）→ 機能の決まった形の文（onText）→ 1対1 なら案内
 *               グループでは、決まった言葉にだけ返す（ふだんの会話にまじらない）
 * 呼ばれるところ：00_public.gs の botWebhook（入口の doPost）。中身：受け口・出来事の振り分け・postback の振り分け・「入力中…」を出すかの判断
 */

const OWNER_CLAIM_PATTERN_ = /^[#＃]\s*(持ち主|もちぬし|owner)$/iu;
const TEST_PATTERN_ = /^[#＃]\s*(テスト|てすと|test)$/iu;
const CORE_WORDS_ = ['メニュー', 'くらぶ', 'できること', '🧩 機能'];

/** 受け口：?key= があれば LINE の Webhook（合言葉が合うときだけ）、本文が { app: "qlove" } ならツールからの呼び出し。いつも JSON の返事 */
function handleWebhook_(e) {
  const parameter = (e && e.parameter) || {};
  let body = null;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (error) {
    body = null;
  }
  if (Object.prototype.hasOwnProperty.call(parameter, 'key')) {
    const key = propText_('WEBHOOK_KEY');
    if (!key || !sameText_(String(parameter.key), key) || !body) return jsonOutput_({});
    (Array.isArray(body.events) ? body.events.slice(0, 20) : []).forEach((event) => {
      try {
        handleEvent_(event);
      } catch (error) {
        console.error(`EVENT_FAILED: ${error.message}`);
        writeLog_('event:error', error.message); // qcheck-ok: G2 シートの「動作の記録」にだけ書く（返事には入れない）
      }
    });
    return jsonOutput_({});
  }
  if (body && body.app === 'qlove') return jsonOutput_(handleToolCall_(body));
  // 機能ごとの受け口（記録：Alfred の { sourceApp: "alfred", secret, text }。合言葉は機能が確かめる）
  for (const m of body ? enabledModules_().filter((x) => x.webhook) : []) {
    try {
      const out = m.webhook(body);
      if (out) return jsonOutput_(out);
    } catch (error) {
      writeLog_(`${m.key}:webhook`, error.message); // qcheck-ok: G2 シートの「動作の記録」にだけ書く（返事には入れない）
      return jsonOutput_({ ok: false });
    }
  }
  return jsonOutput_({});
}

/** JSON の返事（TextOutput）にする */
function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

// 合言葉は最後まで比べる（途中で止めると、合っている長さが時間でわかってしまう）
function sameText_(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

// 返事をしない postback（メニューのタブの切りかえ）。「入力中…」を出すと消えずに残るので出さない（ux.md の H1）
const NO_REPLY_ACTIONS_ = ['tab'];

/** 「入力中…」を出す出来事か：ボタン（postback。返事をしないものは除く）・位置情報・機能の言葉・決まった形の文・#テスト（持ち主） */
function shouldShowLoading_(event, role) {
  if (!isOneToOne_(event)) return false;
  if (event.type === 'postback') {
    const p = parsePostback_(event.postback && event.postback.data);
    if (String(p.m || '') === 'core') return !NO_REPLY_ACTIONS_.includes(String(p.a || ''));
    const module = moduleOf_(String(p.m || ''));
    return !(module && module.noReply && module.noReply(p));
  }
  if (event.type !== 'message' || !event.message) return false;
  if (event.message.type === 'location') return true;
  if (event.message.type === 'image') return Boolean(role) && enabledModules_().some((m) => m.onImage);
  if (event.message.type !== 'text') return false;
  const text = String(event.message.text || '').trim();
  if (TEST_PATTERN_.test(text)) return role === 'owner';
  if (CORE_WORDS_.includes(text)) return true;
  return enabledModules_().some((m) => (m.words || []).includes(text) || (m.textPattern && (role || !m.textForMembers) && m.textPattern.test(text)));
}

/** LINE の出来事を1つ振り分けて返事する（友だち・グループに入った・postback・位置情報・文字） */
function handleEvent_(event) {
  if (!event || event.mode === 'standby') return;
  const userId = userIdOf_(event);
  const role = roleOf_(userId);
  if (shouldShowLoading_(event, role)) showLoading_(event, 60);

  if (event.type === 'follow') return reply_(event, [buildWelcomeCard_(role)]);
  if (event.type === 'join') return reply_(event, [textMessage_(`${BOT_NAME_}です。このトークに、くらぶのツールの知らせを送れます。`, [postback_('🧩 できること', 'm=core&a=modules')])]);
  if (event.type === 'postback') return reply_(event, postbackReply_(event, parsePostback_(event.postback && event.postback.data), role));
  if (event.type !== 'message' || !event.message) return;

  if (event.message.type === 'location') {
    for (const m of enabledModules_()) {
      const out = m.onLocation ? m.onLocation(event, role) : null;
      if (out) return reply_(event, out);
    }
    return isOneToOne_(event) ? reply_(event, [helpText_(role)]) : null;
  }
  if (event.message.type === 'image') {
    for (const m of enabledModules_()) {
      const out = m.onImage ? m.onImage(event, role) : null;
      if (out) return reply_(event, out);
    }
    return;
  }
  if (event.message.type !== 'text') return;

  const text = String(event.message.text || '').trim();
  if (OWNER_CLAIM_PATTERN_.test(text) && isOneToOne_(event)) return reply_(event, [ownerClaimReply_(userId)]);
  // #テスト は持ち主の1対1 だけ。ほかの人には知らない言葉と同じ返事（窓口があることを見せない。ux.md の H11）
  if (TEST_PATTERN_.test(text) && isOneToOne_(event) && role === 'owner') return reply_(event, [buildTestWindowCard_()]);
  if (CORE_WORDS_.includes(text)) return reply_(event, [buildModulesCard_(role)]);
  for (const m of enabledModules_()) {
    if (m.menu && (m.words || []).includes(text)) return reply_(event, [].concat(m.menu(event, role)));
  }
  // 機能ごとの決まった形の文（例：そらくるから届く「📍 地点を足す 35.17,136.88 名古屋」）
  for (const m of enabledModules_()) {
    const out = m.onText ? m.onText(event, text, role) : null;
    if (out) return reply_(event, out);
  }
  if (isOneToOne_(event)) return reply_(event, [helpText_(role)]);
}

/** ふつうの文が届いたときの案内（使える人には機能のボタン、まだの人には使いたい・持ち主の登録） */
function helpText_(role) {
  return role
    ? textMessage_('下のボタンから選んでね。', coreQuick_(role))
    : textMessage_(`${BOT_NAME_}は、持ち主が許した人だけが使えます。`, coreQuick_(role));
}

/** 使えない人への返事（持ち主の許可が要る） */
function notAllowedText_() {
  return textMessage_('使うには、このボットの持ち主の許可が要ります。', coreQuick_(''));
}

/** postback（m= と a=）を機能かくらぶ共通の操作に振り分けて、返事のメッセージを返す。持ち主だけの操作は、押した人を見て決める */
function postbackReply_(event, p, role) {
  const m = String(p.m || '');
  if (m && m !== 'core') {
    const module = moduleOf_(m);
    if (!module) return [textMessage_('この機能は、いまこのボットでは使っていません。', coreQuick_(role))];
    if (p.a === 'menu' && module.menu) return [].concat(module.menu(event, role));
    return module.onPostback ? module.onPostback(event, p, role) : [helpText_(role)];
  }
  const a = String(p.a || '');
  // 持ち主だけのもの（ほかの人が押しても、前のボタンが残っていても、何も変えない）
  if (['allow', 'deny', 'members', 'unallow', 'test'].includes(a)) {
    if (role !== 'owner') return [textMessage_('これは持ち主だけが使えます。')];
    if (a === 'members') return [buildMembersCard_(membersForCard_())];
    if (a === 'test') return testWindowReply_(String(p.t || ''));
    return [memberDecisionReply_(a, String(p.u || ''))];
  }
  switch (a) {
    case 'tab':
      return []; // メニューのタブの切りかえ：返事をしない（ux.md の H1）
    case 'people':
      if (role === 'owner') return [buildMembersCard_(membersForCard_())];
      return [role ? textMessage_('あなたは、このボットを使えます（持ち主が許した人）。', coreQuick_(role)) : helpText_(role)];
    case 'modules':
      return [buildModulesCard_(role)];
    case 'owner':
      return [isOneToOne_(event) ? ownerClaimReply_(userIdOf_(event)) : textMessage_('持ち主の登録は、ボットとの1対1 のトークでしてね。')];
    case 'request':
      return [memberRequestReply_(event)];
    case 'link':
      return [linkCodeReply_(event, role)];
    default:
      return [helpText_(role)];
  }
}
