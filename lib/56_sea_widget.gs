/**
 * 56_sea_widget.gs：記録の1枚目のカード。うみくるの大きいウィジェット（q-sqriptable の sea・大）を、LINE のカードで描く
 *
 * 並び・時間はウィジェットと同じ：潮 → 波 → 風のグラフを縦に、写真の時刻の前の目盛り（0・6・12・18時）の3時間前から24時間。
 * 夜はうすく塗り、写真の時刻に縦の線（同じ日・同じ釣り場の前の記録は薄い線）。下の行は つぎの潮・まづめ・突風。
 * LINE のカードは線を引けないので、細い棒をすき間なく並べる：潮は曲線（面）、波・風は予報のいちばん低い値を濃く・予報のひらきをうすく。
 * 夜・縦の線・字は、重ねる部品（position: absolute）で置く。
 * 予報の名前・色は q-sqriptable の SEA（waves・winds・palette のライト）と同じ。
 * 呼ばれるところ：56_sea_tide.gs の seaInfoAt_（読みこみ）・56_sea_spots.gs の seaRecordMessage_（カード）
 */

const SEA_WIDE_ = {
  hours: 24,
  tideSlotMin: 30, // 潮の棒の幅（分）。カードの大きさ（LINE は 30KB まで）に入るように
  height: { tide: 56, wave: 40, wind: 40 }, // グラフの高さ（px）
  waves: [
    { key: 'ecmwf_wam025', label: 'WAM' },
    { key: 'ncep_gfswave025', label: 'GFS' },
    { key: 'meteofrance_wave', label: 'MFWAM' },
    { key: 'ncep_gfswave016', label: 'GFS細' }
  ],
  winds: [
    { key: 'jma_msm', label: 'MSM' },
    { key: 'jma_gsm', label: 'GSM' },
    { key: 'gfs_seamless', label: 'GFS' },
    { key: 'ecmwf_ifs025', label: 'IFS' }
  ],
  color: { tide: '#E87BA4', wave: '#2A78D6', wind: '#6250D6' }, // ウィジェットの潮・ECMWF・気象庁の色（ライト）
  night: '#EEF0F4',
  line: '#111827',
  lineOld: '#9CA3AF',
  marineUrl: 'https://marine-api.open-meteo.com/v1/marine'
};
// 矢印：吹いていく向き（北の風 → ↓）。来る向きを 45° ごとに
const SEA_ARROWS_ = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];

// ---- 読みこみ ----

/** グラフの始まり（その日の0時からの時）：写真の時刻の前の目盛り（0・6・12・18時）の3時間前。ウィジェットの seaWindow と同じ */
function seaWideFrom_(min) {
  const i = Math.floor(min / 60);
  return Math.max(0, Math.floor(i / 6) * 6 - 3);
}

/** JSON を読む（読めなければ null） */
function seaFetchJson_(url) {
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    return res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : null;
  } catch (error) {
    return null;
  }
}

/** その日の0時から from 時の Date */
function seaWideTime_(ymd, hour) {
  return new Date(new Date(`${ymd}T00:00:00+09:00`).getTime() + hour * 3600e3);
}

/**
 * グラフに使う値を読む（波：Open-Meteo Marine の4つ、風：Open-Meteo の4つと突風）。
 * 潮は潮位表（その日と次の日）。返すものは seaWideOf_ の中身
 */
function seaWideLoad_(spot, ymd, min, station) {
  const from = seaWideFrom_(min);
  const start = seaHourKey_(seaWideTime_(ymd, from));
  const end = seaHourKey_(seaWideTime_(ymd, from + SEA_WIDE_.hours));
  const at = `latitude=${Number(spot.lat).toFixed(3)}&longitude=${Number(spot.lon).toFixed(3)}&timezone=Asia%2FTokyo&start_hour=${start}&end_hour=${end}`;
  const wave = seaFetchJson_(`${SEA_WIDE_.marineUrl}?${at}&cell_selection=sea&hourly=wave_height&models=${SEA_WIDE_.waves.map((m) => m.key).join(',')}`);
  const wind = seaFetchJson_(`${SEA_OPEN_METEO_URL_}?${at}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=ms&models=${SEA_WIDE_.winds.map((m) => m.key).join(',')}`);
  const day = station ? seaTideDay_(station.code, ymd) : null;
  const next = station && from + SEA_WIDE_.hours > 24 ? seaTideDay_(station.code, seaShiftDay_(ymd, 1)) : null;
  return seaWideOf_({ ymd: ymd, min: min, from: from, wave: wave, wind: wind, day: day, next: next, lat: spot.lat, lon: spot.lon });
}

