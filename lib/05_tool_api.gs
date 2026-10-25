/**
 * 05_tool_api.gs：くらぶのツール（ページ）からの呼び出し
 *
 * ページは、使う人が入れたこのボットの URL に POST する（本文は text/plain の JSON。Q キットの shared/qlove-bot.js）。
 *   { app: "qlove", v: 1, tool: "core" | 機能の key, action, liffId, idToken, … }
 *   → { ok: true, … } / { ok: false, error: "off" | "auth" | "link" | "code" | "many" | "notyou" | "bad" | "fail" }
 *
 * 本人の確かめ（決めたこと）
 *   ツールの LINE ログイン（LIFF）から見た ID と、このボットから見た ID は、別の番号になる（プロバイダーがちがう）。
 *   そこで、はじめに1回だけ「つなぐ番号」でひもづける：
 *     1. ボットで「🔗 ツールとつなぐ」→ 6けたの番号（10分）
 *     2. ツールに番号を入れる → ツールは LIFF の ID トークンと番号を送る（action: "link"）
 *     3. ID トークンを LINE（/oauth2/v2.1/verify）に確かめ、その人（sub）とボットの人をシート「つないだツール」にひもづける
 *   そのあとの呼び出しは、毎回 ID トークンを確かめ、ひもづいたボットの人として動く（送られてきた userId は使わない。G4）。
 *   ブラウザ版のツール（LIFF でない。そらくるなど）からボットに何かを入れるときは、ping の line（@…）で、ボットのトークに
 *   決まった形の文を入れて開く（https://line.me/R/oaMessage/@…/?文）。送るのは本人なので、ボットは送った人の役割で決める
 *   URL に合言葉を入れるやり方は、とらない：URL はツールの端末に残り（qlove:bot）、人に渡すこともあるので、
 *   合言葉を入れると端末に鍵を残すことになる（docs/security.md の W7）。ブラウザ版（LIFF でない）は、ping だけ受ける
 *   ID は SHA-256 にして残す（数えるだけ・比べるだけなので）
 */

const TOOL_API_VERSION_ = 1;
// くらぶのツールの LIFF のチャネル ID（LIFF の ID の「-」の前。秘密ではない）。ここにあるものだけ受ける
const TOOL_CHANNELS_ = {
  '2012187502': 'つづく',
  '2009927582': 'キロっく・くるかな',
  '2009927876': 'おくるん・ひっくり'
};
const LINE_ID_TOKEN_ISSUER_ = 'https://access.line.me';
const LINK_CODE_SECONDS_ = 600;
const LINK_TRIES_MAX_ = 5; // つなぐ番号のまちがいは、10分に5回まで

function handleToolCall_(body) {
  try {
    if (Number(body.v) !== TOOL_API_VERSION_) return { ok: false, error: 'bad' };
    const tool = String(body.tool || '');
    const action = String(body.action || '');
    // ping：URL が合っているか（だれでも。中身は返さない）
    if (tool === 'core' && action === 'ping') {
      // line：このボットの LINE の ID（@…。友だち追加にも使う公開のもの）。ツールは、これで「このボットに文を送る」リンクを作る
      return { ok: true, bot: BOT_NAME_, version: BOT_VERSION_, modules: enabledModules_().filter((m) => m.tool || m.onText).map((m) => m.key), line: botBasicId_() };
    }
    const who = verifyToolIdToken_(body.idToken, body.liffId);
    if (!who) return { ok: false, error: 'auth' };
    if (tool === 'core' && action === 'link') return linkTool_(who, body.code);
    const userId = linkedUserId_(who.subHash);
    if (!userId) return { ok: false, error: 'link' };
    if (!canUse_(userId)) return { ok: false, error: 'notyou' };
    const module = moduleOf_(tool);
    if (!module || !module.tool) return { ok: false, error: 'off' };
    const fn = module.tool[action];
    if (typeof fn !== 'function') return { ok: false, error: 'bad' };
    return fn(body, { userId: userId, role: roleOf_(userId) });
  } catch (error) {
    writeLog_('tool:error', error.message);
    return { ok: false, error: 'fail' };
  }
}

