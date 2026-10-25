/**
 * 60_log_github.gs：機能「📝 記録」のGitHub に書く（LOgBOT の 06_github/github.gs から）
 * 中身：その日の jsonl に足す・書きかえる（writeLogToGithub_）・書き先・LINE の ID と位置を外す
 * 呼ばれる（LOgBOT のときのファイル名）：記録するとき・時間を足したとき・入れなおし・つづく
 *
 * 草ログを GitHub リポジトリに JSONL 形式で保存する
 *
 * - logs/yyyy-MM-dd.jsonl に 1 行 1 ログで追記
 * - GitHub Contents API を利用
 * - UTF-8（日本語対応）
 */

/**
 * ログオブジェクトを GitHub リポジトリに JSONL 形式でコミットする
 *
 * @param {{
 *   action: string,
 *   minutes: number,
 *   detail: string,
 *   source?: string,
 *   date?: Date
 * }} logObj
 * @param {{token: string, owner: string, repo: string}=} target 書き先（なければ持ち主の書き先）
 */
function logCommitLogToGithub_(logObj, target) {
  logWriteLogToGithub_(logObj, target, 'append');
}

/** 同じ ID の行があれば書きかえ、なければ足す */
function logUpsertLogToGithub_(logObj, target) {
  logWriteLogToGithub_(logObj, target, 'upsert');
}

/**
 * その日の jsonl を書きかえて GitHub に送る（GitHub に書くところは、すべてここを通る）
 * - ロックの中で読みなおしてから書く（そのあいだに書かれた行を消さない）
 * - LINE の ID と位置は書かない（toGithubLog_）
 *
 * @param {Object} logObj
 * @param {{token: string, owner: string, repo: string}=} target 書き先（なければ持ち主の書き先）
 * @param {'append'|'upsert'|'ensure'} mode ensure：同じ ID がもうあれば何もしない
 * @param {{name: string, email: string}=} identity あれば、コミットの日時を記録の日時にする（草がその日に付く）
 * @return {boolean} 送ったか
 */
function logWriteLogToGithub_(logObj, target, mode, identity) {
  if (!logActionSendsGithub_(logObj)) return false; // シート「log_actions」で GitHub に送らないと決めた行動
  const { token, owner, repo } = target || logGetGithubConfig_();
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  const log = logToGithubLog_(logNormalizeLog_(logObj));
  const apiUrl = logBuildGithubContentsUrl_(owner, repo, logBuildLogPath_(log.date));
  return logWithGithubLock_(() => {
    const { sha, content } = logFetchExistingContent_(apiUrl, token);
    if (mode === 'ensure' && logReadJsonlIds_(content)[String(log.ID || '')]) return false;
    const next = mode === 'upsert' ? logUpsertJsonLine_(content, log) : logAppendJsonLine_(content, log);
    const payload = logBuildCommitPayload_(log, next, sha);
    if (identity) {
      const when = log.date.toISOString();
      payload.author = { ...identity, date: when };
      payload.committer = { ...identity, date: when };
    }
    logPutContentToGithub_(apiUrl, token, payload);
    return true;
  });
}

/**
 * その人の記録を、どの GitHub のどのリポジトリに書くか（書かないなら null）
 *
 * - いまは持ち主（入口が canCommitGithub にした人）だけ。書き先は Script Properties の
 *   GITHUB_TOKEN / GITHUB_OWNER / GITHUB_REPO（システム管理者が入れる）
 * - ほかの人の GitHub にもつなぐときは、ここで人ごとの書き先を返す（鍵の預かり方は決めてから）。
 *   GitHub に書くところは、すべてここを通す
 * @param {{canCommitGithub?: boolean}} policy
 * @return {{token: string, owner: string, repo: string}|null}
 */
function logResolveGithubTarget_(policy) {
  if (!policy || !policy.canCommitGithub) return null;
  const cfg = logGetGithubConfig_();
  if (!cfg.token || !cfg.owner || !cfg.repo) return null;
  return { token: cfg.token, owner: cfg.owner, repo: cfg.repo };
}

/* ==================================================
 * 内部ユーティリティ
 * ================================================== */
/**
 * ログオブジェクトを正規化する
 * - date を必ず Date に
 */
function logNormalizeLog_(logObj) {
  return {
    ...logObj,
    date: logObj.date instanceof Date
      ? logObj.date
      : new Date()
  };
}

