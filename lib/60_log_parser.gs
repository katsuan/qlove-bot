/**
 * 60_log_parser.gs：機能「📝 記録」のLINE の文字を読む（LOgBOT の 04_line/text_parser.gs から）
 * 中身：# の外し方・短い書き方・COMMAND の形・+15・postback の data・行動の名前
 * 呼ばれる（LOgBOT のときのファイル名）：text_router・adjust_replies・ふりかえり
 */

/** 文字のメッセージか */
function logIsTextMessage_(event) {
  return event.message.type === 'text';
}

/** 記録する文か（先頭に # か ＃ があり、そのあとに文字がある） */
function logIsLogTargetText_(text) {
  // フールプルーフ:
  // - 半角/全角シャープ（# / ＃）を許容
  // - "#test" / "# test" の表記ゆれを同一扱い
  // 受け取りは広く、内部では extractDetail_ で正規化して処理する
  return /^\s*[#＃]\s*\S+/u.test(String(text || ''));
}

/** 先頭の # と空白を外した本文を返す */
function logExtractDetail_(text) {
  // 先頭の # / ＃ とその直後の空白を取り除いて内部形式を統一
  return String(text || '').replace(/^\s*[#＃]\s*/u, '').trim();
}

/** 移動（trip）の本文か */
function logIsTripDetail_(detail) {
  return /^trip\b/i.test(String(detail || '').trim());
}

/** 出退勤（attendance）の本文か */
function logIsAttendanceDetail_(detail) {
  return /^attendance\b/i.test(String(detail || '').trim());
}

/** 「s charge 20%」「e charge」のような短い書き方を読む。ちがえば null */
function logParseShorthandLineCommand_(detail) {
  const text = String(detail || '').trim();
  const m = text.match(/^([se])\s+([^\s]+)(?:\s+(.+))?$/i);
  if (!m) return null;
  return {
    mode: String(m[1] || '').toLowerCase(), // s | e
    command: String(m[2] || '').toLowerCase(),
    memo: String(m[3] || '').trim(),
  };
}

/** 「# COMMAND」から始まる書き方（command・type などの行）を読む。ちがえば null */
function logParseCommandEnvelope_(detail) {
  const lines = String(detail || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  if (!/^command$/i.test(lines[0])) return null;

  const map = {};
  lines.slice(1).forEach(line => {
    const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) return;
    map[m[1].toLowerCase()] = m[2];
  });
  const command = String(map.command || '').toLowerCase();
  return { command, map };
}

/** 「# COMMAND」の中身を、ふだんの本文の形（command と key: value の行）にする */
function logBuildNormalizedCommandDetail_(envelope) {
  const command = envelope.command;
  const map = envelope.map || {};
  const lines = [command];
  ['source', 'icon', 'label', 'type', 'at', 'lat', 'lng', 'memo'].forEach(key => {
    if (map[key] == null || map[key] === '') return;
    lines.push(`${key}: ${map[key]}`);
  });
  return lines.join('\n');
}

/** 「+15」のような時間を足す文を読む。{delta} か {error}。ちがえば null */
function logParseMinuteAdjustCommand_(text) {
  const normalized = String(text || '').trim().replace('＋', '+');
  const m = normalized.match(/^\+(\d{1,3})$/);
  if (!m) return null;
  const delta = Number(m[1]);
  if (!isFinite(delta) || delta <= 0) return null;
  if (delta > 720) {
    return { error: '時間追加は +1〜+720 分で指定してください。' };
  }
  return { delta };
}

/** postback の data（a=1&b=2）を { a: '1', b: '2' } にする */
function logParsePostbackData_(data) {
  const text = String(data || '');
  const out = {};
  text.split('&').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx <= 0) return;
    const key = decodeURIComponent(pair.slice(0, idx));
    const val = decodeURIComponent(pair.slice(idx + 1));
    out[key] = val;
  });
  return out;
}

/** 移動の記録の本文（key: value の行）を読んで、カードに出す形にする */
function logParseTripResultText_(text) {
  const out = {
    title: '',
    icon: '',
    source: '',
    start: '',
    end: '',
    startTime: '',
    endTime: '',
    duration: '',
    distance: '',
    avg: '',
    startLat: '',
    startLng: '',
    endLat: '',
    endLng: '',
  };
  String(text || '').split(/\r?\n/).forEach(line => {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) return;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === 'trip') out.title = value;
    if (key === 'icon') out.icon = value;
    if (key === 'source') out.source = value;
    if (key === 'start') out.start = value;
    if (key === 'end') out.end = value;
    if (key === 'duration') out.duration = value;
    if (key === 'distance') out.distance = value;
    if (key === 'avg') out.avg = value;
    if (key === 'start_lat') out.startLat = value;
    if (key === 'start_lng') out.startLng = value;
    if (key === 'end_lat') out.endLat = value;
    if (key === 'end_lng') out.endLng = value;
  });
  out.startTime = logExtractTimeText_(out.start);
  out.endTime = logExtractTimeText_(out.end);
  out.distance = logShortenTripDistanceText_(out.distance);
  out.avg = logShortenTripMetricText_(out.avg);
  return out;
}

/** 日時の文字から「HH:mm」をとり出す（なければ ''） */
function logExtractTimeText_(value) {
  const text = String(value || '');
  const iso = text.match(/T(\d{2}:\d{2})/);
  if (iso) return iso[1];
  const hm = text.match(/(\d{1,2}:\d{2})/);
  if (hm) return hm[1];
  return text;
}

/** 「12.345km」を「12.3km」のように短くする */
function logShortenTripDistanceText_(value) {
  const text = String(value || '');
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)km$/i);
  if (!match) return text;
  const num = Number(match[1]);
  if (!isFinite(num)) return text;
  return `${num.toFixed(1)}km`;
}

/** 「26.34km/h」を「26.3km/h」のように短くする */
function logShortenTripMetricText_(value) {
  const text = String(value || '');
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)km\/h$/i);
  if (!match) return text;
  const num = Number(match[1]);
  if (!isFinite(num)) return text;
  return `${num.toFixed(1)}km/h`;
}

/** 本文の先頭の絵文字と名前を分ける（つながった絵文字も1つとして） */
function logSplitLeadingIconLabel_(rawLabel) {
  const text = String(rawLabel || '').trim();
  if (!text) return { icon: '', label: '記録' };
  // ZWJ を含む絵文字シーケンス（例: 🧑‍💻）を先頭アイコンとしてまとめて扱う
  const m = text.match(/^((?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)+)\s*(.*)$/u);
  if (!m) return { icon: '', label: text };
  const icon = m[1] || '';
  const label = String(m[2] || '').trim() || text;
  return { icon, label };
}

