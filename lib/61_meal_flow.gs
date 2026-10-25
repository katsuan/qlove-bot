/**
 * 61_meal_flow.gs：しょくじの記録の流れ（食事記録ボットの 04_usecase.meal.gs から）
 *   送られた文字から記録する・未記入にカロリーを入れる・目標を変える、きょうの集計（ダッシュボード）・よく食べるもの・続けた日数を作る。
 * 前の管理者の操作（承認一覧・承認・拒否）は、くらぶボットの「👥 使う人」にまとめた
 * 呼ばれるところ：61_meal_06_line_webhook.gs（LINE の返事）・61_meal_07_web_liff.gs（しょくじからの呼び出し）
 */

// 「目標 1800」の形の文字なら true
function mealIsSetTargetCommand_(text) {
  return /^目標\s*\d+\s*(kcal)?$/i.test(String(text || '').trim());
}

// 「300」「昨日 夜 300kcal」のように数だけの文字なら、日付・食事・カロリーを返す（ちがえば null）
function mealParsePendingKcalInputContext_(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/^(?:(昨日|今日)\s*)?(?:(朝|昼|夜|その他)\s*)?(\d+(?:\.\d+)?)\s*(?:kcal)?$/i);
  if (!match) return null;
  const kcal = Number(match[3] || '');
  if (!Number.isFinite(kcal)) return null;
  // 日付を書いていないときは '' （きょう → きのうの順に探す）
  const datePreset = match[1] === '昨日' ? 'yesterday' : match[1] === '今日' ? 'today' : '';
  const meal = match[2] ? mealSanitizeMealType_(match[2]) : '';
  return {
    kcal: kcal,
    datePreset: datePreset,
    meal: meal,
  };
}

// 記録の一覧から、合計（はっきり・だいたい）・食事ごとの合計・未記入・PFC をまとめて返す
function mealSummarizeMealLogs_(logs) {
  const exactLogs = logs.filter(log => log.kcalStatus === MEAL_KCAL_STATUS.EXACT);
  const estimatedLogs = logs.filter(log => log.kcalStatus === MEAL_KCAL_STATUS.ESTIMATED);
  const pendingLogs = logs.filter(log => log.kcalStatus === MEAL_KCAL_STATUS.PENDING);
  const meals = { 朝: 0, 昼: 0, 夜: 0, その他: 0 };
  logs.forEach(log => {
    const meal = mealSanitizeMealType_(log.meal);
    meals[meal] = (meals[meal] || 0) + Number(log.kcal || 0);
  });

  return {
    totalExact: exactLogs.reduce((sum, log) => sum + Number(log.kcal || 0), 0),
    totalEstimated: estimatedLogs.reduce((sum, log) => sum + Number(log.kcal || 0), 0),
    hasPending: pendingLogs.length > 0,
    pendingItems: pendingLogs.map(log => ({
      logId: String(log.logId || ''),
      row: Number(log.row || 0),
      meal: String(log.meal || ''),
      menu: String(log.menu || ''),
      mealDate: mealToIsoDateTime_(log.mealDate),
    })),
    meals: meals,
    nutrition: mealSummarizeNutrition_(logs),
  };
}

// その人のきょうの集計を返す
function mealGetTodaySummary_(userId) {
  return mealGetSummaryByDate_(userId, new Date());
}

// その人のその日の集計を返す
function mealGetSummaryByDate_(userId, date) {
  const logs = mealGetMealLogsByUserAndDate_(userId, date);
  return mealSummarizeMealLogs_(logs);
}

// その人のその日の記録を返す
function mealGetMealLogsByUserAndDate_(userId, date) {
  if (!date) return [];
  const key = mealFormatDateKey_(date);
  return mealGetMealLogsByUser_(userId).filter(log => mealLogDateKey_(log) === key);
}

// ユーザーごとの束は、読みこんだログ1回につき1回だけ作る（ログを読みなおすと作りなおす）
function mealGetMealLogsByUser_(userId) {
  const logs = mealGetMealLogs_();
  if (!logs.byUser_) {
    const byUser = {};
    logs.forEach(log => {
      (byUser[log.userId] = byUser[log.userId] || []).push(log);
    });
    Object.defineProperty(logs, 'byUser_', { value: byUser, enumerable: false });
  }
  return (logs.byUser_[userId] || []).slice();
}

// その人のカロリー未記入の記録を、新しい順に返す
function mealGetPendingMealLogsByUser_(userId) {
  return mealGetMealLogsByUser_(userId)
    .filter(log => log.kcalStatus === MEAL_KCAL_STATUS.PENDING)
    .sort((left, right) => {
      const leftTime = new Date(left.updatedAt || left.createdAt || left.mealDate || 0).getTime();
      const rightTime = new Date(right.updatedAt || right.createdAt || right.mealDate || 0).getTime();
      return rightTime - leftTime;
    });
}

// その人の、その期間（両はしをふくむ）の記録を返す
function mealGetMealLogsByUserInRange_(userId, startDate, endDate) {
  const startKey = mealFormatDateKey_(startDate);
  const endKey = mealFormatDateKey_(endDate);
  return mealGetMealLogsByUser_(userId).filter(log => {
    const key = mealLogDateKey_(log);
    return key >= startKey && key <= endKey;
  });
}

// MYメニューを手で直したとき（onEdit）に、記録の数字を合わせなおす。
// - MYメニューにつながっている記録（masterKey）：MYメニューの数字に合わせる
// - カロリーがまだの記録：同じ名前の MYメニューがあれば、その数字を入れる
// - それ以外（MYメニューにない品・概算で入れた品）：さわらない（前は数字を消していた）
// 書くのは変わった行だけ。行がずれないよう、読むところから1人ずつ
function mealReapplyNutritionMaster_() {
  const sheet = mealGetSpreadsheet_().getSheetByName(MEAL_SHEET.MEAL_LOGS);
  if (!sheet) return 0;
  return mealWithSheetLock_(() => {
    mealForgetMemo_('mealLogs');
    let changed = 0;
    mealGetMealLogs_().forEach(log => {
      const next = mealBuildReappliedNutrition_(log);
      if (!next) return;
      const row = mealToSheetRow_(MEAL_LOG_NUTRITION_COLUMNS_, next);
      sheet.getRange(log.row, MEAL_LOG_COL_INDEX.kcal, 1, row.length).setValues([row]); // qcheck-ok: G1 toSheetRow_ で safeCell を通した行
      sheet.getRange(log.row, MEAL_LOG_COL_INDEX.updatedAt).setValue(new Date()); // qcheck-ok: G1 日時だけ
      changed += 1;
    });
    mealForgetMemo_('mealLogs');
    return changed;
  });
}

