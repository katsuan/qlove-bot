/**
 * 55_tournament.gs：機能「🏆 大会」（くみあわせ 〜QumiAwase〜 の大会の結果を、運営・入力の人・見る人の端末で同じにする）
 *
 * くみあわせの画面が、このボットの URL に { app: "qlove", v: 1, tool: "qumiawase", action, … } を送る。
 * LINE ログインのいらない呼び出し（publicTool）。ほかの機能とちがい、本人を LINE に確かめず、合言葉で決める（2026-10-28 決めたこと）：
 *   システム管理者（このシートをコピーした人）… スクリプト プロパティ TOURNAMENT_ADMIN_KEY に「運営の合言葉」を書く。書かなければ、大会は作れない
 *   ツール管理者（運営）… 運営の合言葉で、大会を作る・組み合わせや設定を書きかえる・点を入れる
 *   ユーザー（入力の人）… 大会ごとの「入力の合言葉」（運営が決める）で、点と審判だけ入れる
 *   ユーザー（見る人）… 大会の番号（推測できない20けた）を知っていれば、読むだけ
 * 合言葉は URL にも端末にも残さない（docs/security.md の W7。画面は、そのタブの sessionStorage にだけ key を置く）。生の合言葉は送らない：
 *   入力の合言葉 … 画面が端末の中で PBKDF2（SHA-256・塩は大会の番号・10万回。ジェンダーリビールと同じ考え）にかけた key を送る。ここでは、さらに SHA-256 にして残す
 *   運営の合言葉 … もともとスクリプト プロパティにあるので、画面は SHA-256("qumiawase:admin:" + 合言葉) を送る（GAS で PBKDF2 は重い）
 * まちがいは、大会ごとに10分で10回まで（まちがいの数は、作るときは「作る」ぶんでまとめて数える）。
 *
 * シート「大会」：1行に1つの大会。data は大会の中身の JSON（チーム・形・時間・結果・審判。くみあわせの store.js の形）。
 *   点を入れるときは、その試合の結果だけを書きかえ、版（version）を1つ上げる。画面は版で「変わったか」を見る（get の since）
 * 呼ばれるところ：03_tool_api.gs の handleToolCall_（publicTool）
 */

const TOURNAMENT_ = {
  adminKeyProp: 'TOURNAMENT_ADMIN_KEY',
  maxData: 45000, // シートの1つのマスは5万字まで
  maxTournaments: 50, // このボットに置ける大会の数（こえたら、いちばん古いものから消してもらう）
  triesMax: 10,
  triesSeconds: 600
};
const QUMIAWASE_URL_ = 'https://katsuan.github.io/qumiawase/';
// 画面から届く key（PBKDF2 の結果を16進数にしたもの）・大会の番号・試合の id・チームの id の形
const TOURNAMENT_KEY_PATTERN_ = /^[0-9a-f]{64}$/;
const TOURNAMENT_ID_PATTERN_ = /^[0-9a-f]{20}$/;
const TOURNAMENT_MATCH_PATTERN_ = /^[A-Za-z0-9-]{1,16}$/;
const TOURNAMENT_TEAM_PATTERN_ = /^[A-Za-z0-9_-]{1,24}$/;


// ---- 登録（中身はぜんぶのファイルを読み終わってから組み立てる。02_config.gs の registerModule_） ----

