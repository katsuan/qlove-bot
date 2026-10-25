/**
 * 60_log_backfill.gs：機能「📝 記録」のGitHub への入れなおし（LOgBOT の 06_github/github_backfill.gs から）
 * 中身：シートにあって GitHub にない記録を、その日の jsonl に足す
 * 呼ばれる（LOgBOT のときのファイル名）：入口の GAS の backfillGithub（backfillGithubForUser）
 *
 * シートにはあるのに GitHub に入っていない記録を、あとから入れなおす
 *
 * - 入口の GAS エディタで backfillGithubPreview → backfillGithub の順に実行する（入口が持ち主の ID を渡す）
 * - 同じ記録 ID がその日の jsonl にあれば入れない（何度実行してもよい）
 * - LINE の ID と位置は書かない（toGithubLog_）。同じ日のファイルはロックして書く
 * - コミットの日時は記録した日時にする（草が元の日に付く）
 */

const LOG_BACKFILL_MAX_ = 100; // 1回で入れる上限

/**
 * @param {string} userId 持ち主の LINE の ID
 * @param {string} fromYmd この日から（yyyy-MM-dd、日本時間）
 * @param {{dryRun?: boolean, now?: Date}=} options dryRun: 数えるだけで書かない
 * @return {{ok: boolean, added: number, skipped: number, days: Object<string, number>, message: string}}
 */
function logBackfillGithubForUser_(userId, fromYmd, options) {
  const opts = options || {};
  const uid = String(userId || '').trim();
  if (!uid) return { ok: false, added: 0, skipped: 0, days: {}, message: '持ち主の ID がない（入口の user_id）' };
  const from = new Date(`${fromYmd}T00:00:00+09:00`);
  if (isNaN(from.getTime())) return { ok: false, added: 0, skipped: 0, days: {}, message: '日付の形がちがう（yyyy-MM-dd）' };
  const { token, owner, repo } = logGetGithubConfig_();
  if (!token || !owner || !repo) return { ok: false, added: 0, skipped: 0, days: {}, message: 'GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO のどれかがない' };

  const until = opts.now instanceof Date ? opts.now : new Date();
  const logs = logGetLogs_()
    .filter(log => String(log.userId || '') === uid)
    .filter(log => String(log.ID || '').trim())
    .filter(log => log.date >= from && log.date <= until)
    .sort((a, b) => a.date - b.date);

  // 日ごとにまとめ、その日の jsonl にない ID だけ残す
  const byDay = {};
  logs.forEach(log => {
    const ymd = logFormatJST_(log.date, 'yyyy-MM-dd');
    (byDay[ymd] = byDay[ymd] || []).push(log);
  });

  const identity = opts.dryRun ? null : logFetchGithubCommitIdentity_(token);
  const days = {};
  let added = 0;
  let skipped = 0;
  Object.keys(byDay).sort().forEach(ymd => {
    const apiUrl = logBuildGithubContentsUrl_(owner, repo, logBuildLogPath_(byDay[ymd][0].date));
    const existingIds = logReadJsonlIds_(logFetchExistingContent_(apiUrl, token).content);
    byDay[ymd].forEach(log => {
      const id = String(log.ID);
      if (existingIds[id]) { skipped += 1; return; }
      if (added >= LOG_BACKFILL_MAX_) { skipped += 1; return; }
      // ロックの中で読みなおして、そのあいだに入っていれば足さない
      if (!opts.dryRun && !logWriteLogToGithub_(log, { token, owner, repo }, 'ensure', identity)) { skipped += 1; return; }
      existingIds[id] = true;
      added += 1;
      days[ymd] = (days[ymd] || 0) + 1;
    });
  });

  const dayText = Object.keys(days).map(d => `${d}: ${days[d]}件`).join(' / ') || 'なし';
  const message = `${opts.dryRun ? '入れる予定' : '入れた'} ${added}件（入っていた・上限で入れない ${skipped}件）${dayText}`
    + (!opts.dryRun && added && !identity ? '（コミットの日時は今日になりました）' : '');
  return { ok: true, added, skipped, days, message };
}

/** GitHub への入れなおし（入口の backfillGithubPreview・backfillGithub から）。持ち主の記録の、fromYmd（なければ30日前）からの分。dryRun なら数えるだけ */
function logRunBackfill_(dryRun, fromYmd) {
  const owner = ownerUserId_();
  if (!owner) {
    console.log('❌ 持ち主がまだです（LINE で「🔑 持ち主の登録」→ adoptOwner）');
    return false;
  }
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(fromYmd || '')) ? String(fromYmd) : logFormatJST_(new Date(Date.now() - 30 * LOG_DAY_MS), 'yyyy-MM-dd');
  const result = logBackfillGithubForUser_(owner, from, { dryRun: dryRun });
  console.log(`${result.ok ? '✅' : '❌'} ${from} から：${result.message}`);
  return result.ok;
}