/**
 * 読んだものから、グラフの値にそろえる（読みこみなし。#テストの見本もこれを通す）。
 * { from, tide: [cm…72]（20分ごと。ないところは null）, marks: [{ m, k, time }], range, waves: [{ label, v: [25] }], winds: [{ label, v, dir }],
 *   gust: [25], night: [{ from, to }]（分）, sun: [{ rise, set, dawn, dusk }]（時。その日・次の日） }
 */
function seaWideOf_(raw) {
  const from = raw.from;
  const hours = Array.from({ length: SEA_WIDE_.hours + 1 }, (_, k) => seaHourKey_(seaWideTime_(raw.ymd, from + k)));
  const pick = (json, name) => {
    const h = (json && json.hourly) || {};
    const time = Array.isArray(h.time) ? h.time : [];
    const list = Array.isArray(h[name]) ? h[name] : [];
    return hours.map((t) => {
      const j = time.indexOf(t);
      return j < 0 || list[j] == null ? null : Math.round(Number(list[j]) * 10) / 10;
    });
  };
  const waves = SEA_WIDE_.waves.map((m) => ({ label: m.label, v: pick(raw.wave, `wave_height_${m.key}`) })).filter((s) => s.v.some((x) => x != null));
  const winds = SEA_WIDE_.winds.map((m) => ({ label: m.label, v: pick(raw.wind, `wind_speed_10m_${m.key}`), dir: pick(raw.wind, `wind_direction_10m_${m.key}`) })).filter((s) => s.v.some((x) => x != null));
  const gusts = SEA_WIDE_.winds.map((m) => pick(raw.wind, `wind_gusts_10m_${m.key}`));
  const gust = hours.map((_, k) => {
    const g = gusts.map((list) => list[k]).filter((x) => x != null);
    return g.length ? Math.round(Math.max(...g)) : null;
  });
  // 潮：その日（前の日の23時〜次の日の0時）と次の日の点を1本につなぐ
  let points = [];
  let marks = [];
  if (raw.day) {
    points = seaTidePoints_(raw.day);
    marks = (raw.day.events || []).slice();
    if (raw.next) {
      points = points.concat(seaTidePoints_(raw.next).filter((p) => p.m > 0).map((p) => ({ m: p.m + 1440, cm: p.cm })));
      (raw.next.own || []).forEach((e) => marks.push(Object.assign({}, e, { m: e.m + 1440 })));
    }
  }
  const seen = {};
  marks = marks.filter((e) => e.m >= from * 60 && e.m <= (from + SEA_WIDE_.hours) * 60 && !seen[e.m] && (seen[e.m] = true)).sort((a, b) => a.m - b.m);
  const last = points.length ? points[points.length - 1].m : -1;
  const slots = Math.round((SEA_WIDE_.hours * 60) / SEA_WIDE_.tideSlotMin);
  const tide = points.length
    ? Array.from({ length: slots }, (_, k) => {
      const m = from * 60 + (k + 0.5) * SEA_WIDE_.tideSlotMin;
      return m < points[0].m || m > last ? null : Math.round(seaPchip_(points, m));
    })
    : [];
  const own = (raw.day && raw.day.own) || [];
  const range = own.some((e) => e.k === '満潮') && own.some((e) => e.k === '干潮')
    ? Math.round(Math.max(...own.filter((e) => e.k === '満潮').map((e) => Number(e.cm))) - Math.min(...own.filter((e) => e.k === '干潮').map((e) => Number(e.cm))))
    : null;
  // 夜：日の入り〜日の出（その日と次の日）
  const sun = [raw.ymd, seaShiftDay_(raw.ymd, 1)].map((d) => seaSun_(d, raw.lat, raw.lon));
  const night = [];
  if (sun.every((s) => s.rise != null && s.set != null)) {
    night.push({ from: -1440, to: sun[0].rise * 60 }, { from: sun[0].set * 60, to: 1440 + sun[1].rise * 60 }, { from: 1440 + sun[1].set * 60, to: 2880 });
  }
  return { from: from, tide: tide.some((x) => x != null) ? tide : [], marks: marks, range: range, waves: waves, winds: winds, gust: gust, night: night, sun: sun };
}

// ---- カード ----