registerModule_(() => ({
  key: 'tournament',
  emoji: '🏆',
  name: '大会',
  desc: 'くみあわせの大会の結果を、運営・入力の人・見る人の端末で同じにします（合言葉で入れる）',
  sender: { name: 'くみあわせ〜QumiAwase〜', iconUrl: `${QUMIAWASE_URL_}apple-touch-icon.png` },
  toolUrls: [QUMIAWASE_URL_],
  toolKeys: ['qumiawase'],
  order: 70,
  sheets: {
    tournaments: { name: '大会', headers: ['id', 'title', 'version', 'inputHash', 'data', 'createdAt', 'updatedAt'] }
  },
  // LINE ログインのいらない呼び出し（合言葉で決める）。03_tool_api.gs が、ID トークンを確かめる前にここへ渡す
  publicTool: {
    create: tournamentCreate_,
    get: tournamentGet_,
    check: tournamentCheck_,
    score: tournamentScore_,
    put: tournamentPut_
  },
  checks: () => [
    propText_(TOURNAMENT_.adminKeyProp)
      ? { level: '✅', text: `運営の合言葉あり・大会 ${tournamentRows_().length} 件（${TOURNAMENT_.maxTournaments} 件まで）` }
      : { level: '⚠️', text: `運営の合言葉がない（スクリプト プロパティ ${TOURNAMENT_.adminKeyProp} に書くと、くみあわせで大会を共有できる）` }
  ]
}));


// ---- 合言葉 ----

/** 画面から届いた key（PBKDF2 の結果）を、残す形（SHA-256）にする。形がちがえば "" */
function tournamentKeyHash_(key) {
  const text = String(key || '').toLowerCase();
  return TOURNAMENT_KEY_PATTERN_.test(text) ? sha256Hex_(`qumiawase:${text}`) : '';
}

/** 運営の合言葉の key として合っているか（いまのスクリプト プロパティとくらべる。変えれば、前の合言葉ではもう入れない） */
function tournamentIsAdmin_(key) {
  const want = tournamentAdminHash_();
  const got = tournamentKeyHash_(key);
  return Boolean(want && got && want === got);
}

/**
 * 運営の合言葉（スクリプト プロパティ）を、画面と同じ形（SHA-256("qumiawase:admin:" + 合言葉) の16進数）にして、残す形にしたもの。なければ ""。
 * 運営の合言葉はもともとスクリプト プロパティにある（システム管理者が持つ）ので、PBKDF2 にはかけない（GAS では重い）
 */
function tournamentAdminHash_() {
  const pass = propText_(TOURNAMENT_.adminKeyProp);
  return pass ? tournamentKeyHash_(sha256Hex_(`qumiawase:admin:${pass}`)) : '';
}

/** まちがいの数（大会ごと。10分）。上限なら true */
function tournamentTooMany_(scope) {
  return Number(cache_().get(`TRN_TRY_${scope}`) || 0) >= TOURNAMENT_.triesMax;
}

/** まちがいを1つ数える */
function tournamentMiss_(scope) {
  const key = `TRN_TRY_${scope}`;
  cache_().put(key, String(Number(cache_().get(key) || 0) + 1), TOURNAMENT_.triesSeconds);
}


// ---- シート ----

/** 大会の行（読むだけ） */
function tournamentRows_() {
  return readRows_('tournaments');
}

/** 大会の中身（JSON）を読む。読めなければ null */
function tournamentData_(text) {
  try {
    const data = JSON.parse(String(text || ''));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch (error) {
    return null;
  }
}

/** 画面から届いた大会の中身を、残せる形の JSON 文字にする。大きすぎる・形がちがえば "" */
function tournamentDataText_(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.teams)) return '';
  const text = JSON.stringify(data);
  return text.length <= TOURNAMENT_.maxData ? text : '';
}

/**
 * id の大会の行を、ロックの中で読んで書きかえる。fn(row, data) は、書きかえる { version, data, inputHash?, title? } か、
 * 返事（{ ok: false, … }）を返す。書きかえたら { ok: true, version } を返す
 */
function tournamentUpdate_(id, fn) {
  return withLock_(() => {
    const sheet = sheet_('tournaments');
    const values = sheet.getDataRange().getValues();
    const headers = (values[0] || []).map((h) => String(h).trim());
    const col = (name) => headers.indexOf(name);
    for (let i = 1; i < values.length; i += 1) {
      if (String(values[i][col('id')]).trim() !== id) continue;
      const row = {};
      headers.forEach((h, j) => {
        row[h] = values[i][j];
      });
      const data = tournamentData_(row.data);
      if (!data) return { ok: false, error: 'fail' };
      const out = fn(row, data);
      if (!out || out.ok === false) return out || { ok: false, error: 'bad' };
      const next = Object.assign({}, row, out, { updatedAt: new Date() });
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([headers.map((h) => safeCell_(next[h] === undefined ? '' : next[h]))]);
      delete memo_.tournaments;
      return { ok: true, version: Number(next.version) };
    }
    return { ok: false, error: 'none' };
  });
}


