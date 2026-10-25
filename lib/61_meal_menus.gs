/**
 * 61_meal_menus.gs：MYメニュー（nutrition_master シート。食事記録ボットの 03_domain.nutritionMaster.gs から）：読む・名前の一致と近い候補をさがす・保存する。
 * 「共通」（だれでも使う。直せるのは持ち主）と「自分の」（その人だけに見える）がある。見える順は自分の → 共通。
 * 呼ばれるところ：61_meal_flow.gs（記録の流れ）・61_meal_liff.gs（しょくじからの呼び出し）
 */

// ---- 共通の MYメニューと、自分の MYメニュー ----
// 共通：管理者が整える（scope が空か common）。だれでも候補に使えて、直せるのは管理者だけ
// 自分の：その人が入れた・共通から自分用にしたもの（scope=personal、owner=その人）。ほかの人には見えない
// だれのものを見るかは、その呼び出しの本人（LINE の知らせ・画面の呼び出しのはじめに setMasterViewer_ で決める）
function mealSetMasterViewer_(userId) {
  mealState_().masterViewer = String(userId || '');
}

// いまの呼び出しの本人（MYメニューをだれの目で見るか）。わからなければ ""
function mealMasterViewer_() {
  return mealState_().masterViewer || '';
}

// 共通の品なら true（scope が personal でないもの。空も共通）
function mealIsCommonMaster_(master) {
  return String(master && master.scope || '') !== 'personal';
}

// その人の「自分の」品なら true
function mealIsOwnMaster_(master, userId) {
  return Boolean(userId) && !mealIsCommonMaster_(master) && master.owner === userId;
}

// 見える MYメニュー：自分の → 共通（本人がわからない呼び出しは共通だけ）
function mealVisibleMasters_() {
  const viewer = mealMasterViewer_();
  const all = mealGetNutritionMasterCached_();
  return all.filter(master => mealIsOwnMaster_(master, viewer)).concat(all.filter(mealIsCommonMaster_));
}

// 名前がぴったり合う MYメニュー：自分の品を先に、なければ共通から
function mealFindExactNutritionMaster_(menu) {
  const viewer = mealMasterViewer_();
  const all = mealGetNutritionMasterCached_();
  return mealFindExactIn_(menu, all.filter(master => mealIsOwnMaster_(master, viewer))) || mealFindExactIn_(menu, all.filter(mealIsCommonMaster_));
}

// 名前（と種類・量）がぴったり同じ品を、渡した一覧からさがす（なければ null）
function mealFindExactIn_(menu, masters) {
  const normalizedMenu = mealNormalizeText_(menu);
  if (!normalizedMenu) return null;

  const exactCandidates = masters.filter(master =>
    master.status !== 'disabled' &&
    mealHasAnyNutritionValue_(master)
  );

  const displayMatches = exactCandidates.filter(master =>
    mealNormalizeText_(mealBuildNutritionDisplayName_(master)) === normalizedMenu
  );
  if (displayMatches.length === 1) {
    return displayMatches[0];
  }

  const baseNameMatches = exactCandidates.filter(master =>
    mealNormalizeText_(master.name) === normalizedMenu
  );
  if (baseNameMatches.length === 1) {
    return baseNameMatches[0];
  }

  const searchTextMatches = exactCandidates.filter(master =>
    mealGetNutritionMasterSearchTexts_(master).some(text => text === normalizedMenu)
  );
  if (searchTextMatches.length === 1) {
    return searchTextMatches[0];
  }

  return null;
}

