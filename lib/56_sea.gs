/**
 * 56_sea.gs：機能「🎣 釣り」（うみくる 〜UmiQru〜 と同じ潮の見方）
 *
 * 釣った魚の写真を送ると、その時刻の潮と風を返して、シート「釣りの記録」に残す（あとで魚種・潮で分けて見るため）：
 *   1. 写真が届く → 「どこで釣った？」のクイックリプライ：前の釣り場（最近使った順）・📍 現在地
 *   2. 釣り場を選ぶ（現在地なら、位置情報で新しい釣り場を足す。200m 以内に前の釣り場があれば、それを使う）
 *   3. 写真を送った時刻の潮（近い港の潮汐表を20分ごとにつないだ潮位・上げ下げ・潮の名前）と、3時間前〜1時間後の風を返す
 * 時刻は「写真を送った時刻」（LINE で送った写真には、撮った時刻が残らないことが多いため）。
 * 写真を受けとるのは、この機能だけ（しょくじは写真を受けない）。1対1 のトークで、使える人の写真だけ。
 * ファイル：56_sea.gs（決まった値・登録）・56_sea_tide.gs（港・潮・風）・56_sea_spots.gs（釣り場・写真・返事）
 * 呼ばれるところ：02_config.gs の registerModule_（ぜんぶのファイルを読み終わってから組み立てる）
 */

const SEA_ = {
  label: '🎣 釣り',
  maxSpots: 20, // 1人の釣り場
  quickSpots: 5, // 写真のあとに出す前の釣り場の数（最近使った順）
  sameSpotM: 200, // この近さに前の釣り場があれば、新しく足さずにそれを使う
  pendingSeconds: 600, // 写真・「📍 釣り場を足す」のあと、位置情報を待つ時間
  maxPastDays: 7, // これより前の写真の時刻は受けない（ボタンが古い）
  portMaxKm: 30, // これより遠い港の潮汐表は使わない（うみくるの PORT_MAX_KM と同じ）
  windBefore: 3, // 風を見る：何時間前から
  windAfter: 1, // 何時間後まで
  windTrendMs: 2, // 3時間でこれだけ変わったら「強まってきた」「弱まってきた」
  color: '#0E6E9E' // うみくるの色
};
// 表に出すツールの名前（ここにだけ書く。q-oqrn/data/hub-links.json の umiqru と同じ）
const UMIQRU_ = { name: 'うみくる', en: 'UmiQru' };
const UMIQRU_URL_ = 'https://katsuan.github.io/umiqru/';
const UMIQRU_PORTS_URL_ = `${UMIQRU_URL_}data/ports.json`;
const SEA_TIDE736_URL_ = 'https://tide736.net/api/get_tide.php';
const SEA_OPEN_METEO_URL_ = 'https://api.open-meteo.com/v1/forecast';
const SEA_SOURCE_TEXT_ = '潮：tide736.net（海上保安庁の調和定数で計算）・風：Open-Meteo.com（CC BY 4.0）';
const SEA_RENAME_TEXT_ = /^釣り場の名前[\s　]+(.+)$/u;


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
    seaSpots: { name: '釣り場', headers: ['spotId', 'userId', 'name', 'lat', 'lon', 'portPc', 'portHc', 'portName', 'isActive', 'lastUsedAt', 'createdAt', 'updatedAt'] },
    seaLogs: {
      name: '釣りの記録',
      headers: ['recordId', 'userId', 'messageId', 'spotId', 'spotName', 'at', 'port', 'moon', 'tideCm', 'tidePct', 'phase', 'stage', 'stageText', 'fromHighMin', 'tideEvents', 'mazume',
        'windMs', 'windDir', 'windTrend', 'windSeries', 'label', 'createdAt', 'updatedAt']
    }
  },
  menu: (event, role) => seaMenuReply_(event, role),
  onPostback: seaPostback_,
  noReply: (p) => p.a === 'name', // 入力欄に「釣り場の名前 」を入れて開くだけ（返事は、送られてきた文に）
  onLocation: seaLocationReply_,
  onImage: seaImageReply_,
  onText: seaTextReply_,
  textPattern: SEA_RENAME_TEXT_,
  textForMembers: true,
  onMemberRemoved: (userId) => seaSpotsOf_(userId).forEach((s) => updateRow_('seaSpots', 'spotId', s.spotId, { isActive: false })),
  samples: () => [{ id: 'record', label: '🎣 釣りの記録', build: () => [seaRecordMessage_(seaSampleInfo_())] }]
}));
