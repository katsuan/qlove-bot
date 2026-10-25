// LINE の返事の使い心地（Q の使い心地の決まり H2・H3・G）：やさしい日本語・1枚のカード・ボタン2つまで・クイックリプライはしぼる
//   node --test test/
import test from "node:test";
import assert from "node:assert";
import { OWNER, OTHER, KEY, BOOK, make, textEvent, logRows, githubPuts } from "./log-helpers.mjs";

const ENGLISH = /LOGGED|QUEST|STATS|Dashboard|Users|Daily|Weekly|REPORTですか|Battery|source: |n\/a|memo|記録分数|ドライブ情報/;
const tripEvent = (type, at) => textEvent(["# trip", "source: carplay", `type: ${type}`, `at: ${at}`, "lat: 35.1", "lng: 139.1"].join("\n"));
const texts = (m) => { const out = []; const walk = (o) => { if (o && typeof o === "object") { if (o.type === "text" && o.text) out.push(o.text); Object.values(o).forEach(walk); } }; walk(m.contents || m); return out; };

test("返事：英語・仕組みの言葉を出さない。カードは1枚、ボタンは2つまで、クイックリプライは7つまで", () => {
  const { entry } = make();
  const inputs = ["# coding", "+15", "# s charge 20%", "# e charge 80%", "# attendance start", "# attendance end", "# REPORT", "# quest", "こんにちは"];
  inputs.forEach((t) => entry.lineEvent(textEvent(t), { key: KEY }));
  entry.lineEvent(tripEvent("start", "2026-10-24T08:00:00+09:00"), { key: KEY });
  entry.lineEvent(tripEvent("end", "2026-10-24T08:30:00+09:00"), { key: KEY });
  const msgs = entry.replies().flatMap((r) => r.messages);
  assert.ok(msgs.length >= 11);
  msgs.forEach((m) => {
    const all = [m.altText || "", m.text || "", ...texts(m), ...((m.quickReply && m.quickReply.items) || []).map((i) => i.action.label)].join(" / ");
    assert.doesNotMatch(all, ENGLISH, all);
    if (m.type === "flex") {
      assert.notEqual(m.contents.type, "carousel", "1枚にまとめる");
      const buttons = JSON.stringify(m.contents.footer || {}).match(/"type":"button"/g) || [];
      assert.ok(buttons.length <= 2, `ボタン ${buttons.length}`);
    }
    if (m.quickReply) assert.ok(m.quickReply.items.length <= 7, `QR ${m.quickReply.items.length}`);
    // 横に2つ並ぶボタンは、名前が6字（絵文字は1字）までなら切れない
    const rows = [];
    const walk = (o) => { if (o && typeof o === "object") { if (o.layout === "horizontal" && Array.isArray(o.contents) && o.contents.filter((c) => c.type === "button").length === 2) rows.push(o); Object.values(o).forEach(walk); } };
    walk(m.contents || {});
    rows.forEach((r) => r.contents.forEach((b) => {
      const len = [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(b.action.label.replace(/\s/g, ""))].length;
      assert.ok(len <= 6, `2つ並びのボタンの名前が長い（切れる）：${b.action.label}`);
    }));
  });
  assert.deepEqual(entry.flexProblems().filter((p) => p.level === "error"), []);
});

test("出退勤：1行の「# attendance start」「# attendance end」で記録できる", () => {
  const { lib, entry } = make();
  entry.lineEvent(textEvent("# attendance start"), { key: KEY });
  assert.match(JSON.stringify(entry.lastMessages()), /出勤しました/);
  entry.lineEvent(textEvent("# attendance end"), { key: KEY });
  assert.match(JSON.stringify(entry.lastMessages()), /おつかれさまでした/);
  assert.equal(logRows(lib).pop()[2], "attendance");
});

test("出勤：持ち主の出勤は GitHub に1行送る（その日に草）。シートには書かない。つづきの出勤・ほかの人は送らない", () => {
  const { lib, entry, files } = make();
  entry.lineEvent(textEvent("# attendance start"), { key: KEY });
  assert.match(JSON.stringify(entry.lastMessages()), /GitHub にも記録しました/);
  assert.equal(githubPuts(lib).length, 1);
  const body = Object.values(files)[0].content;
  assert.match(body, /"action":"attendance"/);
  assert.match(body, /type: start/);
  assert.doesNotMatch(body, new RegExp(OWNER));
  assert.equal(logRows(lib).length, 0, "シートには書かない");

  // 退勤して、すぐまた出勤（つづき）：退勤の1行だけ増える
  entry.lineEvent(textEvent("# attendance end"), { key: KEY });
  assert.equal(githubPuts(lib).length, 2);
  entry.lineEvent(textEvent("# attendance start"), { key: KEY });
  assert.match(JSON.stringify(entry.lastMessages()), /出勤をつづけます/);
  assert.equal(githubPuts(lib).length, 2, "つづきの出勤は送らない");

  // ほかの人
  entry.lineEvent(textEvent("# attendance start", OTHER), { key: KEY });
  assert.equal(githubPuts(lib).length, 2);
  assert.doesNotMatch(JSON.stringify(entry.lastMessages()), /GitHub/);
});

