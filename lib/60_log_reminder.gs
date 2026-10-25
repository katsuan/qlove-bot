/**
 * 60_log_reminder.gs：機能「📝 記録」の決めた時間の知らせの中身（LOgBOT の 05_features/reminder.gs から）
 * 中身：知らせの数を集める・言葉を選ぶ・カードにする（今週のマス目）
 * 呼ばれる（LOgBOT のときのファイル名）：入口の GAS（buildNoRecordReminder）・#テスト の見本
 *
 * 決めた時間の知らせの中身。入口の GAS の runReminder_ が、持ち主のトークに push する（1日1通まで）
 *
 * 送り方（入口の REMIND_MODE。LINE の「# 通知 毎日／週／まだのときだけ」で変える）
 * - daily（はじめはこれ）：毎日1通。きょうと今週のまとめ。全部できた日はほめる
 * - missing：まだの習慣があるときだけ（連続・週の目標がかかっているときも）
 * - weekly：日曜の夜に1通。今週のふりかえり
 *
 * 見出しは、その日のようすでいちばん言いたいことにする
 *   全部できた → 🎉 ／ 記録のない日が3日以上 → 🌱 見直しませんか ／ 連続が途切れそう → 🔥 ／ 週の目標が途切れそう → 📅 ／ ほか → 📝
 * 同じ言葉が毎日つづかないように、場面ごとに何通りか用意して、日ごとに入れかえる
 *
 * 数えるのは自分でした記録だけ（CarPlay の trip・出退勤・充電などの自動の記録は数えない。isAutoLog_）
 * 「習慣」は、つづくで見ている習慣（TUZUQ_HABITS）。わからなければ、記録した行動を並べる
 */

const LOG_REMIND_ABSENT_DAYS_ = 3; // この日数以上あいたら「見直しませんか」
const LOG_REMIND_STREAK_MIN_ = 2; // この日数以上つづいた習慣が途切れそうなら知らせる
const LOG_REMIND_OPEN_URL_ = 'https://liff.line.me/2012187502-o87l8Esu';
const LOG_REMIND_WEEKDAYS_ = ['月', '火', '水', '木', '金', '土', '日'];

const LOG_REMIND_WORDS_ = {
  done: [
    '🎉 きょうの習慣、ぜんぶできました',
    '🎉 全部○！いい1日でしたね',
    '✨ きょうも○がそろいました',
    '🎉 きょうの自分に、花まる',
    '✨ ぜんぶ○。この調子で、あしたも',
  ],
  absent: [
    '🌱 {gap}日あいています。習慣、いまの自分に合っていますか？',
    '🌱 しばらくお休みでしたね。小さな1回から、また始めませんか',
    '🌱 {gap}日ぶりの1回は、いちばん価値がある1回です',
    '🌱 おかえりの準備はできています。きょう、ひとつだけ',
  ],
  streak: [
    '🔥 {n}日の連続が、きょうで途切れそう…まだ間に合う！',
    '🔥 {n}日つづいた火を、きょうも消さずにいこう',
    '🔥 連続{n}日。あと1回で{next}日目！',
    '🔥 ここまで{n}日。きょうの1回が、あしたの自分をつくる',
    '🔥 {n}日分の自分が、きょうの1回を待っています',
  ],
  weekly: [
    '📅 今週の目標まで、あと{need}回。のこり{left}日',
    '📅 今週もうひと押し。のこり{left}日で、あと{need}回',
    '📅 週の目標がかかっています（あと{need}回・のこり{left}日）',
    '📅 のこり{left}日。今週の自分に、もう{need}回のプレゼントを',
  ],
  usual: [
    '📝 きょうの○、まだあります',
    '📝 きょうもひとつ、つづけよう',
    '📝 寝る前に、あと1つ',
    '📝 小さくても、1回は1回',
    '📝 5分だけでも、きょうの自分に○を',
  ],
  week: [
    '📅 今週のふりかえり',
    '📅 1週間おつかれさま。今週の○です',
    '📅 今週の自分を、ちょっとふりかえり',
    '📅 今週もよくがんばりました',
  ],
};

