/**
 * 60_log_settings.gs：機能「📝 記録」の、いまの設定（LOgBOT の入口 entry/03_settings.js から）
 * 中身：# 設定 のカード・つづくの画面に出す設定・カードの部品の読みこみ
 * 呼ばれるところ：60_log_entry.gs・60_log_tuzuq.gs・60_log_samples.gs
 */

/* ==================================================
 * いまの設定（# 設定）。トークでも、つづくの画面（LINE の中）でも同じ中身
 * - 持ち主だけ。鍵・合言葉・LINE の ID・URL の中身は出さない（あるかないかだけ）
 * - 変えるのはトークのクイックリプライ（# 通知 と同じ）。つづくの画面は見るだけ
 * ================================================== */
const LOG_SETTINGS_PATTERN_ = /^\s*[#＃]\s*(設定|せってい|settings?)\s*$/iu;

/** 「# 設定」か */
function logIsSettingsCommand_(event) {
  return !!(event && event.type === 'message' && event.message && event.message.type === 'text' && LOG_SETTINGS_PATTERN_.test(String(event.message.text || '')));
}

/**
 * いまの設定を、見出しと行の並びで（文字だけ）
 * @return {Array<{title: string, rows: string[]}>}
 */
function logBuildSettingsSections_() {
  let lib = null;
  try {
    lib = logGetLogbotStatus_();
  } catch (e) {
    lib = null;
  }
  const off = logIsRemindOff_();
  const trigger = logHasReminderTrigger_();
  const quota = logDescribePushQuota_();
  const yes = (v, a, b) => (v ? a : b);
  const sections = [
    { title: '🔔 知らせ', rows: [off ? '🔕 決めた時間の知らせ：止めています' : logDescribeRemind_(), logDescribeTuzuqNotify_()].concat(quota ? [quota] : []) },
  ];
  if (lib) {
    sections.push({ title: '✅ つづく', rows: [
      `持ち主のつづく：${yes(lib.tuzuqOwner, 'つないでいます', 'まだ（ボットの「🔗 ツールとつなぐ」の番号を、つづくに入れる）')}`,
      `送る文：${lib.habits && lib.habits.length ? lib.habits.join('・') : 'まだ（つづくを LINE で開くと覚えます）'}`,
    ] });
    sections.push({ title: '🌱 GitHub', rows: [yes(lib.github, 'つながっています（記録が草にもなります）', 'つながっていません（つながなくても記録はできます）')] });
  }
  sections.push({ title: '🔧 管理者向け（あるかだけ）', rows: [
    `LINE の鍵：${yes(lineToken_(), 'あり', 'なし')}・合言葉：${yes(propText_('WEBHOOK_KEY'), 'あり', 'なし')}`,
    lib ? `GitHub の鍵：${yes(lib.admin && lib.admin.githubToken, 'あり', 'なし')}・Alfred の合言葉：${yes(propText_('ALFRED_SECRET'), 'あり', 'なし')}` : '記録の設定：読めませんでした',
    `見張り（1時間おき）：${yes(trigger, '動いています', 'まだ（GAS エディタで setupBot を1回）')}`,
  ] });
  return sections;
}

/** 「# 設定」の返事（持ち主だけ。いまの設定のカード） */
function logHandleSettingsCommand_(policy) {
  if (!policy.isOwner) return { type: 'text', text: '設定を見られるのは、このボットの持ち主だけです。' };
  const sections = logBuildSettingsSections_();
  const card = logBuildInfoCardOrNull_({
    tag: '⚙️ いまの設定',
    title: '記録ボットの設定',
    sections: sections.concat([{ title: '変える', rows: ['知らせは下のボタンで（つづくの画面でも見られます）'] }]),
    buttons: [{ label: '🔔 知らせ', text: '# 通知' }, { label: '📊 ふりかえり', text: '# REPORT' }],
    altText: `⚙️ いまの設定：${sections[0].rows[0]}`,
    quickReply: logRemindQuickReply_(),
  });
  if (card) return card;
  const body = sections.map(s => `${s.title}\n${s.rows.join('\n')}`).join('\n\n');
  return { type: 'text', text: `⚙️ いまの設定\n\n${body}\n\n変える：下のボタン（つづくの画面でも見られます）`.slice(0, 4900), quickReply: logRemindQuickReply_() };
}

/** ライブラリのカードの部品で、見出し・段・ボタンのカードを作る（読めなければ null。文で返す） */
function logBuildInfoCardOrNull_(spec) {
  try {
    return logBuildInfoCard_(spec);
  } catch (e) {
    return null;
  }
}
