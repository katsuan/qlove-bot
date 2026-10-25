/**
 * 60_log_sessions.gs：機能「📝 記録」のはじめ・おわりのある記録の返事（LOgBOT の 04_line/session_replies.gs から）
 * 中身：移動・出退勤・充電などの、はじめたとき・おわったとき・まちがいの返事
 * 呼ばれる（LOgBOT のときのファイル名）：text_router
 */

/* ==================================================
 * start / end コマンド（trip / attendance / 汎用）
 * ================================================== */

/** 移動の返事（はじめは短い1行・おわりはカード・まちがいは直し方つきの文） */
function logBuildTripReply_(tripResult, policy) {
  const prefix = logBuildTestModePrefix_(policy);
  if (!tripResult.didLog && tripResult.mode === 'start') {
    // はじめ（いってらっしゃい）はカードにしない。短い1行だけ（運転中にトークを長くしない）
    const resumed = String(tripResult.replyText || '').indexOf('継続') >= 0;
    const text = resumed ? `${prefix}🚙 前の移動のつづきにします` : logSeasonal_(`${prefix}🚙 いってらっしゃい。気をつけてね`);
    return logWithSender_({ type: 'text', text, quickReply: logBuildQuickReply_(policy) }, 'start');
  }
  if (!tripResult.didLog) {
    return logBuildCommandErrorReply_(prefix, 'trip', '移動', tripResult.replyText, policy);
  }
  return logWithSender_(logBuildTripResultFlexReply_(prefix, tripResult.replyText, policy), 'end');
}

/** 移動を記録したときのカード（時刻・時間・距離・速さ）を作る */
function logBuildTripResultFlexReply_(prefix, tripDetailText, policy) {
  const trip = logParseTripResultText_(tripDetailText);
  const title = logTripTitle_(trip.title, trip.source);
  const icon = trip.icon && trip.icon !== 'n/a' ? trip.icon : '🚙';
  return logBuildLogCard_({
    tag: `${prefix}🚙 移動を記録しました`,
    icon,
    title,
    rows: [
      logBuildInfoLine_([
        `${trip.startTime || '-'} → ${trip.endTime || '-'}（${logJpDuration_(trip.duration)}）`,
        trip.distance && trip.distance !== 'n/a' ? trip.distance : '',
        trip.avg && trip.avg !== 'n/a' ? `平均 ${trip.avg}` : '',
      ].filter(Boolean).join('・')),
    ],
    altText: logSeasonal_(`${prefix}移動：${trip.startTime || '-'}〜${trip.endTime || '-'} ${trip.distance && trip.distance !== 'n/a' ? trip.distance : ''}`.trim()),
    policy,
    senderType: 'end',
  });
}

/** 移動の名前（なければ「移動」。carplay は CarPlay に） */
function logTripTitle_(title, source) {
  const t = String(title || '').trim();
  if (t && t !== 'n/a' && t.toLowerCase() !== 'carplay') return t;
  return String(source || t).toLowerCase() === 'carplay' ? '移動（CarPlay）' : '移動';
}

/** 出退勤の返事（はじめ・おわり・まちがい）を作る */
function logBuildAttendanceReply_(result, policy) {
  return logBuildSessionCommandReply_(result, policy, {
    command: 'attendance',
    tag: '🏢 出退勤',
    loggedTag: '🏢 おつかれさまでした',
    pendingTitle: result.mode === 'start' ? '出勤しました' : '出退勤',
    defaultLabel: '出退勤',
    loggedAltText: `出退勤：${result.start}〜${result.end}（${logJpDuration_(result.duration)}）`,
  });
}

// 英語の名前で届いたときに、カードに出す名前（CarPlay・ショートカットは label: Battery などで送ってくる）
const LOG_LABEL_JA_ = { battery: '充電', charge: '充電', carplay: '移動（CarPlay）', attendance: '出退勤' };

/** 名前が英語の決まった言葉なら、日本語の名前にする（ほかはそのまま） */
function logJaLabel_(label) {
  const t = String(label || '').trim();
  return LOG_LABEL_JA_[t.toLowerCase()] || t;
}

/** 充電などの「はじめ・おわり」の返事（はじめ・おわり・まちがい）を作る */
function logBuildGenericCommandReply_(command, result, policy) {
  result = Object.assign({}, result, { label: logJaLabel_(result.label) });
  return logBuildSessionCommandReply_(result, policy, {
    command,
    tag: '⏱ はじめ・おわり',
    loggedTag: '⏱ 記録しました',
    pendingTitle: result.label || command,
    defaultLabel: command,
    loggedAltText: `${result.label || command}：${result.start || '-'}〜${result.end || '-'}（${logJpDuration_(result.duration)}）`,
  });
}

/**
 * start/end コマンドの返信（開始・エラー時の1枚、完了時のカルーセル）
 *
 * @param {Object} result handle*FromLINE_ の戻り値
 * @param {Object} policy
 * @param {{command: string, tag: string, pendingTitle: string, defaultLabel: string,
 *   statsLabel: string, loggedAltText: string}} spec
 */
