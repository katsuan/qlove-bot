// LOgBOT（入口の GAS ＋ ライブラリ GASLIB_Github）のテスト。本番のシート・LINE・GitHub には触らない。
//   node --test test/
import test from "node:test";
import assert from "node:assert";
import { OWNER, OTHER, KEY, BOOK, make, textEvent, githubPuts, logRows, decodePut } from "./log-helpers.mjs";

test("持ち主の1対1で # coding を送ると、シートに記録して GitHub に書きこむ", () => {
  const { lib, entry } = make();
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  assert.equal(logRows(lib).length, 1);
  const puts = githubPuts(lib);
  assert.equal(puts.length, 1);
  assert.match(puts[0].url, /repos\/katsuan\/github\/contents\/logs\/\d{4}-\d{2}-\d{2}\.jsonl$/);
  assert.equal(entry.replies().length, 1);
  assert.match(JSON.stringify(entry.lastMessages()), /GitHub にも記録しました/);
});

test("GitHub に書く中身に、LINE の ID と位置を入れない", () => {
  const { lib, entry } = make();
  entry.lineEvent(textEvent(["# trip", "source: carplay", "type: start", "at: 2026-10-24T08:00:00+09:00", "lat: 35.1", "lng: 139.1"].join("\n")), { key: KEY });
  entry.lineEvent(textEvent(["# trip", "source: carplay", "type: end", "at: 2026-10-24T08:30:00+09:00", "lat: 35.2", "lng: 139.2"].join("\n")), { key: KEY });
  const puts = githubPuts(lib);
  assert.ok(puts.length >= 1, "trip の end で書きこむ");
  const body = decodePut(puts[puts.length - 1]);
  assert.doesNotMatch(body, new RegExp(OWNER));
  assert.doesNotMatch(body, /_lat|_lng|35\.1|139\.1/);
  assert.match(body, /"action":"trip"/);
  // シートには位置が残る（継続の判定に使う）
  assert.match(String(logRows(lib).pop()[4]), /start_lat: 35\.1/);
});

test("持ち主でない人は記録できるが、GitHub には書きこまない", () => {
  const { lib, entry } = make();
  entry.lineEvent(textEvent("# coding", OTHER), { key: KEY });
  assert.equal(logRows(lib).length, 1);
  assert.equal(githubPuts(lib).length, 0);
  assert.doesNotMatch(JSON.stringify(entry.lastMessages()), /GitHub にも記録しました/);
});

test("グループでは、持ち主が送ったものだけ GitHub に書きこむ", () => {
  const { lib, entry } = make();
  entry.lineEvent(textEvent("# coding", OWNER, "group"), { key: KEY });
  assert.equal(githubPuts(lib).length, 1);
  assert.match(JSON.stringify(entry.lastMessages()), /GitHub にも記録しました/);
  entry.lineEvent(textEvent("# coding", OTHER, "group"), { key: KEY });
  assert.equal(githubPuts(lib).length, 1);
  assert.equal(logRows(lib).length, 2);
});

test("合言葉がない・ちがう LINE の知らせは何もしない（持ち主を名乗っても）", () => {
  const { lib, entry } = make();
  entry.lineEvent(textEvent("# coding"), {});
  entry.lineEvent(textEvent("# coding"), { key: "wrong" });
  entry.lineEvent(textEvent("# coding"), { key: KEY.slice(0, -1) });
  assert.equal(logRows(lib).length, 0);
  assert.equal(githubPuts(lib).length, 0);
  assert.equal(entry.replies().length, 0);
});

test("user_id がないときは、だれも GitHub に書きこめない", () => {
  const { lib, entry } = make({ userId: "" });
  entry.lineEvent(textEvent("# coding", OWNER), { key: KEY });
  const ev = textEvent("# coding");
  delete ev.source.userId;
  entry.lineEvent(ev, { key: KEY });
  assert.equal(githubPuts(lib).length, 0);
});

