// 🏆 大会（55_tournament.gs）：くみあわせの大会を、合言葉で作る・読む・点を入れる・まるごと書きかえる
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeBot, toolCall } from "./helpers.mjs";

const ADMIN = "うんえい-2026";
const INPUT = "こーと1";
const ID = "0123456789abcdef0123";
// 画面と同じ作り方：運営は SHA-256("qumiawase:admin:" + 合言葉)、入力は PBKDF2（塩は大会の番号・10万回）
const adminKey = (pass) => crypto.createHash("sha256").update(`qumiawase:admin:${pass}`).digest("hex");
const inputKey = (id, pass) => crypto.pbkdf2Sync(pass, `qumiawase:${id}`, 100000, 32, "sha256").toString("hex");
const call = (gas, action, body) => toolCall(gas, { tool: "qumiawase", action, ...body });
const DATA = { name: "秋のリーグ", teams: [{ id: "t1", name: "青" }, { id: "t2", name: "赤" }], format: "league", results: {}, referees: {} };

function made() {
  const gas = makeBot({ properties: { TOURNAMENT_ADMIN_KEY: ADMIN } });
  const res = call(gas, "create", { id: ID, adminKey: adminKey(ADMIN), inputKey: inputKey(ID, INPUT), data: DATA });
  assert.deepEqual(res, { ok: true, id: ID, version: 1 });
  return gas;
}

test("運営の合言葉がないボットでは作れない・ちがう合言葉は断る", () => {
  const off = makeBot();
  assert.equal(call(off, "create", { id: ID, adminKey: adminKey(ADMIN), inputKey: inputKey(ID, INPUT), data: DATA }).error, "off");
  const gas = makeBot({ properties: { TOURNAMENT_ADMIN_KEY: ADMIN } });
  assert.equal(call(gas, "create", { id: ID, adminKey: adminKey("ちがう"), inputKey: inputKey(ID, INPUT), data: DATA }).error, "pass");
  assert.equal(gas.rows("大会").length, 1); // 見出しだけ
});

test("作った大会は、番号でだれでも読める（合言葉の中身は返さない）。版が同じなら same", () => {
  const gas = made();
  const res = call(gas, "get", { id: ID });
  assert.equal(res.ok, true);
  assert.equal(res.version, 1);
  assert.equal(res.data.name, "秋のリーグ");
  assert.equal(JSON.stringify(res).includes("inputHash"), false);
  assert.deepEqual(call(gas, "get", { id: ID, since: 1 }), { ok: true, version: 1, same: true });
  assert.equal(call(gas, "get", { id: "ffffffffffffffffffff" }).error, "none");
  assert.equal(call(gas, "get", { id: "../x" }).error, "bad");
  // シートに生の合言葉も、画面の key も残らない
  const sheet = JSON.stringify(gas.rows("大会"));
  assert.equal(sheet.includes(INPUT) || sheet.includes(inputKey(ID, INPUT)) || sheet.includes(ADMIN), false);
});

test("合言葉の確かめ：運営は admin、入力は input、ちがえば pass。10回まちがえると止まる", () => {
  const gas = made();
  assert.deepEqual(call(gas, "check", { id: ID, key: adminKey(ADMIN) }), { ok: true, role: "admin" });
  assert.deepEqual(call(gas, "check", { id: ID, key: inputKey(ID, INPUT) }), { ok: true, role: "input" });
  for (let i = 0; i < 10; i++) assert.equal(call(gas, "check", { id: ID, key: inputKey(ID, `x${i}`) }).error, "pass");
  assert.equal(call(gas, "check", { id: ID, key: inputKey(ID, INPUT) }).error, "many");
});