// kcal から masterKey までは、シートでとなり合っている
const MEAL_LOG_NUTRITION_COLUMNS_ = ['kcal', 'protein', 'fat', 'carb', 'salt', 'fiber', 'kcalStatus', 'masterKey'];

// 合わせなおした数字（変わらないときは null）
function mealBuildReappliedNutrition_(log) {
  if (log.kcalStatus === MEAL_KCAL_STATUS.ESTIMATED) return null;
  const linked = log.masterKey ? mealGetNutritionMaster_(log.masterKey) : null;
  const master = linked || (log.kcalStatus === MEAL_KCAL_STATUS.PENDING && !log.masterKey ? mealFindExactNutritionMaster_(log.menu) : null);
  if (!master || !mealHasAnyNutritionValue_(master)) return null;
  const next = Object.assign(mealPickNutrition_(master), { kcalStatus: MEAL_KCAL_STATUS.EXACT, masterKey: master.masterKey });
  const same = MEAL_LOG_NUTRITION_COLUMNS_.every(key => String(log[key] == null ? '' : log[key]) === String(next[key] == null ? '' : next[key]));
  return same ? null : next;
}

// 「目標 1800」で目標カロリーを直し、返事の見出しを返す
function mealHandleSetTargetCommand_(userId, text) {
  const kcal = mealParseTargetKcal_(text);
  mealUpdateUserCalorieTarget_(userId, kcal);
  return mealBuildTargetUpdatedReply_(userId, kcal);
}

// 画面の上に出す、きょうの合計・未記入の数・目標まで・許可のようすを返す
function mealGetHeaderState_(userId) {
  const user = mealEnsureUserExists_(userId);
  const today = mealGetTodaySummary_(userId);
  const totalIntake = Number(today.totalExact || 0) + Number(today.totalEstimated || 0);
  return {
    user: user,
    todayExact: Number(today.totalExact || 0),
    pendingCount: (today.pendingItems || []).length,
    targetDiff: user.calorieTarget == null ? null : user.calorieTarget - totalIntake,
    permission: mealSerializeUserPermission_(user),
  };
}

// 「目標 1800」から数（1800）を取り出す（なければ null）
function mealParseTargetKcal_(text) {
  const match = String(text || '').match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

// きょうの集計カード・画面に出すもの（きょうときのうの記録・1週間・よく食べるもの・よく記録するもの・続けた日数）をまとめて返す
function mealGetDashboardData_(userId) {
  const user = mealEnsureUserExists_(userId);
  const todayLogs = mealGetMealLogsByUserAndDate_(userId, new Date())
    .sort(mealCompareMealLogDisplayTimeDesc_);
  const today = mealSummarizeMealLogs_(todayLogs);
  const yesterdayLogs = mealGetMealLogsByUserAndDate_(userId, mealDateByPreset_('yesterday'))
    .sort(mealCompareMealLogDisplayTimeDesc_);
  const totalIntake = today.totalExact + today.totalEstimated;
  const popularMenus = mealGetPopularMenusByUser_(userId, 12);

  return {
    user: user,
    today: today,
    recentLogs: todayLogs.map(log => mealSerializeMealLog_(log)),
    logEntries: {
      today: todayLogs.map(log => mealSerializeMealLog_(log)),
      yesterday: yesterdayLogs.map(log => mealSerializeMealLog_(log)),
    },
    weekly: mealGetWeeklyChartData_(userId, 7),
    popularMenus: popularMenus.slice(0, 8),
    // よく記録するもの：固定した MYメニュー → 記録の多い順（画面・カード・クイックリプライで同じ並び）
    quickMenus: mealGetQuickMenus_(user, popularMenus, MEAL_QUICK_MENUS_LIMIT),
    streak: mealGetUserStreakSummary_(userId),
    streakRanking: mealGetStreakRanking_(10, userId),
    targetDiff: user.calorieTarget == null ? null : user.calorieTarget - totalIntake,
    detailUrl: mealBuildLiffUrl_({ mode: 'input' }),
  };
}

// 画面で名前から探すための MYメニューの一覧（画面の中で絞りこむので、検索のたびに呼ばなくてよい）
const MEAL_LIFF_MENU_LIST_LIMIT = 800;

// 画面（しょくじ）に渡す MYメニュー：自分の → 共通（ほかの人の品は渡さない）。scope：mine か common
function mealGetMenuListForLiff_() {
  return mealVisibleMasters_()
    .filter(master => String(master.name || '').trim() && String(master.status || 'active') !== 'inactive')
    .slice(-MEAL_LIFF_MENU_LIST_LIMIT)
    .map(master => ({
      masterKey: String(master.masterKey || ''),
      scope: mealIsCommonMaster_(master) ? 'common' : 'mine',
      menu: String(master.name || ''),
      flavor: String(master.flavor || ''),
      unit: String(master.unit || ''),
      note: String(master.note || ''),
      kcal: mealToNullableNumber_(master.kcal),
      protein: mealToNullableNumber_(master.protein),
      fat: mealToNullableNumber_(master.fat),
      carb: mealToNullableNumber_(master.carb),
      salt: mealToNullableNumber_(master.salt),
      fiber: mealToNullableNumber_(master.fiber),
    }));
}

// 記録を新しい順に並べるためのくらべ方（直した時刻 → 作った時刻 → 食べた日）
function mealCompareMealLogDisplayTimeDesc_(left, right) {
  const leftTime = new Date(left && (left.updatedAt || left.createdAt || left.mealDate) || 0).getTime();
  const rightTime = new Date(right && (right.updatedAt || right.createdAt || right.mealDate) || 0).getTime();
  return rightTime - leftTime;
}

// きょうまでの days 日分の、日ごとの合計カロリーを返す
function mealGetWeeklyChartData_(userId, days) {
  const totalDays = Math.max(1, Number(days || 7));
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - (totalDays - 1));

  const logs = mealGetMealLogsByUserInRange_(userId, startDate, endDate);
  const byDate = {};
  const nutritionByDate = {};
  logs.forEach(log => {
    const key = mealLogDateKey_(log);
    if (!byDate[key]) {
      byDate[key] = { 朝: 0, 昼: 0, 夜: 0, その他: 0 };
      nutritionByDate[key] = { protein: 0, fat: 0, carb: 0, count: 0, withPfc: 0 };
    }
    byDate[key][mealSanitizeMealType_(log.meal)] += Number(log.kcal || 0);
    const n = nutritionByDate[key];
    n.protein += Number(log.protein || 0);
    n.fat += Number(log.fat || 0);
    n.carb += Number(log.carb || 0);
    n.count += 1;
    if (log.protein != null || log.fat != null || log.carb != null) n.withPfc += 1;
  });

  const items = [];
  for (let index = 0; index < totalDays; index += 1) {
    const current = new Date(startDate);
    current.setDate(startDate.getDate() + index);
    const key = mealFormatDateKey_(current);
    const mealTotals = byDate[key] || { 朝: 0, 昼: 0, 夜: 0, その他: 0 };
    const total = mealTotals.朝 + mealTotals.昼 + mealTotals.夜 + mealTotals.その他;
    const n = nutritionByDate[key] || { protein: 0, fat: 0, carb: 0, count: 0, withPfc: 0 };
    items.push({
      dateKey: key,
      label: Utilities.formatDate(current, MEAL_APP_TIMEZONE, 'M/d'),
      meals: mealTotals,
      total: Math.round(total * 10) / 10,
      count: n.count,
      // PFC は、入れた品がある日だけ（入れていない日を 0g と見せないため）
      nutrition: n.withPfc ? {
        protein: Math.round(n.protein * 10) / 10,
        fat: Math.round(n.fat * 10) / 10,
        carb: Math.round(n.carb * 10) / 10,
      } : null,
    });
  }

  return items;
}

