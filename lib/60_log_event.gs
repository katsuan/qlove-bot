/**
 * 60_log_event.gs：機能「📝 記録」の入口の GAS から呼ぶ、LINE のイベントの受け口（LOgBOT の 04_line/line_event.gs から）
 * 中身：handleLineEvent（文字・postback を振り分ける）・前からの約束の関数
 * 呼ばれる（LOgBOT のときのファイル名）：入口の GAS（handleLineEvent）
 */

/** 入口から呼ぶ：LINE のイベント1つを受けて、返事のメッセージの並びを返す（失敗したら、やさしい文1つ） */
function logHandleLineEvent_(event, policy) {
  try {
    if (!event) return [];
    logRegisterUserIfNeeded_(event, policy || {});
    if (event.type === 'message') return logHandleTextMessage_(event, policy || {});
    if (event.type === 'postback') return logHandlePostbackEvent_(event, policy || {});
    return [];
  } catch (err) {
    logLibraryError_('handle_line_event_failed', err, { event, policy });
    const msg = {
      type: 'text',
      text: logBuildLibraryErrorMessage_(err),
    };
    if (typeof logWithSender_ === 'function') {
      return [logWithSender_(msg, 'error')];
    }
    return [msg];
  }
}

/** 入口から呼ぶ（前からの約束）：その人が、きょう LINE から記録したか */
function logHasTodayLineActivity_(userId, now) {
  const base = now instanceof Date ? now : new Date();
  const logs = logGetLogs_();
  return logs.some(log => {
    if (log.source !== 'LINE') return false;
    if ((log.userId || '') !== String(userId || '')) return false;
    return logIsSameDay_(log.date, base);
  });
}


/** 入口から呼ぶ（前からの約束）：記録がない日の短い知らせの文を作る */
function logBuildDailyReminderMessages_(policy, now) {
  const date = now instanceof Date ? now : new Date();
  const timeLabel = policy && policy.reminderHour ? policy.reminderHour : '20:00';
  const prefix = policy && policy.canCommitGithub ? '記録するとGitHubにも反映されます。' : '';

  return [{
    type: 'text',
    text: [
      `${logFormatJST_(date, 'M/d')} ${timeLabel} のリマインド`,
      '今日はまだ記録がありません。',
      '# を付けて1行送ると記録されます。',
      prefix,
    ].filter(Boolean).join('\n'),
  }];
}

/**
 * LINE に返すエラーの文（中身は出さない。中身は実行ログと LAST_LINE_ERRORS に）
 */
function logBuildLibraryErrorMessage_(err) {
  return [
    '🚨 うまく記録できませんでした。',
    '時間をおいて、もう一度送ってください。',
  ].join('\n');
}


