/**
 * 61_meal_liff.gs：しょくじ（LIFF）からの呼び出し：action ごとの処理（MEAL_LIFF_API_ACTIONS。食事記録ボットの 07_web.liff.gs から）
 * くらぶボットのツールの受け口（03_tool_api.gs）が、ID トークンを LINE に確かめ、つないだボットの人で使える人だけを、
 * 61_meal.gs の tool から渡す（本人は mealUseCaller_ で決める。送られてきた userId は使わない）。
 * action の名前はしょくじが使うので変えない。前の画面用（getHeaderState・searchNutritionMaster）と、
 * 画面からのリッチメニュー作り（setupMainRichMenu・よく記録のメニュー）はやめた（メニューはくらぶボットのタブ。08_richmenu.gs）
 */

// 画面（LIFF）から呼ぶ action と、その処理
const MEAL_LIFF_API_ACTIONS = {
  getLiffAppState: request => mealGetLiffAppState_(request),
  saveNutritionMasterOnly: request => mealSaveNutritionMasterOnlyFromLiff_(request),
  submitMealDetail: request => mealSubmitMealDetailFromLiff_(request),
  updateProfile: request => mealUpdateLiffUserProfile_(request),
  updateMealLog: request => mealUpdateMealLogFromLiff_(request),
  deleteMealLog: request => mealDeleteMealLogFromLiff_(request),
  submitMealBatch: request => mealSubmitMealBatchFromLiff_(request),
  // しょくじ（LINE 版）が、ボットで入れた記録も出すために読む
  listMealLogs: request => mealListMealLogsFromLiff_(request),
};

// しょくじの記録の id（clientId）から、その人のボットの記録の logId
function mealLogIdOfClient_(userId, clientId) {
  const id = String(clientId || '');
  if (!/^[a-z0-9]{1,40}$/i.test(id)) return '';
  const log = mealGetMealLogsByUser_(userId).find(item => item.clientId === id);
  return log ? String(log.logId || '') : '';
}

// 画面から呼ばれたときの本人（使える人かは、くらぶボットの受け口が確かめずみ）
function mealRequireLiffCaller_(payload) {
  return mealRequireLiffIdentity_(payload);
}

// その人の、from〜to（yyyy-MM-dd。62日まで）の記録。しょくじに出すのに要るものだけ返す
const MEAL_LIST_MEAL_LOGS_MAX_DAYS = 62;
const MEAL_LIST_MEAL_LOGS_MAX = 1000;
// listMealLogs：その人の from〜to の記録を返す（しょくじが、ボットで入れた記録も出すため。全部返せたかも）
function mealListMealLogsFromLiff_(payload) {
  mealEnsureProjectSetup_();
  const identity = mealRequireLiffCaller_(payload);
  const user = mealEnsureUserExists_(identity.userId, identity.displayName);
  mealEnsureUserCanUseService_(user);
  const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(new Date(`${value}T12:00:00+09:00`).getTime());
  const to = isDay(payload.to) ? String(payload.to) : mealFormatDateKey_(new Date());
  let from = isDay(payload.from) ? String(payload.from) : to;
  const earliest = mealFormatDateKey_(new Date(new Date(`${to}T12:00:00+09:00`).getTime() - (MEAL_LIST_MEAL_LOGS_MAX_DAYS - 1) * 86400000));
  if (from < earliest) from = earliest;
  if (from > to) throw mealUserError_('日付の範囲がちがいます');
  const inRange = mealGetMealLogsByUser_(identity.userId)
    .filter(log => {
      const key = mealLogDateKey_(log);
      return key >= from && key <= to;
    });
  const logs = inRange
    .slice(-MEAL_LIST_MEAL_LOGS_MAX)
    .map(log => ({
      logId: String(log.logId || ''),
      clientId: String(log.clientId || ''),
      date: mealLogDateKey_(log),
      meal: mealSanitizeMealType_(log.meal),
      menu: String(log.menu || ''),
      kcal: log.kcal,
      protein: log.protein,
      fat: log.fat,
      carb: log.carb,
      kcalStatus: log.kcalStatus,
      source: log.source,
      // 最後に直した時刻（ミリ秒）。しょくじが自分の記録とくらべて、あとから直したほうにそろえる
      updatedAt: new Date(log.updatedAt || log.createdAt || 0).getTime() || 0,
    }));
  return {
    ok: true,
    identity: mealSerializeIdentityState_(identity),
    permission: mealSerializeUserPermission_(user),
    from: from,
    to: to,
    // 期間の記録を全部返したか（多すぎて切ったときは false。しょくじは、ないものを「消えた」とみなさない）
    complete: inRange.length <= MEAL_LIST_MEAL_LOGS_MAX,
    logs: logs,
  };
}

