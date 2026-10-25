/**
 * 61_meal_base.gs：しょくじの決まりごと（食事記録ボットの 02_core.gs から）：時間帯・食事の種類・シートの名前と列などの定数と、数・日付の小さな変換。
 * しょくじのファイルの中でいちばん先に読まれる（名前の順）ので、ほかのファイルの定数をここで使わない。
 * 呼ばれるところ：しょくじの機能のどのファイルからも
 */

const MEAL_APP_TIMEZONE = 'Asia/Tokyo';

const MEAL_SHEET = {
  USERS: 'meal_users', // 食事記録ボットの users（LOgBOT の users と名前が重ならないように）
  MEAL_LOGS: 'meal_logs',
  NUTRITION_MASTER: 'nutrition_master',
};

const MEAL_NUTRITION_KEYS = [
  'kcal',
  'protein',
  'fat',
  'carb',
  'salt',
  'fiber',
];

const MEAL_TYPES = ['朝', '昼', '夜', 'その他'];
const MEAL_DEFAULT_CANDIDATE_LIMIT = 5;

/**
 * @typedef {Object} NutritionMaster
 * @property {string} masterKey
 * @property {string} name
 * @property {number|null} kcal
 * @property {number|null} protein
 * @property {number|null} fat
 * @property {number|null} carb
 * @property {number|null} salt
 * @property {number|null} fiber
 * @property {string} flavor
 * @property {string} unit
 * @property {string} note
 * @property {'active'|'pending'|'disabled'} status
 * @property {string} source
 * @property {Date|null} createdAt
 * @property {Date|null} updatedAt
 */
const MEAL_NUTRITION_MASTER_COLUMNS = [
  'masterKey',
  'name',
  'kcal',
  'protein',
  'fat',
  'carb',
  'salt',
  'fiber',
  'unit',
  'note',
  'status',
  'source',
  'createdAt',
  'updatedAt',
  'flavor',
  // 共通（scope が空か common。管理者が整える。だれでも候補に使える）か、その人の（personal。owner の人にだけ見える）か
  'owner',
  'scope',
];

const MEAL_NUTRITION_COL_INDEX = MEAL_NUTRITION_MASTER_COLUMNS.reduce((acc, key, index) => {
  acc[key] = index + 1;
  return acc;
}, {});

/**
 * @typedef {Object} MealLog
 * @property {Date|null} mealDate
 * @property {string} userId
 * @property {string} meal
 * @property {string} menu
 * @property {number|null} kcal
 * @property {number|null} protein
 * @property {number|null} fat
 * @property {number|null} carb
 * @property {number|null} salt
 * @property {number|null} fiber
 * @property {string} kcalStatus
 * @property {string|null} masterKey
 * @property {string=} flavor
 * @property {string=} unit
 * @property {string=} note
 * @property {string} source
 * @property {string=} imageFileId
 * @property {string=} imageUrl
 * @property {Date|null} createdAt
 * @property {Date|null} updatedAt
 * @property {number=} row
 * @property {string=} logId
 */
const MEAL_LOG_COLUMNS = [
  'mealDate',
  'userId',
  'meal',
  'menu',
  'kcal',
  'protein',
  'fat',
  'carb',
  'salt',
  'fiber',
  'kcalStatus',
  'masterKey',
  'source',
  'imageFileId',
  'imageUrl',
  'createdAt',
  'updatedAt',
  'flavor',
  'unit',
  'note',
  'logId',
  // しょくじ（LINE 版）の記録の id。同じ記録を二重に入れない・あとで直す／消すをそろえるため
  'clientId',
];

const MEAL_LOG_COL_INDEX = MEAL_LOG_COLUMNS.reduce((acc, key, index) => {
  acc[key] = index + 1;
  return acc;
}, {});

/**
 * @typedef {Object} User
 * @property {string} userId
 * @property {string} displayName
 * @property {string} pictureUrl
 * @property {number|null} calorieTarget
 * @property {string} goalType
 * @property {boolean} notify
 * @property {'active'|'inactive'} status
 * @property {Date|null} createdAt
 * @property {Date|null} updatedAt
 */
const MEAL_USER_COLUMNS = [
  'userId',
  'displayName',
  'calorieTarget',
  'goalType',
  'notify',
  'status',
  'createdAt',
  'updatedAt',
  'pictureUrl',
  // よく記録するものに固定した MYメニュー（masterKey の並び。JSON）。画面で並べかえ・固定できる
  'favorites',
  // その人の「よく記録」リッチメニューの id（作りなおしたら前のものを消す）
  'richMenuId',
  // その「よく記録」メニューに描いた並び（画面が描いた並びの印。画面を開いたとき、今の並びとちがえば作りなおす）
  'richMenuKey',
];

const MEAL_FAVORITES_LIMIT = 12;

const MEAL_USER_COL_INDEX = MEAL_USER_COLUMNS.reduce((acc, key, index) => {
  acc[key] = index + 1;
  return acc;
}, {});

const MEAL_KCAL_STATUS = {
  EXACT: 'exact',
  ESTIMATED: 'estimated',
  PENDING: 'pending',
};

const MEAL_SOURCE = {
  TEXT: 'text',
  MANUAL: 'manual',
  SYSTEM: 'system',
  LIFF: 'liff',
  LINE: 'line',
  SHOQUJI: 'shoquji', // しょくじ（ShoQuji）の記録用の文字から（3_usecase.shoquji.gs）
};

const MEAL_GOAL_TYPE = {
  KEEP: 'keep',
  CUT: 'cut',
  BULK: 'bulk',
};

// 記録の一覧から、カロリー・PFC などを足した合計を返す
function mealSummarizeNutrition_(logs) {
  const total = Object.fromEntries(MEAL_NUTRITION_KEYS.map(key => [key, 0]));

  logs.forEach(log => {
    MEAL_NUTRITION_KEYS.forEach(key => {
      total[key] += Number(log[key] || 0);
    });
  });

  return total;
}

// 数にできれば数、空・数でなければ null を返す（「入れていない」と 0 を分けるため）
function mealToNullableNumber_(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// シートの値（true・1・yes・on など）を true／false にする
function mealToBoolean_(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value || '').trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].indexOf(normalized) !== -1;
}

// 日時を日本時間の「2026-10-25T08:00:00」の形の文字にする（空なら ""）
function mealToIsoDateTime_(value) {
  if (!value) return '';
  return Utilities.formatDate(new Date(value), MEAL_APP_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}

// 日付を日本時間の「2026-10-25」の形の文字にする
function mealFormatDateKey_(value) {
  return Utilities.formatDate(new Date(value), MEAL_APP_TIMEZONE, 'yyyy-MM-dd');
}

// 食事の種類（朝・昼・夜・その他）にそろえる。知らない値なら、いまの時刻から決める
function mealSanitizeMealType_(value) {
  const meal = String(value || '').trim();
  return MEAL_TYPES.indexOf(meal) !== -1 ? meal : mealInferMealType_(new Date());
}

// カロリー・PFC などのどれかに数が入っていれば true
function mealHasAnyNutritionValue_(record) {
  return MEAL_NUTRITION_KEYS.some(key => mealToNullableNumber_(record && record[key]) != null);
}