/** 1時間ごとの予報の並びの、k 番目のいちばん低い・高い値（なければ null） */
function seaWideRange_(list, k) {
  const v = list.map((s) => s.v[k]).filter((x) => x != null);
  return v.length ? { lo: Math.min(...v), hi: Math.max(...v) } : null;
}

/** "1.2〜1.5"（同じなら1つ。10 以上は整数） */
function seaWideRangeText_(r) {
  const f = (x) => (x >= 10 ? String(Math.round(x)) : x.toFixed(1));
  return f(r.lo) === f(r.hi) ? f(r.hi) : `${f(r.lo)}〜${f(r.hi)}`;
}

/** LINE が空の箱を受けつけないことがあるので、見えない文字を1つ入れた箱 */
function seaWideBox_(props) {
  return Object.assign({ type: 'box', layout: 'vertical', contents: [{ type: 'text', text: ' ', size: '1px' }] }, props);
}

/** 分（グラフの始まりから）→ 横の位置（%） */
function seaWidePct_(wd, m) {
  return Math.max(0, Math.min(100, ((m - wd.from * 60) / (SEA_WIDE_.hours * 60)) * 100));
}

/**
 * グラフの枠：下に夜の帯、まん中に棒の並び（ふつうに並べる）、上に釣った時刻の縦の線と、字（extra）を重ねる
 */
function seaWideFrame_(wd, info, height, bars, extra) {
  const span = SEA_WIDE_.hours * 60;
  const start = wd.from * 60;
  const segments = [];
  let at = start;
  wd.night.forEach((n) => {
    const a = Math.max(start, n.from);
    const b = Math.min(start + span, n.to);
    if (b <= a) return;
    if (a > at) segments.push(seaWideBox_({ flex: Math.round(a - at) }));
    segments.push(seaWideBox_({ flex: Math.round(b - a), backgroundColor: SEA_WIDE_.night }));
    at = b;
  });
  if (at < start + span) segments.push(seaWideBox_({ flex: Math.round(start + span - at) }));
  const layer = (contents, props) => Object.assign({ type: 'box', layout: 'horizontal', position: 'absolute', offsetTop: '0px', offsetStart: '0px', width: '100%', height: '100%', contents: contents }, props || {});
  const lines = seaCatchList_(info)
    .map((c) => ({ m: c.min, latest: c.latest }))
    .filter((c) => c.m >= start && c.m <= start + span)
    .map((c) => seaWideBox_({ position: 'absolute', offsetTop: '0px', offsetStart: `${seaWidePct_(wd, c.m).toFixed(1)}%`, width: '2px', height: '100%', backgroundColor: c.latest ? SEA_WIDE_.line : SEA_WIDE_.lineOld }));
  return {
    type: 'box',
    layout: 'vertical',
    height: `${height}px`,
    margin: 'xs',
    contents: [layer(segments)]
      .concat([{ type: 'box', layout: 'horizontal', height: `${height}px`, alignItems: 'flex-end', spacing: 'none', contents: bars }])
      .concat(lines)
      .concat(extra || [])
  };
}

/** 潮のグラフ：20分ごとの棒で曲線（面）に。満潮・干潮の時刻を、山・谷の上に */
function seaWideTide_(wd, info) {
  const H = SEA_WIDE_.height.tide;
  const label = 12; // 字のぶんのあき
  const vals = wd.tide.filter((x) => x != null);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const hOf = (cm) => Math.round(2 + (H - label - 2) * (hi > lo ? (cm - lo) / (hi - lo) : 0.5));
  const bars = wd.tide.map((cm) => (cm == null ? seaWideBox_({ flex: 1, height: '1px' }) : seaWideBox_({ flex: 1, height: `${hOf(cm)}px`, backgroundColor: SEA_WIDE_.color.tide })));
  const marks = wd.marks.map((e) => {
    const pct = seaWidePct_(wd, e.m);
    return {
      type: 'text',
      text: String(e.time).replace(/^0/, ''),
      size: 'xxs',
      color: '#374151',
      position: 'absolute',
      offsetBottom: `${Math.min(H - label, hOf(Number(e.cm)) + 1)}px`,
      offsetStart: `${Math.max(0, Math.min(86, pct - 6)).toFixed(1)}%`
    };
  });
  return seaWideFrame_(wd, info, H, bars, marks);
}

