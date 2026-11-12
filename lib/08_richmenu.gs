/**
 * 08_richmenu.gs：トークの下のメニュー（リッチメニュー）
 *
 * 天気・釣り・しょくじ・記録がそろうボットは、3つのタブ（機能のまとまりごと。くらぶボットだけの例外。richMenuDefs3_）：
 *   そらくる・うみくる（1段ずつ：アプリの横長のロゴ（開く）・知らせ／釣れた・地点の登録）／つづく・しょくじ（記録のページへ行くボタン）／
 *   Qlove の設定（できること・つなぐ・使う人）
 * ほかの組み合わせは、タブは2つまで（ux.md の H6）。機能ごとにタブを足すと、機能がふえるたびにタブがふえて決まりをこえるので、こうする：
 *   左のタブ … いちばん先の機能（richMenu.rank が小さいもの。今は しょくじ：アイコン＋名前）。その機能のボタン（3つか6つ）
 *   右のタブ … Qlove（横長のロゴ。どの機能でも同じ）：ほかの機能の入口（richMenu.club。今は そらくる・記録・釣り）・できること・（入口が3つならつなぐ）・使う人。
 *              ほかの機能の入口がない組み合わせのときは、できること・ツールとつなぐ・使う人
 * 機能がふえても、メニューは2つのタブのまま。ふえた機能は「🧩 できること」のカードとクイックリプライに並ぶ。
 * 画像は 2500×843。上の 170 がタブの行（2つか3つに分ける）、下の 673 にボタン（3つは横1列、4つは 2×2、6つは 2×3。tools/richmenu.py で作り、GitHub Pages から読む）
 * 呼ばれるところ：00_public.gs の botSetupRichMenu（入口の setupRichMenu）。タブの切りかえの postback（m=core&a=tab）には返事をしない
 */

const RICH_TAB_HEIGHT_ = 170;
const RICH_ALIAS_ = { main: 'qlove-tab-main', club: 'qlove-tab-club' };
// 右のタブの画像：「左のタブの機能|ほかの機能の入口（key をつないだもの）」ごと（左のタブの名前も絵に入っているため）。
// 入口の組み合わせの絵がないときは「左の機能|」（できること・つなぐ・使う人）。それもなければ richmenu-club.png
const RICH_CLUB_IMAGES_ = {
  'weather|': 'richmenu-club.png',
  'meal|': 'richmenu-club-meal.png',
  'meal|weather,log': 'richmenu-club-weather-log.png',
  'sea|': 'richmenu-club-sea.png'
};

/** ボタンを、タブの行の下に並べる（3つまでは横1列、4つ以上は2段） */
function richBodyAreas_(actions) {
  const rows = actions.length > 3 ? 2 : 1;
  const cols = Math.ceil(actions.length / rows);
  const height = 843 - RICH_TAB_HEIGHT_;
  return actions.map((action, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const y = RICH_TAB_HEIGHT_ + Math.round((height / rows) * row);
    return {
      bounds: { x: Math.round((2500 / cols) * col), y: y, width: Math.round(2500 / cols), height: RICH_TAB_HEIGHT_ + Math.round((height / rows) * (row + 1)) - y },
      action: action
    };
  });
}

/**
 * 3つのタブ（くらぶボットだけ。ux.md の H6「2つまで」の例外。機能のまとまりごと）：
 *   そらくる・うみくる（天気・釣り）／つづく・しょくじ（記録・しょくじ）／Qlove の設定（できること・つなぐ・使う人）
 *   並びはアイコンの順（そらくる・うみくる・つづく・しょくじ）。画像のボタンの地はアプリのアイコンの色をうすく、字は濃く
 * 4つの機能がそろって使えるときだけ。ほかの組み合わせは、2つのタブ（richMenuDefs2_）。
 * つづく・しょくじのタブは、記録のページへ行くボタンだけ（つづく：つづくを開く、しょくじ：きょうの集計・一覧。機能の richMenu.pages）
 */