// saveNutritionMasterOnly：MYメニューだけ保存する
function mealSaveNutritionMasterOnlyFromLiff_(payload) {
  mealEnsureProjectSetup_();
  const identity = mealRequireLiffCaller_(payload);

  const result = mealSaveNutritionMasterOnly_(identity.userId, Object.assign(mealPickMealInput_(payload), {
    displayName: identity.displayName,
    datePreset: payload.datePreset,
  }), MEAL_SOURCE.LIFF);

  return {
    ok: true,
    identity: mealSerializeIdentityState_(identity),
    permission: mealSerializeUserPermission_(mealGetUserById_(identity.userId)),
    dashboard: result.dashboard,
    draft: result.draft,
    savedMaster: mealSerializeNutritionCandidate_(Object.assign({ score: 1, scorePercent: 100 }, result.savedMaster)),
  };
}

// getLiffAppState：開いたときに読むもの（集計・MYメニュー・許可・よく記録のメニュー）を返す
function mealGetLiffAppState_(payload) {
  mealEnsureProjectSetup_();
  const identity = mealRequireLiffCaller_(payload);

  // 画面を開いたときの1回で、必要なものを全部返す（このあと検索やタブの切りかえで呼ばなくてよいように）
  const user = mealEnsureUserExists_(identity.userId, identity.displayName);
  const dashboard = mealGetDashboardData_(user.userId);
  const menu = mealClampText_(payload && payload.menu, MEAL_TEXT_LIMIT.name);
  return {
    ok: true,
    liffId: mealGetLiffId_(),
    identity: mealSerializeIdentityState_(identity),
    header: mealBuildHeaderFromDashboard_(dashboard),
    permission: mealSerializeUserPermission_(user),
    dashboard: dashboard,
    // MYメニューの一覧（画面の中で名前から探す）
    menus: mealGetMenuListForLiff_(),
    draft: menu ? mealGetMealDraftState_({
      meal: payload && payload.meal,
      menu: menu,
      mealDate: payload && payload.mealDate,
      datePreset: payload && payload.datePreset,
    }) : null,
  };
}

// 集計から、画面の上に出すもの（合計・未記入の数・目標まで）を作る
function mealBuildHeaderFromDashboard_(dashboard) {
  const user = dashboard.user || {};
  const today = dashboard.today || {};
  return {
    user: user,
    todayExact: Number(today.totalExact || 0),
    pendingCount: (today.pendingItems || []).length,
    targetDiff: dashboard.targetDiff,
    permission: mealSerializeUserPermission_(user),
  };
}

// まとめて記録（きのうと同じものを記録・しょくじの記録を取りこむ）。LINE への集計カードは最後に1回だけ
function mealSubmitMealBatchFromLiff_(payload) {
  mealEnsureProjectSetup_();
  const identity = mealRequireLiffCaller_(payload);
  const user = mealEnsureUserExists_(identity.userId, identity.displayName);
  mealEnsureUserCanUseService_(user);

  const source = payload.source === MEAL_SOURCE.SHOQUJI ? MEAL_SOURCE.SHOQUJI : MEAL_SOURCE.LIFF;
  const result = mealLogMealBatch_(identity.userId, payload.items, {
    source: source,
    dedupe: payload.dedupe == null ? true : mealToBoolean_(payload.dedupe),
  });
  const dashboard = mealGetDashboardData_(identity.userId);

  let summaryPushed = false;
  if (result.added.length && (payload.sendLineSummary == null || mealToBoolean_(payload.sendLineSummary))) {
    try {
      mealPushLineMessages_(identity.userId, mealBuildDailySummaryMessages_(identity.userId, {
        dashboard: dashboard,
        headline: source === MEAL_SOURCE.SHOQUJI
          ? `🍚 しょくじから ${result.added.length} 品を記録`
          : `${result.added.length} 品を記録`,
      }));
      summaryPushed = true;
    } catch (error) {
      summaryPushed = false;
    }
  }

  return {
    ok: true,
    identity: mealSerializeIdentityState_(identity),
    permission: mealSerializeUserPermission_(mealGetUserById_(identity.userId)),
    added: result.added.map(mealSerializeMealLog_),
    skipped: result.skipped,
    pending: result.pending,
    dashboard: dashboard,
    summaryPushed: summaryPushed,
  };
}

