// つづく（LIFF）から呼ぶ受け口のテスト（ライブラリの 5_features/tuzuq_api.gs）
// 呼ばれ方は2つ：持ち主は入口の GAS の doPost から、複製を使う人はこのプロジェクトの doPost（2_web.gs）から
//   node --test test/
import test from "node:test";
import assert from "node:assert";
import { OWNER, OTHER, KEY, BOOK, LIFF_CHANNEL, LIFF_OWNER, make, textEvent, githubPuts, logRows, response } from "./log-helpers.mjs";
import { messageText } from "./log-helpers.mjs";

const nowSec = () => Math.floor(Date.now() / 1000);
const claims = (sub, extra = {}) => ({ iss: "https://access.line.me", sub, aud: LIFF_CHANNEL, exp: nowSec() + 3600, iat: nowSec(), name: "かつ", ...extra });
const NEWBIE = "Ud0000000000000000000000000000004";
const TOKENS = {
  "h.owner.s": claims(LIFF_OWNER),
  "h.other.s": claims(OTHER),
  "h.newbie.s": claims(NEWBIE, { name: "あたらしい人" }),
  "h.channel.s": claims(LIFF_OWNER, { aud: "1999999999" }), // ほかのチャネルあて
  "h.expired.s": claims(LIFF_OWNER, { exp: nowSec() - 10 }), // 期限切れ（LINE が 200 を返したとしても）
  "h.issuer.s": claims(LIFF_OWNER, { iss: "https://evil.example.com" }),
  "h.badsub.s": claims("not-a-line-id"),
};
const ALIASES = [["action", "alias", "enabled"], ["workout", "workout", true], ["workout", "筋トレ", true], ["coding", "coding", true]];
const setup = (o = {}) => {
  const made = make({ idTokens: TOKENS, ...o });
  made.lib.seed("action_aliases", ALIASES, BOOK);
  return made;
};
const today = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
// 持ち主（katsuan）：入口の GAS へ
const record = (entry, idToken, text = "# workout", extra = {}) => entry.doPost({ app: "tuzuq", v: 1, op: "record", idToken, text, date: today(), ...extra });
const days = (entry, idToken, texts = ["# workout"], extra = {}) => entry.doPost({ app: "tuzuq", v: 1, op: "days", idToken, texts, ...extra });
const verifyCalls = (gas) => gas.fetches.filter((f) => /oauth2\/v2\.1\/verify/.test(f.url));
const seedLog = (lib, id, date, action, userId, source = "LINE") => lib.sheet("logs", BOOK).rows.push([id, date, action, 0, action, source, userId]);
const pushes = (entry) => entry.fetches.filter((f) => /\/v2\/bot\/message\/push$/.test(f.url));

test("つづく：トークンなし・形がちがう・偽物・ほかのチャネルあて・期限切れ・ほかの発行元は、書けず読めない", () => {
  const { lib, entry } = setup();
  seedLog(lib, "L1", new Date(), "workout", LIFF_OWNER);
  const bad = [undefined, "", 123, "no-dots", "a.b", "x".repeat(5000) + ".a.b", "h.fake.s", "h.channel.s", "h.expired.s", "h.issuer.s", "h.badsub.s"];
  bad.forEach((t) => {
    assert.deepEqual(record(entry, t), { ok: false, error: "auth" }, String(t).slice(0, 20));
    assert.deepEqual(days(entry, t), { ok: false, error: "auth" }, String(t).slice(0, 20));
  });
  assert.equal(logRows(lib).length, 1, "増えていない");
  assert.equal(githubPuts(lib).length, 0);
  assert.ok(verifyCalls(lib).every((f) => f.opt.payload.client_id === LIFF_CHANNEL));
});

test("つづく：持ち主の○は、シートに記録して GitHub に PUT する（LINE の ID は書かない）", () => {
  const { lib, entry, files } = setup();
  const res = record(entry, "h.owner.s", "# 💪workout");
  assert.deepEqual(res, { ok: true, added: true, date: today(), github: true });
  const rows = logRows(lib);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][2], "workout");
  assert.equal(rows[0][5], "TUZUQ");
  assert.equal(rows[0][6], OWNER, "くらぶボットの持ち主の ID で記録する");
  const puts = githubPuts(lib);
  assert.equal(puts.length, 1);
  assert.match(puts[0].url, new RegExp(`repos/katsuan/github/contents/logs/${today()}\\.jsonl$`));
  const body = Object.values(files)[0].content;
  assert.match(body, /"action":"workout"/);
  assert.doesNotMatch(body, new RegExp(`${LIFF_OWNER}|${OWNER}`));
});