// 名前の近い品を、近い順に limit 件まで返す（見える品だけ）
function mealFindNutritionCandidates_(menu, limit) {
  const normalizedMenu = mealNormalizeText_(menu);
  if (!normalizedMenu) return [];

  return mealVisibleMasters_()
    .filter(master => master.status === 'active')
    .filter(master => mealHasAnyNutritionValue_(master))
    .map(master => ({
      master: master,
      score: mealScoreNutritionCandidate_(normalizedMenu, mealGetNutritionMasterSearchTexts_(master)),
    }))
    .filter(candidate => candidate.score >= 0.24)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return mealNormalizeText_(right.master.name).length - mealNormalizeText_(left.master.name).length;
    })
    .slice(0, limit || MEAL_DEFAULT_CANDIDATE_LIMIT)
    .map(candidate => ({
      masterKey: candidate.master.masterKey,
      menu: String(candidate.master.name || ''),
      name: mealBuildNutritionDisplayName_(candidate.master),
      kcal: mealToNullableNumber_(candidate.master.kcal),
      protein: mealToNullableNumber_(candidate.master.protein),
      fat: mealToNullableNumber_(candidate.master.fat),
      carb: mealToNullableNumber_(candidate.master.carb),
      salt: mealToNullableNumber_(candidate.master.salt),
      fiber: mealToNullableNumber_(candidate.master.fiber),
      flavor: String(candidate.master.flavor || ''),
      unit: String(candidate.master.unit || ''),
      note: String(candidate.master.note || ''),
      status: candidate.master.status,
      scope: mealIsCommonMaster_(candidate.master) ? 'common' : 'mine',
      score: Number(candidate.score.toFixed(3)),
      scorePercent: Math.round(candidate.score * 100),
    }));
}

// 名前から、近い候補と「入力欄に先に入れておく数字」を作って返す
function mealBuildNutritionDraft_(menu) {
  const candidates = mealFindNutritionCandidates_(menu, MEAL_DEFAULT_CANDIDATE_LIMIT);
  const best = candidates[0] || null;
  const shouldPrefill = best && best.score >= 0.52;

  return {
    menu: String(menu || '').trim(),
    prefill: {
      hasSuggestion: Boolean(shouldPrefill),
      masterKey: shouldPrefill ? best.masterKey : '',
      masterName: shouldPrefill ? best.name : '',
      score: shouldPrefill ? best.score : 0,
      scorePercent: shouldPrefill ? best.scorePercent : 0,
      nutrition: shouldPrefill
        ? mealPickNutrition_(best)
        : mealEmptyNutrition_(),
      flavor: shouldPrefill ? best.flavor : '',
      unit: shouldPrefill ? best.unit : '',
      note: shouldPrefill ? best.note : '',
    },
    candidates: candidates,
  };
}

// MYメニューを全部読む（シートの行から。使うのはふつう getNutritionMasterCached_）
function mealGetNutritionMasters_() {
  const sheet = mealGetSpreadsheet_().getSheetByName(MEAL_SHEET.NUTRITION_MASTER);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  return values.slice(1).map(mealMapNutritionMasterRow_);
}

// masterKey で MYメニューを1件さがす（なければ null）
function mealGetNutritionMaster_(masterKey) {
  return mealGetNutritionMasterByKey_(masterKey);
}

