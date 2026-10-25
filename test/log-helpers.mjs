// テストの道具（機能「📝 記録」）：前の LOgBOT のテスト（GAS_Github_v2-main/test/support.js）と同じ形で、くらぶボットを動かす
//   前は「入口の GAS」と「ライブラリ」の2つだったが、くらぶボットは1つ。make() は { lib, entry } の両方に同じものを返す
//   OWNER（持ち主）・OTHER（持ち主が許した人）。GitHub の偽物（files）・つづくの ID トークンの偽物（idTokens）
import { createRequire } from "node:module";
import { makeBot, response } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const LOG_MAP = require("./log-names.json");

export const OWNER = "Ua0000000000000000000000000000001";
export const OTHER = "Ub0000000000000000000000000000002";
export const KEY = "k".repeat(32); // くらぶボットの Webhook の合言葉（helpers.mjs と同じ）
export const BOOK = undefined; // 前のテストのシートの ID（くらぶボットはシートが1つなので、なし）
// つづくの LIFF のチャネル（くらぶボットが受けるもの。03_tool_api.gs の TOOL_CHANNELS_）
export const LIFF_CHANNEL = "2012187502";
// つづくの LIFF での持ち主の ID（トークの OWNER とはちがう番号。「🔗 ツールとつなぐ」で OWNER とひもづけてある）
export const LIFF_OWNER = "Uc0000000000000000000000000000003";
export { response };

// ID トークンの形（ヘッダー.中身.署名。くらぶボットは形も確かめる）。前のテストの文字のトークンを、この形にして送る
const jwt = (t) => `${Buffer.from(String(t)).toString("base64url")}.e30.c2ln`;

