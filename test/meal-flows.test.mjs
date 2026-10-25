// ふだんの流れ（前に手で確かめていたもの）と、返事のカードの形
import test from "node:test";
import assert from "node:assert";
import { makeMealGas, day, response , U1, U2, UADMIN, UPEND, UNEW } from "./meal-helpers.mjs";

const png = "data:image/png;base64," + Buffer.from("fakepng").toString("base64");
const verifyCount = (gas) => gas.fetches.filter((f) => /verify/.test(f.url)).length;

test("開いたとき：1回で全部返す。2回目は本人確認を LINE に聞かない", () => {
  const gas = makeMealGas();
  const res = gas.post({ action: "getLiffAppState", idToken: "t-U1" });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.menus.length, 3);
  assert.equal(res.dashboard.weekly.length, 7);
  assert.equal(res.dashboard.quickMenus[0].displayName, "プロテイン", "固定した品が前");
  assert.equal(res.dashboard.quickMenus[0].pinned, true);
  gas.reset();
  gas.post({ action: "getLiffAppState", idToken: "t-U1" });
  assert.equal(verifyCount(gas), 0);
});

test("まとめて記録：MYメニュー・知らない品・同じものを2回。LINE への集計カードは最後に1回だけ（G10）", () => {
  const gas = makeMealGas();
  gas.reset();
  const items = [
    { meal: "朝", menu: "トースト", mealDate: day(0), masterKey: "m1" },
    { meal: "昼", menu: "カレーライス", mealDate: day(0), masterKey: "m2" },
    { meal: "夜", menu: "なぞ料理", mealDate: day(0) },
  ];
  const res = gas.post({ action: "submitMealBatch", idToken: "t-U1", items });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.added.length, 1, "朝・昼はもう記録があるので飛ばす");
  assert.equal(res.skipped, 2);
  assert.equal(res.pending, 1);
  const pushes = gas.replies().filter((r) => r.kind === "push");
  assert.equal(pushes.length, 1);
  assert.deepEqual(gas.errors(), []);
  const last = pushes[0].messages[pushes[0].messages.length - 1];
  assert.ok(last.quickReply.items.length >= 2);
});

test("よく記録するもの：固定の並びを保存しても、目標は変わらない", () => {
  const gas = makeMealGas();
  const res = gas.post({ action: "updateProfile", idToken: "t-U1", favorites: ["m2", "m1"] });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(res.dashboard.quickMenus.filter((q) => q.pinned).map((q) => q.displayName), ["カレーライス", "トースト"]);
  assert.equal(res.dashboard.user.calorieTarget, 2000);
});

test("しょくじの文字：読んで記録し、同じものは二重にしない", () => {
  const gas = makeMealGas();
  const text = `#しょくじ ${day(0).replace(/-/g, "/")}\n朝 トースト 250kcal P8 F6 C40\n間食 コーヒー`;
  gas.line({ type: "message", message: { type: "text", text } });
  assert.match(JSON.stringify(gas.lastMessages()), /しょくじから 1 品を記録/);
  assert.deepEqual(gas.errors(), []);
  gas.line({ type: "message", message: { type: "text", text } });
  assert.equal(gas.logsOf(U1).filter((l) => l.menu === "コーヒー").length, 1);
});

test("知らない名前を送る → 入力のカード。「ご飯◯杯分」でだいたいのカロリーを入れられ、2回押しても二重に入らない", () => {
  const gas = makeMealGas();
  gas.line({ type: "message", message: { type: "text", text: "昼 なぞ定食" } });
  const m = gas.lastMessages();
  assert.deepEqual(gas.errors(), []);
  assert.match(m[0].altText, /なぞ定食/);
  const est = m[m.length - 1].quickReply.items.find((i) => /1杯/.test(i.action.label));
  assert.ok(est, "ご飯1杯分のクイックリプライ");

  gas.line({ type: "postback", postback: { data: est.action.data } });
  const log = gas.logsOf(U1).find((l) => l.menu === "なぞ定食");
  assert.equal(log.kcalStatus, "estimated");
  assert.match(log.note, /概算/);

  gas.line({ type: "postback", postback: { data: "m=meal&action=askEstimate&logId=p1" } });
  const ask = gas.lastMessages()[0];
  const again = ask.quickReply.items[2].action.data;
  gas.line({ type: "postback", postback: { data: again } });
  const first = gas.log("p1").kcal;
  gas.line({ type: "postback", postback: { data: again } });
  assert.equal(gas.log("p1").kcal, first);
  assert.match(gas.lastMessages()[0].text, /もう .* kcal で入っています/);
});