/**
 * @param {string[]} ownerIds 入口が渡す、持ち主のトークの ID（先頭は、クエストの設定を持つ ID）
 * @param {Date=} now
 * @param {string=} mode daily・missing・weekly（ちがえば daily）
 * @return {{send: boolean, kind: string, text: string, quick: Array<{label: string, uri: string}>}}
 */
function logBuildNoRecordReminder_(ownerIds, now, mode) {
  // 入口（別のプロジェクト）から渡された日付も受けとる（instanceof Date が効かないことがある）
  const base = now && typeof now.getTime === 'function' && !isNaN(now.getTime()) ? new Date(now.getTime()) : new Date();
  return logComposeReminder_(logCollectReminderState_(ownerIds, base), base, mode);
}

/**
 * 知らせの中身を、集めた数（collectReminderState_ の形）から作る。見本（#テスト）は、ためしの数を渡す
 */
function logComposeReminder_(s, base, mode) {
  const m = ['daily', 'missing', 'weekly'].indexOf(mode) >= 0 ? mode : 'daily';
  const dayNo = Math.floor(base.getTime() / LOG_DAY_MS);
  const pick = (kind, vars) => logFillWords_(LOG_REMIND_WORDS_[kind][dayNo % LOG_REMIND_WORDS_[kind].length], vars || {});
  const quick = [{ label: '✅ つづくを開く', uri: LOG_REMIND_OPEN_URL_ }];
  const none = { send: false, kind: 'had', text: '', quick: [] };

  // ---- 週ごと：日曜だけ、今週のふりかえり
  if (m === 'weekly') {
    if (s.weekdayIndex !== 6) return none;
    const lines = [pick('week'), '', '今週：'];
    lines.push(...logWeekLines_(s));
    const diff = s.weekDays - s.lastWeekDays;
    lines.push('');
    lines.push(`記録した日：${s.weekDays}日（先週 ${s.lastWeekDays}日${diff > 0 ? `・+${diff}日 👏` : ''}）`);
    if (s.bestStreak) lines.push(`いちばんつづいている：${logHabitLabel_(s.bestStreak.text)}（🔥${s.bestStreak.n}日）`);
    return logWithReminderCard_({ send: true, kind: 'week', text: lines.join('\n'), quick, week: logWeekRows_(s) });
  }

  // ---- 毎日・まだのときだけ：見出し
  const allDone = s.habits.length ? !s.missing.length : s.anyToday;
  let kind = 'usual';
  let head = '';
  if (allDone && !s.weekly.length) {
    if (m === 'missing') return none;
    kind = 'done';
    head = pick('done');
    // つづいている日数で育つ草（4_line/cards.gs。配布用には入っていないので、あるときだけ）
    if (typeof logGrassMark_ === 'function' && s.bestStreak) head += ` ${logGrassMark_(s.bestStreak.n, base).icon}`;
  } else if (s.gap >= LOG_REMIND_ABSENT_DAYS_) {
    kind = 'absent';
    head = pick('absent', { gap: s.gap });
  } else if (s.streaks.length) {
    kind = 'streak';
    head = pick('streak', { n: s.streaks[0].n, next: s.streaks[0].n + 1 });
  } else if (s.weekly.length) {
    kind = 'weekly';
    head = pick('weekly', { need: s.weekly[0].need, left: s.weekly[0].left });
  } else {
    head = pick('usual');
  }

  const lines = [`${head}（${logFormatJST_(base, 'M/d')}）`, ''];
  // きょう
  if (s.habits.length) {
    lines.push('きょう：');
    s.habits.forEach(h => {
      const done = !!(s.daysByAction[h.a] || {})[s.today];
      const streak = s.streaks.find(x => x.text === h.t);
      const now = done ? s.streakToday(h.a) : 0;
      lines.push(`${done ? '✅' : '⬜'} ${logHabitLabel_(h.t)}${done && now >= 2 ? `（🔥${now}日）` : ''}${streak ? `（🔥${streak.n}日つづき中）` : ''}`);
    });
  } else if (s.todayActions.length) {
    lines.push(`きょうの記録：${s.todayActions.join('・')}`);
  } else {
    lines.push('「# workout」のように送るか、つづくで○をつけてね。');
  }
  // 今週（毎日のときだけ）
  if (m === 'daily' && s.habits.length) {
    lines.push('');
    lines.push(`今週（${LOG_REMIND_WEEKDAYS_.slice(0, s.weekdayIndex + 1).join('')}）：`);
    lines.push(...logWeekLines_(s));
  }
  if (s.weekly.length) {
    lines.push('');
    s.weekly.forEach(w => lines.push(`📅 今週の ${w.action}：${w.count}/${w.target}（のこり${w.left}日）`));
  }
  if (kind === 'absent') {
    lines.push('');
    lines.push('習慣の数を減らす・軽くするのもありです。つづくで見直してみませんか？');
    quick.push({ label: '⚙️ 習慣を見直す', uri: `${LOG_REMIND_OPEN_URL_}?open=edit` });
  }
  return logWithReminderCard_({ send: true, kind, text: lines.join('\n'), quick, week: m === 'daily' && s.habits.length ? logWeekRows_(s) : null });
}

