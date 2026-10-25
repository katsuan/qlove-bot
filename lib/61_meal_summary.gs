/**
 * 61_meal_summary.gs：記録したあとに返す集計カード（食事記録ボットの 05_ui.summary.gs から。Q のツールのカードと同じ組み立て：色の帯に日付と見出し → 中身 → ボタン）。
 *
 * - 1枚目：きょうの集計。合計と目標（バーは朝昼夜の色）、朝・昼・夜・その他ごとの品と小計、ボタンは「記録する」「一覧・直す」
 * - 未記入があるときだけ：カロリーを入れるカード（品ごとに「入れる」）
 * - 最後：よく記録するもの（押すとすぐ記録。固定した MYメニュー → 記録の多い順）
 * - クイックリプライ：よく記録するもの（押すとすぐ記録）と「ほかを入力」。最後のメッセージに付ける
 *
 * 「DB にないので入れてください」と促すカード（buildMealInputPromptFlexMessage_・buildPendingMasterSavePromptFlexMessage_）は 4_ui.cards.gs。
 */

const MEAL_SUMMARY_THEME = {
  brand: '#C8553D', // 帯・ボタン（画面の色とそろえる）
  brandSoft: '#FDF1EC',
  over: '#C84949',
  notice: '#B7672B',
  noticeSoft: '#FDF1E3',
  ink: '#231815',
  sub: '#6B5E57',
  line: '#EFE3DC',
  track: '#EFE3DC',
};
const MEAL_QUICK_REPLY_MAX = 13;

// 記録したあとに送るメッセージ（配列）。最後のメッセージにクイックリプライが付く
function mealBuildDailySummaryMessages_(userId, options) {
  const context = Object.assign({}, options || {});
  const dashboard = context.dashboard || mealGetDashboardData_(userId);
  const headline = mealBuildSummaryHeadline_(context);
  // 季節の絵文字（gs/0_core/season.gs）：記録したときの見出しにだけ、ときどき1つ。altText には付けない（1通に1つまで）
  const happy = Boolean(context.record) || Boolean(context.headline && context.headline !== 'きょうの集計');
  context.headlineShown = happy ? QSeason.decorate(headline, context.seasonOptions) : headline;
  const bubbles = [mealBuildSummaryBubble_(dashboard, context)];
  const pendingBubble = mealBuildPendingBubble_(dashboard);
  if (pendingBubble) bubbles.push(pendingBubble);
  const quickBubble = mealBuildQuickMenusBubble_(dashboard);
  if (quickBubble) bubbles.push(quickBubble);

  const total = mealSummaryTotal_(dashboard);
  const target = Number(dashboard.user && dashboard.user.calorieTarget || 0);
  const message = mealApplyFlexSender_({
    type: 'flex',
    altText: `${headline}${mealBuildAddedKcalText_(context.record)}｜きょう ${mealFormatKcalDisplay_(total)} kcal${target > 0 ? ` / 目標 ${mealFormatKcalDisplay_(target)} kcal` : ''}`,
    // 横に並べるカードは、同じ大きさでないと LINE に断られる（not allowed to mix different bubble size）
    contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles.map(bubble => Object.assign({}, bubble, { size: bubbles[0].size || 'mega' })) },
  }, context.senderProfile);
  return mealAttachQuickMenus_([message], dashboard, context.withTarget ? [mealBuildTargetQuickReplyItem_(target)] : []);
}

// 「🎯 目標を変える」：押すと入力欄に「目標 2000」が入った状態で開く（「目標 ◯◯」を覚えなくても変えられる）。
// postback は受けとっても何もしない（返事は、送られてきた「目標 ◯◯」に返す）
function mealBuildTargetQuickReplyItem_(target) {
  return {
    type: 'action',
    action: {
      type: 'postback',
      label: '🎯 目標を変える',
      data: mealPostbackData_({ action: 'askTarget' }),
      inputOption: 'openKeyboard',
      fillInText: `目標 ${target > 0 ? Math.round(target) : 2000}`,
    },
  };
}