// MYメニューを保存する。だれが（setMasterViewer_ の本人）保存するかで行き先が変わる：
// - 自分の品 → その品を直す
// - 共通の品 → 管理者なら共通を直す。ほかの人は自分用の写しを作る（共通は変わらない。固定していたら写しに付けかえる）
// - 新しい品 → その人の品として作る（共通に名前・種類・量も数字も同じ品があれば、写さずにそれを使う）
// 本人がわからない呼び出し（エディタからなど）は、共通として扱う
function mealSaveNutritionMaster_(input) {
  const sheet = mealGetSpreadsheet_().getSheetByName(MEAL_SHEET.NUTRITION_MASTER);
  if (!sheet) {
    throw new Error('nutrition_master sheet not found');
  }

  const now = new Date();
  const actor = mealMasterViewer_();
  const curator = !actor || mealIsAdminUser_(actor);
  const name = mealClampText_(input.name, MEAL_TEXT_LIMIT.name);
  const flavor = mealClampText_(input.flavor, MEAL_TEXT_LIMIT.flavor);
  const unit = mealClampText_(input.unit, MEAL_TEXT_LIMIT.unit);
  const normalizedName = mealNormalizeText_(name);
  const canWrite = master => mealIsOwnMaster_(master, actor) || (mealIsCommonMaster_(master) && curator);
  const sameName = master => normalizedName && mealIsSameNutritionKey_(master, name, flavor, unit);
  const all = mealGetNutritionMasterCached_();
  // 画面から来た masterKey は、もうあるものだけ使う（新しく作るときは、こちらで ID を作る）
  const requested = mealGetNutritionMasterByKey_(mealClampText_(input.masterKey, MEAL_TEXT_LIMIT.key));
  let target = requested && canWrite(requested) ? requested : null;
  const copiedFrom = requested && !target ? requested : null;
  if (!target) target = all.find(master => sameName(master) && canWrite(master)) || null;
  const nutrition = mealPickNutrition_(input);
  if (!target && !copiedFrom) {
    // 共通に同じ品（名前・種類・量・数字）があれば、自分用には写さない
    const common = all.find(master => sameName(master) && mealIsCommonMaster_(master));
    if (common && MEAL_NUTRITION_KEYS.every(key => mealToNullableNumber_(common[key]) === mealToNullableNumber_(nutrition[key]))) return common;
  }
  const personal = target ? !mealIsCommonMaster_(target) : Boolean(actor);

  const record = {
    masterKey: target ? target.masterKey : Utilities.getUuid(),
    name: name,
    kcal: mealToNullableNumber_(input.kcal),
    protein: mealToNullableNumber_(input.protein),
    fat: mealToNullableNumber_(input.fat),
    carb: mealToNullableNumber_(input.carb),
    salt: mealToNullableNumber_(input.salt),
    fiber: mealToNullableNumber_(input.fiber),
    flavor: flavor,
    unit: unit,
    note: mealClampText_(input.note, MEAL_TEXT_LIMIT.note),
    status: String(input.status || 'active'),
    source: String(input.source || MEAL_SOURCE.MANUAL),
    createdAt: target && target.createdAt ? new Date(target.createdAt) : now,
    updatedAt: now,
    owner: personal ? (target ? target.owner : actor) : '',
    scope: personal ? 'personal' : 'common',
  };

  mealWithSheetLock_(() => {
    // 覚え書きは古いことがある（ほかの呼び出しが作ったばかり）ので、書く前にシートで探しなおす
    const values = sheet.getDataRange().getValues();
    const keyCol = MEAL_NUTRITION_COL_INDEX.masterKey - 1;
    let rowIndex = target ? values.findIndex(cells => cells[keyCol] === target.masterKey) : -1;
    if (rowIndex < 1 && normalizedName) {
      rowIndex = values.findIndex((cells, index) => {
        if (index < 1) return false;
        const row = mealMapNutritionMasterRow_(cells);
        return mealIsSameNutritionKey_(row, name, flavor, unit) && row.scope === record.scope && row.owner === record.owner;
      });
      if (rowIndex >= 1) {
        record.masterKey = String(values[rowIndex][keyCol]);
        record.createdAt = values[rowIndex][MEAL_NUTRITION_COL_INDEX.createdAt - 1] || now;
      }
    }
    const row = mealToSheetRow_(MEAL_NUTRITION_MASTER_COLUMNS, record);
    if (rowIndex >= 1) {
      sheet.getRange(rowIndex + 1, 1, 1, row.length).setValues([row]); // qcheck-ok: G1 toSheetRow_ で safeCell を通した行
    } else {
      sheet.appendRow(row); // qcheck-ok: G1 toSheetRow_ で safeCell を通した行
    }
  });

  mealRefreshNutritionMasterCache_();
  // 共通の品を自分用にしたとき：よく記録するものに固定していたら、写しに付けかえる
  if (copiedFrom && actor && copiedFrom.masterKey !== record.masterKey) {
    const user = mealGetUserById_(actor);
    if (user && (user.favorites || []).indexOf(copiedFrom.masterKey) !== -1) {
      mealUpdateUserProfile_(actor, { favorites: user.favorites.map(key => (key === copiedFrom.masterKey ? record.masterKey : key)) });
    }
  }
  return record;
}

