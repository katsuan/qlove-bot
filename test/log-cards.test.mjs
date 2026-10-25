// 返事は「文かカードか」（ux.md の H10）・カードが断られたら文で送りなおす（H5）
import test from "node:test";
import assert from "node:assert";
import { OWNER, OTHER, KEY, make, textEvent, messageText } from "./log-helpers.mjs";

const last = (entry) => entry.lastMessages()[0];
const qrTexts = (m) => ((m.quickReply && m.quickReply.items) || []).map((i) => i.action.text || i.action.data || i.action.uri);

test("まちがい（はじめが見つからない）は、カードではなく直し方つきの文。「はじめる」を押せる", () => {
  const { entry } = make();
  entry.lineEvent(textEvent("# e charge"), { key: KEY });
  let m = last(entry);
  assert.equal(m.type, "text");
  assert.match(m.text, /^⚠️ 「充電」は、まだはじめていません。\n先に「はじめる」を送ってから/);
  assert.ok(qrTexts(m).includes("# s charge"));

  entry.lineEvent(textEvent("# attendance end"), { key: KEY });
  m = last(entry);
  assert.equal(m.type, "text");
  assert.ok(qrTexts(m).includes("# attendance start"));

  entry.lineEvent(textEvent(["# trip", "source: carplay", "type: end", "at: 2026-10-24T08:30:00+09:00"].join("\n")), { key: KEY });
  m = last(entry);
  assert.equal(m.type, "text");
  assert.match(m.text, /^⚠️ 「移動」は、まだはじめていません。/);
  assert.ok(m.quickReply.items.length <= 13);
});

test("はじめたとき・記録したときは、今までどおりカード", () => {
  const { entry } = make();
  entry.lineEvent(textEvent("# s charge 20%"), { key: KEY });
  assert.equal(last(entry).type, "flex");
  entry.lineEvent(textEvent("# e charge 80%"), { key: KEY });
  assert.equal(last(entry).type, "flex");
});

test("# 通知：いまの設定はカード。変えたときはひとことの文", () => {
  const { entry } = make();
  entry.lineEvent(textEvent("# 通知"), { key: KEY });
  let m = last(entry);
  assert.equal(m.type, "flex");
  assert.match(m.altText, /^🔔 知らせの設定：🔔 毎日 20:00/);
  assert.deepEqual(m.contents.footer.contents.map((b) => b.action.text), ["# 通知 ためす", "# 設定"]);
  assert.ok(qrTexts(m).includes("# 通知 off"));
  assert.deepEqual(entry.flexProblems([m]).filter((p) => p.level === "error"), []);
  entry.lineEvent(textEvent("# 通知 off"), { key: KEY });
  m = last(entry);
  assert.equal(m.type, "text");
  assert.match(m.text, /止めました/);
});

test("言葉を覚えなくても押せる：持ち主のクイックリプライに「ふりかえり」「設定」（ほかの人には設定を出さない）", () => {
  const { entry } = make();
  // 「📝 記録」（くらぶボットの言葉・メニュー）のクイックリプライ
  entry.lineEvent(textEvent("📝 記録"), { key: KEY });
  assert.ok(qrTexts(last(entry)).includes("# REPORT"));
  entry.lineEvent(textEvent("# s charge"), { key: KEY });
  entry.lineEvent(textEvent("# e charge"), { key: KEY });
  assert.ok(qrTexts(last(entry)).includes("# 設定"));
  entry.lineEvent(textEvent("# e charge", OTHER), { key: KEY });
  assert.ok(!qrTexts(last(entry)).includes("# 設定"));
  // 記録したときは、カードに「ふりかえり」があるので、クイックリプライには重ねない。7つまで
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  const m = last(entry);
  assert.ok(!qrTexts(m).includes("# REPORT"));
  assert.ok(m.quickReply.items.length <= 7);
});

test("カードが LINE に断られたら、文にして push で送りなおす（くらぶボットの reply_）。原因は「動作の記録」に（ID は残さない）", () => {
  const { entry } = make();
  entry.fail.reply = true;
  entry.lineEvent(textEvent("# coding"), { key: KEY });
  const pushed = entry.replies().filter((r) => r.kind === "push");
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].to, OWNER);
  assert.equal(pushed[0].messages[0].type, "text");
  assert.match(pushed[0].messages[0].text, /記録しました：coding/);
  const log = JSON.stringify(entry.rows("動作の記録"));
  assert.match(log, /reply:error/);
  assert.doesNotMatch(log, new RegExp(OWNER));
  // グループでは、グループに送りなおす
  entry.lineEvent({ ...textEvent("# coding", OWNER, "group") }, { key: KEY });
  assert.equal(entry.replies().filter((r) => r.kind === "push").pop().to, "Cgroup");
});

test("知らせ（push）のカードが断られたら、文だけにして送りなおす", () => {
  const { entry } = make();
  entry.fail.push = true;
  assert.equal(entry.call("pushMessages_", OWNER, [{ type: "flex", altText: "🔔 きょうのまとめ", contents: { type: "bubble", body: { type: "box", layout: "vertical", contents: [{ type: "text", text: "x" }] } } }]), true);
  const pushed = entry.replies().filter((r) => r.kind === "push");
  assert.equal(pushed.length, 2);
  assert.equal(pushed[1].messages[0].type, "text");
  assert.match(pushed[1].messages[0].text, /🔔 きょうのまとめ/);
});