// その人のよく食べるものを、多い順に limit 件まで返す（回数・ふだんのカロリーつき）
function mealGetPopularMenusByUser_(userId, limit) {
  const grouped = {};
  mealGetMealLogsByUser_(userId).forEach(log => {
    const key = mealBuildMealLogGroupingKey_(log);
    const master = log.masterKey ? mealGetNutritionMaster_(log.masterKey) : null;
    if (!grouped[key]) {
      grouped[key] = {
        groupKey: key,
        menu: log.menu,
        displayName: mealBuildMealLogDisplayName_(log),
        masterKey: String(log.masterKey || ''),
        flavor: String((master && master.flavor) || log.flavor || ''),
        unit: String((master && master.unit) || log.unit || ''),
        note: String((master && master.note) || log.note || ''),
        kcal: mealToNullableNumber_((master && master.kcal) != null ? master.kcal : log.kcal),
        protein: mealToNullableNumber_((master && master.protein) != null ? master.protein : log.protein),
        fat: mealToNullableNumber_((master && master.fat) != null ? master.fat : log.fat),
        carb: mealToNullableNumber_((master && master.carb) != null ? master.carb : log.carb),
        salt: mealToNullableNumber_((master && master.salt) != null ? master.salt : log.salt),
        fiber: mealToNullableNumber_((master && master.fiber) != null ? master.fiber : log.fiber),
        count: 0,
        totalKcal: 0,
        lastMealDate: log.mealDate,
      };
    }
    grouped[key].count += 1;
    grouped[key].totalKcal += Number(log.kcal || 0);
    if (new Date(log.mealDate) > new Date(grouped[key].lastMealDate)) {
      grouped[key].lastMealDate = log.mealDate;
    }
  });

  return Object.keys(grouped)
    .map(key => grouped[key])
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return new Date(right.lastMealDate) - new Date(left.lastMealDate);
    })
    .slice(0, limit || 5)
    .map(item => ({
      groupKey: item.groupKey,
      menu: item.menu,
      displayName: item.displayName,
      masterKey: item.masterKey,
      flavor: item.flavor,
      unit: item.unit,
      note: item.note,
      kcal: item.kcal,
      protein: item.protein,
      fat: item.fat,
      carb: item.carb,
      salt: item.salt,
      fiber: item.fiber,
      count: item.count,
      averageKcal: item.count ? Math.round((item.totalKcal / item.count) * 10) / 10 : 0,
      lastMealDate: mealToIsoDateTime_(item.lastMealDate),
    }));
}

// よく食べるものの中から、まとめのキーで1つさがす（なければ null）
function mealFindPopularMenuByGroupKey_(userId, groupKey) {
  const normalizedKey = String(groupKey || '').trim();
  if (!normalizedKey) return null;
  return mealGetPopularMenusByUser_(userId, 20).find(item => String(item.groupKey || '') === normalizedKey) || null;
}

// 記録した日から、いま続いている日数といちばん長く続いた日数を返す
function mealGetUserStreakSummary_(userId) {
  const dateKeySet = new Set(mealGetMealLogsByUser_(userId).map(log => mealLogDateKey_(log)).filter(Boolean));
  const dateKeys = [...dateKeySet].sort();
  if (!dateKeys.length) {
    return {
      current: 0,
      longest: 0,
    };
  }

  let longest = 0;
  let run = 0;
  let previousDate = null;
  dateKeys.forEach(key => {
    const date = new Date(`${key}T00:00:00`);
    if (!previousDate) {
      run = 1;
    } else {
      const diffDays = Math.round((date - previousDate) / 86400000);
      run = diffDays === 1 ? run + 1 : 1;
    }
    longest = Math.max(longest, run);
    previousDate = date;
  });

  // いま続いている日数：きょうから数える。きょうがまだなら、きのうから
  const countBack = from => {
    let count = 0;
    for (let time = from.getTime(); dateKeySet.has(mealFormatDateKey_(new Date(time))); time -= 86400000) count += 1;
    return count;
  };
  const current = countBack(new Date()) || countBack(mealDateByPreset_('yesterday'));

  return {
    current: current,
    longest: longest,
  };
}

