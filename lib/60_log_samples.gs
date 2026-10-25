/**
 * 60_log_samples.gs：機能「📝 記録」の #テスト の見本と自己点検（LOgBOT の 04_line/test_samples.gs・入口の 06_testdesk.js から）
 * 中身：ためしのデータの見本（logBuildTestSample_）・くらぶボットの #テスト に渡す見本（logSamples_）・読むだけの自己点検（logSelfCheckRows_）
 *
 * - 見本は、本物の記録・シート・GitHub には書かない（読むのはよい）。見出しと altText の頭に「🧪」
 * - 押すと本物の記録を変えるクイックリプライ（+15分など）は、見本から外す
 * - 「📝 本番でためす」だけは、押すと本当に記録して試すカード（前の「# test」。カードそのものは何も書かない）
 * 呼ばれるところ：60_log.gs の samples・checks
 */

/** くらぶボットの #テスト に渡す見本（[{ id, label, build }]） */
function logSamples_() {
  const policy = { userId: ownerUserId_(), isOwner: true, canCommitGithub: false, logSource: 'LINE' };
  const one = (id, label, build) => ({ id, label, build });
  return [
    one('log', '📝 記録しました', () => logBuildTestSample_('log', policy)),
    one('trip', '📝 移動', () => logBuildTestSample_('trip', policy)),
    one('attendance', '📝 出退勤', () => logBuildTestSample_('attendance', policy)),
    one('remind', '📝 決めた時間の知らせ', () => logBuildTestSample_('remind', policy)),
    one('week', '📝 週のふりかえり', () => logBuildTestSample_('week', policy)),
    one('settings', '📝 いまの設定', () => [logMarkSample_(logHandleSettingsCommand_(policy))]),
    // カードそのものは何も書かない（押した先は本物の記録）。見本と見分けるため、altText に 🧪
    one('try', '📝 本番でためす', () => logBuildAdminTestReplies_().map(m => ({ ...m, altText: `🧪 ${m.altText || ''}`.slice(0, 400) })))
  ];
}

/** 見本の印（🧪）を付ける */
function logMarkSample_(m) {
  const out = { ...m };
  if (out.type === 'text') out.text = `🧪 ${out.text}`;
  if (out.type === 'flex') out.altText = `🧪 ${out.altText}`.slice(0, 400);
  delete out.quickReply;
  return out;
}

const LOG_TEST_SAMPLE_KINDS_ = ['log', 'trip', 'attendance', 'remind', 'week', 'season'];

/**
 * 見本のメッセージ
 * @param {string} kind log・trip・attendance・remind・week・season
 * @param {Object} policy 入口が決めた policy（持ち主）
 * @return {Object[]} LINE のメッセージ（読めない kind は []）
 */
function logBuildTestSample_(kind, policy) {
  const p = { ...(policy || {}), sample: true, canCommitGithub: false };
  const strip = m => { const out = { ...m }; delete out.quickReply; return out; };
  // ［+15分］も見せる。記録 ID は見本用（シートにないので、押しても「見つかりませんでした」と返るだけ）
  if (kind === 'log') return [strip(logBuildLoggedReply_(null, '🧑‍💻coding', p, 'L-SAMPLE', 0))];
  if (kind === 'trip') {
    const detail = ['trip: CarPlay', 'icon: 🚙', 'source: carplay', 'start: 2026-10-24T08:00:00+09:00', 'end: 2026-10-24T08:42:00+09:00', 'duration: 42m', 'distance: 18.40km', 'avg: 26.3km/h'].join('\n');
    return [strip(logWithSender_(logBuildTripResultFlexReply_('🧪 ', detail, p), 'end'))];
  }
  if (kind === 'attendance') {
    return [strip(logBuildAttendanceReply_({ didLog: true, mode: 'end', label: '出退勤', icon: '🏢', start: '09:00', end: '18:05', duration: '9h05m' }, p))];
  }
  if (kind === 'remind' || kind === 'week') {
    const base = new Date();
    const r = logComposeReminder_(logSampleReminderState_(base, kind === 'week'), base, kind === 'week' ? 'weekly' : 'daily');
    const card = r.card || { type: 'text', text: r.text };
    if (card.type === 'flex') {
      card.altText = `🧪 ${card.altText}`;
      const head = card.contents.header.contents[0];
      head.text = `🧪 ${head.text}`;
    } else {
      card.text = `🧪 ${card.text}`;
    }
    return [card];
  }
  if (kind === 'season') {
    let emoji = '🌱';
    try { emoji = QSeason.pick(); } catch (e) { /* 季節の部品がなければ芽 */ }
    return [
      { type: 'text', text: `🧪 季節の絵文字が出るとき：\n記録しました：coding ${emoji}` },
      { type: 'text', text: '🧪 出ないとき：\n記録しました：coding\n（出るのは、うれしい短い文だけ。ふだん3割・行事のころ6割・当日9割）' },
    ];
  }
  return [];
}

