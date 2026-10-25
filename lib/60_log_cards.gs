/**
 * 60_log_cards.gs：機能「📝 記録」の記録のカードの部品（LOgBOT の 04_line/cards.gs から）
 * 中身：記録しましたのカード・数字の行・この1週間・草・時間を足すボタン・見出しと段のカード（buildInfoCard）
 * 呼ばれる（LOgBOT のときのファイル名）：返事を作るファイル・入口（buildInfoCard）
 *
 * 記録したときの返事のカード（1枚にまとめる。Q の使い心地の決まり H2：大事な数字を先に・1通にまとめる）
 *
 *   色の帯：小さく「✅ 記録しました」など、太く「🧑‍💻 coding」
 *   中身　：その記録のこと（時間・距離など）→ きょう何件・🔥何日つづいている・今週 → この1週間の ●○ → 今週のクエスト1行
 *   ボタン：2つまで（あとで押されても困らないもの）：［つづくのアイコン］つづくへ・📊 ふりかえり。横に2つ並ぶので、名前は6字まで（切れないように）
 *
 * 数えるのは、その人の記録だけ（ほかの人の記録は数えない）
 */

const LOG_CARD_WEEKDAYS_ = ['日', '月', '火', '水', '木', '金', '土'];
const LOG_TUZUQ_LIFF_URL_ = 'https://liff.line.me/2012187502-o87l8Esu';
const LOG_TUZUQ_ICON_URL_ = 'https://katsuan.github.io/tuzuq/apple-touch-icon.png';

/**
 * @param {{tag: string, icon: string, title: string, badge?: string, rows: Object[], notice?: string, policy: Object, kind?: string, altText: string, senderType?: string,
 *   adjust?: {logId: string, base: number}}} spec adjust：その記録に時間を足す小さなボタンを出す（postback。押されるたびに確かめる）
 */
function logBuildLogCard_(spec) {
  const policy = spec.policy || {};
  const stats = logBuildPersonalStats_(policy, new Date());
  const grass = logGrassMark_(stats.streak, new Date());
  // 見出しは1行（アイコンと名前）。時間を足したときの「+15分」は小さい字の行に
  const titleNode = { type: 'text', text: `${spec.icon ? `${spec.icon} ` : ''}${spec.title || '記録'}`, color: '#ffffff', size: 'lg', weight: 'bold', wrap: true };
  const tag = spec.badge ? `${spec.tag}　${spec.badge}` : spec.tag;

  const body = [];
  if (spec.notice) body.push({ type: 'text', text: spec.notice, size: 'sm', color: '#1f6f39', weight: 'bold', wrap: true });
  (spec.rows || []).forEach(r => body.push(r));
  // 「きょうの時間」は「きょう」のとなりに（「今週」のとなりだと今週の時間に見える）。数字は大きく、単位は小さく（4時間54分 が折り返さないように）
  // スマホのせまい幅でも1行ずつにおさまるよう、「きょうの時間」の欄だけ少し広く。草の絵文字は下の行に出すので、ここは日数だけ
  body.push(logBuildStatsLine_([
    ['きょう', `${stats.today}件`],
    ['きょうの時間', logMinutesSpans_(stats.todayMinutes), 3],
    ['今週', `${stats.week}件`],
    ['つづいて', stats.streak ? `${stats.streak}日` : 'きょうから'],
  ]));
  body.push(logBuildWeekDots_(stats.last7));
  const notes = [spec.action ? logTodaySummaryLine_(policy, spec.action, new Date()) : '', logBuildQuestLine_(policy), stats.streak ? `${grass.icon} ${grass.word}` : '', policy.canCommitGithub && logActionSendsGithub_({ action: spec.action }) && logResolveGithubTarget_(policy) ? `${grass.season || '🌱'} GitHub にも記録しました` : '']
    .filter(Boolean);
  // 1つずつ別の行に（せまい幅で折り返しても、どこからが次の話かわかるように）
  if (notes.length) {
    body.push({ type: 'box', layout: 'vertical', spacing: 'xs', contents: notes.map(t => ({ type: 'text', text: t, size: 'xs', color: '#4f5d78', wrap: true })) });
  }
  if (spec.adjust && spec.adjust.logId) body.push(logBuildAdjustChips_(spec.adjust.logId, spec.adjust.base));

  const msg = {
    type: 'flex',
    altText: spec.altText,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: logBuildHeaderBox_(tag, titleNode, spec.kind || 'end', { paddingAll: '12px', spacing: 'xs' }),
      body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: body },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '8px', paddingTop: '0px',
        // つづく（LINE の中）へ。クエストは「📊 ふりかえり」の先から見られる
        contents: [{
          type: 'box', layout: 'horizontal', spacing: 'sm',
          contents: [
            logBuildIconButton_(LOG_TUZUQ_ICON_URL_, 'つづくへ', logUriAction_('つづくへ', LOG_TUZUQ_LIFF_URL_)),
            logBuildIconButton_('', '📊 ふりかえり', logMessageAction_('ふりかえり', '# REPORT')),
          ],
        }],
      },
    },
    quickReply: logBuildQuickReply_(policy),
  };
  return logWithSender_(msg, spec.senderType || 'activity');
}