test("移動：名前・アイコンがないときは「🚙 移動（CarPlay）」（n/a を出さない）。時間は「30分」", () => {
  const { entry } = make();
  entry.lineEvent(tripEvent("start", "2026-10-24T08:00:00+09:00"), { key: KEY });
  entry.lineEvent(tripEvent("end", "2026-10-24T08:30:00+09:00"), { key: KEY });
  const t = texts(entry.lastMessages()[0]).join(" / ");
  assert.match(t, /🚙 移動（CarPlay）/);
  assert.match(t, /30分/);
});

test("カードの数は本人の記録だけ（ほかの人の記録は数えない）", () => {
  const { lib, entry } = make();
  for (let i = 0; i < 5; i += 1) entry.lineEvent(textEvent("# coding", OTHER), { key: KEY });
  entry.lineEvent(textEvent("# workout"), { key: KEY });
  const t = texts(entry.lastMessages()[0]).join(" / ");
  assert.match(t, /1件 \/ きょう/);
  assert.equal(logRows(lib).length, 6);
});

test("草：つづいた日数で育ち、季節の飾りがつく", () => {
  const { lib } = make();
  const at = (md) => `new Date("2026-${md}T12:00:00+09:00")`;
  // qcheck-ok: W2 テストの偽物の GAS（fake-gas）の中で日付を決めて呼ぶだけ
  const g = (n, md) => lib.run(`logGrassMark_(${n}, ${at(md)})`);
  assert.equal(g(1, "06-10").icon, "🌱");
  assert.equal(g(5, "06-10").icon, "🌿");
  assert.equal(g(7, "06-10").icon, "🪴");
  assert.equal(g(20, "06-10").icon, "🌳");
  assert.equal(g(45, "06-10").icon, "🌳🌳");
  assert.equal(g(120, "06-10").icon, "🌲🌳🌲");
  assert.equal(g(120, "06-10").season, "");
  assert.equal(g(3, "07-07").icon, "🌱🎋");
  assert.equal(g(3, "10-31").season, "🎃");
  assert.equal(g(3, "12-24").season, "🎄");
  assert.equal(g(3, "01-01").season, "🎍");
  assert.match(g(20, "04-01").word, /木になりました\n（桜の草）/); // 季節の草の名前は次の行に（途中で切れないように）
});

test("# 通知 ためす：知らせの見本を返事で見る（push しない・送った印を付けない）", () => {
  const { entry } = make();
  entry.lineEvent(textEvent("# 通知 ためす"), { key: KEY });
  assert.match(JSON.stringify(entry.lastMessages()), /見本/);
  assert.equal(entry.lastMessages()[0].type, "flex", "届くものと同じカード");
  assert.equal(entry.fetches.filter((f) => /\/message\/push$/.test(f.url)).length, 0);
  assert.equal(entry.properties.LOG_REMIND_SENT, undefined);
});

test("記録のカードから、つづく（LINE の中）を開ける", () => {
  const { entry } = make();
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  const footer = JSON.stringify(entry.lastMessages()[0].contents.footer);
  assert.match(footer, /"uri":"https:\/\/liff\.line\.me\/2012187502-o87l8Esu"/);
  assert.match(footer, /"type":"image","url":"https:\/\/katsuan\.github\.io\/tuzuq\/apple-touch-icon\.png"/);
  assert.match(footer, /つづくへ/);
  assert.match(footer, /📊 ふりかえり/);
});

// ---- ふりかえり：1枚目は絵でわかるまとめ
const jstAt = (dayOffset, hm) => new Date(new Date(Date.now() + 9 * 3600e3 + dayOffset * 86400e3).toISOString().slice(0, 10) + `T${hm}:00+09:00`);
const iso = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 19) + "+09:00";
const seedTrip = (lib, dayOffset, from, to, km) => {
  const s = jstAt(dayOffset, from);
  const e = jstAt(dayOffset, to);
  lib.sheet("logs", BOOK).rows.push(["T" + Math.random(), e, "trip", Math.round((e - s) / 60000), `trip: CarPlay\nicon: 🚙\nsource: carplay\nstart: ${iso(s)}\nend: ${iso(e)}\nduration: ${Math.round((e - s) / 60000)}m\ndistance: ${km}km\navg: 30.0km/h`, "LINE", OWNER]);
};
const seedWork = (lib, dayOffset, from, to) => {
  const s = jstAt(dayOffset, from);
  const e = jstAt(dayOffset, to);
  lib.sheet("logs", BOOK).rows.push(["A" + Math.random(), e, "attendance", 0, `attendance\nstart: ${iso(s)}\nend: ${iso(e)}`, "LINE", OWNER]);
};