// 前からの呼び名（1通だけ返す）
function mealBuildDailySummaryFlexMessage_(userId, options) {
  return mealBuildDailySummaryMessages_(userId, options)[0];
}

// メッセージの最後に、よく記録するもののクイックリプライを付ける（もう付いているときは後ろに足す）
function mealAttachQuickMenus_(messages, dashboard, extraItems) {
  const list = Array.isArray(messages) ? messages.slice() : [];
  if (!list.length) return list;
  const last = Object.assign({}, list[list.length - 1]);
  const items = (last.quickReply && last.quickReply.items ? last.quickReply.items.slice() : []).concat(extraItems || []);
  const quickMenus = (dashboard && dashboard.quickMenus) || [];
  quickMenus.forEach(item => {
    if (items.length >= MEAL_QUICK_REPLY_MAX - 1) return;
    items.push({
      type: 'action',
      action: {
        type: 'message',
        label: mealTrimQuickReplyLabel_(`${item.pinned ? '📌' : '🍚'}${item.displayName || item.menu}`),
        text: String(item.displayName || item.menu || ''),
      },
    });
  });
  items.push({
    type: 'action',
    action: { type: 'uri', label: '📝 ほかを入力', uri: mealBuildLiffUrl_({ mode: 'input' }) },
  });
  last.quickReply = { items: items.slice(0, MEAL_QUICK_REPLY_MAX) };
  list[list.length - 1] = last;
  return list;
}

// 1,030 のように桁区切り（小数は1けた）
function mealFormatKcalComma_(value) {
  const number = Math.round(Number(value || 0) * 10) / 10;
  const [int, dec] = String(Math.abs(number)).split('.');
  return `${number < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${dec ? `.${dec}` : ''}`;
}

// きょうの合計（はっきり＋だいたい）を返す
function mealSummaryTotal_(dashboard) {
  const today = dashboard.today || {};
  return Number(today.totalExact || 0) + Number(today.totalEstimated || 0);
}

// 集計カードの見出し（渡された見出し → 「◯ を記録」→「きょうの集計」）
function mealBuildSummaryHeadline_(context) {
  if (context.headline) return context.headline;
  if (context.record) return `${mealBuildRecordDisplayName_(context.record)} を記録`;
  return 'きょうの集計';
}

// 日付を「10/25（土）」の形にする
function mealFormatSummaryDate_(date) {
  const d = date ? new Date(date) : new Date();
  const week = ['日', '月', '火', '水', '木', '金', '土'][Number(Utilities.formatDate(d, MEAL_APP_TIMEZONE, 'u')) % 7];
  return `${Utilities.formatDate(d, MEAL_APP_TIMEZONE, 'M/d')}（${week}）`;
}

// 色の帯：小さく日付、太く見出し（キロっく・しょくじのカードと同じ形）
function mealBuildSummaryHeader_(dateText, title, color) {
  return {
    type: 'box',
    layout: 'vertical',
    backgroundColor: color || MEAL_SUMMARY_THEME.brand,
    paddingAll: '12px',
    paddingStart: '16px',
    contents: [
      { type: 'text', text: dateText, size: 'xs', color: '#FBE3DA', weight: 'bold' },
      { type: 'text', text: title, size: 'lg', color: '#FFFFFF', weight: 'bold', wrap: true, margin: 'xs' },
    ],
  };
}