// submitMealDetail：1品を記録する（LINE にも集計カードを送るかは sendLineSummary）
function mealSubmitMealDetailFromLiff_(payload) {
  mealEnsureProjectSetup_();
  const identity = mealRequireLiffIdentity_(payload);

  const result = mealSubmitMealDetail_(identity.userId, Object.assign(mealPickMealInput_(payload), {
    displayName: identity.displayName,
    saveToMaster: payload.saveToMaster,
  }), MEAL_SOURCE.LIFF);

  const summaryPushed = mealPushRecordSummary_(identity.userId, payload, result);

  return {
    ok: true,
    identity: mealSerializeIdentityState_(identity),
    permission: mealSerializeUserPermission_(mealGetUserById_(identity.userId)),
    reply: mealBuildLogReply_(identity.userId, result.record),
    record: mealSerializeMealLog_(result.record),
    dashboard: result.dashboard,
    draft: mealBuildRecordDraft_(result.record, payload),
    summaryPushed: summaryPushed,
    savedMaster: mealSerializeNutritionCandidate_(Object.assign({ score: 1, scorePercent: 100 }, result.savedMaster)),
  };
}

// updateProfile：目標・お知らせ・よく記録するものの固定を、送られた項目だけ直す（よく記録のリッチメニューは作らない）
function mealUpdateLiffUserProfile_(payload) {
  mealEnsureProjectSetup_();
  const identity = mealRequireLiffCaller_(payload);

  const user = mealEnsureUserExists_(identity.userId, identity.displayName);
  mealEnsureUserCanUseService_(user);
  // 送られてきた項目だけ直す（よく記録するものの並べかえだけのときは、目標などを送らない）
  const patch = { displayName: identity.displayName };
  ['calorieTarget', 'goalType', 'notify', 'favorites'].forEach(key => {
    if (payload[key] !== undefined && payload[key] !== null && payload[key] !== '') patch[key] = payload[key];
  });
  mealUpdateUserProfile_(identity.userId, patch);

  return {
    ok: true,
    identity: mealSerializeIdentityState_(identity),
    permission: mealSerializeUserPermission_(mealGetUserById_(identity.userId)),
    dashboard: mealGetDashboardData_(identity.userId),
  };
}

// updateMealLog：その人の記録を直す（しょくじからは clientId でも指せる）
function mealUpdateMealLogFromLiff_(payload) {
  mealEnsureProjectSetup_();
  const identity = mealRequireLiffCaller_(payload);
  const fromShoquji = payload.source === MEAL_SOURCE.SHOQUJI;

  const result = mealUpdateMealLogDetail_(identity.userId, Object.assign(mealPickMealInput_(payload), {
    logId: fromShoquji && payload.clientId && !payload.logId ? mealLogIdOfClient_(identity.userId, payload.clientId) : payload.logId,
    row: payload.row,
    displayName: identity.displayName,
    saveToMaster: payload.saveToMaster,
    // しょくじで直した自分の記録は、カロリーがなくてもよい（しょくじと同じく「まだ」のまま）
    allowPending: fromShoquji && mealToBoolean_(payload.allowPending),
  }), fromShoquji ? MEAL_SOURCE.SHOQUJI : MEAL_SOURCE.LIFF);

  const summaryPushed = mealPushRecordSummary_(identity.userId, payload, result);

  return {
    ok: true,
    identity: mealSerializeIdentityState_(identity),
    permission: mealSerializeUserPermission_(mealGetUserById_(identity.userId)),
    reply: mealBuildLogReply_(identity.userId, result.record),
    record: mealSerializeMealLog_(result.record),
    dashboard: result.dashboard,
    draft: mealBuildRecordDraft_(result.record, payload),
    summaryPushed: summaryPushed,
  };
}

