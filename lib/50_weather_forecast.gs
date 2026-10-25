/**
 * 50_weather_forecast.gs：機能「☁️ 天気」の予報を読む・知らせることを決める・地名を調べる（シート・LINE には触らない。テストで呼ぶ）
 * 中身：そらくるの気圧の目安の写し・Open-Meteo の返事の読みこみ・知らせることの判断・地名。呼ばれるところ：50_weather_hourly.gs（見張り）・50_weather_places.gs（地名）
 */

// ---- 気圧の変化の目安（q-soraqru/js/meteo.js の LEVELS・levelOf・alertRanges・rangeText をそのまま写したもの。
//      test/bot.test.mjs で、そらくると同じ答えになるかを確かめる） ----

const SORAQRU_LEVELS_ = [
  { label: '通常', color: '#7FA7D9' },
  { label: 'やや注意', color: '#E8B931' },
  { label: '注意', color: '#F08A24' },
  { label: '警戒', color: '#E5534B' }
];

/** 3時間の変わり方（hPa）→ 段階 0〜3（そらくるの levelOf と同じ）。数でなければ null */
function soraqruLevelOf_(change) {
  if (change === null || change === undefined || change === '') return null;
  const value = Math.abs(Number(change));
  if (!Number.isFinite(value)) return null;
  if (value < 1) return 0;
  if (value < 2) return 1;
  return value < 3 ? 2 : 3;
}

/** やや注意より上の時間をまとめる（そらくるの alertRanges と同じ）：[{ from, to, level, dir }] */
function soraqruAlertRanges_(rows) {
  const out = [];
  let cur = null;
  for (const r of rows) {
    if (r.level !== null && r.level >= 1) {
      if (cur && r.hour === cur.to) {
        cur.to = r.hour + 1;
        cur.level = Math.max(cur.level, r.level);
        cur.sum += r.change || 0;
      } else {
        cur = { from: r.hour, to: r.hour + 1, level: r.level, sum: r.change || 0 };
        out.push(cur);
      }
    } else {
      cur = null;
    }
  }
  return out.map(({ sum, ...x }) => ({ ...x, dir: sum < 0 ? 'down' : sum > 0 ? 'up' : '' }));
}

/** 時間帯の言い方「15〜18時 注意（下がる）」（そらくるの rangeText と同じ） */
function soraqruRangeText_(r) {
  const dir = r.dir === 'down' ? '（下がる）' : r.dir === 'up' ? '（上がる）' : '';
  return `${r.from}〜${r.to}時 ${SORAQRU_LEVELS_[r.level].label}${dir}`;
}

// ---- 予報 ----

/** Open-Meteo に聞く URL（位置は 0.01 度に丸める。前の日から2日ぶん） */
function weatherForecastUrl_(lat, lon) {
  return [
    `${OPEN_METEO_URL_}?latitude=${Number(lat).toFixed(2)}`,
    `longitude=${Number(lon).toFixed(2)}`,
    'hourly=pressure_msl,temperature_2m,precipitation_probability',
    'daily=temperature_2m_max',
    `timezone=${encodeURIComponent(timeZone_())}`,
    // 0時の「3時間の変わり方」と、前の日の最高気温に要る
    'past_days=1',
    'forecast_days=2'
  ].join('&');
}

