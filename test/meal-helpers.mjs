// テストの道具（機能「🍚 しょくじ」）：前の食事記録ボットのテスト（line-meal-project/test/helper.js）と同じ形で、くらぶボットを動かす
//   U1・U2（使える人）・UADMIN（持ち主）・UPEND（まだ使えない人）と、MYメニュー3つ・U1 の記録
//   gas.post(body) … しょくじ（LIFF）からの呼び出し（{ app: "qlove", tool: "shoquji", action, … }。ID トークンは "t-U1" など）
//   gas.line(event) … LINE の出来事（送り主は、なければ U1）
import { makeBot, KEY, OWNER, checkMessages, response } from "./helpers.mjs";

export const U1 = "U" + "1".repeat(32);
export const U2 = "U" + "2".repeat(32);
export const UADMIN = OWNER;
export const UPEND = "U" + "e".repeat(32);
export const UNEW = "U" + "f".repeat(32);
export const SHOQUJI_LIFF = "2010088825-CulmmaFc";
export { checkMessages, response };

// ID トークン → 本人。ここにないトークンは LINE が断る
const TOKENS = {
  "t-U1": { sub: U1, name: "かつ" },
  "t-U2": { sub: U2, name: "はな" },
  "t-ADMIN": { sub: UADMIN, name: "管理者" },
  "t-PENDING": { sub: UPEND, name: "まち" },
  "t-NEW": { sub: UNEW, name: "しらないひと" }
};
// ID トークンの形（ヘッダー.中身.署名。くらぶボットは形も確かめる）
const jwt = (t) => `${Buffer.from(t).toString("base64url")}.e30.c2ln`;

