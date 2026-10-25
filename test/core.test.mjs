// くらぶボット共通のところ（受け口・振り分け・役割・ツールからの呼び出し・メニュー・#テスト）のテスト
//   node --test test/
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  FRIEND, KEY, OWNER, ROOT, STRANGER, addPlace, errorsOf, groupSource, lastReply, makeBot, press, pushes, quickLabels, response, say, sendLocation,
  textsOf, toolCall, userSource
} from "./helpers.mjs";

// ---- 受け口 ----

test("Webhook の合言葉がない・ちがう呼び出しは何もしない。壊れた本文でも止まらない", () => {
  const gas = makeBot();
  gas.lineEvent({ type: "message", replyToken: "r", source: userSource(OWNER), message: { type: "text", text: "天気の知らせ" } });
  gas.lineEvent({ type: "message", replyToken: "r", source: userSource(OWNER), message: { type: "text", text: "天気の知らせ" } }, { key: "wrong" });
  assert.equal(gas.replies().length, 0);
  assert.equal(gas.call("doPost", { parameter: { key: KEY }, postData: { contents: "{" } }).getContent(), "{}");
  assert.equal(gas.call("doPost", { parameter: {}, postData: { contents: "{\"x\":1}" } }).getContent(), "{}");
  const fresh = makeBot({ properties: { WEBHOOK_KEY: "" } });
  fresh.lineEvent({ type: "follow", replyToken: "r", source: userSource(OWNER) }, { key: "" });
  assert.equal(fresh.replies().length, 0);
});

test("setupBot：シート・機能の行・合言葉・1時間おきの見張り。2回目は足さない", () => {
  const gas = makeBot({ properties: { WEBHOOK_KEY: "" } });
  assert.ok(gas.rows("機能").some((r) => r[0] === "weather" && r[2] === true));
  for (const name of ["機能", "使う人", "つないだツール", "動作の記録", "天気の地点"]) assert.ok(gas.rows(name), name);
  assert.equal(gas.properties.WEBHOOK_KEY.length, 64);
  // 入口の setupBot が、1時間おきの見張りのトリガーを作る
  gas.reset();
  gas.call("setupBot");
  assert.ok(gas.calls.some((c) => /^ScriptApp\.newTrigger\(hourlyQloveBot\)/.test(c.name)), JSON.stringify(gas.calls.map((c) => c.name)));
  const before = gas.rows("機能").length;
  gas.call("setupBot");
  assert.equal(gas.rows("機能").length, before);
});

test("showWebhookUrl：LINE に入れる URL（合言葉つき）と、ツールに入れる URL（合言葉なし）", () => {
  const gas = makeBot();
  const url = gas.call("showWebhookUrl");
  assert.equal(url, `https://script.google.com/macros/s/TEST/exec?key=${KEY}`);
  assert.ok(gas.logs.some((l) => l === "https://script.google.com/macros/s/TEST/exec"));
});

// ---- 振り分け ----

test("文字の振り分け：#持ち主 → #テスト（持ち主）→ くらぶの言葉 → 機能の言葉 → 1対1 は案内", () => {
  const gas = makeBot();
  say(gas, userSource(OWNER), "メニュー");
  assert.match(lastReply(gas).messages[0].altText, /^🧩 くらぶボットでできること：天気/);
  say(gas, userSource(OWNER), "天気");
  assert.match(lastReply(gas).messages[0].altText, /^☁️ 天気の知らせ/);
  say(gas, userSource(OWNER), "こんにちは");
  assert.equal(lastReply(gas).messages[0].text, "下のボタンから選んでね。");
  assert.ok(quickLabels(lastReply(gas).messages[0]).includes("☁️ 天気"));
});

test("使わない機能（シート「機能」で FALSE）は、言葉・ボタン・位置情報・見張り・ツールのどれでも動かない", () => {
  const gas = makeBot({ modulesOff: ["weather"] });
  say(gas, userSource(OWNER), "天気の知らせ");
  assert.equal(lastReply(gas).messages[0].text, "下のボタンから選んでね。");
  press(gas, userSource(OWNER), "m=weather&a=add");
  assert.match(textsOf(lastReply(gas).messages), /いまこのボットでは使っていません/);
  sendLocation(gas, userSource(OWNER), 35.17, 136.88);
  assert.equal(gas.rows("天気の地点").length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(gas.call("botHourly", gas.call("env_")))), {});
  assert.deepEqual(toolCall(gas, { tool: "core", action: "ping" }).modules, []);
  // できることのカードにも出ない
  say(gas, userSource(OWNER), "メニュー");
  assert.doesNotMatch(lastReply(gas).messages[0].altText, /天気/);
});