/** 波・風のグラフ：1時間ごとの棒。予報のいちばん低い値まで濃く、いちばん高い値までうすく（予報のひらき） */
function seaWideBand_(wd, info, list, color, height, floor) {
  const top = Math.max(floor, ...list.flatMap((s) => s.v.filter((x) => x != null)));
  const px = (x) => Math.max(1, Math.round((height - 2) * (x / top)));
  const bars = Array.from({ length: SEA_WIDE_.hours }, (_, k) => {
      const a = seaWideRange_(list, k);
      const b = seaWideRange_(list, k + 1);
      if (!a && !b) return seaWideBox_({ flex: 1, height: '1px' });
      const r = { lo: Math.min((a || b).lo, (b || a).lo), hi: Math.max((a || b).hi, (b || a).hi) }; // その1時間の両はし
      const lo = (a && b) ? (a.lo + b.lo) / 2 : r.lo;
      return {
        type: 'box', layout: 'vertical', flex: 1, height: `${px(r.hi)}px`, backgroundColor: weatherFade_(color, 0.3), justifyContent: 'flex-end',
        contents: [seaWideBox_({ height: `${px(lo)}px`, backgroundColor: color })]
      };
    });
  return seaWideFrame_(wd, info, height, bars, [{ type: 'text', text: `${top >= 10 ? Math.round(top) : top.toFixed(1)}`, size: 'xxs', color: '#9CA3AF', position: 'absolute', offsetTop: '0px', offsetEnd: '0px' }]);
}

/** 時刻の目盛り（6時ごと）。位置はグラフと同じ */
function seaWideAxis_(wd) {
  const out = [];
  for (let t = Math.ceil(wd.from / 6) * 6; t <= wd.from + SEA_WIDE_.hours; t += 6) {
    const pct = ((t - wd.from) / SEA_WIDE_.hours) * 100;
    out.push({ type: 'text', text: `${t % 24 === 0 && t > wd.from ? 24 : t % 24}`, size: 'xxs', color: '#6B7280', position: 'absolute', offsetTop: '0px', offsetStart: `${Math.max(0, Math.min(94, pct - 2)).toFixed(1)}%` });
  }
  return { type: 'box', layout: 'vertical', height: '14px', contents: [seaWideBox_({ height: '1px' })].concat(out) };
}

/** 風の向きの矢印（3時間ごと。予報を風速の重みでならす。ウィジェットの seaMeanDir と同じ）。割れていればうすく、ほぼ無風なら点 */
function seaWideArrows_(wd) {
  const r = Math.PI / 180;
  const out = [];
  for (let t = Math.ceil(wd.from / 3) * 3; t <= wd.from + SEA_WIDE_.hours; t += 3) {
    const k = t - wd.from;
    const list = wd.winds.map((s) => ({ sp: s.v[k], dir: s.dir[k] })).filter((x) => x.sp != null && x.dir != null);
    if (!list.length) continue;
    const x = list.reduce((a, m) => a + m.sp * Math.sin(m.dir * r), 0) / list.length;
    const y = list.reduce((a, m) => a + m.sp * Math.cos(m.dir * r), 0) / list.length;
    const mean = (((Math.atan2(x, y) / r) % 360) + 360) % 360;
    const spread = Math.max(...list.map((m) => Math.abs(((((m.dir - mean) % 360) + 540) % 360) - 180)));
    const calm = Math.hypot(x, y) < 0.5;
    const pct = (k / SEA_WIDE_.hours) * 100;
    out.push({
      type: 'text', text: calm ? '・' : SEA_ARROWS_[Math.round(mean / 45) % 8], size: 'xs', color: calm || spread > 45 ? '#9CA3AF' : '#111827',
      position: 'absolute', offsetTop: '0px', offsetStart: `${Math.max(0, Math.min(95, pct - 2)).toFixed(1)}%`
    });
  }
  return { type: 'box', layout: 'vertical', height: '16px', contents: [seaWideBox_({ height: '1px' })].concat(out) };
}

/** グラフの見出し（左に名前、右に写真の時刻の値） */
function seaWideTitle_(name, value) {
  return {
    type: 'box', layout: 'horizontal', margin: 'md',
    contents: [{ type: 'text', text: name, size: 'xs', weight: 'bold', color: '#111827', flex: 0 }, { type: 'text', text: value || ' ', size: 'xxs', color: '#6B7280', align: 'end', gravity: 'center' }]
  };
}

