/**
 * 61_meal_quick.gs：よく記録するもの・まとめて記録（食事記録ボットの 04_usecase.quick.gs から）。
 *
 * よく記録するもの（quickMenus）：固定した MYメニュー（users の favorites の順）→ 足りない分は記録の多い順。
 *   画面のボタン・LINE のカード・クイックリプライのどれも、この並びを使う。
 * まとめて記録（logMealBatch_）：きのうと同じものを記録する・しょくじの記録を取りこむ、を1回の呼び出しで。
 *   シートへの書きこみも1回にまとめる。
 */

const MEAL_QUICK_MENUS_LIMIT = 8;

// よく記録するもの：固定した品（並べた順）→ よく食べるもの（多い順）で、limit 件まで返す
function mealGetQuickMenus_(user, popularMenus, limit) {
  const max = limit || MEAL_QUICK_MENUS_LIMIT;
  const favorites = (user && user.favorites) || [];
  const popular = Array.isArray(popularMenus) ? popularMenus : [];
  const items = [];
  const usedKeys = {};
  const usedNames = {};

  favorites.forEach(masterKey => {
    if (items.length >= max) return;
    const master = mealGetNutritionMaster_(masterKey);
    if (!master) return;
    const displayName = mealBuildNutritionDisplayName_(master);
    const stat = popular.find(item => item.masterKey === masterKey) || {};
    items.push(mealSerializeQuickMenu_({
      masterKey: masterKey,
      menu: master.name,
      displayName: displayName,
      flavor: master.flavor,
      unit: master.unit,
      kcal: master.kcal,
      protein: master.protein,
      fat: master.fat,
      carb: master.carb,
      salt: master.salt,
      fiber: master.fiber,
      note: master.note,
      count: stat.count || 0,
      pinned: true,
    }));
    usedKeys[masterKey] = true;
    usedNames[mealNormalizeText_(displayName)] = true;
  });

  popular.forEach(item => {
    if (items.length >= max) return;
    if (item.masterKey && usedKeys[item.masterKey]) return;
    if (usedNames[mealNormalizeText_(item.displayName || item.menu)]) return;
    // カロリーが分からないもの（未記入のまま）は、押しても記録が終わらないので出さない
    if (mealToNullableNumber_(item.kcal) == null && !item.averageKcal) return;
    items.push(mealSerializeQuickMenu_(Object.assign({}, item, { pinned: false })));
  });

  return items;
}

// よく記録するものの1品を、画面・カードに渡す形にする
function mealSerializeQuickMenu_(item) {
  return {
    masterKey: String(item.masterKey || ''),
    menu: String(item.menu || ''),
    displayName: String(item.displayName || item.menu || ''),
    flavor: String(item.flavor || ''),
    unit: String(item.unit || ''),
    note: String(item.note || ''),
    kcal: mealToNullableNumber_(item.kcal != null ? item.kcal : item.averageKcal),
    protein: mealToNullableNumber_(item.protein),
    fat: mealToNullableNumber_(item.fat),
    carb: mealToNullableNumber_(item.carb),
    salt: mealToNullableNumber_(item.salt),
    fiber: mealToNullableNumber_(item.fiber),
    count: Number(item.count || 0),
    pinned: Boolean(item.pinned),
  };
}

/**
 * まとめて記録する。items：[{ meal, menu, mealDate: 'yyyy-MM-dd', masterKey, kcal, protein, fat, carb, salt, fiber, flavor, unit, note }]
 * - 数字があればその数字で、なければ MYメニュー（masterKey か、同じ名前）、それもなければカロリー未入力で記録する
 * - dedupe：同じ日・食事・名前・カロリーの記録がもうあれば飛ばす（同じものを2回送ったとき）
 * 戻り値：{ added: [記録], skipped: 件数, pending: 件数 }
 */
