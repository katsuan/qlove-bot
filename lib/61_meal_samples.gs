/**
 * 61_meal_samples.gs：機能「🍚 しょくじ」の、#テスト の見本（q-oqrn/docs/ux.md の H11。食事記録ボットの 04_usecase.testkit.gs から）
 * 持ち主が「#テスト」と送ると出る、くらぶボットのテストの窓口（07_test_window.gs）に、しょくじの見本を足す（61_meal.gs の samples）。
 * - 見本は、ためしのデータで作る（mealSampleDashboard_）。本物の記録・シート・ほかの人には書かない、送らない
 * - 返事（reply）だけ。20時の知らせなど、ふだん push のものも、見本は reply で見せる
 * - 見本のボタン・クイックリプライは、押してもテストの窓口に戻るだけのものに置きかえる（画面を開くボタンはそのまま）
 * 自己点検・断られたときの文・季節の絵文字は、くらぶボット共通の見本にある
 */

// しょくじの見本の種類（#テスト のクイックリプライに並ぶ）
const MEAL_QTEST_KINDS = [
  { kind: 'log', label: '🍚 記録したとき' },
  { kind: 'input', label: '🍚 入力・聞き返し' },
  { kind: 'target', label: '🍚 目標・集計' },
  { kind: 'notice', label: '🍚 20時の知らせ' },
];

// くらぶボットの #テスト に渡す見本（[{ id, label, build }]）
function mealSamples_() {
  return MEAL_QTEST_KINDS.map(item => ({
    id: item.kind,
    label: item.label,
    build: () => mealBuildTestSampleMessages_(item.kind).slice(0, 5).map(message => mealQtestMark_(mealQtestDisarm_(message))),
  }));
}

// 見本のボタンを、押しても記録しないものに（画面を開く uri と、テストの窓口のボタンはそのまま）
function mealQtestDisarm_(value) {
  if (Array.isArray(value)) return value.map(mealQtestDisarm_);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).forEach(key => {
    const v = value[key];
    if (key === 'action' && v && typeof v === 'object' && v.type && v.type !== 'uri' && !/^m=core&a=test&/.test(String(v.data || ''))) {
      const label = String(v.label || '見本');
      out[key] = { type: 'postback', label: label, data: 'm=core&a=test&t=pressed', displayText: label };
    } else {
      out[key] = mealQtestDisarm_(v);
    }
  });
  return out;
}

// 見本だとわかるように：文は先頭に 🧪、カードは altText の先頭に 🧪
function mealQtestMark_(message) {
  const copy = Object.assign({}, message);
  if (copy.type === 'text' && !/^🧪/.test(copy.text)) copy.text = `🧪 ${copy.text}`;
  if (copy.type === 'flex' && !/^🧪/.test(copy.altText)) copy.altText = `🧪 ${copy.altText}`.slice(0, 400);
  return copy;
}

// 見本の記録（カロリーが入っている品）
function mealQtestSampleRecord_() {
  return { logId: 'sample', row: 2, meal: '昼', menu: 'カレーライス', kcal: 780, protein: 20, fat: 25, carb: 110, kcalStatus: 'exact', mealDate: new Date() };
}

// 見本の記録（カロリー未記入の品）
function mealQtestSamplePending_() {
  return { logId: 'sample-p', row: 3, meal: '夜', menu: 'なぞ定食', kcal: null, kcalStatus: 'pending', mealDate: new Date() };
}

// 見本のデータで、集計カードを作る（options は見出しなど）
function mealQtestSummary_(options) {
  return mealBuildDailySummaryMessages_('', Object.assign({ dashboard: mealSampleDashboard_() }, options));
}

// 見本のメッセージ（kind ごと。5通まで）
function mealBuildTestSampleMessages_(kind) {
  const record = mealQtestSampleRecord_();
  const pending = mealQtestSamplePending_();
  const draft = { menu: pending.menu, prefill: { hasSuggestion: false, nutrition: mealEmptyNutrition_() }, candidates: [] };
  switch (kind) {
    case 'log':
      return [].concat(
        mealQtestSummary_({ record: record, headline: `${record.menu} を記録`, seasonOptions: { rand: () => 0.99 } }),
        [
          mealBuildPendingMasterSavePromptFlexMessage_(Object.assign({}, record, { masterKey: '' }), {}),
          mealBuildMealInputPromptFlexMessage_({ meal: pending.meal, menu: pending.menu, logId: pending.logId, row: pending.row, mealDate: mealFormatDateKey_(new Date()) }, draft, {}),
        ]
      );
    case 'input':
      return [
        mealBuildEstimateAskMessage_(pending),
        mealBuildPendingKcalSelectionMessage_(300, [pending, Object.assign({}, pending, { logId: 'sample-q', meal: '朝', menu: 'なぞパン' })]),
        mealBuildImageAttachChoiceFlexMessage_('昼', [record, Object.assign({}, pending, { meal: '昼' })], 'sample-token', {}),
        mealBuildPopularMenuDetailFlexMessage_({ menu: record.menu, displayName: record.menu, kcal: 780, count: 5, averageKcal: 770 }, {}),
      ];
    case 'target':
      return [].concat(
        mealQtestSummary_({ headline: mealBuildTargetUpdatedReply_('', 1800), withTarget: true, seasonOptions: { rand: () => 0.99 } }),
        mealQtestSummary_({ headline: 'きょうの集計', withTarget: true })
      );
    case 'notice':
      return [mealBuildReminderMessagesFor_(mealSampleDashboard_().quickMenus)[0]];
    default:
      return [];
  }
}

// 見本の集計データ（シートを読まずにカードを作るため）
function mealSampleDashboard_() {
  const now = new Date().toISOString();
  return {
    user: { userId: '', displayName: '見本', calorieTarget: 2000 },
    today: {
      totalExact: 1030,
      totalEstimated: 0,
      hasPending: true,
      pendingItems: [{ logId: 'sample-p', row: 3, meal: '夜', menu: 'なぞ定食', mealDate: now }],
      meals: { 朝: 250, 昼: 780, 夜: 0, その他: 0 },
      nutrition: { protein: 28, fat: 31, carb: 150, salt: 3.2, fiber: 4 },
    },
    recentLogs: [],
    logEntries: { today: [], yesterday: [] },
    weekly: [],
    popularMenus: [],
    quickMenus: [
      { masterKey: 'm1', menu: 'トースト', displayName: 'トースト', kcal: 250, pinned: true },
      { masterKey: 'm2', menu: 'カレーライス', displayName: 'カレーライス', kcal: 780, pinned: false },
    ],
    streak: { current: 3, longest: 5 },
    streakRanking: [],
    targetDiff: 970,
  };
}
