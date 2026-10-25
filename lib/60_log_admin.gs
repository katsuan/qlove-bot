/**
 * 60_log_admin.gs：機能「📝 記録」の管理者向けの返事（LOgBOT の 04_line/admin_replies.gs から）
 * 中身：# users（管理画面を開くカード）・# test（本当に記録して試すカード）
 * 呼ばれる（LOgBOT のときのファイル名）：text_router（持ち主のときだけ）
 */

/* ==================================================
 * 管理者向け
 * ================================================== */

/**
 * 「# test」：主な道を、押すだけで試せるカード（持ち主だけ）
 * 押すと本当に記録される（シート・GitHub に入る）。並びは docs/user-test.md と同じ
 */
function logBuildAdminTestReplies_() {
  const cmd = (command, icon, label, type, extra) => logBuildCommandText_({ command, source: extra || command, icon, label, type });
  // ボタンは1行に1つ。何をためすかが切れずに読めるように（20字まで）
  const button = ([label, text]) => logBuildSecondaryButton_(/^https:/.test(text) ? logUriAction_(label, text) : logMessageAction_(label, text));
  const page = (title, note, items) => ({
    type: 'bubble',
    size: 'mega',
    header: logBuildHeaderBox_('🧪 ためす（持ち主だけ・本当に記録されます）', { type: 'text', text: title, color: '#ffffff', size: 'md', weight: 'bold', wrap: true }, 'report', { paddingAll: '10px', spacing: false }),
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '10px',
      contents: [{ type: 'text', text: note, size: 'xs', color: '#6a7892', wrap: true }].concat(items.map(button)),
    },
  });
  const msg = {
    type: 'flex',
    altText: '🧪 ためす（持ち主だけ）：横にめくると3つあります。押すと本当に記録されます',
    contents: {
      type: 'carousel',
      contents: [
        page('1. 記録する', 'ふつうの記録と、時間を足す・# なしで送ったとき', [
          ['💪 筋トレを記録する', '# 💪workout'],
          ['🧑‍💻 コーディングを記録する', '# 🧑‍💻coding'],
          ['⏱ いまの記録に15分足す', '+15'],
          ['💬 # を付けずに送る', 'ジムいった'],
        ]),
        page('2. はじめ・おわり', '上から順に押す（はじめ → おわり）', [
          ['🚩 移動をはじめる（CarPlay）', cmd('trip', '🚙', 'CarPlay', 'start', 'carplay')],
          ['🏁 移動をおわる（CarPlay）', cmd('trip', '🚙', 'CarPlay', 'end', 'carplay')],
          ['🚩 出勤する', '# attendance start'],
          ['🏁 退勤する', '# attendance end'],
          ['🔋 充電をはじめる（20%）', '# s charge 20%'],
          ['🔋 充電をおわる（80%）', '# e charge 80%'],
        ]),
        page('3. ふりかえり・知らせ', 'どれも見るだけ（記録はふえない）', [
          ['📊 ふりかえりを選ぶ', '# REPORT'],
          ['🚙 移動のふりかえり（7日）', '# REPORT trip'],
          ['🏢 出退勤のふりかえり（月）', '# REPORT attendance'],
          ['📋 クエストを見る', '# quest'],
          ['🔔 知らせの設定を見る', '# 通知'],
          ['🔔 知らせの見本を見る', '# 通知 ためす'],
          ['✅ つづくを開く', 'https://liff.line.me/2012187502-o87l8Esu'],
          ['⌨️ Alfred の記録を見る', '# alfred report'],
        ]),
      ],
    },
  };
  return [logWithSender_(msg, 'activity')];
}