test("カードが LINE に断られたら、文字だけで送り（返事の合図は1回で使えなくなるので push で）、原因は LAST_LINE_ERRORS に（ふつうの人には仕組みの言葉を出さない）", () => {
  let n = 0;
  const gas = makeMealGas({
    fetch: (url) => (/\/reply/.test(url) && n++ === 0 ? response(400, { message: "A message (messages[0]) in the request body is invalid" }) : undefined),
  });
  gas.line({ type: "postback", postback: { data: "m=meal&action=showSummary" } });
  assert.equal(gas.replies().filter((r) => r.kind === "reply").length, 1);
  const pushes = gas.replies().filter((r) => r.kind === "push");
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].messages[0].type, "text");
  assert.doesNotMatch(pushes[0].messages[0].text, /LINE API|invalid/);
  assert.match(JSON.parse(gas.properties.LAST_LINE_ERRORS)[0].error, /400/);
});

test("入力中の表示：返事をするものにだけ出す", () => {
  const gas = makeMealGas();
  const loading = (event) => {
    gas.reset();
    gas.line(event);
    return gas.fetches.some((f) => /loading/.test(f.url));
  };
  assert.equal(loading({ type: "follow" }), false);
  assert.equal(loading({ type: "message", message: { type: "sticker" } }), false);
  assert.equal(loading({ type: "postback", postback: { data: "m=meal&action=askTarget" } }), false);
  assert.equal(loading({ type: "postback", postback: { data: "m=meal&action=zzz" } }), false);
  assert.equal(loading({ type: "postback", postback: { data: "m=meal&action=showSummary" } }), true);
});

test("主な返事のカードは、LINE が受けつける形", () => {
  const gas = makeMealGas();
  gas.line({ type: "message", message: { type: "text", text: "トースト" } });
  gas.line({ type: "message", message: { type: "text", text: "夜 なぞ定食" } });
  gas.line({ type: "message", message: { type: "text", text: "300" } });
  gas.line({ type: "postback", postback: { data: "m=meal&action=showSummary" } });
  gas.line({ type: "postback", postback: { data: "m=meal&action=showPopularDetail&groupKey=トースト" } });
  gas.line({ type: "message", message: { type: "text", text: "目標 1800" } });
  assert.ok(gas.replies().length >= 5);
  assert.deepEqual(gas.errors(), []);
});

test("記録したときの横並びのカードは、すべて同じ大きさ（ちがうと LINE に断られる。2026-10-23 本番で起きた）", () => {
  const gas = makeMealGas();
  gas.post({ action: "submitMealBatch", idToken: "t-U1", items: [{ meal: "夜", menu: "なぞ料理", mealDate: day(0) }] });
  const card = gas.replies().filter((r) => r.kind === "push").pop().messages[0];
  assert.equal(card.contents.type, "carousel", "未記入・よく記録するものがあるので横並び");
  const sizes = new Set(card.contents.contents.map((b) => b.size));
  assert.equal(sizes.size, 1, [...sizes].join(","));
});

