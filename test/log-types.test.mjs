// 📝 記録の「3つの型」（time・place・value）：1日のまとめと○・つづくの数字・カードの行・おわり忘れ・日をまたぐ・前の記録
import test from "node:test";
import assert from "node:assert";
import { OWNER, KEY, LIFF_CHANNEL, LIFF_OWNER, make, textEvent, logRows } from "./log-helpers.mjs";

const nowSec = () => Math.floor(Date.now() / 1000);
const TOKENS = { "h.owner.s": { iss: "https://access.line.me", sub: LIFF_OWNER, aud: LIFF_CHANNEL, exp: nowSec() + 3600 } };
const jst = (dayOffset, hm) => new Date(`${new Date(Date.now() + 9 * 3600e3 + dayOffset * 864e5).toISOString().slice(0, 10)}T${hm}:00+09:00`);
const iso = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 19) + "+09:00";
const ymd = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const say = (entry, lines) => entry.lineEvent(textEvent(Array.isArray(lines) ? lines.join("\n") : lines), { key: KEY });
const cmd = (command, type, at, memo) => ["# COMMAND", `command: ${command}`, `type: ${type}`, `at: ${iso(at)}`].concat(memo ? [`memo: ${memo}`] : []);
const days = (entry, texts) => entry.doPost({ app: "tuzuq", v: 1, op: "days", idToken: "h.owner.s", texts });