const LOG_REMIND_CARD_COLORS_ = { done: '#2e9b3f', streak: '#e8590c', weekly: '#3578e5', absent: '#5b8c3a', usual: '#4f5d78', week: '#1b2438' };

/**
 * 知らせをカードにする（文と同じ中身：1行目を色の帯の見出しに、残りを区切りごとの段に）
 * - ボタン：［つづくのアイコン］つづくへ／🔔 知らせの設定（しばらくあいている日は ⚙️ 習慣を見直す）
 * - LINE の部品（4_line/cards.gs）がないとき（配布用）は、カードを付けない
 */
function logWithReminderCard_(reminder) {
  if (typeof logBuildIconButton_ !== 'function') return reminder;
  const parts = String(reminder.text).split(/\n\s*\n/);
  const head = parts.shift();
  const body = parts.map((part, i) => {
    const lines = part.split('\n');
    const label = /：$/.test(lines[0]) ? lines.shift() : '';
    const box = { type: 'box', layout: 'vertical', spacing: 'xs', margin: i ? 'md' : 'none', contents: [] };
    if (label) box.contents.push({ type: 'text', text: label.replace(/：$/, '').replace(/（.*）$/, ''), size: 'xs', color: '#7a869c', weight: 'bold' });
    if (/^今週/.test(label) && reminder.week && reminder.week.length) box.contents.push(logBuildWeekGrid_(reminder.week));
    else box.contents.push({ type: 'text', text: lines.join('\n') || '-', size: 'sm', color: '#1b2540', wrap: true });
    return box;
  });
  const second = reminder.kind === 'absent'
    ? logBuildIconButton_('', '⚙️ 見直す', { type: 'uri', label: '見直す', uri: `${LOG_REMIND_OPEN_URL_}?open=edit` })
    : logBuildIconButton_('', '🔔 設定', { type: 'message', label: '設定', text: '# 通知' });
  reminder.card = {
    type: 'flex',
    altText: reminder.kind === 'done' ? logSeasonal_(head) : head, // ほめるときだけ季節の絵文字
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '14px', backgroundColor: LOG_REMIND_CARD_COLORS_[reminder.kind] || LOG_REMIND_CARD_COLORS_.usual,
        contents: [{ type: 'text', text: head, color: '#ffffff', size: 'md', weight: 'bold', wrap: true }],
      },
      body: { type: 'box', layout: 'vertical', paddingAll: '14px', contents: body.length ? body : [{ type: 'text', text: '-', size: 'sm' }] },
      footer: {
        type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '8px',
        contents: [
          logBuildIconButton_('https://katsuan.github.io/tuzuq/apple-touch-icon.png', 'つづくへ', { type: 'uri', label: 'つづくへ', uri: LOG_REMIND_OPEN_URL_ }),
          second,
        ],
      },
    },
  };
  return reminder;
}