/**
 * 数字を横1行に（上に太い数字、下に小さく名前）。items は [名前, 値, 幅（flex。なければ 2）]
 * - 数字は md、単位（件・日・時間・分）は xxs。数字のない言葉（「きょうから」）は xs（せまい欄でも1行に）
 * - 値も名前も折り返さない（欄ごとに高さがずれて、名前の位置がそろわなくなるため）
 */
function logBuildStatsLine_(items) {
  const valueNode = (value) => {
    // [文字, 単位か] の並び（minutesSpans_）
    const m = Array.isArray(value) ? null : String(value).match(/^(\d[\d,]*)(\D*)$/);
    const parts = Array.isArray(value) ? value : m ? [[m[1]], [m[2], true]] : null;
    if (!parts) return { type: 'text', text: String(value), size: 'xs', weight: 'bold', color: '#111a33', align: 'center', gravity: 'bottom' };
    const shown = parts.filter(([t]) => t);
    return {
      type: 'text', text: shown.map(v => v[0]).join(''), size: 'md', weight: 'bold', color: '#111a33', align: 'center', gravity: 'bottom',
      contents: shown.map(([t, unit]) => ({ type: 'span', text: t, size: unit ? 'xxs' : 'md' })),
    };
  };
  return {
    type: 'box', layout: 'horizontal', spacing: 'xs', backgroundColor: '#eef2f8', cornerRadius: '12px', paddingAll: '8px',
    contents: items.map(([label, value, flex]) => ({
      type: 'box', layout: 'vertical', flex: flex || 2, spacing: 'xs',
      contents: [
        valueNode(value),
        { type: 'text', text: label, size: 'xxs', color: '#66728b', align: 'center' },
      ],
    })),
  };
}

/** 1行の情報（例：08:00 → 08:30（30分）・14.4km） */
function logBuildInfoLine_(text) {
  return { type: 'text', text: String(text || '-'), size: 'md', weight: 'bold', color: '#22314f', wrap: true };
}

/** その人の記録の数（きょう・今週・つづいた日数・きょうの時間・この1週間） */
function logBuildPersonalStats_(policy, now) {
  const uid = String((policy && policy.userId) || '');
  // シート「log_actions」で数に入れないと決めた行動はのぞく
  const mine = logGetLogs_().filter(log => String(log.userId || '') === uid && log.date <= now && logActionCountsStats_(log));
  const dayOf = d => logFormatJST_(d, 'yyyy-MM-dd');
  const today = dayOf(now);
  const days = {};
  let todayMinutes = 0;
  let todayCount = 0;
  mine.forEach(log => {
    const d = dayOf(log.date);
    days[d] = (days[d] || 0) + 1;
    if (d === today) {
      todayCount += 1;
      todayMinutes += Number(log.minutes) || 0;
    }
  });
  const range = logGetWeekRangeJST_(now);
  const week = mine.filter(log => log.date >= range.start && log.date < range.end).length;
  // きょうまだなら、きのうまでの連続
  let streak = 0;
  for (let i = days[today] ? 0 : 1; i < 400; i += 1) {
    if (!days[dayOf(new Date(now.getTime() - i * LOG_DAY_MS))]) break;
    streak += 1;
  }
  const last7 = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * LOG_DAY_MS);
    const weekday = new Date(`${dayOf(d)}T12:00:00+09:00`).getUTCDay();
    last7.push({ label: LOG_CARD_WEEKDAYS_[weekday], on: !!days[dayOf(d)], isToday: i === 0 });
  }
  return { today: todayCount, week, streak, todayMinutes, last7 };
}

