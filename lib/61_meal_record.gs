/**
 * 61_meal_record.gs：食事の記録（meal_logs シート。食事記録ボットの 03_domain.meal.gs から）：送られた文字を読みとる・1行を書く・読む・直す・消す。
 * 呼ばれるところ：61_meal_flow.gs（記録の流れ）・61_meal_liff.gs（しょくじからの呼び出し）
 */

// 送られた文字（「昨日 朝 トースト」など）から、日付・食事の種類・名前を読みとって返す
function mealParseMealText_(text) {
  const raw = String(text || '').trim();
  const datePreset = raw.indexOf('昨日') !== -1 ? 'yesterday' : 'today';
  const mealDate = mealResolveMealDateByPreset_(datePreset);
  const meal = raw.match(/朝|昼|夜|その他/)?.[0] || mealInferMealType_(mealDateByPreset_(datePreset));
  const menu = mealClampText_(raw.replace(/昨日|今日|朝|昼|夜|その他/g, '').trim() || raw, MEAL_TEXT_LIMIT.name);

  return {
    meal: meal,
    menu: menu,
    datePreset: datePreset,
    mealDate: mealDate,
  };
}

// MYメニューの数字で1件記録する（シートに書いた記録を返す）
function mealLogMealFromMaster_(userId, parsed, master, options) {
  if (!master || !mealHasAnyNutritionValue_(master)) {
    throw new Error('nutrition master is required');
  }

  return mealAppendMealLogRecord_(userId, parsed, {
    kcal: master.kcal,
    protein: master.protein,
    fat: master.fat,
    carb: master.carb,
    salt: master.salt,
    fiber: master.fiber,
    kcalStatus: MEAL_KCAL_STATUS.EXACT,
    masterKey: master.masterKey,
    flavor: master.flavor,
    unit: master.unit,
    note: master.note,
  }, options);
}

// 渡したカロリー・PFC で1件記録する（数がなければ未記入として。シートに書いた記録を返す）
function mealLogMealWithNutrition_(userId, parsed, nutrition, options) {
  return mealAppendMealLogRecord_(userId, parsed, {
    kcal: nutrition.kcal,
    protein: nutrition.protein,
    fat: nutrition.fat,
    carb: nutrition.carb,
    salt: nutrition.salt,
    fiber: nutrition.fiber,
    kcalStatus: options && options.kcalStatus ? options.kcalStatus : MEAL_KCAL_STATUS.EXACT,
    masterKey: nutrition.masterKey || null,
    flavor: nutrition.flavor || '',
    unit: nutrition.unit || '',
    note: nutrition.note || '',
  }, options);
}

// 記録1件の形を作って、シートの最後に書く。書いた記録を返す
function mealAppendMealLogRecord_(userId, parsed, nutrition, options) {
  const config = options || {};
  const now = new Date();
  const record = {
    mealDate: config.mealDate ? new Date(config.mealDate) : now,
    userId: userId,
    meal: mealSanitizeMealType_(parsed && parsed.meal),
    menu: mealClampText_(parsed && parsed.menu, MEAL_TEXT_LIMIT.name),
    kcal: mealToNullableNumber_(nutrition.kcal),
    protein: mealToNullableNumber_(nutrition.protein),
    fat: mealToNullableNumber_(nutrition.fat),
    carb: mealToNullableNumber_(nutrition.carb),
    salt: mealToNullableNumber_(nutrition.salt),
    fiber: mealToNullableNumber_(nutrition.fiber),
    kcalStatus: String(nutrition.kcalStatus || MEAL_KCAL_STATUS.PENDING),
    masterKey: nutrition.masterKey || null,
    flavor: mealClampText_(nutrition.flavor, MEAL_TEXT_LIMIT.flavor),
    unit: mealClampText_(nutrition.unit, MEAL_TEXT_LIMIT.unit),
    note: mealClampText_(nutrition.note, MEAL_TEXT_LIMIT.note),
    source: config.source || MEAL_SOURCE.TEXT,
    imageFileId: String(config.imageFileId || ''),
    imageUrl: String(config.imageUrl || ''),
    createdAt: now,
    updatedAt: now,
    logId: String(config.logId || Utilities.getUuid()),
  };

  record.row = mealAppendMealLog_(record);
  return record;
}

// 記録1件を meal_logs シートの最後の行に書く（ロックして。文字は safeCell を通す）
function mealAppendMealLog_(log) {
  const sheet = mealGetSpreadsheet_().getSheetByName(MEAL_SHEET.MEAL_LOGS);
  if (!sheet) {
    throw new Error('meal_logs sheet not found');
  }

  return mealWithSheetLock_(() => {
    sheet.appendRow(mealToSheetRow_(MEAL_LOG_COLUMNS, log)); // qcheck-ok: G1 toSheetRow_ で safeCell を通した
    mealForgetMemo_('mealLogs');
    return sheet.getLastRow();
  });
}

