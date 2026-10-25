/**
 * 61_meal_cards.gs：しょくじの返事のカードと文（食事記録ボットの 05_ui.cards.gs から）：MYメニューにない品の入力・MYメニューへの保存・
 * だいたいのカロリー（ご飯◯杯分）・どの未記入に入れるか・よく食べるものの1品・画像えらび、と小さな部品。集計カードは 61_meal_summary.gs。
 * 呼ばれるところ：61_meal_line.gs（LINE の返事）・61_meal_liff.gs・61_meal_samples.gs
 */

// 記録したことを伝える文（記録した品・きょうの合計・目標まで・未記入）を返す
function mealBuildLogReply_(userId, record) {
  const summary = mealGetTodaySummary_(userId);
  const total = summary.totalExact + summary.totalEstimated;
  const estimatedNote = summary.totalEstimated > 0
    ? `推定 ${summary.totalEstimated} kcal を含みます`
    : '';
  const displayName = mealBuildRecordDisplayName_(record);

  return [
    '記録',
    `${record.meal}: ${displayName}`,
    mealBuildMealKcalLine_(record),
    mealBuildKcalDiffLine_(userId, total),
    `今日の合計: ${mealFormatKcalDisplay_(total)} kcal`,
    estimatedNote,
    mealBuildPendingWarning_(summary),
  ].filter(Boolean).join('\n');
}

// 記録のカロリーの出し方（「250 kcal」「約 240 kcal」「カロリーはまだ」）を返す
function mealBuildMealKcalLine_(record) {
  const formattedKcal = mealFormatKcalDisplay_(record && record.kcal);
  switch (record.kcalStatus) {
    case MEAL_KCAL_STATUS.EXACT:
      return `${formattedKcal} kcal`;
    case MEAL_KCAL_STATUS.ESTIMATED:
      return `約 ${formattedKcal} kcal`;
    case MEAL_KCAL_STATUS.PENDING:
      return 'カロリー未登録';
    default:
      return '';
  }
}

// 未記入の品の一覧の文（なければ ""）
function mealBuildPendingWarning_(summary) {
  if (!summary.hasPending) return '';
  return ['未記入の記録:', ...summary.pendingItems.map(item => `- ${item.menu || item}`)].join('\n');
}

// 目標までのこり（またはこえた分）の文を返す
function mealBuildKcalDiffLine_(userId, total) {
  const user = mealGetUserById_(userId);
  if (!user || user.calorieTarget == null) {
    return '目標カロリー未設定';
  }

  const diff = user.calorieTarget - total;
  return diff >= 0
    ? `残り ${mealFormatKcalDisplay_(diff)} kcal`
    : `目標オーバー ${mealFormatKcalDisplay_(Math.abs(diff))} kcal`;
}

// 目標を変えたときの集計カードの見出し（季節の絵文字は、カードの見出しを作るところで付く）
function mealBuildTargetUpdatedReply_(userId, kcal) {
  return `🎯 目標を ${mealFormatKcalDisplay_(kcal)} kcal に`;
}

// 数だけ送られて未記入がいくつかあるとき、どれに入れるかを聞く文（クイックリプライで選ぶ）
function mealBuildPendingKcalSelectionMessage_(kcal, logs) {
  const safeLogs = Array.isArray(logs) ? logs : [];
  return {
    type: 'text',
    text: `${mealFormatKcalDisplay_(kcal)} kcal をどの未記入に入れますか？`,
    quickReply: {
      items: safeLogs.slice(0, 10).map(log => ({
        type: 'action',
        action: {
          type: 'postback',
          label: mealTrimQuickReplyLabel_(`${mealSanitizeMealType_(log.meal)} ${String(log.menu || '')}`.trim()),
          data: mealPostbackData_({
            action: 'resolvePendingKcal',
            logId: log.logId,
            row: log.row,
            kcal: kcal,
          }),
          displayText: `> ${mealSanitizeMealType_(log.meal)} ${String(log.menu || '')} に ${mealFormatKcalDisplay_(kcal)} kcal`,
        },
      })),
    },
  };
}

// MYメニューへの保存をすすめるか（名前とカロリーがあれば true）
function mealShouldOfferMasterSave_(record) {
  if (!record) return false;
  if (!String(record.menu || '').trim()) return false;
  return mealToNullableNumber_(record.kcal) != null;
}

