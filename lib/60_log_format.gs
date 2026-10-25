/**
 * 60_log_format.gs：機能「📝 記録」の日付と時間（LOgBOT の 03_record/format.gs から）
 * 中身：日本時間の書式・同じ日か・週の範囲・きょうと今週の数
 * 呼ばれる（LOgBOT のときのファイル名）：記録・カード・ふりかえり・クエスト
 *
 * 日付・時間に関する共通ユーティリティ群。
 * 
 * - すべて JST（Asia/Tokyo）基準で扱う
 * - 草（活動）集計ロジックの土台
 * - LINE / HTML / GitHub いずれからも参照される
 * 
 * ⚠️ 注意:
 * - Date のまま比較するとタイムゾーン差分で事故りやすいため、
 *   normalize / format を通した比較を前提とする
 */

/* =====================================================
 * 定数定義
 * ===================================================== */
/** JSTタイムゾーン */
const LOG_JST_TIMEZONE = 'Asia/Tokyo';

/** 1日あたりのミリ秒数 */
const LOG_DAY_MS = 24 * 60 * 60 * 1000; // = 86,400,000 ms

/* =====================================================
 * 日付加工 / 正規化
 * ===================================================== */
/**
 * JST（Asia/Tokyo）基準で Date を文字列フォーマットする
 * 
 * - GAS の Utilities.formatDate をラップ
 * - 日付比較・GitHubログパス生成などで共通利用
 *
 * @param {Date} date
 * @param {string} format
 * @return {string}
 */
function logFormatJST_(date, format) {
  const parsed = date instanceof Date ? date : new Date(date);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid date for formatJST_: ${String(date)}`);
  }
  return Utilities.formatDate(parsed, LOG_JST_TIMEZONE, format);
}

/**
 * JST基準で「日付のみ」に正規化した Date を返す
 * 
 * - 時分秒・ミリ秒をすべて切り捨て
 * - 日付差分計算（草率算出）用
 * 
 * @param {Date} date
 * @return {Date}
 */
function logNormalizeDateJST_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * 2つの Date が同じ日（JST）かどうかを判定する
 * 
 * - タイムゾーン差分を吸収するため文字列比較で実装
 * 
 * @param {Date} a
 * @param {Date} b
 * @return {boolean}
 */
function logIsSameDay_(a, b) {
  return logFormatJST_(a, 'yyyy-MM-dd') === logFormatJST_(b, 'yyyy-MM-dd');
}

/* =====================================================
 * 日付範囲計算
 * ===================================================== */
/**
 * 指定日の属する「週」の開始・終了日を返す（JST）
 *
 * - 月曜始まり
 * - end は「次週の月曜（未満）」として扱う
 *
 * @param {Date} date 基準日
 * @return {{ start: Date, end: Date }}
 */
function logGetWeekRangeJST_(date) {
  // 日付のみで正規化
  const base = logNormalizeDateJST_(date);

  // getDay(): 0=日, 1=月, ... 6=土
  const dayOfWeek = base.getDay() === 0 ? 7 : base.getDay(); // 月曜始まり

  const start = new Date(base);
  start.setDate(base.getDate() - (dayOfWeek - 1));

  const end = new Date(start);
  end.setDate(start.getDate() + 7);

  return { start, end };
}

/**
 * 草（活動ログ）の集計情報を返す
 * 
 * - 今日の記録数
 * - 今週の記録数（月曜始まり）
 * - 直近7日間の草率（アクティブ日数 / 7）
 * 
 * @param {Array<Object>} logs ログ配列（省略時は全ログ）
 * @param {Date} now 基準日時（テスト用に差し替え可能）
 * @return {{today:number, week:number, rate:number}}
 */
function logGetGrassInfo_(logs = logGetLogs_(), now = new Date()) {
  // 今週の期間
  const { start, end } = logGetWeekRangeJST_(now);

  // 今日の記録数
  const today = logs.filter(log =>
    logIsSameDay_(log.date, now)
  ).length;

  // 今週の記録数
  const week = logs.filter(log =>
    log.date >= start && log.date < end
  ).length;

  // 直近7日のアクティブ日数(1日1草としてカウント)
  const activeDays = new Set();
  logs.forEach(log => {
    const logDate = logNormalizeDateJST_(log.date);
    const today = logNormalizeDateJST_(now);

    const diffDays = (today - logDate) / LOG_DAY_MS;

    if (diffDays >= 0 && diffDays < 7) {
      activeDays.add(logFormatJST_(logDate, 'yyyy-MM-dd'));
    }
  });

  const rate = Math.round(activeDays.size / 7 * 100);

  return { today, week, rate };
}