// 連続記録ランキング。ほかの人の LINE のユーザー ID は画面に返さない（自分かどうかだけ me で）
function mealGetStreakRanking_(limit, viewerUserId) {
  return mealListUsers_()
    .filter(user => user.status === 'active')
    .map(user => ({
      me: user.userId === viewerUserId,
      displayName: user.displayName || 'ユーザー',
      pictureUrl: String(user.pictureUrl || ''),
      streak: mealGetUserStreakSummary_(user.userId).current,
    }))
    .filter(item => item.streak > 0)
    .sort((left, right) => {
      if (right.streak !== left.streak) return right.streak - left.streak;
      return String(left.displayName).localeCompare(String(right.displayName), 'ja');
    })
    .slice(0, limit || 10);
}

// 同じ品をまとめるためのキー（出す名前をくらべる形にしたもの）
function mealBuildMealLogGroupingKey_(log) {
  return mealNormalizeText_(mealBuildMealLogDisplayName_(log));
}

// 記録の出す名前（MYメニューにつながっていれば、その名前）
function mealBuildMealLogDisplayName_(log) {
  const master = log && log.masterKey ? mealGetNutritionMaster_(log.masterKey) : null;
  if (master) {
    return mealBuildNutritionDisplayName_(master);
  }
  return String(log && log.menu || '').trim();
}

// トークに送られた文字1つを処理する：しょくじの文字・目標・数だけ・名前（MYメニュー → 前の記録 → 未記入）の順に見て、結果（kind つき）を返す
function mealHandleMealMessageFlow_(userId, text, displayName, source, pictureUrl) {
  mealEnsureProjectSetup_();
  const inputText = String(text || '').trim();
  if (!userId) {
    throw new Error('userId is required');
  }
  if (!inputText) {
    throw new Error('text is required');
  }

  const user = mealEnsureUserExists_(userId, displayName, pictureUrl);
  mealEnsureUserCanUseService_(user); // 使える人かは、くらぶボットの決まり（ここに来るのは使える人だけ）

  // しょくじ（ShoQuji）から、カードと一緒に送られた記録用の文字（3_usecase.shoquji.gs）
  if (mealIsShoqujiText_(inputText)) {
    return mealHandleShoqujiText_(userId, inputText);
  }

  if (mealIsSetTargetCommand_(inputText)) {
    return {
      kind: 'target_updated',
      headline: mealHandleSetTargetCommand_(userId, inputText),
      dashboard: mealGetDashboardData_(userId),
    };
  }

  const pendingKcalContext = mealParsePendingKcalInputContext_(inputText);
  if (pendingKcalContext) {
    return mealHandleStandaloneKcalInput_(userId, pendingKcalContext, source);
  }

  const parsed = mealParseMealText_(inputText);
  const exact = mealFindExactNutritionMaster_(parsed.menu);

  if (exact) {
    const record = mealLogMealFromMaster_(userId, parsed, exact, {
      source: source || MEAL_SOURCE.TEXT,
      mealDate: parsed.mealDate,
    });
    return {
      kind: 'logged',
      parsed: parsed,
      record: record,
      dashboard: mealGetDashboardData_(userId),
    };
  }

  // MYメニューにはないが、前にカロリーを入れて記録した品（よく記録するもののボタンで送られてくる）：前と同じ数字で
  const previous = mealFindPreviousLogWithKcal_(userId, parsed.menu);
  if (previous) {
    const record = mealLogMealWithNutrition_(userId, parsed, Object.assign(mealPickNutrition_(previous), {
      flavor: previous.flavor,
      unit: previous.unit,
      note: previous.note,
    }), {
      source: source || MEAL_SOURCE.TEXT,
      mealDate: parsed.mealDate,
      kcalStatus: previous.kcalStatus === MEAL_KCAL_STATUS.ESTIMATED ? MEAL_KCAL_STATUS.ESTIMATED : MEAL_KCAL_STATUS.EXACT,
    });
    return {
      kind: 'logged',
      parsed: parsed,
      record: record,
      dashboard: mealGetDashboardData_(userId),
    };
  }

  const pendingRecord = mealLogMealWithNutrition_(userId, parsed, mealEmptyNutrition_(), {
    source: source || MEAL_SOURCE.TEXT,
    mealDate: parsed.mealDate,
    kcalStatus: MEAL_KCAL_STATUS.PENDING,
  });

  return {
    kind: 'needs_liff',
    parsed: Object.assign({}, parsed, {
      logId: String(pendingRecord.logId || ''),
      row: Number(pendingRecord.row || 0),
    }),
    record: pendingRecord,
    draft: mealBuildNutritionDraft_(parsed.menu),
    dashboard: mealGetDashboardData_(userId),
  };
}

// その人が前に同じ名前で、カロリーを入れて記録したもの（いちばん新しいもの）
function mealFindPreviousLogWithKcal_(userId, menu) {
  const key = mealNormalizeText_(menu);
  if (!key) return null;
  return mealGetMealLogsByUser_(userId)
    .filter(log => log.kcal != null && (mealNormalizeText_(log.menu) === key || mealNormalizeText_(mealBuildMealLogDisplayName_(log)) === key))
    .sort(mealCompareMealLogDisplayTimeDesc_)[0] || null;
}

