/**
 * 00_public.gs：入口（配布用シートの 00_setup.gs・01_entry.gs）から呼ぶ関数と、点検の中身
 * どれも最初の引数に env（入口の env_。02_config.gs の useEnv_）。ライブラリの外から呼ぶので、名前の最後に _ を付けない（名前も変えない）
 *
 * 人がエディタから実行する関数（入口の 00_setup.gs）の中身。はじめてのときの順：
 *   botSetup（setupBot）→ botWebhookUrl（showWebhookUrl）→ botAdoptOwner（adoptOwner）→ botSetupRichMenu（setupRichMenu）
 *   ふだんは botCheck（checkBot）。版は botVersion
 * ボットから呼ばれる入口（入口の 01_entry.gs）の中身：
 *   botWebhook（doPost）・botGet（doGet）・botHourly（hourlyQloveBot。1時間おきのトリガー）
 */

const HEARTBEAT_PROP_ = 'Q_HEARTBEAT_hourlyQloveBot'; // 見張りが最後に動いた時刻（点検で見る）

// ---- 人がエディタから実行する関数の中身（よく使う順） ----

/** 入口の checkBot から：準備ができているかを点検して、実行ログに ✅ ⚠️ ❌ を出す。{ ok, results } を返す（何も書きかえない・送らない） */
function botCheck(env) {
  useEnv_(env);
  console.log(`${BOT_NAME_}（版 ${BOT_VERSION_}）`);
  const results = runChecks_();
  results.forEach((r) => console.log(`${r.level} [${r.area}] ${r.text}`));
  console.log(`---- ${checkSummary_(results).split('\n')[0]}`);
  return { ok: !results.some((r) => r.level === '❌'), results: results };
}


/** 入口の setupBot から：シート・機能の行（シート「機能」）・Webhook の合言葉を用意する。足りないものだけ足す（トリガーは入口が作る） */
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

/** 入口の showWebhookUrl から：LINE に入れる Webhook の URL（合言葉つき）とツールに入れる URL を実行ログに出し、Webhook の URL を返す */
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

/** 入口の adoptOwner から：10分以内に「🔑 持ち主の登録」を押した人を持ち主にする。できたら true */
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

/** 入口の setupRichMenu から：トークの下のメニュー（2つのタブ）を作りなおす。できたら true */
function botSetupRichMenu(env) {
  useEnv_(env);
  return setupRichMenus_();
}

/** ライブラリの版（例：2026.10.25.7）を返す */
function botVersion() {
  return BOT_VERSION_;
}

// ---- ボットから呼ばれる入口の中身 ----

/** 入口の doPost から：LINE の Webhook と、ツールからの呼び出しを受けて振り分ける（01_router.gs）。返事の中身（TextOutput）を返す */
function botWebhook(env, e) {
  useEnv_(env);
  return handleWebhook_(e);
}

/** 入口の doGet から：ボットの名前と版だけを返す */
function botGet(env) {
  useEnv_(env);
  return ContentService.createTextOutput(`${BOT_NAME_}（版 ${BOT_VERSION_}）`);
}

/** 入口の hourlyQloveBot（1時間おきのトリガー）から：動いた印を残し、機能ごとの見張りを動かす。機能ごとの結果を返す */
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

/** 入口の backfillGithubPreview・backfillGithub から：記録（📝）の、GitHub に入っていない持ち主の記録を入れなおす（dryRun なら数えるだけ） */
function botLogBackfill(env, dryRun, fromYmd) {
  useEnv_(env);
  return logRunBackfill_(Boolean(dryRun), fromYmd);
}

/** 入口の onEdit（シートを手で直したとき）から：機能ごとの手直し（しょくじの MYメニューなど）を動かす */
function botOnEdit(env, e) {
  useEnv_(env);
  enabledModules_().filter((m) => m.onEdit).forEach((m) => {
    try {
      m.onEdit(e);
    } catch (error) {
      writeLog_(`${m.key}:edit`, error.message);
    }
  });
}

// ---- 点検（qtest の selfcheck.gs と同じ印：✅ だいじょうぶ／⚠️ 見てほしい／❌ 直す） ----

/** 点検の中身：設定・LINE・持ち主・今月の送信数・シート・機能・カード・見張り・メニューを見て、[{ level, area, text }] を返す */
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
  // 今月の送信数（q-oqrn の tools/qtest/selfcheck.gs の qCheckQuota_ と同じ見方。読むだけ。返事の reply は数えない）
  step('送信数', () => {
    if (!lineToken_()) return add('⚠️', '送信数', 'LINE の鍵がないので、今月の送信数を読めません');
    const quota = lineGet_('message/quota');
    const used = lineGet_('message/quota/consumption');
    if (!quota || !used) return add('⚠️', '送信数', '今月の送信数を読めませんでした');
    const total = Number(used.totalUsage) || 0;
    const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (quota.type !== 'limited') return add('✅', '送信数', `今月 ${num(total)} 通（上限なし）`);
    const limit = Number(quota.value) || 0;
    const text = `今月 ${num(total)} 通 ／ 上限 ${num(limit)} 通（のこり ${num(Math.max(0, limit - total))}）`;
    if (total >= limit) add('❌', '送信数', `${text}。上限に着いたので、push で送るメッセージは届きません（返事の reply は送れます）`);
    else if (total > limit * 0.8) add('⚠️', '送信数', `${text}。8割をこえました`);
    else add('✅', '送信数', text);
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

/** 点検の結果を、トークで読める短さ（数と、✅ でないもの8つまで）にする */
function checkSummary_(results) {
  const count = { '✅': 0, '⚠️': 0, '❌': 0 };
  results.forEach((r) => (count[r.level] = (count[r.level] || 0) + 1));
  // 見てほしいもの（⚠️・❌）と、今月の送信数（✅ でも出す）
  const bad = results.filter((r) => r.level !== '✅' || r.area === '送信数').slice(0, 9).map((r) => `${r.level} ${r.area}：${r.text}`);
  return [`✅ ${count['✅']}　⚠️ ${count['⚠️']}　❌ ${count['❌']}`, ...bad].join('\n').slice(0, 1500);
}

/** LINE の ID を、頭と終わりだけにする（実行ログに出すとき） */
function maskId_(id) {
  const s = String(id || '');
  return s.length > 8 ? `${s.slice(0, 3)}…${s.slice(-4)}` : '…';
}
