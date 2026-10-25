/**
 * 60_log_quick.gs：機能「📝 記録」のクイックリプライ（LOgBOT の 04_line/quick_reply.gs から）
 * 中身：いつものクイックリプライ・記録したときの +15分・ボタンの data・管理画面の URL
 * 呼ばれる（LOgBOT のときのファイル名）：返事を作るファイル
 */

/** クイックリプライの「押すと URL を開く」を作る */
function logCreateUriAction_(label, uri) {
  return {
    type: 'action',
    action: {
      type: 'uri',
      label,
      uri,
    },
  };
}

/** クイックリプライの「押すと文字を送る」を作る */
function logCreateTextAction_(label, text) {
  return {
    type: 'action',
    action: {
      type: 'message',
      label,
      text,
    },
  };
}

/** いつものクイックリプライ（おわる・筋トレ・コーディング・草・ふりかえり・設定）を作る */
function logBuildQuickReply_(policy) {
  const cfg = logGetAppConfig_();
  const grassUrl = cfg.github && cfg.github.grassUrl ? cfg.github.grassUrl : '';
  const items = [];
  const ongoingInfos = logGetOngoingSessionInfos_(policy.userId || '');

  // つづいている「はじめ・おわり」があれば、おわりを先に
  if (ongoingInfos.length) {
    const endTarget = logPickPrimaryOngoingSession_(ongoingInfos);
    items.push(logCreateTextAction_(`🏁 ${logResolveDefaultIconLabel_(endTarget.command).label}をおわる`.slice(0, 20), logBuildEndCommandText_(endTarget)));
  }
  items.push(logCreateTextAction_('💪 筋トレ', '# 💪workout'));
  items.push(logCreateTextAction_('🧑‍💻 コーディング', '# 🧑‍💻coding'));
  if (policy.canCommitGithub && grassUrl) {
    items.push(logCreateUriAction_('🌱 草を見る', grassUrl));
  }
  // 打ちこむ言葉を覚えなくても押せるように（H10）
  items.push(logCreateTextAction_('📊 ふりかえり', '# REPORT'));
  if (policy.isOwner) items.push(logCreateTextAction_('⚙️ 設定', '# 設定'));
  return { items };
}

/** つづいている「はじめ・おわり」のうち、先に出すもの（移動 → 出退勤 → ほか）を選ぶ */
function logPickPrimaryOngoingSession_(infos) {
  const preferred = ['trip', 'attendance'];
  for (let i = 0; i < preferred.length; i += 1) {
    const found = infos.find(v => v.command === preferred[i]);
    if (found) return found;
  }
  return infos[0];
}

/**
 * 「# COMMAND」形式のメッセージ本文を作る（空の項目は省く）
 *
 * @param {{command: string, source?: string, icon?: string, label?: string, type: string}} info
 */
function logBuildCommandText_(info) {
  return [
    '# COMMAND',
    `command: ${info.command}`,
    info.source ? `source: ${info.source}` : '',
    info.icon ? `icon: ${info.icon}` : '',
    info.label ? `label: ${info.label}` : '',
    `type: ${info.type}`,
  ].filter(Boolean).join('\n');
}

/** つづいているものを「おわる」ときに送る文を作る */
function logBuildEndCommandText_(info) {
  return logBuildCommandText_({ ...info, type: 'end' });
}

/**
 * 時間を足すボタンの data。記録 ID と、カードを出したときの分（base）を入れる
 * 押されたとき、いまの分が base とちがえば「もう足してある」（2回押されても二重に足さない）
 */
function logAdjustPostbackData_(delta, logId, base) {
  const parts = [`m=log&action=adjust_minutes`, `delta=${delta}`];
  if (logId) parts.push(`logId=${encodeURIComponent(String(logId))}`);
  if (base != null && base !== '') parts.push(`base=${Number(base) || 0}`);
  return parts.join('&');
}

const LOG_ADJUST_DELTAS_ = [15, 30, 60];

/** 記録したときのクイックリプライ（+15分などの postback と、いつものもの。7つまで） */
function logBuildLoggedQuickReply_(policy, logId, base) {
  const base0 = logBuildQuickReply_(policy).items || [];
  const timeActions = LOG_ADJUST_DELTAS_.map(delta =>
    logCreatePostbackAction_(`+${delta}分`, logAdjustPostbackData_(delta, logId, base), `+${delta}分`));
  // 記録のカードにはもう「📊 ふりかえり」のボタンがあるので重ねない。多すぎないよう7つまで（H3）
  return { items: timeActions.concat(base0.filter(i => i.action.text !== '# REPORT')).slice(0, 7) };
}

/** クイックリプライの postback（押すとボットに data が届く）を作る */
function logCreatePostbackAction_(label, data, displayText) {
  return {
    type: 'action',
    action: {
      type: 'postback',
      label,
      data,
      displayText: displayText || label,
    },
  };
}
