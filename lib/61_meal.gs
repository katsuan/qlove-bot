/**
 * 61_meal.gs：機能「🍚 しょくじ」（食事記録ボットを、くらぶボットに合流させたもの）
 *
 * トークで食べたものの名前を送ると記録して、1日の集計カードを返す。くわしい入力・一覧・直すは しょくじ（q-shoquji。LIFF）。
 *   文字   … 1対1 で、使える人の文は、ほかの機能が受けとらなければ、ぜんぶ食事の名前として読む（いちばん最後。order 90）。
 *            「目標 1800」「350」（未記入にカロリー）「#しょくじ 2026/10/22 …」（しょくじのカードの記録用の文字）も
 *   写真   … いちばん近い食事の記録に付ける（ドライブに置く）
 *   ボタン … m=meal&action=…（集計・ご飯◯杯分・MYメニューに保存 など。06_line_webhook の MEAL_LINE_POSTBACK_HANDLERS）
 *   しょくじ（LIFF）… { app: "qlove", tool: "shoquji", action }（07_web_liff の MEAL_LIFF_API_ACTIONS）。本人はくらぶボットが確かめる
 *   20時   … きょうの記録がない人（受けとると決めた人だけ）に知らせる（01_entry の mealHourly_）
 * シート：meal_users（しょくじの人の目標・知らせ・よく記録するもの）・meal_logs（記録）・nutrition_master（MYメニュー）。
 * 前の食事記録ボットのシートのタブを写せば、記録はそのまま使える（users は meal_users に名前を変える）
 * ファイル：61_meal.gs（登録）・61_meal_01_entry（見張り・シートの手直し）・02_core（決まった値）・03_domain_*（記録・MYメニュー・人）・
 *          04_usecase_*（記録の流れ・よく記録・しょくじの文字・#テストの見本）・05_ui_*（カード・集計）・06_line_webhook（LINE）・
 *          07_web_liff（しょくじからの呼び出し）・08_infra（部品）・09_setup（シートの用意・20時の文）
 * 呼ばれるところ：02_config.gs の registerModule_（ぜんぶのファイルを読み終わってから組み立てる）
 */

const MEAL_LABEL_ = '🍚 しょくじ';

registerModule_(() => ({
  key: 'meal',
  emoji: '🍚',
  name: 'しょくじ',
  desc: '食べたものの名前を送ると記録して、1日の合計カロリーを返します（くわしくは しょくじ の画面で）',
  order: 90, // ほかの機能が受けとらなかった文を、食事の名前として読むので、いちばん最後
  words: [MEAL_LABEL_, 'しょくじ', '食事', 'きょうの集計'],
  toolKeys: ['shoquji'],
  menu: (event, role) => mealMenuMessages_(event, role),
  onText: (event, text, role) => (role && isOneToOne_(event) && mealTakesText_(text) ? mealHandleEvent_(event) : null),
  textPattern: /^(?![#＃📍])\S|^[#＃]\s*しょくじ/u, // 1対1 の文は、ほとんど受けとりうる（「入力中…」を出す。使える人だけ）
  textForMembers: true,
  onImage: (event, role) => (role && isOneToOne_(event) ? mealHandleEvent_(event) : null),
  onPostback: (event, p, role) => (role ? mealHandleEvent_(event) : [notAllowedText_()]),
  // 返事をしないボタン：入力欄に「目標 2000」を入れて開くだけのもの（返事は、送られてきた文に）と、知らないもの
  noReply: (p) => p.action === 'askTarget' || !Object.prototype.hasOwnProperty.call(MEAL_LINE_POSTBACK_HANDLERS, String(p.action || '')),
  hourly: mealHourly_,
  onEdit: mealOnEdit_,
  tool: mealToolActions_(),
  samples: mealSamples_,
  // トークの下のメニューの左のタブ「🍚 しょくじ」（6つ。画像は tools/richmenu.py の meal）
  richMenu: {
    rank: 10,
    chatBarText: MEAL_LABEL_,
    image: `${BOT_PAGES_}assets/richmenu-meal.png`,
    areas: [
      { type: 'uri', uri: mealBuildLiffUrl_({ mode: 'input', meal: '朝' }) },
      { type: 'uri', uri: mealBuildLiffUrl_({ mode: 'input', meal: '昼' }) },
      { type: 'uri', uri: mealBuildLiffUrl_({ mode: 'input', meal: '夜' }) },
      { type: 'uri', uri: mealBuildLiffUrl_({ mode: 'input', meal: 'その他' }) },
      { type: 'postback', data: mealPostbackData_({ action: 'showSummary' }), displayText: 'きょうの集計' },
      { type: 'uri', uri: mealBuildLiffUrl_({ mode: 'logs' }) }
    ]
  },
  checks: () => {
    const missing = [MEAL_SHEET.USERS, MEAL_SHEET.MEAL_LOGS, MEAL_SHEET.NUTRITION_MASTER].filter((name) => !book_().getSheetByName(name));
    return missing.length
      ? [{ level: '⚠️', text: `${missing.join('・')} がまだない（はじめて記録したときに作ります。前の食事記録ボットのタブを写すときは、この名前に）` }]
      : [{ level: '✅', text: `しょくじのシートがある（記録 ${Math.max(0, book_().getSheetByName(MEAL_SHEET.MEAL_LOGS).getLastRow() - 1)} 件）` }];
  }
}));

/**
 * 食事の名前として読む文か：ほかの機能の決まった形（# ではじまる記録の言葉・📍 ではじまるそらくるの文）は読まない。
 * 「#しょくじ …」（しょくじのカードの記録用の文字）は読む
 */
function mealTakesText_(text) {
  const t = String(text || '').trim();
  if (/^[#＃]\s*しょくじ/u.test(t)) return true;
  return Boolean(t) && !/^[#＃📍]/u.test(t);
}

/** 「🍚 しょくじ」（言葉・ボタン）：使える人には、きょうの集計（カード）と、20時の知らせの切りかえ。まだの人には案内 */
function mealMenuMessages_(event, role) {
  if (!role) return [notAllowedText_()];
  const userId = userIdOf_(event);
  mealSetLineEventUser_(userId);
  mealEnsureProjectSetup_();
  const profile = mealResolveLineProfile_(userId);
  const user = mealEnsureUserExists_(userId, profile.displayName);
  const messages = mealBuildDailySummaryMessages_(userId, {
    dashboard: mealGetDashboardData_(userId),
    headline: 'きょうの集計',
    senderProfile: profile,
    withTarget: true,
  });
  // 20時の知らせは人ごとにえらぶ（送れる数を分け合うため。はじめは受けとらない）。クイックリプライの最後に切りかえ
  const last = messages[messages.length - 1];
  const items = ((last.quickReply && last.quickReply.items) || []).slice(0, 12);
  last.quickReply = { items: items.concat([mealNotifyQuickItem_(user)]) };
  return messages;
}

/**
 * しょくじ（LIFF）からの呼び出し：action ごとに、くらぶボットが確かめた本人（user）で動かす。
 * 返すのは前の食事記録ボットと同じ形（{ ok, … }。だめなときは { ok: false, error: やさしい言葉 }）
 */
function mealToolActions_() {
  const out = {};
  Object.keys(MEAL_LIFF_API_ACTIONS).forEach((action) => {
    out[action] = (body, user) => {
      try {
        mealUseCaller_(user);
        return MEAL_LIFF_API_ACTIONS[action](body || {});
      } catch (error) {
        return { ok: false, error: mealPublicErrorMessage_(error) };
      }
    };
  });
  return out;
}