test("ほかの人の記録の分数は変えられない", () => {
  const { lib, entry } = make();
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  const ownerLogId = logRows(lib)[0][0];
  // 今日の記録がない人の +15、ほかの人の記録 ID を指した postback
  entry.lineEvent(textEvent("+15", OTHER), { key: KEY });
  entry.lineEvent({ type: "postback", replyToken: "r-pb", source: { type: "user", userId: OTHER }, postback: { data: `m=log&action=adjust_minutes&delta=60&logId=${ownerLogId}` } }, { key: KEY });
  assert.equal(Number(logRows(lib)[0][3]), 0);
  // 持ち主はできる
  entry.lineEvent(textEvent("+15"), { key: KEY });
  assert.equal(Number(logRows(lib)[0][3]), 15);
});

test("外の文字は式のままシートに入らない", () => {
  const { lib, entry } = make();
  entry.lineEvent(textEvent('# =HYPERLINK("https://example.com","x")'), { key: KEY });
  entry.lineEvent(textEvent("# @workout"), { key: KEY });
  assert.deepEqual(lib.formulaCells(), []);
  assert.match(String(logRows(lib)[0][4]), /^'=HYPERLINK/);
});

test("返事のカードは LINE が受けつける形", () => {
  const { entry } = make();
  ["# coding", "# workout", "# quest", "# REPORT", "# test", "+15", "# alfred report"].forEach((t) => entry.lineEvent(textEvent(t), { key: KEY }));
  assert.ok(entry.replies().length >= 7);
  assert.deepEqual(entry.flexProblems().filter((p) => p.level === "error"), []);
  assert.deepEqual(entry.reusedReplyTokens(), []);
});

test("エラーの中身を LINE に出さない", () => {
  const { lib, entry } = make();
  lib.ctx.logBuildPersonalStats_ = () => { throw new Error("secret-internal-detail at sheet X"); };
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  const text = JSON.stringify(entry.lastMessages());
  assert.match(text, /うまく記録できませんでした/);
  assert.doesNotMatch(text, /secret-internal-detail|reason|at:/);
  const saved = JSON.parse(lib.properties.LAST_LINE_ERRORS);
  assert.match(saved[0].message, /secret-internal-detail/);
  assert.doesNotMatch(lib.properties.LAST_LINE_ERRORS, new RegExp(OWNER));
});

test("Alfred：合言葉がちがえば何もしない。合っていれば持ち主として記録する（userId は使わない）", () => {
  const { lib, entry } = make();
  entry.doPost({ sourceApp: "alfred", secret: "wrong", text: "# coding" });
  assert.equal(logRows(lib).length, 0);
  entry.doPost({ sourceApp: "alfred", secret: "alfred-secret-0123456789", text: "# coding", userId: OTHER });
  assert.equal(logRows(lib).length, 1);
  assert.equal(logRows(lib)[0][6], OWNER);
  assert.equal(logRows(lib)[0][5], "ALFRED");
  assert.equal(githubPuts(lib).length, 1);
});

test("1回の知らせのイベントの数・文字の長さに上限がある", () => {
  const { lib, entry } = make();
  const events = Array.from({ length: 30 }, () => ({ timestamp: Date.now(), ...textEvent("# coding") }));
  entry.doPost({ destination: "Ubot", events }, { parameter: { key: KEY } });
  assert.equal(logRows(lib).length, 20);
  lib.reset();
  entry.lineEvent(textEvent("# " + "あ".repeat(6000)), { key: KEY });
  assert.ok(String(logRows(lib).pop()[4]).length <= 2000);
});

// ---- 入れなおし（backfill）

const seedLog = (lib, id, iso, action, userId, detail = action, source = "LINE") => {
  lib.sheet("logs", BOOK).rows.push([id, new Date(iso), action, 0, detail, source, userId]);
};

test("入れなおし：持ち主の記録だけを、その日の jsonl に入れる。日時は記録した日時", () => {
  const { lib, entry, files } = make();
  seedLog(lib, "L1", "2026-10-19T08:00:00+09:00", "workout", OWNER);
  seedLog(lib, "L2", "2026-10-19T21:00:00+09:00", "coding", OWNER, "coding", "ALFRED");
  seedLog(lib, "L3", "2026-10-20T07:00:00+09:00", "workout", OTHER);
  seedLog(lib, "L0", "2026-10-17T07:00:00+09:00", "workout", OWNER); // 範囲の前
  seedLog(lib, "L4", "2026-10-22T07:00:00+09:00", "trip", OWNER, "trip: CarPlay\nstart_lat: 35.1\nstart_lng: 139.1\nend_lat: 35.2\nend_lng: 139.2\ndistance: 1km");
  // 見るだけでは書かない
  assert.equal(entry.call("backfillGithubPreview", "2026-10-18"), true);
  assert.equal(Object.keys(files).length, 0);
  assert.ok(entry.logs.some((l) => /入れる予定 3件/.test(l)));
  // 入れる
  assert.equal(entry.call("backfillGithub", "2026-10-18"), true);
  assert.deepEqual(Object.keys(files).sort(), ["logs/2026-10-19.jsonl", "logs/2026-10-22.jsonl"]);
  const day19 = files["logs/2026-10-19.jsonl"].content.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(day19.map((l) => l.ID), ["L1", "L2"]);
  assert.equal(files["logs/2026-10-19.jsonl"].author.date, "2026-10-19T12:00:00.000Z");
  assert.equal(files["logs/2026-10-19.jsonl"].author.email, "123+katsuan@users.noreply.github.com");
  const all = Object.values(files).map((f) => f.content).join("");
  assert.doesNotMatch(all, new RegExp(`${OWNER}|${OTHER}|userId|_lat|_lng|35\\.1`));
  assert.match(all, /distance: 1km/);
});

test("入れなおし：同じ記録 ID は2回入れない（何度実行してもよい）", () => {
  const { lib, entry, files } = make();
  files["logs/2026-10-19.jsonl"] = { content: JSON.stringify({ ID: "L1", action: "workout" }) + "\n", sha: "s0" };
  seedLog(lib, "L1", "2026-10-19T08:00:00+09:00", "workout", OWNER);
  seedLog(lib, "L2", "2026-10-19T09:00:00+09:00", "coding", OWNER);
  entry.call("backfillGithub", "2026-10-18");
  entry.call("backfillGithub", "2026-10-18");
  const ids = files["logs/2026-10-19.jsonl"].content.trim().split("\n").map((l) => JSON.parse(l).ID);
  assert.deepEqual(ids, ["L1", "L2"]);
  assert.equal(lib.fetches.filter((f) => f.method === "put").length, 1);
});

test("入れなおし：user_id がなければ何もしない", () => {
  const { lib, entry, files } = make({ userId: "" });
  seedLog(lib, "L1", "2026-10-19T08:00:00+09:00", "workout", OWNER);
  assert.equal(entry.call("backfillGithub", "2026-10-18"), false);
  assert.equal(Object.keys(files).length, 0);
});

test("ふだんの記録と入れなおしが同じ日のファイルに足していく（前の行を消さない）", () => {
  const { lib, entry, files } = make();
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  entry.lineEvent(textEvent("# workout"), { key: KEY });
  const path = Object.keys(files)[0];
  assert.equal(files[path].content.trim().split("\n").length, 2);
  entry.call("backfillGithub", "2026-10-18"); // 今日の2件はもう入っている
  assert.equal(files[path].content.trim().split("\n").length, 2);
});

// ---- つづくの「LINE でも記録」（ボットのトークを送る文入りで開き、持ち主が1対1で送る）

test("つづくから送る文：絵文字・全角の＃・ことばの言いかえでも、行動が正しく決まり GitHub に入る", () => {
  const cases = [
    ["# workout", "workout"],
    ["＃workout", "workout"],
    ["# 💪workout", "workout"],
    ["# 💪 workout", "workout"],
    ["#筋トレ", "workout"],
    ["# coding", "coding"],
    ["# 🧑‍💻coding", "coding"],
    ["# 読書", "読書"],
  ];
  cases.forEach(([text, action]) => {
    const { lib, entry } = make();
    lib.seed("action_aliases", [["action", "alias", "enabled"], ["workout", "workout", true], ["workout", "筋トレ", true], ["workout", "💪", true], ["coding", "coding", true]], BOOK);
    entry.lineEvent(textEvent(text), { key: KEY });
    assert.equal(logRows(lib)[0][2], action, text);
    assert.equal(githubPuts(lib).length, 1, text);
    assert.deepEqual(entry.flexProblems().filter((p) => p.level === "error"), [], text);
  });
});
