/**
 * 56_sea_tide.gs：機能「🎣 釣り」の港・潮・風
 * 港はうみくるの表（data/ports.json）、潮は tide736.net の潮汐表（1日ぶん）、風は Open-Meteo（気象庁のモデル）。
 * 潮の読み方は、うみくるの js/daydata.js（tideAt・mazume）を写したもの（変えるときは両方）。
 * 中身：港を選ぶ・潮汐表を読む・○時○分の潮・まづめ・風の動き・まとめ（seaInfoAt_）。呼ばれるところ：56_sea_spots.gs
 */

// ---- 港 ----

/** うみくるの港の表 [{ pc, hc, name, lat, lon }]。6時間覚えておく。読めなければ [] */
function seaPorts_() {
  const cache = cache_();
  let text = cache.get('SEA_PORTS_V1');
  if (!text) {
    const res = UrlFetchApp.fetch(UMIQRU_PORTS_URL_, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return [];
    text = res.getContentText();
    try {
      cache.put('SEA_PORTS_V1', text, 21600);
    } catch (error) {
      // 覚えられなくても、今回は使える
    }
  }
  try {
    return (JSON.parse(text).ports || [])
      .filter((p) => Array.isArray(p) && p[3] != null && p[4] != null)
      .map(([pc, hc, name, lat, lon]) => ({ pc: Number(pc), hc: Number(hc), name: String(name), lat: Number(lat), lon: Number(lon) }));
  } catch (error) {
    return [];
  }
}

/** 2点のあいだ（km） */
function seaKm_(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** いちばん近い港（SEA_.portMaxKm より遠ければ null） */
function seaNearestPort_(lat, lon) {
  let best = null;
  let bestKm = Infinity;
  seaPorts_().forEach((p) => {
    const d = seaKm_({ lat, lon }, p);
    if (d < bestKm) {
      bestKm = d;
      best = p;
    }
  });
  return best && bestKm <= SEA_.portMaxKm ? best : null;
}

// ---- 潮 ----

/** その港・その日の潮汐表（tide736 の chart の1日ぶん：tide・flood・edd・moon・sun）。6時間覚えておく。読めなければ null */
function seaTideDay_(pc, hc, ymd) {
  const key = `SEA_TIDE_${pc}_${hc}_${ymd}`;
  const cache = cache_();
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);
  const [y, m, d] = ymd.split('-').map(Number);
  const res = UrlFetchApp.fetch(`${SEA_TIDE736_URL_}?pc=${pc}&hc=${hc}&yr=${y}&mn=${m}&dy=${d}&rg=day`, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  let chart = null;
  try {
    chart = ((JSON.parse(res.getContentText()) || {}).tide || {}).chart || {};
  } catch (error) {
    return null;
  }
  const day = chart[ymd];
  if (!day || !Array.isArray(day.tide) || !day.tide.length) return null;
  const small = { tide: day.tide.map((t) => ({ cm: Number(t.cm) })), flood: day.flood || [], edd: day.edd || [], moon: day.moon || {}, sun: day.sun || {} };
  try {
    cache.put(key, JSON.stringify(small), 21600);
  } catch (error) {
    // 覚えられなくても、今回は使える
  }
  return small;
}

/** "07:45" → 7.75（時）。読めなければ null */
function seaHm_(text) {
  const m = String(text || '').match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

/**
 * その日の min 分（0:00 からの分）の潮（うみくるの tideAt と同じ）：
 * 潮位（20分ごとをつないで）・その日の高さの中の割合・上げ／下げと「上げ3分」（干潮から満潮までを10に分けて）・
 * 満潮・干潮の15分以内ならその名前（near）・いちばん近い満潮から何分（fromHigh。前ならマイナス）・潮の名前（大潮など）
 */
function seaTideAt_(day, min) {
  const cm = ((day && day.tide) || []).map((t) => Number(t.cm));
  if (cm.length < 2) return null;
  const k = min / 20;
  const i = Math.max(0, Math.min(Math.floor(k), cm.length - 2));
  const value = cm[i] + (cm[i + 1] - cm[i]) * (k - i);
  const ev = [].concat(
    (day.flood || []).map((e) => ({ k: '満潮', time: e.time, m: seaHm_(e.time) * 60 })),
    (day.edd || []).map((e) => ({ k: '干潮', time: e.time, m: seaHm_(e.time) * 60 }))
  ).filter((e) => Number.isFinite(e.m)).sort((a, b) => a.m - b.m);
  const near = (list) => list.reduce((b, e) => (!b || Math.abs(e.m - min) < Math.abs(b.m - min) ? e : b), null);
  const prev = ev.slice().reverse().find((e) => e.m <= min);
  const next = ev.find((e) => e.m > min);
  const phase = next ? (next.k === '満潮' ? '上げ' : '下げ') : prev ? (prev.k === '満潮' ? '下げ' : '上げ') : null;
  const stage = prev && next ? Math.max(1, Math.min(9, Math.round(((min - prev.m) / (next.m - prev.m)) * 10))) : null;
  const close = near(ev);
  const nearBy = close && Math.abs(close.m - min) <= 15 ? close.k : null;
  const high = near(ev.filter((e) => e.k === '満潮'));
  const lo = Math.min.apply(null, cm);
  const hi = Math.max.apply(null, cm);
  return {
    cm: Math.round(value),
    pct: hi > lo ? Math.round(((value - lo) / (hi - lo)) * 100) : null,
    phase: phase,
    stage: stage,
    near: nearBy,
    stageText: nearBy ? `${nearBy}ごろ` : phase ? `${phase}${stage ? `${stage}分` : ''}` : '',
    fromHigh: high ? Math.round(min - high.m) : null,
    moon: String((day.moon && day.moon.title) || ''),
    events: ev.map((e) => `${e.k} ${e.time}`).join('・')
  };
}

/** まづめ（うみくるの mazume と同じ）：薄明のはじまり〜日の出の1時間後は「朝まづめ」、日の入りの1時間前〜薄明のおわりは「夕まづめ」。ほかは '' */
function seaMazume_(day, min) {
  const sun = (day && day.sun) || {};
  const rise = seaHm_(sun.rise);
  const set = seaHm_(sun.set);
  if (rise == null || set == null) return '';
  const tw = (sun.regular_twilight || []).map(seaHm_);
  const h = min / 60;
  if (h >= (tw[0] != null ? tw[0] : rise - 0.5) && h <= rise + 1) return '朝まづめ';
  if (h >= set - 1 && h <= (tw[1] != null ? tw[1] : set + 0.5)) return '夕まづめ';
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
  const min = Math.round(seaHm_(hm) * 60);
  const day = spot.portPc ? seaTideDay_(spot.portPc, spot.portHc, ymd) : null;
  return {
    spot: spot,
    at: date,
    ymd: ymd,
    hm: hm,
    port: spot.portName || '',
    tide: day ? seaTideAt_(day, min) : null,
    mazume: day ? seaMazume_(day, min) : '',
    wind: seaWindAround_(spot.lat, spot.lon, date)
  };
}
