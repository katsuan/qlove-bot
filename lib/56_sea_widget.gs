/**
 * 56_sea_widget.gs：記録の1枚目のカード。うみくるの大きいウィジェット（q-sqriptable の sea・大）を、LINE のカードで描く
 *
 * 並びはウィジェットと同じ：潮 → 波 → 風のグラフを縦に。時間は、釣った日の0時〜24時（ウィジェットは今の少し前から24時間）。
 * 夜はうすく塗り、写真の時刻に縦の線（同じ日・同じ釣り場の前の記録は薄い線）。下の行は つぎの潮・まづめ・突風。
 * グラフは QuickChart（Chart.js の絵を URL で作る）の画像。渡すのは数と時刻だけ（名前・場所は渡さない）。LINE が URL から絵を読む。
 * 潮はなめらかな線、波・風は予報ごとの線（ウィジェットと同じ色・点線）、風は突風の灰色の点線と、3時間ごとの矢印（目盛りの上の段）。
 * 予報の名前・色は q-sqriptable の SEA（waves・winds・palette のライト）と同じ。
 * 呼ばれるところ：56_sea_tide.gs の seaInfoAt_（読みこみ）・56_sea_spots.gs の seaRecordMessage_（カード）
 */

const SEA_WIDE_ = {
  hours: 24,
  tideSlotMin: 30, // 潮の点の間（分）。絵の URL（LINE は 2000 字まで）に入るように
  // グラフの絵（QuickChart）。幅・高さは絵の px（縦の目盛りの幅をそろえて、3つの時刻の位置を合わせる）
  qc: { width: 600, height: { tide: 190, wave: 150, wind: 180 }, axisWidth: 34, font: 13, night: '#8E8E9326' },
  // 色はウィジェットと同じ（機関ごと：ECMWF 青・NOAA 橙・Météo-France 青緑・気象庁 紫。同じ機関の2つ目は点線）
  waves: [
    { key: 'ecmwf_wam025', label: 'WAM', color: '#2A78D6' },
    { key: 'ncep_gfswave025', label: 'GFS', color: '#EB6834' },
    { key: 'meteofrance_wave', label: 'MFWAM', color: '#1BAF7A' },
    { key: 'ncep_gfswave016', label: 'GFS細', color: '#EB6834', dash: true }
  ],
  winds: [
    { key: 'jma_msm', label: 'MSM', color: '#6250D6' },
    { key: 'jma_gsm', label: 'GSM', color: '#6250D6', dash: true },
    { key: 'gfs_seamless', label: 'GFS', color: '#EB6834' },
    { key: 'ecmwf_ifs025', label: 'IFS', color: '#2A78D6' }
  ],
  color: { tide: '#E87BA4', wave: '#2A78D6', wind: '#6250D6' }, // ウィジェットの潮・ECMWF・気象庁の色（ライト）
  line: '#111827',
  lineOld: '#9CA3AF',
  marineUrl: 'https://marine-api.open-meteo.com/v1/marine'
};
// 矢印：吹いていく向き（北の風 → ↓）。来る向きを 45° ごとに
const SEA_ARROWS_ = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];

// ---- 読みこみ ----

