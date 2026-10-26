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

// 時間ごとの表の時間（6〜21時の3時間ごと：起きているあいだを1枚に収める。雨の目安も 6〜21時。行は、その時間から3時間のいちばん注意のもの）
const WEATHER_TABLE_HOURS_ = [6, 9, 12, 15, 18, 21];

/**
 * その日の時間ごとの表（時間・天気・気温・降水確率・気圧の段階）。rows は weatherParseForecast_ のその日の行。
 * 3時間ごとに1行。気圧の段階・降水確率は、その3時間のいちばん大きいもの。注意（気圧が注意・警戒、雨 60% 以上）の行は、色を付けて太字に
 */
function weatherHourTable_(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  const head = (text, flex, align) => ({ type: 'text', text, size: 'xxs', color: '#9CA3AF', flex, align: align || 'start' });
  const lines = WEATHER_TABLE_HOURS_.map((h) => {
    const block = list.filter((r) => r.hour >= h && r.hour < h + 3);
    const at = block.find((r) => r.hour === h) || block[0];
    if (!at) return null;
    const level = block.reduce((m, r) => (r.level !== null && r.level > m ? r.level : m), -1);
    const pop = block.reduce((m, r) => (r.pop !== null && r.pop > m ? r.pop : m), -1);
    const code = (block.find((r) => r.hour === h + 1) || at).code;
    const lv = level >= 0 ? SORAQRU_LEVELS_[level] : null;
    const rainy = pop >= WEATHER_RULES_.rainPop;
    const warn = level >= WEATHER_RULES_.pressureLevel || rainy;
    const box = {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      paddingTop: '4px',
      paddingBottom: '4px',
      paddingStart: '6px',
      paddingEnd: '6px',
      cornerRadius: '6px',
      contents: [
        { type: 'text', text: `${h}時`, size: 'sm', flex: 2, weight: warn ? 'bold' : 'regular', color: '#111827' },
        { type: 'text', text: soraqruWeatherEmoji_(code, h >= 6 && h < 18), size: 'sm', flex: 1, align: 'center' },
        { type: 'text', text: at.temp === null ? '—' : `${Math.round(at.temp)}°`, size: 'sm', flex: 2, align: 'end', color: '#111827' },
        { type: 'text', text: pop < 0 ? '—' : `${Math.round(pop)}%`, size: 'sm', flex: 2, align: 'end', weight: rainy ? 'bold' : 'regular', color: rainy ? '#1D4ED8' : '#4B5563' },
        { type: 'text', text: lv ? `● ${lv.label}` : '—', size: 'sm', flex: 4, align: 'end', weight: level >= WEATHER_RULES_.pressureLevel ? 'bold' : 'regular', color: lv ? lv.color : '#9CA3AF' }
      ]
    };
    if (level >= 3) box.backgroundColor = '#FDECEA';
    else if (level >= WEATHER_RULES_.pressureLevel) box.backgroundColor = '#FEF3E2';
    else if (rainy) box.backgroundColor = '#EAF2FF';
    return box;
  }).filter(Boolean);
  if (!lines.length) return null;
  return {
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    margin: 'lg',
    contents: [
      { type: 'box', layout: 'horizontal', spacing: 'sm', paddingStart: '6px', paddingEnd: '6px', contents: [head('時間', 2), head('天気', 1, 'center'), head('気温', 2, 'end'), head('☔', 2, 'end'), head('気圧', 4, 'end')] },
      { type: 'separator', color: '#E5E7EB' },
      ...lines
    ]
  };
}

/**
 * 知らせのカード。altText は「☔ 名古屋市中村区：12〜15時 雨 70%（ほか1つ）」のように中身がわかる1行。
 * options.rows（その日の時間ごとの予報）があれば、時間ごとの表も。alerts が空（何もない日の見本）なら「どれもふつう」
 */
function weatherNoticeCard_(notice, date, alerts, options) {
  const opt = options || {};
  const isTomorrow = date !== formatDay_(opt.now || new Date());
  const more = alerts.length > 1 ? `（ほか${alerts.length - 1}つ）` : '';
  const mark = opt.sample ? '🧪 ' : '';
  const table = weatherHourTable_(opt.rows);
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
      table,
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