// きょうの集計カード1枚（増えた分・合計と目標・朝昼夜のバー・PFC・食事ごとの品・ボタン）を作る
function mealBuildSummaryBubble_(dashboard, context) {
  const today = dashboard.today || {};
  const target = Number(dashboard.user && dashboard.user.calorieTarget || 0);
  const total = mealSummaryTotal_(dashboard);
  const hasTarget = target > 0;
  const over = hasTarget && total > target;
  const logs = (dashboard.logEntries && dashboard.logEntries.today) || dashboard.recentLogs || [];
  const record = context.record || null;
  const recordId = record ? String(record.logId || '') : '';

  const contents = [];

  // いま記録した品で、いくつ増えたか（いちばん上に大きく）
  const added = mealBuildAddedKcalRow_(record);
  if (added) contents.push(added);

  // 合計：大きく。右に目標
  contents.push({ type: 'text', text: 'きょうの合計', size: 'xs', weight: 'bold', color: MEAL_SUMMARY_THEME.sub, margin: added ? 'lg' : 'none' });
  contents.push({
    type: 'box',
    layout: 'baseline',
    contents: [
      { type: 'text', text: mealFormatKcalComma_(total), size: '3xl', weight: 'bold', color: over ? MEAL_SUMMARY_THEME.over : MEAL_SUMMARY_THEME.ink, flex: 0 },
      { type: 'text', text: 'kcal', size: 'sm', weight: 'bold', color: MEAL_SUMMARY_THEME.sub, flex: 0, margin: 'sm' },
      {
        type: 'text',
        text: hasTarget ? `目標 ${mealFormatKcalComma_(target)}` : '目標なし',
        size: 'xs',
        color: MEAL_SUMMARY_THEME.sub,
        align: 'end',
      },
    ],
  });

  // バー（朝昼夜の色）
  if (hasTarget) {
    contents.push(mealBuildMealBar_(today.meals || {}, Math.max(target, total)));
    contents.push({
      type: 'text',
      text: over
        ? `目標を ${mealFormatKcalComma_(total - target)} kcal こえています`
        : `あと ${mealFormatKcalComma_(target - total)} kcal`,
      size: 'sm',
      weight: 'bold',
      color: over ? MEAL_SUMMARY_THEME.over : MEAL_SUMMARY_THEME.brand,
      margin: 'sm',
    });
  }

  // PFC（入れた品がある日だけ）
  const nutrition = today.nutrition || {};
  if (logs.some(log => log.protein != null || log.fat != null || log.carb != null)) {
    contents.push({
      type: 'text',
      text: `P ${mealRoundNutrition_(nutrition.protein)}g ・ F ${mealRoundNutrition_(nutrition.fat)}g ・ C ${mealRoundNutrition_(nutrition.carb)}g`,
      size: 'xs',
      color: MEAL_SUMMARY_THEME.sub,
      margin: 'xs',
    });
  }

  // 食事ごと：札・品の名前・小計
  const groups = MEAL_TYPES
    .map(meal => ({ meal: meal, items: logs.filter(log => mealSanitizeMealType_(log.meal) === meal) }))
    .filter(group => group.items.length);
  if (groups.length) {
    contents.push({ type: 'separator', margin: 'lg', color: MEAL_SUMMARY_THEME.line });
    groups.forEach(group => {
      const subtotal = group.items.reduce((sum, log) => sum + Number(log.kcal || 0), 0);
      const allPending = group.items.every(log => log.kcal == null);
      const names = group.items
        .slice()
        .reverse()
        .map(log => `${String(log.logId || '') === recordId ? '✓' : ''}${log.menu}${log.kcal == null ? '（?）' : ''}`)
        .join('、');
      contents.push({
        type: 'box',
        layout: 'horizontal',
        spacing: 'md',
        margin: 'md',
        contents: [
          mealBuildMealTag_(group.meal),
          { type: 'text', text: names, size: 'sm', color: MEAL_SUMMARY_THEME.ink, wrap: true, flex: 1, gravity: 'center' },
          { type: 'text', text: allPending ? '—' : mealFormatKcalComma_(subtotal), size: 'sm', weight: 'bold', color: MEAL_SUMMARY_THEME.sub, flex: 0, gravity: 'center' },
        ],
      });
    });
  }

  // ひとこと（しょくじから記録したときの「◯/◯ の分として」「飛ばしました」など）。別の文にせず、カードの中に
  if (context.note) {
    contents.push({ type: 'text', text: String(context.note), size: 'xs', color: MEAL_SUMMARY_THEME.sub, wrap: true, margin: 'md' });
  }

  if (today.hasPending) {
    contents.push({
      type: 'text',
      text: `⚠ カロリー未入力が ${(today.pendingItems || []).length} 品あります（合計に入っていません）`,
      size: 'xs',
      color: MEAL_SUMMARY_THEME.notice,
      wrap: true,
      margin: 'md',
    });
  }

  return {
    type: 'bubble',
    size: 'mega',
    header: mealBuildSummaryHeader_(mealFormatSummaryDate_(new Date()), context.headlineShown || mealBuildSummaryHeadline_(context)),
    body: { type: 'box', layout: 'vertical', paddingAll: '16px', contents: contents },
    footer: {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      paddingAll: '10px',
      contents: [
        {
          type: 'button',
          style: 'primary',
          height: 'sm',
          color: MEAL_SUMMARY_THEME.brand,
          action: { type: 'uri', label: '＋ 記録する', uri: mealBuildLiffUrl_({ mode: 'input' }) },
        },
        {
          type: 'button',
          style: 'secondary',
          height: 'sm',
          color: MEAL_SUMMARY_THEME.brandSoft,
          action: { type: 'uri', label: '一覧・直す', uri: mealBuildLiffUrl_({ mode: 'logs' }) },
        },
      ],
    },
  };
}

