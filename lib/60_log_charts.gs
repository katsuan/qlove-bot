/**
 * 60_log_charts.gs：機能「📝 記録」のふりかえりの絵（LOgBOT の 04_line/charts.gs から）
 * 中身：横の棒の量と時間帯のまとめ
 * 呼ばれる（LOgBOT のときのファイル名）：report_replies
 *
 * ふりかえりのカードの1枚目に出す「絵でわかる」まとめの部品
 * - 量：横の棒（■■■■□□）。字で描くので、LINE で崩れにくく、中身の空の箱も使わない
 * - 時間帯も同じ横の棒（字の高さで描くと、下の位置がずれるため）
 */

const LOG_CHART_BAR_CELLS_ = 10;

/**
 * 横の棒を並べる
 * @param {Array<{label: string, value: number, text: string, strong?: boolean}>} items
 * @param {string} color 棒の色
 */
function logBuildBarRows_(items, color) {
  const max = Math.max(0, ...items.map(i => Number(i.value) || 0));
  return {
    type: 'box', layout: 'vertical', spacing: 'xs',
    contents: items.map(item => {
      const v = Number(item.value) || 0;
      const filled = max > 0 && v > 0 ? Math.max(1, Math.round((v / max) * LOG_CHART_BAR_CELLS_)) : 0;
      const spans = [];
      if (filled) spans.push({ type: 'span', text: '■'.repeat(filled), color });
      if (LOG_CHART_BAR_CELLS_ - filled) spans.push({ type: 'span', text: '■'.repeat(LOG_CHART_BAR_CELLS_ - filled), color: '#e3e8f1' });
      return {
        type: 'box', layout: 'horizontal', spacing: 'sm',
        contents: [
          { type: 'text', text: item.label, size: 'xs', color: item.strong ? '#1b2540' : '#5f6f8a', weight: item.strong ? 'bold' : 'regular', flex: 3, wrap: true },
          { type: 'text', text: '■'.repeat(LOG_CHART_BAR_CELLS_), size: 'xxs', flex: 6, contents: spans, gravity: 'center' },
          { type: 'text', text: v > 0 ? item.text : '—', size: 'xs', color: v > 0 ? '#1b2540' : '#b4bccb', align: 'end', flex: 3 },
        ],
      };
    }),
  };
}


/** まとめのカードの見出し（ふりかえりの色） */
function logBuildSummaryHeader_(tag, title, sub) {
  const contents = [
    { type: 'text', text: tag, color: LOG_REPORT_UI_.headerTagColor, size: LOG_REPORT_UI_.headerTagSize, weight: 'bold', wrap: true },
    { type: 'text', text: title, color: LOG_REPORT_UI_.headerTitleColor, size: LOG_REPORT_UI_.headerTitleSize, weight: 'bold', wrap: true },
  ];
  if (sub) contents.push({ type: 'text', text: sub, color: LOG_REPORT_UI_.headerSubColor, size: LOG_REPORT_UI_.headerSubSize, wrap: true });
  return { type: 'box', layout: 'vertical', backgroundColor: LOG_REPORT_UI_.headerBg, paddingAll: '14px', spacing: 'xs', contents };
}

/** ふりかえりのグラフの小さな見出しを作る */
function logBuildChartSection_(title) {
  return { type: 'text', text: title, size: 'sm', weight: 'bold', color: '#33415f', margin: 'md' };
}

/** 「HH:mm」→ 時（読めなければ null） */
function logHourOf_(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):\d{2}$/);
  return m ? Number(m[1]) : null;
}

const LOG_HEAT_COLORS_ = ['#eef1f6', '#fcd5cc', '#f7997f', '#ea5a3f', '#c4231c']; // 0：なし → 4：いちばん長い

/**
 * 時間のヒートマップ（横が 0〜24時の24マス、縦が日）。マスの色は、その1時間に移動していた分
 * - マスは1つずつの字（■）を同じ幅の欄に置くので、どの行もそろう。目もりは6マスずつ
 * @param {Array<{label: string, minutes: number[], strong?: boolean}>} rows minutes は24こ（その時間に移動していた分）
 */
function logBuildHeatmap_(rows) {
  const level = (m) => (m <= 0 ? 0 : m < 15 ? 1 : m < 30 ? 2 : m < 45 ? 3 : 4);
  const cells = (minutes) => ({
    type: 'box', layout: 'horizontal', flex: 8,
    contents: minutes.map(m => ({ type: 'text', text: '■', size: 'xxs', color: LOG_HEAT_COLORS_[level(m)], flex: 1 })),
  });
  const line = (label, minutes, strong) => ({
    type: 'box', layout: 'horizontal', spacing: 'sm', alignItems: 'center',
    contents: [
      { type: 'text', text: label, size: 'xxs', color: strong ? '#1b2540' : '#5f6f8a', weight: strong ? 'bold' : 'regular', flex: 3, wrap: true },
      cells(minutes),
    ],
  });
  const scale = {
    type: 'box', layout: 'horizontal', spacing: 'sm',
    contents: [
      { type: 'text', text: '時', size: 'xxs', color: '#7a869c', flex: 3, align: 'end' },
      {
        type: 'box', layout: 'horizontal', flex: 8,
        contents: ['0', '6', '12', '18'].map(t => ({ type: 'text', text: t, size: 'xxs', color: '#7a869c', flex: 6 })),
      },
    ],
  };
  const legend = {
    type: 'text', size: 'xxs', color: '#7a869c', text: '移動なし ■■■■■ 長い',
    contents: [{ type: 'span', text: '移動なし ' }]
      .concat(LOG_HEAT_COLORS_.map(c => ({ type: 'span', text: '■', color: c })))
      .concat([{ type: 'span', text: ' 長い（1時間のうち）' }]),
  };
  return { type: 'box', layout: 'vertical', spacing: 'xs', contents: rows.map(r => line(r.label, r.minutes, r.strong)).concat([scale, legend]) };
}

/** 「HH:mm」〜「HH:mm」の移動を、24時間それぞれ何分ふくむかに分ける（日をまたぐときは、その日の24時まで） */
function logMinutesByHour_(startHHmm, endHHmm, into) {
  const toMin = (t) => {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const s = toMin(startHHmm);
  let e = toMin(endHHmm);
  if (s == null || e == null) return into;
  if (e < s) e = 24 * 60;
  for (let h = 0; h < 24; h += 1) {
    const from = Math.max(s, h * 60);
    const to = Math.min(e, (h + 1) * 60);
    if (to > from) into[h] += to - from;
  }
  if (e === s && s < 24 * 60) into[Math.floor(s / 60)] += 1; // 0分の移動も、その時間に少しだけ
  return into;
}
