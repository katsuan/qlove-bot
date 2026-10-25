/**
 * 50_weather.gs：機能「☁️ 天気」（そらくる 〜SoraQru〜 と同じ見方）
 *
 * 地点（家・実家・職場など）を登録すると、知らせる価値がある日だけ、決めた時間にカードを push する：
 *   ☔ 雨：6〜21時に降水確率 60% 以上の時間がある
 *   🌀 気圧：3時間の変化が「注意」「警戒」の時間がある（そらくるの js/meteo.js と同じ目安。下に写した）
 *   🌡️ 気温：最高気温が前の日より 5℃ 以上ちがう
 * 何もない日は送らない。急ぎでない知らせなので、送れる数が 80% をこえたら止める（push_ の 'normal'）。
 * ファイル：50_weather.gs（決まった値・登録）・50_weather_forecast.gs（予報・目安・地名）・50_weather_places.gs（地点と返事）・
 *          50_weather_cards.gs（カード・#テストの見本）・50_weather_hourly.gs（見張り）
 * 中身は KazoQ の「場所の天気の知らせ」（q-kazoq/01_43_WEATHER_NOTICE.js）から、KazoQ の家族・管理者の決まりを外したもの。
 *
 * 登録：「☁️ 天気」→「📍 地点を足す」→ クイックリプライの「📍 位置情報を送る」。位置は 0.01 度（1km くらい）に丸め、
 * 地名は、位置情報の住所か、国土地理院の逆ジオコーダー（100m くらいに丸めた位置）と、そらくるの市区町村の表で。
 * 送り先は、登録したトーク（1対1 なら本人・グループならそのグループ）。地点は1人3か所、ボット全体で20か所まで。
 * 呼ばれるところ：02_config.gs の registerModule_（ぜんぶのファイルを読み終わってから組み立てる）
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
const WEATHER_RULES_ = { rainPop: 60, rainFromHour: 6, rainToHour: 21, pressureLevel: 2, tempDiff: 5 };
const SORAQRU_URL_ = 'https://katsuan.github.io/soraqru/';
const SORAQRU_MUNI_URL_ = 'https://katsuan.github.io/soraqru/data/muni.json';
const OPEN_METEO_URL_ = 'https://api.open-meteo.com/v1/forecast';
const GSI_REVERSE_GEOCODER_URL_ = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress';
const WEATHER_SOURCE_TEXT_ = '天気：Open-Meteo.com（CC BY 4.0）・地名：国土地理院・気圧は変化の目安です（体調の予測ではありません）';


// ---- 登録（中身はぜんぶのファイルを読み終わってから組み立てる。02_config.gs の registerModule_） ----

registerModule_(() => ({
  key: 'weather',
  emoji: '☁️',
  name: '天気',
  desc: '雨・気圧の変化・気温の大きな変わり目がある日だけ、決めた時間に知らせます（そらくる）',
  sender: { name: 'そらくる〜SoraQru〜', iconUrl: `${SORAQRU_URL_}apple-touch-icon.png` },
  order: 10,
  words: [WEATHER_.label, '天気の知らせ', '天気'],
  sheets: {
    weather: { name: '天気の地点', headers: ['noticeId', 'ownerUserId', 'targetType', 'targetId', 'placeName', 'lat', 'lon', 'notifyHour', 'isActive', 'lastCheckedDate', 'createdAt', 'updatedAt'] }
  },
  menu: (event, role) => weatherListCard_(weatherOfTarget_(event), role),
  onPostback: weatherPostback_,
  onLocation: weatherLocationReply_,
  onText: weatherTextReply_,
  textPattern: WEATHER_ADD_TEXT_, // 「入力中…」を出す文（01_router.gs の shouldShowLoading_）
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
  // トークの下のメニューの「☁️ 天気」のタブ（下の3つ。上のタブの行は 08_richmenu.gs）
  richMenu: {
    rank: 20, // しょくじがあるときは、右の Qlove のタブにボタン1つ（club）
    club: { type: 'postback', data: 'm=weather&a=menu', displayText: WEATHER_.label },
    chatBarText: 'そらくる',
    image: `${BOT_PAGES_}assets/richmenu-weather.png`,
    areas: [
      { type: 'postback', data: 'm=weather&a=menu', displayText: WEATHER_.label },
      { type: 'postback', data: 'm=weather&a=add', displayText: '📍 地点を足す' },
      { type: 'uri', uri: SORAQRU_URL_ }
    ]
  }
}));
