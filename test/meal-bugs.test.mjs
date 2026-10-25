// 見つけた不具合（直す前に落ちることを確かめたもの）
import test from "node:test";
import assert from "node:assert";
import { makeMealGas, day , U1, U2, UADMIN, UPEND, UNEW } from "./meal-helpers.mjs";

const addLog = (gas, o) => {
  const L = gas.cols.meal;
  gas.sheet("meal_logs").rows.push(gas.row(L, { userId: U1, kcalStatus: "exact", ...o }));
};
const asUser = (userId) => ({ source: { type: "user", userId } });

test("MYメニューを手で直したとき（mealOnEdit_）：MYメニューにない記録のカロリーは消さない。つながっている記録だけ合わせる", () => {
  const gas = makeMealGas();
  const at = new Date(`${day(0)}T19:00:00+09:00`);
  addLog(gas, { mealDate: at, meal: "夜", menu: "手作り弁当", kcal: 650, logId: "manual1" });
  addLog(gas, { mealDate: at, meal: "夜", menu: "なぞ鍋", kcal: 360, kcalStatus: "estimated", note: "ご飯1.5杯分（概算）", logId: "est1" });
  addLog(gas, { mealDate: at, meal: "夜", menu: "トースト", kcalStatus: "pending", logId: "pend-toast" });
  // カレーライス（m2）を手で 800 kcal に
  const M = gas.cols.master;
  const m2 = gas.sheet("nutrition_master").rows.find((r) => r[0] === "m2");
  m2[M.indexOf("kcal")] = 800;
  gas.run("mealReapplyNutritionMaster_()");

  assert.equal(gas.log("manual1").kcal, 650, "MYメニューにない品の数字はそのまま");
  assert.equal(gas.log("manual1").kcalStatus, "exact");
  assert.equal(gas.log("est1").kcal, 360, "概算の記録もそのまま");
  assert.equal(gas.log("est1").kcalStatus, "estimated");
  assert.equal(gas.log("b0").kcal, 800, "つながっている記録は合わせる");
  assert.equal(gas.log("pend-toast").kcal, 250, "カロリーがまだで、同じ名前の MYメニューがあれば入れる");
  assert.equal(gas.log("pend-toast").masterKey, "m1");
  assert.equal(gas.log("p1").kcalStatus, "pending", "MYメニューにない未記入は未記入のまま");
});

test("「どの未記入に入れる？」のボタン：あとで押されても、もう入っている記録は上書きしない", () => {
  const gas = makeMealGas();
  gas.line({ type: "message", message: { type: "text", text: "300" } });
  // チョコ（p1）は1品だけなので、そのまま入る
  assert.equal(gas.log("p1").kcal, 300);
  gas.line({ type: "postback", postback: { data: "m=meal&action=resolvePendingKcal&logId=p1&kcal=999" } });
  assert.equal(gas.log("p1").kcal, 300, "上書きしない");
  assert.match(JSON.stringify(gas.lastMessages()), /もう 300 kcal で入っています/);
});

test("近い MYメニューで記録（候補）：あとで押されても、もう入っている記録は上書きしない", () => {
  const gas = makeMealGas();
  gas.line({ type: "postback", postback: { data: "m=meal&action=estimateKcal&logId=p1&kcal=120&note=少し" } });
  assert.equal(gas.log("p1").kcal, 120);
  gas.line({ type: "postback", postback: { data: "m=meal&action=logCandidate&logId=p1&masterKey=m2&meal=その他&menu=カレーライス" } });
  assert.equal(gas.log("p1").kcal, 120, "上書きしない");
  assert.equal(gas.log("p1").menu, "チョコ");
  assert.match(JSON.stringify(gas.lastMessages()), /もう 120 kcal で入っています/);
});

test("数字だけ送る：日付をまたいだあと（未記入がきのうの品だけ）でも、その品に入る。古い未記入には入れない", () => {
  const gas = makeMealGas();
  const L = gas.cols.meal;
  gas.sheet("meal_logs").rows.push(gas.row(L, { mealDate: new Date(`${day(-1)}T21:00:00+09:00`), userId: U2, meal: "夜", menu: "おにぎり", kcalStatus: "pending", logId: "u2-y" }));
  gas.line({ ...asUser(U2), type: "message", message: { type: "text", text: "350" } });
  assert.equal(gas.log("u2-y").kcal, 350);

  gas.sheet("meal_logs").rows.push(gas.row(L, { mealDate: new Date(`${day(-5)}T21:00:00+09:00`), userId: U2, meal: "夜", menu: "そば", kcalStatus: "pending", logId: "u2-old" }));
  gas.line({ ...asUser(U2), type: "message", message: { type: "text", text: "400" } });
  assert.equal(gas.log("u2-old").kcal, "", "5日前の未記入には入れない");
  assert.match(JSON.stringify(gas.lastMessages()), /名前と一緒に/);
});

test("同時に記録：ほかの呼び出しが同じ名前の MYメニューを作ったばかりでも（覚え書きが古くても）、MYメニューを2つ作らない", () => {
  const gas = makeMealGas();
  // 覚え書き（CacheService）に、いまの MYメニューを入れる
  gas.run("mealGetNutritionMasterCached_()");
  // そのあと、同じ人のほかの呼び出しが「豚汁」（その人の MYメニュー）を作った
  const M = gas.cols.master;
  gas.sheet("nutrition_master").rows.push(gas.row(M, { masterKey: "m-other", name: "豚汁", kcal: 150, status: "active", owner: U1, scope: "personal" }));
  const res = gas.post({ action: "submitMealDetail", idToken: "t-U1", meal: "夜", menu: "豚汁", kcal: 160, mealDate: day(0), sendLineSummary: false });
  assert.equal(res.ok, true, res.error);
  const rows = gas.rows("nutrition_master").filter((r) => r[M.indexOf("name")] === "豚汁");
  assert.equal(rows.length, 1);
  assert.equal(rows[0][M.indexOf("kcal")], 160);
  assert.equal(res.record.masterKey, "m-other");
});