test("移動のふりかえり：1枚目に、日ごとの距離（棒）とはじめた時間帯。英語を出さない", () => {
  const { lib, entry } = make();
  seedTrip(lib, 0, "08:00", "08:30", 12.5);
  seedTrip(lib, -1, "08:10", "08:40", 10);
  seedTrip(lib, -1, "18:00", "18:50", 20);
  entry.lineEvent(textEvent("# REPORT trip"), { key: KEY });
  const m = entry.lastMessages()[0];
  const first = texts(m.contents.contents[0]).join(" / ");
  assert.match(first, /移動のふりかえり（この7日）/);
  assert.match(first, /3回・42\.5km/);
  assert.match(first, /日ごとの距離/);
  assert.match(first, /移動した時間（赤いほど長く移動）/);
  // ヒートマップ：きょうの行は24マス、8時台が色つき（08:00〜08:30）
  const heat = [];
  const walk = (o) => { if (o && typeof o === "object") { if (o.layout === "horizontal" && Array.isArray(o.contents) && o.contents.length === 24) heat.push(o.contents.map((c) => c.color)); Object.values(o).forEach(walk); } };
  walk(m.contents.contents[0]);
  assert.equal(heat.length, 7, "7日ぶん");
  const today = heat[6];
  assert.notEqual(today[8], "#eef1f6", "8時台は色つき");
  assert.equal(today[3], "#eef1f6", "3時台は移動なし");
  assert.ok(JSON.stringify(m).length < 30000, "カードの大きさ");
  assert.match(first, /きょう/);
  assert.equal(m.contents.contents.length, 3, "まとめ＋2日");
  assert.doesNotMatch(JSON.stringify(m), /TRIP REPORT|as of|件数:|距離合計|n\/a/);
  assert.deepEqual(entry.flexProblems().filter((p) => p.level === "error"), []);
});

test("出退勤のふりかえり：1枚目に、出勤・退勤した時刻。英語を出さない", () => {
  const { lib, entry } = make();
  seedWork(lib, 0, "08:00", "18:30");
  seedWork(lib, -1, "09:10", "19:00");
  entry.lineEvent(textEvent("# REPORT attendance"), { key: KEY });
  const m = entry.lastMessages()[0];
  const first = texts(m.contents.contents[0]).join(" / ");
  assert.match(first, /出退勤のふりかえり/);
  assert.match(first, /出勤した時刻/);
  assert.match(first, /退勤した時刻/);
  assert.doesNotMatch(JSON.stringify(m), /ATTENDANCE REPORT|開始日|日付・曜日/);
  assert.deepEqual(entry.flexProblems().filter((p) => p.level === "error"), []);
});

test("移動のふりかえり：7日ずっと移動があっても、LINE の上限（50KB）に収まる", () => {
  const { lib, entry } = make();
  for (let d = 0; d > -7; d -= 1) [["07:50", "08:40", 12.3], ["12:10", "12:30", 5], ["18:00", "19:15", 20]].forEach(([f, t, km]) => seedTrip(lib, d, f, t, km));
  entry.lineEvent(textEvent("# REPORT trip"), { key: KEY });
  const m = entry.lastMessages()[0];
  assert.ok(JSON.stringify(m.contents).length < 50000, `${JSON.stringify(m.contents).length} バイト`);
  assert.ok(m.contents.contents.length >= 4, "まとめ＋何日か");
  assert.deepEqual(entry.flexProblems().filter((p) => p.level === "error"), []);
});

test("移動のはじめ（いってらっしゃい）はカードにせず、短い1行", () => {
  const { entry } = make();
  entry.lineEvent(tripEvent("start", "2026-10-24T08:00:00+09:00"), { key: KEY });
  const m = entry.lastMessages()[0];
  assert.equal(m.type, "text");
  assert.match(m.text, /^🚙 いってらっしゃい/);
  assert.ok(m.text.length <= 30, m.text);
});

