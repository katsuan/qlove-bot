/**
 * 08_public.gs：入口（配布用シートの entry.gs）から呼ぶ関数。どれも最初の引数に env（00_config.gs の useEnv_）
 *
 *   botWebhook(env, e)     … doPost。LINE の Webhook と、ツールからの呼び出し
 *   botGet(env)            … doGet。名前と版だけ
 *   botHourly(env, now)    … 1時間おきの見張り（機能ごとの hourly）
 *   botSetup(env)          … はじめに1回：シート・機能の行・Webhook の合言葉（トリガーは入口が作る）
 *   botWebhookUrl(env)     … LINE に入れる Webhook の URL
 *   botAdoptOwner(env)     … 「🔑 持ち主の登録」を押した人を持ち主にする
 *   botSetupRichMenu(env)  … トークの下のメニュー
 *   botCheck(env)          … 準備ができているか（何も書きかえない・送らない）
 *   botVersion()           … 版
 */

const HEARTBEAT_PROP_ = 'Q_HEARTBEAT_hourlyQloveBot';

function botVersion() {
  return BOT_VERSION_;
}

function botWebhook(env, e) {
  useEnv_(env);
  return handleWebhook_(e);
}

function botGet(env) {
  useEnv_(env);
  return ContentService.createTextOutput(`${BOT_NAME_}（版 ${BOT_VERSION_}）`);
}

function botHourly(env, now) {
  useEnv_(env);
  props_().setProperty(HEARTBEAT_PROP_, new Date().toISOString());
  const when = now || new Date();
  const out = {};
  enabledModules_().filter((m) => m.hourly).forEach((m) => {
    try {
      out[m.key] = m.hourly(when);
    } catch (error) {
      out[m.key] = { failed: 1 };
      writeLog_(`${m.key}:hourly`, error.message);
    }
  });
  const sent = Object.keys(out).map((k) => `${k} 送った ${out[k].sent || 0}・失敗 ${out[k].failed || 0}`).join('／');
  if (sent) console.log(`見張り：${sent}`);
  return out;
}

