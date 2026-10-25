/**
 * 60_log_close.gs：機能「📝 記録」の、おわり忘れ（はじめから12時間たっても「おわり」が来ないもの）を、見張りで自動でおわらせる
 *   出退勤（attendance:lastStart:<ID>）・移動（trip:lastStart:<ID>:<source>）・充電など（command:lastStart:<ID>:<command>:<source>）。
 *   はじめは、つづいているあいだスクリプト プロパティにある（60_log_attendance・60_log_trip・60_log_command）。
 *   おわりの時刻は「はじめから12時間」にして、ふだんの「おわり」と同じ道で記録する（時間は12時間で切る）。
 *   その人（持ち主か、許した人）に「おわっていなかったので、おわりにしました」を1回だけ知らせる（急ぎでない知らせ）
 * 呼ばれるところ：60_log_entry.gs の logHourly_（1時間おきの見張り）
 */

const LOG_FORGOT_HOURS_ = 12;

/** おわり忘れを見つけて、おわらせる。おわらせた数を返す */
function logCloseForgottenSessions_(now) {
  const at = now instanceof Date ? now : new Date();
  const all = props_().getProperties();
  let closed = 0;
  Object.keys(all).forEach((key) => {
    const parts = key.split(':');
    const kind = parts[0];
    if (parts[1] !== 'lastStart' || ['attendance', 'trip', 'command'].indexOf(kind) < 0) return;
    const userId = parts[2] || '';
    if (!/^U[0-9a-f]{32}$/.test(userId)) return;
    let start = null;
    try {
      start = JSON.parse(all[key]);
    } catch (error) {
      return;
    }
    const startAt = new Date(start && start.at);
    if (isNaN(startAt.getTime()) || at.getTime() - startAt.getTime() < LOG_FORGOT_HOURS_ * 3600000) return;
    const endIso = logFormatJST_(new Date(startAt.getTime() + LOG_FORGOT_HOURS_ * 3600000), "yyyy-MM-dd'T'HH:mm:ssXXX");
    const isOwner = userId === ownerUserId_();
    const policy = { userId, isOwner, canCommitGithub: isOwner, logSource: 'AUTO' };
    let name = '';
    try {
      if (kind === 'attendance') {
        logHandleAttendanceFromLINE_(['attendance', 'type: end', `at: ${endIso}`].join('\n'), policy);
        name = '出退勤';
      } else if (kind === 'trip') {
        const source = parts.slice(3).join(':') || 'carplay';
        logHandleTripFromLINE_(['trip', `source: ${source}`, 'type: end', `at: ${endIso}`].join('\n'), policy);
        name = '移動';
      } else {
        const command = parts[3] || '';
        const source = parts.slice(4).join(':') || command;
        logHandleGenericCommandFromLINE_(command, [command, `source: ${source}`, 'type: end', `at: ${endIso}`].join('\n'), policy);
        name = logResolveDefaultIconLabel_(command).label || command;
      }
    } catch (error) {
      writeLog_('log:close', error.message);
      return;
    }
    // ふだんの道でおわらなかったとき（はじめが消えていない）は、はじめを消して止める（毎時くり返さないように）
    if (props_().getProperty(key)) props_().deleteProperty(key);
    closed += 1;
    if (canUse_(userId)) {
      logPushMessages_(userId, [{
        type: 'text',
        text: `⏱ 「${name}」がおわっていなかったので、はじめから${LOG_FORGOT_HOURS_}時間でおわりにしました（${logFormatJST_(startAt, 'M/d H:mm')} から）。\nつぎは、おわったときに「おわり」を送ってね。`,
      }]);
    }
  });
  return closed;
}