/** グラフの始まり（その日の0時からの時）：いつもその日の0時（0時〜24時。釣った日の潮・波・風をまるごと見る） */
function seaWideFrom_() {
  return 0;
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
  const waves = SEA_WIDE_.waves.map((m) => ({ label: m.label, color: m.color, dash: !!m.dash, v: pick(raw.wave, `wave_height_${m.key}`) })).filter((s) => s.v.some((x) => x != null));
  const winds = SEA_WIDE_.winds.map((m) => ({ label: m.label, color: m.color, dash: !!m.dash, v: pick(raw.wind, `wind_speed_10m_${m.key}`), dir: pick(raw.wind, `wind_direction_10m_${m.key}`) })).filter((s) => s.v.some((x) => x != null));
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

// ---- グラフの絵（QuickChart。渡すのは数と時刻だけ。名前・場所は渡さない） ----

/** 数の並び → "62_66__70"（scale 倍の整数。ないところは空。絵の側で D() が数に戻す） */
function seaQcList_(list, scale) {
  const k = scale || 10;
  return list.map((v) => (v == null ? '' : String(Math.round(Number(v) * k)))).join('_');
}

/**
 * 絵の URL（LINE の画像の URL は 2000 字まで）。js … Chart.js の設定（JavaScript の式）。
 * URL の問い合わせの部分にそのまま置ける記号（, : = ; など）は、字がふえないように戻す
 */
function seaQcUrl_(js, height) {
  const c = encodeURIComponent(js).replace(/%(2C|3A|3D|3B|40|24|2F)/g, (m) => decodeURIComponent(m));
  return `${SEA_QC_URL_}?w=${SEA_WIDE_.qc.width}&h=${height}&bkg=white&c=${c}`;
}

/**
 * どのグラフにも同じ下じき：夜の帯（N）・釣った時刻の縦の線（C：1 はいまの記録、2 は前の記録）・横の目盛り（6時ごと。A があれば上の段に矢印）。
 * L(数, 色, ほかの設定) は線。縦の目盛りの幅をそろえて、3つのグラフの時刻の位置を合わせる
 */
function seaQcFrame_(wd, info, n, stepMin, datasets, yTicks, arrows) {
  const start = wd.from * 60;
  const night = Array.from({ length: n }, (_, k) => (wd.night.some((x) => start + k * stepMin >= x.from && start + k * stepMin < x.to) ? 1 : 0));
  const lines = Array.from({ length: n }, () => 0);
  seaCatchList_(info).forEach((c) => {
    const k = Math.round((c.min - start) / stepMin);
    if (k >= 0 && k < n && lines[k] !== 1) lines[k] = c.latest ? 1 : 2;
  });
  const q = SEA_WIDE_.qc;
  const label = arrows
    ? `k=>[A[k/3]||'',T(k)]`
    : 'T';
  return `(()=>{const D=(s,k=10)=>s.split('_').map(v=>v===''?null:v/k),N=[...'${night.join('')}'],C=[...'${lines.join('')}'],A=[...'${arrows ? arrows.join('') : ''}'],` +
    `T=k=>{const t=${wd.from}+k*${stepMin}/60;return t%6?'':''+(t%24||(t?24:0))},` +
    `L=(d,c,x,k)=>({type:'line',data:D(d,k),borderColor:c,fill:!1,pointRadius:0,borderWidth:2,lineTension:.3,spanGaps:!0,yAxisID:'y',...x});` +
    `return{type:'bar',data:{labels:[...Array(${n}).keys()].map(${label}),datasets:[${datasets.join(',')},` +
    `{data:N.map(v=>+v||null),backgroundColor:'${q.night}',barPercentage:1,categoryPercentage:1,yAxisID:'n'},` +
    `{data:C.map(v=>+v?1:null),backgroundColor:C.map(v=>v==1?'${SEA_WIDE_.line}':'${SEA_WIDE_.lineOld}'),barThickness:2,yAxisID:'n'}]},` +
    `options:{legend:{display:!1},plugins:{datalabels:{display:!1}},` +
    `scales:{xAxes:[{stacked:!0,gridLines:{display:!1},ticks:{autoSkip:!1,maxRotation:0,fontSize:${q.font}}}],` +
    `yAxes:[{id:'y',ticks:{${yTicks}maxTicksLimit:4,fontSize:${q.font}},afterFit:s=>{s.width=${q.axisWidth}}},{id:'n',display:!1,ticks:{min:0,max:1}}]}}}})()`;
}

/** 潮の絵：30分ごとの潮位をなめらかな線で。満潮・干潮の点に時刻 */
function seaQcTide_(wd, info) {
  const step = SEA_WIDE_.tideSlotMin;
  const n = wd.tide.length;
  const start = wd.from * 60;
  const marks = Array.from({ length: n }, () => null);
  const times = Array.from({ length: n }, () => '');
  wd.marks.forEach((e) => {
    const k = Math.round((e.m - start) / step);
    if (k < 0 || k >= n || wd.tide[k] == null) return; // 潮の線のないところ（次の日の表がない）には書かない
    marks[k] = wd.tide[k];
    times[k] = String(e.time).replace(/^0/, '');
  });
  const c = SEA_WIDE_.color.tide;
  const datasets = [
    `L('${seaQcList_(wd.tide, 1)}','${c}',{backgroundColor:'${c}33',fill:'start',lineTension:.4},1)`,
    `L('${seaQcList_(marks, 1)}','${c}',{showLine:!1,pointRadius:2,pointBackgroundColor:'${c}',` +
      `datalabels:{display:x=>x.dataset.data[x.dataIndex]!=null,align:'top',offset:0,color:'#374151',font:{size:${SEA_WIDE_.qc.font}},formatter:(v,x)=>'${times.join('_')}'.split('_')[x.dataIndex]}},1)`
  ];
  return seaQcUrl_(seaQcFrame_(wd, info, n, step, datasets, ''), SEA_WIDE_.qc.height.tide);
}

/** 波・風の絵：予報ごとの線（色・点線はウィジェットと同じ）。gust があれば灰色の点線、arrows があれば目盛りの上の段に矢印 */
function seaQcModels_(wd, info, list, gust, floor, height, arrows) {
  const n = SEA_WIDE_.hours + 1;
  const datasets = list.map((s) => `L('${seaQcList_(s.v)}','${s.color}'${s.dash ? ',{borderDash:[4,3]}' : ''})`);
  if (gust) datasets.push(`L('${seaQcList_(gust)}','#9CA3AF',{borderDash:[2,2],borderWidth:1.5})`);
  // 下は 0 から、上は floor 以上（波 1m・風 5m/s）
  return seaQcUrl_(seaQcFrame_(wd, info, n, 60, datasets, `min:0,suggestedMax:${floor},`, arrows), height);
}

/** 風の向きの矢印（3時間ごと。予報を風速の重みでならす。ウィジェットの seaMeanDir と同じ）。ほぼ無風・予報がなければ「・」 */
function seaWideArrows_(wd) {
  const r = Math.PI / 180;
  const out = [];
  for (let k = 0; k <= SEA_WIDE_.hours; k += 3) {
    const list = wd.winds.map((s) => ({ sp: s.v[k], dir: s.dir[k] })).filter((x) => x.sp != null && x.dir != null);
    if (!list.length) continue;
    const x = list.reduce((a, m) => a + m.sp * Math.sin(m.dir * r), 0) / list.length;
    const y = list.reduce((a, m) => a + m.sp * Math.cos(m.dir * r), 0) / list.length;
    const mean = (((Math.atan2(x, y) / r) % 360) + 360) % 360;
    out[k / 3] = Math.hypot(x, y) < 0.5 ? '・' : SEA_ARROWS_[Math.round(mean / 45) % 8];
  }
  return Array.from({ length: SEA_WIDE_.hours / 3 + 1 }, (_, i) => out[i] || '・');
}

/** 絵（カードの中の画像） */
function seaQcImage_(url, height) {
  return { type: 'image', url: url, size: 'full', aspectMode: 'fit', aspectRatio: `${SEA_WIDE_.qc.width}:${height}`, margin: 'xs' };
}

/** グラフの見出し（左に名前と写真の時刻の値、右に線の色の見本） */
function seaWideTitle_(name, value, legend) {
  const keys = (legend || []).map((s) => ({ type: 'span', text: `${s.dash ? '┄' : '━'}${s.label} `, color: s.color }));
  return {
    type: 'box', layout: 'horizontal', margin: 'md',
    contents: [
      { type: 'text', text: name, size: 'xs', weight: 'bold', color: '#111827', flex: 0 },
      { type: 'text', text: value || ' ', size: 'xxs', color: '#374151', gravity: 'center', margin: 'sm', flex: 0 },
      keys.length ? { type: 'text', text: ' ', contents: keys, size: 'xxs', align: 'end', gravity: 'center' } : null
    ].filter(Boolean)
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
    body.push(seaQcImage_(seaQcTide_(wd, info), SEA_WIDE_.qc.height.tide));
  }
  if (wd && wd.waves.length) {
    const r = seaWideRange_(wd.waves, k);
    body.push(seaWideTitle_('波', r ? `${seaWideRangeText_(r)}m` : '', wd.waves));
    body.push(seaQcImage_(seaQcModels_(wd, info, wd.waves, null, 1, SEA_WIDE_.qc.height.wave), SEA_WIDE_.qc.height.wave));
  }
  if (wd && wd.winds.length) {
    const r = seaWideRange_(wd.winds, k);
    body.push(seaWideTitle_('風', r ? `${info.wind ? `${info.wind.dir} ` : ''}${seaWideRangeText_(r)}m/s` : '', wd.winds));
    const gust = wd.gust.some((x) => x != null) ? wd.gust : null;
    body.push(seaQcImage_(seaQcModels_(wd, info, wd.winds, gust, 5, SEA_WIDE_.qc.height.wind, seaWideArrows_(wd)), SEA_WIDE_.qc.height.wind));
  }
  if (wd && (wd.tide.length || wd.waves.length || wd.winds.length)) {
    body.push(smallText_('縦の線：釣った時刻（濃いのがこの記録）・灰色の点線：突風・矢印：風が吹いていく向き', { size: 'xxs', color: '#9CA3AF', margin: 'sm' }));
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

const SEA_WIDE_SOURCE_TEXT_ = '潮：気象庁 潮位表（曲線は目安）・波・風：Open-Meteo.com（CC BY 4.0）・グラフ：QuickChart';
const SEA_QC_URL_ = 'https://quickchart.io/chart';