test("メニューのタブの切りかえ（postback）には返事をしない", () => {
  const gas = makeBot();
  press(gas, userSource(OWNER), "m=core&a=tab&t=club");
  assert.equal(gas.replies().length, 0);
});

// ---- 役割 ----

test("友だちになったとき：持ち主・まだ持ち主がいない・知らない人で、案内とボタンがちがう", () => {
  const gas = makeBot();
  gas.lineEvent({ type: "follow", replyToken: "f1", source: userSource(OWNER) }, { key: KEY });
  assert.ok(quickLabels(lastReply(gas).messages[0]).includes("☁️ 天気"));
  gas.lineEvent({ type: "follow", replyToken: "f2", source: userSource(STRANGER) }, { key: KEY });
  assert.deepEqual(quickLabels(lastReply(gas).messages[0]), ["🙋 使いたいと伝える"]);
  const fresh = makeBot({ properties: { OWNER_USER_ID: "" } });
  fresh.lineEvent({ type: "follow", replyToken: "f3", source: userSource(STRANGER) }, { key: KEY });
  assert.deepEqual(quickLabels(lastReply(fresh).messages[0]), ["🔑 持ち主の登録"]);
  assert.deepEqual(errorsOf(gas.replies().flatMap((r) => r.messages)), []);
});

test("持ち主の登録：LINE で押すだけではなれない。10分以内に GAS エディタで adoptOwner を実行して決まる", () => {
  const gas = makeBot({ properties: { OWNER_USER_ID: "" } });
  press(gas, userSource(STRANGER), "m=core&a=owner");
  assert.match(textsOf(lastReply(gas).messages), /adoptOwner/);
  assert.equal(gas.properties.OWNER_USER_ID, "");
  assert.equal(gas.call("adoptOwner"), true);
  assert.equal(gas.properties.OWNER_USER_ID, STRANGER);
  assert.equal(gas.call("adoptOwner"), false);
  gas.properties.OWNER_CANDIDATE = JSON.stringify({ userId: FRIEND, at: Date.now() - 11 * 60e3 });
  assert.equal(gas.call("adoptOwner"), false);
  assert.equal(gas.properties.OWNER_USER_ID, STRANGER);
  press(gas, groupSource(FRIEND), "m=core&a=owner");
  assert.equal(gas.properties.OWNER_CANDIDATE, undefined);
});

test("「🙋 使いたい」→ 持ち主にカード（✅ 許す・やめておく。クイックリプライにも）。ほかの人が作った postback では許せない", () => {
  const gas = makeBot();
  press(gas, userSource(STRANGER), "m=core&a=request");
  const toOwner = pushes(gas).find((p) => p.to === OWNER);
  assert.equal(toOwner.messages[0].type, "flex");
  assert.match(toOwner.messages[0].altText, /^🙋 .+さんが、くらぶボットを使いたいそうです$/);
  assert.deepEqual(toOwner.messages[0].contents.footer.contents.map((b) => b.action.label), ["✅ 許す", "やめておく"]);
  assert.deepEqual(quickLabels(toOwner.messages[0]), ["✅ 許す", "やめておく"]);
  assert.deepEqual(errorsOf(toOwner.messages), []);
  const count = pushes(gas).length;
  press(gas, userSource(STRANGER), "m=core&a=request");
  assert.equal(pushes(gas).length, count, "同じ日にもう一度押しても、持ち主にはもう送らない");
  const allow = toOwner.messages[0].quickReply.items[0].action.data;
  press(gas, userSource(FRIEND), allow);
  assert.match(textsOf(lastReply(gas).messages), /持ち主だけ/);
  assert.equal(gas.call("roleOf_", STRANGER), "");
  press(gas, userSource(OWNER), allow);
  assert.equal(gas.call("roleOf_", STRANGER), "member");
  assert.ok(pushes(gas).some((p) => p.to === STRANGER));
  assert.match(textsOf(addPlace(gas, userSource(STRANGER)).messages), /を登録しました/);
});

