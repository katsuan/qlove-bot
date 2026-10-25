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
    [yesterday, today].forEach((date, dayIndex) => {
      for (let hour = 0; hour < 24; hour += 1) {
        time.push(`${date}T${String(hour).padStart(2, '0')}:00`);
        pressure.push(1013 - (dayIndex && o.pressureDrop && hour >= 12 ? (hour - 11) * o.pressureDrop : 0));
        pop.push(dayIndex && o.rain && hour >= 12 && hour <= 14 ? 70 : 10);
        temp.push(dayIndex ? 18 + (o.tempJump || 0) : 18);
      }
    });
    return weatherParseForecast_({
      hourly: { time: time, pressure_msl: pressure, precipitation_probability: pop, temperature_2m: temp },
      daily: { time: [yesterday, today], temperature_2m_max: [18, 18 + (o.tempJump || 0)] }
    });
  };
  const cards = [{ rain: true }, { pressureDrop: 1.2 }, { tempJump: -7 }]
    .map((o) => weatherNoticeCard_(notice, today, weatherEvaluate_(make(o), today), { now: now, sample: true }));
  const calm = weatherEvaluate_(make({}), today);
  return [...cards, textMessage_(calm.length ? '🧪（何もない日の見本を作れませんでした）' : '🧪 何もない日（雨・気圧・気温どれもふつう）は、送りません。')];
}