test("カードのボタンは、あとで押されても困らないものだけ（記録への操作はクイックリプライ）", () => {
  const gas = makeMealGas();
  gas.line({ type: "message", message: { type: "text", id: "1", text: "昼 なぞ定食" } });
  const msg = gas.lastMessages()[0];
  const datas = (JSON.stringify(msg.contents).match(/"data":"[^"]*"/g) || []).map((d) => d.match(/action=([A-Za-z]+)/)[1]);
  assert.deepEqual([...new Set(datas)], ["askEstimate"], "カードに置くのは聞き返すボタンだけ");
  assert.ok(msg.quickReply.items.some((i) => /杯/.test(i.action.label)), "ご飯◯杯分はクイックリプライ");
  assert.doesNotMatch(JSON.stringify(msg.contents), /下のボタン|👇/, "カードは残り、クイックリプライは消えるので、カードに「下のボタン」と書かない");
});

test("しょくじ（LINE の中）から：記録の id（clientId）つきでまとめて記録。同じ id は送りなおしても1回だけ", () => {
  const gas = makeMealGas();
  const items = [
    { meal: "昼", menu: "オムライス", mealDate: day(0), kcal: 700, protein: 20, clientId: "abc123" },
    { meal: "昼", menu: "オムライス", mealDate: day(0), kcal: 700, protein: 20, clientId: "abc124" },
  ];
  const first = gas.post({ action: "submitMealBatch", idToken: "t-U1", items, source: "shoquji", dedupe: false, sendLineSummary: false });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.added.length, 2, "同じ名前でも id がちがえば2品");
  assert.equal(first.added[0].clientId, "abc123");
  const again = gas.post({ action: "submitMealBatch", idToken: "t-U1", items, source: "shoquji", dedupe: false, sendLineSummary: false });
  assert.equal(again.added.length, 0);
  assert.equal(again.skipped, 2);
  assert.equal(gas.replies().filter((r) => r.kind === "push").length, 0, "集計カードは送らない");
  const bad = gas.post({ action: "submitMealBatch", idToken: "t-U1", items: [{ meal: "夜", menu: "そば", mealDate: day(0), clientId: "<b>x" }], source: "shoquji", dedupe: false, sendLineSummary: false });
  assert.equal(bad.added[0].clientId, "", "形のちがう id は使わない");
});

test("しょくじ（LINE の中）が読む：その人の、期間の記録だけ（ほかの人の記録・期間の外は返さない。本人確認がないと断る）", () => {
  const gas = makeMealGas();
  gas.post({ action: "submitMealBatch", idToken: "t-U1", items: [{ meal: "その他", menu: "プリン", mealDate: day(0), kcal: 200, clientId: "p1x" }], source: "shoquji", dedupe: false, sendLineSummary: false });
  const res = gas.post({ action: "listMealLogs", idToken: "t-U1", from: day(-6), to: day(0) });
  assert.equal(res.ok, true, res.error);
  assert.ok(res.logs.length > 0);
  assert.ok(res.logs.every((l) => l.date >= day(-6) && l.date <= day(0)));
  assert.ok(res.logs.every((l) => !("userId" in l)), "userId は返さない");
  const pudding = res.logs.find((l) => l.clientId === "p1x");
  assert.equal(pudding.menu, "プリン");
  assert.ok(pudding.updatedAt > 0, "直した時刻（ミリ秒）も返す");
  assert.equal(res.complete, true, "全部返したときは complete");
  assert.equal(pudding.meal, "その他");
  const other = gas.post({ action: "listMealLogs", idToken: "t-U2", from: day(-6), to: day(0) });
  assert.ok(!other.ok || other.logs.every((l) => l.clientId !== "p1x"), "ほかの人には見えない");
  const wide = gas.post({ action: "listMealLogs", idToken: "t-U1", from: "2000-01-01", to: day(0) });
  assert.ok(wide.from > "2000-01-01", "62日より前は読まない");
  const none = gas.post({ action: "listMealLogs", from: day(-1), to: day(0) });
  assert.equal(none.ok, false);
});

test("しょくじから：ボットの記録（カロリーがまだの品）を直す・MYメニューだけ保存する（本人の記録だけ）", () => {
  const gas = makeMealGas();
  const added = gas.post({ action: "submitMealBatch", idToken: "t-U1", source: "liff", dedupe: false, sendLineSummary: false, items: [{ meal: "夜", menu: "なぞ鍋", mealDate: day(0) }] });
  const logId = added.added[0].logId;
  const noKcal = gas.post({ action: "updateMealLog", idToken: "t-U1", source: "shoquji", logId, meal: "夜", menu: "なぞ鍋", mealDate: day(0), sendLineSummary: false });
  assert.equal(noKcal.ok, false, "カロリーがないと直さない");
  const done = gas.post({ action: "updateMealLog", idToken: "t-U1", source: "shoquji", logId, meal: "夜", menu: "なぞ鍋", mealDate: day(0), kcal: 550, protein: 30, saveToMaster: true, sendLineSummary: false });
  assert.equal(done.ok, true, done.error);
  assert.equal(gas.log(logId).kcal, 550);
  const other = gas.post({ action: "updateMealLog", idToken: "t-U2", source: "shoquji", logId, meal: "夜", menu: "いたずら", mealDate: day(0), kcal: 1, sendLineSummary: false });
  assert.equal(other.ok, false, "ほかの人の記録は直せない");
  const master = gas.post({ action: "saveNutritionMasterOnly", idToken: "t-U1", source: "shoquji", menu: "なぞ鍋", kcal: 560 });
  assert.equal(master.ok, true, master.error);
  assert.equal(master.savedMaster.kcal, 560);
});