const RICH_TABS3_ = [
  // field … 機能の richMenu のどのボタンを並べるか（tab3：1段に ロゴ・ボタン2つ、pages：記録のページへ行くボタンだけ）
  { alias: 'qlove-tab-outdoor', modules: ['weather', 'sea'], field: 'tab3', chatBarText: 'そらくる・うみくる', image: 'richmenu-3-outdoor.png' },
  { alias: 'qlove-tab-daily', modules: ['log', 'meal'], field: 'pages', chatBarText: 'つづく・しょくじ', image: 'richmenu-3-daily.png' },
  { alias: 'qlove-tab-settings', modules: [], chatBarText: 'Qlove の設定', image: 'richmenu-3-settings.png' }
];
const RICH_SETTINGS_ACTIONS_ = [
  { type: 'postback', data: 'm=core&a=modules', displayText: '🧩 できること' },
  { type: 'postback', data: 'm=core&a=link', displayText: '🔗 ツールとつなぐ' },
  { type: 'postback', data: 'm=core&a=people', displayText: '👥 使う人' }
];

/** 3つのタブのメニュー（使えなければ null）。タブの行は3つに分けて、押すとそのタブに切りかえる */
function richMenuDefs3_() {
  const on = {};
  enabledModules_().filter((m) => m.richMenu).forEach((m) => { on[m.key] = m; });
  if (!RICH_TABS3_.every((t) => t.modules.every((k) => on[k] && on[k].richMenu[t.field]))) return null;
  const tabs = () => RICH_TABS3_.map((t, i) => ({
    bounds: { x: Math.round((2500 / 3) * i), y: 0, width: Math.round((2500 / 3) * (i + 1)) - Math.round((2500 / 3) * i), height: RICH_TAB_HEIGHT_ },
    action: { type: 'richmenuswitch', richMenuAliasId: t.alias, data: `m=core&a=tab&t=${i}` }
  }));
  return RICH_TABS3_.map((t, i) => {
    const actions = t.modules.length ? [].concat(...t.modules.map((k) => on[k].richMenu[t.field])) : RICH_SETTINGS_ACTIONS_;
    return {
      alias: t.alias,
      image: `${BOT_PAGES_}assets/${t.image}`,
      menu: { size: { width: 2500, height: 843 }, selected: i === 0, name: t.alias, chatBarText: t.chatBarText, areas: tabs().concat(richBodyAreas_(actions)) }
    };
  });
}

/** 作るメニューの中身と画像の URL：4つの機能がそろえば3つのタブ、ほかは2つのタブ */
function richMenuDefs_() {
  return richMenuDefs3_() || richMenuDefs2_();
}

