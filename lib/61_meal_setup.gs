/**
 * 61_meal_setup.gs：しょくじのシートがそろっているかの確かめと、20時のお知らせの中身（食事記録ボットの 09_setup.gs・00_run.gs から）
 * 前の「配布用シートの持ち主の受けつけ」（adoptShoqujiOwner）は、くらぶボットの持ち主の決め方（#持ち主 → adoptOwner）にまとめた
 * 呼ばれるところ：しょくじの機能のどこからでも（mealEnsureProjectSetup_）・61_meal.gs の見張り
 */

// シートがそろっているかの確かめは、呼び出しのたびにすると遅いので6時間に1回だけ
// （シートを手で消したときは setupProject() を実行しなおす）
// 列を増やしたときは、すぐ確かめなおすよう、鍵に列の数を入れる
const MEAL_SETUP_CHECKED_CACHE_KEY = `SETUP_CHECKED_${MEAL_USER_COLUMNS.length}_${MEAL_LOG_COLUMNS.length}_${MEAL_NUTRITION_MASTER_COLUMNS.length}`;

// シートがそろっているかを確かめる（6時間に1回だけ。足りなければ作る）
function mealEnsureProjectSetup_() {
  mealMemo_('setupChecked', () => {
    const cache = cache_();
    if (cache.get(MEAL_SETUP_CHECKED_CACHE_KEY)) return true;
    mealSetupProject_();
    cache.put(MEAL_SETUP_CHECKED_CACHE_KEY, '1', 21600);
    return true;
  });
}

// 文はクイックリプライが消えても通じるように（名前を送れば記録できる）
function mealBuildReminderMessages_(user) {
  return mealBuildReminderMessagesFor_(mealGetQuickMenus_(user, mealGetPopularMenusByUser_(user.userId, 12), MEAL_QUICK_MENUS_LIMIT));
}

// よく記録するものを渡して作る（#テスト の見本でも使う）
function mealBuildReminderMessagesFor_(quickMenus) {
  return mealAttachQuickMenus_([{
    type: 'text',
    text: '20時になりました。きょうの記録がまだです。食べたものの名前を送ると記録できます。',
  }], { quickMenus: quickMenus });
}

// シート（meal_users・meal_logs・nutrition_master）がなければ作り、見出しをそろえる
function mealSetupProject_() {
  const spreadsheet = mealGetSpreadsheet_();
  mealEnsureSheet_(spreadsheet, MEAL_SHEET.USERS, MEAL_USER_COLUMNS);
  mealEnsureSheet_(spreadsheet, MEAL_SHEET.MEAL_LOGS, MEAL_LOG_COLUMNS);
  mealEnsureSheet_(spreadsheet, MEAL_SHEET.NUTRITION_MASTER, MEAL_NUTRITION_MASTER_COLUMNS);
}

// シートがなければ作り、1行目の見出しをそろえる
function mealEnsureSheet_(spreadsheet, name, columns) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  const header = sheet.getRange(1, 1, 1, columns.length).getValues()[0];
  const sameHeader = columns.every((column, index) => header[index] === column);

  if (!sameHeader) {
    sheet.getRange(1, 1, 1, columns.length).setValues([columns]); // qcheck-ok: G1 決まった見出しだけ
  }

  if (sheet.getFrozenRows() !== 1) {
    sheet.setFrozenRows(1);
  }
}

// streaks（REMINDER_STREAKS の中身）を直すだけ。書くのは呼んだ側
function mealMarkReminderNotificationSent_(streaks, userId, dateKey) {
  const normalizedUserId = String(userId || '').trim();
  const normalizedDateKey = String(dateKey || '').trim() || mealBuildScriptDateKey_(new Date());
  const current = streaks[normalizedUserId] || {};

  if (current.lastReminderDate === normalizedDateKey) {
    return {
      consecutiveReminderDays: Number(current.consecutiveReminderDays || 0),
      shouldNotifyAdmin: false,
    };
  }

  const consecutiveReminderDays = current.lastReminderDate === mealGetPreviousDateKey_(normalizedDateKey)
    ? Number(current.consecutiveReminderDays || 0) + 1
    : 1;

  const shouldNotifyAdmin = consecutiveReminderDays >= 7 && current.lastAdminAlertDate !== normalizedDateKey;
  streaks[normalizedUserId] = {
    lastReminderDate: normalizedDateKey,
    consecutiveReminderDays: consecutiveReminderDays,
    lastAdminAlertDate: shouldNotifyAdmin ? normalizedDateKey : String(current.lastAdminAlertDate || ''),
  };

  return {
    consecutiveReminderDays: consecutiveReminderDays,
    shouldNotifyAdmin: shouldNotifyAdmin,
  };
}

// 20時のお知らせを何日も続けて送った人がいたら、持ち主へ知らせる（push。急ぎでない知らせ。LINE の ID は書かない）
function mealNotifyAdminsOfReminderStreak_(user, consecutiveDays) {
  const adminIds = mealGetAdminUserIds_().filter(adminUserId => adminUserId !== String(user && user.userId || ''));
  if (!adminIds.length || !mealGetLineChannelAccessToken_()) return;

  const displayName = String(user && user.displayName || '').trim() || '未設定';
  const days = Number(consecutiveDays || 0);
  const message = {
    type: 'text',
    text: [
      `🍚 「${displayName}」さんは、${days}日つづけて、20時までに食事の記録がありません。`,
      '20時の知らせを送りつづけています（受けとるかは、その人のしょくじの設定で変えられます）。',
    ].join('\n'),
  };

  adminIds.forEach(adminUserId => {
    try {
      push_(adminUserId, [message], 'normal');
    } catch (error) {
      // 知らせられなくても止めない
    }
  });
}

