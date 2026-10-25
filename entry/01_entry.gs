/**
 * くらぶボット（仮）の配布用シート：ボットから呼ばれる入口（人は実行しない）
 *   doPost         … LINE の Webhook と、くらぶのツールからの呼び出し（ウェブアプリの URL）
 *   doGet          … ウェブアプリの URL を開いたとき（名前と版だけ）
 *   hourlyQloveBot … 1時間おきの見張り（setupBot が作るトリガーから）
 * 名前を変えると、LINE・トリガーから呼べなくなるので変えない。人が実行する関数は 00_setup.gs
 */

/** ライブラリに渡す、この GAS（配布用シートのコピー）のもの。ライブラリの中で呼ぶと、ライブラリ自身のものになるため */
function env_() {
  return {
    props: PropertiesService.getScriptProperties(),
    cache: CacheService.getScriptCache(),
    lock: LockService.getScriptLock(),
    book: SpreadsheetApp.getActiveSpreadsheet(),
    getUrl: () => ScriptApp.getService().getUrl()
  };
}

/** LINE の Webhook と、ツールからの呼び出しを受ける。いつも同じ形の返事（中身・エラーは返さない） */
// qcheck-ok: G3 だれが呼べるかはライブラリが決める（LINE は ?key= の合言葉、ツールは LINE に確かめた本人だけ。lib/01_router.gs・03_tool_api.gs）
function doPost(e) {
  return QloveBot.botWebhook(env_(), e);
}

/** ウェブアプリの URL を開いたとき：ボットの名前と版だけを返す */
function doGet(e) {
  return QloveBot.botGet(env_(), e);
}

/** 1時間おきの見張り（トリガー）：機能ごとの決めた時間の知らせを送る */
function hourlyQloveBot() {
  QloveBot.botHourly(env_());
}
