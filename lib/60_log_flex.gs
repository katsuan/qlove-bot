/**
 * 60_log_flex.gs：機能「📝 記録」のカードの小さな部品（LOgBOT の 04_line/flex_parts.gs から）
 * 中身：色の帯・見出し・行・ボタン・長さの文字
 * 呼ばれる（LOgBOT のときのファイル名）：返事を作るファイル
 */

const LOG_UI_HEADER_COLORS_ = {
  start: '#3578e5',
  end: '#2e9b3f',
  report: '#1b2438',
  caution: '#f2b705',
  error: '#e74343',
};

const LOG_UI_HEADER_TEXT_COLORS_ = {
  start: '#dfe8ff',
  end: '#124a12',
  report: '#d6dbe8',
  caution: '#5a4300',
  error: '#ffe3e3',
};

/** カードの色の帯の色を、種類（start・end・report・warning）から選ぶ */
function logResolveHeaderStyle_(kind, warningLevel) {
  let key = kind;
  if (kind === 'warning') key = warningLevel === 'caution' ? 'caution' : 'error';
  if (!LOG_UI_HEADER_COLORS_[key]) key = 'report';
  return { bgColor: LOG_UI_HEADER_COLORS_[key], fgColor: LOG_UI_HEADER_TEXT_COLORS_[key] };
}

/**
 * 色付きヘッダー（小さなタグ＋タイトル）
 *
 * @param {string} tagText
 * @param {Object} titleNode
 * @param {string} kind start | end | report | warning
 * @param {{warningLevel?: string, paddingAll?: string, spacing?: string|false, tagWeight?: string}=} options
 *   spacing に false を渡すと spacing を付けない
 */
function logBuildHeaderBox_(tagText, titleNode, kind, options) {
  const opts = options || {};
  const style = logResolveHeaderStyle_(kind, opts.warningLevel || '');
  const box = {
    type: 'box',
    layout: 'vertical',
    backgroundColor: style.bgColor,
    paddingAll: opts.paddingAll || '16px',
    contents: [
      { type: 'text', text: tagText, color: style.fgColor, size: 'xs', weight: opts.tagWeight || 'bold', wrap: true },
      titleNode,
    ],
  };
  if (opts.spacing !== false) box.spacing = opts.spacing || 'sm';
  return box;
}

/** カードの見出し（絵文字と名前）を作る */
function logBuildIconLabelHeader_(icon, label) {
  const iconText = String(icon || '').trim();
  const title = String(label || '').trim() || '記録';
  if (!iconText) {
    return { type: 'text', text: title, color: '#ffffff', size: 'xl', weight: 'bold', wrap: true };
  }
  return {
    type: 'box',
    layout: 'horizontal',
    alignItems: 'center',
    spacing: 'sm',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        width: '34px',
        height: '34px',
        backgroundColor: '#dfe8ff',
        cornerRadius: '17px',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 0,
        contents: [{ type: 'text', text: iconText, size: 'sm', weight: 'regular', color: '#2a3e78', wrap: false }],
      },
      { type: 'text', text: title, color: '#ffffff', size: 'xl', weight: 'bold', wrap: true, flex: 1 },
    ],
  };
}

/** 「名前　値」の1行を作る */
function logBuildStatsRow_(label, value) {
  return {
    type: 'box',
    layout: 'baseline',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#61708b', flex: 2, wrap: true },
      { type: 'text', text: String(value), size: 'md', color: '#101a33', weight: 'regular', align: 'end', flex: 3, wrap: true },
    ],
  };
}

/** カードの中の小さな見出しを作る */
function logBuildSectionLabel_(text, extra) {
  return { type: 'text', text, size: 'xs', color: '#6a7892', weight: 'regular', ...(extra || {}) };
}

/** 押すと文字を送るボタンの動きを作る */
function logMessageAction_(label, text) {
  return { type: 'message', label, text };
}

/** 押すと URL を開くボタンの動きを作る */
function logUriAction_(label, uri) {
  return { type: 'uri', label, uri };
}

/** グレーの小さいボタン。flex を省略すると横幅いっぱい */
function logBuildSecondaryButton_(action, flex) {
  const button = { type: 'button', style: 'secondary', height: 'sm' };
  if (flex != null) button.flex = flex;
  button.action = action;
  return button;
}

/** 「1h 20m」「30m」→「1時間20分」「30分」 */
function logJpDuration_(text) {
  const t = String(text == null ? '' : text).trim();
  if (!/^\s*(\d+\s*h)?\s*(\d+\s*m)?\s*$/i.test(t) || !t) return t || '-';
  const h = (t.match(/(\d+)\s*h/i) || [])[1];
  const m = Number((t.match(/(\d+)\s*m/i) || [])[1] || 0);
  if (h != null) return `${Number(h)}時間${m ? `${m}分` : ''}`;
  return `${m}分`;
}