test("つづく：同じ日・同じ習慣は1件だけ（2回押しても・通信をやりなおしても・LINE のトークで先に送っていても）", () => {
  const { lib, entry, files } = setup();
  assert.equal(record(entry, "h.owner.s").added, true);
  assert.equal(record(entry, "h.owner.s").added, false);
  assert.equal(record(entry, "h.owner.s", "＃workout").added, false, "書き方がちがっても同じ行動");
  assert.equal(record(entry, "h.owner.s", "# 筋トレ").added, false, "言いかえでも同じ行動（action_aliases）");
  assert.equal(logRows(lib).length, 1);
  assert.equal(Object.values(files)[0].content.trim().split("\n").length, 1);
  assert.equal(githubPuts(lib).length, 1);
  // トーク（LIFF とはちがう ID）で先に # coding を送っていたら、つづくからは足さない
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  assert.equal(record(entry, "h.owner.s", "# coding").added, false);
  assert.equal(logRows(lib).length, 2);
  assert.equal(record(entry, "h.owner.s", "# 読書").added, true);
  assert.equal(logRows(lib).length, 3);
});

test("つづく：持ち主でない人は、書けず読めない（送ってきた userId も使わない）", () => {
  const { lib, entry } = setup();
  record(entry, "h.owner.s");
  assert.deepEqual(record(entry, "h.other.s", "# coding", { userId: LIFF_OWNER }), { ok: false, error: "link" }); // つないでいない人
  assert.deepEqual(days(entry, "h.other.s", ["# workout"], { userId: LIFF_OWNER }), { ok: false, error: "link" }); // つないでいない人
  assert.equal(logRows(lib).length, 1);
});