test("持ち主は「👥 使う人」からやめさせられる。その人が入れた知らせ（天気の地点）も止まる", () => {
  const gas = makeBot({ members: [[FRIEND, "ともだち", "allowed", "", ""]] });
  addPlace(gas, userSource(FRIEND));
  press(gas, userSource(OWNER), "m=core&a=people");
  const card = lastReply(gas).messages[0];
  assert.ok(quickLabels(card).includes("🚫 ともだち"));
  press(gas, userSource(OWNER), card.quickReply.items[0].action.data);
  assert.equal(gas.call("roleOf_", FRIEND), "");
  assert.equal(gas.call("weatherNotices_").length, 0);
  press(gas, userSource(OWNER), card.quickReply.items[0].action.data);
  assert.match(textsOf(lastReply(gas).messages), /もう使えない/);
});

// ---- 送れる数：全部の機能で分け合う ----

test("送れる数：急ぎでない知らせ（normal）は 80%、持ち主への知らせなど（high）は 95% で止める", () => {
  const gas = makeBot({ quota: { value: 200, used: 170 } });
  assert.equal(gas.call("hasPushRoom_", "normal"), false);
  assert.equal(gas.call("hasPushRoom_", "high"), true);
  press(gas, userSource(STRANGER), "m=core&a=request");
  assert.ok(pushes(gas).some((p) => p.to === OWNER), "85% でも、使いたいの知らせは届く");
  const full = makeBot({ quota: { value: 200, used: 195 } });
  assert.equal(full.call("hasPushRoom_", "high"), false);
});

// ---- ツール（ページ）からの呼び出し ----

const TOKEN = "aaa.bbb.ccc";
const LIFF = "2012187502-o87l8Esu";
const TOOL_SUB = "U" + "e".repeat(32);
const goodVerify = (payload) =>
  payload.id_token === TOKEN && payload.client_id === "2012187502"
    ? response(200, { sub: TOOL_SUB, aud: "2012187502", iss: "https://access.line.me", exp: Date.now() / 1000 + 600 })
    : response(400, { error: "invalid_request" });

test("ツールから：ping はだれでも（中身は返さない）。ほかは ID トークンを LINE に確かめる", () => {
  const gas = makeBot({ verify: goodVerify });
  assert.deepEqual(toolCall(gas, { tool: "core", action: "ping" }), { ok: true, bot: "くらぶボット", version: gas.call("botVersion"), modules: ["weather"], line: "@test" });
  assert.deepEqual(toolCall(gas, { v: 2, tool: "core", action: "ping" }), { ok: false, error: "bad" });
  assert.equal(toolCall(gas, { tool: "weather", action: "list" }).error, "auth");
  assert.equal(toolCall(gas, { tool: "weather", action: "list", liffId: LIFF, idToken: "bad" }).error, "auth");
  // 知らないツールのチャネルは確かめに行かない
  assert.equal(toolCall(gas, { tool: "weather", action: "list", liffId: "1234567890-x", idToken: TOKEN }).error, "auth");
  // 確かめられても、つないでいなければ使えない
  assert.equal(toolCall(gas, { tool: "weather", action: "list", liffId: LIFF, idToken: TOKEN }).error, "link");
});