/**
 * GitHub に書く形にする
 * - LINE のユーザー ID は書かない
 * - 位置（*_lat / *_lng の行）は書かない（シートにだけ残す）
 */
function logToGithubLog_(log) {
  const detail = String(log.detail == null ? '' : log.detail)
    .split('\n')
    .filter(line => !/^\s*[a-z_]*_(lat|lng)\s*:/i.test(line))
    .join('\n');
  return {
    ID: log.ID || '',
    date: log.date,
    action: log.action,
    minutes: log.minutes,
    detail,
    source: log.source,
  };
}

/**
 * 同じ日のファイルを同時に書きかえない（sha がずれて断られるため）
 */
function logWithGithubLock_(fn) {
  const lock = scriptLock_();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * yyyy-MM-dd.jsonl のパスを生成
 */
function logBuildLogPath_(date) {
  const ymd = logFormatJST_(date, 'yyyy-MM-dd');
  return `logs/${ymd}.jsonl`;
}

/**
 * GitHub Contents API の URL を生成
 */
function logBuildGithubContentsUrl_(owner, repo, path) {
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
}


/**
 * 既存ファイルの内容を取得
 *
 * - 初回は 404 になるため try/catch で吸収
 */
function logFetchExistingContent_(apiUrl, token) {
  try {
    const res = UrlFetchApp.fetch(apiUrl, {
      headers: logGithubHeaders_(token)
    });

    const json = JSON.parse(res.getContentText());
    const content = Utilities
      .newBlob(Utilities.base64Decode(json.content))
      .getDataAsString();

    return {
      sha: json.sha,
      content
    };
  } catch (e) {
    // ファイル未存在（初回）
    return {
      sha: null,
      content: ''
    };
  }
}

/**
 * JSONL として 1 行追記
 */
function logAppendJsonLine_(content, log) {
  return content + JSON.stringify(log) + '\n';
}

/** jsonl の中で、同じ記録 ID の行を書きかえる（なければ足す） */
function logUpsertJsonLine_(content, log) {
  const id = String(log && log.ID || '').trim();
  if (!id) return logAppendJsonLine_(content, log);

  const lines = String(content || '')
    .split('\n')
    .filter(Boolean);

  let replaced = false;
  const nextLines = lines.map(line => {
    try {
      const parsed = JSON.parse(line);
      if (String(parsed && parsed.ID || '') !== id) return line;
      replaced = true;
      return JSON.stringify(log);
    } catch (e) {
      return line;
    }
  });

  if (!replaced) {
    nextLines.push(JSON.stringify(log));
  }
  return nextLines.join('\n') + '\n';
}

/**
 * GitHub commit 用 payload を生成
 */
function logBuildCommitPayload_(log, content, sha) {
  const bytes = Utilities.newBlob(
    content,
    'application/json',
    'logs.jsonl'
  ).getBytes();

  return {
    message: `log: ${log.action}`,
    content: Utilities.base64Encode(bytes),
    sha
  };
}

/**
 * GitHub に PUT で反映
 */
function logPutContentToGithub_(apiUrl, token, payload) {
  UrlFetchApp.fetch(apiUrl, {
    method: 'put',
    headers: logGithubHeaders_(token),
    payload: JSON.stringify(payload)
  });
}

/**
 * GitHub API 共通ヘッダ
 */
function logGithubHeaders_(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
}

/** jsonl の中の記録 ID */
function logReadJsonlIds_(content) {
  const ids = {};
  String(content || '').split('\n').forEach(line => {
    if (!line.trim()) return;
    try {
      const id = String(JSON.parse(line).ID || '');
      if (id) ids[id] = true;
    } catch (e) {
      // 読めない行は飛ばす
    }
  });
  return ids;
}

/**
 * コミットの名前とメール（GitHub の noreply。草が持ち主に付く）
 * 読めなければ null（日時を決めずにコミットする）
 */
function logFetchGithubCommitIdentity_(token) {
  try {
    const res = UrlFetchApp.fetch('https://api.github.com/user', { headers: logGithubHeaders_(token), muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    const me = JSON.parse(res.getContentText());
    if (!me.id || !me.login) return null;
    return { name: String(me.name || me.login), email: `${me.id}+${me.login}@users.noreply.github.com` };
  } catch (e) {
    return null;
  }
}