// MYメニューにない品を記録したとき、保存をすすめるカード（すぐ保存・画面で直して保存）
function mealBuildPendingMasterSavePromptFlexMessage_(record, senderProfile) {
  // カロリーを入れた品が MYメニューにないとき：保存を促す（色の帯 → 中身 → ボタン2つ）
  const ref = String(record && (record.logId || record.row) || '').trim();
  const editUrl = mealBuildMealEditUrl_(record);
  const save = {
    type: 'postback',
    label: '📒 MYメニューに保存',
    data: mealPostbackData_({
      action: 'savePendingMaster',
      logId: ref,
      row: record && record.row,
    }),
    displayText: `> ${mealBuildRecordDisplayName_(record)} をMYメニューに保存`,
  };
  return mealApplyFlexSender_({
    type: 'flex',
    altText: `${mealBuildRecordDisplayName_(record)} をMYメニューにも保存できます`,
    quickReply: { items: [{ type: 'action', action: Object.assign({}, save, { label: mealTrimQuickReplyLabel_(save.label) }) }] },
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: mealBuildSummaryHeader_('MYメニューにない品', mealBuildRecordDisplayName_(record)),
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '14px',
        contents: [
          { type: 'text', text: mealBuildMealKcalLine_(record) || '—', size: 'lg', weight: 'bold', color: MEAL_SUMMARY_THEME.ink },
          {
            type: 'text',
            text: 'MYメニューに保存すると、次から名前を送るだけで記録できます。',
            wrap: true,
            size: 'xs',
            color: MEAL_SUMMARY_THEME.sub,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '10px',
        contents: [
          // 押されるたびにボットが記録を見て返す（もう保存ずみ・消した・ほかの人の記録なら、そう返す）ので、カードに置いてよい（ux.md H2）
          { type: 'button', style: 'primary', height: 'sm', color: MEAL_SUMMARY_THEME.brand, action: save },
          { type: 'button', style: 'secondary', height: 'sm', color: MEAL_SUMMARY_THEME.brandSoft, action: { type: 'uri', label: '✏️ 画面で直して保存', uri: editUrl } },
        ],
      },
    },
  }, senderProfile);
}

// その記録を、しょくじの入力の画面で開く URL
function mealBuildMealEditUrl_(record) {
  if (!record) {
    return mealBuildLiffUrl_({ mode: 'input' });
  }
  const mealDate = record.mealDate
    ? Utilities.formatDate(new Date(record.mealDate), MEAL_APP_TIMEZONE, 'yyyy-MM-dd')
    : '';
  return mealBuildLiffUrl_({
    mode: 'input',
    logId: record.logId,
    meal: record.meal,
    menu: record.menu,
    mealDate: mealDate,
    datePreset: mealInferDatePresetFromMealDate_(mealDate),
    masterKey: record.masterKey,
    flavor: record.flavor,
    unit: record.unit,
    note: record.note,
    kcal: record.kcal,
    protein: record.protein,
    fat: record.fat,
    carb: record.carb,
    salt: record.salt,
    fiber: record.fiber,
    todayExact: record.todayExact,
    targetKcal: record.targetKcal,
    pendingCount: record.pendingCount,
  });
}

// その MYメニューを、しょくじで直す画面の URL
function mealBuildMasterEditUrl_(item) {
  if (!item) {
    return mealBuildLiffUrl_({ mode: 'input' });
  }
  return mealBuildLiffUrl_({
    mode: 'input',
    masterKey: item.masterKey,
    menu: item.menu,
    flavor: item.flavor,
    unit: item.unit,
    note: item.note,
    kcal: item.kcal,
    protein: item.protein,
    fat: item.fat,
    carb: item.carb,
    salt: item.salt,
    fiber: item.fiber,
  });
}

// 食事の種類ごとの色を返す
function mealGetMealFlexColor_(meal) {
  switch (String(meal || '')) {
    case '朝':
      return '#F5A623';
    case '昼':
      return '#4A90E2';
    case '夜':
      return '#7B61FF';
    default:
      return '#6FCF97';
  }
}

// 数を小数1けたまでの文字にする（「250」「12.5」）
function mealFormatKcalDisplay_(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  return String(Math.round(number * 10) / 10).replace(/\.0$/, '');
}

// 数なら文字に、なければ「-」
function mealFormatNullableNutritionForFlex_(value) {
  const number = mealToNullableNumber_(value);
  return number == null ? '-' : mealFormatKcalDisplay_(number);
}

