/**
 * 60_log_quest.gs：機能「📝 記録」のクエスト（LOgBOT の 05_features/quest.gs から）
 * 中身：毎日1本と今週のクエストの進み方・つづいた数
 * 呼ばれる（LOgBOT のときのファイル名）：カード・# quest・決めた時間の知らせ
 *
 * デイリー/ウィークリークエスト集計。
 * - Daily: 1日1本（固定）
 * - Weekly: ユーザー設定（LIFF想定）
 */

const LOG_QUESTS_PROP_PREFIX_ = 'quests:user:';


/** その人の今週のクエストの設定を読む（なければ、ふだんの coding・workout 週1回） */
function logGetQuestSettingsForUser_(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return [];
  const raw = props_().getProperty(`${LOG_QUESTS_PROP_PREFIX_}${uid}`);
  if (!raw) {
    // デフォルト: 1日1 coding / 1日1 workout
    return [
      { id: 'weekly_coding', type: 'weekly', action: 'coding', targetPerWeek: 1, enabled: true },
      { id: 'weekly_workout', type: 'weekly', action: 'workout', targetPerWeek: 1, enabled: true },
    ];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(q => ({
      id: String(q.id || ''),
      type: 'weekly',
      action: logNormalizeActionName_(q.action),
      targetPerWeek: Math.max(1, Number(q.targetPerWeek || q.targetPerDay) || 1),
      enabled: q.enabled !== false,
    }));
  } catch (e) {
    return [];
  }
}

/** その人のクエストの進み方（毎日1本・今週のクエスト）をまとめる */
function logGetQuestStatusForUser_(userId, now) {
  const base = now instanceof Date ? now : new Date();
  const logs = logGetLogs_();

  // Daily fixed quest
  const todayKey = logFormatJST_(base, 'yyyy-MM-dd');
  const todayCount = logs.filter(log =>
    String(log.userId || '') === String(userId || '') && logIsSameDay_(log.date, base)
  ).length;
  const dailyKeys = logGetDailyActiveKeysForUser_(logs, userId);
  const dailyStreak = logGetDateStreakStats_(dailyKeys, base);
  const daily = {
    id: 'daily_one_log',
    title: '1日1本',
    done: todayCount >= 1,
    progressText: `${Math.min(todayCount, 1)}/1`,
    currentStreak: dailyStreak.current,
    bestStreak: dailyStreak.best,
  };

  // Weekly user quests
  const settings = logGetQuestSettingsForUser_(userId).filter(q => q.enabled);
  const weekRange = logGetWeekRangeJST_(base);
  const weekLogs = logs.filter(log =>
    String(log.userId || '') === String(userId || '') &&
    log.date >= weekRange.start &&
    log.date < weekRange.end
  );

  const weekly = settings.map(q => {
    const weeklyTarget = Math.max(1, Number(q.targetPerWeek) || 1);
    const weeklyCount = weekLogs.filter(log => logNormalizeActionName_(log.action) === q.action).length;
    const weekDone = weeklyCount >= weeklyTarget;
    const weekStreak = logGetWeeklyQuestStreakStats_(logs, userId, q, base);
    const doneDateKeys = logGetActionDateKeys_(logs, userId, q.action);
    const lastDoneDate = doneDateKeys.length ? doneDateKeys[doneDateKeys.length - 1] : '';
    const validRemainingDays = logComputeValidRemainingDays_(lastDoneDate, base, 7);
    return {
      id: q.id,
      action: q.action,
      title: `${q.action} ${weeklyTarget}/週`,
      progressText: `${Math.min(weeklyCount, weeklyTarget)}/${weeklyTarget}`,
      done: weekDone,
      weekComplete: weekDone,
      currentStreak: weekStreak.current,
      bestStreak: weekStreak.best,
      lastDoneDate,
      validRemainingDays,
    };
  });

  return { daily, weekly, todayKey };
}