// 「＋ 168 kcal  米 100g」の行。カロリーがまだの品は「カロリーはまだ」
function mealBuildAddedKcalRow_(record) {
  if (!record) return null;
  const kcal = mealToNullableNumber_(record.kcal);
  const estimated = record.kcalStatus === MEAL_KCAL_STATUS.ESTIMATED;
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    paddingAll: '10px',
    cornerRadius: '10px',
    backgroundColor: MEAL_SUMMARY_THEME.brandSoft,
    contents: kcal == null
      ? [
        { type: 'text', text: 'カロリーはまだ', size: 'md', weight: 'bold', color: MEAL_SUMMARY_THEME.notice, flex: 0 },
        { type: 'text', text: mealBuildRecordDisplayName_(record) || '—', size: 'sm', color: MEAL_SUMMARY_THEME.ink, align: 'end', wrap: true },
      ]
      : [
        { type: 'text', text: `＋${estimated ? '約' : ''}${mealFormatKcalComma_(kcal)}`, size: 'xl', weight: 'bold', color: MEAL_SUMMARY_THEME.brand, flex: 0 },
        { type: 'text', text: 'kcal', size: 'sm', weight: 'bold', color: MEAL_SUMMARY_THEME.sub, flex: 0 },
        { type: 'text', text: mealBuildRecordDisplayName_(record) || '—', size: 'sm', color: MEAL_SUMMARY_THEME.ink, align: 'end', wrap: true },
      ],
  };
}

// altText 用：「（＋168 kcal）」
function mealBuildAddedKcalText_(record) {
  const kcal = record ? mealToNullableNumber_(record.kcal) : null;
  if (kcal == null) return '';
  return `（＋${record.kcalStatus === MEAL_KCAL_STATUS.ESTIMATED ? '約' : ''}${mealFormatKcalDisplay_(kcal)} kcal）`;
}

// 朝・昼・夜・間食の色で分けた横のバーを作る（base が100%）
function mealBuildMealBar_(meals, base) {
  const segments = MEAL_TYPES
    .map(meal => {
      const value = Number(meals[meal] || 0);
      if (!value || !base) return null;
      return {
        type: 'box',
        layout: 'vertical',
        width: `${Math.max(2, Math.min(100, Math.round((value / base) * 100)))}%`,
        height: '10px',
        backgroundColor: mealGetMealFlexColor_(meal),
        contents: [],
      };
    })
    .filter(Boolean);
  return {
    type: 'box',
    layout: 'horizontal',
    height: '10px',
    margin: 'md',
    cornerRadius: '999px',
    backgroundColor: MEAL_SUMMARY_THEME.track,
    // 中身が空の箱は受けつけられないので、記録がない日は幅1%の透明な箱を入れる
    contents: segments.length ? segments : [{ type: 'box', layout: 'vertical', width: '1%', height: '10px', contents: [] }],
  };
}