function botSetup(env) {
  useEnv_(env);
  Object.keys(SHEETS_).forEach((kind) => sheet_(kind));
  // 機能の行（ない機能だけ足す。切るときは enabled を FALSE に）
  const have = new Set(readRows_('modules').map((r) => String(r.key).trim()));
  Object.keys(MODULES_).forEach((k) => {
    if (!have.has(k)) appendRow_('modules', { key: k, name: `${MODULES_[k].emoji} ${MODULES_[k].name}`, enabled: true, note: MODULES_[k].desc || '' });
  });
  if (!propText_('WEBHOOK_KEY')) {
    props_().setProperty('WEBHOOK_KEY', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
    console.log('✅ Webhook の合言葉（WEBHOOK_KEY）を作りました');
  } else {
    console.log('✅ Webhook の合言葉（WEBHOOK_KEY）はもうあります');
  }
  if (!lineToken_()) console.log('⚠️ LINE_CHANNEL_ACCESS_TOKEN がまだです：「プロジェクトの設定」→「スクリプト プロパティ」に入れてね');
  console.log(`✅ シートを用意しました（機能：${Object.keys(MODULES_).map((k) => MODULES_[k].name).join('・')}。使わない機能は、シート「機能」の enabled を FALSE に）`);
  return true;
}

function botWebhookUrl(env) {
  useEnv_(env);
  const key = propText_('WEBHOOK_KEY');
  if (!key) {
    console.log('❌ 先に setupBot を実行してね');
    return '';
  }
  let url = '';
  try {
    url = (env.getUrl && env.getUrl()) || '';
  } catch (error) {
    url = '';
  }
  if (!/\/exec$/.test(url)) {
    console.log('❌ まだデプロイされていません：「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」で、アクセスできるユーザーを「全員」にしてね');
    return '';
  }
  console.log('① LINE Developers の「Messaging API設定」→「Webhook URL」に入れる URL（人に見せない）');
  console.log(`${url}?key=${key}`);
  console.log('② くらぶのツールの「⚙️ くらぶボットとつなぐ」に入れる URL（こちらは合言葉なし）');
  console.log(url);
  return `${url}?key=${key}`;
}

function botAdoptOwner(env) {
  useEnv_(env);
  const raw = props_().getProperty(OWNER_CANDIDATE_PROP_);
  props_().deleteProperty(OWNER_CANDIDATE_PROP_);
  let candidate = null;
  try {
    candidate = JSON.parse(raw || 'null');
  } catch (error) {
    candidate = null;
  }
  if (!candidate || !candidate.userId || Date.now() - Number(candidate.at || 0) > OWNER_CANDIDATE_SECONDS_ * 1000) {
    console.log('❌ 候補がないか、古くなっています。LINE で「🔑 持ち主の登録」を押してから、10分以内に実行してね');
    return false;
  }
  const name = displayNameOf_(candidate.userId);
  props_().setProperty('OWNER_USER_ID', candidate.userId);
  console.log(`✅ 持ち主を「${name || '（名前を読めませんでした）'}」（${maskId_(candidate.userId)}）にしました。ちがう人なら、もう一度やりなおしてね`);
  return true;
}

function botSetupRichMenu(env) {
  useEnv_(env);
  return setupRichMenus_();
}

function botCheck(env) {
  useEnv_(env);
  console.log(`${BOT_NAME_}（版 ${BOT_VERSION_}）`);
  const results = runChecks_();
  results.forEach((r) => console.log(`${r.level} [${r.area}] ${r.text}`));
  console.log(`---- ${checkSummary_(results).split('\n')[0]}`);
  return { ok: !results.some((r) => r.level === '❌'), results: results };
}

/** ID は頭と終わりだけ出す */
function maskId_(id) {
  const s = String(id || '');
  return s.length > 8 ? `${s.slice(0, 3)}…${s.slice(-4)}` : '…';
}

// ---- 点検（qtest の selfcheck.gs と同じ印：✅ だいじょうぶ／⚠️ 見てほしい／❌ 直す） ----

function runChecks_() {
  const out = [];
  const add = (level, area, text) => out.push({ level: level, area: area, text: text });
  const step = (area, fn) => {
    try {
      fn();
    } catch (error) {
      add('❌', area, `確かめの途中で止まりました：${error.message}`);
    }
  };
  step('設定', () => {
    ['LINE_CHANNEL_ACCESS_TOKEN', 'WEBHOOK_KEY', 'OWNER_USER_ID'].forEach((key) => (propText_(key) ? add('✅', '設定', `${key} がある`) : add('❌', '設定', `${key} がない`)));
    const key = propText_('WEBHOOK_KEY');
    if (key && key.length < 24) add('⚠️', '設定', 'WEBHOOK_KEY が短い（24字以上に）');
  });
  step('LINE', () => {
    if (!lineToken_()) return;
    const info = lineGet_('info');
    if (info) add('✅', 'LINE', `ボット「${cleanText_(info.displayName, 30)}」につながる`);
    else add('❌', 'LINE', 'チャネルアクセストークンで LINE につながらない（作りなおして入れなおす）');
    const owner = ownerUserId_();
    if (owner) {
      const name = displayNameOf_(owner);
      if (name) add('✅', '持ち主', `「${name}」（${maskId_(owner)}）`);
      else add('❌', '持ち主', `（${maskId_(owner)}）が、このボットの友だちの ID ではない（チャネルを変えた？）。もう一度「🔑 持ち主の登録」`);
    }
  });
  step('シート', () => {
    Object.keys(SHEETS_).forEach((kind) => {
      const def = SHEETS_[kind];
      const sheet = book_().getSheetByName(def.name);
      if (!sheet) return add('❌', 'シート', `${def.name} がない（setupBot を実行）`);
      const head = sheet.getRange(1, 1, 1, def.headers.length).getValues()[0];
      const missing = def.headers.filter((h, i) => head[i] !== h);
      if (missing.length) add('⚠️', 'シート', `${def.name} の見出しがちがう：${missing.join('・')}`);
      else add('✅', 'シート', `${def.name}（${sheet.getLastRow()} 行）`);
    });
  });
  step('機能', () => {
    const on = enabledModules_();
    add('✅', '機能', `使う：${on.map((m) => `${m.emoji}${m.name}`).join('・') || 'なし'}`);
    on.forEach((m) => (m.checks ? m.checks() : []).forEach((r) => add(r.level, m.name, r.text)));
  });
  step('カード', () => {
    if (!lineToken_()) return;
    const messages = [buildModulesCard_('owner'), ...enabledModules_().filter((m) => m.samples).map((m) => m.samples()[0].build()[0])].slice(0, 5);
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/validate/reply', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: `Bearer ${lineToken_()}` },
      payload: JSON.stringify({ messages: messages }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) add('✅', 'カード', `見本 ${messages.length} 通は送れる形`);
    else add('❌', 'カード', `見本が断られる：${String(res.getContentText()).slice(0, 200)}`);
  });
  step('見張り', () => {
    if (Array.isArray(ENV_.triggers)) {
      if (ENV_.triggers.includes('hourlyQloveBot')) add('✅', '見張り', '1時間おきのトリガーがある');
      else add('❌', '見張り', '1時間おきのトリガーがない（setupBot を実行）');
    }
    const last = props_().getProperty(HEARTBEAT_PROP_);
    if (!last) return add('⚠️', '見張り', 'まだ動いた記録がない（1時間たっても出なければ、トリガーを確かめる）');
    const minutes = (Date.now() - new Date(last).getTime()) / 60000;
    if (minutes <= 130) add('✅', '見張り', `前回 ${Utilities.formatDate(new Date(last), timeZone_(), 'M/d H:mm')}`);
    else add('❌', '見張り', `前回 ${Utilities.formatDate(new Date(last), timeZone_(), 'M/d H:mm')} から動いていない`);
  });
  step('メニュー', () => {
    if (props_().getProperty('RICH_MENU_IDS')) add('✅', 'メニュー', 'トークの下のメニューがある');
    else add('⚠️', 'メニュー', 'トークの下のメニューがまだ（setupRichMenu を実行）');
  });
  return out;
}

function checkSummary_(results) {
  const count = { '✅': 0, '⚠️': 0, '❌': 0 };
  results.forEach((r) => (count[r.level] = (count[r.level] || 0) + 1));
  const bad = results.filter((r) => r.level !== '✅').slice(0, 8).map((r) => `${r.level} ${r.area}：${r.text}`);
  return [`✅ ${count['✅']}　⚠️ ${count['⚠️']}　❌ ${count['❌']}`, ...bad].join('\n').slice(0, 1500);
}