function logBuildSessionCommandReply_(result, policy, spec) {
  const prefix = logBuildTestModePrefix_(policy);
  if (!result.didLog) {
    return logBuildSessionPendingReply_(prefix, result, policy, spec);
  }

  const hasMemo = !!(String(result.memoStart || '').trim() || String(result.memoEnd || '').trim());
  const memoText = hasMemo
    ? `${result.memoStart || '-'} → ${result.memoEnd || '-'}${result.memoDiff ? `（${result.memoDiff}）` : ''}`
    : '';
  const rows = [logBuildInfoLine_(`${result.start || '-'} → ${result.end || '-'}（${logJpDuration_(result.duration)}）`)];
  if (hasMemo) rows.push({ type: 'text', text: `メモ：${memoText}`, size: 'sm', color: '#4f5d78', wrap: true });
  return logBuildLogCard_({
    tag: `${prefix}${spec.loggedTag}`,
    icon: result.icon,
    title: result.label || spec.defaultLabel,
    rows,
    altText: logSeasonal_(`${prefix}${spec.loggedAltText}`),
    policy,
    senderType: 'end',
  });
}

/** はじめたときのカード（おわるボタンつき）を作る。まちがいなら文で返す */
function logBuildSessionPendingReply_(prefix, result, policy, spec) {
  const isStart = result.mode === 'start';
  if (!isStart) return logBuildCommandErrorReply_(prefix, spec.command, result.label || spec.pendingTitle || spec.defaultLabel, result.replyText, policy);
  const bodyItems = [
    { type: 'text', text: `${prefix}${result.replyText}`, wrap: true, size: 'md', color: '#22314f' },
  ];
  if (result.start) {
    bodyItems.push({ type: 'text', text: `はじめ：${result.start}`, wrap: true, size: 'sm', color: '#5f6f8a' });
  }
  if (result.memoStart) {
    bodyItems.push({ type: 'text', text: `メモ：${result.memoStart}`, wrap: true, size: 'sm', color: '#5f6f8a' });
  }
  if (result.github) {
    bodyItems.push({ type: 'text', text: '🌱 GitHub にも記録しました', wrap: true, size: 'sm', color: '#5f6f8a' });
  }

  const msg = {
    type: 'flex',
    altText: `${prefix}${result.replyText}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: logBuildHeaderBox_(
        spec.tag,
        logBuildIconLabelHeader_(result.icon, spec.pendingTitle),
        'start'
      ),
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: bodyItems,
      },
    },
    quickReply: logBuildCommandEndQuickReply_(spec.command, result, policy),
  };
  return logWithSender_(msg, 'start');
}

/** はじめたあとのクイックリプライ（いちばん先に「おわる」）を作る */
function logBuildCommandEndQuickReply_(command, result, policy) {
  const baseItems = (logBuildQuickReply_(policy).items || []).filter(i => !/^🏁/.test(i.action.label)).slice(0, 3);
  const endMessage = logBuildCommandText_({
    command,
    source: result.source || command,
    icon: result.icon,
    label: result.label || command,
    type: 'end',
  });
  return { items: [logCreateTextAction_(`🏁 ${logResolveDefaultIconLabel_(command).label === command ? (result.label || command) : logResolveDefaultIconLabel_(command).label}をおわる`.slice(0, 20), endMessage)].concat(baseItems) };
}

/**
 * はじめ・おわりのまちがい（はじめが見つからない・形がちがう）は、カードではなく文で返す（H10）
 * - 直し方を1行で。はじめが見つからないときは、クイックリプライから「はじめる」を押せるように
 */
function logBuildCommandErrorReply_(prefix, command, label, replyText, policy) {
  // 名前が英語の command のままなら、ふだんの名前（charge → 充電）にする
  const given = String(label || '').trim();
  const name = given && given !== command ? given : (logResolveDefaultIconLabel_(command).label || command || '記録');
  const items = (logBuildQuickReply_(policy).items || []).filter(i => !/^🏁/.test(i.action.label));
  let text = `⚠️ ${String(replyText || 'うまく読めませんでした')}`;
  // 「見つかりません」「見つからなかった」のどちらでも
  if (/start が見つか/.test(String(replyText))) {
    text = `⚠️ 「${name}」は、まだはじめていません。`;
    const startText = command === 'attendance' ? '# attendance start' : (command === 'trip' ? '' : `# s ${command}`);
    if (startText) {
      text += '\n先に「はじめる」を送ってから、おわりを送ってね。';
      items.unshift(logCreateTextAction_(`🚩 ${name}をはじめる`.slice(0, 20), startText));
    } else {
      text += '\n先に、はじめ（start）を送ってから、おわり（end）を送ってね。';
    }
  }
  return logWithSender_({ type: 'text', text: `${prefix}${text}`, quickReply: { items: items.slice(0, 13) } }, 'error');
}