// ---- 呼び出し（publicTool） ----

/**
 * 大会を作る（運営）：{ adminKey, inputKey, data } → { ok, id, version }。
 * inputKey は、まだ大会の番号がないので、画面が「作ってから」もう一度 put で決める…のは手間なので、
 * 画面が先に番号を作る：{ id（20けたの16進数）, inputKey（その番号を混ぜた PBKDF2） } を送る。同じ番号がもうあれば断る
 */
function tournamentCreate_(body) {
  if (!propText_(TOURNAMENT_.adminKeyProp)) return { ok: false, error: 'off' };
  if (tournamentTooMany_('create')) return { ok: false, error: 'many' };
  if (!tournamentIsAdmin_(body.adminKey)) {
    tournamentMiss_('create');
    return { ok: false, error: 'pass' };
  }
  const id = String(body.id || '');
  const inputHash = tournamentKeyHash_(body.inputKey);
  const text = tournamentDataText_(body.data);
  if (!TOURNAMENT_ID_PATTERN_.test(id) || !inputHash || !text) return { ok: false, error: 'bad' };
  return withLock_(() => {
    const sheet = sheet_('tournaments');
    const rows = sheet.getDataRange().getValues();
    if (rows.slice(1).some((r) => String(r[0]).trim() === id)) return { ok: false, error: 'bad' };
    if (rows.length - 1 >= TOURNAMENT_.maxTournaments) return { ok: false, error: 'full' };
    const now = new Date();
    const row = { id: id, title: cleanText_(body.data.name, 30), version: 1, inputHash: inputHash, data: text, createdAt: now, updatedAt: now };
    sheet.appendRow(SHEETS_.tournaments.headers.map((h) => safeCell_(row[h])));
    delete memo_.tournaments;
    return { ok: true, id: id, version: 1 };
  });
}

/** 大会を読む（だれでも。番号を知っていれば）：{ id, since? } → { ok, version, data } か、変わっていなければ { ok, version, same: true } */
function tournamentGet_(body) {
  const id = String(body.id || '');
  if (!TOURNAMENT_ID_PATTERN_.test(id)) return { ok: false, error: 'bad' };
  const row = tournamentRows_().find((r) => String(r.id).trim() === id);
  if (!row) return { ok: false, error: 'none' };
  const version = Number(row.version) || 0;
  if (Number(body.since) === version) return { ok: true, version: version, same: true };
  const data = tournamentData_(row.data);
  return data ? { ok: true, version: version, data: data } : { ok: false, error: 'fail' };
}

/** その大会での役割を決める：運営の合言葉なら 'admin'、入力の合言葉なら 'input'、ちがえば ''（まちがいを数える） */
function tournamentRoleOf_(row, key) {
  const hash = tournamentKeyHash_(key);
  if (hash && tournamentIsAdmin_(key)) return 'admin';
  if (hash && hash === String(row.inputHash)) return 'input';
  return '';
}

/** 合言葉を確かめる（入れたとき）：{ id, key } → { ok, role: 'admin' | 'input' } */
function tournamentCheck_(body) {
  const id = String(body.id || '');
  if (!TOURNAMENT_ID_PATTERN_.test(id)) return { ok: false, error: 'bad' };
  if (tournamentTooMany_(id)) return { ok: false, error: 'many' };
  const row = tournamentRows_().find((r) => String(r.id).trim() === id);
  if (!row) return { ok: false, error: 'none' };
  const role = tournamentRoleOf_(row, body.key);
  if (!role) {
    tournamentMiss_(id);
    return { ok: false, error: 'pass' };
  }
  return { ok: true, role: role };
}