test("つづく：読むのは、行動ごとの記録した日（ここ4か月）だけ。トーク・Alfred の記録の日も入る。本文・時刻・ID は返さない", () => {
  const { lib, entry } = setup();
  const d = (n) => new Date(Date.now() - n * 86400000);
  seedLog(lib, "L1", d(1), "workout", OWNER); // トークで送った記録（入口の user_id）
  seedLog(lib, "L2", d(1), "workout", OWNER); // 同じ日の2件目
  seedLog(lib, "L3", d(5), "workout", OWNER, "ALFRED");
  seedLog(lib, "L4", d(200), "workout", OWNER); // 古い
  seedLog(lib, "L5", d(2), "workout", OTHER); // ほかの人
  seedLog(lib, "L6", d(3), "coding", LIFF_OWNER, "TUZUQ");
  record(entry, "h.owner.s", "# workout");
  const res = days(entry, "h.owner.s", ["# workout", "＃ 筋トレ", "# coding", "# 読書", "# trip", ""]);
  assert.equal(res.ok, true);
  const ymd = (n) => new Date(d(n).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  assert.deepEqual(res.days[0], [ymd(5), ymd(1), today()]);
  assert.deepEqual(res.days[1], res.days[0], "言いかえでも同じ");
  assert.deepEqual(res.days[2], [ymd(3)]);
  assert.deepEqual(res.days.slice(3), [[], [], []]);
  assert.doesNotMatch(JSON.stringify(res), new RegExp(`${OWNER}|${LIFF_OWNER}|L1|L3|T\\d{2}:`));
  assert.deepEqual(Object.keys(res).sort(), ["days", "github", "ok", "today"]);
});

test("つづく：式になる文字は、式のままシートに入らない", () => {
  const { lib, entry } = setup();
  assert.equal(record(entry, "h.owner.s", "# -workout").ok, true);
  assert.equal(record(entry, "h.owner.s", "# +coding").ok, true);
  assert.equal(record(entry, "h.owner.s", '=HYPERLINK("https://example.com","x")').error, "bad");
  assert.deepEqual(lib.formulaCells(), []);
  assert.match(String(logRows(lib)[0][4]), /^'-workout/);
});

test("つづく：形・長さ・日付・数をこえるものは断る", () => {
  const { lib, entry } = setup();
  ["# " + "a".repeat(59), "# workout\n# coding", "# trip", "# s coding", "# test", "# users", "+15", "#", "   ", "# 持ち主", 5, null].forEach((t) => {
    assert.equal(record(entry, "h.owner.s", t).error, "bad", String(t));
  });
  assert.equal(record(entry, "h.owner.s", "# workout", { date: "2025-01-01" }).error, "day");
  assert.equal(record(entry, "h.owner.s", "# workout", { date: undefined }).error, "day");
  assert.equal(days(entry, "h.owner.s", Array.from({ length: 13 }, () => "# workout")).error, "bad");
  assert.equal(days(entry, "h.owner.s", "# workout").error, "bad");
  assert.equal(entry.doPost({ app: "tuzuq", op: "delete", idToken: "h.owner.s" }).error, "bad");
  assert.equal(logRows(lib).length, 0);
});

test("つづく：1日に書けるのは30件まで", () => {
  const { lib, entry } = setup();
  for (let i = 0; i < 32; i += 1) record(entry, "h.owner.s", `# habit${i}`);
  assert.equal(logRows(lib).length, 30);
  assert.equal(record(entry, "h.owner.s", "# habit99").error, "many");
});

test("つづく：GitHub に書けなかったときは記録だけ残し、次の○で GitHub に入れる", () => {
  let down = true;
  const { lib, entry, files } = setup();
  const orig = lib.ctx.UrlFetchApp.fetch;
  lib.ctx.UrlFetchApp.fetch = (url, opt = {}) => {
    if (down && /api\.github\.com/.test(url) && String(opt.method).toLowerCase() === "put") throw new Error("GitHub 503 secret-detail");
    return orig(url, opt);
  };
  const first = record(entry, "h.owner.s");
  assert.deepEqual(first, { ok: true, added: true, date: today(), github: false });
  assert.doesNotMatch(JSON.stringify(first), /secret-detail/);
  assert.match(lib.properties.LAST_LINE_ERRORS, /tuzuq_github_failed/);
  down = false;
  assert.deepEqual(record(entry, "h.owner.s"), { ok: true, added: false, date: today(), github: true });
  assert.equal(Object.values(files)[0].content.trim().split("\n").length, 1);
  record(entry, "h.owner.s");
  assert.equal(Object.values(files)[0].content.trim().split("\n").length, 1, "もう入っていれば PUT しない");
});

test("つづく：GitHub をつないでいない GAS でも、記録して読める（GitHub はあとから足すもの）", () => {
  const { lib, entry } = setup();
  ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"].forEach((k) => delete lib.properties[k]);
  assert.deepEqual(record(entry, "h.owner.s"), { ok: true, added: true, date: today(), github: false });
  assert.equal(githubPuts(lib).length, 0);
  const res = days(entry, "h.owner.s");
  assert.deepEqual(res.days, [[today()]]);
  assert.equal(res.github, false);
});

test("つづく：エラーの中身は返さない。ログにも LINE の ID を出さない", () => {
  const { lib, entry } = setup();
  lib.ctx.logGetLogs_ = () => { throw new Error("sheet-internal-secret"); };
  assert.deepEqual(record(entry, "h.owner.s"), { ok: false, error: "fail" });
  assert.match(lib.properties.LAST_LINE_ERRORS, /sheet-internal-secret/, "中身は管理者だけが見るところに");
  const all = [...entry.logs, ...lib.logs, lib.properties.LAST_LINE_ERRORS].join("\n");
  assert.ok(!all.includes(LIFF_OWNER) && !all.includes(OWNER));
});

test("つづく：同じトークンは LINE に1回だけ確かめる（覚えるのはハッシュのキー）", () => {
  const { lib, entry } = setup();
  record(entry, "h.owner.s");
  days(entry, "h.owner.s");
  record(entry, "h.owner.s", "# coding");
  assert.equal(verifyCalls(lib).length, 1);
  assert.equal(verifyCalls(lib)[0].method, "post");
  assert.ok(!JSON.stringify(lib.properties).includes("h.owner.s"), "トークンは残さない");
});

test("つづく：LINE の Webhook の道は、今までどおり合言葉がいる（つづくの形にまぜても通らない）", () => {
  const { lib, entry } = setup();
  entry.doPost({ app: "tuzuq", op: "record", idToken: "h.owner.s", text: "# workout", date: today(), events: [textEvent("# coding")] });
  assert.equal(entry.fetches.filter((f) => /\/message\/reply$/.test(f.url)).length, 0, "LINE のイベントとしては返事しない");
  assert.equal(logRows(lib).length, 1);
  assert.equal(logRows(lib)[0][2], "workout");
});

test("つづく：LINE が断ったとき（期限切れなど 400）は auth", () => {
  const { lib, entry } = setup();
  lib.ctx.UrlFetchApp.fetch = (url) => (/verify/.test(url) ? response(400, { error: "invalid_request", error_description: "IdToken expired." }) : response(200, {}));
  assert.deepEqual(record(entry, "h.owner.s"), { ok: false, error: "auth" });
});

test("知らせ：はじめは、つづくで記録してもトークに知らせない（push の数を使うため）", () => {
  const { entry } = setup();
  assert.equal(record(entry, "h.owner.s").added, true);
  assert.equal(pushes(entry).length, 0);
});

test("知らせ：「# 通知 記録 on」にすると、新しく記録したときだけ、持ち主のトークに1通（2回目・入っていた日は送らない）", () => {
  const { entry } = setup();
  entry.lineEvent(textEvent("# 通知 記録 on"), { key: KEY });
  assert.equal(entry.properties.LOG_TUZUQ_NOTIFY, "on");
  assert.match(JSON.stringify(entry.lastMessages()), /記録したときの知らせ：あり/);
  record(entry, "h.owner.s", "# coding");
  assert.equal(pushes(entry).length, 1);
  assert.equal(pushes(entry)[0].json.to, OWNER, "トークの ID（LIFF の ID ではない）に送る");
  const notice = pushes(entry)[0].json.messages[0];
  assert.equal(notice.type, "flex"); // 記録した中身はカード（H10）。通知の文は altText
  assert.match(notice.altText, /つづくで記録しました：# coding（GitHub にも）/);
  assert.match(messageText(notice), /🌱 GitHub にも記録しました/);
  record(entry, "h.owner.s", "# coding");
  days(entry, "h.owner.s");
  assert.equal(pushes(entry).length, 1);
  // 断られたとき・持ち主でないときは送らない
  record(entry, "h.other.s", "# workout");
  record(entry, "h.owner.s", "# trip");
  assert.equal(pushes(entry).length, 1);
});

test("知らせ：「# 通知 記録 off」で止まる。送れなくても記録はそのまま", () => {
  const { lib, entry } = setup();
  entry.lineEvent(textEvent("# 通知 記録 on"), { key: KEY });
  entry.lineEvent(textEvent("＃通知　記録なし"), { key: KEY });
  assert.equal(entry.properties.LOG_TUZUQ_NOTIFY, "off");
  assert.equal(record(entry, "h.owner.s").added, true);
  assert.equal(pushes(entry).length, 0);
  entry.properties.LOG_TUZUQ_NOTIFY = "on";
  entry.fail.pushAll = true; // LINE が push を断る（送れる数がない など）
  assert.deepEqual(record(entry, "h.owner.s", "# coding"), { ok: true, added: true, date: today(), github: true });
  assert.equal(logRows(lib).length, 2);
});

test("知らせ：GitHub につないでいなければ「GitHub にも」は付けない", () => {
  const { lib, entry } = setup();
  entry.properties.LOG_TUZUQ_NOTIFY = "on";
  ["GITHUB_TOKEN", "GITHUB_OWNER", "GITHUB_REPO"].forEach((k) => delete lib.properties[k]);
  record(entry, "h.owner.s");
  assert.doesNotMatch(messageText(pushes(entry)[0].json.messages[0]), /GitHub/);
});

test("前の日：7日前まで記録する（その日の12時・本文に「（あとから）」・GitHub の草もその日）。それより前と未来は断る", () => {
  const { lib, entry, files } = setup();
  const ago = (n) => new Date(Date.now() + 9 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
  const res = record(entry, "h.owner.s", "# workout", { date: ago(3) });
  assert.deepEqual(res, { ok: true, added: true, date: ago(3), github: true });
  const row = logRows(lib).pop();
  assert.equal(new Date(row[1]).toISOString(), new Date(`${ago(3)}T12:00:00+09:00`).toISOString());
  assert.match(String(row[4]), /（あとから）$/);
  assert.ok(files[`logs/${ago(3)}.jsonl`], "その日のファイルに入る");
  const put = lib.fetches.filter((f) => f.method === "put").pop();
  assert.equal(put.json.author.date, new Date(`${ago(3)}T12:00:00+09:00`).toISOString(), "コミットの日時もその日");
  assert.equal(record(entry, "h.owner.s", "# workout", { date: ago(3) }).added, false, "同じ日・同じ習慣は1件");
  assert.equal(record(entry, "h.owner.s", "# workout", { date: ago(7) }).added, true, "7日前まで");
  assert.equal(record(entry, "h.owner.s", "# workout", { date: ago(8) }).error, "day");
  assert.equal(record(entry, "h.owner.s", "# workout", { date: ago(-1) }).error, "day", "未来");
  assert.equal(record(entry, "h.owner.s", "# workout", { date: "2026-02-30" }).error, "day", "ない日");
  // 読むと、その日に出る
  assert.ok(days(entry, "h.owner.s", ["# workout"]).days[0].includes(ago(3)));
});

test("中身：つないだツールの中身（キロっくの種目・重さ・回数）を、本文の2行目から足す（シートと GitHub に残る。長さ・行に上限、式にしない）", () => {
  const { lib, entry, files } = setup();
  const note = "胸：ベンチプレス 60kg×10・60kg×8\nスクワット 80kg×5×3\u0007";
  const res = record(entry, "h.owner.s", "# workout", { note });
  assert.equal(res.ok, true);
  const detail = logRows(lib)[0][4];
  assert.equal(detail, "workout\n胸：ベンチプレス 60kg×10・60kg×8\nスクワット 80kg×5×3");
  const body = Object.values(files)[0].content;
  assert.match(body, /ベンチプレス 60kg×10/);
  // 長すぎ・行が多すぎ・文字でない・式
  const { lib: lib2, entry: e2 } = setup();
  record(e2, "h.owner.s", "# workout", { note: Array.from({ length: 40 }, (_, i) => `行${i} ${"あ".repeat(50)}`).join("\n") });
  const d2 = String(logRows(lib2)[0][4]);
  assert.ok(d2.split("\n").length <= 21 && d2.length <= 60 + 1 + 600 + 5, d2.length);
  const { lib: lib3, entry: e3 } = setup();
  assert.equal(record(e3, "h.owner.s", "# workout", { note: { x: 1 } }).ok, true, "形がちがえば中身なしで記録");
  assert.equal(logRows(lib3)[0][4], "workout");
});

test("いまの設定：つづくの画面からは、持ち主だけ「# 設定」と同じ中身を読める（見るだけ。鍵や ID は出さない）", () => {
  const { entry } = setup();
  record(entry, "h.owner.s", "# workout");
  days(entry, "h.owner.s", ["# workout", "# coding"]);
  const res = entry.doPost({ app: "tuzuq", v: 1, op: "status", idToken: "h.owner.s" });
  assert.equal(res.ok, true);
  const titles = res.sections.map((s) => s.title);
  assert.deepEqual(titles, ["🔔 知らせ", "✅ つづく", "🌱 GitHub", "🔧 管理者向け（あるかだけ）"]);
  assert.match(JSON.stringify(res), /送る文：# workout・# coding/);
  assert.doesNotMatch(JSON.stringify(res), /ghp_test|line-test|U[0-9a-f]{32}/);
  assert.deepEqual(entry.doPost({ app: "tuzuq", v: 1, op: "status", idToken: "h.other.s" }), { ok: false, error: "link" }); // つないでいない人
  assert.deepEqual(entry.doPost({ app: "tuzuq", v: 1, op: "status", idToken: "h.fake.s" }), { ok: false, error: "auth" });
});