// 数だけ送られたとき：未記入が1件ならそこに入れ、いくつかあればどれに入れるかを聞く結果を返す
function mealHandleStandaloneKcalInput_(userId, input, source) {
  const context = typeof input === 'object' && input
    ? input
    : { kcal: input, datePreset: 'today', meal: '' };
  const kcal = mealToNullableNumber_(context.kcal);
  if (kcal == null) {
    return {
      kind: 'plain_text',
      text: 'カロリーの数字を読み取れませんでした。',
      dashboard: mealGetDashboardData_(userId),
    };
  }

  const pendingLogs = mealGetPendingMealLogsByUser_(userId);
  if (!pendingLogs.length) {
    return {
      kind: 'plain_text',
      text: 'カロリーがまだの品がないので、数字だけでは記録できません。「カレー 700」のように名前と一緒に送ってね。',
      dashboard: mealGetDashboardData_(userId),
    };
  }

  // 食事・日付を書いたときはそれだけ。書いていないときは、きょうの未記入 → なければきのうの未記入（日付をまたいだあと）
  const onDay = preset => {
    const key = mealResolveMealDateByPreset_(preset);
    return pendingLogs.filter(log => mealLogDateKey_(log) === key && (!context.meal || mealSanitizeMealType_(log.meal) === context.meal));
  };
  const targetLogs = context.datePreset
    ? onDay(context.datePreset)
    : (onDay('today').length ? onDay('today') : onDay('yesterday'));

  if (!targetLogs.length) {
    const scopeLabel = [context.datePreset === 'yesterday' ? '昨日' : context.datePreset === 'today' ? '今日' : '', context.meal || '']
      .filter(Boolean)
      .join(' ');
    return {
      kind: 'plain_text',
      text: scopeLabel
        ? `${scopeLabel} の未記入が見つかりません。`
        : 'きょう・きのうにカロリーがまだの品がないので、数字だけでは記録できません。「カレー 700」のように名前と一緒に送ってね。',
      dashboard: mealGetDashboardData_(userId),
    };
  }

  if (targetLogs.length === 1) {
    const result = mealApplyPendingKcalInput_(userId, {
      logId: targetLogs[0].logId,
      row: targetLogs[0].row,
      kcal: kcal,
    }, source || MEAL_SOURCE.LINE);
    return {
      kind: 'logged',
      record: result.record,
      dashboard: result.dashboard,
      parsed: {
        meal: result.record.meal,
        menu: result.record.menu,
      },
    };
  }

  return {
    kind: 'pending_kcal_selection',
    kcal: kcal,
    pendingLogs: targetLogs.slice(0, 10),
    dashboard: mealGetDashboardData_(userId),
  };
}

// 使える人か確かめる（シートの用意・ユーザーの行も）。使えなければ「許可待ち」などで止める
function mealRequireActiveUser_(userId, displayName) {
  mealEnsureProjectSetup_();
  return mealEnsureUserCanUseService_(mealEnsureUserExists_(userId, displayName));
}

// 画面から届いた中身を、MYメニューに保存する形に
function mealNutritionMasterInput_(payload, name, masterKey, source) {
  return {
    masterKey: masterKey || '',
    name: name,
    flavor: payload.flavor,
    kcal: payload.kcal,
    protein: payload.protein,
    fat: payload.fat,
    carb: payload.carb,
    salt: payload.salt,
    fiber: payload.fiber,
    unit: payload.unit,
    note: payload.note,
    status: 'active',
    source: source || MEAL_SOURCE.LIFF,
  };
}

// 記録・直すときの MYメニュー：saveToMaster なら保存する（選んだ MYメニューと名前・種類・量が同じなら、そのメニューを上書き）。
// reusedMasterKey：保存しないときも、どの MYメニューの記録かは残す（よく記録するものの数え方がそろう）
function mealSaveMasterFromInput_(menu, payload, source) {
  const shouldSaveMaster = payload.saveToMaster == null ? true : mealToBoolean_(payload.saveToMaster);
  const existingMaster = payload.masterKey ? mealGetNutritionMaster_(payload.masterKey) : null;
  const reusedMasterKey = existingMaster && mealIsSameNutritionKey_(existingMaster, menu, payload.flavor, payload.unit)
    ? String(payload.masterKey)
    : '';
  return {
    savedMaster: shouldSaveMaster ? mealSaveNutritionMaster_(mealNutritionMasterInput_(payload, menu, reusedMasterKey, source)) : null,
    reusedMasterKey: reusedMasterKey,
  };
}

// しょくじから1品を記録する（数があればその数で。MYメニューにも保存できる）
function mealSubmitMealDetail_(userId, payload, source) {
  mealRequireActiveUser_(userId, payload.displayName);

  const parsed = {
    meal: mealSanitizeMealType_(payload.meal),
    menu: String(payload.menu || '').trim(),
  };
  if (!parsed.menu) {
    throw mealUserError_('食べたものを入れてね。');
  }
  if (mealToNullableNumber_(payload.kcal) == null) {
    throw mealUserError_('カロリーを入れてね。');
  }

  const { savedMaster, reusedMasterKey } = mealSaveMasterFromInput_(parsed.menu, payload, source);

  const record = savedMaster
    ? mealLogMealFromMaster_(userId, parsed, savedMaster, {
        source: source || MEAL_SOURCE.LIFF,
        mealDate: payload.mealDate,
      })
    : mealLogMealWithNutrition_(userId, parsed, {
        kcal: payload.kcal,
        protein: payload.protein,
        fat: payload.fat,
        carb: payload.carb,
        salt: payload.salt,
        fiber: payload.fiber,
        // MYメニューは保存しなおさないが、どの MYメニューの記録かは残す（よく記録するものの数え方がそろう）
        masterKey: reusedMasterKey,
        flavor: payload.flavor,
        unit: payload.unit,
        note: payload.note,
      }, {
        source: source || MEAL_SOURCE.LIFF,
        mealDate: payload.mealDate,
        kcalStatus: MEAL_KCAL_STATUS.EXACT,
      });

  return {
    record: record,
    savedMaster: savedMaster,
    dashboard: mealGetDashboardData_(userId),
    draft: mealBuildNutritionDraft_(parsed.menu),
  };
}

