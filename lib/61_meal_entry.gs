/**
 * 61_meal_entry.gs：機能「🍚 しょくじ」の、決めた時間の知らせとシートの手直し（食事記録ボットの 01_entry.gs から）
 *   mealHourly_ … くらぶボットの1時間おきの見張りから。20時の回だけ、きょうの記録がない人（受けとると決めた人）に知らせる
 *   mealOnEdit_ … 入口の onEdit から（くらぶボットのシートを手で直したとき）。MYメニューのシートだけ見る
 * 前の doGet・doPost は、くらぶボットの受け口（01_router.gs）にまとめた
 * 呼ばれるところ：61_meal.gs の hourly・onEdit
 */

const MEAL_REMINDER_HOUR = 20;

// 1時間おきの見張り：20時の回だけ、きょうの記録がない人にだけ知らせる。押せばすぐ記録できる よく記録するもの をクイックリプライに。
// 受けとるのは、しょくじの設定で「お知らせ」をオンにした人だけ（notify。送れる数を分け合うため。急ぎでない知らせ）。
// 何日続けて知らせたか（MEAL_REMINDER_STREAKS）は、全員分を読んで、最後に1回だけ書く
function mealHourly_(now) {
  const result = { checked: 0, sent: 0, failed: 0, skippedForQuota: 0 };
  const at = now instanceof Date ? now : new Date();
  if (Number(Utilities.formatDate(at, MEAL_APP_TIMEZONE, 'H')) !== MEAL_REMINDER_HOUR) return result;
  mealEnsureProjectSetup_();
  const todayKey = mealBuildScriptDateKey_(at);
  const streaks = mealGetReminderStreaks_();
  const before = JSON.stringify(streaks);
  mealListUsers_()
    .filter(user => user.notify === true)
    .filter(user => canUse_(user.userId))
    .forEach(user => {
      result.checked += 1;
      if (mealGetMealLogsByUserAndDate_(user.userId, at).length > 0) {
        delete streaks[user.userId];
        return;
      }
      if (!hasPushRoom_('normal')) {
        result.skippedForQuota += 1;
        return;
      }
      if (!push_(user.userId, mealBuildReminderMessages_(user), 'normal')) {
        result.failed += 1;
        return;
      }
      result.sent += 1;
      const streakState = mealMarkReminderNotificationSent_(streaks, user.userId, todayKey);
      if (streakState.shouldNotifyAdmin) {
        mealNotifyAdminsOfReminderStreak_(user, streakState.consecutiveReminderDays);
      }
    });
  if (JSON.stringify(streaks) !== before) mealSetReminderStreaks_(streaks);
  return result;
}

// シートを手で直したとき：MYメニューのシートなら、控えを消して、つながっている記録の数字を合わせる
function mealOnEdit_(e) {
  const sheet = e && e.range ? e.range.getSheet() : null;
  if (!sheet || sheet.getName() !== MEAL_SHEET.NUTRITION_MASTER) return;

  mealRefreshNutritionMasterCache_();
  mealReapplyNutritionMaster_();
}