// 記録の出す名前（MYメニューにつながっていればその名前、なければ記録の名前）
function mealBuildRecordDisplayName_(record) {
  if (!record) return '';
  if (record.masterKey) {
    const master = mealGetNutritionMaster_(record.masterKey);
    if (master) {
      return String(master.name || '').trim();
    }
  }
  return String(record.menu || '').trim();
}

// クイックリプライの文字を20字までにする（こえたら「…」）
function mealTrimQuickReplyLabel_(value) {
  const text = String(value || '').trim();
  return text.length > 20 ? `${text.slice(0, 19)}…` : text;
}

// よく食べるものの1品のカード（ふだんのカロリー・回数・記録する・画面で直す）
function mealBuildPopularMenuDetailFlexMessage_(item, senderProfile) {
  // よく食べるものの1品（色の帯 → 数字 → ボタン2つ）
  const safeItem = item || {};
  const name = String(safeItem.displayName || safeItem.menu || '');
  const detailLine = mealBuildNutritionDescriptor_(safeItem.flavor, safeItem.unit);
  const editUrl = mealBuildMasterEditUrl_(safeItem);
  const logIt = { type: 'message', label: mealTrimQuickReplyLabel_(`＋ ${name}`), text: name };
  return mealApplyFlexSender_({
    type: 'flex',
    altText: `${name || 'よく食べるもの'}：${mealFormatNullableNutritionForFlex_(safeItem.kcal)} kcal`,
    quickReply: { items: [{ type: 'action', action: logIt }] },
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: mealBuildSummaryHeader_(`${safeItem.count || 0}回記録`, String(safeItem.menu || name)),
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '14px',
        contents: [
          { type: 'text', text: `${mealFormatNullableNutritionForFlex_(safeItem.kcal)} kcal`, size: 'xl', weight: 'bold', color: MEAL_SUMMARY_THEME.ink },
          detailLine ? { type: 'text', text: detailLine, size: 'xs', color: MEAL_SUMMARY_THEME.sub, wrap: true } : null,
          {
            type: 'text',
            text: `P ${mealFormatNullableNutritionForFlex_(safeItem.protein)}g ・ F ${mealFormatNullableNutritionForFlex_(safeItem.fat)}g ・ C ${mealFormatNullableNutritionForFlex_(safeItem.carb)}g`,
            size: 'xs',
            wrap: true,
            color: MEAL_SUMMARY_THEME.sub,
          },
          {
            type: 'text',
            text: `塩分 ${mealFormatNullableNutritionForFlex_(safeItem.salt)}g ・ 食物繊維 ${mealFormatNullableNutritionForFlex_(safeItem.fiber)}g ・ 平均 ${mealFormatKcalDisplay_(safeItem.averageKcal || 0)} kcal`,
            size: 'xs',
            wrap: true,
            color: MEAL_SUMMARY_THEME.sub,
          },
        ].filter(Boolean),
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '10px',
        contents: [
          { type: 'button', style: 'primary', height: 'sm', color: MEAL_SUMMARY_THEME.brand, action: Object.assign({}, logIt, { label: '＋ 記録する' }) },
          { type: 'button', style: 'secondary', height: 'sm', color: MEAL_SUMMARY_THEME.brandSoft, action: { type: 'uri', label: '✏️ MYメニューを直す', uri: editUrl } },
        ],
      },
    },
  }, senderProfile);
}

