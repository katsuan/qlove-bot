/**
 * 60_log_report.gs：機能「📝 記録」のふりかえりの返事（LOgBOT の 04_line/report_replies.gs から）
 * 中身：# REPORT（選ぶ文）・移動と出退勤のふりかえりのカード・Alfred の記録の一覧
 * 呼ばれる（LOgBOT のときのファイル名）：text_router
 */

const LOG_FLEX_CAROUSEL_BUDGET_ = 45000; // LINE の横並びのカードの上限（50KB）より少し小さく

const LOG_REPORT_UI_ = {
  headerTagSize: 'xs',
  headerTitleSize: 'lg',
  headerSubSize: 'xs',
  headerBg: '#1b2438',
  headerTagColor: '#d6dbe8',
  headerTitleColor: '#ffffff',
  headerSubColor: '#b4c2df',
};

/** 「# REPORT …」を読んで、どのふりかえりか（help・trip・attendance）を返す。ちがえば null */
function logParseReportRequest_(detail) {
  const normalized = String(detail || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (/^(report\s+attendance|attendance\s+(report|summary|month|monthly))$/.test(normalized)) {
    return { kind: 'attendance' };
  }
  if (/^(report\s+trip|trip\s+(report|summary|month|monthly))$/.test(normalized)) {
    return { kind: 'trip' };
  }
  if (/^report(?:\s+.*)?$/.test(normalized)) {
    return { kind: 'help' };
  }
  return null;
}

/** 「どのふりかえりを見ますか？」の文（クイックリプライで選ぶ）を作る */
function logBuildReportMenuReply_(policy) {
  return logWithSender_({
    type: 'text',
    text: 'どのふりかえりを見ますか？',
    quickReply: {
      items: [
        logCreateTextAction_('🚙 移動（7日）', '# REPORT trip'),
        logCreateTextAction_('🏢 出退勤（今月）', '# REPORT attendance'),
        logCreateTextAction_('📋 クエスト', '# quest'),
      ],
    },
  }, 'activity');
}

/** 出退勤のふりかえりのカード（1枚目に絵でわかるまとめ、週ごと）を作る */
function logBuildAttendanceReportReplies_(report, policy) {
  if (!report || !report.weeks || !report.weeks.length) {
    return [logWithSender_({
      type: 'text',
      text: '🏢 今月の出退勤の記録は、まだありません。',
    }, 'activity')];
  }

  // 1枚目はまとめ（出勤・退勤の時刻）、2枚目から1週ずつ
  const bubbles = [logBuildAttendanceSummaryBubble_(report)]
    .concat(report.weeks.slice(0, 11).map(week => logBuildAttendanceWeekBubble_(week, report)));
  const msg = {
    type: 'flex',
    altText: `🏢 ${report.month}月の出退勤：${report.count}日`,
    contents: { type: 'carousel', contents: bubbles },
    quickReply: logBuildQuickReply_(policy),
  };
  return [logWithSender_(msg, 'activity')];
}

/** 移動のふりかえりのカード（1枚目に絵でわかるまとめ、日ごと）を作る */
function logBuildTripReportReplies_(report, policy) {
  if (!report || !report.days || !report.days.length) {
    return [logWithSender_({
      type: 'text',
      text: '🚙 この7日の移動の記録は、まだありません。',
    }, 'activity')];
  }

  const totalCount = report.days.reduce((s, d) => s + (d.count || 0), 0);
  const totalDistance = report.days.reduce((s, d) => s + (Number(d.totalDistanceKm) || 0), 0);
  const totalMinutes = report.days.reduce((s, d) => s + (Number(d.totalMinutes) || 0), 0);
  const totalDurationText = logFormatMinutesAsDuration_(totalMinutes);
  // 1枚目はまとめ（日ごとの量・時間帯）、2枚目から1日ずつ
  // LINE の横並びのカードは 50KB まで。1日ずつのカードは、収まるところまで（新しい日から）
  const bubbles = [logBuildTripSummaryBubble_(report, totalCount, totalDistance, totalMinutes)];
  let size = JSON.stringify(bubbles[0]).length;
  report.days.slice(0, 7).some(day => {
    const b = logBuildTripDayBubble_(day, report);
    size += JSON.stringify(b).length;
    if (size > LOG_FLEX_CAROUSEL_BUDGET_) return true;
    bubbles.push(b);
    return false;
  });
  const msg = {
    type: 'flex',
    altText: `🚙 この7日の移動：${totalCount}回・${totalDistance.toFixed(1)}km・${logJpDuration_(totalDurationText)}`,
    contents: { type: 'carousel', contents: bubbles },
    quickReply: logBuildQuickReply_(policy),
  };
  return [logWithSender_(msg, 'activity')];
}

/** 移動のふりかえりの、1日分のカードを作る */
function logBuildTripDayBubble_(day, report) {
  const rows = day.rows.map(row => logBuildTripReportRow_(row));
  return logBuildReportDayBubbleBase_(
    '🚙 移動',
    day,
    report,
    rows,
    true,
    [
      { type: 'separator', color: '#d6dbe8' },
      { type: 'text', text: `${day.count}回・${day.totalDistanceText}・${logJpDuration_(day.totalDurationText)}`, size: 'xs', color: '#5f6f8a', margin: 'sm', wrap: true },
    ],
  );
}

/** 移動のまとめ（1枚目）：この7日の日ごとの量と、はじめた時間帯 */
function logBuildTripSummaryBubble_(report, totalCount, totalDistance, totalMinutes) {
  const days = (report.allDays || []).slice().reverse(); // 古い順（下がきょう）
  const useDistance = totalDistance > 0;
  const items = days.map(day => ({
    label: day.key === report.asOf ? `きょう(${day.weekday})` : `${day.dateLabel}(${day.weekday})`,
    value: useDistance ? day.totalDistanceKm : day.totalMinutes,
    text: useDistance ? `${day.totalDistanceKm.toFixed(1)}km` : logJpDuration_(logFormatMinutesAsDuration_(day.totalMinutes)),
    strong: day.key === report.asOf,
  }));
  return {
    type: 'bubble',
    size: 'mega',
    header: logBuildSummaryHeader_('🚙 移動のふりかえり（この7日）', `${totalCount}回・${totalDistance.toFixed(1)}km・${logJpDuration_(logFormatMinutesAsDuration_(totalMinutes))}`, '右にめくると、1日ずつ見られます'),
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
      contents: [
        logBuildChartSection_(useDistance ? '日ごとの距離' : '日ごとの時間'),
        logBuildBarRows_(items, '#3578e5'),
        logBuildChartSection_('移動した時間（赤いほど長く移動）'),
        logBuildHeatmap_(days.map(day => ({
          label: day.key === report.asOf ? 'きょう' : `${day.dateLabel}${day.weekday}`,
          minutes: (day.rows || []).reduce((acc, row) => logMinutesByHour_(row.startTime, row.endTime, acc), new Array(24).fill(0)),
          strong: day.key === report.asOf,
        }))),
      ],
    },
  };
}