// 読んだあとにほかの人が行を消すと、行の番号がずれる。書く直前に、その行が同じ記録か（logId）を確かめ、ちがえば探しなおす
function mealLocateMealLogRow_(sheet, log) {
  const logId = String(log && log.logId || '').trim();
  const row = Number(log && log.row || 0);
  if (!logId) return row;
  const lastRow = sheet.getLastRow();
  if (row >= 2 && row <= lastRow && String(sheet.getRange(row, MEAL_LOG_COL_INDEX.logId).getValue()).trim() === logId) return row;
  if (lastRow < 2) return 0;
  const ids = sheet.getRange(2, MEAL_LOG_COL_INDEX.logId, lastRow - 1, 1).getValues();
  const index = ids.findIndex(cell => String(cell[0]).trim() === logId);
  return index === -1 ? 0 : index + 2;
}

// logId で記録を1件さがす（なければ null）
function mealGetMealLogById_(logId) {
  const normalized = String(logId || '').trim();
  if (!normalized) return null;
  return mealGetMealLogs_().find(log => String(log.logId || '').trim() === normalized) || null;
}

// シートの行番号で記録を1件さがす（なければ null）
function mealGetMealLogByRow_(rowNumber) {
  const row = Number(rowNumber || 0);
  if (!Number.isFinite(row) || row < 2) return null;
  return mealGetMealLogs_().find(log => log.row === row) || null;
}

// logId か行番号のどちらかで記録をさがす（ボタンにはどちらかが入っている）
function mealResolveMealLogReference_(ref) {
  const normalized = String(ref || '').trim();
  if (!normalized) return null;
  return mealGetMealLogById_(normalized) || mealGetMealLogByRow_(normalized);
}

// 記録1件を、その行に書きなおす（ロックして）
function mealUpdateMealLog_(log) {
  const rowNumber = Number(log && log.row || 0);
  if (!Number.isFinite(rowNumber) || rowNumber < 2) {
    throw new Error('meal log row is invalid');
  }

  const sheet = mealGetSpreadsheet_().getSheetByName(MEAL_SHEET.MEAL_LOGS);
  if (!sheet) {
    throw new Error('meal_logs sheet not found');
  }

  mealWithSheetLock_(() => {
    const target = mealLocateMealLogRow_(sheet, log);
    if (target < 2) throw new Error('meal log moved or deleted');
    const row = mealToSheetRow_(MEAL_LOG_COLUMNS, log);
    sheet.getRange(target, 1, 1, row.length).setValues([row]); // qcheck-ok: G1 toSheetRow_ で safeCell を通した行
    mealForgetMemo_('mealLogs');
  });
}

// 記録に写真（ドライブのファイル ID と URL）を付けて書きなおす
function mealAttachMealLogImage_(rowNumber, imageFileId, imageUrl) {
  const log = mealResolveMealLogReference_(rowNumber);
  if (!log) {
    throw new Error('meal log not found');
  }
  const updated = Object.assign({}, log, {
    imageFileId: String(imageFileId || ''),
    imageUrl: String(imageUrl || ''),
    updatedAt: new Date(),
  });
  mealUpdateMealLog_(updated);
  return updated;
}

// 記録1件の行を消す
function mealDeleteMealLog_(rowNumber) {
  const log = mealResolveMealLogReference_(rowNumber);
  const row = Number(log && log.row || rowNumber || 0);
  if (!Number.isFinite(row) || row < 2) {
    throw new Error('meal log row is invalid');
  }

  const sheet = mealGetSpreadsheet_().getSheetByName(MEAL_SHEET.MEAL_LOGS);
  if (!sheet) {
    throw new Error('meal_logs sheet not found');
  }

  mealWithSheetLock_(() => {
    const target = log ? mealLocateMealLogRow_(sheet, log) : row;
    if (target < 2) throw new Error('meal log moved or deleted');
    sheet.deleteRow(target);
    mealForgetMemo_('mealLogs');
  });
}

// 食事ログは呼び出し1回につき1回だけ読む（書いたときは appendMealLog_ などが覚え書きを捨てる）
function mealGetMealLogs_() {
  return mealMemo_('mealLogs', () => {
    const sheet = mealGetSpreadsheet_().getSheetByName(MEAL_SHEET.MEAL_LOGS);
    if (!sheet) return [];

    const values = sheet.getDataRange().getValues();
    const rows = values.slice(1).map((row, index) => mealMapMealLogRow_(row, index + 2));
    mealBackfillMealLogIds_(sheet, rows);
    return rows;
  });
}