/** このボットの LINE の ID（@…）。6時間覚えておく。わからなければ "" */
function botBasicId_() {
  const cached = cache_().get('BOT_BASIC_ID');
  if (cached) return cached;
  const info = lineToken_() ? lineGet_('info') : null;
  const id = info && typeof info.basicId === 'string' && /^@[0-9a-z._-]{2,40}$/i.test(info.basicId) ? info.basicId : '';
  if (id) cache_().put('BOT_BASIC_ID', id, 21600);
  return id;
}

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8)
    .map((b) => ((b + 256) % 256).toString(16).padStart(2, '0'))
    .join('');
}

/** LIFF の ID トークンを LINE に確かめる。ツールのチャネルあて・LINE が出した・期限内のものだけ。だめなら null */
function verifyToolIdToken_(idToken, liffId) {
  const token = typeof idToken === 'string' ? idToken.trim() : '';
  const channelId = String(liffId || '').split('-')[0];
  if (!Object.prototype.hasOwnProperty.call(TOOL_CHANNELS_, channelId)) return null;
  if (!token || token.length > 4096 || !/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(token)) return null;
  const res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: { id_token: token, client_id: channelId },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) return null;
  let claims = null;
  try {
    claims = JSON.parse(res.getContentText());
  } catch (error) {
    return null;
  }
  const sub = String((claims && claims.sub) || '');
  if (String(claims.aud) !== channelId || claims.iss !== LINE_ID_TOKEN_ISSUER_ || !(Number(claims.exp) > Date.now() / 1000)) return null;
  if (!/^U[0-9a-f]{32}$/.test(sub)) return null;
  return { subHash: sha256Hex_(`qlove:${sub}`), tool: TOOL_CHANNELS_[channelId] };
}

function linkedUserId_(subHash) {
  const row = readRows_('links').find((r) => String(r.subHash).trim() === subHash);
  return row ? String(row.userId || '').trim() : '';
}

// ---- つなぐ番号 ----

/** ボットの「🔗 ツールとつなぐ」：6けたの番号（10分・1回きり） */
function linkCodeReply_(event, role) {
  if (!isOneToOne_(event)) return textMessage_('ツールとつなぐのは、ボットとの1対1 のトークでしてね。');
  if (!role) return notAllowedText_();
  let code = '';
  for (let i = 0; i < 5 && !code; i += 1) {
    const candidate = String(100000 + (parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 900000));
    if (!cache_().get(`LINK_${candidate}`)) code = candidate;
  }
  cache_().put(`LINK_${code}`, userIdOf_(event), LINK_CODE_SECONDS_);
  return textMessage_(`🔗 つなぐ番号：${code}\n10分以内に、くらぶのツールの「⚙️ くらぶボットとつなぐ」に入れてね（1回だけ使えます）。人には教えないでね。`);
}

function linkTool_(who, code) {
  const tries = Number(cache_().get(`LINK_TRIES_${who.subHash}`) || 0);
  if (tries >= LINK_TRIES_MAX_) return { ok: false, error: 'many' };
  const text = String(code || '').replace(/\D/g, '');
  const userId = /^\d{6}$/.test(text) ? cache_().get(`LINK_${text}`) : null;
  if (!userId) {
    cache_().put(`LINK_TRIES_${who.subHash}`, String(tries + 1), LINK_CODE_SECONDS_);
    return { ok: false, error: 'code' };
  }
  cache_().remove(`LINK_${text}`);
  if (!canUse_(userId)) return { ok: false, error: 'notyou' };
  const now = linkedUserId_(who.subHash);
  if (now !== userId) {
    if (now) updateRow_('links', 'subHash', who.subHash, { userId: userId, tool: who.tool });
    else appendRow_('links', { subHash: who.subHash, userId: userId, tool: who.tool, createdAt: new Date() });
  }
  return { ok: true, linked: true };
}