/** 出退勤のふりかえりの、1週間分のカードを作る */
function logBuildAttendanceWeekBubble_(week, report) {
  const rows = [
    logBuildReportHeaderRow_(),
    ...week.rows.map(row => logBuildAttendanceRow_(row)),
  ];
  return logBuildReportWeekBubbleBase_('🏢 出退勤', week, report, rows, true);
}

/** 出退勤のまとめ（1枚目）：出勤・退勤した時刻がいつごろか、早い出勤の日数 */
function logBuildAttendanceSummaryBubble_(report) {
  const rows = (report.weeks || []).flatMap(w => w.rows || []);
  const startHours = [0, 0, 0, 0]; // 〜7時台・8時台・9時台・10時〜
  const endHours = [0, 0, 0, 0]; // 〜17時台・18時台・19時台・20時〜
  rows.forEach(row => {
    const s = logHourOf_(row.startTime);
    const e = logHourOf_(row.endTime);
    if (s != null) startHours[Math.min(3, Math.max(0, s - 7))] += 1;
    if (e != null) endHours[Math.min(3, Math.max(0, e - 17))] += 1;
  });
  const band = (counts, labels) => counts.map((n, i) => ({ label: labels[i], value: n, text: `${n}日` }));
  const early = rows.filter(r => r.earlyStart).length;
  return {
    type: 'bubble',
    size: 'mega',
    header: logBuildSummaryHeader_(`🏢 出退勤のふりかえり（${report.month}月）`, `${rows.length}日 出勤${early ? `・早い出勤 ${early}日` : ''}`, '右にめくると、1週ずつ見られます'),
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px',
      contents: [
        logBuildChartSection_('出勤した時刻'),
        logBuildBarRows_(band(startHours, ['〜7時台', '8時台', '9時台', '10時〜']), '#3578e5'),
        logBuildChartSection_('退勤した時刻'),
        logBuildBarRows_(band(endHours, ['〜17時台', '18時台', '19時台', '20時〜']), '#2e9b3f'),
      ],
    },
  };
}

