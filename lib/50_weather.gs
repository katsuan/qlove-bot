/**
 * 50_weather.gs：機能「☁️ 天気」（そらくる 〜SoraQru〜 と同じ見方）
 *
 * 地点（家・実家・職場など）を登録すると、知らせる価値がある日だけ、決めた時間にカードを push する：
 *   ☔ 雨：6〜21時に降水確率 60% 以上の時間がある
 *   🌀 気圧：3時間の変化が「注意」「警戒」の時間がある（そらくるの js/meteo.js と同じ目安。下に写した）
 *   🌡️ 気温：最高気温が前の日より 5℃ 以上ちがう
 * 何もない日は送らない。急ぎでない知らせなので、送れる数が 80% をこえたら止める（push_ の 'normal'）。
 * 中身は KazoQ の「場所の天気の知らせ」（q-kazoq/01_43_WEATHER_NOTICE.js）から、KazoQ の家族・管理者の決まりを外したもの。
 *
 * 登録：「☁️ 天気」→「📍 地点を足す」→ クイックリプライの「📍 位置情報を送る」。位置は 0.01 度（1km くらい）に丸め、
 * 地名は、位置情報の住所か、国土地理院の逆ジオコーダー（100m くらいに丸めた位置）と、そらくるの市区町村の表で。
 * 送り先は、登録したトーク（1対1 なら本人・グループならそのグループ）。地点は1人3か所、ボット全体で20か所まで。
 */

const WEATHER_ = {
  label: '☁️ 天気の知らせ',
  maxPerPerson: 3,
  maxTotal: 20, // Open-Meteo の無料枠と、送れる数のため
  hours: [6, 7, 8, 21],
  defaultHour: 7,
  eveningFrom: 18, // この時間からの知らせは、明日のぶん
  pendingSeconds: 600, // 「📍 地点を足す」から位置情報を受けとる時間
  color: '#3A56D6' // そらくるのロゴの群青
};
const NOTICE_RULES_ = { rainPop: 60, rainFromHour: 6, rainToHour: 21, pressureLevel: 2, tempDiff: 5 };
const SORAQRU_URL_ = 'https://katsuan.github.io/soraqru/';
const SORAQRU_MUNI_URL_ = 'https://katsuan.github.io/soraqru/data/muni.json';
const OPEN_METEO_URL_ = 'https://api.open-meteo.com/v1/forecast';
const GSI_REVERSE_GEOCODER_URL_ = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress';
const WEATHER_SOURCE_TEXT_ = '天気：Open-Meteo.com（CC BY 4.0）・地名：国土地理院・気圧は変化の目安です（体調の予測ではありません）';

// ---- 気圧の変化の目安（q-soraqru/js/meteo.js の LEVELS・levelOf・alertRanges・rangeText をそのまま写したもの。
//      test/bot.test.mjs で、そらくると同じ答えになるかを確かめる） ----

const SORAQRU_LEVELS_ = [
  { label: '通常', color: '#7FA7D9' },
  { label: 'やや注意', color: '#E8B931' },
  { label: '注意', color: '#F08A24' },
  { label: '警戒', color: '#E5534B' }
];

function soraqruLevelOf_(change) {
  if (change === null || change === undefined || change === '') return null;
  const value = Math.abs(Number(change));
  if (!Number.isFinite(value)) return null;
  if (value < 1) return 0;
  if (value < 2) return 1;
  return value < 3 ? 2 : 3;
}

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

function soraqruRangeText_(r) {
  const dir = r.dir === 'down' ? '（下がる）' : r.dir === 'up' ? '（上がる）' : '';
  return `${r.from}〜${r.to}時 ${SORAQRU_LEVELS_[r.level].label}${dir}`;
}

// ---- 予報 ----

