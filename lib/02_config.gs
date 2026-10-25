/**
 * くらぶボット（仮）：くらぶ（Qlove）のツール共通の LINE ボット。ライブラリ（中身）
 * 02_config.gs：決まった値・入口から渡されるもの（env）・機能（モジュール）の登録
 *
 * 作り
 *   配布用シート（入口：entry/00_setup.gs・01_entry.gs）→ このライブラリ（版つき）
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
 * 呼ばれるところ：ライブラリのどこからでも（env の読み方・決まった値・機能の一覧）。入口から呼ばれたとき、00_public.gs が useEnv_ で env を受けとる
 */

const BOT_VERSION_ = '2026.10.25.15';
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

/** 入口のスクリプト プロパティ（鍵・持ち主など） */
const props_ = () => ENV_.props;
/** 入口のスクリプトのキャッシュ（つなぐ番号・位置情報を待つ印など。決まった時間で消える） */
const cache_ = () => ENV_.cache;
/** 配布用シートのコピー（地点・使う人などのシートがある） */
const book_ = () => ENV_.book;

/** スクリプト プロパティの値を、前後の空白をとって返す（なければ ""） */
function propText_(key) {
  return String(props_().getProperty(key) || '').trim();
}

/** LINE のチャネルアクセストークン（なければ ""） */
const lineToken_ = () => propText_('LINE_CHANNEL_ACCESS_TOKEN');
/** 持ち主の LINE の ID（まだいなければ ""） */
const ownerUserId_ = () => propText_('OWNER_USER_ID');

/** 入口のスクリプトのロック（機能が自分で waitLock・releaseLock するとき。なければ何もしないロック） */
function scriptLock_() {
  return ENV_.lock || { waitLock: () => true, tryLock: () => true, releaseLock: () => {}, hasLock: () => true };
}

/** シートに書くあいだ、ほかの呼び出しを待たせる（同時に書いて行がずれないように）。fn の返したものを返す */
function withLock_(fn) {
  const lock = ENV_.lock;
  if (lock) lock.waitLock(10000);
  try {
    return fn();
  } finally {
    if (lock) lock.releaseLock();
  }
}

/** 日付を決める時間帯（ふつうは Asia/Tokyo） */
function timeZone_() {
  return Session.getScriptTimeZone() || 'Asia/Tokyo';
}

/** 日時を "yyyy-MM-dd"（その時間帯の日付）にする */
function formatDay_(date) {
  return Utilities.formatDate(date, timeZone_(), 'yyyy-MM-dd');
}

// ---- 機能（モジュール） ----
//
// 機能は registerModule_ で足す（例：50_weather.gs。ファイルの名前の決まりは README の「機能の足し方」）。持てるもの（どれもなくてよい）：
//   key・emoji・name・desc   … 名前（key は postback の m= とシート「機能」の行）
//   sender                   … 返事・知らせの送り主 { name（例：しょくじ〜ShoQuji〜）, iconUrl（ツールのアイコン。PNG）}
//   toolUrls                 … そのツールの URL のはじめ。これを開くボタンには、ツールのアイコンを付ける（withToolIcons_）
//   order                    … 言葉・位置情報を受けとる順（小さいほど先）
//   words                    … この機能の一覧を出す言葉（例：['天気の知らせ']）
//   menu(event, role)        … 一覧の返事（words・「🧩 機能」から）。メッセージ1つか、その並び
//   onPostback(event, p, role)    … postback（m=key）の返事
//   noReply(p)               … 返事をしない postback か（「入力中…」を出さない。例：入力欄を開くだけのボタン）
//   onLocation(event, role)       … 位置情報。自分あてでなければ null（次の機能へ）
//   onText(event, text, role)     … 決まった形の文（words にないもの）。自分あてでなければ null。返事を自分で送ったら []
//   textPattern              … onText が受ける文の形（「入力中…」を出すかを決めるのに使う）。textForMembers なら、使える人の文だけ
//   onImage(event, role)     … 写真。自分あてでなければ null
//   hourly(now)              … 1時間おきの見張り。{ checked, sent, failed, skippedForQuota }
//   onEdit(e)                … シートを手で直したとき（入口の onEdit）
//   tool                     … ページ（ツール）からの呼び出し { action: (payload, user) => 返す中身 }
//   webhook(body)            … ?key= のない呼び出しの本文で、自分あてのもの（Alfred など）。ちがえば null。合言葉は機能が確かめる
//   toolKeys                 … ページが送ってくる tool の名前（key とちがうとき。例：しょくじは 'shoquji'）
//   samples()                … #テストの見本 [{ id, label, build: () => messages }]
//   richMenu                 … トークの下のメニューの「この機能」のタブ { rank（小さいほど左のタブに出やすい。image があるものだけ）, image, areas: [action…]（3つか6つ）,
//                              club（右の Qlove のタブに置くボタン。左のタブにならなかったとき） }
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