// MYメニューにない品を未記入で記録したときのカード（近い候補・ご飯◯杯分・数を送る・画面で詳しく）
function mealBuildMealInputPromptFlexMessage_(parsed, draft, senderProfile) {
  // MYメニューにない品：未記入で記録したうえで、①近い候補 ②だいたい（ご飯◯杯分）③数字を送る ④画面で詳しく、の順で促す
  const liffUrl = mealBuildLiffUrl_({
    mode: 'input',
    logId: parsed.logId,
    row: parsed.row,
    meal: parsed.meal,
    menu: parsed.menu,
    mealDate: parsed.mealDate,
    datePreset: parsed.datePreset,
  });
  const topCandidates = (draft && draft.candidates || []).slice(0, 3);
  const log = { logId: parsed.logId, row: parsed.row, meal: parsed.meal, menu: parsed.menu };
  const quickItems = (mealBuildCandidateQuickReply_(parsed, topCandidates) || { items: [] }).items.slice(0, 4)
    .concat(mealBuildEstimateQuickReplyItems_(log, liffUrl));
  const message = {
    type: 'flex',
    altText: `${parsed.menu} はMYメニューにないため、カロリー未入力で記録しました。だいたいのカロリーをえらべます。`,
    quickReply: { items: quickItems.slice(0, 13) },
    contents: {
      type: 'bubble',
      size: 'mega',
      header: mealBuildSummaryHeader_(`${mealSanitizeMealType_(parsed.meal) === 'その他' ? '間食' : parsed.meal}・MYメニューにない品`, parsed.menu, MEAL_SUMMARY_THEME.notice),
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: 'カロリー未入力で記録しました。だいたいで入れるなら、ご飯何杯分くらい？',
            wrap: true,
            size: 'sm',
            weight: 'bold',
            color: MEAL_SUMMARY_THEME.ink,
          },
          {
            // カードはトークに残り、クイックリプライは消える。カードには「下のボタン」と書かず、
            // 押せば聞きなおす（クイックリプライを出しなおす）ボタンを置く
            type: 'text',
            text: 'ご飯1杯（150g）≈ 240kcal が目安。数字を送っても入ります（例：350）',
            wrap: true,
            size: 'xs',
            color: MEAL_SUMMARY_THEME.sub,
          },
        ].filter(Boolean),
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '10px',
        spacing: 'sm',
        contents: [
          {
            // 聞き返すだけ（もう入っていれば「もう入っています」と返す）なので、あとで押されてもよい
            type: 'button',
            style: 'primary',
            height: 'sm',
            color: MEAL_SUMMARY_THEME.notice,
            action: {
              type: 'postback',
              label: '🍚 ご飯◯杯分で入れる',
              data: mealPostbackData_({ action: 'askEstimate', logId: parsed.logId, row: parsed.row }),
              displayText: `> ${parsed.menu} のカロリーを入れる`,
            },
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            color: MEAL_SUMMARY_THEME.brandSoft,
            action: { type: 'uri', label: '✏️ 画面で詳しく入れる', uri: liffUrl },
          },
        ],
      },
    },
  };
  return mealApplyFlexSender_(message, senderProfile);
}

// ---- だいたいのカロリー（ご飯◯杯分）。ご飯1杯（150g）≈ 240kcal ----
const MEAL_RICE_BOWL_KCAL = 240;

// だいたいのカロリーのえらびかた（ご飯½〜3杯分。間食は少し〜1.5杯）を返す
function mealBuildEstimateOptions_(meal) {
  const bowls = mealSanitizeMealType_(meal) === 'その他'
    ? [{ label: '🍬 少し', kcal: 80, note: '少し' }, 0.5, 1, 1.5]
    : [0.5, 1, 1.5, 2, 3];
  return bowls.map(b => (typeof b === 'object' ? b : {
    label: `🍚 ${b === 0.5 ? '½' : b}杯`,
    kcal: Math.round(MEAL_RICE_BOWL_KCAL * b),
    note: `ご飯${b === 0.5 ? '半' : b}杯分`,
  }));
}

// だいたいのカロリーを入れるボタン（記録と数を data に）を作る
function mealBuildEstimatePostback_(log, option) {
  return {
    type: 'postback',
    label: mealTrimQuickReplyLabel_(`${option.label} ${option.kcal}`),
    data: mealPostbackData_({
      action: 'estimateKcal',
      logId: log.logId,
      row: log.row,
      kcal: option.kcal,
      note: option.note,
    }),
    displayText: `> ${log.menu} は ${option.note}（約 ${option.kcal} kcal）`,
  };
}

// だいたいのカロリーのクイックリプライ（えらびかた全部と「画面で詳しく」）を作る
function mealBuildEstimateQuickReplyItems_(log, liffUrl) {
  return mealBuildEstimateOptions_(log.meal)
    .map(option => ({ type: 'action', action: mealBuildEstimatePostback_(log, option) }))
    .concat([{ type: 'action', action: { type: 'uri', label: '✏️ 画面で詳しく', uri: liffUrl || mealBuildMealEditUrl_(log) } }]);
}