// 近い候補（MYメニュー）の数字で記録する。未記入の記録を指していれば、そこに入れる
function mealSubmitMealCandidate_(userId, payload, source) {
  mealRequireActiveUser_(userId, payload && payload.displayName);

  const masterKey = String(payload && payload.masterKey || '').trim();
  const master = masterKey ? mealGetNutritionMaster_(masterKey) : null;
  if (!master || !mealHasAnyNutritionValue_(master)) {
    throw new Error('candidate master is not available');
  }

  const parsed = {
    meal: mealSanitizeMealType_(payload && payload.meal),
    menu: String(master.name || payload && payload.menu || '').trim(),
  };
  if (!parsed.menu) {
    throw mealUserError_('食べたものを入れてね。');
  }

  const logId = String(payload && payload.logId || '').trim();
  const row = Number(payload && payload.row || 0);
  let record;
  if (logId || (Number.isFinite(row) && row >= 2)) {
    const currentLog = mealResolveMealLogReference_(logId || row);
    if (!currentLog || currentLog.userId !== userId) {
      throw new Error('candidate target log is not available');
    }
    record = Object.assign({}, currentLog, {
      mealDate: payload && payload.mealDate ? new Date(payload.mealDate) : currentLog.mealDate,
      meal: mealSanitizeMealType_(payload && payload.meal),
      menu: String(master.name || payload && payload.menu || '').trim(),
      kcal: mealToNullableNumber_(master.kcal),
      protein: mealToNullableNumber_(master.protein),
      fat: mealToNullableNumber_(master.fat),
      carb: mealToNullableNumber_(master.carb),
      salt: mealToNullableNumber_(master.salt),
      fiber: mealToNullableNumber_(master.fiber),
      kcalStatus: MEAL_KCAL_STATUS.EXACT,
      masterKey: master.masterKey,
      flavor: String(master.flavor || ''),
      unit: String(master.unit || ''),
      note: String(master.note || ''),
      source: source || MEAL_SOURCE.LINE,
      updatedAt: new Date(),
    });
    mealUpdateMealLog_(record);
  } else {
    record = mealLogMealFromMaster_(userId, parsed, master, {
      source: source || MEAL_SOURCE.LINE,
      mealDate: payload && payload.mealDate,
    });
  }

  return {
    parsed: parsed,
    record: record,
    dashboard: mealGetDashboardData_(userId),
  };
}

// 未記入の記録にカロリーを入れる（だいたいのときは印とメモも）
function mealApplyPendingKcalInput_(userId, payload, source) {
  mealRequireActiveUser_(userId, payload && payload.displayName);

  const logId = String(payload && payload.logId || '').trim();
  const row = Number(payload && payload.row || 0);
  const currentLog = mealResolveMealLogReference_(logId || row);
  if (!currentLog || currentLog.userId !== userId) {
    throw mealUserError_('未記入の記録が見つかりません。');
  }

  const kcal = mealToNullableNumber_(payload && payload.kcal);
  if (kcal == null) {
    throw mealUserError_('カロリーを入れてね。');
  }

  // だいたい（ご飯◯杯分）で入れたときは「概算」として残し、メモに何杯分かを書く
  const estimated = mealToBoolean_(payload && payload.estimated);
  const estimateNote = mealClampText_(payload && payload.note, MEAL_TEXT_LIMIT.name);
  const updatedLog = Object.assign({}, currentLog, {
    kcal: kcal,
    kcalStatus: estimated ? MEAL_KCAL_STATUS.ESTIMATED : MEAL_KCAL_STATUS.EXACT,
    note: estimated && estimateNote
      ? mealClampText_([String(currentLog.note || '').trim(), `${estimateNote}（概算）`].filter(Boolean).join(' / '), MEAL_TEXT_LIMIT.note)
      : currentLog.note,
    source: source || MEAL_SOURCE.LINE,
    updatedAt: new Date(),
  });
  mealUpdateMealLog_(updatedLog);

  return {
    record: updatedLog,
    dashboard: mealGetDashboardData_(userId),
  };
}

// 記録の名前と数字を、MYメニューに保存して記録とつなぐ
function mealSavePendingLogAsMaster_(userId, payload, source) {
  mealRequireActiveUser_(userId, payload && payload.displayName);

  const logId = String(payload && payload.logId || '').trim();
  const row = Number(payload && payload.row || 0);
  const currentLog = mealResolveMealLogReference_(logId || row);
  if (!currentLog || currentLog.userId !== userId) {
    throw mealUserError_('対象の記録が見つかりません。');
  }
  if (mealToNullableNumber_(currentLog.kcal) == null) {
    throw mealUserError_('カロリーが未入力のため、MYメニューに保存できません。');
  }

  const savedMaster = mealSaveNutritionMaster_({
    masterKey: currentLog.masterKey || '',
    name: currentLog.menu,
    flavor: currentLog.flavor,
    kcal: currentLog.kcal,
    protein: currentLog.protein,
    fat: currentLog.fat,
    carb: currentLog.carb,
    salt: currentLog.salt,
    fiber: currentLog.fiber,
    unit: currentLog.unit,
    note: currentLog.note,
    status: 'active',
    source: source || MEAL_SOURCE.LINE,
  });

  const updatedLog = Object.assign({}, currentLog, {
    masterKey: savedMaster.masterKey,
    flavor: String(savedMaster.flavor || ''),
    unit: String(savedMaster.unit || ''),
    note: String(savedMaster.note || ''),
    updatedAt: new Date(),
  });
  mealUpdateMealLog_(updatedLog);

  return {
    record: updatedLog,
    savedMaster: savedMaster,
    dashboard: mealGetDashboardData_(userId),
  };
}

// 入力の画面を開いたときに、名前から近い候補と先に入れておく数字を返す
function mealGetMealDraftState_(payload) {
  const menu = String(payload && payload.menu || '').trim();
  const meal = mealSanitizeMealType_(payload && payload.meal);
  const mealDate = String(payload && payload.mealDate || '').trim();
  const datePreset = String(payload && payload.datePreset || mealInferDatePresetFromMealDate_(mealDate) || 'today').trim();
  const draft = menu ? mealBuildNutritionDraft_(menu) : {
    menu: '',
    prefill: {
      hasSuggestion: false,
      masterKey: '',
      masterName: '',
      score: 0,
      scorePercent: 0,
      nutrition: mealEmptyNutrition_(),
      flavor: '',
      unit: '',
      note: '',
    },
    candidates: [],
  };

  return {
    meal: meal,
    menu: menu,
    mealDate: mealDate,
    datePreset: datePreset,
    prefill: mealSerializeDraftPrefill_(draft.prefill),
    candidates: draft.candidates.map(mealSerializeNutritionCandidate_),
  };
}