export const day = (n) => {
  const d = new Date(Date.now() + 9 * 3600e3);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** しょくじの機能を用意する（くらぶボットに、使う人とつないだツール・前の食事記録のシートを入れたもの） */
export function makeMealGas({ properties = {}, fetch, seed = true } = {}) {
  const byJwt = Object.fromEntries(Object.entries(TOKENS).map(([t, who]) => [jwt(t), who]));
  const gas = makeBot({
    properties,
    members: [
      [U1, "かつ", "allowed", "", ""],
      [U2, "はな", "allowed", "", ""]
    ],
    verify: (payload) => {
      const who = byJwt[payload && payload.id_token];
      if (!who) return response(400, { error: "invalid_request", error_description: "Invalid IdToken." });
      return response(200, { sub: who.sub, name: who.name, aud: payload.client_id, iss: "https://access.line.me", exp: Date.now() / 1000 + 3600 });
    },
    fetch
  });
  gas.env = () => gas.eval("useEnv_(env_())");
  gas.env();
  gas.call("mealSetupProject_");
  // しょくじの人と、ボットの人をつないでおく（「🔗 ツールとつなぐ」をすませた形）
  const hash = (sub) => gas.call("sha256Hex_", `qlove:${sub}`);
  gas.seed("つないだツール", [["subHash", "userId", "tool", "createdAt"], ...Object.values(TOKENS).map((w) => [hash(w.sub), w.sub, "しょくじ", ""])]);
  const cols = (name) => gas.eval(name);
  const row = (columns, o) => columns.map((k) => o[k] ?? "");
  gas.cols = { users: cols("MEAL_USER_COLUMNS"), meal: cols("MEAL_LOG_COLUMNS"), master: cols("MEAL_NUTRITION_MASTER_COLUMNS") };
  gas.row = row;

  if (seed) {
    const U = gas.cols.users;
    gas.seed("meal_users", [
      U,
      row(U, { userId: U1, displayName: "かつ", calorieTarget: 2000, goalType: "keep", notify: true, status: "active", favorites: '["m3"]' }),
      row(U, { userId: U2, displayName: "はな", calorieTarget: 1800, goalType: "keep", notify: true, status: "active", favorites: "[]" }),
      row(U, { userId: UADMIN, displayName: "管理者", calorieTarget: 2000, goalType: "keep", notify: true, status: "active", favorites: "[]" }),
      row(U, { userId: UPEND, displayName: "まち", calorieTarget: 2000, goalType: "keep", notify: true, status: "pending", favorites: "[]" })
    ]);
    const M = gas.cols.master;
    gas.seed("nutrition_master", [
      M,
      ...[["m1", "トースト", 250, 8, 6, 40], ["m2", "カレーライス", 780, 20, 25, 110], ["m3", "プロテイン", 120, 20, 2, 5]].map(([masterKey, name, kcal, protein, fat, carb]) =>
        row(M, { masterKey, name, kcal, protein, fat, carb, status: "active" }))
    ]);
    const L = gas.cols.meal;
    const logs = [L];
    for (let d = -6; d <= 0; d++) {
      logs.push(row(L, { mealDate: new Date(`${day(d)}T08:00:00+09:00`), userId: U1, meal: "朝", menu: "トースト", kcal: 250, protein: 8, fat: 6, carb: 40, kcalStatus: "exact", masterKey: "m1", logId: `a${d}` }));
      logs.push(row(L, { mealDate: new Date(`${day(d)}T12:00:00+09:00`), userId: U1, meal: "昼", menu: "カレーライス", kcal: 780, kcalStatus: "exact", masterKey: "m2", logId: `b${d}` }));
    }
    logs.push(row(L, { mealDate: new Date(`${day(0)}T15:00:00+09:00`), userId: U1, meal: "その他", menu: "チョコ", kcalStatus: "pending", logId: "p1" }));
    logs.push(row(L, { mealDate: new Date(`${day(0)}T12:00:00+09:00`), userId: U2, meal: "昼", menu: "うどん", kcal: 400, kcalStatus: "exact", logId: "u2-1" }));
    gas.seed("meal_logs", logs);
  }
  // キャッシュ（シートがそろっているかの印など）は、前の用意のぶんを消しておく
  gas.reset();

  // 終わったら、本物のシートと同じく、先頭の ' を外した値で持つ（' は「文字のまま」の印で、読むときには付かない）
  const settle = () => {
    for (const sheet of gas.ctx.SpreadsheetApp.getActiveSpreadsheet().getSheets()) {
      sheet.rows.forEach((r) => r && r.forEach((v, i) => {
        if (typeof v === "string" && v.startsWith("'")) r[i] = v.slice(1);
      }));
    }
  };
  const wrap = (fn) => (...args) => {
    try {
      return fn(...args);
    } finally {
      settle();
    }
  };
  gas.post = wrap((body) => {
    const { idToken, ...rest } = body || {};
    return gas.doPost({ app: "qlove", v: 1, tool: "shoquji", liffId: SHOQUJI_LIFF, idToken: idToken ? jwt(idToken) : undefined, ...rest });
  });
  gas.line = wrap((event, key = KEY) => gas.lineEvent({ replyToken: `reply-${Math.random().toString(36).slice(2)}`, source: { type: "user", userId: U1 }, ...event }, { key }));
  gas.run = wrap((expr) => {
    gas.env(); // 呼び出しごとに新しく動く（覚え書きを空にする）
    return gas.eval(expr);
  });
  gas.log = (logId) => {
    const L = gas.cols.meal;
    const r = gas.rows("meal_logs").find((x) => x[L.indexOf("logId")] === logId);
    return r ? Object.fromEntries(L.map((k, i) => [k, r[i]])) : null;
  };
  gas.logsOf = (userId) => {
    const L = gas.cols.meal;
    return gas.rows("meal_logs").slice(1).filter((x) => x[L.indexOf("userId")] === userId).map((r) => Object.fromEntries(L.map((k, i) => [k, r[i]])));
  };
  gas.user = (userId) => {
    const U = gas.cols.users;
    const r = gas.rows("meal_users").find((x) => x[0] === userId);
    return r ? Object.fromEntries(U.map((k, i) => [k, r[i]])) : null;
  };
  gas.errors = () => gas.flexProblems().filter((p) => p.level === "error");
  return gas;
}