/**
 * 知らせの見本の数（ためしのデータ）。習慣2つ・今週はほぼ毎日
 * @param {boolean} sunday 週のふりかえり（日曜）の見本にするか
 */
function logSampleReminderState_(base, sunday) {
  const weekdayIndex = sunday ? 6 : Math.max(0, (Number(logFormatJST_(base, 'u')) || 1) - 1);
  const key = i => logFormatJST_(new Date(base.getTime() - i * LOG_DAY_MS), 'yyyy-MM-dd');
  const weekKeys = [];
  for (let i = weekdayIndex; i >= 0; i -= 1) weekKeys.push(key(i));
  const today = weekKeys[weekKeys.length - 1];
  const workout = {};
  const coding = {};
  weekKeys.forEach((d, i) => { coding[d] = true; if (i % 3 !== 1) workout[d] = true; });
  workout[today] = true;
  return {
    today,
    habits: [{ a: 'workout', t: '# 💪workout' }, { a: 'coding', t: '# 🧑‍💻coding' }],
    missing: [],
    anyToday: true,
    todayActions: ['workout', 'coding'],
    daysByAction: { workout, coding },
    gap: 0,
    streaks: [],
    streakToday: action => (action === 'coding' ? weekKeys.length : 1),
    bestStreak: { text: '# 🧑‍💻coding', n: weekKeys.length },
    weekly: [],
    weekdayIndex,
    weekKeys,
    weekDays: weekKeys.length,
    lastWeekDays: Math.max(0, weekKeys.length - 2),
  };
}

/**
 * 自己点検（読むだけ）：シート・GitHub・つづく・版
 * @return {string[]} ✅ / ⚠️ / ❌ で始まる行
 */
function logSelfCheckRows_() {
  const rows = [];
  [LOG_SHEET_.logs, LOG_SHEET_.users].forEach(name => {
    const sheet = book_().getSheetByName(name);
    rows.push(sheet ? `✅ シート「${name}」：${Math.max(0, sheet.getLastRow() - 1)} 行` : `⚠️ シート「${name}」がまだない（はじめて記録したときに作る。LOgBOT のタブを写すときは、この名前に）`);
  });
  const target = logResolveGithubTarget_({ canCommitGithub: true });
  if (!target) {
    rows.push('⚠️ GitHub：つないでいない（つながなくても記録はできる）');
  } else {
    try {
      const res = UrlFetchApp.fetch(`https://api.github.com/repos/${target.owner}/${target.repo}`, { headers: logGithubHeaders_(target.token), muteHttpExceptions: true });
      rows.push(res.getResponseCode() === 200 ? '✅ GitHub：リポジトリが読める' : `❌ GitHub：読めない（${res.getResponseCode()}。鍵の期限・権限）`);
    } catch (e) {
      rows.push('❌ GitHub：つながらない');
    }
  }
  return rows;
}
