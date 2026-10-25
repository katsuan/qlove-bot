/**
 * 60_log_attendance.gs：機能「📝 記録」の出退勤（LOgBOT の 05_features/attendance.gs から）
 * 中身：出勤・退勤の記録・つづきの判定・月のふりかえりのまとめ
 * 呼ばれる（LOgBOT のときのファイル名）：text_router・report_replies
 *
 * 出退勤ログ管理
 * - type:start で開始時刻を保存
 * - type:end で直近startとの差分を計算して記録
 */

const LOG_ATTENDANCE_PROP_PREFIX_ = 'attendance:lastStart:';

/** 出退勤の本文（start・end・at・label など）を読む */
function logParseAttendanceDetail_(detailText) {
  const lines = String(detailText || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  // 1行目の「attendance」をとる（「attendance start」のように同じ行に続きがあれば、続きは残す）
  if (lines[0] && /^attendance\b/i.test(lines[0])) {
    const rest = lines[0].replace(/^attendance\b\s*/i, '');
    if (rest) lines[0] = rest;
    else lines.shift();
  }

  if (lines.length === 1) {
    const one = lines[0].toLowerCase();
    if (one === 'start' || one === 'end') {
      return { type: one, at: '', label: '' };
    }
  }

  const data = {};
  lines.forEach(line => {
    const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) return;
    data[m[1]] = m[2];
  });

  return {
    type: data.type ? String(data.type).toLowerCase() : '',
    at: data.at || '',
    icon: data.icon || '',
    label: data.label || '',
    source: data.source || 'line',
  };
}

/** 出勤のはじめを覚えておく Script Properties のキー */
function logAttendancePropKey_(userId) {
  return `${LOG_ATTENDANCE_PROP_PREFIX_}${userId || 'unknown'}`;
}

/** 出勤のはじめを覚える */
function logSaveAttendanceStart_(userId, startData) {
  props_().setProperty(logAttendancePropKey_(userId), JSON.stringify(startData));
}