test("型 value（充電）：はじめ・おわりの数字の差をまとめ、その日に20%以上で○。detail に kind・値の行。カードに「きょう」の行", () => {
  const { entry, lib } = make({ idTokens: TOKENS });
  say(entry, cmd("charge", "start", jst(0, "08:00"), "70%"));
  say(entry, cmd("charge", "end", jst(0, "08:30"), "80%"));
  const detail = logRows(lib).at(-1)[4];
  assert.match(detail, /kind: value/);
  assert.match(detail, /start_value: 70\nend_value: 80\nvalue_diff: 10\nunit: %/);
  assert.match(JSON.stringify(entry.lastMessages()[0].contents), /🎯 きょう \+10%／目標 \+20%"/);
  let res = days(entry, ["# charge"]);
  assert.deepEqual(res.days[0], [], "10% では○にならない");
  assert.equal(res.values[0][ymd(jst(0, "08:00"))], 10);
  assert.equal(res.units[0], "%");
  say(entry, cmd("charge", "start", jst(0, "12:00"), "60%"));
  say(entry, cmd("charge", "end", jst(0, "13:00"), "75%"));
  assert.match(JSON.stringify(entry.lastMessages()[0].contents), /🎯 きょう \+25%／目標 \+20% ✅/);
  res = days(entry, ["# charge"]);
  assert.deepEqual(res.days[0], [ymd(jst(0, "08:00"))], "合計25%で○");
});

test("型 time（出退勤）・型なし（coding）：前と同じく記録した日に○。型なしの習慣は values が空", () => {
  const { entry } = make({ idTokens: TOKENS });
  say(entry, ["# attendance", "type: start", `at: ${iso(jst(-1, "09:00"))}`]);
  say(entry, ["# attendance", "type: end", `at: ${iso(jst(-1, "18:00"))}`]);
  say(entry, "# coding");
  const res = days(entry, ["# attendance", "# coding"]);
  assert.deepEqual(res.days[0], [ymd(jst(-1, "09:00"))]);
  assert.equal(res.values[0][ymd(jst(-1, "09:00"))], 540);
  assert.equal(res.units[0], "分");
  assert.equal(res.days[1].length, 1);
  assert.deepEqual(res.values[1], {});
});

test("goal はシートで変えられる（30分以上で○）。日をまたいだ記録は、はじめの日に数える", () => {
  const { entry, lib } = make({ idTokens: TOKENS });
  say(entry, "# coding"); // シート log_actions を作る
  lib.sheet("log_actions").rows.push(["study", "勉強", "📖", true, true, true, true, "", "time", "sum", 30, "分"]);
  say(entry, ["# COMMAND", "command: study", "type: start", `at: ${iso(jst(-2, "23:50"))}`]);
  say(entry, ["# COMMAND", "command: study", "type: end", `at: ${iso(jst(-1, "00:10"))}`]);
  let res = days(entry, ["# study"]);
  assert.deepEqual(res.values[0], { [ymd(jst(-2, "23:50"))]: 20 }, "はじめの日に20分");
  assert.deepEqual(res.days[0], [], "30分にとどかない");
  say(entry, ["# COMMAND", "command: study", "type: start", `at: ${iso(jst(-2, "08:00"))}`]);
  say(entry, ["# COMMAND", "command: study", "type: end", `at: ${iso(jst(-2, "08:15"))}`]);
  res = days(entry, ["# study"]);
  assert.deepEqual(res.days[0], [ymd(jst(-2, "08:00"))], "合計35分で○");
});

test("おわり忘れ：はじめから12時間たったら、見張りが12時間でおわらせ、1回だけ知らせる。はじめは消える", () => {
  const { entry, lib } = make({ idTokens: TOKENS });
  say(entry, cmd("charge", "start", jst(-1, "08:00"), "40%"));
  say(entry, ["# attendance", "type: start", `at: ${iso(jst(-1, "08:00"))}`]);
  const keys = () => Object.keys(lib.properties).filter((k) => /:lastStart:/.test(k));
  assert.equal(keys().length, 2);
  entry.reset();
  entry.run(`logCloseForgottenSessions_(new Date(${jst(-1, "19:00").getTime()}))`);
  assert.equal(keys().length, 2, "11時間ではまだ");
  entry.run(`logCloseForgottenSessions_(new Date(${jst(-1, "21:00").getTime()}))`);
  assert.equal(keys().length, 0);
  const rows = logRows(lib).slice(-2);
  assert.deepEqual(rows.map((r) => r[3]), [720, 720], "時間は12時間で切る");
  const pushes = entry.replies().filter((r) => r.kind === "push");
  assert.equal(pushes.length, 2);
  assert.match(pushes[0].messages[0].text, /おわっていなかったので、はじめから12時間でおわりにしました/);
  entry.reset();
  entry.run(`logCloseForgottenSessions_(new Date(${jst(0, "10:00").getTime()}))`);
  assert.equal(entry.replies().length, 0, "2回は知らせない");
});

test("前の記録（kind: の行がない）も、行動と detail の行から型を決めて読む", () => {
  const { entry, lib } = make({ idTokens: TOKENS });
  const day = jst(-2, "10:00");
  lib.sheet("logs").rows.push(["L-old1", day, "charge", 60, "command: charge\nstart: x\nend: y\nduration: 1h\nmemo_start: 50%\nmemo_end: 80%\nmemo_diff: +30%", "LINE", OWNER]);
  lib.sheet("logs").rows.push(["L-old2", day, "trip", 30, "trip: CarPlay\nstart: x\nend: y\nduration: 30m\ndistance: 12.40km", "LINE", OWNER]);
  const res = days(entry, ["# charge", "# trip"]);
  assert.deepEqual(res.days[0], [ymd(day)]);
  assert.equal(res.values[0][ymd(day)], 30);
  assert.equal(res.values[1][ymd(day)], 12.4);
  assert.equal(res.units[1], "km");
});

test("前に作った log_actions（列が8つ）に、type・daily・goal・unit の列を足し、はじめの行にひな形を入れる（書いた値は変えない）", () => {
  const { entry, lib } = make({ idTokens: TOKENS });
  lib.seed("log_actions", [["action", "label", "icon", "github", "stats", "remind", "enabled", "note"], ["charge", "充電", "🔋", true, true, false, true, ""], ["mine", "自分の", "⭐", true, true, true, true, ""]]);
  say(entry, "# coding");
  const rows = lib.rows("log_actions");
  assert.deepEqual(rows[0].slice(8), ["type", "daily", "goal", "unit"]);
  assert.deepEqual(rows.find((r) => r[0] === "charge").slice(8), ["value", "sum", 20, "%"]);
  assert.ok(rows.find((r) => r[0] === "mine").slice(8).every((v) => v === "" || v === undefined || v === null), "自分で足した行は空のまま");
});

test("移動の場所：シートには 1km に丸めた位置と地名（start_place・end_place）。距離は丸める前の位置で出す。GitHub には位置も地名も書かない", () => {
  const { entry, lib, files } = make({ idTokens: TOKENS });
  const t = (type, at, lat, lng) => ["# trip", "source: carplay", `type: ${type}`, `at: ${iso(at)}`, `lat: ${lat}`, `lng: ${lng}`];
  say(entry, t("start", jst(0, "08:00"), 35.171234, 136.884567));
  say(entry, t("end", jst(0, "08:30"), 35.178901, 136.889012));
  const detail = logRows(lib).at(-1)[4];
  assert.match(detail, /start_lat: 35\.17\nstart_lng: 136\.88\nstart_place: 名古屋市中村区/);
  assert.match(detail, /end_lat: 35\.18\nend_lng: 136\.89\nend_place: 名古屋市中村区/);
  assert.doesNotMatch(detail, /35\.1712|136\.8845/, "細かい位置は残さない");
  assert.match(detail, /distance: 0\.9\dkm/, "距離は丸める前の位置から（丸めた位置だと 1.4km くらい）");
  const gh = Object.values(files).map((f) => f.content).join("");
  assert.doesNotMatch(gh, /_lat|_lng|_place|名古屋/);
});

test("移動の場所：地名を調べられないときは、丸めた位置だけで記録する", () => {
  const { entry, lib } = make({ idTokens: TOKENS });
  entry.ctx.UrlFetchApp.fetch = ((orig) => (url, opt) => (/gsi\.go\.jp|muni\.json/.test(url) ? { getResponseCode: () => 500, getContentText: () => "" } : orig(url, opt)))(entry.ctx.UrlFetchApp.fetch);
  say(entry, ["# trip", "source: carplay", "type: start", `at: ${iso(jst(0, "09:00"))}`, "lat: 35.171", "lng: 136.884"]);
  say(entry, ["# trip", "source: carplay", "type: end", `at: ${iso(jst(0, "09:20"))}`, "lat: 35.181", "lng: 136.894"]);
  const detail = logRows(lib).at(-1)[4];
  assert.match(detail, /start_lat: 35\.17/);
  assert.doesNotMatch(detail, /_place/);
});

test("前の移動の記録を丸める（roundOldTripPlacesPreview は数えるだけ・roundOldTripPlaces で書きかえる）", () => {
  const { entry, lib } = make({ idTokens: TOKENS });
  const old = "trip: CarPlay\nstart: x\nstart_lat: 35.171234\nstart_lng: 136.884567\nend: y\nend_lat: n/a\nend_lng: n/a\nduration: 10m\ndistance: n/a";
  lib.seed("logs", [["ID", "date", "action", "minutes", "detail", "source", "userId"], ["T1", jst(-3, "08:00"), "trip", 10, old, "LINE", OWNER], ["T2", jst(-3, "09:00"), "coding", 0, "coding", "LINE", OWNER]]);
  let r = entry.call("botLogRoundOldTrips", entry.call("env_"), true);
  assert.deepEqual([r.rows, r.changed, r.places], [1, 1, 1]);
  assert.equal(lib.rows("logs")[1][4], old, "数えるだけ");
  r = entry.call("botLogRoundOldTrips", entry.call("env_"), false);
  assert.deepEqual([r.rows, r.changed, r.places], [1, 1, 1]);
  assert.match(lib.rows("logs")[1][4], /start_lat: 35\.17\nstart_lng: 136\.88\nstart_place: 名古屋市中村区\nend: y\nend_lat: n\/a/);
  assert.equal(lib.rows("logs")[2][4], "coding", "移動でない行は変えない");
  r = entry.call("botLogRoundOldTrips", entry.call("env_"), false);
  assert.equal(r.changed, 0, "2回目は直すところがない");
});
