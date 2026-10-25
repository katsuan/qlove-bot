/**
 * 60_log_command.gs：機能「📝 記録」のはじめ・おわりのある記録（充電など）（LOgBOT の 05_features/command_session.gs から）
 * 中身：充電などのはじめ・おわり・つづきの判定・メモの差
 * 呼ばれる（LOgBOT のときのファイル名）：text_router
 *
 * 未定義 command を共通セッションとして記録する
 * - type:start で開始情報を保存
 * - type:end で開始との差分を記録
 */

const LOG_COMMAND_SESSION_PREFIX_ = 'command:lastStart:';

/** 本文の「key: value」の行を { key: value } にする（英字のキーだけ） */
function logParseKeyValueDetail_(detailText) {
  const map = {};
  String(detailText || '').split(/\r?\n/).forEach(line => {
    const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) return;
    map[m[1].toLowerCase()] = m[2];
  });
  return map;
}

/** 充電などのはじめを覚えておく Script Properties のキー */
function logCommandSessionKey_(userId, command, source) {
  return `${LOG_COMMAND_SESSION_PREFIX_}${userId || 'unknown'}:${command || 'unknown'}:${source || 'unknown'}`;
}

/** 日時の文字を読む（なければいま。読めなければ null） */
function logParseAtOrNow_(atText) {
  const d = atText ? new Date(atText) : new Date();
  return isNaN(d.getTime()) ? null : d;
}

/** 充電などのはじめを覚える */
function logSaveCommandStart_(userId, command, source, data) {
  props_().setProperty(
    logCommandSessionKey_(userId, command, source),
    JSON.stringify(data),
  );
}