test("しょくじで直した・消した自分の記録（clientId）を、ボットにもそろえる。カロリーなしで直してもよい。ほかの人の id は触れない", () => {
  const gas = makeMealGas();
  gas.post({ action: "submitMealBatch", idToken: "t-U1", source: "shoquji", dedupe: false, sendLineSummary: false, items: [{ meal: "朝", menu: "パン", mealDate: day(0), kcal: 200, clientId: "c1" }] });
  const logId = gas.logsOf(U1).find((l) => l.clientId === "c1").logId;
  const upd = gas.post({ action: "updateMealLog", idToken: "t-U1", source: "shoquji", clientId: "c1", allowPending: true, meal: "昼", menu: "パンケーキ", mealDate: day(0), saveToMaster: false, sendLineSummary: false });
  assert.equal(upd.ok, true, upd.error);
  assert.equal(gas.log(logId).menu, "パンケーキ");
  assert.equal(gas.log(logId).kcalStatus, "pending");
  const other = gas.post({ action: "deleteMealLog", idToken: "t-U2", source: "shoquji", clientId: "c1" });
  assert.equal(other.ok, true);
  assert.equal(other.deleted, false, "ほかの人には見つからない");
  assert.ok(gas.log(logId), "消えていない");
  const del = gas.post({ action: "deleteMealLog", idToken: "t-U1", source: "shoquji", clientId: "c1" });
  assert.equal(del.ok, true, del.error);
  assert.equal(gas.log(logId), null);
  const again = gas.post({ action: "deleteMealLog", idToken: "t-U1", source: "shoquji", clientId: "c1" });
  assert.equal(again.ok, true, "もうないときも、しょくじには失敗にしない");
  const strict = gas.post({ action: "updateMealLog", idToken: "t-U1", source: "liff", logId: "x", meal: "朝", menu: "a", mealDate: day(0) });
  assert.equal(strict.ok, false, "前の画面の呼び方は今までどおり");
});

test("しょくじから開いた、まだこのボットを使っていない人：登録しない・管理者に知らせない・何も書かない（しょくじは端末の中だけ）", () => {
  const gas = makeMealGas();
  gas.reset();
  for (const body of [
    { action: "getLiffAppState", source: "shoquji" },
    { action: "listMealLogs", from: day(-1), to: day(0) },
    { action: "submitMealBatch", source: "shoquji", dedupe: false, sendLineSummary: false, items: [{ meal: "朝", menu: "パン", mealDate: day(0), clientId: "g1" }] },
  ]) {
    const res = gas.post({ idToken: "t-NEW", ...body });
    assert.equal(res.ok, false, body.action);
    assert.equal(res.error, "notyou", "くらぶボットの使う人でない（持ち主が許していない）");
  }
  assert.equal(gas.user(UNEW), null, "しょくじの人に入れない");
  assert.equal(gas.replies().filter((r) => r.kind === "push").length, 0, "持ち主にお知らせしない");
  assert.equal(gas.logsOf(UNEW).length, 0);
});