/** 結果の形を確かめる（{ s: [0〜99, 0〜99], pk?: [0〜99, 0〜99] }）。だめなら null */
function tournamentResultOf_(r) {
  const n = (v) => Number.isInteger(v) && v >= 0 && v <= 99;
  if (!r || !Array.isArray(r.s) || r.s.length !== 2 || !r.s.every(n)) return null;
  const out = { s: [r.s[0], r.s[1]] };
  if (Array.isArray(r.pk) && r.pk.length === 2 && r.pk.every(n) && r.s[0] === r.s[1]) out.pk = [r.pk[0], r.pk[1]];
  return out;
}

/**
 * 点・審判を入れる（運営か入力の人）：{ id, key, mid, result?（{ s, pk? } か null で消す）, ref?（チームの id か "" で消す） } → { ok, version }。
 * その試合のところだけを書きかえる（ほかの人が同じときに入れたほかの試合は消えない）
 */
function tournamentScore_(body) {
  const id = String(body.id || '');
  const mid = String(body.mid || '');
  if (!TOURNAMENT_ID_PATTERN_.test(id) || !TOURNAMENT_MATCH_PATTERN_.test(mid)) return { ok: false, error: 'bad' };
  if (tournamentTooMany_(id)) return { ok: false, error: 'many' };
  const hasResult = Object.prototype.hasOwnProperty.call(body, 'result');
  const hasRef = Object.prototype.hasOwnProperty.call(body, 'ref');
  const result = hasResult && body.result !== null ? tournamentResultOf_(body.result) : null;
  if ((!hasResult && !hasRef) || (hasResult && body.result !== null && !result)) return { ok: false, error: 'bad' };
  const ref = hasRef ? String(body.ref || '') : '';
  if (ref && !TOURNAMENT_TEAM_PATTERN_.test(ref)) return { ok: false, error: 'bad' };
  return tournamentUpdate_(id, (row, data) => {
    if (!tournamentRoleOf_(row, body.key)) {
      tournamentMiss_(id);
      return { ok: false, error: 'pass' };
    }
    if (hasResult) {
      data.results = data.results && typeof data.results === 'object' ? data.results : {};
      if (result) data.results[mid] = result;
      else delete data.results[mid];
    }
    if (hasRef) {
      data.referees = data.referees && typeof data.referees === 'object' ? data.referees : {};
      if (ref && (data.teams || []).some((t) => t && t.id === ref)) data.referees[mid] = ref;
      else delete data.referees[mid];
    }
    const text = tournamentDataText_(data);
    if (!text) return { ok: false, error: 'bad' };
    return { version: (Number(row.version) || 0) + 1, data: text };
  });
}

/**
 * 大会をまるごと書きかえる（運営だけ。チーム・形・時間を変えたとき）：{ id, key, base（画面が知っている版）, data, inputKey?（入力の合言葉を変えるとき） } → { ok, version }。
 * 画面が知っている版より新しくなっていたら（ほかの人が点を入れた）書かずに { ok: false, error: 'stale', version } を返す。画面は読みなおしてから、もう一度
 */
function tournamentPut_(body) {
  const id = String(body.id || '');
  if (!TOURNAMENT_ID_PATTERN_.test(id)) return { ok: false, error: 'bad' };
  if (tournamentTooMany_(id)) return { ok: false, error: 'many' };
  const text = tournamentDataText_(body.data);
  const inputHash = body.inputKey === undefined ? '' : tournamentKeyHash_(body.inputKey);
  if (!text || (body.inputKey !== undefined && !inputHash)) return { ok: false, error: 'bad' };
  return tournamentUpdate_(id, (row) => {
    if (tournamentRoleOf_(row, body.key) !== 'admin') {
      tournamentMiss_(id);
      return { ok: false, error: 'pass' };
    }
    const version = Number(row.version) || 0;
    if (Number(body.base) !== version) return { ok: false, error: 'stale', version: version };
    const out = { version: version + 1, data: text, title: cleanText_(body.data.name, 30) };
    if (inputHash) out.inputHash = inputHash;
    return out;
  });
}