/** この1週間の ●○（上に曜日。きょうは青） */
function logBuildWeekDots_(last7) {
  const dots = last7.map(d => ({ type: 'span', text: d.on ? '●' : '○', color: d.on ? '#2e9b3f' : (d.isToday ? '#3b65ff' : '#c8d0de'), weight: d.isToday ? 'bold' : 'regular' }));
  return {
    type: 'text',
    text: `この1週間 ${last7.map(d => (d.on ? '●' : '○')).join('')}`,
    size: 'sm',
    color: '#7a869c',
    contents: [{ type: 'span', text: 'この1週間　', size: 'xs', color: '#7a869c' }].concat(dots),
  };
}

/** 今週のクエスト（例：📋 今週\n・coding 1/1 ✅\n・workout 0/1）。カードの中で途中で切れないよう、1つずつ行を分ける */
function logBuildQuestLine_(policy) {
  try {
    const quest = logGetQuestStatusForUser_(policy.userId, new Date());
    const weekly = (quest && quest.weekly) || [];
    if (!weekly.length) return '';
    return `📋 今週\n${weekly.slice(0, 4).map(q => `・${String(q.title || '').replace(/\s*\d+\/週$/, '')} ${q.progressText}${q.done ? ' ✅' : ''}`).join('\n')}`;
  } catch (e) {
    return '';
  }
}

/** 記録した行動が今週のクエストなら、ひとこと（達成・あと何回） */
function logBuildQuestNotice_(policy, action) {
  try {
    const quest = logGetQuestStatusForUser_(policy.userId, new Date());
    const q = ((quest && quest.weekly) || []).find(w => String(w.action || '') === String(action || ''));
    if (!q) return '';
    if (q.done) return `📋 今週の ${q.action}、目標達成！`;
    const [count, target] = String(q.progressText || '0/1').split('/').map(Number);
    return `📋 今週の ${q.action}、あと${Math.max(1, target - count)}回`;
  } catch (e) {
    return '';
  }
}

/** 分を、数字と単位に分けた並び（例：294 → [['4'],['時間',1],['54'],['分',1]]） */
function logMinutesSpans_(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return [[String(m)], ['分', true]];
  const out = [[String(Math.floor(m / 60))], ['時間', true]];
  if (m % 60) out.push([String(m % 60)], ['分', true]);
  return out;
}

