// 毎晩（毎週）の知らせ（入口の GAS ＋ ライブラリの 5_features/reminder.gs。このボットから持ち主だけに、1日1通まで）
//   node --test test/
import test from "node:test";
import assert from "node:assert";
import { OWNER, OTHER, KEY, BOOK, LIFF_OWNER, LIFF_CHANNEL, make, textEvent, logRows } from "./log-helpers.mjs";
import { messageText } from "./log-helpers.mjs";

const pushes = (entry) => entry.fetches.filter((f) => /\/v2\/bot\/message\/push$/.test(f.url));
// 届いたものの字（カードなら、見出しと中身の字を行でつなぐ）
const msgText = (m) => {
  if (m.text) return m.text;
  const out = [];
  const walk = (o) => { if (o && typeof o === "object") { if (o.type === "text" && o.text) out.push(o.text); Object.values(o).forEach(walk); } };
  walk(m.contents);
  return out.join("\n");
};
const lastMsg = (entry) => pushes(entry).slice(-1)[0].json.messages[0];
const lastText = (entry) => msgText(lastMsg(entry));
const footerUris = (m) => JSON.stringify(m.contents.footer).match(/https:\/\/[^"]+/g) || [];
// 日本時間の今日（からずらした日）の hh:mm
const jst = (hm, dayOffset = 0) => {
  const ymd = new Date(Date.now() + 9 * 3600e3 + dayOffset * 86400e3).toISOString().slice(0, 10);
  return new Date(`${ymd}T${hm}:00+09:00`);
};
// qcheck-ok: W2 テストの偽物の GAS（fake-gas）の中で時刻を決めて呼ぶだけ
const run = (entry, hm, dayOffset = 0) => entry.run(`logRunReminder_(new Date(${jst(hm, dayOffset).getTime()}))`);
const addLog = (lib, action, userId, date, source = "LINE", detail = action) => lib.sheet("logs", BOOK).rows.push(["L" + Math.random(), date, action, 0, detail, source, userId]);
// つづくで見ている習慣を覚えさせる
const watch = (lib, habits) => (lib.properties.LOG_TUZUQ_HABITS = JSON.stringify(habits.map(([a, t]) => ({ a, t }))));
const noQuests = (lib) => (lib.properties[`quests:user:${OWNER}`] = "[]");

test("知らせ：はじめは毎日 20:00。その前は送らず、すぎたら1日1通（つづくを開くボタンつき）", () => {
  const { lib, entry } = make();
  noQuests(lib);
  assert.equal(run(entry, "19:45"), "early");
  assert.equal(run(entry, "20:00"), "sent");
  const msg = pushes(entry)[0].json;
  assert.equal(msg.to, OWNER);
  assert.equal(msg.messages[0].type, "flex", "カードで届く");
  assert.ok(footerUris(msg.messages[0]).includes("https://liff.line.me/2012187502-o87l8Esu"), "つづくへ");
  assert.match(JSON.stringify(msg.messages[0].contents.footer), /"text":"# 通知"/, "🔔 設定");
  assert.equal(run(entry, "20:15"), "done");
  assert.equal(run(entry, "23:45"), "done");
  assert.equal(run(entry, "20:15", 1), "sent", "次の日はまた送る");
  assert.equal(pushes(entry).length, 2);
});

test("毎日：全部できた日はほめて、きょうと今週のまとめを送る（トーク・つづく・画面の記録を数える）", () => {
  const { lib, entry } = make();
  noQuests(lib);
  watch(lib, [["workout", "# 💪workout"], ["読書", "# 読書"], ["coding", "# coding"]]);
  addLog(lib, "workout", OWNER, jst("07:00"));
  addLog(lib, "読書", LIFF_OWNER, jst("08:00"), "TUZUQ");
  addLog(lib, "coding", "sys", jst("09:00"), "HTML");
  addLog(lib, "coding", OTHER, jst("09:00", -1)); // ほかの人は数えない
  assert.equal(run(entry, "20:30"), "sent");
  const text = lastText(entry);
  assert.match(text, /^(🎉|✨)/);
  assert.match(text, /✅ 💪workout\n✅ 読書\n✅ coding/); // 送る文の # は外して出す
  assert.deepEqual(entry.flexProblems(pushes(entry).map((p) => p.json.messages[0])).filter((p) => p.level === "error"), []);
  // 今週は曜日のマス目（月〜日の7列）。名前（n日）の下に、できた日は ●、まだは ○、来ない日は ·
  assert.match(text, /今週\n月\n火\n水\n木\n金\n土\n日\n/);
  assert.match(text, /読書（1日）(\n[●○·]){7}/);
});

test("まだの習慣：連続が途切れそうなら🔥、つづいている日数を出す", () => {
  const { lib, entry } = make();
  noQuests(lib);
  watch(lib, [["workout", "# 💪workout"], ["読書", "# 読書"]]);
  for (let i = 1; i <= 5; i += 1) addLog(lib, "workout", OWNER, jst("07:00", -i));
  addLog(lib, "読書", OWNER, jst("07:00"));
  assert.equal(run(entry, "20:30"), "sent");
  const text = lastText(entry);
  assert.match(text, /^🔥/);
  assert.match(text, /5日/);
  assert.match(text, /⬜ 💪workout（🔥5日つづき中）/);
  assert.match(text, /✅ 読書/);
});

test("記録のない日が3日以上つづいたら、つづくの習慣を見直さないか聞く（見直すボタンつき）", () => {
  const { lib, entry } = make();
  noQuests(lib);
  watch(lib, [["workout", "# 💪workout"]]);
  addLog(lib, "workout", OWNER, jst("07:00", -4));
  addLog(lib, "trip", OWNER, jst("08:00"), "LINE", "trip: CarPlay"); // 自動の記録は数えない
  assert.equal(run(entry, "20:30"), "sent");
  const msg = pushes(entry)[0].json.messages[0];
  assert.match(msgText(msg), /^🌱/);
  assert.match(msgText(msg), /見直して/);
  assert.ok(footerUris(msg).includes("https://liff.line.me/2012187502-o87l8Esu?open=edit"), "⚙️ 見直す");
});

test("週の目標（クエスト）が、のこりの日では足りなくなりそうなら📅", () => {
  const { lib, entry } = make();
  lib.properties[`quests:user:${OWNER}`] = JSON.stringify([{ id: "w1", action: "workout", targetPerWeek: 7 }]);
  watch(lib, [["coding", "# coding"]]);
  addLog(lib, "coding", OWNER, jst("07:00"));
  assert.equal(run(entry, "20:30"), "sent");
  const text = lastText(entry);
  assert.match(text, /📅 今週の workout：0\/7/);
});

test("言葉は日ごとに入れかわる（同じ見出しが2日つづかない）", () => {
  const { lib, entry } = make();
  noQuests(lib);
  watch(lib, [["workout", "# 💪workout"]]);
  const heads = [];
  for (let d = 0; d < 3; d += 1) {
    addLog(lib, "workout", OWNER, jst("07:00", d)); // 毎日できた
    run(entry, "20:30", d);
    heads.push(lastText(entry).split("\n")[0].replace(/（.*）$/, ""));
  }
  assert.notEqual(heads[0], heads[1]);
  assert.notEqual(heads[1], heads[2]);
});

test("まだのときだけ：全部できた日は送らない。CarPlay・出退勤・充電だけの日は「記録なし」", () => {
  const { lib, entry } = make();
  noQuests(lib);
  entry.properties.LOG_REMIND_MODE = "missing";
  addLog(lib, "coding", OWNER, jst("07:00"));
  assert.equal(run(entry, "20:30"), "had");
  addLog(lib, "trip", OWNER, jst("08:00", 1), "LINE", "trip: CarPlay\ndistance: 12km");
  addLog(lib, "attendance", OWNER, jst("09:00", 1), "LINE", "attendance start");
  addLog(lib, "charge", OWNER, jst("10:00", 1), "ALFRED", "command: charge\nlabel: 充電");
  assert.equal(run(entry, "20:30", 1), "sent");
});

test("週ごと：日曜だけ、今週のふりかえり（先週とくらべる）", () => {
  const { lib, entry } = make();
  noQuests(lib);
  entry.properties.LOG_REMIND_MODE = "weekly";
  watch(lib, [["workout", "# 💪workout"]]);
  // 今日からいちばん近い日曜
  let sun = 0;
  while (new Date(jst("12:00", sun).getTime()).getUTCDay() !== 0) sun += 1;
  for (let d = sun; d <= sun + 6; d += 1) {
    if (d === sun + 1) continue;
    assert.equal(run(entry, "20:30", d), d === sun ? "sent" : "had", `日曜以外は送らない ${d}`);
  }
  addLog(lib, "workout", OWNER, jst("07:00", sun));
  assert.match(lastText(entry), /^📅/);
});

test("「# 通知」で時刻・送り方を変える・止める（持ち主だけ。記録にはしない）", () => {
  const { lib, entry } = make();
  entry.lineEvent(textEvent("# 通知 21:30"), { key: KEY });
  assert.equal(entry.properties.LOG_REMIND_AT, "21:30");
  assert.match(JSON.stringify(entry.lastMessages()), /毎日 21:30/);
  [["＃通知　９時", "09:00"], ["# 通知 7:05", "07:05"], ["#リマインド 22時30分", "22:30"]].forEach(([t, at]) => {
    entry.lineEvent(textEvent(t), { key: KEY });
    assert.equal(entry.properties.LOG_REMIND_AT, at, t);
  });
  entry.lineEvent(textEvent("# 通知 週 21:00"), { key: KEY });
  assert.equal(entry.properties.LOG_REMIND_MODE, "weekly");
  assert.equal(entry.properties.LOG_REMIND_AT, "21:00");
  assert.match(JSON.stringify(entry.lastMessages()), /日曜の 21:00/);
  entry.lineEvent(textEvent("# 通知 まだのときだけ"), { key: KEY });
  assert.equal(entry.properties.LOG_REMIND_MODE, "missing");
  entry.lineEvent(textEvent("# 通知 25:00"), { key: KEY });
  assert.equal(entry.properties.LOG_REMIND_AT, "21:00", "形がちがえば変えない");
  assert.match(JSON.stringify(entry.lastMessages()), /うまく読めませんでした/);
  entry.lineEvent(textEvent("# 通知 off"), { key: KEY });
  assert.equal(run(entry, "23:00", 1), "off");
  entry.lineEvent(textEvent("# 通知"), { key: KEY });
  assert.match(JSON.stringify(entry.lastMessages()), /止めています/);
  entry.lineEvent(textEvent("# 通知 on"), { key: KEY });
  assert.equal(entry.properties.LOG_REMIND_OFF, undefined);
  entry.lineEvent(textEvent("# 通知 毎日"), { key: KEY });
  assert.equal(entry.properties.LOG_REMIND_MODE, "daily");
  // ほかの人は変えられない
  entry.lineEvent(textEvent("# 通知 off", OTHER), { key: KEY });
  assert.equal(entry.properties.LOG_REMIND_OFF, undefined);
  assert.match(JSON.stringify(entry.lastMessages()), /持ち主だけ/);
  assert.equal(logRows(lib).length, 0, "どれも記録にはしない");
});

test("知らせ：送れなくても止まらない。持ち主がいなければ送らない", () => {
  const { lib, entry } = make();
  noQuests(lib);
  entry.fail.pushAll = true; // LINE が push を断る（送れる数がない など）
  assert.equal(run(entry, "20:30"), "fail");
  const none = make({ userId: "" });
  assert.equal(run(none.entry, "20:30"), "noone");
});

test("つづく：見ている習慣は文だけ覚える（ID は入れない）", () => {
  const { lib, entry } = make({ idTokens: { "h.owner.s": { iss: "https://access.line.me", sub: LIFF_OWNER, aud: LIFF_CHANNEL, exp: Date.now() / 1000 + 3600 } } });
  entry.doPost({ app: "tuzuq", op: "days", idToken: "h.owner.s", texts: ["# 💪workout", "# 読書", "# trip"] });
  assert.deepEqual(JSON.parse(lib.properties.LOG_TUZUQ_HABITS).map((h) => h.t), ["# 💪workout", "# 読書"]);
  assert.doesNotMatch(lib.properties.LOG_TUZUQ_HABITS, /U[0-9a-f]{32}/);
});

test("「# 通知」の返事に、押すだけで変えられるクイックリプライ（いまの設定は出さない）", () => {
  const { entry } = make();
  entry.lineEvent(textEvent("# 通知"), { key: KEY });
  const qr = entry.lastMessages()[0].quickReply.items.map((i) => i.action);
  const labels = qr.map((a) => a.label);
  assert.ok(labels.includes("🔔 知らせの見本"));
  assert.ok(labels.includes("📅 週ごと（日曜）"));
  assert.ok(!labels.includes("🗓 毎日まとめ"), "いまは毎日");
  assert.ok(!labels.some((l) => /20時/.test(l)), "いまは20時");
  assert.ok(labels.includes("🔕 止める"));
  assert.ok(labels.includes("📨 記録のたびに知らせる"), "はじめは知らせないので、オンにするほう");
  assert.match(JSON.stringify(entry.lastMessages()), /つづくで記録したときの知らせ：なし/);
  labels.forEach((l) => assert.ok(l.length <= 20, l));
  // 押すと変わる
  entry.lineEvent(textEvent(qr.find((a) => a.label === "📅 週ごと（日曜）").text), { key: KEY });
  assert.equal(entry.properties.LOG_REMIND_MODE, "weekly");
  entry.lineEvent(textEvent("# 通知 off"), { key: KEY });
  assert.ok(entry.lastMessages()[0].quickReply.items.some((i) => i.action.label === "🔔 また送る"));
});

test("「# 通知」：今月の知らせの残りを、LINE の API の答えから出す（読めなければ出さない）", () => {
  const { entry } = make();
  entry.lineEvent(textEvent("# 通知"), { key: KEY });
  assert.match(JSON.stringify(entry.lastMessages()), /📮 今月の知らせ：のこり 188通（200通のうち 12通 使用/);
  const calls = entry.fetches.filter((f) => /\/v2\/bot\/message\/quota/.test(f.url));
  assert.equal(calls.length, 2);
  assert.match(calls[0].opt.headers.Authorization, /^Bearer /);
  // 読めないとき
  const failed = entry.run("(() => { const f = UrlFetchApp.fetch; UrlFetchApp.fetch = () => { throw new Error('net'); }; try { return logDescribePushQuota_(); } finally { UrlFetchApp.fetch = f; } })()");
  assert.equal(failed, "");
});

test("「# 設定」：持ち主だけ、いまの設定を1通で（知らせ・つづく・GitHub・管理者向けはあるかだけ）。ボタンで変えられる。記録はしない", () => {
  const { lib, entry } = make();
  entry.lineEvent(textEvent("# 設定"), { key: KEY });
  const m = entry.lastMessages()[0];
  assert.equal(m.type, "flex"); // 項目が多いのでカード（H10）
  const text = messageText(m);
  assert.match(m.altText, /^⚙️ いまの設定：🔔 毎日 20:00/);
  assert.match(text, /🔔 知らせ\n🔔 毎日 20:00/);
  assert.match(text, /📮 今月の知らせ：のこり/);
  assert.match(text, /🌱 GitHub\nつながっています/);
  assert.match(text, /🔧 管理者向け（あるかだけ）\nLINE の鍵：あり・合言葉：あり/);
  assert.match(text, /GitHub の鍵：あり/);
  // ボタン：知らせ・ふりかえり（あとで押されても困らない）
  assert.deepEqual(m.contents.footer.contents.map((b) => b.action.text), ["# 通知", "# REPORT"]);
  assert.deepEqual(entry.flexProblems([m]).filter((p) => p.level === "error"), []);
  // 中身は出さない
  assert.doesNotMatch(JSON.stringify(m), /ghp_test|line-test|U[0-9a-f]{32}|https?:\/\//);
  assert.ok(m.quickReply.items.some((i) => i.action.text === "# 通知 off"));
  assert.equal(logRows(lib).length, 0);
  // ほかの人
  entry.lineEvent(textEvent("＃せってい", OTHER), { key: KEY });
  assert.match(entry.lastMessages()[0].text, /持ち主だけ/);
  assert.doesNotMatch(entry.lastMessages()[0].text, /管理者/);
});