test("季節の絵文字（season.gs は core.test.mjs で確かめる）：記録したときの見出しにだけ付き、altText・きょうの集計には付けない", () => {
  const gas = makeMealGas();
  // 出るとき（rand を 0 に固定）
  gas.run("QSeason.__real = QSeason.decorate; QSeason.decorate = function (t) { return QSeason.__real(t, { rand: function () { return 0; } }); }");
  gas.line({ type: "message", message: { type: "text", id: "s1", text: "カレーライス" } });
  let card = gas.lastMessages()[0];
  const head = card.contents.type === "carousel" ? card.contents.contents[0].header : card.contents.header;
  assert.match(head.contents[1].text, /カレーライス を記録 \S+$/u, head.contents[1].text);
  assert.doesNotMatch(card.altText, /記録 \S+｜/u, "altText には付けない");
  gas.line({ type: "postback", postback: { data: "m=meal&action=showSummary" } });
  card = gas.lastMessages()[0];
  const sumHead = card.contents.type === "carousel" ? card.contents.contents[0].header : card.contents.header;
  assert.equal(sumHead.contents[1].text, "きょうの集計");
  // 出ないとき（rand を 0.99 に固定）
  gas.run("QSeason.decorate = function (t) { return QSeason.__real(t, { rand: function () { return 0.99; } }); }");
  gas.line({ type: "message", message: { type: "text", id: "s2", text: "トースト" } });
  card = gas.lastMessages()[0];
  const plain = card.contents.type === "carousel" ? card.contents.contents[0].header : card.contents.header;
  assert.equal(plain.contents[1].text, "トースト を記録");
});

test("MYメニュー：共通と自分の。ほかの人の品は見えない。共通を直すと自分用の写し（固定も付けかえ）、管理者は共通を直せる", () => {
  const gas = makeMealGas();
  const M = gas.cols.master;
  const sh = gas.sheet("nutrition_master");
  sh.rows.push(gas.row(M, { masterKey: "c-curry", name: "カレー", kcal: 700, status: "active", scope: "common" }));
  sh.rows.push(gas.row(M, { masterKey: "p-u2", name: "はなのひみつ鍋", kcal: 300, note: "ないしょ", status: "active", owner: U2, scope: "personal" }));
  gas.run("mealForgetMemo_('masters'); mealForgetMemo_('mastersByKey'); CacheService.getScriptCache().remove(MEAL_NUTRITION_MASTER_CACHE_KEY)");
  gas.post({ action: "updateProfile", idToken: "t-U1", favorites: ["c-curry"] });

  const state = gas.post({ action: "getLiffAppState", idToken: "t-U1", source: "shoquji" });
  const names = state.menus.map((m) => m.menu);
  assert.ok(names.includes("カレー"), "共通は見える");
  assert.ok(!names.includes("はなのひみつ鍋"), "ほかの人の品は見えない");
  assert.equal(state.menus.find((m) => m.menu === "カレー").scope, "common");

  // U1 が共通のカレーを 900 に直す → 自分用の写し（共通はそのまま）
  const saved = gas.post({ action: "saveNutritionMasterOnly", idToken: "t-U1", source: "shoquji", masterKey: "c-curry", menu: "カレー", kcal: 900 });
  assert.equal(saved.ok, true, saved.error);
  const rows = gas.rows("nutrition_master").slice(1).map((r) => Object.fromEntries(M.map((k, i) => [k, r[i]])));
  assert.equal(rows.find((r) => r.masterKey === "c-curry").kcal, 700, "共通は変わらない");
  const mine = rows.find((r) => r.name === "カレー" && r.owner === U1);
  assert.equal(mine.kcal, 900);
  assert.equal(mine.scope, "personal");
  assert.deepEqual(JSON.parse(gas.user(U1).favorites), [mine.masterKey], "固定も写しに付けかえる");

  // U1 がトークで「カレー」→ 自分の 900 が使われる。U2 は共通の 700
  gas.line({ type: "message", message: { type: "text", id: "c1", text: "カレー" } });
  assert.equal(gas.logsOf(U1).filter((l) => l.menu === "カレー").pop().kcal, 900);
  gas.line({ type: "message", message: { type: "text", id: "c2", text: "カレー" }, source: { type: "user", userId: U2 } });
  assert.equal(gas.logsOf(U2).filter((l) => l.menu === "カレー").pop().kcal, 700);

  // 管理者は共通を直せる
  const admin = gas.post({ action: "saveNutritionMasterOnly", idToken: "t-ADMIN", source: "shoquji", masterKey: "c-curry", menu: "カレー", kcal: 720 });
  assert.equal(admin.ok, true, admin.error);
  const after = gas.rows("nutrition_master").slice(1).map((r) => Object.fromEntries(M.map((k, i) => [k, r[i]])));
  assert.equal(after.find((r) => r.masterKey === "c-curry").kcal, 720);

  // 新しい品を共通と同じ数字で保存しても、写しは作らない
  const before = gas.rows("nutrition_master").length;
  gas.post({ action: "saveNutritionMasterOnly", idToken: "t-U2", source: "shoquji", menu: "カレー", kcal: 720 });
  assert.equal(gas.rows("nutrition_master").length, before);
});