/** 覚えておいた充電などのはじめを読む（なければ null） */
function logLoadCommandStart_(userId, command, source) {
  const raw = props_().getProperty(
    logCommandSessionKey_(userId, command, source),
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/** 覚えておいた充電などのはじめを消す */
function logClearCommandStart_(userId, command, source) {
  props_().deleteProperty(
    logCommandSessionKey_(userId, command, source),
  );
}

/** はじめとおわりのメモの差（数なら「+60%」、文字なら似ている割合）を作る */
function logDiffMemo_(startMemo, endMemo) {
  const from = String(startMemo || '').trim();
  const to = String(endMemo || '').trim();
  const numFrom = Number(from.replace('%', ''));
  const numTo = Number(to.replace('%', ''));
  if (isFinite(numFrom) && isFinite(numTo)) {
    const delta = numTo - numFrom;
    const sign = delta > 0 ? '+' : '';
    return `${sign}${delta}${from.includes('%') || to.includes('%') ? '%' : ''}`;
  }

  if (!from && !to) return '';
  const similarity = logCalcStringSimilarityPercent_(from, to);
  return `一致度 ${similarity}%`;
}

/** 2つの文字がどれくらい似ているか（0〜100） */
function logCalcStringSimilarityPercent_(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const maxLen = Math.max(left.length, right.length);
  if (maxLen === 0) return 100;
  const dist = logLevenshteinDistance_(left, right);
  const ratio = 1 - (dist / maxLen);
  return Math.max(0, Math.round(ratio * 100));
}

/** 2つの文字のちがいの数（1字ずつ直す回数） */
function logLevenshteinDistance_(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = [];
  for (let i = 0; i <= m; i += 1) {
    dp[i] = [i];
  }
  for (let j = 1; j <= n; j += 1) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

/** その人のいちばん新しい、同じ「はじめ・おわり」の記録を返す（なければ null） */
function logFindLatestCommandLog_(userId, command, source) {
  const uid = String(userId || '');
  const expectedCommand = String(command || '').toLowerCase();
  const expectedSource = String(source || '').toLowerCase();
  const logs = logGetLogs_();
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const log = logs[i];
    if (String(log.userId || '') !== uid) continue;
    const map = logParseLogDetailMap_(log.detail || '');
    if (String(map.command || '').toLowerCase() !== expectedCommand) continue;
    if (String(map.source || '').toLowerCase() !== expectedSource) continue;
    return { log, map };
  }
  return null;
}

/** おわってすぐ（5分以内）同じものをはじめたら、前のつづきにする（つづきでなければ null） */
function logBuildResumedCommandStart_(userId, command, source, draftStart, at) {
  const recent = logFindLatestCommandLog_(userId, command, source);
  if (!recent) return null;

  const previousStartAt = new Date(recent.map.start || '');
  const previousEndAt = new Date(recent.map.end || '');
  if (isNaN(previousStartAt.getTime()) || isNaN(previousEndAt.getTime())) return null;

  const gapMs = at.getTime() - previousEndAt.getTime();
  if (gapMs < 0 || gapMs > LOG_SESSION_RESUME_WINDOW_MS_) return null;

  return {
    ...draftStart,
    label: draftStart.label || recent.map.label || command,
    icon: draftStart.icon || recent.map.icon || '',
    memo: draftStart.memo || recent.map.memo_start || '',
    at: logFormatJST_(previousStartAt, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    resumeLogId: recent.log.ID || '',
  };
}

/**
 * はじめ・おわりのある記録（充電など）を LINE から受ける
 * @return {Object} 返事を作るための結果（didLog・mode・replyText など）
 */
function logHandleGenericCommandFromLINE_(command, detailText, policy) {
  const input = logParseGenericCommandInput_(command, detailText);
  if (!input.at) return { didLog: false, mode: 'error', replyText: 'at の形式が不正です' };
  if (input.type === 'start') return logStartGenericCommand_(input, policy);
  if (input.type === 'end') return logEndGenericCommand_(input, policy);
  return { didLog: false, mode: 'error', replyText: 'type:start/end が必要です' };
}

/** 本文（key: value の行）を読む。source・label は書いていなければ command にする */
function logParseGenericCommandInput_(command, detailText) {
  const map = logParseKeyValueDetail_(detailText);
  const rawLabel = String(map.label || '');
  return {
    command,
    type: String(map.type || '').toLowerCase(),
    source: String(map.source || '') || command || 'generic',
    rawLabel,
    label: rawLabel || command || 'command',
    icon: String(map.icon || ''),
    memo: String(map.memo || ''),
    at: logParseAtOrNow_(map.at || ''),
  };
}

/** 充電などをはじめる（はじめを覚える）。返事を作るための結果を返す */
function logStartGenericCommand_(input, policy) {
  const { command, source } = input;
  const draftStart = {
    command,
    source,
    label: input.rawLabel,
    icon: input.icon,
    memo: input.memo,
    at: logFormatJST_(input.at, "yyyy-MM-dd'T'HH:mm:ssXXX"),
  };
  // おわってすぐ（5分以内）に同じものをはじめたら、前のつづきにする
  const resumedStart = logBuildResumedCommandStart_(policy.userId, command, source, draftStart, input.at);
  const activeStart = resumedStart || { ...draftStart, label: input.label };
  logSaveCommandStart_(policy.userId, command, source, activeStart);
  return {
    didLog: false,
    mode: 'start',
    command,
    source,
    label: activeStart.label,
    icon: activeStart.icon,
    memoStart: activeStart.memo,
    start: logFormatJST_(new Date(activeStart.at), 'HH:mm'),
    replyText: resumedStart ? `${activeStart.label}をつづけます` : `${activeStart.label}をはじめました`,
  };
}

/** 充電などをおわる（シートに記録して、はじめを消す）。返事を作るための結果を返す */
function logEndGenericCommand_(input, policy) {
  const { command, source, memo } = input;
  const start = logLoadCommandStart_(policy.userId, command, source);
  if (!start) return { didLog: false, mode: 'error', replyText: `直近の ${command}:start が見つかりません` };
  const startAt = new Date(start.at);
  if (isNaN(startAt.getTime())) return { didLog: false, mode: 'error', replyText: '開始時刻データが壊れています' };

  const endAt = input.at;
  const durationMs = endAt.getTime() - startAt.getTime();
  const minutes = Math.max(0, Math.round(durationMs / 60000));
  const duration = logFormatAttendanceDuration_(durationMs);
  const memoDiff = logDiffMemo_(start.memo, memo);
  const label = start.label || input.label;
  const icon = input.icon || start.icon;
  const detail = logBuildGenericCommandDetail_({ command, label, icon, source, start, endAt, duration, memo, memoDiff });

  const log = logCreateLog_({
    action: command,
    minutes,
    detail,
    source: String(policy && policy.logSource || 'LINE'),
    userId: policy.userId,
  });
  const saved = logPersistSessionLog_(log, policy, start.resumeLogId || '');
  logClearCommandStart_(policy.userId, command, source);

  return {
    didLog: true,
    mode: 'end',
    command,
    source,
    label,
    icon,
    start: logFormatJST_(startAt, 'HH:mm'),
    end: logFormatJST_(endAt, 'HH:mm'),
    duration,
    minutes,
    memoStart: start.memo || '',
    memoEnd: memo || '',
    memoDiff: memoDiff || '',
    replyText: detail,
    log: saved,
  };
}

/** シートに書く本文（この形はふりかえり・つづきの判定で読むので変えない） */
function logBuildGenericCommandDetail_(d) {
  const lines = [
    `command: ${d.command}`,
    `label: ${d.label}`,
    `icon: ${d.icon || 'n/a'}`,
    `source: ${d.source}`,
    `start: ${d.start.at}`,
    `end: ${logFormatJST_(d.endAt, "yyyy-MM-dd'T'HH:mm:ssXXX")}`,
    `duration: ${d.duration}`,
  ];
  if (String(d.start.memo || '').trim() || String(d.memo || '').trim()) {
    lines.push(`memo_start: ${d.start.memo || ''}`);
    lines.push(`memo_end: ${d.memo || ''}`);
    lines.push(`memo_diff: ${d.memoDiff || ''}`);
  }
  // 3つの型（60_log_summary.gs）：はじめ・おわりの memo が数字なら value（数値の差＋時間）、ほかは time（時間）
  const from = logNumberOf_(d.start.memo);
  const to = logNumberOf_(d.memo);
  if (from !== null && to !== null) {
    const unit = /%/.test(`${d.start.memo || ''}${d.memo || ''}`) ? '%' : '';
    lines.push('kind: value', `start_value: ${from}`, `end_value: ${to}`, `value_diff: ${Math.round((to - from) * 10) / 10}`);
    if (unit) lines.push(`unit: ${unit}`);
  } else {
    lines.push('kind: time');
  }
  return lines.join('\n');
}
