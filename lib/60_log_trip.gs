/**
 * 60_log_trip.gs：機能「📝 記録」の移動（CarPlay など）（LOgBOT の 05_features/trip.gs から）
 * 中身：移動のはじめ・おわり・距離と速さ・つづきの判定・この7日のまとめ
 * 呼ばれる（LOgBOT のときのファイル名）：text_router・report_replies
 *
 * # trip メッセージ（CarPlayなど）を処理する
 *
 * 仕様:
 * - type:start → 直近startとして保存して「気をつけてね」を返す
 * - type:end   → 直近startとの差分を取り、時間/距離を計算してログ化
 *
 * 追記ポリシー:
 * - スプレッドシート/ GitHub への保存は通常のログと同様（action=trip）
 * - 保存先カラム構造は既存 LOG_COLUMNS_ に合わせる（detailに集約）
 */

const LOG_TRIP_PROP_PREFIX_ = 'trip:lastStart:';

/**
 * # trip の本文（"#" 除去後）をパースして構造化する
 *
 * @param {string} detailText
 * @return {{
 *   source?: string,
 *   label?: string,
 *   type?: string,
 *   at?: string,
 *   lat?: number,
 *   lng?: number,
 * }}
 */
function logParseTripDetail_(detailText) {
  const lines = String(detailText || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  // 1行目が "trip" なら捨てる
  if (lines[0] && /^trip\b/i.test(lines[0])) {
    lines.shift();
  }

  const data = {};
  lines.forEach(line => {
    const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) return;
    const key = m[1];
    const raw = m[2];
    data[key] = raw;
  });

  const lat = data.lat != null ? Number(data.lat) : undefined;
  const lng = data.lng != null ? Number(data.lng) : undefined;

  return {
    source: data.source,
    icon: data.icon,
    label: data.label,
    type: data.type,
    at: data.at,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
  };
}

/** 移動のはじめを覚えておく Script Properties のキー */
function logTripPropKey_(userId, source) {
  const safeUser = userId || 'unknown';
  const safeSource = source || 'unknown';
  return `${LOG_TRIP_PROP_PREFIX_}${safeUser}:${safeSource}`;
}

/** 移動のはじめを覚える */
function logSaveTripStart_(userId, trip) {
  const key = logTripPropKey_(userId, trip.source);
  props_().setProperty(key, JSON.stringify(trip));
}

