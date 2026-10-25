/**
 * 60_log_adjust.gs：機能「📝 記録」の記録に時間を足す返事（LOgBOT の 04_line/adjust_replies.gs から）
 * 中身：postback の受け口・確かめてから足す（もう足した・古い・ほかの人）・「+15」の文字
 * 呼ばれる（LOgBOT のときのファイル名）：line_event（postback）・text_router（「+15」）
 */

/* ==================================================
 * 分数の調整（+15 など / postback）
 * ================================================== */

/** postback（カードやクイックリプライのボタン）を受ける。いまは時間を足すボタンだけ。返事のメッセージを返す */
function logHandlePostbackEvent_(event, policy) {
  const payload = logParsePostbackData_(event && event.postback ? event.postback.data : '');
  if (payload.action !== 'adjust_minutes') return [];

  const delta = Number(payload.delta || 0);
  if (!delta || LOG_ADJUST_DELTAS_.indexOf(Math.abs(delta)) < 0) {
    return [{ type: 'text', text: '足す時間が読めませんでした。もう一度、記録のカードから押してね。', quickReply: logBuildQuickReply_(policy) }];
  }
  // 記録 ID があれば、その記録だけに（もう足した・古い・ほかの人を見分ける）。ない古いボタンは、きょうの最新の記録に
  if (payload.logId) return logBuildCheckedAdjustReplies_(policy, delta, payload.logId, payload.base != null ? payload.base : null);
  return logBuildMinuteAdjustReplies_(policy, delta, 'postback', '');
}

/**
 * カードのボタンから、特定の記録に時間を足す（押されるたびに、いまの記録を見て返す。ux.md の H2）
 * - もう足してある（カードを出したときの分とちがう）→ いまの分を知らせて、足さない
 * - 古い（7日より前）・ほかの人の記録・見つからない → やさしく断る
 * - 足したら、GitHub につないでいれば同じ記録の行を書きかえる（二重には書かない）
 */
function logBuildCheckedAdjustReplies_(policy, delta, logId, base) {
  const res = logAdjustLogMinutesChecked_(logId, delta, policy.userId, base, new Date());
  const qr = logBuildQuickReply_(policy);
  if (res.status === 'missing') return [{ type: 'text', text: 'その記録は見つかりませんでした（消したのかもしれません）。', quickReply: qr }];
  if (res.status === 'other') return [{ type: 'text', text: 'ほかの人の記録なので、時間は変えられません。', quickReply: qr }];
  if (res.status === 'old') {
    const day = res.log && res.log.date ? logFormatJST_(new Date(res.log.date), 'M/d') : '';
    return [{ type: 'text', text: `この記録${day ? `（${day}）` : ''}は日がたったので、ここからは時間を変えられません。`, quickReply: qr }];
  }
  const title = logResolveLogCardTitle_(res.log);
  const iconLabel = logSplitLeadingIconLabel_(logSanitizeDisplayLabel_(title));
  if (res.status === 'done') {
    return [{
      type: 'text',
      text: `⏱ ${iconLabel.label}は、もう足してあります（いまは ${logFormatCardMinutes_(res.before)}）。\nさらに足すときは、下から押してね。`,
      quickReply: logBuildLoggedQuickReply_(policy, logId, res.before),
    }];
  }
  if (policy.canCommitGithub) {
    try {
      const target = logResolveGithubTarget_(policy);
      if (target) logUpsertLogToGithub_(res.log, target);
    } catch (e) {
      logLibraryError_('adjust_github_failed', e, {});
    }
  }
  const sign = delta > 0 ? '+' : '';
  const msg = logBuildLogCard_({
    tag: `⏱ 時間を足しました（${logFormatCardMinutes_(res.before)} → ${logFormatCardMinutes_(res.after)}）`,
    icon: iconLabel.icon,
    title: iconLabel.label,
    badge: `${sign}${delta}分`,
    altText: `${iconLabel.label}：${sign}${delta}分（${logFormatCardMinutes_(res.after)}）`,
    policy,
    adjust: { logId, base: res.after },
  });
  msg.quickReply = logBuildLoggedQuickReply_(policy, logId, res.after);
  return [msg];
}

/** 「+15」の文字（と記録 ID のない前のボタン）から、きょうの最新の記録に時間を足して返事を作る */
function logBuildMinuteAdjustReplies_(policy, delta, source, logId) {
  const adjustedById = logId ? logAdjustLogMinutesById_(logId, delta, policy.userId) : null;
  const adjusted = adjustedById || logAdjustLatestLogMinutesFromLINE_(policy.userId, delta, new Date());
  if (!adjusted) {
    return [logWithSender_({
      type: 'text',
      text: 'きょう、時間を足せる記録が見つかりませんでした。先に「# workout」のように記録してね。',
    }, 'error')];
  }

  const originalLog = adjusted.id ? logGetLogById_(adjusted.id) : null;
  const title = logResolveLogCardTitle_(originalLog);
  const iconLabel = logSplitLeadingIconLabel_(logSanitizeDisplayLabel_(title));
  const sign = delta > 0 ? '+' : '';
  const msg = logBuildLogCard_({
    tag: `⏱ 時間を足しました（${logFormatCardMinutes_(adjusted.before)} → ${logFormatCardMinutes_(adjusted.after)}）`,
    icon: iconLabel.icon,
    title: iconLabel.label,
    badge: `${sign}${delta}分`,
    altText: `${iconLabel.label}：${sign}${delta}分（${logFormatCardMinutes_(adjusted.after)}）`,
    policy,
    adjust: adjusted.id ? { logId: adjusted.id, base: adjusted.after } : null,
  });
  msg.quickReply = logBuildLoggedQuickReply_(policy, adjusted.id || logId || '', adjusted.id ? adjusted.after : null);
  return [msg];
}

/** カードの見出しに出す名前（記録の本文の1行目。移動・出退勤などは「記録更新」） */
function logResolveLogCardTitle_(log) {
  if (!log || !log.detail) return '記録更新';
  const firstLine = String(log.detail).trim().split(/\r?\n/)[0].trim();
  if (!firstLine) return '記録更新';
  if (/^(trip|attendance)\s*:/i.test(firstLine)) return '記録更新';
  return firstLine;
}
