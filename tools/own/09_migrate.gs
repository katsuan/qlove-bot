/**
 * 09_migrate.gs：持ち主のボットだけに入れる、引っこしの関数（前の LOgBOT・食事記録ボットから写した記録を、いまの形にする）
 * 配布用シートには入れない（tools/publish.sh own が、入口の 00_setup.gs・01_entry.gs といっしょに送る）。
 * 引っこしが済んだら、このファイルごと消す（ライブラリの botUpgradeOldRecords・botLogMoveOldRecords も消す）
 * 使い方：upgradeOldRecordsPreview で数を見る → シートの控え（ファイル → コピーを作成）を取る → upgradeOldRecords（のこりがあれば、もう一度）
 */

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
