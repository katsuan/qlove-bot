/**
 * 07_richmenu.gs：トークの下のメニュー（リッチメニュー）
 *
 * タブは2つまで（ux.md の H6）。機能ごとにタブを足すと、機能がふえるたびにタブがふえて決まりをこえるので、こうする：
 *   左のタブ … いちばん先の機能のツール（今は そらくる：アイコン＋名前）。その機能の3つのボタン
 *   右のタブ … Qlove（横長のロゴ。どの機能でも同じ）：できること（機能の一覧から、どの機能にも行ける）・ツールとつなぐ・使う人／使いたい
 * 機能がふえても、メニューは2つのタブのまま。ふえた機能は「🧩 できること」のカードとクイックリプライに並ぶ。
 * 画像は 2500×843。上の 170 がタブの行、下の 673 にボタンが3つ（tools/richmenu.py で作り、GitHub Pages から読む）
 */

const RICH_TAB_HEIGHT_ = 170;
const RICH_ALIAS_ = { main: 'qlove-tab-main', club: 'qlove-tab-club' };

function richMenuDefs_() {
  const first = enabledModules_().find((m) => m.richMenu);
  const tabs = (active) => [
    { bounds: { x: 0, y: 0, width: 1250, height: RICH_TAB_HEIGHT_ }, action: { type: 'richmenuswitch', richMenuAliasId: RICH_ALIAS_.main, data: 'm=core&a=tab&t=main' } },
    { bounds: { x: 1250, y: 0, width: 1250, height: RICH_TAB_HEIGHT_ }, action: { type: 'richmenuswitch', richMenuAliasId: RICH_ALIAS_.club, data: 'm=core&a=tab&t=club' } }
  ];
  const body = (actions) => actions.map((action, i) => ({ bounds: { x: Math.round((2500 / 3) * i), y: RICH_TAB_HEIGHT_, width: Math.round(2500 / 3), height: 843 - RICH_TAB_HEIGHT_ }, action: action }));
  const club = {
    alias: RICH_ALIAS_.club,
    image: `${BOT_PAGES_}assets/richmenu-club.png`,
    menu: {
      size: { width: 2500, height: 843 },
      selected: !first,
      name: 'qlove-club',
      chatBarText: 'Qlove',
      areas: (first ? tabs('club') : []).concat(body([
        { type: 'postback', data: 'm=core&a=modules', displayText: '🧩 できること' },
        { type: 'postback', data: 'm=core&a=link', displayText: '🔗 ツールとつなぐ' },
        { type: 'postback', data: 'm=core&a=people', displayText: '👥 使う人' }
      ]))
    }
  };
  if (!first) return [club];
  return [{
    alias: RICH_ALIAS_.main,
    image: first.richMenu.image,
    menu: { size: { width: 2500, height: 843 }, selected: true, name: `qlove-${first.key}`, chatBarText: first.richMenu.chatBarText || `${first.emoji} ${first.name}`, areas: tabs('main').concat(body(first.richMenu.areas)) }
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