/** 知らせに使う数をまとめて出す */
function logCollectReminderState_(ownerIds, base) {
  const today = logFormatJST_(base, 'yyyy-MM-dd');
  const ids = (Array.isArray(ownerIds) ? ownerIds : []).map(String).filter(Boolean);
  const questOwner = ids[0] || '';
  logOwnerOldIds_().forEach(id => ids.push(id)); // 前の LOgBOT の持ち主の ID（付けかえる前の記録も数える）
  ids.push('sys');

  logInvalidateLogsCache_();
  const mine = logGetLogs_().filter(log => ids.indexOf(String(log.userId || '')) >= 0 && log.date <= base && !logIsAutoLog_(log));
  const daysByAction = {};
  const allDays = {};
  mine.forEach(log => {
    const day = logFormatJST_(log.date, 'yyyy-MM-dd');
    const action = logNormalizeActionName_(log.action);
    (daysByAction[action] = daysByAction[action] || {})[day] = true;
    allDays[day] = true;
  });

  const habits = logReadTuzuqHabits_();
  const missing = habits.filter(h => !(daysByAction[h.a] || {})[today]);
  const anyToday = !!allDays[today];
  const todayActions = Object.keys(daysByAction).filter(a => daysByAction[a][today]);
  const dayKey = i => logFormatJST_(new Date(base.getTime() - i * LOG_DAY_MS), 'yyyy-MM-dd');
  const streakFrom = (dayMap, from) => {
    let n = 0;
    for (let i = from; i <= 400 && dayMap[dayKey(i)]; i += 1) n += 1;
    return n;
  };

  // 月曜から今日まで（0＝月曜 … 6＝日曜）
  const range = logGetWeekRangeJST_(base);
  const todayStart = new Date(`${today}T00:00:00+09:00`);
  const weekdayIndex = Math.max(0, Math.min(6, 7 - Math.round((range.end - todayStart) / LOG_DAY_MS)));
  const weekKeys = [];
  for (let i = weekdayIndex; i >= 0; i -= 1) weekKeys.push(dayKey(i));
  const lastWeekKeys = [];
  for (let i = weekdayIndex + 7; i >= weekdayIndex + 1; i -= 1) lastWeekKeys.push(dayKey(i));

  const streaks = missing
    .map(h => ({ text: h.t, n: streakFrom(daysByAction[h.a] || {}, 1) }))
    .filter(x => x.n >= LOG_REMIND_STREAK_MIN_)
    .sort((a, b) => b.n - a.n);
  const best = habits
    .map(h => ({ text: h.t, n: streakFrom(daysByAction[h.a] || {}, (daysByAction[h.a] || {})[today] ? 0 : 1) }))
    .sort((a, b) => b.n - a.n)[0];

  return {
    today,
    habits,
    missing,
    anyToday,
    todayActions,
    daysByAction,
    gap: anyToday ? 0 : logDaysSinceLast_(allDays, base),
    streaks,
    streakToday: action => streakFrom(daysByAction[action] || {}, 0),
    bestStreak: best && best.n >= 2 ? best : null,
    weekly: logWeeklyAtRisk_(questOwner, mine, base),
    weekdayIndex,
    weekKeys,
    weekDays: weekKeys.filter(d => allDays[d]).length,
    lastWeekDays: lastWeekKeys.filter(d => allDays[d]).length,
  };
}

/**
 * 今週の行（習慣ごと。習慣がわからなければ、記録した行動ごと）
 * @return {Array<{label: string, marks: Array<boolean|null>, n: number}>} marks は月〜日の7つ（まだ来ない日は null）
 */
function logWeekRows_(s) {
  const rows = s.habits.length
    ? s.habits.map(h => ({ label: logHabitLabel_(h.t), map: s.daysByAction[h.a] || {} }))
    : Object.keys(s.daysByAction).filter(a => s.weekKeys.some(d => s.daysByAction[a][d])).map(a => ({ label: a, map: s.daysByAction[a] }));
  return rows.map(r => ({
    label: r.label,
    marks: LOG_REMIND_WEEKDAYS_.map((_, i) => (i < s.weekKeys.length ? !!r.map[s.weekKeys[i]] : null)),
    n: s.weekKeys.filter(d => r.map[d]).length,
  }));
}