// MYメニューを言葉でさがして、画面に出す形で返す
function mealSearchNutritionMasterRecords_(query, limit) {
  const keyword = String(query || '').trim();
  if (!keyword) return [];
  return mealFindNutritionCandidates_(keyword, limit || 12).map(mealSerializeNutritionCandidate_);
}

// MYメニューだけを保存する（記録は作らない）
function mealSaveNutritionMasterOnly_(userId, payload, source) {
  mealRequireActiveUser_(userId, payload && payload.displayName);

  const menu = String(payload && payload.menu || '').trim();
  if (!menu) {
    throw mealUserError_('食べたものを入れてね。');
  }
  if (mealToNullableNumber_(payload && payload.kcal) == null) {
    throw mealUserError_('カロリーを入れてね。');
  }

  const savedMaster = mealSaveNutritionMaster_(mealNutritionMasterInput_(payload, menu, payload.masterKey, source));

  return {
    savedMaster: savedMaster,
    dashboard: mealGetDashboardData_(userId),
    draft: mealGetMealDraftState_({
      meal: payload && payload.meal,
      menu: savedMaster.name,
      mealDate: payload && payload.mealDate,
      datePreset: payload && payload.datePreset,
    }),
  };
}

// その人の記録を直す（日付・食事・名前・数字。MYメニューにも保存できる）
function mealUpdateMealLogDetail_(userId, payload, source) {
  mealRequireActiveUser_(userId, payload && payload.displayName);

  const logId = String(payload && payload.logId || '').trim();
  const row = Number(payload && payload.row || 0);
  const currentLog = mealResolveMealLogReference_(logId || row);
  if (!currentLog || currentLog.userId !== userId) {
    throw mealUserError_('直す記録が見つかりません（消したかもしれません）。');
  }

  const parsed = {
    meal: mealSanitizeMealType_(payload.meal),
    menu: String(payload.menu || '').trim(),
  };
  if (!parsed.menu) {
    throw mealUserError_('食べたものを入れてね。');
  }
  const noKcal = mealToNullableNumber_(payload.kcal) == null;
  if (noKcal && !payload.allowPending) {
    throw mealUserError_('カロリーを入れてね。');
  }

  // カロリーがないまま直すとき（しょくじの自分の記録）は、MYメニューには触らない
  const { savedMaster, reusedMasterKey } = noKcal ? { savedMaster: null, reusedMasterKey: currentLog.masterKey || '' } : mealSaveMasterFromInput_(parsed.menu, payload, source);

  const updatedLog = Object.assign({}, currentLog, {
    mealDate: payload.mealDate ? new Date(payload.mealDate) : currentLog.mealDate,
    meal: mealSanitizeMealType_(parsed.meal),
    menu: parsed.menu,
    kcal: mealToNullableNumber_(savedMaster ? savedMaster.kcal : payload.kcal),
    protein: mealToNullableNumber_(savedMaster ? savedMaster.protein : payload.protein),
    fat: mealToNullableNumber_(savedMaster ? savedMaster.fat : payload.fat),
    carb: mealToNullableNumber_(savedMaster ? savedMaster.carb : payload.carb),
    salt: mealToNullableNumber_(savedMaster ? savedMaster.salt : payload.salt),
    fiber: mealToNullableNumber_(savedMaster ? savedMaster.fiber : payload.fiber),
    kcalStatus: savedMaster ? (mealHasAnyNutritionValue_(savedMaster) ? MEAL_KCAL_STATUS.EXACT : MEAL_KCAL_STATUS.PENDING) : noKcal ? MEAL_KCAL_STATUS.PENDING : MEAL_KCAL_STATUS.EXACT,
    masterKey: savedMaster ? savedMaster.masterKey : reusedMasterKey,
    flavor: String(savedMaster ? savedMaster.flavor : (payload.flavor || '')),
    unit: String(savedMaster ? savedMaster.unit : (payload.unit || '')),
    note: String(savedMaster ? savedMaster.note : (payload.note || '')),
    source: source || MEAL_SOURCE.LIFF,
    updatedAt: new Date(),
  });
  mealUpdateMealLog_(updatedLog);

  return {
    record: updatedLog,
    savedMaster: savedMaster,
    dashboard: mealGetDashboardData_(userId),
    draft: mealBuildNutritionDraft_(parsed.menu),
  };
}

// その人の記録を消す（ほかの人の記録は消さない）
function mealDeleteMealLogDetail_(userId, ref) {
  mealRequireActiveUser_(userId);

  const currentLog = mealResolveMealLogReference_(ref);
  if (!currentLog || currentLog.userId !== userId) {
    throw mealUserError_('消す記録が見つかりません（もう消えているかもしれません）。');
  }

  mealDeleteMealLog_(currentLog.logId || currentLog.row);
  return {
    ok: true,
    dashboard: mealGetDashboardData_(userId),
  };
}

// 送られた写真をドライブに置き、送った時刻の食事（朝・昼・夜）の記録に付ける。その食事の記録がいくつかあれば、えらぶための印を返す
function mealAttachMealImageToNearestLog_(userId, payload) {
  mealRequireActiveUser_(userId, payload && payload.displayName);

  const messageId = String(payload && payload.messageId || '').trim();
  if (!messageId) {
    throw new Error('messageId is required');
  }

  const eventDate = payload && payload.timestamp ? new Date(Number(payload.timestamp)) : new Date();
  const mealType = mealInferMealType_(eventDate);
  const imageBlob = mealFetchLineMessageContentBlob_(messageId);
  const fileInfo = mealSaveLineImageToDrive_(
    imageBlob,
    mealBuildMealImageFileName_(userId, eventDate, messageId, imageBlob.getContentType())
  );

  const sameDayLogs = mealGetMealLogsByUserAndDate_(userId, eventDate)
    .filter(log => mealSanitizeMealType_(log.meal) === mealType)
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || right.mealDate) - new Date(left.updatedAt || left.createdAt || left.mealDate));

  if (sameDayLogs.length > 1) {
    const selectionToken = mealCachePendingImageAttachment_({
      userId: userId,
      mealType: mealType,
      fileId: fileInfo.fileId,
      imageUrl: fileInfo.url,
      candidateLogIds: sameDayLogs.map(log => String(log.logId || '')),
      candidateRows: sameDayLogs.map(log => Number(log.row || 0)),
    });
    return {
      file: fileInfo,
      mealType: mealType,
      selectionToken: selectionToken,
      candidateLogs: sameDayLogs.map(mealSerializeMealLog_),
      linkedLog: null,
      dashboard: mealGetDashboardData_(userId),
    };
  }

  const linkedLog = sameDayLogs[0]
    ? mealAttachMealLogImage_(sameDayLogs[0].logId || sameDayLogs[0].row, fileInfo.fileId, fileInfo.url)
    : null;

  return {
    file: fileInfo,
    mealType: mealType,
    linkedLog: linkedLog,
    dashboard: mealGetDashboardData_(userId),
  };
}