/** 覚えておいた移動のはじめを読む（なければ null） */
function logLoadTripStart_(userId, source) {
  const key = logTripPropKey_(userId, source);
  const raw = props_().getProperty(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/** 覚えておいた移動のはじめを消す */
function logClearTripStart_(userId, source) {
  const key = logTripPropKey_(userId, source);
  props_().deleteProperty(key);
}

/** 日時の文字を読む（なければいま。読めなければ null） */
function logParseIsoDate_(isoLike) {
  const d = isoLike ? new Date(isoLike) : new Date();
  return isNaN(d.getTime()) ? null : d;
}

/** 2つの地点（緯度・経度）のあいだの距離（km） */
function logHaversineKm_(aLat, aLng, bLat, bLng) {
  const toRad = deg => deg * Math.PI / 180;
  const R = 6371; // km
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const sin1 = Math.sin(dLat / 2);
  const sin2 = Math.sin(dLng / 2);
  const h = sin1 * sin1 + Math.cos(lat1) * Math.cos(lat2) * sin2 * sin2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

/** ミリ秒 → 「1h05m」「30m」（シートに書く形。分は切りすて） */
function logFormatDuration_(ms) {
  return logFormatMinutesAsDuration_(Math.floor(Math.max(0, ms) / 60000));
}

/** その人のいちばん新しい、同じ移動の記録を返す（なければ null） */
function logFindLatestTripLog_(userId, source) {
  const uid = String(userId || '');
  const expectedSource = String(source || '').toLowerCase();
  const logs = logGetLogs_();
  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const log = logs[i];
    if (log.action !== 'trip') continue;
    if (String(log.userId || '') !== uid) continue;
    const map = logParseLogDetailMap_(log.detail || '');
    if (String(map.source || '').toLowerCase() !== expectedSource) continue;
    return { log, map };
  }
  return null;
}

/** おわってすぐ同じ移動をはじめたら、前のつづきにする（つづきでなければ null） */
function logBuildResumedTripStart_(userId, trip, startAt) {
  const recent = logFindLatestTripLog_(userId, trip.source || 'unknown');
  if (!recent) return null;

  const previousStartAt = new Date(recent.map.start || '');
  const previousEndAt = new Date(recent.map.end || '');
  if (isNaN(previousStartAt.getTime()) || isNaN(previousEndAt.getTime())) return null;

  const gapMs = startAt.getTime() - previousEndAt.getTime();
  if (gapMs < 0 || gapMs > LOG_SESSION_RESUME_WINDOW_MS_) return null;

  const startLat = Number(recent.map.start_lat);
  const startLng = Number(recent.map.start_lng);
  return {
    ...trip,
    at: logFormatJST_(previousStartAt, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    icon: trip.icon || recent.map.icon || '',
    label: trip.label || recent.map.trip || trip.source || 'trip',
    lat: Number.isFinite(startLat) ? startLat : trip.lat,
    lng: Number.isFinite(startLng) ? startLng : trip.lng,
    resumeLogId: recent.log.ID || '',
  };
}

/**
 * # trip を処理して、必要ならログ化する
 *
 * @param {string} detailText "# を除いた本文"
 * @param {{ userId: string, canCommitGithub: boolean, testmode?: boolean }} policy
 * @return {{
 *   replyText: string,
 *   didLog: boolean,
 *   log?: Object,
 * }}
 */
function logHandleTripFromLINE_(detailText, policy) {
  const trip = logParseTripDetail_(detailText);
  const type = (trip.type || '').toLowerCase();
  const source = trip.source || 'unknown';

  if (type === 'start') {
    const startAt = logParseIsoDate_(trip.at);
    if (!startAt) {
      return { replyText: '日時(at)の形式が読み取れなかった…', didLog: false, mode: 'error' };
    }
    trip.at = logFormatJST_(startAt, "yyyy-MM-dd'T'HH:mm:ssXXX");
    const resumedTrip = logBuildResumedTripStart_(policy.userId, trip, startAt);
    const activeTrip = resumedTrip || trip;
    logSaveTripStart_(policy.userId, activeTrip);
    return {
      replyText: resumedTrip ? '前回の移動を継続したよ' : '気をつけてね',
      didLog: false,
      mode: 'start',
    };
  }

  if (type !== 'end') {
    return { replyText: 'trip の type は start / end のどちらかで送ってね', didLog: false, mode: 'error' };
  }

  const start = logLoadTripStart_(policy.userId, source);
  if (!start) {
    return { replyText: '直近の trip:start が見つからなかったよ（先に start を送ってね）', didLog: false, mode: 'error' };
  }

  const startAt = logParseIsoDate_(start.at);
  const endAt = logParseIsoDate_(trip.at);
  if (!startAt || !endAt) {
    return { replyText: '日時(at)の形式が読み取れなかった…', didLog: false, mode: 'error' };
  }

  const durationMs = endAt.getTime() - startAt.getTime();
  const minutes = Math.max(0, Math.round(durationMs / 60000));

  let distanceKm = null;
  if (
    typeof start.lat === 'number' && typeof start.lng === 'number' &&
    typeof trip.lat === 'number' && typeof trip.lng === 'number'
  ) {
    distanceKm = logHaversineKm_(start.lat, start.lng, trip.lat, trip.lng);
  }

  const label = trip.label || start.label || source;
  const icon = trip.icon || start.icon || '';
  const durationText = logFormatDuration_(durationMs);
  const distanceText = distanceKm == null ? 'n/a' : `${distanceKm.toFixed(2)}km`;
  const avgSpeedText =
    distanceKm == null || durationMs <= 0
      ? 'n/a'
      : `${(distanceKm / (durationMs / 3600000)).toFixed(1)}km/h`;

  const detail = [
    `trip: ${label}`,
    `icon: ${icon || 'n/a'}`,
    `source: ${source}`,
    `start: ${start.at}`,
    `start_lat: ${typeof start.lat === 'number' ? start.lat : 'n/a'}`,
    `start_lng: ${typeof start.lng === 'number' ? start.lng : 'n/a'}`,
    `end: ${trip.at || logFormatJST_(endAt, "yyyy-MM-dd'T'HH:mm:ssXXX")}`,
    `end_lat: ${typeof trip.lat === 'number' ? trip.lat : 'n/a'}`,
    `end_lng: ${typeof trip.lng === 'number' ? trip.lng : 'n/a'}`,
    `duration: ${durationText}`,
    `distance: ${distanceText}`,
    `avg: ${avgSpeedText}`,
    'kind: place', // 3つの型（60_log_summary.gs）：時間と移動の距離
  ].join('\n');

  const log = logCreateLog_({
    action: 'trip',
    minutes,
    detail,
    source: String(policy && policy.logSource || 'LINE'),
    userId: policy.userId,
  });
  const saved = logPersistSessionLog_(log, policy, start.resumeLogId || '');

  // end を処理したら start をクリア（次回の差分事故を防ぐ）
  logClearTripStart_(policy.userId, source);

  return { replyText: detail, didLog: true, mode: 'end', log: saved };
}

/** 分 → 「1h05m」「30m」（シートに書く形） */
function logFormatMinutesAsDuration_(minutes) {
  const m = Math.max(0, Number(minutes) || 0);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r}m`;
  return `${h}h${String(r).padStart(2, '0')}m`;
}

/** 日付に日数を足した日付を返す */
function logAddDays_(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

/** この7日の移動を、日ごとにまとめる（ふりかえり用） */
function logBuildTripRecentDailyReport_(userId, now) {
  const base = now instanceof Date ? now : new Date();
  const logs = logGetLogs_();
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const d = logAddDays_(base, -i);
    days.push({
      key: logFormatJST_(d, 'yyyy-MM-dd'),
      dateLabel: logFormatJST_(d, 'M/d'),
      weekday: logFormatWeekdayJp_(d),
      rows: [],
      totalDistanceKm: 0,
      totalMinutes: 0,
    });
  }
  const dayMap = {};
  days.forEach(d => { dayMap[d.key] = d; });

  logs
    .filter(log => log.action === 'trip')
    .filter(log => String(log.userId || '') === String(userId || ''))
    .forEach(log => {
      const map = logParseLogDetailMap_(log.detail || '');
      const startAt = new Date(map.start || '');
      const endAt = new Date(map.end || '');
      if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) return;
      const key = logFormatJST_(startAt, 'yyyy-MM-dd');
      const day = dayMap[key];
      if (!day) return;
      const distanceKm = logParseTripDistanceKm_(map.distance || '');
      day.totalDistanceKm += distanceKm == null ? 0 : distanceKm;
      day.totalMinutes += Math.max(0, Number(log.minutes) || 0);
      day.rows.push({
        date: logFormatJST_(startAt, 'M/d'),
        weekday: logFormatWeekdayJp_(startAt),
        startTime: logFormatJST_(startAt, 'HH:mm'),
        endTime: logFormatJST_(endAt, 'HH:mm'),
        duration: map.duration || '-',
        distance: map.distance || '-',
        avg: map.avg || '-',
      });
    });

  days.forEach(day => {
    day.rows.sort((a, b) => (a.startTime < b.startTime ? 1 : -1));
    day.totalDistanceText = `${day.totalDistanceKm.toFixed(1)}km`;
    day.totalDurationText = logFormatMinutesAsDuration_(day.totalMinutes);
    day.count = day.rows.length;
  });

  // はじめた時刻（3時間ずつ8つ）
  const hours = [0, 0, 0, 0, 0, 0, 0, 0];
  days.forEach(day => day.rows.forEach(row => {
    const h = Number(String(row.startTime || '').slice(0, 2));
    if (isFinite(h)) hours[Math.min(7, Math.floor(h / 3))] += 1;
  }));
  return {
    asOf: logFormatJST_(base, 'yyyy-MM-dd'),
    days: days.filter(d => d.count > 0),
    allDays: days, // 7日ぶん（新しい順。記録のない日も）
    hours,
  };
}

/**
 * 「12.34km」→ 12.34（読めなければ null）
 * （前のリファクタリングで消えていて、移動のふりかえり「# REPORT trip」がこわれていた）
 */
function logParseTripDistanceKm_(distanceText) {
  const m = String(distanceText || '').trim().match(/^([0-9]+(?:\.[0-9]+)?)km$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return isFinite(n) ? n : null;
}