test("文かカードか（ux.md H10）：目標を変えたら集計カードで返し、目標は「🎯 目標を変える」で押して変えられる。しょくじのひとことはカードの中に", () => {
  const gas = makeMealGas();
  gas.line({ type: "message", message: { type: "text", text: "目標 1800" } });
  let msgs = gas.lastMessages();
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].type, "flex");
  assert.match(msgs[0].altText, /目標を 1,?800 kcal に.*目標 1,?800 kcal/);
  const target = (m) => m.quickReply.items.find((i) => i.action.label === "🎯 目標を変える");
  assert.equal(target(msgs[0]).action.fillInText, "目標 1800");
  assert.equal(target(msgs[0]).action.inputOption, "openKeyboard");
  assert.equal(gas.user(U1).calorieTarget, 1800);

  gas.line({ type: "postback", postback: { data: "m=meal&action=showSummary" } });
  assert.ok(target(gas.lastMessages()[0]), "きょうの集計からも目標を変えられる");
  // 押したときの postback は何もしない（入力欄が開くだけ。入力中も出さない）
  gas.reset();
  gas.line({ type: "postback", postback: { data: "m=meal&action=askTarget" } });
  assert.equal(gas.replies().length, 0);
  assert.equal(gas.fetches.some((f) => /loading/.test(f.url)), false);

  // しょくじ：きのうの分は「◯/◯ の分として」をカードの中に。文を別に重ねない
  gas.line({ type: "message", message: { type: "text", text: `#しょくじ ${day(-1).replace(/-/g, "/")}\n夜 そば 500kcal` } });
  msgs = gas.lastMessages();
  assert.equal(msgs.length, 1);
  assert.match(JSON.stringify(msgs[0].contents), /の分として記録しました/);
  assert.deepEqual(gas.errors(), []);
});