// その記録の日付（yyyy-MM-dd）。読みこんだときに作っておいたものを使う
function mealLogDateKey_(log) {
  if (!log) return '';
  if (log.dateKey) return log.dateKey;
  return log.mealDate ? mealFormatDateKey_(log.mealDate) : '';
}

// シートの1行を、記録のオブジェクト（名前つき）にする
function mealMapMealLogRow_(row, rowNumber) {
  return {
    row: rowNumber,
    mealDate: row[MEAL_LOG_COL_INDEX.mealDate - 1] || null,
    userId: String(row[MEAL_LOG_COL_INDEX.userId - 1] || ''),
    meal: String(row[MEAL_LOG_COL_INDEX.meal - 1] || ''),
    menu: String(row[MEAL_LOG_COL_INDEX.menu - 1] || ''),
    kcal: mealToNullableNumber_(row[MEAL_LOG_COL_INDEX.kcal - 1]),
    protein: mealToNullableNumber_(row[MEAL_LOG_COL_INDEX.protein - 1]),
    fat: mealToNullableNumber_(row[MEAL_LOG_COL_INDEX.fat - 1]),
    carb: mealToNullableNumber_(row[MEAL_LOG_COL_INDEX.carb - 1]),
    salt: mealToNullableNumber_(row[MEAL_LOG_COL_INDEX.salt - 1]),
    fiber: mealToNullableNumber_(row[MEAL_LOG_COL_INDEX.fiber - 1]),
    kcalStatus: String(row[MEAL_LOG_COL_INDEX.kcalStatus - 1] || MEAL_KCAL_STATUS.PENDING),
    masterKey: String(row[MEAL_LOG_COL_INDEX.masterKey - 1] || ''),
    flavor: String(row[MEAL_LOG_COL_INDEX.flavor - 1] || ''),
    unit: String(row[MEAL_LOG_COL_INDEX.unit - 1] || ''),
    note: String(row[MEAL_LOG_COL_INDEX.note - 1] || ''),
    source: String(row[MEAL_LOG_COL_INDEX.source - 1] || MEAL_SOURCE.TEXT),
    imageFileId: String(row[MEAL_LOG_COL_INDEX.imageFileId - 1] || ''),
    imageUrl: String(row[MEAL_LOG_COL_INDEX.imageUrl - 1] || ''),
    createdAt: row[MEAL_LOG_COL_INDEX.createdAt - 1] || null,
    updatedAt: row[MEAL_LOG_COL_INDEX.updatedAt - 1] || null,
    logId: String(row[MEAL_LOG_COL_INDEX.logId - 1] || ''),
    clientId: String(row[MEAL_LOG_COL_INDEX.clientId - 1] || ''),
    dateKey: row[MEAL_LOG_COL_INDEX.mealDate - 1] ? mealFormatDateKey_(row[MEAL_LOG_COL_INDEX.mealDate - 1]) : '',
  };
}

// logId がない古い行に、logId を付けて書く（ボタンで記録を指せるように）
function mealBackfillMealLogIds_(sheet, logs) {
  const targetSheet = sheet || mealGetSpreadsheet_().getSheetByName(MEAL_SHEET.MEAL_LOGS);
  if (!targetSheet || !Array.isArray(logs)) return;

  if (!logs.some(log => !String(log && log.logId || '').trim())) return;
  mealWithSheetLock_(() => {
    logs.forEach(log => {
      if (String(log && log.logId || '').trim()) return;
      const generatedId = Utilities.getUuid();
      log.logId = generatedId;
      if (Number(log.row || 0) < 2) return;
      // 行がずれていたら書かない（次に読んだときに付けなおす）
      const cell = targetSheet.getRange(Number(log.row), MEAL_LOG_COL_INDEX.logId);
      if (String(cell.getValue()).trim()) return;
      cell.setValue(generatedId); // qcheck-ok: G1 作った ID だけ
    });
  });
}

// 時刻から食事の種類を決める（11時まで朝・17時まで昼・ほかは夜）
function mealInferMealType_(date) {
  const hour = Number(Utilities.formatDate(date, MEAL_APP_TIMEZONE, 'H'));
  if (hour < 11) return '朝';
  if (hour < 17) return '昼';
  return '夜';
}

// きょう・きのう（'yesterday'）の日時。日本は夏時間がないので 24 時間ひけば前の日
function mealDateByPreset_(datePreset) {
  const date = new Date();
  return datePreset === 'yesterday' ? new Date(date.getTime() - 86400000) : date;
}

// 「きょう」「きのう」を「2026-10-25」の形の日付にする
function mealResolveMealDateByPreset_(datePreset) {
  return mealFormatDateKey_(mealDateByPreset_(datePreset));
}