// 食事の種類の小さな札（色つき）を作る
function mealBuildMealTag_(meal) {
  return {
    type: 'box',
    layout: 'vertical',
    width: '34px',
    height: '22px',
    cornerRadius: '6px',
    backgroundColor: mealGetMealFlexColor_(meal),
    justifyContent: 'center',
    flex: 0,
    contents: [{ type: 'text', text: meal === 'その他' ? '間食' : meal, size: 'xxs', color: '#FFFFFF', weight: 'bold', align: 'center' }],
  };
}

// 未記入があるときだけ：品ごとに「入れる」（トークの中で、ご飯何杯分かを聞く。画面で詳しく入れる道もそこに出す）
function mealBuildPendingBubble_(dashboard) {
  const pending = ((dashboard.today && dashboard.today.pendingItems) || []).slice(0, 5);
  if (!pending.length) return null;
  const logs = (dashboard.logEntries && dashboard.logEntries.today) || [];
  return {
    type: 'bubble',
    size: 'mega',
    header: mealBuildSummaryHeader_('MYメニューにない品', 'カロリーを入れる', MEAL_SUMMARY_THEME.notice),
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '14px',
      contents: pending.map(item => {
        const log = logs.find(entry => String(entry.logId || '') === String(item.logId || '')) || item;
        return {
          type: 'box',
          layout: 'horizontal',
          spacing: 'sm',
          contents: [
            mealBuildMealTag_(mealSanitizeMealType_(item.meal)),
            { type: 'text', text: String(item.menu || ''), size: 'sm', color: MEAL_SUMMARY_THEME.ink, wrap: true, flex: 1, gravity: 'center' },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              flex: 0,
              color: MEAL_SUMMARY_THEME.noticeSoft,
              action: {
                type: 'postback',
                label: '入れる',
                data: mealPostbackData_({ action: 'askEstimate', logId: item.logId, row: item.row }),
                displayText: `> ${String(item.menu || '')} のカロリーを入れる`,
              },
            },
          ],
        };
      }),
    },
  };
}

// よく記録するもの：行を押すと、その名前を送ってすぐ記録（MYメニューにある名前なので、そのまま記録される）
function mealBuildQuickMenusBubble_(dashboard) {
  const items = ((dashboard && dashboard.quickMenus) || []).slice(0, 6);
  if (!items.length) return null;
  return {
    type: 'bubble',
    size: 'mega',
    header: mealBuildSummaryHeader_('押すとすぐ記録', 'よく記録するもの'),
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '12px',
      contents: items.map(item => ({
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        paddingAll: '10px',
        cornerRadius: '10px',
        backgroundColor: MEAL_SUMMARY_THEME.brandSoft,
        action: {
          type: 'message',
          label: mealTrimQuickReplyLabel_(item.displayName || item.menu),
          text: String(item.displayName || item.menu || ''),
        },
        contents: [
          {
            type: 'text',
            text: `${item.pinned ? '📌 ' : ''}${item.displayName || item.menu}`,
            size: 'sm',
            weight: 'bold',
            color: MEAL_SUMMARY_THEME.ink,
            wrap: true,
            flex: 1,
          },
          {
            // 空の文字は受けつけられないので、カロリーがない品は「—」
            type: 'text',
            text: item.kcal != null ? `${mealFormatKcalDisplay_(item.kcal)}` : '—',
            size: 'xs',
            color: MEAL_SUMMARY_THEME.sub,
            flex: 0,
            gravity: 'center',
          },
        ],
      })),
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '8px',
      contents: [{
        type: 'text',
        text: '📌 並べかえ・固定する ›',
        size: 'xs',
        color: MEAL_SUMMARY_THEME.brand,
        align: 'center',
        action: { type: 'uri', label: '並べかえ', uri: mealBuildLiffUrl_({ mode: 'quick' }) },
      }],
    },
  };
}