test("ツールとつなぐ：ボットで出した6けたの番号を、ツールから1回だけ使う。まちがいは10分に5回まで", () => {
  const gas = makeBot({ verify: goodVerify });
  addPlace(gas, userSource(OWNER), 35.17, 136.88);
  press(gas, userSource(OWNER), "m=core&a=link");
  const code = lastReply(gas).messages[0].text.match(/(\d{6})/)[1];
  // グループや知らない人には番号を出さない
  press(gas, groupSource(OWNER), "m=core&a=link");
  assert.doesNotMatch(textsOf(lastReply(gas).messages), /\d{6}/);
  press(gas, userSource(STRANGER), "m=core&a=link");
  assert.doesNotMatch(textsOf(lastReply(gas).messages), /\d{6}/);

  assert.deepEqual(toolCall(gas, { tool: "core", action: "link", liffId: LIFF, idToken: TOKEN, code }), { ok: true, linked: true });
  // ID は SHA-256 にして残す（ツールの LINE の ID はそのまま書かない）
  const links = gas.rows("つないだツール");
  assert.equal(links.length, 2);
  assert.match(links[1][0], /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(links), new RegExp(TOOL_SUB));
  // 番号は1回きり
  assert.equal(toolCall(gas, { tool: "core", action: "link", liffId: LIFF, idToken: TOKEN, code }).error, "code");
  // つないだあとは、ボットの人として機能を呼べる（送られてきた userId は使わない）
  assert.deepEqual(toolCall(gas, { tool: "weather", action: "list", liffId: LIFF, idToken: TOKEN, userId: FRIEND }), { ok: true, places: [{ name: "名古屋市中村区", hour: 7 }] });
  assert.equal(toolCall(gas, { tool: "weather", action: "nope", liffId: LIFF, idToken: TOKEN }).error, "bad");
  assert.equal(toolCall(gas, { tool: "nope", action: "list", liffId: LIFF, idToken: TOKEN }).error, "off");

  const other = makeBot({ verify: goodVerify });
  for (let i = 0; i < 5; i++) assert.equal(toolCall(other, { tool: "core", action: "link", liffId: LIFF, idToken: TOKEN, code: "000000" }).error, "code");
  assert.equal(toolCall(other, { tool: "core", action: "link", liffId: LIFF, idToken: TOKEN, code: "000000" }).error, "many");
});

test("ツールから：つないだ人がやめさせられたら使えない", () => {
  const gas = makeBot({ verify: goodVerify, members: [[FRIEND, "ともだち", "allowed", "", ""]] });
  press(gas, userSource(FRIEND), "m=core&a=link");
  const code = lastReply(gas).messages[0].text.match(/(\d{6})/)[1];
  assert.equal(toolCall(gas, { tool: "core", action: "link", liffId: LIFF, idToken: TOKEN, code }).ok, true);
  gas.call("updateRow_", "members", "userId", FRIEND, { status: "removed" });
  assert.equal(toolCall(gas, { tool: "weather", action: "list", liffId: LIFF, idToken: TOKEN }).error, "notyou");
});

// ---- トークの下のメニュー ----

