/**
 * くらぶボット（仮）の入口。配布用シートには、このファイルだけを入れる（中身はライブラリ QloveBot）。
 * 上の「実行する関数を選ぶ」から選んで ▶ 実行。結果は下の「実行ログ」に出ます。
 *
 *   setupBot        … はじめに1回：シート・Webhook の合言葉・1時間おきの見張り（トリガー）を用意する
 *   showWebhookUrl  … デプロイしたあと：LINE に入れる Webhook の URL と、ツールに入れる URL を出す
 *   adoptOwner      … LINE で「🔑 持ち主の登録」を押してから10分以内：押した人を持ち主にする
 *   setupRichMenu   … トークの下のメニューを作る
 *   checkBot        … 準備ができているかを見る（何も書きかえない・送らない）
 *
 * 新しい版にするとき：左の「ライブラリ」の QloveBot → 版をいちばん新しいものに →「保存」（このファイルは変えなくてよい）
 * くわしい手順：https://katsuan.github.io/qlove-bot/docs/setup.html
 */

// ライブラリに渡す、この GAS（配布用シートのコピー）のもの。ライブラリの中で呼ぶと、ライブラリ自身のものになるため
function env_() {
  return {
    props: PropertiesService.getScriptProperties(),
    cache: CacheService.getScriptCache(),
    lock: LockService.getScriptLock(),
    book: SpreadsheetApp.getActiveSpreadsheet(),
    getUrl: () => ScriptApp.getService().getUrl()
  };
}

// qcheck-ok: G3 だれが呼べるかはライブラリが決める（LINE は ?key= の合言葉、ツールは LINE に確かめた本人だけ。lib/04_router.gs・05_tool_api.gs）
function doPost(e) {
  return QloveBot.botWebhook(env_(), e);
}

function doGet(e) {
  return QloveBot.botGet(env_(), e);
}

function hourlyQloveBot() {
  QloveBot.botHourly(env_());
}

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

function showWebhookUrl() {
  return QloveBot.botWebhookUrl(env_());
}

function adoptOwner() {
  return QloveBot.botAdoptOwner(env_());
}

function setupRichMenu() {
  return QloveBot.botSetupRichMenu(env_());
}

function checkBot() {
  const env = env_();
  env.triggers = ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction());
  return QloveBot.botCheck(env);
}