// 名前・種類・量が同じ品か（大文字小文字・空白・かっこは見ない）
function mealIsSameNutritionKey_(master, name, flavor, unit) {
  return mealNormalizeText_(master && master.name) === mealNormalizeText_(name) &&
    mealNormalizeText_(master && master.flavor) === mealNormalizeText_(flavor) &&
    mealNormalizeText_(master && master.unit) === mealNormalizeText_(unit);
}

// くらべるための文字にする（小文字・空白とかっこを消す）
function mealNormalizeText_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '')
    .replace(/[　]/g, '')
    .replace(/[・･]/g, '')
    .replace(/[\/]/g, '')
    .replace(/[ー\-]/g, '');
}

// 品からカロリー・PFC などの数だけを取り出す
function mealPickNutrition_(master) {
  return Object.fromEntries(
    MEAL_NUTRITION_KEYS.map(key => [key, mealToNullableNumber_(master[key])])
  );
}

// カロリー・PFC などが全部 null の入れもの（未記入の記録用）
function mealEmptyNutrition_() {
  return {
    kcal: null,
    protein: null,
    fat: null,
    carb: null,
    salt: null,
    fiber: null,
    status: MEAL_KCAL_STATUS.PENDING,
    masterKey: null,
  };
}

// 名前と、品のいくつかの呼び名とをくらべて、いちばん近い度合い（0〜1）を返す
function mealScoreNutritionCandidate_(normalizedMenu, normalizedTargets) {
  const targets = Array.isArray(normalizedTargets) ? normalizedTargets : [normalizedTargets];
  return targets.reduce((best, target) => Math.max(best, mealScoreNutritionCandidateText_(normalizedMenu, target)), 0);
}

// 2つの文字の近さ（0〜1）。同じなら1、ふくむなら高め、ほかは2文字ずつの重なりで
function mealScoreNutritionCandidateText_(normalizedMenu, normalizedMaster) {
  if (!normalizedMenu || !normalizedMaster) return 0;
  if (normalizedMenu === normalizedMaster) return 1;

  const shorterLength = Math.min(normalizedMenu.length, normalizedMaster.length);
  const longerLength = Math.max(normalizedMenu.length, normalizedMaster.length);
  const bigramScore = mealBigramSimilarity_(normalizedMenu, normalizedMaster);
  const containsBonus = (
    normalizedMenu.indexOf(normalizedMaster) !== -1 ||
    normalizedMaster.indexOf(normalizedMenu) !== -1
  )
    ? 0.45 + (shorterLength / longerLength) * 0.3
    : 0;
  const prefixBonus = normalizedMenu.slice(0, 2) === normalizedMaster.slice(0, 2) ? 0.08 : 0;
  const suffixBonus = normalizedMenu.slice(-2) === normalizedMaster.slice(-2) ? 0.05 : 0;

  return Math.min(0.99, bigramScore * 0.72 + containsBonus + prefixBonus + suffixBonus);
}

// 2文字ずつに切って、重なりの割合（0〜1）を返す
function mealBigramSimilarity_(left, right) {
  const leftBigrams = mealMakeBigrams_(left);
  const rightBigrams = mealMakeBigrams_(right);
  if (!leftBigrams.length || !rightBigrams.length) return 0;

  const rightMap = rightBigrams.reduce((acc, token) => {
    acc[token] = (acc[token] || 0) + 1;
    return acc;
  }, {});

  let intersection = 0;
  leftBigrams.forEach(token => {
    if (rightMap[token] > 0) {
      intersection += 1;
      rightMap[token] -= 1;
    }
  });

  return (intersection * 2) / (leftBigrams.length + rightBigrams.length);
}