/** 登録された機能（registerModule_）を組み立てて、機能とそのシートを使えるようにする（入口から呼ばれたとき1回） */
function modulesReady_() {
  while (MODULE_FACTORIES_.length) {
    const m = MODULE_FACTORIES_.shift()();
    MODULES_[m.key] = m;
    Object.assign(SHEETS_, m.sheets || {});
  }
}

/**
 * 機能のメッセージに、送り主（その機能のツールの名前とアイコン。機能の sender）を付ける。
 * トークでは、ボットの名前とアイコンのかわりに「しょくじ〜ShoQuji〜」などと出る（LINE の sender。名前は20字まで）
 */
function withToolSender_(moduleOrKey, messages) {
  const m = typeof moduleOrKey === 'string' ? MODULES_[moduleOrKey] : moduleOrKey;
  const sender = m && m.sender;
  if (!sender || !Array.isArray(messages)) return messages;
  return messages.map((msg) => (msg && typeof msg === 'object'
    ? Object.assign({}, withToolIcons_(m, msg), { sender: { name: Array.from(sender.name).slice(0, 20).join(''), iconUrl: sender.iconUrl } })
    : msg));
}

// ボタンの色（LINE の決まり：style ごと。color があればそれ）
const BUTTON_LOOK_ = { primary: { bg: '#17C950', text: '#FFFFFF' }, secondary: { bg: '#DCDFE5', text: '#111111' }, link: { bg: '', text: '#42659A' } };

/**
 * その機能のツールを開くボタン（URL が機能の toolUrls ではじまるもの）に、ツールのアイコン（sender.iconUrl）を付ける。
 *   カードのボタン → アイコンと名前を並べた押せる箱（色はもとのボタンと同じ）。クイックリプライ → imageUrl。
 *   アイコンを付けたものは、名前の頭の絵文字を外す（「🌤️ そらくるで見る」→ [そらくるのアイコン] そらくるで見る）
 */
function withToolIcons_(m, message) {
  const prefixes = (m && m.toolUrls) || [];
  const icon = m && m.sender && m.sender.iconUrl;
  if (!icon || !prefixes.length) return message;
  const isTool = (action) => Boolean(action && action.type === 'uri' && prefixes.some((p) => String(action.uri || '').indexOf(p) === 0));
  const plain = (label) => String(label || '').replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u, '') || String(label || '');
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    if (node.type === 'button' && isTool(node.action)) {
      const look = BUTTON_LOOK_[node.style] || BUTTON_LOOK_.link;
      const bg = node.style === 'link' ? '' : node.color || look.bg;
      const text = node.style === 'link' ? node.color || look.text : node.style === 'primary' ? '#FFFFFF' : look.text;
      const box = {
        type: 'box', layout: 'horizontal', spacing: 'sm', justifyContent: 'center', alignItems: 'center', cornerRadius: '8px', paddingAll: '9px',
        action: node.action,
        contents: [
          { type: 'image', url: icon, size: '20px', aspectRatio: '1:1', flex: 0 },
          { type: 'text', text: plain(node.action.label), size: 'sm', weight: 'bold', color: text, flex: 0, wrap: false }
        ]
      };
      if (bg) box.backgroundColor = bg;
      ['flex', 'margin', 'offsetTop'].forEach((k) => { if (node[k] !== undefined) box[k] = node[k]; });
      return box;
    }
    const out = {};
    Object.keys(node).forEach((k) => { out[k] = k === 'quickReply' ? node[k] : walk(node[k]); });
    return out;
  };
  const result = walk(message);
  if (message.quickReply && Array.isArray(message.quickReply.items)) {
    result.quickReply = { items: message.quickReply.items.map((item) => (item && isTool(item.action) && !item.imageUrl
      ? Object.assign({}, item, { imageUrl: icon, action: Object.assign({}, item.action, { label: plain(item.action.label) }) })
      : item)) };
  }
  return result;
}

/** 使う機能（シート「機能」で切れる。行がなければ使う）を、順番に */
function enabledModules_() {
  const off = new Set(readRows_('modules').filter((r) => !isOn_(r.enabled)).map((r) => String(r.key).trim()));
  return Object.keys(MODULES_).map((k) => MODULES_[k]).filter((m) => !off.has(m.key)).sort((a, b) => (a.order || 50) - (b.order || 50));
}

/** key の機能（使っているものだけ）。なければ null */
function moduleOf_(key) {
  return enabledModules_().find((m) => m.key === key) || null;
}

/** ページが送ってくる tool の名前（機能の key か toolKeys）の機能（使っているものだけ）。なければ null */
function moduleOfTool_(tool) {
  return enabledModules_().find((m) => m.key === tool || (m.toolKeys || []).includes(tool)) || null;
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

/** このボットを使える人か（持ち主か、持ち主が許した人） */
const canUse_ = (userId) => Boolean(roleOf_(userId));