test("メニュー：タブは2つ（そらくる／Qlove）。タブの切りかえは名前（alias）で。前のメニューは消す", () => {
  const gas = makeBot({ properties: { RICH_MENU_IDS: "old1" } });
  assert.equal(gas.call("setupRichMenu"), true);
  const created = gas.fetches.filter((f) => /\/v2\/bot\/richmenu$/.test(f.url)).map((f) => f.json);
  assert.deepEqual(created.map((m) => m.chatBarText), ["そらくる", "Qlove"]);
  for (const m of created) {
    assert.equal(m.areas.length, 5);
    const switches = m.areas.filter((a) => a.action.type === "richmenuswitch").map((a) => a.action.richMenuAliasId);
    assert.deepEqual(switches, ["qlove-tab-main", "qlove-tab-club"]);
    for (const a of m.areas) assert.ok(a.bounds.x + a.bounds.width <= 2500 && a.bounds.y + a.bounds.height <= 843);
  }
  assert.ok(gas.fetches.some((f) => /user\/all\/richmenu\//.test(f.url)));
  assert.ok(gas.fetches.some((f) => f.method === "delete" && /richmenu\/old1$/.test(f.url)));
  assert.ok(fs.existsSync(path.join(ROOT, "assets/richmenu-weather.png")) && fs.existsSync(path.join(ROOT, "assets/richmenu-club.png")));
});

// ---- #テスト ----

test("#テスト：持ち主の1対1 だけ。機能ごとの見本を選べる。見本はすべて 🧪・reply だけ・シートに書かない", () => {
  const gas = makeBot();
  say(gas, userSource(STRANGER), "#テスト");
  assert.doesNotMatch(textsOf(lastReply(gas).messages), /🧪/);
  say(gas, groupSource(OWNER), "#テスト");
  assert.equal(gas.replies().length, 1);
  say(gas, userSource(OWNER), "＃てすと");
  const card = lastReply(gas).messages[0];
  assert.match(card.altText, /^🧪/);
  const labels = quickLabels(card);
  assert.ok(labels.includes("☁️ 天気の知らせ") && labels.includes("🧩 くらぶの見本") && labels.includes("🩺 自己点検"));
  const before = JSON.stringify([gas.rows("天気の地点"), gas.rows("使う人")]);
  for (const action of card.quickReply.items.map((i) => i.action.data)) {
    gas.reset();
    press(gas, userSource(OWNER), action);
    const replies = gas.replies();
    assert.ok(replies.every((r) => r.kind === "reply"), `${action} は reply だけ`);
    const messages = replies.flatMap((r) => r.messages);
    assert.ok(messages.length >= 1 && messages.length <= 5);
    for (const m of messages) assert.match(m.type === "text" ? m.text : m.altText, /^🧪/, action);
    assert.deepEqual(errorsOf(messages), [], action);
  }
  assert.equal(JSON.stringify([gas.rows("天気の地点"), gas.rows("使う人")]), before);
  press(gas, userSource(STRANGER), "m=core&a=test&t=weather.notice");
  assert.doesNotMatch(textsOf(lastReply(gas).messages), /🧪/);
});

test("季節の絵文字：出る・出ない（#テスト）", () => {
  const gas = makeBot();
  press(gas, userSource(OWNER), "m=core&a=test&t=season_on");
  const on = lastReply(gas).messages[0].text;
  press(gas, userSource(OWNER), "m=core&a=test&t=season_off");
  const off = lastReply(gas).messages[0].text;
  assert.notEqual(on, off);
  assert.match(off, /登録しました。$/);
});

test("checkBot：設定・LINE・持ち主・シート・機能・カード・見張り・メニューを見る（書きかえない）", () => {
  const gas = makeBot();
  const before = JSON.stringify(gas.rows("天気の地点"));
  const out = gas.call("checkBot");
  const areas = new Set(out.results.map((r) => r.area));
  for (const a of ["設定", "LINE", "持ち主", "シート", "機能", "カード", "見張り", "メニュー"]) assert.ok(areas.has(a), a);
  assert.ok(out.results.some((r) => r.area === "見張り" && r.level === "❌" && /トリガーがない/.test(r.text)));
  assert.equal(JSON.stringify(gas.rows("天気の地点")), before);
});

// ---- カード・クイックリプライの形 ----

test("返事のカード・クイックリプライは LINE が受けつける形（ラベル20字・13個まで・ボタン2つまで・あとで押されても困らない）", () => {
  const gas = makeBot({ members: [[FRIEND, "とても長い名前のともだちさんです", "allowed", "", ""]] });
  addPlace(gas, userSource(OWNER));
  say(gas, userSource(OWNER), "天気の知らせ");
  say(gas, userSource(OWNER), "メニュー");
  press(gas, userSource(OWNER), "m=core&a=members");
  press(gas, userSource(OWNER), "m=weather&a=edit");
  gas.lineEvent({ type: "follow", replyToken: "rf", source: userSource(STRANGER) }, { key: KEY });
  const messages = gas.replies().flatMap((r) => r.messages);
  assert.deepEqual(errorsOf(messages), []);
  for (const m of messages) {
    if (m.type !== "flex") continue;
    assert.ok(m.altText && !/カードが届きました/.test(m.altText));
    const footer = m.contents.footer?.contents || [];
    assert.ok(footer.length <= 2);
    for (const b of footer) assert.ok(b.action.type === "uri" || /a=(add|edit|menu|modules|test)/.test(b.action.data), JSON.stringify(b.action));
  }
  assert.deepEqual(gas.formulaCells(), []);
});

test("カードが断られたら、文で送りなおす（返事の合図は2回使わない）", () => {
  const gas = makeBot();
  gas.ctx.UrlFetchApp.fetch = ((orig) => (url, opt) => (/message\/reply$/.test(url) ? (orig(url, opt), response(400, { message: "invalid" })) : orig(url, opt)))(gas.ctx.UrlFetchApp.fetch);
  say(gas, userSource(OWNER), "天気の知らせ");
  assert.deepEqual(gas.reusedReplyTokens(), []);
  const push = pushes(gas).at(-1);
  assert.equal(push.messages[0].type, "text");
  assert.match(push.messages[0].text, /文で送りました/);
});

// ---- 配布用シートに鍵を入れない ----

test("ライブラリ・入口に、鍵・LINE の ID・シートやスクリプトの ID を書いていない", () => {
  const files = [
    ...fs.readdirSync(path.join(ROOT, "lib")).map((f) => path.join("lib", f)),
    ...fs.readdirSync(path.join(ROOT, "entry")).map((f) => path.join("entry", f))
  ].filter((f) => /\.(gs|json)$/.test(f));
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.doesNotMatch(text, /U[0-9a-f]{32}/, f);
    assert.doesNotMatch(text, /[A-Za-z0-9+/]{100,}={0,2}/, f);
    assert.doesNotMatch(text, /docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}/, f);
    assert.doesNotMatch(text, /script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}/, f);
  }
  // ライブラリの ID は、送るときに入れる（入口の manifest は空欄のまま）
  assert.match(fs.readFileSync(path.join(ROOT, "entry/appsscript.json"), "utf8"), /__LIBRARY_SCRIPT_ID__/);
  assert.match(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8"), /tools\/clasp\/targets\.json/);
});

