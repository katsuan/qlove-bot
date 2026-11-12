/**
 * 56_sea.gs：機能「🎣 釣り」（うみくる 〜UmiQru〜 と同じ潮の見方）
 *
 * 釣った魚の写真を送ると、その時刻の潮と風を返して、シート「釣りの記録」に残す（あとで魚種・潮で分けて見るため）：
 *   1. 写真が届く（写真がなければ「釣れた」「釣れた アジ」・「🐟 釣れた（写真なし）」）→ 「どこで釣った？」のクイックリプライ：前の釣り場（最近使った順）・📍 現在地
 *   2. 釣り場を選ぶ（現在地なら、位置情報で新しい釣り場を足す。200m 以内に前の釣り場があれば、それを使う）
 *   3. 写真を送った時刻の潮（近い地点の気象庁の潮位表：潮位・上げ下げ・潮の名前）と、3時間前〜1時間後の風を返す
 * 時刻は「写真を送った時刻」（LINE で送った写真には、撮った時刻が残らないことが多いため）。
 * 写真を受けとるのは、この機能だけ（しょくじは写真を受けない）。1対1 のトークで、使える人の写真だけ。
 * ファイル：56_sea.gs（決まった値・登録）・56_sea_tide.gs（潮・月・太陽・風）・56_sea_stations.gs（潮位表の地点。作るのは tools/sea_stations.py）・
 *          56_sea_spots.gs（釣り場・写真・返事）・56_sea_widget.gs（1枚目のカード：うみくるの大きいウィジェットと同じ並び）
 * 呼ばれるところ：02_config.gs の registerModule_（ぜんぶのファイルを読み終わってから組み立てる）
 */

const SEA_ = {
  label: '🎣 釣り',
  maxSpots: 20, // 1人の釣り場
  quickSpots: 5, // 写真のあとに出す前の釣り場の数（最近使った順）
  sameSpotM: 200, // この近さに前の釣り場があれば、新しく足さずにそれを使う
  pendingSeconds: 600, // 写真・「📍 釣り場を足す」のあと、位置情報を待つ時間
  maxPastDays: 7, // これより前の写真の時刻は受けない（ボタンが古い）
  portMaxKm: 40, // これより遠い潮位表の地点は使わない（気象庁の地点は港より少ないので、うみくるの 30km より広く）
  stationTries: 3, // いちばん近い地点の表が読めないとき、近い順にここまで試す
  umiPortMaxKm: 30, // うみくるの港（tide736）はこれより遠ければ使わない（うみくるの PORT_MAX_KM と同じ）
  windBefore: 3, // 風を見る：何時間前から
  windAfter: 1, // 何時間後まで
  windTrendMs: 2, // 3時間でこれだけ変わったら「強まってきた」「弱まってきた」
  labelMax: 16, // 魚の名前の長さ
  quickLabels: 8, // 「✏️ 時刻・魚を直す」で出す、前に使った魚の名前の数
  color: '#0E6E9E' // うみくるの色
};
// 表に出すツールの名前（ここにだけ書く。q-oqrn/data/hub-links.json の umiqru と同じ）
const UMIQRU_ = { name: 'うみくる', en: 'UmiQru' };
const UMIQRU_URL_ = 'https://katsuan.github.io/umiqru/';
const UMIQRU_PORTS_URL_ = `${UMIQRU_URL_}data/ports.json`; // うみくるの港の表（tide736 の港。うみくるの画面が潮を読む所）
const SEA_JMA_TIDE_URL_ = 'https://www.data.jma.go.jp/kaiyou/data/db/tide/suisan/txt/'; // ＋ 年/記号.txt
const SEA_TIDE736_API_URL_ = 'https://api.tide736.net/get_tide.php'; // tide736 のトップページが書いている API の住所（試し：botTide736Check）
const SEA_OPEN_METEO_URL_ = 'https://api.open-meteo.com/v1/forecast';
const SEA_SOURCE_TEXT_ = '潮：気象庁 潮位表（満潮・干潮のあいだは曲線でつないだ目安）・風：Open-Meteo.com（CC BY 4.0）';
const SEA_RENAME_TEXT_ = /^釣り場の名前[\s　]+(.+)$/u;
const SEA_LABEL_TEXT_ = /^魚の名前[\s　]+(.+)$/u; // 「✏️ 魚の名前を書く」のあとの文
const SEA_CATCH_TEXT_ = /^(釣れた|釣果)(?:[\s　]+(.+))?$/u; // 写真なしの釣果（「釣れた アジ」なら魚の名前も）
const SEA_RECORD_ID_ = /^t?\d{1,30}$/; // 記録の印：写真・文のメッセージの番号か、ボタンなら t＋時刻


// ---- 登録（中身はぜんぶのファイルを読み終わってから組み立てる。02_config.gs の registerModule_） ----

registerModule_(() => ({
  key: 'sea',
  emoji: '🎣',
  name: '釣り',
  desc: '釣った魚の写真を送ると、その時刻の潮と風を返して記録します（うみくる）',
  sender: { name: `${UMIQRU_.name}〜${UMIQRU_.en}〜`, iconUrl: `${UMIQRU_URL_}apple-touch-icon.png` },
  toolUrls: [UMIQRU_URL_],
  order: 40,
  words: [SEA_.label, '釣り', '釣り場'],
  sheets: {
    seaSpots: { name: '釣り場', headers: ['spotId', 'userId', 'name', 'lat', 'lon', 'isActive', 'lastUsedAt', 'createdAt', 'updatedAt'] },
    seaLogs: {
      name: '釣りの記録',
      headers: ['recordId', 'userId', 'messageId', 'spotId', 'spotName', 'at', 'port', 'moon', 'tideCm', 'tidePct', 'phase', 'stage', 'stageText', 'fromHighMin', 'tideEvents', 'mazume',
        'windMs', 'windDir', 'windTrend', 'windSeries', 'label', 'createdAt', 'updatedAt']
    }
  },
  menu: (event, role) => seaMenuReply_(event, role),
  onPostback: seaPostback_,
  noReply: (p) => p.a === 'name' || p.a === 'labelin', // 入力欄に「釣り場の名前 」「魚の名前 」を入れて開くだけ（返事は、送られてきた文に）
  onLocation: seaLocationReply_,
  onImage: seaImageReply_,
  onText: seaTextReply_,
  textPattern: /^(釣り場の名前[\s　]+.+|魚の名前[\s　]+.+|(釣れた|釣果)([\s　]+.+)?)$/u,
  textForMembers: true,
  onMemberRemoved: (userId) => seaSpotsOf_(userId).forEach((s) => updateRow_('seaSpots', 'spotId', s.spotId, { isActive: false })),
  // トークの下のメニュー：しょくじがあるときは、右の Qlove のタブに「🐟 釣れた」（写真なしの記録）。いちばん先の機能なら、左のタブ（うみくる）
  richMenu: {
    rank: 40,
    club: { type: 'postback', data: 'm=sea&a=catch', displayText: '🐟 釣れた' },
    chatBarText: SEA_.label,
    image: `${BOT_PAGES_}assets/richmenu-sea.png`,
    areas: [
      { type: 'postback', data: 'm=sea&a=catch', displayText: '🐟 釣れた（写真なし）' },
      { type: 'postback', data: 'm=sea&a=menu', displayText: SEA_.label },
      { type: 'uri', uri: UMIQRU_URL_ }
    ]
  },
  samples: () => [{ id: 'record', label: '🎣 釣りの記録', build: () => seaRecordMessage_(seaSampleInfo_()) }]
}));