function mealLogMealBatch_(userId, items, options) {
  const config = options || {};
  const source = config.source || MEAL_SOURCE.LIFF;
  const list = (Array.isArray(items) ? items : []).slice(0, 30);
  const existing = config.dedupe ? mealGetMealLogsByUser_(userId) : [];
  const isSame = (log, item, dateKey, kcal) =>
    mealLogDateKey_(log) === dateKey &&
    log.meal === item.meal &&
    String(log.menu || '').trim() === item.menu &&
    Number(log.kcal || 0) === Number(kcal || 0);

  const records = [];
  let skipped = 0;
  // しょくじの記録の id（clientId）が同じものは、何度送られても1回だけ（送りなおしても二重にならない）
  const knownClientIds = new Set(mealGetMealLogsByUser_(userId).map(log => log.clientId).filter(Boolean));
  list.forEach(raw => {
    const clientId = /^[a-z0-9]{1,40}$/i.test(String(raw && raw.clientId || '')) ? String(raw.clientId) : '';
    if (clientId && knownClientIds.has(clientId)) {
      skipped += 1;
      return;
    }
    const item = {
      meal: mealSanitizeMealType_(raw && raw.meal),
      menu: mealClampText_(raw && raw.menu, MEAL_TEXT_LIMIT.name),
    };
    if (!item.menu) return;
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(raw.mealDate || '')) ? String(raw.mealDate) : mealFormatDateKey_(new Date());
    const nutrition = {
      kcal: mealToNullableNumber_(raw.kcal),
      protein: mealToNullableNumber_(raw.protein),
      fat: mealToNullableNumber_(raw.fat),
      carb: mealToNullableNumber_(raw.carb),
      salt: mealToNullableNumber_(raw.salt),
      fiber: mealToNullableNumber_(raw.fiber),
    };
    const master = (raw.masterKey && mealGetNutritionMaster_(mealClampText_(raw.masterKey, MEAL_TEXT_LIMIT.key))) ||
      (mealHasAnyNutritionValue_(nutrition) ? null : mealFindExactNutritionMaster_(item.menu));
    const useMaster = master && !mealHasAnyNutritionValue_(nutrition) && mealHasAnyNutritionValue_(master);
    const kcal = useMaster ? master.kcal : nutrition.kcal;

    if (config.dedupe && (existing.some(log => isSame(log, item, dateKey, kcal)) ||
        records.some(log => isSame(log, item, dateKey, kcal)))) {
      skipped += 1;
      return;
    }

    const now = new Date();
    const base = useMaster ? mealPickNutrition_(master) : nutrition;
    records.push({
      // 日付はお昼の時刻で持つ（タイムゾーンで前の日にずれないように）
      mealDate: new Date(`${dateKey}T12:00:00+09:00`),
      userId: userId,
      meal: item.meal,
      menu: item.menu,
      kcal: mealToNullableNumber_(base.kcal),
      protein: mealToNullableNumber_(base.protein),
      fat: mealToNullableNumber_(base.fat),
      carb: mealToNullableNumber_(base.carb),
      salt: mealToNullableNumber_(base.salt),
      fiber: mealToNullableNumber_(base.fiber),
      kcalStatus: mealToNullableNumber_(base.kcal) == null && !mealHasAnyNutritionValue_(base) ? MEAL_KCAL_STATUS.PENDING : MEAL_KCAL_STATUS.EXACT,
      masterKey: useMaster ? master.masterKey : (master && raw.masterKey ? master.masterKey : null),
      flavor: mealClampText_(useMaster ? master.flavor : raw.flavor, MEAL_TEXT_LIMIT.flavor),
      unit: mealClampText_(useMaster ? master.unit : raw.unit, MEAL_TEXT_LIMIT.unit),
      note: mealClampText_(useMaster ? master.note : raw.note, MEAL_TEXT_LIMIT.note),
      source: source,
      imageFileId: '',
      imageUrl: '',
      createdAt: now,
      updatedAt: now,
      logId: Utilities.getUuid(),
      clientId: clientId,
      dateKey: dateKey,
    });
    if (clientId) knownClientIds.add(clientId);
  });

  mealAppendMealLogs_(records);
  return {
    added: records,
    skipped: skipped,
    pending: records.filter(record => record.kcal == null).length,
  };
}

// 何件かをシートに1回で書く
function mealAppendMealLogs_(records) {
  if (!records.length) return;
  const sheet = mealGetSpreadsheet_().getSheetByName(MEAL_SHEET.MEAL_LOGS);
  if (!sheet) {
    throw new Error('meal_logs sheet not found');
  }
  const rows = records.map(record => mealToSheetRow_(MEAL_LOG_COLUMNS, record));
  // 最後の行を読んでから書くまでに、ほかの人が足すと上書きしてしまうので、1人ずつ
  mealWithSheetLock_(() => {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, MEAL_LOG_COLUMNS.length).setValues(rows); // qcheck-ok: G1 toSheetRow_ で safeCell を通した行
    records.forEach((record, index) => {
      record.row = startRow + index;
    });
    mealForgetMemo_('mealLogs');
  });
}
