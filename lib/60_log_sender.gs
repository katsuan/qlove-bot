/**
 * 60_log_sender.gs：機能「📝 記録」の返事の送り主のアイコン（LOgBOT の 04_line/line_sender_icon.gs から）
 * 中身：文字のアイコンの画像 URL を作る
 * 呼ばれる（LOgBOT のときのファイル名）：02_config.gs の送り主の設定
 */

/** 色の文字（#49cf27 など）を、6けたの16進（# なし）にそろえる */
function logNormalizeHexColor_(color, withHash) {
  const raw = String(color || '').trim().replace(/^#/, '');
  const safe = /^[0-9a-fA-F]{6}$/.test(raw) ? raw : '1f4fd6';
  return withHash ? `#${safe}` : safe;
}

/**
 * アイコン画像URLを生成
 *
 * @param {string} text
 * @param {{
 *   bgColor?: string,
 *   textColor?: string,
 *   size?: string,
 *   textSize?: string|number
 * }} options
 * @return {string}
 */
function logCreateLineSenderIcon_(text, options) {
  const opts = options || {};
  const baseUrl = 'https://placehold.jp/';
  const size = opts.size || '150x150';
  const textSize = String(opts.textSize || '100');
  const bg = logNormalizeHexColor_(opts.bgColor || '1f4fd6', false);
  const fg = logNormalizeHexColor_(opts.textColor || 'ffffff', false);
  const encodedText = encodeURIComponent(String(text || ''));
  return `${baseUrl}${textSize}/${bg}/${fg}/${size}.png?text=${encodedText}`;
}