/** 分を「1時間5分」「30分」の文字にする */
function logFormatCardMinutes_(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}`;
}

/**
 * つづいた日数で育つ草と、季節の草
 * - 育ち方：🌱 芽 → 🌿 → 🪴 → 🌳 → 🌳🌳 林 → 🌲🌳🌲 森
 * - 季節の飾り（その時期だけ）：🎍 お正月・🌸 桜・🎋 七夕・🌻 夏・🎃 ハロウィン・🍁 もみじ・🎄 クリスマス
 * @param {number} streak つづいた日数
 * @param {Date} now
 * @return {{icon: string, word: string, season: string}} season は季節でないとき ''
 */
function logGrassMark_(streak, now) {
  const n = Math.max(0, Number(streak) || 0);
  let icon = '🌱';
  let word = '芽が出ました';
  if (n >= 100) { icon = '🌲🌳🌲'; word = `${n}日、森になりました！`; }
  else if (n >= 30) { icon = '🌳🌳'; word = `${n}日、林になってきた`; }
  else if (n >= 14) { icon = '🌳'; word = `${n}日、木になりました`; }
  else if (n >= 7) { icon = '🪴'; word = `${n}日、1週間こえた！`; }
  else if (n >= 4) { icon = '🌿'; word = `${n}日、葉っぱがふえてきた`; }
  else if (n >= 2) { icon = '🌱'; word = `${n}日、芽がのびています`; }

  const md = Number(logFormatJST_(now, 'MMdd'));
  const seasons = [
    [101, 107, '🎍', 'お正月'],
    [320, 410, '🌸', '桜'],
    [701, 707, '🎋', '七夕'],
    [801, 831, '🌻', '夏'],
    [1025, 1031, '🎃', 'ハロウィン'],
    [1110, 1130, '🍁', 'もみじ'],
    [1218, 1225, '🎄', 'クリスマス'],
    [1226, 1231, '🎍', 'もうすぐお正月'],
  ];
  const hit = seasons.find(([from, to]) => md >= from && md <= to);
  if (!hit) return { icon, word, season: '' };
  // 季節の草の名前は次の行に（「（ハロウィンの」で行が切れないように）
  return { icon: `${icon}${hit[2]}`, word: `${word}\n（${hit[3]}の草）`, season: hit[2] };
}

/**
 * 押せる箱のボタン（ボタン button には画像を入れられないので、box に action を付ける）
 * @param {string} iconUrl 左に出す画像（https の png。なければ字だけ）
 * @param {string} label
 * @param {Object} action
 */
function logBuildIconButton_(iconUrl, label, action) {
  const contents = [];
  if (iconUrl) contents.push({ type: 'image', url: iconUrl, size: '24px', aspectRatio: '1:1', flex: 0 });
  contents.push({ type: 'text', text: label, size: 'md', weight: 'bold', color: '#1b2540', align: iconUrl ? 'start' : 'center', gravity: 'center', flex: iconUrl ? 0 : 1 });
  return {
    type: 'box', layout: 'horizontal', spacing: 'sm', flex: 1,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#e6ebf4', cornerRadius: '10px', paddingAll: '10px',
    action, contents,
  };
}

/**
 * その記録に時間を足す小さなボタンの行（⏱ 時間を足す ［+15分］［+30分］［+60分］）
 * postback なので、何日もあとに押されても、ボットがいまの記録を見て返す（もう足した・古い・ほかの人）
 */
function logBuildAdjustChips_(logId, base) {
  const chip = delta => ({
    type: 'box', layout: 'vertical', flex: 1, backgroundColor: '#eef2f8', cornerRadius: '8px', paddingAll: '6px',
    action: { type: 'postback', label: `+${delta}分`, data: logAdjustPostbackData_(delta, logId, base), displayText: `+${delta}分` },
    contents: [{ type: 'text', text: `+${delta}分`, size: 'sm', color: '#3558a6', weight: 'bold', align: 'center' }],
  });
  return {
    type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'md', alignItems: 'center',
    contents: [{ type: 'text', text: '⏱ 時間を足す', size: 'xs', color: '#7a869c', flex: 0 }].concat(LOG_ADJUST_DELTAS_.map(chip)),
  };
}

/**
 * 見出し・段・ボタンのカード（いまの設定・知らせの設定・つづくの知らせなど）。入口の GAS からも使う
 * - 段は「小さな見出し＋行」。ボタンは2つまで（あとで押されても困らないものだけ。H2）
 * @param {{tag: string, title: string, kind?: string, sections: Array<{title?: string, rows: string[]}>,
 *   buttons?: Array<{label: string, uri?: string, text?: string, icon?: string}>, altText: string, quickReply?: Object}} spec
 * @return {Object} Flex のメッセージ
 */
function logBuildInfoCard_(spec) {
  const sections = (spec.sections || []).filter(s => s && Array.isArray(s.rows) && s.rows.length);
  const body = sections.map((s, i) => ({
    type: 'box', layout: 'vertical', spacing: 'xs', margin: i ? 'lg' : 'none',
    contents: (s.title ? [{ type: 'text', text: String(s.title), size: 'xs', color: '#7a869c', weight: 'bold', wrap: true }] : [])
      .concat(s.rows.map(r => ({ type: 'text', text: String(r) || '-', size: 'sm', color: '#1b2540', wrap: true }))),
  }));
  const buttons = (spec.buttons || []).slice(0, 2).map(b => {
    const label = String(b.label).slice(0, 20);
    const action = b.uri ? { type: 'uri', label, uri: b.uri } : { type: 'message', label, text: b.text };
    return logBuildIconButton_(b.icon || '', b.label, action);
  });
  const msg = {
    type: 'flex',
    altText: String(spec.altText || spec.title).slice(0, 400),
    contents: {
      type: 'bubble',
      size: 'mega',
      header: logBuildHeaderBox_(spec.tag, { type: 'text', text: spec.title, color: '#ffffff', size: 'lg', weight: 'bold', wrap: true }, spec.kind || 'report'),
      body: { type: 'box', layout: 'vertical', paddingAll: '14px', contents: body.length ? body : [{ type: 'text', text: '-', size: 'sm' }] },
    },
  };
  if (buttons.length) msg.contents.footer = { type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '8px', contents: buttons };
  if (spec.quickReply) msg.quickReply = spec.quickReply;
  return msg;
}