// 未記入の品の「入れる」を押したとき：トークの中で、ご飯何杯分かを聞く
function mealBuildEstimateAskMessage_(log) {
  return {
    type: 'text',
    text: `「${log.menu}」はご飯何杯分くらい？\n（ご飯1杯 ≈ 240kcal。数字を送っても入ります）`,
    quickReply: { items: mealBuildEstimateQuickReplyItems_(log).slice(0, 13) },
  };
}

// メッセージの送り主の名前とアイコンを付ける（なければそのまま）
function mealApplyFlexSender_(message, profile) {
  const safeProfile = profile || {};
  if (!safeProfile.displayName && !safeProfile.pictureUrl) {
    return message;
  }

  const sender = {
    name: String(safeProfile.displayName || '食事ログ'),
  };
  if (safeProfile.pictureUrl) {
    sender.iconUrl = String(safeProfile.pictureUrl);
  }
  return Object.assign({}, message, {
    sender: sender,
  });
}

// 近い候補（MYメニュー）で記録するクイックリプライを5件まで作る
function mealBuildCandidateQuickReply_(parsed, candidates) {
  const items = (Array.isArray(candidates) ? candidates : [])
    .slice(0, 5)
    .map(candidate => ({
      type: 'action',
      action: {
        type: 'postback',
        label: mealTrimQuickReplyLabel_(mealBuildCandidateQuickReplyLabel_(candidate)),
        data: mealPostbackData_({
          action: 'logCandidate',
          logId: parsed.logId,
          row: parsed.row,
          meal: parsed.meal,
          masterKey: candidate.masterKey,
          menu: candidate.name,
          mealDate: parsed.mealDate,
        }),
        displayText: `> ${parsed.meal} ${candidate.name} で記録`,
      },
    }));
  return items.length ? { items: items } : undefined;
}

// 近い候補のクイックリプライの文字（品の名前）
function mealBuildCandidateQuickReplyLabel_(candidate) {
  return String(candidate && candidate.name || candidate && candidate.menu || '').trim();
}

// 写真をどの記録に付けるかのカード（えらぶのはクイックリプライだけ）
function mealBuildImageAttachChoiceFlexMessage_(mealType, candidateLogs, selectionToken, senderProfile) {
  // 画像をどの記録に付けるか。えらぶのはクイックリプライだけ（あとで押されると、期限切れや別の品に付くので）。
  // カードは品の一覧を見せるだけ
  const logs = Array.isArray(candidateLogs) ? candidateLogs.slice(0, 12) : [];
  const message = {
    type: 'flex',
    altText: `${mealType}の記録が${logs.length}品あります。画像を付ける品をえらんでね`,
    quickReply: {
      items: logs.map(log => ({
        type: 'action',
        action: {
          type: 'postback',
          label: mealTrimQuickReplyLabel_(`📷 ${log.menu}`),
          data: mealPostbackData_({
            action: 'attachMealImage',
            logId: log.logId,
            row: log.row,
            token: selectionToken,
          }),
          displayText: `> ${log.menu} に画像を付ける`,
        },
      })),
    },
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: mealBuildSummaryHeader_(`${mealType}・画像`, 'どの品に付ける？'),
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '12px',
        contents: logs.map(log => ({
          type: 'box',
          layout: 'horizontal',
          spacing: 'sm',
          contents: [
            { type: 'text', text: String(log.menu || '—'), size: 'sm', weight: 'bold', wrap: true, color: MEAL_SUMMARY_THEME.ink, flex: 1 },
            { type: 'text', text: mealFormatFlexLogKcal_(log) || '—', size: 'xs', color: MEAL_SUMMARY_THEME.sub, flex: 0, gravity: 'center' },
          ],
        })).concat([{ type: 'text', text: '付ける品は、この下に出るボタンでえらべます。ボタンが消えていたら、画像をもう一度送ってね。', size: 'xs', color: MEAL_SUMMARY_THEME.sub, wrap: true, margin: 'md' }]),
      },
    },
  };
  return mealApplyFlexSender_(message, senderProfile);
}

// 数を小数1けたに丸める
function mealRoundNutrition_(value) {
  const number = Number(value || 0);
  return Math.round(number * 10) / 10;
}

// カードの小さな欄に出すカロリーの文字（「約」と空白をとる）
function mealFormatFlexLogKcal_(log) {
  const line = mealBuildMealKcalLine_(log);
  return line.replace(/^約\s*/, '').replace(/\s+/g, '');
}
