/**
 * 60_log_migration.gs：機能「📝 記録」の前のデータの直し（LOgBOT の 03_record/migration.gs から）
 * 中身：言いかえの表の codeing を coding に直す
 * 呼ばれる（LOgBOT のときのファイル名）：00_setup.gs の migrateCodeingToCoding
 */

/** 言いかえの表の行動 codeing を coding に直す */
function logMigrateActionAliasCodeingToCoding_() {
  const sheet = logGetActionAliasSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return;
  for (let r = 1; r < values.length; r += 1) {
    const action = String(values[r][0] || '').trim().toLowerCase();
    if (action !== 'codeing') continue;
    // qcheck-ok: G1 決まった文字だけ
    sheet.getRange(r + 1, 1).setValue('coding');
  }
}