// 文字を2文字ずつに切った一覧を返す（1文字ならその1つ）
function mealMakeBigrams_(value) {
  if (!value) return [];
  if (value.length === 1) return [value];

  const tokens = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    tokens.push(value.slice(index, index + 2));
  }
  return tokens;
}

// シートの1行を、MYメニューのオブジェクトにする
function mealMapNutritionMasterRow_(row) {
  return {
    masterKey: String(row[MEAL_NUTRITION_COL_INDEX.masterKey - 1] || ''),
    name: String(row[MEAL_NUTRITION_COL_INDEX.name - 1] || ''),
    kcal: mealToNullableNumber_(row[MEAL_NUTRITION_COL_INDEX.kcal - 1]),
    protein: mealToNullableNumber_(row[MEAL_NUTRITION_COL_INDEX.protein - 1]),
    fat: mealToNullableNumber_(row[MEAL_NUTRITION_COL_INDEX.fat - 1]),
    carb: mealToNullableNumber_(row[MEAL_NUTRITION_COL_INDEX.carb - 1]),
    salt: mealToNullableNumber_(row[MEAL_NUTRITION_COL_INDEX.salt - 1]),
    fiber: mealToNullableNumber_(row[MEAL_NUTRITION_COL_INDEX.fiber - 1]),
    flavor: String(row[MEAL_NUTRITION_COL_INDEX.flavor - 1] || ''),
    unit: String(row[MEAL_NUTRITION_COL_INDEX.unit - 1] || ''),
    note: String(row[MEAL_NUTRITION_COL_INDEX.note - 1] || ''),
    status: String(row[MEAL_NUTRITION_COL_INDEX.status - 1] || 'active'),
    source: String(row[MEAL_NUTRITION_COL_INDEX.source - 1] || MEAL_SOURCE.MANUAL),
    createdAt: row[MEAL_NUTRITION_COL_INDEX.createdAt - 1] || null,
    updatedAt: row[MEAL_NUTRITION_COL_INDEX.updatedAt - 1] || null,
    owner: String(row[MEAL_NUTRITION_COL_INDEX.owner - 1] || ''),
    scope: String(row[MEAL_NUTRITION_COL_INDEX.scope - 1] || '') === 'personal' ? 'personal' : 'common',
  };
}

// 種類と量を「みそ / 1杯」の形にする（ないものは省く）
function mealBuildNutritionDescriptor_(flavor, unit) {
  return [String(flavor || '').trim(), String(unit || '').trim()].filter(Boolean).join(' / ');
}

// 画面やカードに出す名前（「みそ汁：みそ / 1杯」の形）
function mealBuildNutritionDisplayName_(master) {
  const descriptor = mealBuildNutritionDescriptor_(master && master.flavor, master && master.unit);
  const baseName = String(master && master.name || '').trim();
  return descriptor ? `${baseName}：${descriptor}` : baseName;
}

// 候補さがしでくらべる呼び名の一覧（名前・出す名前・種類・量）
function mealGetNutritionMasterSearchTexts_(master) {
  const base = mealNormalizeText_(master && master.name);
  const display = mealNormalizeText_(mealBuildNutritionDisplayName_(master));
  const flavor = mealNormalizeText_(master && master.flavor);
  const unit = mealNormalizeText_(master && master.unit);
  const descriptor = mealNormalizeText_(mealBuildNutritionDescriptor_(master && master.flavor, master && master.unit));
  const baseWithFlavor = mealNormalizeText_(`${master && master.name || ''} ${master && master.flavor || ''}`);
  const baseWithUnit = mealNormalizeText_(`${master && master.name || ''} ${master && master.unit || ''}`);
  const baseWithDescriptor = mealNormalizeText_(`${master && master.name || ''} ${mealBuildNutritionDescriptor_(master && master.flavor, master && master.unit)}`);
  const note = mealNormalizeText_(master && master.note);
  return [...new Set([base, display, flavor, unit, descriptor, baseWithFlavor, baseWithUnit, baseWithDescriptor, note].filter(Boolean))];
}
