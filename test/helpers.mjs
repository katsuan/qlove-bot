// テストの道具：ライブラリ（lib/）と入口（entry/00_setup.gs・01_entry.gs）を、偽物の GAS（q-oqrn/tools/qtest/fake-gas.js）で動かす
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const { createGas, checkMessages, response } = require(path.join(os.homedir(), "GitHub/q-oqrn/tools/qtest/fake-gas.js"));
export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const KEY = "k".repeat(32);
export const OWNER = "U" + "a".repeat(32);
export const FRIEND = "U" + "b".repeat(32);
export const STRANGER = "U" + "c".repeat(32);
export const GROUP = "C" + "d".repeat(32);

// ライブラリのファイル（名前順。GAS と同じ）→ ライブラリの名前 QloveBot → 入口
function source() {
  const lib = fs.readdirSync(path.join(ROOT, "lib")).filter((f) => f.endsWith(".gs")).sort();
  return [
    ...lib.map((f) => `\n// ---- lib/${f}\n${fs.readFileSync(path.join(ROOT, "lib", f), "utf8")}`),
    "\n// ---- ライブラリの名前（GAS では入口の「ライブラリ」に QloveBot として足す）\nvar QloveBot = globalThis;\n",
    ...fs.readdirSync(path.join(ROOT, "entry")).filter((f) => f.endsWith(".gs")).sort().map((f) => `\n// ---- entry/${f}\n${fs.readFileSync(path.join(ROOT, "entry", f), "utf8")}`)
  ].join("\n");
}

// 日本の今日・明日（テストを動かした日）
export const jstDay = (offsetDays = 0) => new Date(Date.now() + 9 * 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10);
// その時間（日本時間）の Date
export const at = (hour, dayOffset = 0) => new Date(`${jstDay(dayOffset)}T${String(hour).padStart(2, "0")}:05:00+09:00`);

// Open-Meteo の返事の見本：前の日から3日ぶん
export function forecastJson({ pressure = () => 1013, pop = () => 10, max = [18, 18, 18] } = {}) {
  const days = [jstDay(-1), jstDay(0), jstDay(1)];
  const time = [];
  const p = [];
  const r = [];
  days.forEach((date, di) => {
    for (let h = 0; h < 24; h++) {
      time.push(`${date}T${String(h).padStart(2, "0")}:00`);
      p.push(pressure(di, h));
      r.push(pop(di, h));
    }
  });
  return { utc_offset_seconds: 32400, hourly: { time, pressure_msl: p, precipitation_probability: r, temperature_2m: time.map(() => 18) }, daily: { time: days, temperature_2m_max: max } };
}

export function makeBot({ properties = {}, forecast = forecastJson(), meteo, members = [], quota, verify, modulesOff = [], fetch: extraFetch } = {}) {
  const gas = createGas({
    source: source(),
    properties: { LINE_CHANNEL_ACCESS_TOKEN: "test-token", WEBHOOK_KEY: KEY, OWNER_USER_ID: OWNER, ...properties },
    fetch(url, opt, entry) {
      const extra = extraFetch && extraFetch(url, opt, entry);
      if (extra) return extra;
      if (url.startsWith("https://api.open-meteo.com/")) return meteo ? meteo(url) : response(200, forecast);
      if (url.startsWith("https://mreversegeocoder.gsi.go.jp/")) return response(200, { results: { muniCd: "23105", lv01Nm: "名駅" } });
      if (url.startsWith("https://katsuan.github.io/soraqru/data/muni.json")) return response(200, { 23105: "名古屋市中村区" });
      if (url.startsWith("https://katsuan.github.io/qlove-bot/assets/")) return response(200, "PNG");
      if (/\/oauth2\/v2\.1\/verify/.test(url)) return verify ? verify(opt.payload) : response(400, { error: "invalid" });
      if (/\/message\/quota\/consumption$/.test(url)) return response(200, { totalUsage: quota ? quota.used : 0 });
      if (/\/message\/quota$/.test(url)) return response(200, quota ? { type: "limited", value: quota.value } : { type: "none" });
      if (/\/v2\/bot\/profile\//.test(url)) return response(200, { displayName: url.includes(FRIEND) ? "ともだち" : "持ち主" });
      return undefined;
    }
  });
  gas.call("setupBot");
  if (members.length) gas.seed("使う人", [["userId", "displayName", "status", "createdAt", "updatedAt"], ...members]);
  for (const key of modulesOff) {
    const rows = gas.rows("機能");
    gas.seed("機能", rows.map((r, i) => (i && r[0] === key ? [r[0], r[1], false, r[3]] : r)));
  }
  gas.reset();
  return gas;
}

export const userSource = (userId) => ({ type: "user", userId });
export const groupSource = (userId) => ({ type: "group", groupId: GROUP, userId });
let seq = 0;
export const say = (gas, source, text) => gas.lineEvent({ type: "message", replyToken: `r${++seq}`, source, message: { type: "text", id: "m", text } }, { key: KEY });
export const press = (gas, source, data) => gas.lineEvent({ type: "postback", replyToken: `r${++seq}`, source, postback: { data } }, { key: KEY });
export const sendLocation = (gas, source, lat, lon, title = "") =>
  gas.lineEvent({ type: "message", replyToken: `r${++seq}`, source, message: { type: "location", id: "m", latitude: lat, longitude: lon, title, address: "" } }, { key: KEY });
export const lastReply = (gas) => gas.replies().filter((r) => r.kind === "reply").at(-1);
export const pushes = (gas) => gas.replies().filter((r) => r.kind === "push");
export const textsOf = (messages) => (messages || []).map((m) => (m.type === "text" ? m.text : m.altText)).join("\n");
export const quickLabels = (message) => (message.quickReply?.items || []).map((i) => i.action.label);
export const errorsOf = (messages) => checkMessages(messages).filter((p) => p.level === "error");

/** 地点を1つ足す */
export function addPlace(gas, source, lat = 35.171, lon = 136.884, title = "") {
  press(gas, source, "m=weather&a=add");
  sendLocation(gas, source, lat, lon, title);
  return lastReply(gas);
}

/** ツール（ページ）からの呼び出し */
export const toolCall = (gas, body) => gas.doPost({ app: "qlove", v: 1, ...body });
