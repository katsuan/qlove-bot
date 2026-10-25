/**
 * 60_log_questreply.gs：機能「📝 記録」のクエストの返事（LOgBOT の 04_line/quest_replies.gs から）
 * 中身：# quest のカード・今週のクエストの行
 * 呼ばれる（LOgBOT のときのファイル名）：text_router・記録のカード
 */

/* ==================================================
 * QUEST
 * ================================================== */

/** 「# quest」の返事：毎日1本と今週のクエストの進み方のカード */
function logBuildQuestStatusReply_(policy) {
  const status = logGetQuestStatusForUser_(policy.userId, new Date());
  const weeklyRows = (status.weekly || []).slice(0, 4).map(logBuildQuestWeeklyRow_);
  const footerItems = []; // 週の目標を変える画面（LIFF）は作らないことにした
  return logWithSender_({
    type: 'flex',
    altText: `クエスト：毎日 ${status.daily.progressText}・今週 ${status.weekly.map(w => `${w.action} ${w.progressText}`).join('・')}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: logBuildHeaderBox_('📋 クエスト', { type: 'text', text: 'きょうと今週の目標', color: '#ffffff', size: 'xl', weight: 'regular' }, 'report'),
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '14px',
        contents: [
          logBuildSectionLabel_('毎日'),
          logBuildStatsRow_('1日1回', logFormatQuestProgress_(status.daily, '日')),
          { type: 'separator', margin: 'sm', color: '#d6dbe8' },
          logBuildSectionLabel_('今週の目標'),
        ].concat(weeklyRows.length ? weeklyRows : [{ type: 'text', text: '週の目標はまだありません', size: 'sm', color: '#6a7892' }]),
      },
      footer: footerItems.length ? {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '12px',
        contents: footerItems,
      } : undefined,
    },
    quickReply: logBuildQuickReply_(policy),
  }, 'activity');
}

/** クエストの進み方を1行の文字にする（できた・つづいた数・いちばん） */
function logFormatQuestProgress_(q, unit) {
  const u = unit || '週';
  return `${q.done ? '✅ できた' : '⬜ まだ'}・🔥${q.currentStreak}${u}つづき（いちばん ${q.bestStreak}${u}）`;
}

/** 今週のクエスト1つ分の行（名前・進み方・あと何日）を作る */
function logBuildQuestWeeklyRow_(q) {
  const lastDone = q && q.lastDoneDate ? q.lastDoneDate : '-';
  const remain = Number(q && q.validRemainingDays);
  const remainText = lastDone === '-' ? 'まだ' : `あと${Math.max(0, remain)}日`;
  const badgeStyle = logResolveQuestRemainBadgeStyle_(remain, lastDone);
  return {
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    backgroundColor: '#e6ebf4',
    cornerRadius: '12px',
    paddingAll: '10px',
    contents: [
      { type: 'text', text: logDecorateQuestTitle_(q.title), size: 'sm', color: '#33415f', weight: 'regular', wrap: true },
      { type: 'text', text: logFormatQuestProgress_(q), size: 'sm', color: '#101a33', wrap: true },
      {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          { type: 'text', text: `さいごにした日：${lastDone}`, size: 'xs', color: '#61708b', flex: 2, wrap: true },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: badgeStyle.bg,
            cornerRadius: '10px',
            paddingAll: '4px',
            flex: 0,
            contents: [{ type: 'text', text: remainText, size: 'xs', color: badgeStyle.fg, weight: 'regular' }],
          },
        ],
      },
    ],
  };
}

/** クエストの名前に、行動の絵文字を付ける */
function logDecorateQuestTitle_(title) {
  const raw = String(title || '').trim();
  if (!raw) return '-';
  if (raw.indexOf('coding') === 0) return `🧑‍💻 ${raw}`;
  if (raw.indexOf('workout') === 0) return `💪 ${raw}`;
  return raw;
}

/** 「あと何日」の札の色を、のこりの日数で選ぶ */
function logResolveQuestRemainBadgeStyle_(remain, lastDone) {
  if (lastDone === '-' || remain <= 0) return { bg: '#f4d9d9', fg: '#8a3a3a' };
  if (remain <= 2) return { bg: '#f5e9cd', fg: '#8a6a21' };
  return { bg: '#d8f2df', fg: '#1a6a32' };
}
