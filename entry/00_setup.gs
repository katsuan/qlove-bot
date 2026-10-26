/**
 * くらぶボット（仮）の配布用シート：人が GAS エディタから実行する関数（中身はライブラリ QloveBot）
 * 上の「実行する関数を選ぶ」から選んで ▶ 実行。結果は下の「実行ログ」に出ます。
 *
 * はじめてのときは、この順に：
 *   1. 「プロジェクトの設定」→「スクリプト プロパティ」に LINE_CHANNEL_ACCESS_TOKEN を入れて、setupBot
 *   2. 「デプロイ」→「新しいデプロイ」→ ウェブアプリ（実行するユーザー：自分、アクセスできるユーザー：全員）→ showWebhookUrl
 *      出た ① の URL を LINE Developers の「Webhook URL」に入れ、「Webhookの利用」をオン
 *   3. LINE で友だちになり「🔑 持ち主の登録」を押して、10分以内に adoptOwner
 *   4. setupRichMenu（トークの下のメニュー）
 * ふだん：うまく動かないときは checkBot。LINE で持ち主が「#テスト」と送ると、見本と自己点検も見られます
 * 前の LOgBOT・食事記録ボットから引っこすとき：https://katsuan.github.io/qlove-bot/docs/setup.html の「前のボットから引っこす」
 * 新しい版：左の「ライブラリ」の QloveBot → 版をいちばん新しいものに →「保存」（このファイルは変えなくてよい）
 * くわしい手順：https://katsuan.github.io/qlove-bot/docs/setup.html
 * ボットから呼ばれる入口（doPost・1時間おきの見張り）は 01_entry.gs
 */

/** 準備ができているかを見る。うまく動かないときに実行（何も書きかえない・送らない）。実行ログに ✅ ⚠️ ❌ が並ぶ */
function checkBot() {
  const env = env_();
  env.triggers = ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction());
  return QloveBot.botCheck(env);
}

/** はじめに1回実行：シート・Webhook の合言葉・1時間おきの見張り（トリガー）を用意する。2回目からは足りないものだけ足す */
function setupBot() {
  QloveBot.botSetup(env_());
  if (!ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'hourlyQloveBot')) {
    ScriptApp.newTrigger('hourlyQloveBot').timeBased().everyHours(1).create();
    console.log('✅ 1時間おきの見張り（hourlyQloveBot）を作りました');
  } else {
    console.log('✅ 1時間おきの見張りはもうあります');
  }
  console.log('次は：「デプロイ」→「新しいデプロイ」→ ウェブアプリ（実行するユーザー：自分、アクセスできるユーザー：全員）→ showWebhookUrl を実行');
}

/** デプロイしたあとに実行：LINE に入れる Webhook の URL（① 合言葉つき）と、ツールに入れる URL（② 合言葉なし）を実行ログに出す */
function showWebhookUrl() {
  return QloveBot.botWebhookUrl(env_());
}

/** LINE で「🔑 持ち主の登録」を押してから10分以内に実行：押した人を持ち主にする。実行ログに名前が出る */
function adoptOwner() {
  return QloveBot.botAdoptOwner(env_());
}

/** 実行すると、トークの下のメニュー（しょくじ／Qlove の2つのタブ）を作りなおす。出るまで少しかかることがある */
function setupRichMenu() {
  return QloveBot.botSetupRichMenu(env_());
}

// ---- 前の LOgBOT から引っこすとき（めったに使わない。持ち主だけ） ----

/** 前の LOgBOT の記録（シートのタブを写したもの）のうち、持ち主の ID を付けかえる記録が何件あるかを見るだけ（スクリプト プロパティ LOG_OLD_OWNER_IDS に前の ID） */
function moveOldLogRecordsPreview() {
  return QloveBot.botLogMoveOldRecords(env_(), true);
}

/** 上の記録の ID を、くらぶボットの持ち主の ID に付けかえる（1回だけ。何度実行しても同じ） */
function moveOldLogRecords() {
  return QloveBot.botLogMoveOldRecords(env_(), false);
}

/** 前の形の記録（LOgBOT・食事記録ボットから写したもの）を、いまの形にするところが何行あるかを見るだけ（何も書かない） */
function upgradeOldRecordsPreview() {
  return QloveBot.botUpgradeOldRecords(env_(), true);
}

/**
 * 前の形の記録を、いまの形に書きかえる（型の行・移動の位置を 1km に丸めて地名・codeing → coding・列のずれ）。
 * もとにはもどせないので、実行する前にシートの控え（ファイル → コピーを作成）を取っておく。1回に200行まで（のこりは、もう一度実行）
 */
function upgradeOldRecords() {
  return QloveBot.botUpgradeOldRecords(env_(), false);
}

/** GitHub に入っていない持ち主の記録（ここ30日。fromYmd を渡せばその日から）が何件あるかを見るだけ */
function backfillGithubPreview(fromYmd) {
  return QloveBot.botLogBackfill(env_(), true, fromYmd);
}

/** 上の記録を GitHub に入れなおす（同じ記録は2回入らないので、何度実行してもよい） */
function backfillGithub(fromYmd) {
  return QloveBot.botLogBackfill(env_(), false, fromYmd);
}