/** 下の行：つぎの潮・まづめ・突風（写真の時刻から） */
function seaWideFoot_(wd, info) {
  const min = Number(info.hm.slice(0, 2)) * 60 + Number(info.hm.slice(3, 5));
  const parts = [];
  const next = wd.marks.find((e) => e.m > min);
  if (next) parts.push(`つぎ ${next.k} ${String(next.time).replace(/^0/, '')}`);
  const clock = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;
  const s = wd.sun[0];
  if (s && s.rise != null && s.set != null) {
    const h = min / 60;
    const spans = [{ k: '朝まづめ', a: s.dawn != null ? s.dawn : s.rise - 0.5, b: s.rise + 1 }, { k: '夕まづめ', a: s.set - 1, b: s.dusk != null ? s.dusk : s.set + 0.5 }];
    const mz = spans.find((x) => x.b >= h);
    if (mz) parts.push(`${mz.k} ${clock(mz.a)}〜${clock(mz.b)}`);
  }
  const k = Math.round(min / 60) - wd.from;
  if (wd.gust[k] != null) parts.push(`突風 ${wd.gust[k]}m/s`);
  return parts.length ? { type: 'text', text: parts.join('・'), size: 'xxs', color: '#111827', wrap: true, margin: 'md' } : null;
}

/** 1枚目：うみくるの大きいウィジェットと同じ並び（潮 → 波 → 風）のカード */
function seaWideCard_(info) {
  const wd = info.wide;
  const t = info.tide;
  const min = Number(info.hm.slice(0, 2)) * 60 + Number(info.hm.slice(3, 5));
  const k = Math.round(min / 60) - (wd ? wd.from : 0);
  const body = [];
  if (t) {
    body.push({ type: 'text', text: [t.moon, t.stageText].filter(Boolean).join('・') || '潮', size: 'lg', weight: 'bold', color: '#111827', wrap: true });
    body.push(smallText_(`潮位 ${t.cm}cm${t.pct == null ? '' : `（その日の${t.pct}%）`}${seaHighText_(t)}`));
  } else {
    body.push(smallText_(seaNoTideText_(info), { size: 'sm' }));
  }
  if (wd && wd.tide.length) {
    body.push(seaWideTitle_('潮', [info.port, wd.range == null ? '' : `潮位差 ${(Math.round(wd.range / 10) / 10).toFixed(1)}m`].filter(Boolean).join('・')));
    body.push(seaWideTide_(wd, info));
  }
  if (wd && wd.waves.length) {
    const r = seaWideRange_(wd.waves, k);
    body.push(seaWideTitle_('波', `${r ? `${seaWideRangeText_(r)}m　` : ''}${wd.waves.map((s) => s.label).join('・')}`));
    body.push(seaWideBand_(wd, info, wd.waves, SEA_WIDE_.color.wave, SEA_WIDE_.height.wave, 1));
  }
  if (wd && wd.winds.length) {
    const r = seaWideRange_(wd.winds, k);
    body.push(seaWideTitle_('風', `${r ? `${info.wind ? `${info.wind.dir} ` : ''}${seaWideRangeText_(r)}m/s　` : ''}${wd.winds.map((s) => s.label).join('・')}`));
    body.push(seaWideBand_(wd, info, wd.winds, SEA_WIDE_.color.wind, SEA_WIDE_.height.wind, 5));
    body.push(seaWideArrows_(wd));
  }
  if (wd && (wd.tide.length || wd.waves.length || wd.winds.length)) {
    body.push(seaWideAxis_(wd));
    body.push(smallText_('濃い：予報のいちばん低い値・うすい：予報のひらき・縦の線：釣った時刻', { size: 'xxs', color: '#9CA3AF' }));
    body.push(seaWideFoot_(wd, info));
  }
  body.push(smallText_(SEA_WIDE_SOURCE_TEXT_, { size: 'xxs', color: '#9CA3AF', margin: 'md' }));
  const count = seaCatchList_(info).length;
  return bubble_(
    `🎣 ${info.spot.name} ${info.hm.replace(/^0/, '')}${count > 1 ? `（この日${count}回目）` : ''}：${t ? [t.moon, t.stageText, `${t.cm}cm`].filter(Boolean).join('・') : '潮なし'}${info.wind ? `・風 ${info.wind.dir} ${info.wind.ms}m/s` : ''}`,
    seaHeader_(info, UMIQRU_.name),
    [{ type: 'box', layout: 'vertical', spacing: 'none', contents: body.filter(Boolean) }],
    [uriButton_(`🌊 ${UMIQRU_.name}で開く`, seaUmiqruUrl_(info.spot))]
  );
}

const SEA_WIDE_SOURCE_TEXT_ = '潮：気象庁 潮位表（曲線は目安）・波・風：Open-Meteo.com（CC BY 4.0）';