// ---- カードのボタン：押されるたびに、いまの状態を見て返す（ux.md の H2） ----

test("「🙋 使いたい」のカード：2回押す・やめさせたあと何日もして押す・やめておくのあとに許す、のどれでも、いまの状態で返す", () => {
  const gas = makeBot();
  press(gas, userSource(STRANGER), "m=core&a=request");
  const card = pushes(gas).find((p) => p.to === OWNER).messages[0];
  const [allow, deny] = card.contents.footer.contents.map((b) => b.action.data);
  press(gas, userSource(OWNER), allow);
  assert.equal(gas.call("roleOf_", STRANGER), "member");
  // 2回押した
  press(gas, userSource(OWNER), allow);
  assert.match(textsOf(lastReply(gas).messages), /もう使えます/);
  // 許したあとに「やめておく」
  press(gas, userSource(OWNER), deny);
  assert.match(textsOf(lastReply(gas).messages), /もう許しています/);
  assert.equal(gas.call("roleOf_", STRANGER), "member");
  // やめさせたあと、何日もして前のカードの「✅ 許す」を押しても、また使えるようにはならない
  gas.call("updateRow_", "members", "userId", STRANGER, { status: "removed" });
  press(gas, userSource(OWNER), allow);
  assert.match(textsOf(lastReply(gas).messages), /この知らせは前のものです/);
  assert.equal(gas.call("roleOf_", STRANGER), "");
  // もう一度「🙋 使いたい」と伝えてもらえば（次の日）、許せる
  gas.cache[`REQUEST_${STRANGER}`] = undefined;
  delete gas.cache[`REQUEST_${STRANGER}`];
  press(gas, userSource(STRANGER), "m=core&a=request");
  press(gas, userSource(OWNER), allow);
  assert.equal(gas.call("roleOf_", STRANGER), "member");
});

test("「👥 使う人」のカードの「🚫 やめさせる」：カードに置く。2回押す・持ち主でない人が押す", () => {
  const gas = makeBot({ members: [[FRIEND, "ともだち", "allowed", "", ""]] });
  press(gas, userSource(OWNER), "m=core&a=members");
  const card = lastReply(gas).messages[0];
  const buttons = JSON.stringify(card.contents.body).match(/"data":"(m=core&a=unallow[^"]+)"/);
  assert.ok(buttons, "カードに 🚫 やめさせる");
  const data = buttons[1];
  press(gas, userSource(FRIEND), data);
  assert.match(textsOf(lastReply(gas).messages), /持ち主だけ/);
  assert.equal(gas.call("roleOf_", FRIEND), "member");
  press(gas, userSource(OWNER), data);
  assert.equal(gas.call("roleOf_", FRIEND), "");
  press(gas, userSource(OWNER), data);
  assert.match(textsOf(lastReply(gas).messages), /もう使えない/);
  assert.deepEqual(errorsOf([card]), []);
});