/** ふりかえりの週のカードの、外側（見出し・中身・下）を作る */
function logBuildReportWeekBubbleBase_(tagText, week, report, bodyContents, withBodyPadding) {
  return {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: LOG_REPORT_UI_.headerBg,
      paddingAll: '14px',
      spacing: 'xs',
      contents: [
        { type: 'text', text: tagText, color: LOG_REPORT_UI_.headerTagColor, size: LOG_REPORT_UI_.headerTagSize, weight: 'bold' },
        { type: 'text', text: `${report.month}月の${week.index}週目`, color: LOG_REPORT_UI_.headerTitleColor, size: LOG_REPORT_UI_.headerTitleSize, weight: 'regular' },
        { type: 'text', text: `${Number(String(week.weekStart).slice(5, 7))}/${Number(String(week.weekStart).slice(8, 10))} からの週`, color: LOG_REPORT_UI_.headerSubColor, size: LOG_REPORT_UI_.headerSubSize, weight: 'regular' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: withBodyPadding ? '12px' : '0px',
      contents: bodyContents,
    },
  };
}

/** ふりかえりの日のカードの、外側（見出し・中身・下）を作る */
function logBuildReportDayBubbleBase_(tagText, day, report, bodyContents, withBodyPadding, footerContents) {
  const bubble = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: LOG_REPORT_UI_.headerBg,
      paddingAll: '14px',
      spacing: 'xs',
      contents: [
        { type: 'text', text: tagText, color: LOG_REPORT_UI_.headerTagColor, size: LOG_REPORT_UI_.headerTagSize, weight: 'bold' },
        { type: 'text', text: `${day.dateLabel}(${day.weekday})`, color: LOG_REPORT_UI_.headerTitleColor, size: LOG_REPORT_UI_.headerTitleSize, weight: 'regular' },
        { type: 'text', text: `${Number(String(report.asOf).slice(5, 7))}/${Number(String(report.asOf).slice(8, 10))} 時点`, color: LOG_REPORT_UI_.headerSubColor, size: LOG_REPORT_UI_.headerSubSize, weight: 'regular' },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: withBodyPadding ? '12px' : '0px',
      contents: bodyContents,
    },
  };
  if (footerContents && footerContents.length) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      spacing: 'none',
      paddingAll: '12px',
      contents: footerContents,
    };
  }
  return bubble;
}

/** 出退勤の表の見出しの行（日・出勤・退勤・時間）を作る */
function logBuildReportHeaderRow_() {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    contents: [
      logBuildReportCell_('日にち', 3, true),
      logBuildReportCell_('出勤', 2, true),
      logBuildReportCell_('退勤', 2, true),
    ],
  };
}

/** 出退勤の表の1日分の行を作る */
function logBuildAttendanceRow_(row) {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'sm',
    backgroundColor: row.earlyStart ? '#ffe9e9' : '#ffffff',
    cornerRadius: '6px',
    paddingAll: '4px',
    contents: [
      logBuildReportCell_(`${row.date}(${row.weekday})`, 3, false),
      logBuildReportCell_(row.startTime, 2, false),
      logBuildReportCell_(row.endTime, 2, false),
    ],
  };
}

/** 移動の1回分の行（時刻・時間・距離・速さ）を作る */
function logBuildTripReportRow_(row) {
  return {
    type: 'box',
    layout: 'vertical',
    spacing: 'sm',
    margin: 'xs',
    backgroundColor: '#f3f6fb',
    cornerRadius: '10px',
    paddingAll: '10px',
    contents: [
      {
        type: 'box',
        layout: 'baseline',
        contents: [
          { type: 'text', text: `${row.date}(${row.weekday})`, size: 'sm', color: '#5f6f8a', flex: 2 },
          { type: 'text', text: `${row.startTime || '-'}〜${row.endTime || '-'}`, size: 'md', color: '#1b2540', weight: 'regular', align: 'end', flex: 3 },
        ],
      },
      {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          logBuildTripSubMetricCell_('距離', row.distance || '-'),
          logBuildTripSubMetricCell_('時間', logJpDuration_(row.duration)),
          logBuildTripSubMetricCell_('平均', row.avg || '-'),
        ],
      },
    ],
  };
}

/** 移動の行の、小さな数字の欄（距離・速さなど）を作る */
function logBuildTripSubMetricCell_(label, value) {
  const v = String(value || '-').trim();
  const shown = /^n\/a$/i.test(v) ? '-' : v;
  return {
    type: 'box',
    layout: 'vertical',
    flex: 1,
    backgroundColor: '#ffffff',
    cornerRadius: '6px',
    paddingAll: '6px',
    contents: [
      { type: 'text', text: label, size: 'xxs', color: '#7a879f', weight: 'regular', align: 'center' },
      { type: 'text', text: shown, size: 'sm', color: '#4f5f7f', weight: 'regular', align: 'center', wrap: true },
    ],
  };
}

/** ふりかえりの表の1マスを作る */
function logBuildReportCell_(text, flex, isHeader) {
  return {
    type: 'text',
    text: String(text || '-'),
    flex: flex,
    size: isHeader ? 'xs' : 'sm',
    color: isHeader ? '#6a7892' : '#1b2540',
    weight: isHeader ? 'bold' : 'regular',
    align: 'center',
    wrap: true,
  };
}