// Open-Meteo の返事 → { days: { 'yyyy-MM-dd': [{ hour, hpa, temp, pop, change, level }] }, maxTemps }。読めないときは null
function weatherParseForecast_(json) {
  const hourly = json && json.hourly;
  if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.pressure_msl)) return null;

  const finite = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
  const col = (name) => (Array.isArray(hourly[name]) ? hourly[name] : []);
  const hpaAt = {};
  hourly.time.forEach((time, index) => {
    hpaAt[String(time)] = finite(hourly.pressure_msl[index]);
  });

  const days = {};
  hourly.time.forEach((time, index) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(time))) return;
    const before = new Date(`${time}:00Z`);
    before.setUTCHours(before.getUTCHours() - 3);
    const hpa = hpaAt[time];
    const hpaBefore = hpaAt[before.toISOString().slice(0, 16)];
    const change = hpa !== null && hpaBefore !== null && hpaBefore !== undefined ? Math.round((hpa - hpaBefore) * 10) / 10 : null;
    const date = time.slice(0, 10);
    (days[date] = days[date] || []).push({
      hour: Number(time.slice(11, 13)),
      hpa: hpa,
      temp: finite(col('temperature_2m')[index]),
      pop: finite(col('precipitation_probability')[index]),
      change: change,
      level: soraqruLevelOf_(change)
    });
  });

  const daily = json.daily && typeof json.daily === 'object' ? json.daily : {};
  const maxTemps = {};
  (Array.isArray(daily.time) ? daily.time : []).forEach((date, index) => {
    maxTemps[date] = finite((Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [])[index]);
  });
  // daily がないときは1時間ごとの値から
  Object.keys(days).forEach((date) => {
    if (maxTemps[date] === null || maxTemps[date] === undefined) {
      const temps = days[date].map((row) => row.temp).filter((value) => value !== null);
      maxTemps[date] = temps.length ? Math.max(...temps) : null;
    }
  });

  return Object.keys(days).length ? { days: days, maxTemps: maxTemps } : null;
}

// その日の知らせ：[{ kind, emoji, title, text }]。何もなければ []
function weatherEvaluate_(forecast, date) {
  const rows = (forecast && forecast.days && forecast.days[date]) || [];
  if (!rows.length) return [];
  const alerts = [];
  const rules = WEATHER_RULES_;

  // ☔ 雨：昼のあいだに降水確率が高い時間（続いた時間をまとめる）
  const rainRanges = [];
  rows
    .filter((row) => row.hour >= rules.rainFromHour && row.hour <= rules.rainToHour)
    .forEach((row) => {
      const last = rainRanges[rainRanges.length - 1];
      if (row.pop === null || row.pop < rules.rainPop) return;
      if (last && last.to === row.hour) {
        last.to = row.hour + 1;
        last.pop = Math.max(last.pop, row.pop);
      } else {
        rainRanges.push({ from: row.hour, to: row.hour + 1, pop: row.pop });
      }
    });
  if (rainRanges.length) {
    alerts.push({ kind: 'rain', emoji: '☔', title: '雨', lines: rainRanges.slice(0, 3).map((r) => `${r.from}〜${r.to}時 雨 ${Math.round(r.pop)}%`) });
  }

  // 🌀 気圧：そらくると同じ目安で「注意」「警戒」の時間
  const pressureRanges = soraqruAlertRanges_(rows).filter((range) => range.level >= rules.pressureLevel);
  if (pressureRanges.length) {
    alerts.push({ kind: 'pressure', emoji: '🌀', title: '気圧の変化', lines: pressureRanges.slice(0, 3).map(soraqruRangeText_) });
  }

  // 🌡️ 気温：最高気温が前の日より大きくちがう
  const previous = new Date(`${date}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  const todayMax = forecast.maxTemps && forecast.maxTemps[date];
  const previousMax = forecast.maxTemps && forecast.maxTemps[previous.toISOString().slice(0, 10)];
  if (Number.isFinite(todayMax) && Number.isFinite(previousMax) && Math.abs(todayMax - previousMax) >= rules.tempDiff) {
    const diff = Math.round(todayMax - previousMax);
    alerts.push({
      kind: 'temp',
      emoji: diff > 0 ? '🥵' : '🥶',
      title: '気温',
      lines: [`最高 ${Math.round(todayMax)}℃（前の日より ${Math.abs(diff)}℃ ${diff > 0 ? '高い' : '低い'}）`]
    });
  }

  return alerts;
}

/**
 * 同じ地点は1回の実行で1回だけ聞く。混んでいて断られた（429）ときは、少し待って1回だけやりなおす。
 * それでもだめなら投げる（呼んだ側で、その地点は送らずに記録する）
 */
function weatherFetchForecast_(lat, lon, memo) {
  const key = `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
  if (memo && Object.prototype.hasOwnProperty.call(memo, key)) return memo[key];
  const url = weatherForecastUrl_(lat, lon);
  let response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() === 429) {
    Utilities.sleep(3000);
    response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  }
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error(`Open-Meteo ${code}`);
  let json = null;
  try {
    json = JSON.parse(response.getContentText());
  } catch (error) {
    json = null;
  }
  const forecast = weatherParseForecast_(json);
  if (!forecast) throw new Error('Open-Meteo の中身が読めない');
  if (memo) memo[key] = forecast;
  return forecast;
}

