/**
 * 60_log_errors.gs：機能「📝 記録」のエラーを残す（LOgBOT の 03_record/error_log.gs から）
 * 中身：エラーを実行ログと LAST_LINE_ERRORS に残す・LINE に出すやさしい文
 * 呼ばれる（LOgBOT のときのファイル名）：line_event・つづくの受け口
 *
 * エラーを、管理者だけが見られるところ（実行ログと Script Properties の LAST_LINE_ERRORS）に残す
 * 画面・LINE には中身を出さない（G2）。LINE の ID・本文は残さない
 */

/** エラーの起きた場所（スタックの at の行）をとり出す（なければ ''） */
function logExtractErrorLocation_(err) {
  const stack = err && err.stack ? String(err.stack) : '';
  if (!stack) return '';
  const lines = stack.split('\n').map(s => s.trim()).filter(Boolean);
  const atLine = lines.find(line => /^at\s+/.test(line));
  return atLine || lines[0] || '';
}

/**
 * エラーを管理者だけが見られるところに残す（実行ログと Script Properties の LAST_LINE_ERRORS）
 * LINE の ID・本文は残さない
 */
function logLibraryError_(tag, err, context) {
  const ctx = context || {};
  const event = ctx.event || {};
  const payload = {
    tag,
    at: new Date().toISOString(),
    // qcheck-ok: G2 管理者だけが見る実行ログと LAST_LINE_ERRORS に残す（LINE には出さない）
    message: err && err.message ? err.message : String(err),
    where: logExtractErrorLocation_(err),
    eventType: String(event.type || ''),
    sourceType: String(event.source && event.source.type || ''),
  };
  console.error(JSON.stringify({ ...payload, stack: err && err.stack ? err.stack : '' }));
  try {
    const props = props_();
    let list = [];
    try { list = JSON.parse(props.getProperty('LAST_LINE_ERRORS') || '[]'); } catch (e) { list = []; }
    list.unshift(payload);
    props.setProperty('LAST_LINE_ERRORS', JSON.stringify(list.slice(0, 5)));
  } catch (e) {
    console.error(`LAST_LINE_ERRORS failed: ${String(e)}`);
  }
}
