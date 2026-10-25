/**
 * くらぶボット（仮）：くらぶ（Qlove）のツール共通の LINE ボット。ライブラリ（中身）
 * 00_config.gs：決まった値・入口から渡されるもの（env）・機能（モジュール）の登録
 *
 * 作り
 *   配布用シート（入口：entry/entry.gs）→ このライブラリ（版つき）
 *   ライブラリの中で PropertiesService・CacheService・LockService・SpreadsheetApp を呼ぶと、ライブラリ自身のものになる。
 *   なので、入口が自分のものを env にまとめて渡す（下の useEnv_）。ライブラリはそれだけを使う
 *
 * 役割（3つに分ける）
 *   システム管理者 … 配布用シートをコピーした人。GAS エディタで入口の関数を動かす・鍵を入れる
 *   ツール管理者   … 持ち主（OWNER_USER_ID）。LINE で「🔑 持ち主の登録」→ システム管理者が adoptOwner を実行して決める
 *   ユーザー       … 持ち主が許した人（シート「使う人」）
 *
 * スクリプト プロパティ（入口の。配布用シートでは空）
 *   LINE_CHANNEL_ACCESS_TOKEN … 自分のチャネルの長期のチャネルアクセストークン
 *   WEBHOOK_KEY               … Webhook の URL の ?key=（setupBot が作る。GAS は LINE の署名を読めないため）
 *   OWNER_USER_ID             … 持ち主の LINE の ID（adoptOwner が入れる）
 */

const BOT_VERSION_ = '2026.10.25.6';
const BOT_NAME_ = 'くらぶボット';
const BOT_COLOR_ = '#6C47FF'; // くらぶ（Qlove）の色
const BOT_PAGES_ = 'https://katsuan.github.io/qlove-bot/';
const QUOTA_RATES_ = { normal: 0.8, high: 0.95 }; // 今月の push がこの割合をこえたら止める（急ぎでない知らせから）
const OWNER_CANDIDATE_SECONDS_ = 600;
const MEMBER_REQUEST_SECONDS_ = 24 * 3600; // 「🙋 使いたい」は1人1日1回だけ持ち主に知らせる

// ---- 入口から渡されるもの ----

let ENV_ = null;
const memo_ = {}; // 1回の呼び出しの中で、同じシートは1回だけ読む（ux.md の H9）

/**
 * env：{ props（スクリプト プロパティ）, cache（スクリプトのキャッシュ）, lock（スクリプトのロック）,
 *        book（配布用シートのコピー）, getUrl()（ウェブアプリの URL）, triggers（入口のトリガーの関数名。点検のときだけ） }
 */
function useEnv_(env) {
  if (!env || !env.props || !env.cache || !env.book) throw new Error('入口から env を渡してください');
  ENV_ = env;
  Object.keys(memo_).forEach((k) => delete memo_[k]);
  modulesReady_();
}

const props_ = () => ENV_.props;
const cache_ = () => ENV_.cache;
const book_ = () => ENV_.book;

function propText_(key) {
  return String(props_().getProperty(key) || '').trim();
}

const lineToken_ = () => propText_('LINE_CHANNEL_ACCESS_TOKEN');
const ownerUserId_ = () => propText_('OWNER_USER_ID');

function withLock_(fn) {
  const lock = ENV_.lock;
  if (lock) lock.waitLock(10000);
  try {
    return fn();
  } finally {
    if (lock) lock.releaseLock();
  }
}

function timeZone_() {
  return Session.getScriptTimeZone() || 'Asia/Tokyo';
}

function formatDay_(date) {
  return Utilities.formatDate(date, timeZone_(), 'yyyy-MM-dd');
}

// ---- 機能（モジュール） ----
//
// 機能は registerModule_ で足す（例：50_weather.gs。ファイルの名前の決まりは README の「機能の足し方」）。持てるもの（どれもなくてよい）：
//   key・emoji・name・desc   … 名前（key は postback の m= とシート「機能」の行）
//   order                    … 言葉・位置情報を受けとる順（小さいほど先）
//   words                    … この機能の一覧を出す言葉（例：['天気の知らせ']）
//   menu(event, role)        … 一覧の返事（words・「🧩 機能」から）
//   onPostback(event, p, role)    … postback（m=key）の返事
//   onLocation(event, role)       … 位置情報。自分あてでなければ null（次の機能へ）
//   onText(event, text, role)     … 決まった形の文（words にないもの）。自分あてでなければ null
//   textPattern              … onText が受ける文の形（「入力中…」を出すかを決めるのに使う）
//   hourly(now)              … 1時間おきの見張り。{ checked, sent, failed, skippedForQuota }
//   tool                     … ページ（ツール）からの呼び出し { action: (payload, user) => 返す中身 }
//   samples()                … #テストの見本 [{ id, label, build: () => messages }]
//   richMenu                 … トークの下のメニューの「この機能」のタブ { image, areas: [{ x, width, action }] }
//   sheets                   … この機能のシート { kind: { name, headers } }
//   checks()                 … 点検に足すこと [{ level, area, text }]

const MODULES_ = {};
const MODULE_FACTORIES_ = [];

/**
 * 機能を足す：registerModule_(() => ({ key: …, … }))。中身を作る関数で渡す。
 * GAS はファイルを名前の順に読むので、登録を書いたファイルより後ろのファイルの関数は、登録のときにはまだない。
 * そこで、ぜんぶのファイルを読み終わってから（入口から呼ばれたとき。useEnv_）組み立てる
 */
function registerModule_(factory) {
  MODULE_FACTORIES_.push(factory);
}

function modulesReady_() {
  while (MODULE_FACTORIES_.length) {
    const m = MODULE_FACTORIES_.shift()();
    MODULES_[m.key] = m;
    Object.assign(SHEETS_, m.sheets || {});
  }
}

/** 使う機能（シート「機能」で切れる。行がなければ使う）を、順番に */
function enabledModules_() {
  const off = new Set(readRows_('modules').filter((r) => !isOn_(r.enabled)).map((r) => String(r.key).trim()));
  return Object.keys(MODULES_).map((k) => MODULES_[k]).filter((m) => !off.has(m.key)).sort((a, b) => (a.order || 50) - (b.order || 50));
}

function moduleOf_(key) {
  return enabledModules_().find((m) => m.key === key) || null;
}

const SHEETS_ = {
  modules: { name: '機能', headers: ['key', 'name', 'enabled', 'note'] },
  members: { name: '使う人', headers: ['userId', 'displayName', 'status', 'createdAt', 'updatedAt'] },
  links: { name: 'つないだツール', headers: ['subHash', 'userId', 'tool', 'createdAt'] },
  log: { name: '動作の記録', headers: ['at', 'step', 'summary'] }
};

/** その人の役割：'owner'（持ち主）・'member'（許した人）・''（どちらでもない） */
function roleOf_(userId) {
  const id = String(userId || '').trim();
  if (!id) return '';
  if (id === ownerUserId_()) return 'owner';
  return allowedMemberIds_().includes(id) ? 'member' : '';
}

const canUse_ = (userId) => Boolean(roleOf_(userId));
