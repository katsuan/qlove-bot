/**
 * 60_log_router.gs：機能「📝 記録」のLINE からの文字を振り分ける（LOgBOT の 04_line/text_router.gs から）
 * 中身：handleTextMessage_（どの返事にするか）・記録しましたの返事・# なしの返事・送り主
 * 呼ばれる（LOgBOT のときのファイル名）：line_event
 */

/** 文字のメッセージを振り分けて、返事のメッセージの並びを返す（記録・コマンド・ふりかえり・管理者向け） */
function logHandleTextMessage_(event, policy) {
  if (!logIsTextMessage_(event)) {
    return logBuildUnsupportedMessageReply_(event);
  }

  const text = event.message.text.trim();
  const quickAdjust = logParseMinuteAdjustCommand_(text);
  if (quickAdjust && quickAdjust.error) {
    return [{
      type: 'text',
      text: quickAdjust.error,
      quickReply: {
        items: LOG_ADJUST_DELTAS_.map(delta =>
          logCreatePostbackAction_(`+${delta}分`, `m=log&action=adjust_minutes&delta=${delta}`, `+${delta}分`)),
      },
    }];
  }
  if (quickAdjust) {
    return logBuildMinuteAdjustReplies_(policy, quickAdjust.delta, 'chat');
  }

  if (!logIsLogTargetText_(text)) {
    return logBuildUnloggedReply_(text);
  }

  const detail = logExtractDetail_(text);

  const shorthand = logParseShorthandLineCommand_(detail);
  if (shorthand) {
    return logDispatchSessionCommand_(shorthand.command, logBuildNormalizedShorthandCommand_(shorthand), policy);
  }

  const commandEnvelope = logParseCommandEnvelope_(detail);
  if (commandEnvelope) {
    const envelopeError = logValidateCommandEnvelope_(commandEnvelope);
    if (envelopeError) return [{ type: 'text', text: envelopeError, quickReply: logBuildQuickReply_(policy) }];
    return logDispatchSessionCommand_(commandEnvelope.command, logBuildNormalizedCommandDetail_(commandEnvelope), policy);
  }

  const reportReq = logParseReportRequest_(detail);
  if (reportReq) {
    if (reportReq.kind === 'help') return [logBuildReportMenuReply_(policy)];
    if (reportReq.kind === 'attendance') {
      const report = logBuildAttendanceMonthlyWeeklyReport_(policy.userId, new Date());
      return logBuildAttendanceReportReplies_(report, policy);
    }
    if (reportReq.kind === 'trip') {
      const report = logBuildTripRecentDailyReport_(policy.userId, new Date());
      return logBuildTripReportReplies_(report, policy);
    }
  }
  if (logIsQuestCommand_(detail)) {
    return [logBuildQuestStatusReply_(policy)];
  }

  if (logIsAttendanceDetail_(detail)) {
    return logDispatchSessionCommand_('attendance', detail, policy);
  }
  if (logIsTripDetail_(detail)) {
    return logDispatchSessionCommand_('trip', detail, policy);
  }

  const saved = logFromLINE_({
    detail,
    userId: policy.userId,
    action: logInferActionFromDetail_(detail),
  }, policy);
  return [logBuildLoggedReply_(null, detail, policy, saved && saved.ID ? saved.ID : '', saved ? Number(saved.minutes) || 0 : 0)];
}

/**
 * start/end を持つコマンド（trip / attendance / その他）を実行して返信を作る
 */
function logDispatchSessionCommand_(command, detailText, policy) {
  if (command === 'attendance') {
    return [logBuildAttendanceReply_(logHandleAttendanceFromLINE_(detailText, policy), policy)];
  }
  if (command === 'trip') {
    return [logBuildTripReply_(logHandleTripFromLINE_(detailText, policy), policy)];
  }
  const result = logHandleGenericCommandFromLINE_(command, detailText, policy);
  return [logBuildGenericCommandReply_(command, result, policy)];
}

/** COMMAND 形式の必須項目を確かめ、足りなければエラーメッセージを返す */
function logValidateCommandEnvelope_(envelope) {
  if (!envelope.command) {
    return [
      'command形式の指定が不足しています。',
      '必須: command, type(start/end)',
      '例:',
      '# COMMAND',
      'command: trip',
      'type: start',
    ].join('\n');
  }
  const commandType = String(envelope.map.type || '').toLowerCase();
  if (commandType !== 'start' && commandType !== 'end') {
    return 'command形式では type:start/end が必須です';
  }
  return '';
}

/** スタンプや写真など、文字でないものへの返事（1対1のときだけ） */
function logBuildUnsupportedMessageReply_(event) {
  if (event.source.type !== 'user') return [];
  return [{
    type: 'text',
    text: '文字で送ってね。記録は「# workout」のように、先頭に # を付けます。',
    quickReply: {
      items: [
        logCreateTextAction_('💪 筋トレ', '# 💪workout'),
        logCreateTextAction_('🧑‍💻 コーディング', '# 🧑‍💻coding'),
        logCreateTextAction_('📊 ふりかえり', '# REPORT'),
      ],
    },
  }];
}