test("点を入れる：その試合だけ書きかえて版を上げる。同点なら PK も。null で消す。審判も", () => {
  const gas = made();
  const key = inputKey(ID, INPUT);
  assert.deepEqual(call(gas, "score", { id: ID, key, mid: "L1-1", result: { s: [2, 1] } }), { ok: true, version: 2 });
  assert.deepEqual(call(gas, "score", { id: ID, key, mid: "L1-2", result: { s: [1, 1], pk: [4, 3] } }), { ok: true, version: 3 });
  assert.deepEqual(call(gas, "score", { id: ID, key, mid: "L1-3", result: { s: [2, 0], pk: [4, 3] } }), { ok: true, version: 4 });
  assert.equal(call(gas, "score", { id: ID, key, mid: "L1-1", ref: "t2" }).version, 5);
  let data = call(gas, "get", { id: ID }).data;
  assert.deepEqual(data.results, { "L1-1": { s: [2, 1] }, "L1-2": { s: [1, 1], pk: [4, 3] }, "L1-3": { s: [2, 0] } });
  assert.deepEqual(data.referees, { "L1-1": "t2" });
  call(gas, "score", { id: ID, key, mid: "L1-1", result: null, ref: "" });
  data = call(gas, "get", { id: ID }).data;
  assert.equal("L1-1" in data.results, false);
  assert.equal("L1-1" in data.referees, false);
  // 形のちがうもの・ちがう合言葉・ないチームの審判
  assert.equal(call(gas, "score", { id: ID, key, mid: "L1-1", result: { s: [100, 0] } }).error, "bad");
  assert.equal(call(gas, "score", { id: ID, key, mid: "<x>", result: { s: [1, 0] } }).error, "bad");
  assert.equal(call(gas, "score", { id: ID, key: inputKey(ID, "ちがう"), mid: "L1-1", result: { s: [1, 0] } }).error, "pass");
  call(gas, "score", { id: ID, key, mid: "L1-1", ref: "t9" });
  assert.equal("L1-1" in call(gas, "get", { id: ID }).data.referees, false);
});

test("まるごと書きかえ：運営だけ。知っている版が古ければ stale。入力の合言葉も変えられる", () => {
  const gas = made();
  const next = { ...DATA, name: "秋のリーグ（決勝）", teams: [...DATA.teams, { id: "t3", name: "緑" }] };
  assert.equal(call(gas, "put", { id: ID, key: inputKey(ID, INPUT), base: 1, data: next }).error, "pass");
  call(gas, "score", { id: ID, key: inputKey(ID, INPUT), mid: "L1-1", result: { s: [1, 0] } });
  assert.deepEqual(call(gas, "put", { id: ID, key: adminKey(ADMIN), base: 1, data: next }), { ok: false, error: "stale", version: 2 });
  assert.deepEqual(call(gas, "put", { id: ID, key: adminKey(ADMIN), base: 2, data: next, inputKey: inputKey(ID, "こーと2") }), { ok: true, version: 3 });
  assert.equal(call(gas, "get", { id: ID }).data.teams.length, 3);
  assert.equal(call(gas, "check", { id: ID, key: inputKey(ID, INPUT) }).error, "pass");
  assert.equal(call(gas, "check", { id: ID, key: inputKey(ID, "こーと2") }).role, "input");
});

test("名前が = ではじまっても、シートで式にならない。大きすぎる中身は断る", () => {
  const gas = makeBot({ properties: { TOURNAMENT_ADMIN_KEY: ADMIN } });
  call(gas, "create", { id: ID, adminKey: adminKey(ADMIN), inputKey: inputKey(ID, INPUT), data: { ...DATA, name: "=HYPERLINK(\"x\")" } });
  assert.deepEqual(gas.formulaCells(), []);
  const big = { ...DATA, name: "x".repeat(10), teams: DATA.teams, note: "y".repeat(50000) };
  assert.equal(call(gas, "create", { id: "1123456789abcdef0123", adminKey: adminKey(ADMIN), inputKey: inputKey(ID, INPUT), data: big }).error, "bad");
});

test("ping に大会（qumiawase）が出る。機能を切ると呼べない", () => {
  const gas = makeBot({ properties: { TOURNAMENT_ADMIN_KEY: ADMIN } });
  assert.ok(toolCall(gas, { tool: "core", action: "ping" }).modules.includes("qumiawase"));
  const off = makeBot({ properties: { TOURNAMENT_ADMIN_KEY: ADMIN }, modulesOff: ["tournament"] });
  assert.equal(call(off, "get", { id: ID }).error, "auth");
});