function buildForecastUrl_(lat, lon) {
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
function parseForecast_(json) {
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
function evaluateNotice_(forecast, date) {
  const rows = (forecast && forecast.days && forecast.days[date]) || [];
  if (!rows.length) return [];
  const alerts = [];
  const rules = NOTICE_RULES_;

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
function fetchForecast_(lat, lon, memo) {
  const key = `${Number(lat).toFixed(2)},${Number(lon).toFixed(2)}`;
  if (memo && Object.prototype.hasOwnProperty.call(memo, key)) return memo[key];
  const url = buildForecastUrl_(lat, lon);
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
  const forecast = parseForecast_(json);
  if (!forecast) throw new Error('Open-Meteo の中身が読めない');
  if (memo) memo[key] = forecast;
  return forecast;
}

// ---- 地名 ----
// 市のさかいの近くでは、1km に丸めた位置だと、となりの市区町村になることがある（例：倉敷市林 → 岡山市南区）。そこで：
//   1. 位置情報についている住所（「〒710-0046 岡山県倉敷市林…」）から、そらくるの市区町村の表にある名前を探す（いちばん長いもの）
//   2. なければ、国土地理院の逆ジオコーダーに 0.001 度（100m くらい）に丸めた位置で聞く（シートに残す位置は 0.01 度のまま）
// どちらもだめなら ''

function lookupPlaceName_(lat, lon, address) {
  try {
    const table = readMuniTable_();
    if (!table) return '';
    return placeNameFromAddress_(address, table) || placeNameFromGsi_(lat, lon, table);
  } catch (error) {
    return '';
  }
}

/** 住所 → 市区町村の名前。都道府県のすぐあとに続く名前だけを見る（町名の中の名前をひろわないように） */
function placeNameFromAddress_(address, table) {
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

function placeNameFromGsi_(lat, lon, table) {
  const geo = UrlFetchApp.fetch(`${GSI_REVERSE_GEOCODER_URL_}?lat=${Number(lat).toFixed(3)}&lon=${Number(lon).toFixed(3)}`, { muteHttpExceptions: true });
  if (geo.getResponseCode() !== 200) return '';
  const results = (JSON.parse(geo.getContentText()) || {}).results || {};
  const cd = results.muniCd;
  const code = typeof cd === 'string' && /^\d{4,6}$/.test(cd) ? String(Number(cd)) : '';
  const name = code && Object.prototype.hasOwnProperty.call(table, code) ? table[code] : '';
  return typeof name === 'string' ? cleanText_(name, 20) : '';
}

function readMuniTable_() {
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

// ---- 地点（シート「天気の地点」） ----

function weatherNotices_() {
  return readRows_('weather')
    .filter((row) => isOn_(row.isActive))
    .map((row) => ({
      noticeId: String(row.noticeId || '').trim(),
      ownerUserId: String(row.ownerUserId || '').trim(),
      targetType: String(row.targetType || '').trim(),
      targetId: String(row.targetId || '').trim(),
      placeName: cleanText_(row.placeName, 20) || '登録した地点',
      lat: Number(row.lat),
      lon: Number(row.lon),
      notifyHour: Number(row.notifyHour),
      lastCheckedDate: row.lastCheckedDate instanceof Date ? formatDay_(row.lastCheckedDate) : String(row.lastCheckedDate || '').trim()
    }))
    .filter((n) => n.noticeId && n.targetId && Number.isFinite(n.lat) && Number.isFinite(n.lon) && Math.abs(n.lat) <= 90 && Math.abs(n.lon) <= 180);
}

function weatherOfTarget_(event) {
  const target = targetOf_(event);
  return weatherNotices_().filter((n) => n.targetId === target.targetId);
}

function formatHour_(hour) {
  return Number(hour) >= WEATHER_.eveningFrom ? `前の日の${hour}時（明日のぶん）` : `毎朝${hour}時`;
}

/** 変えてよい地点：このトークの地点で、持ち主か、その地点を足した本人 */
function editableWeather_(event, noticeId, role) {
  if (!role) return null;
  const userId = userIdOf_(event);
  return weatherOfTarget_(event).find((n) => n.noticeId === noticeId && (role === 'owner' || n.ownerUserId === userId)) || null;
}

function weatherPendingKey_(event) {
  return `WEATHER_PENDING_${targetOf_(event).targetId}_${userIdOf_(event)}`;
}

function weatherHourActions_(notice) {
  return WEATHER_.hours.map((hour) => postback_(
    `⏰ ${hour >= WEATHER_.eveningFrom ? `${hour}時（明日のぶん）` : `${hour}時`}`,
    `m=weather&a=time&id=${encodeURIComponent(notice.noticeId)}&h=${hour}`,
    `⏰ ${notice.placeName}：${formatHour_(hour)}`
  ));
}

const weatherMenuButton_ = () => postback_(WEATHER_.label, 'm=weather&a=menu');

// ---- 返事 ----

// 「📍 地点を足す」：位置情報を送るクイックリプライ。押した人の位置情報だけを、10分のあいだ受けとる
function weatherAddReply_(event, role) {
  if (!role) return notAllowedText_();
  const userId = userIdOf_(event);
  const all = weatherNotices_();
  if (all.filter((n) => n.ownerUserId === userId).length >= WEATHER_.maxPerPerson) {
    return textMessage_(`地点は1人${WEATHER_.maxPerPerson}か所までです。「🗑️ やめる地点」から減らしてね。`, [postback_('🗑️ やめる地点', 'm=weather&a=pick&k=remove')]);
  }
  if (all.length >= WEATHER_.maxTotal) return textMessage_(`このボットで見られる地点は${WEATHER_.maxTotal}か所までです。持ち主に相談してね。`);
  cache_().put(weatherPendingKey_(event), '1', WEATHER_.pendingSeconds);
  return textMessage_('天気を知らせる場所を、下の「📍 位置情報を送る」から送ってね（10分のあいだ）。\n位置は1kmくらいに丸めて覚えます。', [{ type: 'location', label: '📍 位置情報を送る' }]);
}

// 位置情報：「📍 地点を足す」を押した人のものだけ受けとる（ほかは null で、次の機能へ）
function weatherLocationReply_(event, role) {
  const key = weatherPendingKey_(event);
  if (!cache_().get(key)) return null;
  cache_().remove(key);
  if (!role) return [notAllowedText_()];
  const rawLat = Number(event.message.latitude);
  const rawLon = Number(event.message.longitude);
  const lat = Math.round(rawLat * 100) / 100;
  const lon = Math.round(rawLon * 100) / 100;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return [textMessage_('場所が読めませんでした。「📍 地点を足す」から、もう一度送ってね。', [postback_('📍 地点を足す', 'm=weather&a=add')])];
  }
  const userId = userIdOf_(event);
  const target = targetOf_(event);
  const all = weatherNotices_();
  if (all.some((n) => n.targetId === target.targetId && n.lat === lat && n.lon === lon)) return [textMessage_('この場所は、もう登録しています。', [weatherMenuButton_()])];
  if (all.filter((n) => n.ownerUserId === userId).length >= WEATHER_.maxPerPerson) return [textMessage_(`地点は1人${WEATHER_.maxPerPerson}か所までです。`)];
  if (all.length >= WEATHER_.maxTotal) return [textMessage_(`このボットで見られる地点は${WEATHER_.maxTotal}か所までです。`)];

  showLoading_(event);
  // 地名は、丸める前の位置（100m くらい）か住所で調べる。シートに残すのは 1km に丸めた位置だけ
  const placeName = lookupPlaceName_(rawLat, rawLon, event.message.address) || cleanText_(event.message.title, 20) || '登録した地点';
  const notice = {
    noticeId: Utilities.getUuid(), ownerUserId: userId, targetType: target.targetType, targetId: target.targetId,
    placeName: placeName, lat: lat, lon: lon, notifyHour: WEATHER_.defaultHour, isActive: true, lastCheckedDate: '',
    createdAt: new Date(), updatedAt: new Date()
  };
  appendRow_('weather', notice);
  return [textMessage_(
    QSeason.decorate(`📍 ${placeName} を登録しました。\n${formatHour_(notice.notifyHour)}ごろ、雨・気圧・気温で知らせることがある日だけ、このトークに送ります。時間は下から変えられます。`),
    weatherHourActions_(notice)
  )];
}

function weatherPickReply_(event, mode, role) {
  if (!role) return notAllowedText_();
  const userId = userIdOf_(event);
  const notices = weatherOfTarget_(event).filter((n) => role === 'owner' || n.ownerUserId === userId);
  if (!notices.length) return textMessage_('あなたが変えられる地点は、このトークにはありません。', [postback_('📍 地点を足す', 'm=weather&a=add')]);
  return textMessage_(mode === 'remove' ? 'どの地点の知らせをやめる？' : 'どの地点の時間をかえる？', notices.map((n) => (mode === 'remove'
    ? postback_(`🗑️ ${n.placeName}`, `m=weather&a=remove&id=${encodeURIComponent(n.noticeId)}`, `🗑️ ${n.placeName}の知らせをやめる`)
    : postback_(`⏰ ${n.placeName}`, `m=weather&a=hours&id=${encodeURIComponent(n.noticeId)}`, `⏰ ${n.placeName}の時間をかえる`))));
}

function weatherPostback_(event, p, role) {
  const gone = () => [textMessage_('この地点は、もうやめているかもしれません。', [weatherMenuButton_()])];
  switch (p.a) {
    case 'add':
      return [weatherAddReply_(event, role)];
    case 'edit':
      return [role ? textMessage_('どうする？', [postback_('⏰ 時間をかえる', 'm=weather&a=pick&k=time'), postback_('🗑️ やめる地点', 'm=weather&a=pick&k=remove')]) : notAllowedText_()];
    case 'pick':
      return [weatherPickReply_(event, p.k === 'remove' ? 'remove' : 'time', role)];
    case 'hours': {
      const n = editableWeather_(event, String(p.id || ''), role);
      return n ? [textMessage_(`📍 ${n.placeName}（いまは${formatHour_(n.notifyHour)}）。何時にする？`, weatherHourActions_(n))] : gone();
    }
    case 'time': {
      const n = editableWeather_(event, String(p.id || ''), role);
      const hour = Number(p.h);
      if (!n) return gone();
      if (!WEATHER_.hours.includes(hour)) return [textMessage_('この時間はえらべません。', weatherHourActions_(n))];
      if (n.notifyHour !== hour) updateRow_('weather', 'noticeId', n.noticeId, { notifyHour: hour, lastCheckedDate: '' });
      return [textMessage_(`⏰ ${n.placeName}：${formatHour_(hour)}ごろに送ります（知らせることがある日だけ）。`, [weatherMenuButton_()])];
    }
    case 'remove': {
      const n = editableWeather_(event, String(p.id || ''), role);
      if (!n) return [textMessage_('この地点の知らせは、もうやめています。', [weatherMenuButton_()])];
      updateRow_('weather', 'noticeId', n.noticeId, { isActive: false });
      return [textMessage_(`🗑️ ${n.placeName}の知らせをやめました。`, [weatherMenuButton_()])];
    }
    default:
      return [weatherListCard_(weatherOfTarget_(event), role)];
  }
}

// ---- カード ----

function soraqruPlaceUrl_(notice) {
  const at = `${Number(notice.lat).toFixed(2)},${Number(notice.lon).toFixed(2)}`;
  return `${SORAQRU_URL_}?at=${at}&name=${encodeURIComponent(notice.placeName || '')}&from=qlovebot`;
}

/** 知らせのカード。altText は「☔ 名古屋市中村区：12〜15時 雨 70%（ほか1つ）」のように中身がわかる1行 */
function weatherNoticeCard_(notice, date, alerts, options) {
  const opt = options || {};
  const isTomorrow = date !== formatDay_(opt.now || new Date());
  const more = alerts.length > 1 ? `（ほか${alerts.length - 1}つ）` : '';
  const mark = opt.sample ? '🧪 ' : '';
  return bubble_(
    `${mark}${alerts[0].emoji} ${notice.placeName}：${alerts[0].lines[0]}${more}`,
    header_(`${mark}☁️ ${notice.placeName}`, `${dayLabel_(date)}　${isTomorrow ? '明日の天気の知らせ' : '今日の天気の知らせ'}`, WEATHER_.color),
    [
      ...alerts.map((alert) => ({
        type: 'box',
        layout: 'horizontal',
        spacing: 'md',
        contents: [
          { type: 'text', text: alert.emoji, size: 'xl', flex: 0, gravity: 'top' },
          {
            type: 'box',
            layout: 'vertical',
            flex: 1,
            // 時間帯は1つずつの行（トークで読みやすいように）
            contents: [smallText_(alert.title), ...alert.lines.map((line) => ({ type: 'text', text: line, size: 'md', weight: 'bold', color: '#111827', wrap: true }))]
          }
        ]
      })),
      smallText_(WEATHER_SOURCE_TEXT_, { size: 'xxs', color: '#9CA3AF', margin: 'lg' })
    ],
    [uriButton_('🌤️ そらくるで開く', soraqruPlaceUrl_(notice))]
  );
}

function weatherListCard_(notices, role, options) {
  const mark = options && options.sample ? '🧪 ' : '';
  const rows = notices.length
    ? notices.map((n) => ({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: [
        { type: 'text', text: `📍 ${n.placeName}`, size: 'sm', weight: 'bold', wrap: true, flex: 3 },
        { type: 'text', text: formatHour_(n.notifyHour), size: 'xs', color: '#6B7280', align: 'end', wrap: true, flex: 2 }
      ]
    }))
    : [smallText_('まだ地点はありません', { size: 'sm' })];
  // ボタンは聞き返すだけ（あとで押されても困らない）
  const card = bubble_(
    `${mark}${WEATHER_.label}：${notices.length ? notices.map((n) => n.placeName).join('・') : 'まだ地点はありません'}`,
    header_(`${mark}${WEATHER_.label}`, 'このトークに送る地点', WEATHER_.color),
    [
      smallText_(`雨・気圧の変化・気温の大きな変わり目がある日だけ、決めた時間に送ります（1人${WEATHER_.maxPerPerson}か所まで）。`, { color: '#4B5563' }),
      ...rows,
      role ? null : smallText_('地点を足すには、このボットの持ち主の許可が要ります。')
    ],
    role ? [postbackButton_('📍 地点を足す', 'm=weather&a=add'), notices.length ? postbackButton_('⚙️ 時間・やめる', 'm=weather&a=edit') : null] : []
  );
  return withQuickReply_(card, role
    ? [
      postback_('📍 地点を足す', 'm=weather&a=add'),
      notices.length ? postback_('⏰ 時間をかえる', 'm=weather&a=pick&k=time') : null,
      notices.length ? postback_('🗑️ やめる地点', 'm=weather&a=pick&k=remove') : null,
      { type: 'uri', label: '🌤️ そらくる', uri: SORAQRU_URL_ },
      postback_('🧩 機能', 'm=core&a=modules')
    ]
    : coreQuick_(role));
}

// ---- 見張り（1時間おき） ----

/** 決めた時間の地点だけ見て、知らせることがあれば push。1つの地点でつまずいても、ほかは続ける */
function weatherHourly_(now) {
  const hour = Number(Utilities.formatDate(now, timeZone_(), 'H'));
  const today = formatDay_(now);
  const date = hour >= WEATHER_.eveningFrom ? formatDay_(new Date(now.getTime() + 24 * 3600 * 1000)) : today;
  const notices = weatherNotices_().filter((n) => n.notifyHour === hour && n.lastCheckedDate !== today && canUse_(n.ownerUserId));
  const memo = {};
  const result = { checked: 0, sent: 0, failed: 0, skippedForQuota: 0 };
  notices.forEach((notice) => {
    try {
      const alerts = evaluateNotice_(fetchForecast_(notice.lat, notice.lon, memo), date);
      if (alerts.length) {
        if (!hasPushRoom_('normal')) result.skippedForQuota += 1;
        else if (push_(notice.targetId, [weatherNoticeCard_(notice, date, alerts, { now: now })], 'normal')) result.sent += 1;
        else result.failed += 1;
      }
      updateRow_('weather', 'noticeId', notice.noticeId, { lastCheckedDate: today });
      result.checked += 1;
    } catch (error) {
      result.failed += 1;
      writeLog_('weather:error', `${notice.placeName}：${error.message}`);
    }
  });
  if (result.skippedForQuota) writeLog_('weather:quota', `今月の送れる数が少ないので ${result.skippedForQuota} か所は送らない`);
  return result;
}

// ---- #テストの見本（ためしの予報。シートにも LINE にも触らない） ----

function weatherSampleCards_() {
  const now = new Date();
  const notice = { placeName: '名古屋市中村区', lat: 35.17, lon: 136.88 };
  const today = formatDay_(now);
  const yesterday = formatDay_(new Date(now.getTime() - 24 * 3600 * 1000));
  const make = (o) => {
    const time = [];
    const pressure = [];
    const pop = [];
    const temp = [];
    [yesterday, today].forEach((date, dayIndex) => {
      for (let hour = 0; hour < 24; hour += 1) {
        time.push(`${date}T${String(hour).padStart(2, '0')}:00`);
        pressure.push(1013 - (dayIndex && o.pressureDrop && hour >= 12 ? (hour - 11) * o.pressureDrop : 0));
        pop.push(dayIndex && o.rain && hour >= 12 && hour <= 14 ? 70 : 10);
        temp.push(dayIndex ? 18 + (o.tempJump || 0) : 18);
      }
    });
    return parseForecast_({
      hourly: { time: time, pressure_msl: pressure, precipitation_probability: pop, temperature_2m: temp },
      daily: { time: [yesterday, today], temperature_2m_max: [18, 18 + (o.tempJump || 0)] }
    });
  };
  const cards = [{ rain: true }, { pressureDrop: 1.2 }, { tempJump: -7 }]
    .map((o) => weatherNoticeCard_(notice, today, evaluateNotice_(make(o), today), { now: now, sample: true }));
  const calm = evaluateNotice_(make({}), today);
  return [...cards, textMessage_(calm.length ? '🧪（何もない日の見本を作れませんでした）' : '🧪 何もない日（雨・気圧・気温どれもふつう）は、送りません。')];
}

registerModule_({
  key: 'weather',
  emoji: '☁️',
  name: '天気',
  desc: '雨・気圧の変化・気温の大きな変わり目がある日だけ、決めた時間に知らせます（そらくる）',
  order: 10,
  words: [WEATHER_.label, '天気の知らせ', '天気'],
  sheets: {
    weather: { name: '天気の地点', headers: ['noticeId', 'ownerUserId', 'targetType', 'targetId', 'placeName', 'lat', 'lon', 'notifyHour', 'isActive', 'lastCheckedDate', 'createdAt', 'updatedAt'] }
  },
  menu: (event, role) => weatherListCard_(weatherOfTarget_(event), role),
  onPostback: weatherPostback_,
  onLocation: weatherLocationReply_,
  hourly: weatherHourly_,
  onMemberRemoved: (userId) => weatherNotices_().filter((n) => n.ownerUserId === userId).forEach((n) => updateRow_('weather', 'noticeId', n.noticeId, { isActive: false })),
  // ページ（そらくるなど）から：その人が足した地点の一覧（名前と時間だけ。位置・送り先は返さない）
  tool: {
    list: (body, user) => ({ ok: true, places: weatherNotices_().filter((n) => n.ownerUserId === user.userId).map((n) => ({ name: n.placeName, hour: n.notifyHour })) })
  },
  samples: () => [
    { id: 'notice', label: '☁️ 天気の知らせ', build: weatherSampleCards_ },
    {
      id: 'list',
      label: '☁️ 天気の一覧',
      build: () => [weatherListCard_([
        { noticeId: 's1', placeName: '名古屋市中村区', lat: 35.17, lon: 136.88, notifyHour: 7 },
        { noticeId: 's2', placeName: '札幌市中央区', lat: 43.06, lon: 141.35, notifyHour: 21 }
      ], 'owner', { sample: true })]
    }
  ],
  // トークの下のメニューの「☁️ 天気」のタブ（下の3つ。上のタブの行は 07_richmenu.gs）
  richMenu: {
    chatBarText: 'そらくる',
    image: `${BOT_PAGES_}assets/richmenu-weather.png`,
    areas: [
      { type: 'postback', data: 'm=weather&a=menu', displayText: WEATHER_.label },
      { type: 'postback', data: 'm=weather&a=add', displayText: '📍 地点を足す' },
      { type: 'uri', uri: SORAQRU_URL_ }
    ]
  }
});