// deleteMealLog：その人の記録を消す（しょくじからは clientId でも指せる。もうなければ ok）
function mealDeleteMealLogFromLiff_(payload) {
  mealEnsureProjectSetup_();
  const identity = mealRequireLiffCaller_(payload);
  const fromShoquji = payload.source === MEAL_SOURCE.SHOQUJI;

  // しょくじが消した自分の記録（clientId）。ボットにないとき（まだ送っていない・もう消した）は、何もしないでよい
  if (fromShoquji && payload.clientId && !payload.logId) {
    const logId = mealLogIdOfClient_(identity.userId, payload.clientId);
    if (!logId) return { ok: true, identity: mealSerializeIdentityState_(identity), deleted: false };
    payload = Object.assign({}, payload, { logId: logId });
  }
  const result = mealDeleteMealLogDetail_(identity.userId, payload.logId || payload.row);
  return {
    ok: true,
    identity: mealSerializeIdentityState_(identity),
    permission: mealSerializeUserPermission_(mealGetUserById_(identity.userId)),
    dashboard: result.dashboard,
  };
}

// 本人（mealUseCaller_ で決めた人）。いなければ止める
function mealRequireLiffIdentity_() {
  const identity = mealVerifyLiffIdentity_();
  if (!identity.userId) {
    throw mealUserError_('LINE でアプリを開きなおしてください（本人確認ができませんでした）');
  }
  mealSetMasterViewer_(identity.userId); // MYメニューは、この人の分と共通だけ見る・書く
  return identity;
}

// 画面から届いた、1品の中身（名前・食事・日付・栄養・種類・量・メモ）。文字は長さの上限で切る
function mealPickMealInput_(payload) {
  return {
    meal: payload.meal,
    menu: mealClampText_(payload.menu, MEAL_TEXT_LIMIT.name),
    masterKey: mealClampText_(payload.masterKey, MEAL_TEXT_LIMIT.key),
    flavor: mealClampText_(payload.flavor, MEAL_TEXT_LIMIT.flavor),
    kcal: payload.kcal,
    protein: payload.protein,
    fat: payload.fat,
    carb: payload.carb,
    salt: payload.salt,
    fiber: payload.fiber,
    unit: mealClampText_(payload.unit, MEAL_TEXT_LIMIT.unit),
    note: mealClampText_(payload.note, MEAL_TEXT_LIMIT.note),
    mealDate: mealNormalizeMealDateInput_(payload.mealDate),
  };
}

// 日付は yyyy-MM-dd か、日時として読めるものだけ（読めなければ、きょう）
function mealNormalizeMealDateInput_(value) {
  const text = mealClampText_(value, 40);
  if (!text) return '';
  return Number.isNaN(new Date(text).getTime()) ? '' : text;
}

// 画面で記録・直したとき、LINE にも集計カードを送る（sendLineSummary が false のときは送らない）。送れたら true
function mealPushRecordSummary_(userId, payload, result) {
  if (!(payload.sendLineSummary == null || mealToBoolean_(payload.sendLineSummary))) return false;
  try {
    mealPushLineMessages_(userId, mealBuildDailySummaryMessages_(userId, {
      dashboard: result.dashboard,
      record: result.record,
      headline: `${mealBuildRecordDisplayName_(result.record)} を記録`,
    }));
    return true;
  } catch (error) {
    return false;
  }
}

// 記録した品について、入力の画面に出す近い候補と先に入れておく数字を作る
function mealBuildRecordDraft_(record, payload) {
  return mealGetMealDraftState_({
    meal: record.meal,
    menu: record.menu,
    mealDate: payload && payload.mealDate,
    datePreset: payload && payload.datePreset,
  });
}

// 確かめた本人（名前）を画面に渡す形にする。ボットから見た LINE の ID は渡さない（ツールからは別の番号に見える。03_tool_api.gs）
function mealSerializeIdentityState_(identity) {
  return {
    userId: '',
    displayName: String(identity && identity.displayName || ''),
    verified: Boolean(identity && identity.verified),
    verificationError: String(identity && identity.verificationError || ''),
  };
}