/** 2つのタブのメニュー（左：いちばん先の機能・右：くらぶ）の中身と画像の URL */
function richMenuDefs2_() {
  const withMenu = enabledModules_().filter((m) => m.richMenu).sort((a, b) => (a.richMenu.rank || 50) - (b.richMenu.rank || 50));
  const first = withMenu.find((m) => m.richMenu.image) || null;
  const tabs = () => [
    { bounds: { x: 0, y: 0, width: 1250, height: RICH_TAB_HEIGHT_ }, action: { type: 'richmenuswitch', richMenuAliasId: RICH_ALIAS_.main, data: 'm=core&a=tab&t=main' } },
    { bounds: { x: 1250, y: 0, width: 1250, height: RICH_TAB_HEIGHT_ }, action: { type: 'richmenuswitch', richMenuAliasId: RICH_ALIAS_.club, data: 'm=core&a=tab&t=club' } }
  ];
  // 右のタブ：左にならなかった機能の入口（画像がある組み合わせのときだけ）
  const others = withMenu.filter((m) => m !== first && m.richMenu.club);
  const has = (key) => Object.prototype.hasOwnProperty.call(RICH_CLUB_IMAGES_, key);
  const mainKey = first ? first.key : '';
  const clubKey = `${mainKey}|${others.map((m) => m.key).join(',')}`;
  const useOthers = Boolean(first && others.length && has(clubKey));
  const clubImage = useOthers ? RICH_CLUB_IMAGES_[clubKey] : RICH_CLUB_IMAGES_[`${mainKey}|`] || 'richmenu-club.png';
  // 入口が3つなら「🔗 ツールとつなぐ」も入れて6つ（2×3。5つだと1つ空く）
  const clubActions = useOthers
    ? others.map((m) => m.richMenu.club).concat([
      { type: 'postback', data: 'm=core&a=modules', displayText: '🧩 できること' },
      others.length === 3 ? { type: 'postback', data: 'm=core&a=link', displayText: '🔗 ツールとつなぐ' } : null,
      { type: 'postback', data: 'm=core&a=people', displayText: '👥 使う人' }
    ].filter(Boolean))
    : [
      { type: 'postback', data: 'm=core&a=modules', displayText: '🧩 できること' },
      { type: 'postback', data: 'm=core&a=link', displayText: '🔗 ツールとつなぐ' },
      { type: 'postback', data: 'm=core&a=people', displayText: '👥 使う人' }
    ];
  const club = {
    alias: RICH_ALIAS_.club,
    image: `${BOT_PAGES_}assets/${clubImage}`,
    menu: {
      size: { width: 2500, height: 843 },
      selected: !first,
      name: 'qlove-club',
      chatBarText: 'Qlove',
      areas: (first ? tabs() : []).concat(richBodyAreas_(clubActions))
    }
  };
  if (!first) return [club];
  return [{
    alias: RICH_ALIAS_.main,
    image: first.richMenu.image,
    menu: { size: { width: 2500, height: 843 }, selected: true, name: `qlove-${first.key}`, chatBarText: first.richMenu.chatBarText || `${first.emoji} ${first.name}`, areas: tabs().concat(richBodyAreas_(first.richMenu.areas)) }
  }, club];
}

/** メニューを作りなおす（前に作ったものは消す）。いちばん左のタブをみんなのメニューにする */
function setupRichMenus_() {
  if (!lineToken_()) {
    console.log('❌ LINE_CHANNEL_ACCESS_TOKEN がまだです');
    return false;
  }
  const old = String(props_().getProperty('RICH_MENU_IDS') || '').split(',').filter(Boolean);
  const made = [];
  for (const def of richMenuDefs_()) {
    const created = lineRequest_('post', 'richmenu', def.menu);
    if (created.getResponseCode() !== 200) {
      console.log(`❌ メニュー（${def.menu.chatBarText}）を作れませんでした（${created.getResponseCode()}）`);
      return false;
    }
    const id = JSON.parse(created.getContentText()).richMenuId;
    const image = UrlFetchApp.fetch(def.image, { muteHttpExceptions: true });
    if (image.getResponseCode() !== 200) {
      console.log('❌ メニューの画像を読めませんでした（少しあとで、もう一度）');
      return false;
    }
    const upload = UrlFetchApp.fetch(`${LINE_DATA_API_}/richmenu/${id}/content`, {
      method: 'post',
      contentType: 'image/png',
      headers: { Authorization: `Bearer ${lineToken_()}` },
      payload: image.getBlob().getBytes(),
      muteHttpExceptions: true
    });
    if (upload.getResponseCode() !== 200) {
      console.log(`❌ メニューの画像を送れませんでした（${upload.getResponseCode()}）`);
      return false;
    }
    // 名前（alias）は付けなおす：なければ作る・あれば今のメニューに向ける
    const alias = lineRequest_('post', `richmenu/alias/${def.alias}`, { richMenuId: id });
    if (alias.getResponseCode() !== 200) lineRequest_('post', 'richmenu/alias', { richMenuAliasId: def.alias, richMenuId: id });
    made.push(id);
  }
  lineRequest_('post', `user/all/richmenu/${made[0]}`);
  old.filter((id) => !made.includes(id)).forEach((id) => lineRequest_('delete', `richmenu/${id}`));
  props_().setProperty('RICH_MENU_IDS', made.join(','));
  console.log(`✅ トークの下のメニューを作りました（タブ ${made.length} つ。出るまで少しかかることがあります）`);
  return true;
}