/** 「# quest」か */
function logIsQuestCommand_(detail) {
  const t = String(detail || '').trim().toLowerCase();
  return t === 'quest' || t === 'quests';
}

/** 返事の頭に付ける印（#テストの見本は 🧪、試しの人は【テスト】、ふだんは ''） */
function logBuildTestModePrefix_(policy) {
  if (policy && policy.sample) return '🧪 '; // #テスト の見本（本物とまぎれないように）
  return policy && policy.testmode ? '【テスト】\n' : '';
}

/* ==================================================
 * 通常ログ
 * ================================================== */

/** 「s charge 20%」のような短い書き方を、ふだんの本文の形にする */
function logBuildNormalizedShorthandCommand_(shorthand) {
  const iconLabel = logResolveDefaultIconLabel_(shorthand.command);
  const lines = [
    shorthand.command,
    `source: ${shorthand.command}`,
    iconLabel.icon ? `icon: ${iconLabel.icon}` : '',
    `label: ${iconLabel.label}`,
    `type: ${shorthand.mode === 's' ? 'start' : 'end'}`,
    shorthand.memo ? `memo: ${shorthand.memo}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

/** 行動の名前から、ふだんの絵文字と名前を返す（charge → 🔋 充電 など） */
function logResolveDefaultIconLabel_(command) {
  const c = String(command || '').toLowerCase();
  if (c === 'workout') return { icon: '💪', label: 'workout' };
  if (c === 'coding' || c === 'codeing') return { icon: '🧑‍💻', label: 'coding' };
  if (c === 'trip') return { icon: '🚙', label: '移動（CarPlay）' };
  if (c === 'attendance') return { icon: '🏢', label: '出退勤' };
  if (c === 'charge') return { icon: '🔋', label: '充電' };
  return { icon: '📝', label: c || '記録' };
}

/** # なしで送ったときの返事（# を付けて記録するボタンつき） */
function logBuildUnloggedReply_(text) {
  return [{
    type: 'text',
    text: '記録するときは、先頭に # を付けてね（例：# workout）。',
    quickReply: {
      items: [
        logCreateTextAction_('✅ # を付けて記録', `# ${String(text || '').slice(0, 60)}`),
        logCreateTextAction_('💪 筋トレ', '# 💪workout'),
        logCreateTextAction_('🧑‍💻 コーディング', '# 🧑‍💻coding'),
        logCreateTextAction_('📊 ふりかえり', '# REPORT'),
      ],
    },
  }];
}

/** 記録しましたのカード（+15分のボタンつき）を作る */
function logBuildLoggedReply_(grass, detail, policy, logId, base) {
  const action = logNormalizeActionName_(logInferActionFromDetail_(String(detail || '')));
  const iconLabel = logSplitLeadingIconLabel_(logSanitizeDisplayLabel_(String(detail || '')));
  const msg = logBuildLogCard_({
    tag: `${logBuildTestModePrefix_(policy)}✅ 記録しました`,
    icon: iconLabel.icon,
    title: iconLabel.label,
    notice: logBuildQuestNotice_(policy, action),
    altText: logSeasonal_(`${logBuildTestModePrefix_(policy)}記録しました：${iconLabel.label}`),
    policy,
    adjust: logId ? { logId, base: Number(base) || 0 } : null,
  });
  // カードの［+15分］と同じものを、クイックリプライにも（H2：postback なのでどちらから押してもよい）
  msg.quickReply = logBuildLoggedQuickReply_(policy, logId, logId ? Number(base) || 0 : null);
  return msg;
}

/** 見せる名前の書きまちがい（codeing）を直す */
function logSanitizeDisplayLabel_(label) {
  return String(label || '').replace(/codeing/gi, 'coding');
}

/* ==================================================
 * 送信者（sender）
 * ================================================== */

/** メッセージに送り主（名前とアイコン）を付ける（決めていなければそのまま） */
function logWithSender_(message, senderType) {
  const sender = logResolveSender_(senderType);
  if (!sender) return message;
  return { ...message, sender };
}

/** 返事の送り主（名前とアイコン）を、種類から選ぶ。なければ null */
function logResolveSender_(senderType) {
  const lineCfg = (logGetAppConfig_().line || {});
  const senderMap = lineCfg.senders || {};
  const source = senderMap[senderType] || senderMap.default || null;
  if (!source) return null;

  const name = String(source.name || '').trim();
  const iconUrl = String(source.iconUrl || '').trim();
  if (!name || !iconUrl) return null;
  return { name, iconUrl };
}