test("20時の知らせ：記録のない人にだけ送り、押せばすぐ記録できるクイックリプライを付ける。設定の書きこみは1回", () => {
  const gas = makeMealGas();
  // U1 はきょう記録あり。U2 のきょうの記録を消して、記録なしに
  const L = gas.cols.meal;
  const sh = gas.sheet("meal_logs");
  sh.rows.splice(sh.rows.findIndex((r) => r[L.indexOf("logId")] === "u2-1"), 1);
  gas.reset();
  let propWrites = 0;
  const props = gas.ctx.PropertiesService.getScriptProperties();
  const original = props.setProperty.bind(props);
  props.setProperty = (k, v) => {
    if (k === "MEAL_REMINDER_STREAKS") propWrites++;
    return original(k, v);
  };
  gas.run(`mealHourly_(new Date("${day(0)}T20:05:00+09:00"))`);
  const pushes = gas.replies().filter((r) => r.kind === "push");
  const to = pushes.map((p) => p.to).sort();
  assert.deepEqual(to, [U2, UADMIN], "記録のない人だけ（許可待ちには送らない）");
  const msg = pushes.find((p) => p.to === U2).messages[0];
  assert.ok(msg.quickReply && msg.quickReply.items.length >= 1, "クイックリプライ");
  assert.ok(msg.quickReply.items.some((i) => i.action.type === "uri"), "画面で入力");
  assert.deepEqual(gas.errors(), []);
  assert.equal(propWrites, 1, "まとめて1回で書く");
  const streaks = JSON.parse(gas.properties.MEAL_REMINDER_STREAKS);
  assert.equal(streaks[U2].consecutiveReminderDays, 1);
  // 20時でない回は、何もしない
  gas.reset();
  gas.run(`mealHourly_(new Date("${day(0)}T19:05:00+09:00"))`);
  assert.equal(gas.replies().length, 0);
});

test("プロフィールを直すとき：行をまとめて書いても、= で始まる文字が式にならない", () => {
  const gas = makeMealGas();
  const U = gas.cols.users;
  const u1 = gas.sheet("meal_users").rows.find((r) => r[0] === U1);
  u1[U.indexOf("richMenuKey")] = "=IMPORTXML(\"x\")";
  gas.reset();
  const res = gas.post({ action: "updateProfile", idToken: "t-U1", favorites: ["m1"], calorieTarget: 1900 });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(gas.formulaCells(), []);
  assert.equal(gas.user(U1).calorieTarget, 1900);
  assert.equal(gas.user(U1).favorites, '["m1"]');
  assert.equal(gas.user(U1).richMenuKey, "=IMPORTXML(\"x\")");
});

test("よく記録するもの（MYメニューに保存していない品）を押す：前に入れたカロリーで、すぐ記録する（未入力にしない）", () => {
  const gas = makeMealGas();
  for (const d of [-2, -1]) addLog(gas, { mealDate: new Date(`${day(d)}T19:00:00+09:00`), meal: "夜", menu: "手作り弁当", kcal: 650, logId: `bento${d}` });
  const state = gas.post({ action: "getLiffAppState", idToken: "t-U1" });
  const quick = state.dashboard.quickMenus.find((q) => q.displayName === "手作り弁当");
  assert.ok(quick, "よく記録するものに出る");
  gas.line({ type: "message", message: { type: "text", text: "夜 手作り弁当" } });
  const logs = gas.logsOf(U1).filter((l) => l.menu === "手作り弁当");
  assert.equal(logs.length, 3);
  const added = logs.find((l) => !/^bento/.test(l.logId));
  assert.equal(added.kcal, 650);
  assert.equal(added.kcalStatus, "exact");
  const text = JSON.stringify(gas.lastMessages());
  assert.match(text, /＋650/);
  assert.match(text, /MYメニューに保存/, "MYメニューへの保存を促す");
  assert.deepEqual(gas.errors(), []);
});

test("20時の知らせは人ごとにえらぶ：はじめて来た人は受けとらない。「🍚 しょくじ」のクイックリプライで切りかえる", () => {
  const gas = makeMealGas();
  gas.sheet("meal_users").rows.splice(gas.rows("meal_users").findIndex((r) => r[0] === U2), 1);
  gas.line({ source: { type: "user", userId: U2 }, type: "message", message: { type: "text", text: "🍚 しょくじ" } });
  assert.equal(gas.user(U2).notify, false, "はじめは受けとらない");
  const item = gas.lastMessages().at(-1).quickReply.items.at(-1);
  assert.match(item.action.label, /20時に知らせてもらう/);
  gas.line({ source: { type: "user", userId: U2 }, type: "postback", postback: { data: item.action.data } });
  assert.equal(gas.user(U2).notify, true);
  assert.match(gas.lastMessages()[0].text, /20時に/);
  // 2回押しても同じ
  gas.line({ source: { type: "user", userId: U2 }, type: "postback", postback: { data: item.action.data } });
  assert.equal(gas.user(U2).notify, true);
  gas.line({ source: { type: "user", userId: U2 }, type: "postback", postback: { data: "m=meal&action=notify&on=0" } });
  assert.equal(gas.user(U2).notify, false);
});