/** 覚えておいた出勤のはじめを読む（なければ null） */
function logLoadAttendanceStart_(userId) {
  const raw = props_().getProperty(logAttendancePropKey_(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/** 覚えておいた出勤のはじめを消す */
function logClearAttendanceStart_(userId) {
  props_().deleteProperty(logAttendancePropKey_(userId));
}

/** 出退勤の日時の文字を読む（読めなければいま） */
function logParseAttendanceAt_(atText) {
  if (!atText) return new Date();
  const d = new Date(atText);
  if (!isNaN(d.getTime())) return d;
  return new Date();
}

/** ミリ秒 → 「1h05m」「30m」（シートに書く形。分は四捨五入） */
function logFormatAttendanceDuration_(ms) {
  return logFormatMinutesAsDuration_(Math.round(Math.max(0, ms) / 60000));
}

/** その人のいちばん新しい出退勤の記録を返す（なければ null） */
function logFindLatestAttendanceLog_(userId) {
  const uid = String(userId || '');
  const logs = logGetLogs_();
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const log = logs[i];
    if (log.action !== 'attendance') continue;
    if (String(log.userId || '') !== uid) continue;
    return log;
  }
  return null;
}

/** おわってすぐ出勤しなおしたら、前の出勤のつづきにする（つづきでなければ null） */
function logBuildResumedAttendanceStart_(userId, attendance, startAt) {
  const recent = logFindLatestAttendanceLog_(userId);
  if (!recent) return null;

  const map = logParseLogDetailMap_(recent.detail || '');
  const previousStartAt = new Date(map.start || '');
  const previousEndAt = new Date(map.end || '');
  if (isNaN(previousStartAt.getTime()) || isNaN(previousEndAt.getTime())) return null;

  const gapMs = startAt.getTime() - previousEndAt.getTime();
  if (gapMs < 0 || gapMs > LOG_SESSION_RESUME_WINDOW_MS_) return null;

  return {
    at: previousStartAt.toISOString(),
    icon: attendance.icon || map.icon || '',
    label: attendance.label || map.attendance || '出勤',
    source: attendance.source || map.source || 'line',
    resumeLogId: recent.ID || '',
    resumedFrom: logFormatJST_(previousStartAt, 'yyyy-MM-dd HH:mm'),
  };
}

/**
 * 出勤したことを GitHub に1行送る（その日に草が付く）
 * - シートには書かない（シートの出退勤は退勤の1行だけ。つづきの出勤・月のふりかえりが、その行を読む）
 * - 送れなくても出勤はできる（ログに残すだけ）
 * @return {boolean} 送ったか
 */
function logCommitAttendanceStartToGithub_(startData, startAt, policy) {
  const target = logResolveGithubTarget_(policy);
  if (!target) return false;
  const detail = [
    `attendance: ${startData.label || '出勤'}`,
    'type: start',
    `icon: ${startData.icon || 'n/a'}`,
    `source: ${startData.source || 'line'}`,
    `start: ${logFormatJST_(startAt, "yyyy-MM-dd'T'HH:mm:ssXXX")}`,
  ].join('\n');
  const log = {
    ...logCreateLog_({
      action: 'attendance',
      minutes: 0,
      detail,
      source: String(policy && policy.logSource || 'LINE'),
      userId: policy.userId,
    }),
    ID: logCreateLogId_(),
    date: startAt,
  };
  try {
    logCommitLogToGithub_(log, target);
    return true;
  } catch (e) {
    console.warn(`出勤を GitHub に送れませんでした: ${String(e)}`);
    return false;
  }
}

/** 出退勤を LINE から受ける（はじめは覚える・おわりはシートに記録）。返事を作るための結果を返す */
function logHandleAttendanceFromLINE_(detailText, policy) {
  const attendance = logParseAttendanceDetail_(detailText);
  const type = attendance.type;

  if (type === 'start') {
    const startAt = logParseAttendanceAt_(attendance.at);
    const resumed = logBuildResumedAttendanceStart_(policy.userId, attendance, startAt);
    const startData = resumed || {
      at: startAt.toISOString(),
      icon: attendance.icon || '',
      label: attendance.label || '出勤',
      source: attendance.source || 'line',
    };
    logSaveAttendanceStart_(policy.userId, startData);
    const activeStartAt = new Date(startData.at);
    // つづきの出勤は、もう送ってあるので送らない
    const github = resumed ? false : logCommitAttendanceStartToGithub_(startData, activeStartAt, policy);
    return {
      didLog: false,
      mode: 'start',
      replyText: resumed ? '出勤をつづけます' : '出勤しました。きょうもいってらっしゃい',
      start: logFormatJST_(activeStartAt, 'yyyy-MM-dd HH:mm'),
      github,
    };
  }

  if (type !== 'end') {
    return {
      didLog: false,
      mode: 'error',
      replyText: 'attendance の type は start / end で送ってください',
    };
  }

  const saved = logLoadAttendanceStart_(policy.userId);
  if (!saved) {
    return {
      didLog: false,
      mode: 'error',
      replyText: '直近の attendance:start が見つかりません',
    };
  }

  const startAt = new Date(saved.at);
  const endAt = logParseAttendanceAt_(attendance.at);
  const durationMs = endAt.getTime() - startAt.getTime();
  const minutes = Math.max(0, Math.round(durationMs / 60000));
  const duration = logFormatAttendanceDuration_(durationMs);

  const detail = [
    `attendance: ${saved.label || '出勤'}`,
    `icon: ${saved.icon || attendance.icon || 'n/a'}`,
    `source: ${saved.source || attendance.source || 'line'}`,
    `start: ${logFormatJST_(startAt, "yyyy-MM-dd'T'HH:mm:ssXXX")}`,
    `end: ${logFormatJST_(endAt, "yyyy-MM-dd'T'HH:mm:ssXXX")}`,
    `duration: ${duration}`,
  ].join('\n');

  const log = logCreateLog_({
    action: 'attendance',
    minutes,
    detail,
    source: String(policy && policy.logSource || 'LINE'),
    userId: policy.userId,
  });
  const savedLog = logPersistSessionLog_(log, policy, saved.resumeLogId || '');

  logClearAttendanceStart_(policy.userId);

  return {
    didLog: true,
    mode: 'end',
    replyText: detail,
    start: logFormatJST_(startAt, 'HH:mm'),
    end: logFormatJST_(endAt, 'HH:mm'),
    duration,
    minutes,
    label: saved.label || '出勤',
    icon: saved.icon || attendance.icon || '',
    source: saved.source || attendance.source || 'line',
  };
}

/** 記録の本文の「key: value」の行を { key: value } にする */
function logParseLogDetailMap_(detailText) {
  const map = {};
  String(detailText || '').split(/\r?\n/).forEach(line => {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) return;
    map[m[1].trim().toLowerCase()] = m[2].trim();
  });
  return map;
}

/** 今月の出退勤を、週ごとにまとめる（ふりかえり用） */
function logBuildAttendanceMonthlyWeeklyReport_(userId, now) {
  const base = now instanceof Date ? now : new Date();
  const year = Number(logFormatJST_(base, 'yyyy'));
  const month = Number(logFormatJST_(base, 'M'));
  const logs = logGetLogs_();

  const rows = logs
    .filter(log => log.action === 'attendance')
    .filter(log => String(log.userId || '') === String(userId || ''))
    .map(log => {
      const map = logParseLogDetailMap_(log.detail || '');
      const startRaw = map.start || '';
      const endRaw = map.end || '';
      const startAt = new Date(startRaw);
      const endAt = new Date(endRaw);
      if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) return null;
      const rowYear = Number(logFormatJST_(startAt, 'yyyy'));
      const rowMonth = Number(logFormatJST_(startAt, 'M'));
      if (rowYear !== year || rowMonth !== month) return null;
      return {
        date: logFormatJST_(startAt, 'M/d'),
        weekday: logFormatWeekdayJp_(startAt),
        startTime: logFormatJST_(startAt, 'HH:mm'),
        endTime: logFormatJST_(endAt, 'HH:mm'),
        earlyStart: logIsEarlyStart_(startAt),
        weekKey: logFormatJST_(logGetWeekRangeJST_(startAt).start, 'yyyy-MM-dd'),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.date > b.date ? 1 : -1));

  const weekMap = {};
  rows.forEach(row => {
    if (!weekMap[row.weekKey]) weekMap[row.weekKey] = [];
    weekMap[row.weekKey].push(row);
  });

  const weekKeys = Object.keys(weekMap).sort();
  const weeks = weekKeys.map((key, index) => ({
    index: index + 1,
    weekStart: key,
    rows: weekMap[key],
  }));

  return {
    year,
    month,
    weeks,
    count: rows.length,
  };
}

/** 日付の曜日（日〜土）を返す */
function logFormatWeekdayJp_(date) {
  const jp = ['日', '月', '火', '水', '木', '金', '土'];
  return jp[date.getDay()];
}

/** 8:15 より前の出勤か */
function logIsEarlyStart_(date) {
  const h = Number(logFormatJST_(date, 'H'));
  const m = Number(logFormatJST_(date, 'm'));
  return h < 8 || (h === 8 && m < 15);
}