// えらばれた記録に、置いておいた写真を付ける（印は1回だけ・期限つき）
function mealAttachMealImageBySelection_(userId, payload) {
  mealRequireActiveUser_(userId, payload && payload.displayName);

  const token = String(payload && payload.selectionToken || '').trim();
  const logId = String(payload && payload.logId || '').trim();
  const row = Number(payload && payload.row || 0);
  if (!token || (!logId && row < 2)) {
    throw new Error('image selection is invalid');
  }

  const pending = mealTakePendingImageAttachment_(token);
  if (!pending || String(pending.userId || '') !== userId) {
    throw new Error('image selection is expired');
  }

  const candidateLogIds = Array.isArray(pending.candidateLogIds) ? pending.candidateLogIds.map(String) : [];
  const candidateRows = Array.isArray(pending.candidateRows) ? pending.candidateRows.map(Number) : [];
  if (logId ? !candidateLogIds.includes(logId) : !candidateRows.includes(row)) {
    throw new Error('selected log is not available');
  }

  const targetLog = mealResolveMealLogReference_(logId || row);
  if (!targetLog || targetLog.userId !== userId) {
    throw new Error('selected log is not found');
  }

  const linkedLog = mealAttachMealLogImage_(targetLog.logId || row, pending.fileId, pending.imageUrl);
  return {
    mealType: String(pending.mealType || ''),
    linkedLog: linkedLog,
    dashboard: mealGetDashboardData_(userId),
  };
}

// 写真のファイル名を作る（日時・人・メッセージの一部・拡張子）
function mealBuildMealImageFileName_(userId, date, messageId, contentType) {
  const extension = mealGuessImageExtension_(contentType);
  const timestamp = Utilities.formatDate(date, MEAL_APP_TIMEZONE, 'yyyyMMdd-HHmmss');
  return `meal-image-${timestamp}-${String(userId || '').slice(-6)}-${String(messageId || '').slice(-8)}.${extension}`;
}

// 写真の種類（content-type）から拡張子を決める（わからなければ jpg）
function mealGuessImageExtension_(contentType) {
  const mime = String(contentType || '').toLowerCase();
  if (mime.indexOf('png') !== -1) return 'png';
  if (mime.indexOf('gif') !== -1) return 'gif';
  if (mime.indexOf('webp') !== -1) return 'webp';
  return 'jpg';
}

// 日付がきのうなら "yesterday"、ほかは "today"
function mealInferDatePresetFromMealDate_(mealDate) {
  if (!mealDate) return 'today';
  const yesterday = mealResolveMealDateByPreset_('yesterday');
  return String(mealDate).slice(0, 10) === yesterday ? 'yesterday' : 'today';
}

// 先に入れておく数字を、画面に渡す形にする
function mealSerializeDraftPrefill_(prefill) {
  return {
    hasSuggestion: Boolean(prefill && prefill.hasSuggestion),
    masterKey: String(prefill && prefill.masterKey || ''),
    masterName: String(prefill && prefill.masterName || ''),
    score: Number(prefill && prefill.score || 0),
    scorePercent: Number(prefill && prefill.scorePercent || 0),
    flavor: String(prefill && prefill.flavor || ''),
    unit: String(prefill && prefill.unit || ''),
    note: String(prefill && prefill.note || ''),
    nutrition: Object.assign({}, mealEmptyNutrition_(), prefill && prefill.nutrition),
  };
}

// 近い候補（MYメニュー）を、画面に渡す形にする
function mealSerializeNutritionCandidate_(candidate) {
  const menu = String(candidate.menu || candidate.baseName || candidate.rawName || candidate.name || '');
  const flavor = String(candidate.flavor || '');
  const unit = String(candidate.unit || '');
  return {
    masterKey: candidate.masterKey,
    menu: menu,
    name: String(candidate.displayName || mealBuildNutritionDisplayName_({ name: menu, flavor: flavor, unit: unit })),
    kcal: candidate.kcal,
    protein: candidate.protein,
    fat: candidate.fat,
    carb: candidate.carb,
    salt: candidate.salt,
    fiber: candidate.fiber,
    flavor: flavor,
    unit: unit,
    note: candidate.note,
    status: candidate.status,
    score: candidate.score,
    scorePercent: candidate.scorePercent,
  };
}

// 記録を、画面・カードに渡す形にする（MYメニューの名前・日付の文字つき）
function mealSerializeMealLog_(log) {
  const master = log.masterKey ? mealGetNutritionMaster_(log.masterKey) : null;
  return {
    logId: String(log.logId || ''),
    row: Number(log.row || 0),
    mealDate: mealToIsoDateTime_(log.mealDate),
    userId: log.userId,
    meal: log.meal,
    menu: log.menu,
    kcal: log.kcal,
    protein: log.protein,
    fat: log.fat,
    carb: log.carb,
    salt: log.salt,
    fiber: log.fiber,
    kcalStatus: log.kcalStatus,
    masterKey: log.masterKey,
    flavor: String(log.flavor || (master ? master.flavor : '') || ''),
    unit: String(log.unit || (master ? master.unit : '') || ''),
    note: String(log.note || (master ? master.note : '') || ''),
    source: log.source,
    clientId: String(log.clientId || ''),
    imageFileId: String(log.imageFileId || ''),
    imageUrl: String(log.imageUrl || ''),
    createdAt: mealToIsoDateTime_(log.createdAt),
    updatedAt: mealToIsoDateTime_(log.updatedAt),
  };
}
