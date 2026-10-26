/**
 * 50_weather_cards.gs：機能「☁️ 天気」のカード（知らせ・一覧）と #テスト の見本
 * 中身：知らせのカード・一覧のカード・#テストの見本。呼ばれるところ：50_weather_places.gs（一覧）・50_weather_hourly.gs（知らせ）・50_weather.gs の登録（menu・samples）
 */

// ---- カード ----

/** その地点が開くそらくるの URL（?at=…&name=…&from=qlovebot） */
function soraqruPlaceUrl_(notice) {
  const at = `${Number(notice.lat).toFixed(2)},${Number(notice.lon).toFixed(2)}`;
  return `${SORAQRU_URL_}?at=${at}&name=${encodeURIComponent(notice.placeName || '')}&from=qlovebot`;
}

// 天気の段の時間（6〜21時の3時間ごと：起きているあいだ。雨の目安も 6〜21時）と、気圧の棒の高さ（KazoQ の頭痛ーるのカードと同じ）
const WEATHER_BLOCK_HOURS_ = [6, 9, 12, 15, 18, 21];
const WEATHER_BAR_ = { maxHeight: 48, minHeight: 6, pastAlpha: 0.35 };

/** 色を白とまぜて薄くする（過ぎた時間の棒） */
function weatherFade_(hex, alpha) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const mix = (c) => Math.round(c * alpha + 255 * (1 - alpha)).toString(16).padStart(2, '0');
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`.toUpperCase();
}

/**
 * 1時間ごとの気圧の棒グラフ（KazoQ・SQriptable と同じ見せ方）：高さ＝その日の気圧（いちばん低い〜高い）、色＝気圧の変化の段階
 * （そらくると同じ 通常／やや注意／注意／警戒）。今日なら、過ぎた時間は薄く、いまの時間に ●。0・6・12・18時の目盛り
 */
function weatherPressureChart_(rows, nowHour) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r.hpa !== null).sort((a, b) => a.hour - b.hour);
  if (list.length < 6) return null;
  const min = Math.min(...list.map((r) => r.hpa));
  const max = Math.max(...list.map((r) => r.hpa));
  const columns = list.map((r) => {
    const ratio = max > min ? (r.hpa - min) / (max - min) : 0.5;
    const color = SORAQRU_LEVELS_[r.level === null ? 0 : r.level].color;
    const past = nowHour !== null && nowHour !== undefined && r.hour < nowHour;
    const bar = {
      type: 'box',
      layout: 'vertical',
      height: `${Math.round(WEATHER_BAR_.minHeight + (WEATHER_BAR_.maxHeight - WEATHER_BAR_.minHeight) * ratio)}px`,
      cornerRadius: '2px',
      backgroundColor: past ? weatherFade_(color, WEATHER_BAR_.pastAlpha) : color,
      contents: [{ type: 'text', text: ' ', size: '1px' }] // LINE が空の箱を受けつけないことがあるので、見えない文字を1つ
    };
    const now = nowHour === r.hour ? [{ type: 'text', text: '●', size: 'xxs', align: 'center', color: '#111827' }] : [];
    return { type: 'box', layout: 'vertical', flex: 1, justifyContent: 'flex-end', contents: now.concat([bar]) };
  });
  return {
    type: 'box',
    layout: 'vertical',
    margin: 'lg',
    contents: [
      smallText_(`🌀 気圧（${Math.round(min)}〜${Math.round(max)} hPa。色は3時間の変化の目安）`, { size: 'xxs' }),
      { type: 'box', layout: 'horizontal', spacing: '2px', height: `${WEATHER_BAR_.maxHeight + 12}px`, alignItems: 'flex-end', margin: 'sm', contents: columns },
      { type: 'box', layout: 'horizontal', margin: 'xs', contents: ['0時', '6時', '12時', '18時'].map((t) => smallText_(t, { size: 'xxs', flex: 1 })) },
      {
        type: 'box',
        layout: 'horizontal',
        margin: 'xs',
        spacing: 'sm',
        contents: SORAQRU_LEVELS_.map((lv) => ({ type: 'text', text: `● ${lv.label}`, size: 'xxs', color: lv.color, flex: 0 }))
      }
    ]
  };
}

/**
 * 3時間ごとの天気の段（時間・天気・気温・降水確率）。降水確率はその3時間のいちばん大きいもの。雨 60% 以上は青の太字
 */
function weatherBlocks_(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const blocks = WEATHER_BLOCK_HOURS_.map((h) => {
    const block = list.filter((r) => r.hour >= h && r.hour < h + 3);
    const at = block.find((r) => r.hour === h) || block[0];
    if (!at) return null;
    const pop = block.reduce((m, r) => (r.pop !== null && r.pop > m ? r.pop : m), -1);
    const code = (block.find((r) => r.hour === h + 1) || at).code;
    const rainy = pop >= WEATHER_RULES_.rainPop;
    return {
      type: 'box',
      layout: 'vertical',
      flex: 1,
      spacing: 'xs',
      contents: [
        { type: 'text', text: `${h}時`, size: 'xxs', align: 'center', color: '#6B7280' },
        { type: 'text', text: soraqruWeatherEmoji_(code, h >= 6 && h < 18), size: 'md', align: 'center' },
        { type: 'text', text: at.temp === null ? '—' : `${Math.round(at.temp)}°`, size: 'xs', align: 'center', color: '#111827' },
        { type: 'text', text: pop < 0 ? '—' : `${Math.round(pop)}%`, size: 'xxs', align: 'center', weight: rainy ? 'bold' : 'regular', color: rainy ? '#1D4ED8' : '#6B7280' }
      ]
    };
  }).filter(Boolean);
  if (!blocks.length) return null;
  return { type: 'box', layout: 'horizontal', margin: 'md', paddingAll: '8px', cornerRadius: '8px', backgroundColor: '#F5F6F8', contents: blocks };
}

/**
 * 知らせのカード。altText は「☔ 名古屋市中村区：12〜15時 雨 70%（ほか1つ）」のように中身がわかる1行。
 * options.rows（その日の時間ごとの予報）があれば、1時間ごとの気圧の棒グラフと、3時間ごとの天気の段も（KazoQ と同じ見せ方）。
 * alerts が空（何もない日の見本）なら「どれもふつう」
 */
function weatherNoticeCard_(notice, date, alerts, options) {
  const opt = options || {};
  const isTomorrow = date !== formatDay_(opt.now || new Date());
  const more = alerts.length > 1 ? `（ほか${alerts.length - 1}つ）` : '';
  const mark = opt.sample ? '🧪 ' : '';
  const today = date === formatDay_(opt.now || new Date());
  const nowHour = today ? Number(Utilities.formatDate(opt.now || new Date(), timeZone_(), 'H')) : null;
  const chart = weatherPressureChart_(opt.rows, nowHour);
  const blocks = weatherBlocks_(opt.rows);
  const calm = alerts.length ? [] : [{ type: 'text', text: '雨・気圧・気温、どれもふつうの日です（この日は送りません）', size: 'sm', wrap: true, color: '#111827' }];
  return bubble_(
    alerts.length ? `${mark}${alerts[0].emoji} ${notice.placeName}：${alerts[0].lines[0]}${more}` : `${mark}☁️ ${notice.placeName}：どれもふつう`,
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
      ...calm,
      chart,
      blocks,
      smallText_(WEATHER_SOURCE_TEXT_, { size: 'xxs', color: '#9CA3AF', margin: 'lg' })
    ],
    [uriButton_('🌤️ そらくるで開く', soraqruPlaceUrl_(notice))]
  );
}

/** 天気の一覧のカード：このトークの地点と時間、地点ごとの「⚙️ 変える」、地点を足す・そらくるのボタン */
function weatherListCard_(notices, role, options) {
  const mark = options && options.sample ? '🧪 ' : '';
  const rows = notices.length
    ? notices.map((n) => ({
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: [
        { type: 'text', text: `📍 ${n.placeName}`, size: 'sm', weight: 'bold', wrap: true, flex: 3, color: WEATHER_.color, decoration: 'underline' },
        { type: 'text', text: weatherHourLabel_(n.notifyHour), size: 'xs', color: '#6B7280', align: 'end', wrap: true, flex: 2, gravity: 'center' },
        // ⚙️ 変える：押されるたびに、その地点がまだあるか・押した人が変えてよいかを見て返す（ux.md の H2。何日もあとでもよい）
        role ? { type: 'button', style: 'link', height: 'sm', flex: 0, action: { type: 'postback', label: '⚙️ 変える', data: `m=weather&a=hours&id=${encodeURIComponent(n.noticeId)}`, displayText: `⚙️ ${n.placeName}を変える` } } : null
      ].filter(Boolean),
      // 地点の名前を押すと、その地点のそらくるが開く
      action: { type: 'uri', label: `${n.placeName}をそらくるで`.slice(0, 40), uri: soraqruPlaceUrl_(n) }
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
    role ? [postbackButton_('📍 地点を足す', 'm=weather&a=add'), uriButton_('🌤️ そらくるで見る', SORAQRU_URL_)] : []
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


// ---- #テストの見本（ためしの予報。シートにも LINE にも触らない） ----

/** #テストの天気の知らせの見本（雨・気圧・気温の3枚と、何もない日の文）。ためしの予報で作る */
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
    const code = [];
    [yesterday, today].forEach((date, dayIndex) => {
      for (let hour = 0; hour < 24; hour += 1) {
        time.push(`${date}T${String(hour).padStart(2, '0')}:00`);
        pressure.push(1013 - (dayIndex && o.pressureDrop && hour >= 12 ? (hour - 11) * o.pressureDrop : 0));
        pop.push(dayIndex && o.rain && hour >= 12 && hour <= 14 ? 70 : 10);
        temp.push(dayIndex ? 18 + (o.tempJump || 0) + Math.round(4 * Math.sin(((hour - 8) / 24) * 2 * Math.PI)) : 18);
        code.push(dayIndex && o.rain && hour >= 12 && hour <= 14 ? 61 : hour >= 6 && hour < 18 ? 1 : 0);
      }
    });
    return weatherParseForecast_({
      hourly: { time: time, pressure_msl: pressure, precipitation_probability: pop, temperature_2m: temp, weather_code: code },
      daily: { time: [yesterday, today], temperature_2m_max: [18, 18 + (o.tempJump || 0)] }
    });
  };
  // 雨・気圧・気温・何もない日（何もない日は送らないが、表の見本として）
  return [{ rain: true }, { pressureDrop: 1.2 }, { tempJump: -7 }, {}].map((o) => {
    const forecast = make(o);
    return weatherNoticeCard_(notice, today, weatherEvaluate_(forecast, today), { now: now, sample: true, rows: forecast.days[today] });
  });
}

