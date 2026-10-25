/**
 * 60_log.gs：機能「📝 記録」（LOgBOT を、くらぶボットに合流させたもの）
 *
 * 「# coding」「# 💪workout」のように、先頭に # を付けて送ると記録する。持ち主の記録は GitHub（logs/yyyy-MM-dd.jsonl）の草にも。
 *   文字   … # ではじまる文（# REPORT・# quest・はじめ／おわり「# s coding」「# e coding」・# COMMAND・CarPlay の # trip・出退勤）と「+15」（分を足す）。
 *            「# 通知 …」「# 設定」は持ち主だけ。#持ち主・#テスト・#しょくじ は、くらぶボット共通・しょくじが受ける
 *   ボタン … m=log&action=adjust_minutes（+15分など。押されるたびに、いまの記録を見て返す）
 *   つづく（LIFF）… { app: "qlove", tool: "tuzuq", action: record | days | status }（60_log_tuzuq.gs）。本人はくらぶボットが確かめる
 *   Alfred … 本文 { sourceApp: "alfred", secret, text }（合言葉はスクリプト プロパティの ALFRED_SECRET。持ち主の記録になる）
 *   知らせ … 記録がない日、決めた時間（はじめ 20:00）に持ち主へ（60_log_remind.gs。「# 通知」で変える）
 * シート：logs（記録）・log_users（記録した人。LOgBOT の users）・action_aliases（言いかえ）。LOgBOT のタブを写せば、記録はそのまま使える
 * やめたもの（合流のときに決めた）：持ち主だけの画面・クエストの週の設定の画面・# alfred report・todo・# users（くらぶボットの「👥 使う人」に）
 * ファイル：60_log.gs（登録）・60_log_entry（受け口・Alfred・見張り）・60_log_router・60_log_parser（文字を読む）・
 *          60_log_records・60_log_format・60_log_aliases・60_log_users（記録のシート）・60_log_cards・60_log_flex・60_log_charts・60_log_quick・
 *          60_log_sender・60_log_season（返事の部品）・60_log_adjust・60_log_sessions・60_log_report・60_log_questreply・60_log_admin（返事）・
 *          60_log_attendance・60_log_command・60_log_trip・60_log_status・60_log_quest（機能ごと）・60_log_reminder・60_log_remind・60_log_settings（知らせ・設定）・
 *          60_log_tuzuq（つづく）・60_log_github・60_log_backfill（GitHub）・60_log_errors・60_log_migration・60_log_samples（#テストの見本・点検）
 * 呼ばれるところ：02_config.gs の registerModule_（ぜんぶのファイルを読み終わってから組み立てる）
 */

const LOG_LABEL_ = '📝 記録';
// この機能が受けとる文：# ではじまる（#しょくじ と、くらぶボットの #テスト・#持ち主 はのぞく）か、「+15」（分を足す）。
// #テスト・#持ち主 は、使えない人・グループから来ても記録にしない（窓口があることを見せない。ux.md の H11）
const LOG_TEXT_PATTERN_ = /^\s*[#＃]\s*(?!しょくじ|(?:テスト|てすと|test|持ち主|もちぬし|owner)\s*$)\S|^\s*[+＋]\d{1,3}\s*$/iu;

registerModule_(() => ({
  key: 'log',
  emoji: '📝',
  name: '記録',
  desc: '「# coding」のように # を付けて送ると記録します。つづく（習慣カレンダー）とつながり、持ち主の記録は GitHub の草にも',
  order: 20,
  words: [LOG_LABEL_, '記録'],
  toolKeys: ['tuzuq'],
  menu: (event, role) => logMenuMessage_(event, role),
  onText: (event, text, role) => (role && LOG_TEXT_PATTERN_.test(text) ? logRouting_(event, role) : null),
  textPattern: LOG_TEXT_PATTERN_,
  textForMembers: true,
  onPostback: (event, p, role) => (role ? logRouting_(event, role) : [notAllowedText_()]),
  hourly: logHourly_,
  webhook: logAlfredWebhook_,
  tool: {
    record: (body, user) => logTuzuqCall_('record', body || {}, user),
    days: (body, user) => logTuzuqCall_('days', body || {}, user),
    status: (body, user) => logTuzuqCall_('status', body || {}, user)
  },
  samples: logSamples_,
  // トークの下のメニュー：右の Qlove のタブにボタン1つ（この機能は左のタブにならない：画像がない）
  richMenu: {
    rank: 30,
    club: { type: 'postback', data: 'm=log&a=menu', displayText: LOG_LABEL_ }
  },
  checks: () => logSelfCheckRows_().map((row) => ({ level: row.slice(0, 1) === '✅' ? '✅' : row.slice(0, 1) === '❌' ? '❌' : '⚠️', text: row.replace(/^(✅|⚠️|❌)\s*/u, '') }))
}));

/** 「📝 記録」（言葉・ボタン）：記録のしかたと、押すだけで記録できるもの（使えない人には案内） */
function logMenuMessage_(event, role) {
  if (!role) return notAllowedText_();
  const policy = logBuildPolicy_(event, role);
  const card = logBuildInfoCardOrNull_({
    tag: LOG_LABEL_,
    title: '# を付けて送ると記録',
    sections: [
      { title: '書き方', rows: ['# coding・# 💪workout（したことを記録）', '+15（いま記録したものに15分足す）', '# s coding ／ # e coding（はじめる・おわる）'] },
      { title: 'ふりかえり', rows: ['# REPORT（移動・出退勤）・# quest（目標）'] }
    ],
    buttons: [{ label: '📊 ふりかえり', text: '# REPORT' }, { label: '📋 クエスト', text: '# quest' }],
    altText: '📝 記録：# を付けて送ると記録します（例：# coding）'
  });
  const message = card || { type: 'text', text: '📝 記録：先頭に # を付けて送ると記録します（例：# coding）。' };
  message.quickReply = logBuildQuickReply_(policy);
  return message;
}
