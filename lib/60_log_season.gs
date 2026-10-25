/**
 * 60_log_season.gs：機能「📝 記録」の季節の絵文字を付ける（LOgBOT の 04_line/season_use.gs から）
 * 中身：うれしい文に、ときどき季節の絵文字（season.gs の QSeason）
 * 呼ばれる（LOgBOT のときのファイル名）：返事を作るファイル・入口（seasonalText）
 *
 * 季節の絵文字（season.gs の QSeason）を、LINE の返事のうれしい文にだけ、ときどき付ける
 *
 * - 付けるのは「記録しました」「いってらっしゃい」「ぜんぶできた」などの短い文（Flex は altText に1つまで）
 * - 付けない：エラー・注意・確認の文、連携状態、ボタンやラベル、シートや GitHub に書くもの、URL、コマンドの例
 * - season.gs は q-oqrn/shared/season.js をそのまま写したもの（直すときは q-oqrn 側を直して写しなおす）
 */

/** うれしい文に、ときどき季節の絵文字を付ける（失敗しても文はそのまま） */
function logSeasonal_(text) {
  try {
    return QSeason.decorate(String(text));
  } catch (e) {
    return text;
  }
}

/** 入口の GAS から使う（ライブラリの関数として公開） */
function logSeasonalText_(text) {
  return logSeasonal_(text);
}
