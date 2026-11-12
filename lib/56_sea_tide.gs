/**
 * 56_sea_tide.gs：機能「🎣 釣り」の潮・月・太陽・風
 * 潮は気象庁の潮位表（地点ごと・1年ぶんのテキスト。毎時の潮位と満潮・干潮の時刻）。地点は 56_sea_stations.gs。
 *   tide736.net は GAS からの読みこみを断るので使わない（うみくるの画面はブラウザから tide736 を読む）。
 * ○時○分の潮位は、毎時の潮位と満潮・干潮の点を、行き過ぎないなめらかな曲線（PCHIP）でつなぐ（どの点も潮位表のまま通る）。
 * 潮の名前（大潮など）は月齢から（tide736 と同じ表。月齢はその日の21時の値）。まづめは日の出・日の入りの計算から。
 * 中身：地点を選ぶ・潮位表を読む・○時○分の潮・潮の名前・まづめ・風の動き・まとめ（seaInfoAt_）。呼ばれるところ：56_sea_spots.gs
 */

// ---- 地点 ----

/** 2点のあいだ（km） */
function seaKm_(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** いちばん近い潮位表の地点 { code, name, lat, lon, km }（SEA_.portMaxKm より遠ければ null） */
function seaNearestStation_(lat, lon) {
  let best = null;
  SEA_STATIONS_.forEach(([code, name, la, lo]) => {
    const km = seaKm_({ lat: lat, lon: lon }, { lat: la, lon: lo });
    if (!best || km < best.km) best = { code: code, name: name, lat: la, lon: lo, km: km };
  });
  return best && best.km <= SEA_.portMaxKm ? best : null;
}

// ---- 潮位表 ----

/** その地点・その年の潮位表のテキスト（6時間覚えておく）。読めなければ '' */
function seaTideYear_(code, year) {
  const key = `SEA_JMA_${code}_${year}`;
  const cache = cache_();
  const cached = cache.get(key);
  if (cached) return cached;
  const res = UrlFetchApp.fetch(`${SEA_JMA_TIDE_URL_}${year}/${code}.txt`, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return '';
  const text = res.getContentText();
  try {
    cache.put(key, text, 21600);
  } catch (error) {
    // 覚えられなくても、今回は使える
  }
  return text;
}

/**
 * 潮位表の1行（1日ぶん）を読む：1〜72字 毎時の潮位（3字×24）・73〜78字 年月日（2字×3）・79〜80字 地点記号・
 * 81〜108字 満潮の時刻と潮位（4字＋3字）×4・109〜136字 干潮（同じ）。ない満潮・干潮は 9999 999。読めなければ null
 */
function seaParseTideLine_(line) {
  const s = String(line || '');
  if (s.length < 136) return null;
  const num = (a, b) => Number(s.slice(a, b).trim());
  const hourly = [];
  for (let h = 0; h < 24; h += 1) hourly.push(num(h * 3, h * 3 + 3));
  if (hourly.some((v) => !Number.isFinite(v))) return null;
  const ymd = `20${s.slice(72, 74).trim().padStart(2, '0')}-${s.slice(74, 76).trim().padStart(2, '0')}-${s.slice(76, 78).trim().padStart(2, '0')}`;
  const events = (from, k) => {
    const out = [];
    for (let i = 0; i < 4; i += 1) {
      const t = s.slice(from + i * 7, from + i * 7 + 4);
      if (t === '9999' || !t.trim()) continue;
      const hh = Number(t.slice(0, 2).trim() || 0);
      const mm = Number(t.slice(2, 4));
      out.push({ k: k, time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, m: hh * 60 + mm, cm: Number(s.slice(from + i * 7 + 4, from + i * 7 + 7).trim()) });
    }
    return out;
  };
  return { ymd: ymd, code: s.slice(78, 80), hourly: hourly, events: events(80, '満潮').concat(events(108, '干潮')).sort((a, b) => a.m - b.m) };
}

/** "2026-11-12" から n 日ずらした日 */
function seaShiftDay_(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * その地点・その日の潮（{ hourly, prevHour（前の日の23時）, nextHour（次の日の0時）, events（前の日・次の日の満潮干潮も。m は その日の0時からの分）,
 * own（その日の満潮干潮） }）。
 * 1日ぶんを6時間覚えておく。読めなければ null
 */
function seaTideDay_(code, ymd) {
  const key = `SEA_TIDE_${code}_${ymd}`;
  const cache = cache_();
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);
  const lineOf = (day) => {
    const text = seaTideYear_(code, day.slice(0, 4));
    const want = `${day.slice(2, 4)}${String(Number(day.slice(5, 7))).padStart(2, ' ')}${String(Number(day.slice(8, 10))).padStart(2, ' ')}${code}`;
    const line = text.split(/\r?\n/).find((l) => l.slice(72, 80) === want);
    return line ? seaParseTideLine_(line) : null;
  };
  const today = lineOf(ymd);
  if (!today) return null;
  const prev = lineOf(seaShiftDay_(ymd, -1));
  const next = lineOf(seaShiftDay_(ymd, 1));
  const shift = (list, by) => list.map((e) => Object.assign({}, e, { m: e.m + by }));
  const day = {
    hourly: today.hourly,
    prevHour: prev ? prev.hourly[23] : null,
    nextHour: next ? next.hourly[0] : null,
    own: today.events,
    events: [].concat(prev ? shift(prev.events, -1440) : [], today.events, next ? shift(next.events, 1440) : [])
  };
  try {
    cache.put(key, JSON.stringify(day), 21600);
  } catch (error) {
    // 覚えられなくても、今回は使える
  }
  return day;
}

/**
 * 点 [{ m, cm }]（m の小さい順）を、行き過ぎないなめらかな曲線（PCHIP：Fritsch–Carlson）でつないだ、min の値。
 * どの点もそのまま通り、点と点のあいだで、となりの点より高く・低くならない（山・谷は点のところだけ）
 */
function seaPchip_(points, min) {
  const p = points;
  const n = p.length;
  if (!n) return null;
  if (min <= p[0].m) return p[0].cm;
  if (min >= p[n - 1].m) return p[n - 1].cm;
  const h = [];
  const delta = [];
  for (let i = 0; i < n - 1; i += 1) {
    h.push(p[i + 1].m - p[i].m);
    delta.push((p[i + 1].cm - p[i].cm) / h[i]);
  }
  const slope = (i) => {
    if (i === 0) return delta[0];
    if (i === n - 1) return delta[n - 2];
    if (delta[i - 1] * delta[i] <= 0) return 0;
    const w1 = 2 * h[i] + h[i - 1];
    const w2 = h[i] + 2 * h[i - 1];
    return (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
  };
  let i = 0;
  while (i < n - 2 && min > p[i + 1].m) i += 1;
  const t = (min - p[i].m) / h[i];
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p[i].cm + (t3 - 2 * t2 + t) * h[i] * slope(i) + (-2 * t3 + 3 * t2) * p[i + 1].cm + (t3 - t2) * h[i] * slope(i + 1);
}

/** その日の潮の点（前の日の23時〜次の日の0時の毎時の潮位と、そのあいだの満潮・干潮。同じ時刻なら満潮・干潮の値） */
function seaTidePoints_(day) {
  const byM = {};
  day.hourly.forEach((cm, h) => {
    byM[h * 60] = Number(cm);
  });
  if (day.prevHour != null) byM[-60] = Number(day.prevHour);
  if (day.nextHour != null) byM[1440] = Number(day.nextHour);
  const from = day.prevHour != null ? -60 : 0;
  const to = day.nextHour != null ? 1440 : 1380;
  (day.events || []).forEach((e) => {
    if (e.m >= from && e.m <= to) byM[e.m] = Number(e.cm);
  });
  return Object.keys(byM).map(Number).sort((a, b) => a - b).map((m) => ({ m: m, cm: byM[m] }));
}

/**
 * その日の min 分（0:00 からの分）の潮：潮位（毎時の潮位と満潮・干潮をなめらかにつなぐ）・
 * その日の高さの中の割合・上げ／下げと「上げ3分」（干潮から満潮までを10に分けて）・満潮・干潮の15分以内ならその名前（near）・
 * いちばん近い満潮から何分（fromHigh。前ならマイナス）・その日の満潮干潮の並び。読めなければ null
 */
function seaTideAt_(day, min) {
  const hourly = ((day && day.hourly) || []).map(Number);
  if (hourly.length < 24 || hourly.some((v) => !Number.isFinite(v))) return null;
  const ev = (day.events || []).slice().sort((a, b) => a.m - b.m);
  const prev = ev.slice().reverse().find((e) => e.m <= min);
  const next = ev.find((e) => e.m > min);
  const cm = seaPchip_(seaTidePoints_(Object.assign({}, day, { hourly: hourly })), min);
  const near = (list) => list.reduce((b, e) => (!b || Math.abs(e.m - min) < Math.abs(b.m - min) ? e : b), null);
  const phase = next ? (next.k === '満潮' ? '上げ' : '下げ') : prev ? (prev.k === '満潮' ? '下げ' : '上げ') : null;
  const stage = prev && next ? Math.max(1, Math.min(9, Math.round(((min - prev.m) / (next.m - prev.m)) * 10))) : null;
  const close = near(ev);
  const nearBy = close && Math.abs(close.m - min) <= 15 ? close.k : null;
  const high = near(ev.filter((e) => e.k === '満潮'));
  const own = (day.own || []).slice().sort((a, b) => a.m - b.m);
  const all = hourly.concat(own.map((e) => e.cm));
  const lo = Math.min.apply(null, all);
  const hi = Math.max.apply(null, all);
  return {
    cm: Math.round(cm),
    pct: hi > lo ? Math.max(0, Math.min(100, Math.round(((cm - lo) / (hi - lo)) * 100))) : null,
    phase: phase,
    stage: stage,
    near: nearBy,
    stageText: nearBy ? `${nearBy}ごろ` : phase ? `${phase}${stage ? `${stage}分` : ''}` : '',
    fromHigh: high ? Math.round(min - high.m) : null,
    events: own.map((e) => `${e.k} ${e.time}`).join('・')
  };
}

// ---- 月（潮の名前） ----

/** その時の月齢（日）。新月の時刻は Meeus の式（おもな補正つき。数分の差） */
function seaMoonAge_(date) {
  const jd = date.getTime() / 864e5 + 2440587.5;
  const r = Math.PI / 180;
  const newMoon = (k) => {
    const T = k / 1236.85;
    const E = 1 - 0.002516 * T - 0.0000074 * T * T;
    const M = r * (2.5534 + 29.1053567 * k - 0.0000014 * T * T);
    const Mp = r * (201.5643 + 385.81693528 * k + 0.0107582 * T * T);
    const F = r * (160.7108 + 390.67050284 * k - 0.0016118 * T * T);
    const O = r * (124.7746 - 1.56375588 * k + 0.0020672 * T * T);
    const fix = -0.4072 * Math.sin(Mp) + 0.17241 * E * Math.sin(M) + 0.01608 * Math.sin(2 * Mp) + 0.01039 * Math.sin(2 * F) +
      0.00739 * E * Math.sin(Mp - M) - 0.00514 * E * Math.sin(Mp + M) + 0.00208 * E * E * Math.sin(2 * M) - 0.00111 * Math.sin(Mp - 2 * F) -
      0.00057 * Math.sin(Mp + 2 * F) + 0.00056 * E * Math.sin(2 * Mp + M) - 0.00042 * Math.sin(3 * Mp) + 0.00042 * E * Math.sin(M + 2 * F) +
      0.00038 * E * Math.sin(M - 2 * F) - 0.00024 * E * Math.sin(2 * Mp - M) - 0.00017 * Math.sin(O) - 0.00007 * Math.sin(Mp + 2 * M);
    return 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.00000015 * T * T * T + fix - 69 / 86400; // 力学時 → 世界時（69秒）
  };
  const k = Math.floor((jd - 2451550.09766) / 29.530588861);
  for (let kk = k + 1; kk >= k - 1; kk -= 1) {
    const nm = newMoon(kk);
    if (nm <= jd) return jd - nm;
  }
  return null;
}

// 月齢（整数）→ 潮の名前（tide736・ふつうの潮汐表と同じ表）
const SEA_TIDE_NAMES_ = ['大', '大', '中', '中', '中', '中', '小', '小', '小', '長', '若', '中', '中', '大', '大', '大', '大', '中', '中', '中', '中', '小', '小', '小', '長', '若', '中', '中', '大', '大'];

/** その日の潮の名前（"大潮" など）。月齢はその日の21時の値 */
function seaMoonTitle_(ymd) {
  const age = seaMoonAge_(new Date(`${ymd}T21:00:00+09:00`));
  return age == null ? '' : `${SEA_TIDE_NAMES_[Math.min(29, Math.floor(age))]}潮`;
}

// ---- 太陽（まづめ） ----

/**
 * その日の太陽が、天頂から zenith 度になる時刻（日本時間の 0:00 からの時。rise … 朝か夕か）。白夜・極夜なら null
 * 「Almanac for Computers」の式（1〜2分の差）。日の出・日の入りは 90.833 度、市民薄明は 96 度
 */
function seaSunHour_(ymd, lat, lon, zenith, rise) {
  const r = Math.PI / 180;
  const [y, m, d] = ymd.split('-').map(Number);
  const n = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 864e5);
  const lngHour = lon / 15;
  const t = n + ((rise ? 6 : 18) - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  const L = (((M + 1.916 * Math.sin(M * r) + 0.02 * Math.sin(2 * M * r) + 282.634) % 360) + 360) % 360;
  let ra = (((Math.atan(0.91764 * Math.tan(L * r)) / r) % 360) + 360) % 360;
  ra += Math.floor(L / 90) * 90 - Math.floor(ra / 90) * 90;
  ra /= 15;
  const sinDec = 0.39782 * Math.sin(L * r);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH = (Math.cos(zenith * r) - sinDec * Math.sin(lat * r)) / (cosDec * Math.cos(lat * r));
  if (cosH > 1 || cosH < -1) return null;
  const H = (rise ? 360 - Math.acos(cosH) / r : Math.acos(cosH) / r) / 15;
  const T = H + ra - 0.06571 * t - 6.622;
  return (((T - lngHour) % 24) + 24 + 9) % 24; // 世界時 → 日本時間
}

/** その日・その場所の日の出・日の入り・市民薄明（時）。{ rise, set, dawn, dusk } */
function seaSun_(ymd, lat, lon) {
  return {
    rise: seaSunHour_(ymd, lat, lon, 90.833, true),
    set: seaSunHour_(ymd, lat, lon, 90.833, false),
    dawn: seaSunHour_(ymd, lat, lon, 96, true),
    dusk: seaSunHour_(ymd, lat, lon, 96, false)
  };
}

/** まづめ（うみくるの mazume と同じ幅）：薄明のはじまり〜日の出の1時間後は「朝まづめ」、日の入りの1時間前〜薄明のおわりは「夕まづめ」。ほかは '' */
function seaMazume_(sun, min) {
  if (!sun || sun.rise == null || sun.set == null) return '';
  const h = min / 60;
  if (h >= (sun.dawn != null ? sun.dawn : sun.rise - 0.5) && h <= sun.rise + 1) return '朝まづめ';
  if (h >= sun.set - 1 && h <= (sun.dusk != null ? sun.dusk : sun.set + 0.5)) return '夕まづめ';
  return '';
}

// ---- 風 ----

const SEA_DIRS_ = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
/** 風の向き（度。吹いてくる向き）→ 16方位 */
const seaDirName_ = (deg) => (deg == null || deg === '' || !Number.isFinite(Number(deg)) ? '' : SEA_DIRS_[Math.round((((Number(deg) % 360) + 360) % 360) / 22.5) % 16]);

/** Date → 日本時間の "2026-11-12T06:00"（その時の0分） */
function seaHourKey_(date) {
  return Utilities.formatDate(date, timeZone_(), "yyyy-MM-dd'T'HH:00");
}

/**
 * その時刻の前後の風（3時間前〜1時間後、1時間ごと）。{ ms, dir, before（3時間前）, after（1時間後）, trend, series: [m/s…] }。読めなければ null
 * 時刻は、近いほうの正時にそろえる。気象庁のモデル（jma_seamless）
 */
function seaWindAround_(lat, lon, date) {
  const base = new Date(Math.round(date.getTime() / 3600e3) * 3600e3);
  const from = seaHourKey_(new Date(base.getTime() - SEA_.windBefore * 3600e3));
  const to = seaHourKey_(new Date(base.getTime() + SEA_.windAfter * 3600e3));
  const url = `${SEA_OPEN_METEO_URL_}?latitude=${Number(lat).toFixed(3)}&longitude=${Number(lon).toFixed(3)}&hourly=wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=ms&timezone=Asia%2FTokyo&models=jma_seamless&start_hour=${from}&end_hour=${to}`;
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const hourly = (JSON.parse(res.getContentText()) || {}).hourly || {};
    return seaWindOf_(hourly, seaHourKey_(base));
  } catch (error) {
    return null;
  }
}

/** Open-Meteo の hourly から、now（"…T06:00"）の風と、前後の動き。そろわなければ null */
function seaWindOf_(hourly, now) {
  const time = Array.isArray(hourly.time) ? hourly.time : [];
  const sp = Array.isArray(hourly.wind_speed_10m) ? hourly.wind_speed_10m : [];
  const dir = Array.isArray(hourly.wind_direction_10m) ? hourly.wind_direction_10m : [];
  const i = time.indexOf(now);
  if (i < 0 || sp[i] == null) return null;
  const series = time.map((t, j) => (sp[j] == null ? null : Math.round(Number(sp[j]) * 10) / 10));
  const first = i >= SEA_.windBefore ? series[i - SEA_.windBefore] : null; // 3時間前
  const change = first == null ? 0 : series[i] - first;
  return {
    ms: series[i],
    dir: seaDirName_(dir[i]),
    before: first,
    after: i + SEA_.windAfter < series.length ? series[i + SEA_.windAfter] : null,
    trend: first == null ? '' : change >= SEA_.windTrendMs ? '強まってきた' : change <= -SEA_.windTrendMs ? '弱まってきた' : 'あまり変わらない',
    series: series
  };
}

// ---- まとめ ----

/** 釣り場と時刻から、返事とシートに使う値をそろえる（潮・風が読めなければ、その部分は null） */
function seaInfoAt_(spot, date) {
  const ymd = formatDay_(date);
  const hm = Utilities.formatDate(date, timeZone_(), 'HH:mm');
  const min = Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
  const station = seaNearestStation_(spot.lat, spot.lon);
  const day = station ? seaTideDay_(station.code, ymd) : null;
  const tide = day ? seaTideAt_(day, min) : null;
  if (tide) tide.moon = seaMoonTitle_(ymd);
  return {
    spot: spot,
    at: date,
    ymd: ymd,
    hm: hm,
    port: station ? station.name : '',
    tide: tide,
    mazume: seaMazume_(seaSun_(ymd, spot.lat, spot.lon), min),
    wind: seaWindAround_(spot.lat, spot.lon, date)
  };
}