test("持ち主のテストの窓口（ux.md H11）：くらぶボットの「#テスト」に、しょくじの見本。見本はすべて reply で、🧪 付き。本物には書かない", () => {
  const gas = makeMealGas();
  const admin = (event) => gas.line({ source: { type: "user", userId: UADMIN }, ...event });
  const snapshot = () => JSON.stringify(["meal_logs", "meal_users", "nutrition_master"].map((n) => gas.rows(n)));
  const before = snapshot();
  gas.reset();
  admin({ type: "message", message: { type: "text", text: "#テスト" } });
  let msgs = gas.lastMessages();
  assert.match(msgs[0].altText, /^🧪 テストの窓口/);
  assert.ok(msgs[0].quickReply.items.some((i) => i.action.data === "m=core&a=test&t=meal"));
  admin({ type: "postback", postback: { data: "m=core&a=test&t=meal" } });
  msgs = gas.lastMessages();
  const kinds = msgs[0].quickReply.items.map((i) => new URLSearchParams(i.action.data).get("t")).filter((t) => /^meal\./.test(t));
  assert.deepEqual(kinds, ["meal.log", "meal.input", "meal.target", "meal.notice"]);

  for (const kind of kinds) {
    gas.reset();
    admin({ type: "postback", postback: { data: `m=core&a=test&t=${kind}` } });
    const replies = gas.replies();
    assert.equal(replies.filter((r) => r.kind === "push").length, 0, `${kind}：push は使わない`);
    msgs = replies.filter((r) => r.kind === "reply").pop().messages;
    assert.ok(msgs.length >= 1 && msgs.length <= 5, kind);
    for (const m of msgs) assert.match(m.type === "text" ? m.text : m.altText, /^🧪/, `${kind}：見本には 🧪`);
    // 見本のボタンは、押してもテストの窓口に戻るだけ（uri と テストのボタンだけ）
    const actions = JSON.stringify(msgs).match(/"data":"[^"]*"/g) || [];
    assert.ok(actions.every((a) => a.includes("m=core&a=test")), `${kind}：${actions.join(" ")}`);
    assert.doesNotMatch(JSON.stringify(msgs.map((m) => ({ ...m, quickReply: undefined }))), /"type":"message","label"/, `${kind}：送ると記録になるボタンがない`);
  }
  assert.equal(snapshot(), before, "本物の記録・人・MYメニューに書いていない");
  assert.deepEqual(gas.errors(), []);

  // ふつうの人：#テスト は知らない言葉と同じ（窓口のカードは出ない）
  gas.reset();
  gas.line({ type: "message", message: { type: "text", text: "#テスト" } });
  assert.doesNotMatch(JSON.stringify(gas.lastMessages()), /🧪/);
});
test("カードのボタン（ux.md H2・postback）：MYメニューに保存はカードからも押せる。2回目・ほかの人・消した記録は、書かずにそう返す", () => {
  const gas = makeMealGas();
  gas.line({ type: "message", message: { type: "text", text: "夜 なぞ定食" } });
  gas.line({ type: "message", message: { type: "text", text: "夜 300" } });
  const card = gas.lastMessages().find((m) => /MYメニューにも保存できます/.test(m.altText || ""));
  const button = card.contents.footer.contents.find((b) => b.action.type === "postback").action;
  assert.match(button.data, /action=savePendingMaster/);
  const masters = () => gas.rows("nutrition_master").length;
  const n = masters();

  gas.line({ type: "postback", postback: { data: button.data } });
  assert.match(gas.lastMessages()[0].text, /MYメニューに保存しました/);
  assert.equal(masters(), n + 1);
  // 何日もあと・2回目：もうある
  gas.line({ type: "postback", postback: { data: button.data } });
  assert.match(gas.lastMessages()[0].text, /もうMYメニューにあります/);
  assert.equal(masters(), n + 1);
  // ほかの人が押した
  gas.line({ type: "postback", source: { type: "user", userId: U2 }, postback: { data: button.data } });
  assert.match(gas.lastMessages()[0].text, /見つかりませんでした/);
  assert.equal(masters(), n + 1);
  // 記録を消したあと
  const logId = new URLSearchParams(button.data).get("logId");
  assert.equal(gas.post({ action: "deleteMealLog", idToken: "t-U1", logId, sendLineSummary: false }).ok, true);
  gas.line({ type: "postback", postback: { data: button.data } });
  assert.match(gas.lastMessages()[0].text, /見つかりませんでした/);
  assert.deepEqual(gas.errors(), []);
});

test("送る形：くらぶボットの形 { app: qlove, v: 1, tool: shoquji, action } でも同じに受ける。ほかのツールあて・ちがう版は受けない", () => {
  const gas = makeMealGas();
  const q = (action, extra = {}) => ({ app: "qlove", v: 1, tool: "shoquji", action, liffId: "2010088825-CulmmaFc", idToken: "t-U1", ...extra });
  const rec = gas.post(q("submitMealBatch", { items: [{ meal: "朝", menu: "パン", mealDate: day(0), kcal: 200, clientId: "q1" }], source: "shoquji", dedupe: false, sendLineSummary: false }));
  assert.equal(rec.ok, true, rec.error);
  const list = gas.post(q("listMealLogs", { from: day(-1), to: day(0) }));
  assert.ok(list.logs.some((l) => l.clientId === "q1"));
  assert.equal(gas.post({ ...q("listMealLogs", { from: day(-1), to: day(0) }), tool: "tuzuq" }).ok, false);
  assert.equal(gas.post({ ...q("listMealLogs", { from: day(-1), to: day(0) }), v: 2 }).ok, false);
});

test("あいさつ・返事（こんにちは・ありがとう・はい・？）は、食事として記録しない。くらぶボットの案内を返す", () => {
  const gas = makeMealGas();
  const before = gas.logsOf(U1).length;
  for (const text of ["こんにちは", "ありがとう！", "はい", "？", "使い方"]) {
    gas.line({ type: "message", message: { type: "text", text } });
    assert.equal(gas.logsOf(U1).length, before, text);
    assert.match(gas.lastMessages()[0].text, /下のボタンから選んでね/, text);
  }
  gas.line({ type: "message", message: { type: "text", text: "こんにゃく" } });
  assert.equal(gas.logsOf(U1).length, before + 1, "似た名前の食べものは記録する");
});