/** 最後にできた日から、あと何日でクエストが切れるか */
function logComputeValidRemainingDays_(dateKey, now, windowDays) {
  if (!dateKey) return 0;
  const last = new Date(`${dateKey}T00:00:00+09:00`);
  if (isNaN(last.getTime())) return 0;
  const base = new Date(logFormatJST_(now, 'yyyy-MM-dd') + 'T00:00:00+09:00');
  const diff = Math.floor((base.getTime() - last.getTime()) / (24 * 60 * 60 * 1000));
  const remain = Number(windowDays || 7) - diff;
  return Math.max(0, remain);
}

/** その人がその行動を記録した日（yyyy-MM-dd）の並びを返す */
function logGetActionDateKeys_(logs, userId, action) {
  const uid = String(userId || '');
  const act = logNormalizeActionName_(action);
  const set = new Set();
  logs.forEach(log => {
    if (String(log.userId || '') !== uid) return;
    if (logNormalizeActionName_(log.action) !== act) return;
    set.add(logFormatJST_(log.date, 'yyyy-MM-dd'));
  });
  return Array.from(set).sort();
}

/** 今週のクエストが何週つづいているか（いま・いちばん） */
function logGetWeeklyQuestStreakStats_(logs, userId, quest, now) {
  const uid = String(userId || '');
  const action = logNormalizeActionName_(quest.action);
  const target = Math.max(1, Number(quest.targetPerWeek) || 1);
  const weekCountMap = {};
  logs.forEach(log => {
    if (String(log.userId || '') !== uid) return;
    if (logNormalizeActionName_(log.action) !== action) return;
    const wk = logGetWeekRangeJST_(log.date);
    const key = logFormatJST_(wk.start, 'yyyy-MM-dd');
    weekCountMap[key] = (weekCountMap[key] || 0) + 1;
  });

  const qualifiedWeekKeys = Object.keys(weekCountMap)
    .filter(k => (weekCountMap[k] || 0) >= target)
    .sort();
  if (!qualifiedWeekKeys.length) return { current: 0, best: 0 };

  const qualifiedSet = new Set(qualifiedWeekKeys);
  const currentWeekStart = logGetWeekRangeJST_(now).start;
  let current = 0;
  for (let i = 0; i < 104; i += 1) {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() - (7 * i));
    const key = logFormatJST_(d, 'yyyy-MM-dd');
    if (!qualifiedSet.has(key)) break;
    current += 1;
  }

  let best = 0;
  let run = 0;
  let prev = null;
  qualifiedWeekKeys.forEach(k => {
    const d = new Date(`${k}T00:00:00+09:00`);
    if (!prev) {
      run = 1;
    } else {
      const diff = Math.round((d.getTime() - prev.getTime()) / (7 * 24 * 60 * 60 * 1000));
      run = diff === 1 ? run + 1 : 1;
    }
    if (run > best) best = run;
    prev = d;
  });
  return { current, best };
}

/** その人が何か記録した日（yyyy-MM-dd）の並びを返す */
function logGetDailyActiveKeysForUser_(logs, userId) {
  const uid = String(userId || '');
  const set = new Set();
  logs.forEach(log => {
    if (String(log.userId || '') !== uid) return;
    set.add(logFormatJST_(log.date, 'yyyy-MM-dd'));
  });
  return Array.from(set).sort();
}

/** 日の並びから、何日つづいているか（いま・いちばん）を数える */
function logGetDateStreakStats_(dateKeys, now) {
  if (!dateKeys.length) return { current: 0, best: 0 };
  const keySet = new Set(dateKeys);
  let current = 0;
  for (let i = 0; i < 400; i += 1) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const k = logFormatJST_(d, 'yyyy-MM-dd');
    if (!keySet.has(k)) break;
    current += 1;
  }
  let best = 0;
  let run = 0;
  let prev = null;
  dateKeys.forEach(k => {
    const d = new Date(`${k}T00:00:00+09:00`);
    if (!prev) {
      run = 1;
    } else {
      const diff = Math.round((d.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000));
      run = diff === 1 ? run + 1 : 1;
    }
    if (run > best) best = run;
    prev = d;
  });
  return { current, best };
}

// NOTE:
// Weekly questの progress は「今週の達成日数(0-7)」、
// streak は「その action を targetPerDay 以上達成した日の連続日数」で計算する。