// ---- 地名 ----
// 市のさかいの近くでは、1km に丸めた位置だと、となりの市区町村になることがある（例：倉敷市林 → 岡山市南区）。そこで：
//   1. 位置情報についている住所（「〒710-0046 岡山県倉敷市林…」）から、そらくるの市区町村の表にある名前を探す（いちばん長いもの）
//   2. なければ、国土地理院の逆ジオコーダーに 0.001 度（100m くらい）に丸めた位置で聞く（シートに残す位置は 0.01 度のまま）
// どちらもだめなら ''

/** 地点の名前（市区町村）：住所 → 100m くらいの位置で国土地理院、の順。わからなければ "" */
function weatherPlaceName_(lat, lon, address) {
  try {
    const table = weatherMuniTable_();
    if (!table) return '';
    return weatherPlaceFromAddress_(address, table) || weatherPlaceFromGsi_(lat, lon, table);
  } catch (error) {
    return '';
  }
}

/** 住所 → 市区町村の名前。都道府県のすぐあとに続く名前だけを見る（町名の中の名前をひろわないように） */
function weatherPlaceFromAddress_(address, table) {
  const text = String(address || '')
    .replace(/^\s*日本[、,\s]*/, '')
    .replace(/〒?\s*\d{3}-?\d{4}\s*/, '')
    .trim()
    .replace(/^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)/, '');
  if (!text) return '';
  let best = '';
  Object.keys(table).forEach((code) => {
    const name = table[code];
    if (typeof name === 'string' && name.length > best.length && text.startsWith(name)) best = name;
  });
  return cleanText_(best, 20);
}

/** 国土地理院の逆ジオコーダーで市区町村のコードを聞き、そらくるの表で名前にする（だめなら ""） */
function weatherPlaceFromGsi_(lat, lon, table) {
  const geo = UrlFetchApp.fetch(`${GSI_REVERSE_GEOCODER_URL_}?lat=${Number(lat).toFixed(3)}&lon=${Number(lon).toFixed(3)}`, { muteHttpExceptions: true });
  if (geo.getResponseCode() !== 200) return '';
  const results = (JSON.parse(geo.getContentText()) || {}).results || {};
  const cd = results.muniCd;
  const code = typeof cd === 'string' && /^\d{4,6}$/.test(cd) ? String(Number(cd)) : '';
  const name = code && Object.prototype.hasOwnProperty.call(table, code) ? table[code] : '';
  return typeof name === 'string' ? cleanText_(name, 20) : '';
}

/** そらくるの市区町村の表（data/muni.json）。6時間覚えておく。読めなければ null */
function weatherMuniTable_() {
  const cache = cache_();
  const cached = cache.get('WEATHER_MUNI_V1');
  if (cached) return JSON.parse(cached);
  const response = UrlFetchApp.fetch(SORAQRU_MUNI_URL_, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return null;
  const text = response.getContentText();
  try {
    cache.put('WEATHER_MUNI_V1', text, 21600);
  } catch (error) {
    // 覚えられなくても、今回は使える
  }
  return JSON.parse(text);
}