test("カードの数字の行：きょうの時間は「きょう」のとなり。4時間54分は数字と単位に分けて、折り返さない", () => {
  const { lib, entry } = make();
  assert.deepEqual(lib.call("minutesSpans_", 294), [["4"], ["時間", true], ["54"], ["分", true]]);
  assert.deepEqual(lib.call("minutesSpans_", 120), [["2"], ["時間", true]]);
  const line = JSON.stringify(lib.call("buildStatsLine_", [["きょうの時間", lib.call("minutesSpans_", 294)]]));
  assert.match(line, /"text":"4時間54分"/);
  assert.match(line, /\{"type":"span","text":"時間","size":"xxs"\}/);
  assert.doesNotMatch(line, /"wrap":true[^}]*4時間|4時間54分","size":"sm","weight":"bold","color":"#111a33","align":"center","wrap"/);
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  const s = JSON.stringify(entry.lastMessages()[0]);
  const labels = (s.match(/"text":"(きょう|きょうの時間|今週|つづいて)"/g) || []).map((x) => x.slice(8, -1));
  assert.deepEqual(labels, ["きょう", "きょうの時間", "今週", "つづいて"]);
});

test("カードの数字の行：スマホでも崩れないよう、値も名前も1行。数字は大きく単位は小さく、つづいた日数に草の絵文字は入れない", () => {
  const { lib, entry } = make();
  const line = lib.call("buildStatsLine_", [["きょう", "12件"], ["きょうの時間", lib.call("minutesSpans_", 294), 3], ["今週", "59件"], ["つづいて", "154日"], ["x", "きょうから"]]);
  const cols = line.contents;
  assert.equal(cols[1].flex, 3, "きょうの時間の欄は少し広く");
  assert.equal(cols[0].flex, 2);
  cols.forEach((c) => c.contents.forEach((t) => assert.notEqual(t.wrap, true, JSON.stringify(t))));
  assert.deepEqual(cols[0].contents[0].contents, [{ type: "span", text: "12", size: "md" }, { type: "span", text: "件", size: "xxs" }]);
  assert.equal(cols[4].contents[0].size, "xs", "数字のない言葉は小さく");
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  const s = JSON.stringify(entry.lastMessages()[0]);
  assert.doesNotMatch(s, /"text":"[🌱🌿🪴🌳🌲🎃]+\d+日"/u, "数字の欄に草の絵文字を入れない");
  assert.deepEqual(entry.flexProblems().filter((p) => p.level === "error"), []);
});

test("カードの文：今週の目標は1つずつ行を分ける。英語の名前（Battery など）は日本語で出す", () => {
  const { entry, lib } = make();
  lib.properties[`quests:user:${OWNER}`] = JSON.stringify([{ id: "w1", type: "weekly", action: "coding", targetPerWeek: 1, enabled: true }, { id: "w2", type: "weekly", action: "workout", targetPerWeek: 2, enabled: true }]);
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  const s = JSON.stringify(entry.lastMessages()[0].contents);
  assert.match(s, /📋 今週\\n・coding 1\/1 ✅\\n・workout 0\/2/);
  entry.lineEvent(textEvent(["# COMMAND", "command: battery", "icon: 🔋", "label: Battery", "type: start", "memo: 75%"].join("\n")), { key: KEY });
  entry.lineEvent(textEvent(["# COMMAND", "command: battery", "icon: 🔋", "label: Battery", "type: end", "memo: 85%"].join("\n")), { key: KEY });
  const end = JSON.stringify(entry.lastMessages());
  assert.match(end, /充電/);
  assert.doesNotMatch(end, /"text":"Battery"/);
});

test("記録の種類（シート log_actions）：はじめの行つきで作る。GitHub に送るか・数に入れるか・名前と絵文字を、行ごとに決められる", () => {
  const { entry, lib } = make();
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  const rows = lib.rows("log_actions");
  assert.deepEqual(rows[0], ["action", "label", "icon", "github", "stats", "remind", "enabled", "note"]);
  assert.ok(rows.some((r) => r[0] === "battery" && r[1] === "充電"));
  const puts = () => githubPuts(lib).length;
  const before = puts();
  // 読書は GitHub に送らない・数に入れない、と決める
  lib.sheet("log_actions").rows.push(["reading", "読書", "📚", false, false, true, true, ""]);
  entry.lineEvent(textEvent("# reading"), { key: KEY });
  assert.equal(puts(), before, "GitHub に送らない");
  const card = JSON.stringify(entry.lastMessages()[0].contents);
  assert.match(card, /📚 読書/);
  assert.doesNotMatch(card, /GitHub にも記録しました/);
  assert.match(card, /"text":"1件"/, "きょうの数は coding の1件だけ");
  assert.equal(logRows(lib).length, 2, "シートには記録する");
  // enabled を FALSE にすると、ふつうの記録にもどる
  lib.sheet("log_actions").rows.at(-1)[6] = false;
  entry.lineEvent(textEvent("# reading"), { key: KEY });
  assert.equal(puts(), before + 1);
});
