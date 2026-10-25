// 記録のカードの［+15分］（postback）：押されるたびに、いまの記録を見て返す（ux.md の H2）
import test from "node:test";
import assert from "node:assert";
import { OWNER, OTHER, KEY, BOOK, make, textEvent, logRows, messageText } from "./log-helpers.mjs";

const chips = (m) => {
  const out = [];
  const walk = (o) => { if (o && typeof o === "object") { if (o.action && o.action.type === "postback") out.push(o.action.data); Object.values(o).forEach(walk); } };
  walk(m.contents);
  return out;
};
const press = (entry, data, userId = OWNER) => {
  entry.lineEvent({ type: "postback", replyToken: "r-" + Math.random(), source: { type: "user", userId }, postback: { data } }, { key: KEY });
  return entry.lastMessages()[0];
};
const minutes = (lib) => Number(logRows(lib)[0][3]);

test("記録のカードに［+15分］［+30分］［+60分］（記録 ID と、カードを出したときの分つき）。クイックリプライにも同じもの", () => {
  const { lib, entry } = make();
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  const m = entry.lastMessages()[0];
  const id = logRows(lib)[0][0];
  assert.deepEqual(chips(m), [15, 30, 60].map((d) => `m=log&action=adjust_minutes&delta=${d}&logId=${id}&base=0`));
  assert.deepEqual(m.quickReply.items.slice(0, 3).map((i) => i.action.data), chips(m));
  assert.deepEqual(entry.flexProblems([m]).filter((p) => p.level === "error"), []);
});

test("押すと足す。同じボタンを2回押しても、二重に足さない（もう足してあると返す）", () => {
  const { lib, entry } = make();
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  const data = chips(entry.lastMessages()[0])[0];
  let m = press(entry, data);
  assert.equal(minutes(lib), 15);
  assert.match(m.contents.header.contents[0].text, /時間を足しました（0分 → 15分）/);
  // 新しいカードのボタンは、いまの分（15）からの足し算
  assert.ok(chips(m)[0].endsWith("&base=15"));
  // 前のカードのボタンをもう一度
  m = press(entry, data);
  assert.equal(minutes(lib), 15);
  assert.equal(m.type, "text");
  assert.match(m.text, /もう足してあります（いまは 15分）/);
  assert.ok(m.quickReply.items[0].action.data.endsWith("&base=15"));
  // 新しいカードのボタンなら、さらに足せる
  press(entry, chips(entry.replies().filter((r) => r.messages[0].type === "flex").pop().messages[0])[1]);
  assert.equal(minutes(lib), 45);
});

test("何日もあと（7日より前の記録）に押したら、変えずにやさしく断る", () => {
  const { lib, entry } = make();
  lib.sheet("logs", BOOK).rows.push(["L-OLD", new Date(Date.now() - 10 * 86400e3), "coding", 0, "coding", "LINE", OWNER]);
  const m = press(entry, "m=log&action=adjust_minutes&delta=15&logId=L-OLD&base=0");
  assert.equal(m.type, "text");
  assert.match(m.text, /日がたったので、ここからは時間を変えられません/);
  assert.equal(Number(logRows(lib).find((r) => r[0] === "L-OLD")[3]), 0);
});

test("ほかの人が押しても、変えない（自分のきょうの記録にも足さない）", () => {
  const { lib, entry } = make();
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  const data = chips(entry.lastMessages()[0])[0];
  entry.lineEvent(textEvent("# workout", OTHER), { key: KEY });
  const m = press(entry, data, OTHER);
  assert.match(m.text, /ほかの人の記録なので/);
  assert.deepEqual(logRows(lib).map((r) => Number(r[3])), [0, 0]);
});

test("ない記録・形のちがう data は、黙らずに返す", () => {
  const { entry } = make();
  assert.match(press(entry, "m=log&action=adjust_minutes&delta=15&logId=L-NONE&base=0").text, /見つかりませんでした/);
  assert.match(press(entry, "m=log&action=adjust_minutes&delta=999&logId=L-NONE").text, /足す時間が読めませんでした/);
});

test("GitHub につないでいれば、足したあとの分で同じ行を書きかえる（2回押しても行はふえない）", () => {
  const { entry, files } = make();
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  const data = chips(entry.lastMessages()[0])[0];
  press(entry, data);
  press(entry, data);
  const path = Object.keys(files)[0];
  const lines = files[path].content.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].minutes, 15);
});

test("#テスト の記録の見本にも［+15分］。押しても本物の記録は変わらない", () => {
  const { lib, entry } = make();
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  // くらぶボットの #テスト →「🧪 📝 記録の見本」→「📝 記録しました」
  entry.lineEvent({ type: "postback", replyToken: "r-t", source: { type: "user", userId: OWNER }, postback: { data: "m=core&a=test&t=log.log" } }, { key: KEY });
  const sample = entry.lastMessages()[0];
  const data = chips(sample)[0];
  assert.match(data, /logId=L-SAMPLE/);
  assert.match(press(entry, data).text, /見つかりませんでした/);
  assert.equal(minutes(lib), 0);
  assert.match(messageText(sample), /⏱ 時間を足す/);
});
