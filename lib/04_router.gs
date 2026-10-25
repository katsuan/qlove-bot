/**
 * 04_router.gs：受け口は1つ（ウェブアプリの URL）。ここで振り分ける
 *
 *   ?key=WEBHOOK_KEY つき        … LINE の Webhook。合言葉が合わなければ何もしない
 *   本文が { app: "qlove", … }   … くらぶのツール（ページ）からの呼び出し（05_tool_api.gs）
 *   それ以外                     … 何もしない（いつも同じ空の返事）
 *
 * LINE の出来事の振り分け
 *   postback  … data の m=（core か機能の key）。使っていない機能なら、そう返す
 *   位置情報  … 機能を順番（order）に聞き、受けとった機能が返事する（天気：「📍 地点を足す」を押した人の位置情報）
 *   文字      … 決まった順：#持ち主 → #テスト（持ち主）→ くらぶの言葉（メニュー）→ 機能の言葉（order 順）→ 1対1 なら案内
 *               グループでは、決まった言葉にだけ返す（ふだんの会話にまじらない）
 */

const OWNER_CLAIM_PATTERN_ = /^[#＃]\s*(持ち主|もちぬし|owner)$/iu;
const TEST_PATTERN_ = /^[#＃]\s*(テスト|てすと|test)$/iu;
const CORE_WORDS_ = ['メニュー', 'くらぶ', 'できること', '🧩 機能'];

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
  return jsonOutput_({});
}

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

function handleEvent_(event) {
  if (!event || event.mode === 'standby') return;
  const userId = userIdOf_(event);
  const role = roleOf_(userId);

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
  if (event.message.type !== 'text') return;

  const text = String(event.message.text || '').trim();
  if (OWNER_CLAIM_PATTERN_.test(text) && isOneToOne_(event)) return reply_(event, [ownerClaimReply_(userId)]);
  // #テスト は持ち主の1対1 だけ。ほかの人には知らない言葉と同じ返事（窓口があることを見せない。ux.md の H11）
  if (TEST_PATTERN_.test(text) && isOneToOne_(event) && role === 'owner') return reply_(event, [buildTestWindowCard_()]);
  if (CORE_WORDS_.includes(text)) return reply_(event, [buildModulesCard_(role)]);
  for (const m of enabledModules_()) {
    if (m.menu && (m.words || []).includes(text)) return reply_(event, [m.menu(event, role)]);
  }
  if (isOneToOne_(event)) return reply_(event, [helpText_(role)]);
}

function helpText_(role) {
  return role
    ? textMessage_('下のボタンから選んでね。', coreQuick_(role))
    : textMessage_(`${BOT_NAME_}は、持ち主が許した人だけが使えます。`, coreQuick_(role));
}

function notAllowedText_() {
  return textMessage_('使うには、このボットの持ち主の許可が要ります。', coreQuick_(''));
}

function postbackReply_(event, p, role) {
  const m = String(p.m || '');
  if (m && m !== 'core') {
    const module = moduleOf_(m);
    if (!module) return [textMessage_('この機能は、いまこのボットでは使っていません。', coreQuick_(role))];
    if (p.a === 'menu' && module.menu) return [module.menu(event, role)];
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