// ---- 「入力中…」（ux.md の H1） ----

const loadings = (gas) => gas.fetches.filter((f) => /\/chat\/loading\/start$/.test(f.url)).map((f) => f.json);

test("入力中…：1対1 のボタン・位置情報・機能の言葉・メニュー・登録の文・持ち主の #テスト で出す（60秒）", () => {
  const gas = makeBot();
  const cases = [
    () => press(gas, userSource(OWNER), "m=weather&a=menu"),
    () => press(gas, userSource(OWNER), "m=core&a=modules"),
    () => sendLocation(gas, userSource(OWNER), 35.17, 136.88),
    () => say(gas, userSource(OWNER), "天気の知らせ"),
    () => say(gas, userSource(OWNER), "メニュー"),
    () => say(gas, userSource(OWNER), "📍 地点を足す 35.17,136.88 名古屋"),
    () => say(gas, userSource(OWNER), "#テスト")
  ];
  for (const run of cases) {
    gas.reset();
    run();
    assert.deepEqual(loadings(gas), [{ chatId: OWNER, loadingSeconds: 60 }], run.toString());
    assert.ok(gas.replies().some((r) => r.kind === "reply"), "返事も来る");
  }
});

test("入力中…：タブの切りかえ（返事をしない）・グループ・ふつうの案内・持ち主でない人の #テスト では出さない", () => {
  const gas = makeBot();
  const cases = [
    () => press(gas, userSource(OWNER), "m=core&a=tab&t=club"),
    () => press(gas, groupSource(OWNER), "m=weather&a=menu"),
    () => say(gas, groupSource(OWNER), "天気の知らせ"),
    () => say(gas, userSource(OWNER), "こんにちは"),
    () => say(gas, userSource(STRANGER), "#テスト")
  ];
  for (const run of cases) {
    gas.reset();
    run();
    assert.deepEqual(loadings(gas), [], run.toString());
  }
});

test("入力中…が出せなくても（LINE に断られる・つながらない）、返事は来る", () => {
  for (const fail of [(orig) => (url, opt) => (/loading\/start$/.test(url) ? response(500, {}) : orig(url, opt)), (orig) => (url, opt) => {
    if (/loading\/start$/.test(url)) throw new Error("timeout");
    return orig(url, opt);
  }]) {
    const gas = makeBot();
    gas.ctx.UrlFetchApp.fetch = fail(gas.ctx.UrlFetchApp.fetch);
    say(gas, userSource(OWNER), "天気の知らせ");
    assert.match(lastReply(gas).messages[0].altText, /天気の知らせ/);
    assert.ok(gas.rows("動作の記録").some((row) => row[1] === "loading:error"));
  }
});

// ---- ファイルの並べ方（q-oqrn/docs/structure.md） ----

test("ライブラリのファイルは「番号＋役わり」。機能は 5x（くらぶのツール）・6x（合流するボット）。共通の部品は season.gs", () => {
  const files = fs.readdirSync(path.join(ROOT, "lib")).filter((f) => f.endsWith(".gs"));
  for (const f of files) assert.match(f, /^(0\d_[a-z_]+|[56]\d_[a-z]+(_[a-z]+)?|season)\.gs$/, f);
  assert.ok(files.includes("season.gs"));
  assert.deepEqual(fs.readdirSync(path.join(ROOT, "entry")).sort(), ["appsscript.json", "entry.gs"]);
});

test("season.gs は q-oqrn/shared/season.js と同じ中身", () => {
  const mine = fs.readFileSync(path.join(ROOT, "lib/season.gs"), "utf8");
  const theirs = fs.readFileSync(path.join(ROOT, "../q-oqrn/shared/season.js"), "utf8");
  assert.equal(mine, theirs);
});

test("機能の登録は、ぜんぶのファイルを読み終わってから組み立てる（あとのファイルの関数を使える）", () => {
  const gas = makeBot();
  const m = gas.eval("MODULES_.weather");
  for (const key of ["menu", "onPostback", "onLocation", "onText", "hourly", "samples"]) assert.equal(typeof m[key], "function", key);
  assert.equal(typeof m.textPattern.test, "function");
  assert.equal(gas.eval("MODULE_FACTORIES_.length"), 0);
});