// GitHub の偽物：PUT したファイルを覚える（files[path] = { content, sha }）
function githubFake(files) {
  return (url, opt) => {
    const m = url.match(/api\.github\.com\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (m) {
      const p = m[1];
      if (String(opt.method || "get").toLowerCase() === "put") {
        const body = JSON.parse(opt.payload);
        if ((files[p] && files[p].sha) !== (body.sha || undefined)) return response(409, { message: "sha mismatch" });
        files[p] = { content: Buffer.from(body.content, "base64").toString("utf8"), sha: "sha" + Math.random(), author: body.author };
        return response(200, { content: {} });
      }
      if (!files[p]) return response(404, { message: "Not Found" });
      return response(200, { sha: files[p].sha, content: Buffer.from(files[p].content).toString("base64") });
    }
    if (/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(url)) return response(200, { full_name: "katsuan/github" });
    if (/api\.github\.com\/user$/.test(url)) return response(200, { id: 123, login: "katsuan", name: "katsu" });
    if (/api\.github\.com\/graphql/.test(url)) return response(200, { data: null });
    if (/api\.line\.me\/v2\/bot\/message\/quota$/.test(url)) return response(200, { type: "limited", value: 200 });
    if (/api\.line\.me\/v2\/bot\/message\/quota\/consumption$/.test(url)) return response(200, { totalUsage: 12 });
    if (/api\.line\.me\/v2\/bot\/profile\//.test(url)) {
      return url.endsWith(OWNER) || url.endsWith(OTHER) ? response(200, { displayName: "かつ" }) : response(404, {});
    }
    return null;
  };
}

/** 前のテストの名前（handleLineEvent など）を、くらぶボットの名前（logHandleLineEvent_）に */
export const logName = (name) => LOG_MAP[name] || name;

export function make({ userId = OWNER, alfred = "alfred-secret-0123456789", liffOwner = LIFF_OWNER, idTokens = {}, season = false } = {}) {
  const files = {};
  const github = githubFake(files);
  const fail = { push: false, reply: false, pushAll: false };
  const byJwt = Object.fromEntries(Object.entries(idTokens).map(([t, claims]) => [jwt(t), claims]));
  const props = { GITHUB_TOKEN: "ghp_test", GITHUB_OWNER: "katsuan", GITHUB_REPO: "github" };
  if (alfred) props.ALFRED_SECRET = alfred;
  // 前の LOgBOT の持ち主の ID（つづくの LIFF の ID）。付けかえる前の記録も、持ち主の記録として数える（60_log_users.gs の logOwnerOldIds_）
  if (liffOwner) props.LOG_OLD_OWNER_IDS = liffOwner;
  const gas = makeBot({
    properties: { ...props, OWNER_USER_ID: userId || "" },
    members: [[OTHER, "ほかの人", "allowed", "", ""]],
    verify: (payload) => {
      const claims = byJwt[payload && payload.id_token];
      if (!claims) return response(400, { error: "invalid_request", error_description: "Invalid IdToken." });
      if (String(claims.aud) !== String(payload.client_id)) return response(400, { error: "invalid_request", error_description: "Invalid IdToken Audience." });
      return response(200, claims);
    },
    fetch: (url, opt) => {
      // LINE がカードを断る（fail.push・fail.reply）：カードの入った送りだけ 400
      const flex = /"type":"flex"/.test(String((opt && opt.payload) || ""));
      if (fail.pushAll && /\/v2\/bot\/message\/push$/.test(url)) return response(429, { message: "You have reached your monthly limit." });
      if (fail.push && flex && /\/v2\/bot\/message\/push$/.test(url)) return response(400, { message: `A message (messages[0]) in the request body is invalid ${OWNER}` });
      if (fail.reply && flex && /\/v2\/bot\/message\/reply$/.test(url)) return response(400, { message: `A message (messages[0]) in the request body is invalid ${OWNER}` });
      return github(url, opt);
    }
  });
  gas.fail = fail;
  // 季節の絵文字は、ふだんのテストでは付けない（文がテストのたびに変わらないように）。season: true で本物
  if (!season) gas.ctx.QSeason.decorate = (text) => text;
  gas.seed("logs", [["ID", "date", "action", "minutes", "detail", "source", "userId"]]);
  gas.seed("log_users", [["userId", "displayName", "createdAt", "lastSeenAt", "status", "memo", "sourceType", "groupId", "roomId"]]);
  gas.seed("action_aliases", [["action", "alias", "enabled"], ["workout", "workout", true], ["coding", "coding", true]]);
  // つづくの持ち主（LIFF の ID）と、ボットの持ち主をつないでおく（「🔗 ツールとつなぐ」をすませた形）
  const link = [["subHash", "userId", "tool", "createdAt"]];
  if (liffOwner && userId) link.push([gas.call("sha256Hex_", `qlove:${liffOwner}`), userId, "つづく", ""]);
  gas.seed("つないだツール", link);
  gas.reset();

  const call = gas.call.bind(gas);
  const doPost = gas.doPost.bind(gas);
  const env = () => gas.eval("useEnv_(env_())"); // qcheck-ok: W2 テストの偽物の GAS の中で、決まった式を動かすだけ
  // 前のテストの名前で呼べるように（ライブラリの中の関数は、入口から渡されたもの env を先に）
  gas.call = (name, ...args) => {
    if (name === "remindIfNoRecord") {
      env();
      return call("logRunReminder_", new Date());
    }
    if (name === "sha256Hex_" || name === "useEnv_" || name === "env_" || /^bot/.test(name) || ["doPost", "doGet", "hourlyQloveBot", "setupBot", "checkBot", "adoptOwner", "setupRichMenu", "backfillGithub", "backfillGithubPreview", "moveOldLogRecords", "moveOldLogRecordsPreview"].includes(name)) return call(name, ...args);
    env();
    return call(logName(name), ...args);
  };
  gas.run = (expr) => {
    env();
    return gas.eval(expr); // qcheck-ok: W2 テストに書いた式を、偽物の GAS の中で動かすだけ
  };
  // つづくからの呼び出し：前の形 { app: "tuzuq", op } で書いたテストを、くらぶボットの形 { app: "qlove", tool: "tuzuq", action } にして送る
  gas.doPost = (body, ...more) => {
    if (body && body.app === "tuzuq") {
      const { app, op, v, idToken, ...rest } = body;
      return doPost({ app: "qlove", v: 1, tool: "tuzuq", action: op, liffId: `${LIFF_CHANNEL}-test`, idToken: typeof idToken === "string" ? jwt(idToken) : idToken, ...rest });
    }
    return doPost(body, ...more);
  };
  return { lib: gas, entry: gas, files, gas };
}

export const textEvent = (text, userId = OWNER, sourceType = "user") => ({
  type: "message",
  replyToken: "r-" + Math.random(),
  source: { type: sourceType, userId, ...(sourceType === "group" ? { groupId: "Cgroup" } : {}) },
  message: { type: "text", id: "m1", text }
});

export const githubPuts = (lib) => lib.fetches.filter((f) => f.method === "put" && /api\.github\.com/.test(f.url));
export const logRows = (lib) => lib.rows("logs").slice(1);
export const decodePut = (put) => Buffer.from(put.json.content, "base64").toString("utf8");

/** メッセージの文字（文ならそのまま。カードなら altText と中の文字を上から順に、1行ずつ） */
export function messageText(m) {
  if (!m) return "";
  if (m.type === "text") return m.text;
  const out = [m.altText];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "text" && typeof node.text === "string") out.push(node.text);
    for (const key of ["header", "hero", "body", "footer"]) walk(node[key]);
    (node.contents || []).forEach(walk);
  };
  walk(m.contents);
  return out.join("\n");
}