/** 今週の行を文にする（○ できた・・ まだ。来ない日は出さない） */
function logWeekLines_(s) {
  const rows = logWeekRows_(s);
  if (!rows.length) return ['（今週の記録はまだありません）'];
  return rows.map(r => `${r.marks.filter(x => x !== null).map(x => (x ? '○' : '・')).join('')} ${r.label}（${r.n}日）`);
}

/** つづくの「送る文」（# workout）を、見せる名前（workout）にする */
function logHabitLabel_(text) {
  return String(text || '').replace(/^\s*[#＃]\s*/, '').trim() || String(text || '');
}

/**
 * 今週のマス目（カード用）：曜日の見出しと、習慣ごとに「名前（n日）」と7つのマス
 * マスの幅をそろえるので、○ と ・ の字の幅がちがっても列がずれない
 */
function logBuildWeekGrid_(week) {
  const cell = (text, color, bold) => ({ type: 'text', text, size: 'sm', color, align: 'center', flex: 1, weight: bold ? 'bold' : 'regular' });
  const todayIndex = week.length ? week[0].marks.filter(x => x !== null).length - 1 : -1;
  const header = { type: 'box', layout: 'horizontal', contents: LOG_REMIND_WEEKDAYS_.map((d, i) => cell(d, i === todayIndex ? '#1b2540' : '#9aa5b8', i === todayIndex)) };
  const rows = week.map(r => ({
    type: 'box', layout: 'vertical', margin: 'sm', contents: [
      { type: 'text', text: `${r.label}（${r.n}日）`, size: 'xs', color: '#4f5d78', wrap: true },
      { type: 'box', layout: 'horizontal', contents: r.marks.map(x => (x === null ? cell('·', '#d8dde8') : x ? cell('●', '#2e9b3f', true) : cell('○', '#b8c0cf'))) },
    ],
  }));
  return { type: 'box', layout: 'vertical', spacing: 'none', contents: [header].concat(rows) };
}

/** 言葉の見本の {n} などを、数に置きかえる */
function logFillWords_(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (all, key) => (vars[key] != null ? String(vars[key]) : all));
}

/** 最後に記録した日から、今日まで何日あいたか（記録がまったくなければ 0） */
function logDaysSinceLast_(allDays, base) {
  const days = Object.keys(allDays).sort();
  if (!days.length) return 0;
  const last = new Date(`${days[days.length - 1]}T00:00:00+09:00`);
  const todayStart = new Date(`${logFormatJST_(base, 'yyyy-MM-dd')}T00:00:00+09:00`);
  return Math.round((todayStart - last) / LOG_DAY_MS);
}

/**
 * 週の目標（クエスト）で、のこりの日（今日を入れる）ではぎりぎり・足りなくなりそうなもの
 * - 足りない回数が、のこりの日数と同じか多い（毎日やらないと届かない）か、のこり2日以内で足りていない
 */
function logWeeklyAtRisk_(questOwner, mine, base) {
  if (!questOwner) return [];
  const range = logGetWeekRangeJST_(base);
  const todayStart = new Date(`${logFormatJST_(base, 'yyyy-MM-dd')}T00:00:00+09:00`);
  const left = Math.max(1, Math.round((range.end - todayStart) / LOG_DAY_MS));
  return logGetQuestSettingsForUser_(questOwner)
    .filter(q => q.enabled)
    .map(q => {
      const target = Math.max(1, Number(q.targetPerWeek) || 1);
      const count = mine.filter(log => log.date >= range.start && log.date < range.end && logNormalizeActionName_(log.action) === q.action).length;
      return { action: q.action, target, count, need: target - count, left };
    })
    .filter(w => w.need > 0 && (w.need >= w.left || w.left <= 2))
    .sort((a, b) => b.need - a.need);
}

/** 自動で入る記録（CarPlay の trip・出退勤・充電などの「はじめ・おわり」）か */
function logIsAutoLog_(log) {
  const rule = logActionRule_(log.action); // シート「log_actions」の remind（FALSE なら自動の記録）
  if (rule) return !rule.remind;
  const action = logNormalizeActionName_(log.action);
  if (action === 'trip' || action === 'attendance') return true;
  return /^\s*command\s*:/i.test(String(log.detail || ''));
}
