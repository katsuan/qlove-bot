/**
 * 60_log_config.gs：機能「📝 記録」の設定（LOgBOT の 02_config.gs から）
 * 中身：logGetAppConfig_（シートの名前・草のページ・LINE の送り主）・GitHub の鍵の読み方
 * シートは、くらぶボットのシート（book_）。鍵（GITHUB_TOKEN・GITHUB_OWNER・GITHUB_REPO・GRASS_URL・ALFRED_SECRET）は、くらぶボットの入口のスクリプト プロパティ
 * 前の LOgBOT の持ち主だけの画面（DASHBOARD_URL）・SPREADSHEET_ID・持ち主の本番の決まった値は、やめた
 * 呼ばれるところ：記録の機能のほぼすべてのファイル
 */

/** Script Properties の文字を読む（前後の空白をとる。なければ ''） */
function logGetConfigProperty_(key) {
  return String(props_().getProperty(key) || '').trim();
}

/** 草のページの URL：GRASS_URL → https://github.com/<GITHUB_OWNER>（なければ ''） */
function logResolveGrassUrl_() {
  const own = logGetConfigProperty_('GRASS_URL');
  if (own) return own;
  const owner = logGetConfigProperty_('GITHUB_OWNER');
  return owner ? `https://github.com/${owner}` : '';
}

// シート（タブ）の名前。LOgBOT の users は、しょくじの meal_users と見分けるため log_users
const LOG_SHEET_ = { logs: 'logs', users: 'log_users', aliases: 'action_aliases', actions: 'log_actions' };

/** LINE の送り主のアイコン（文字のアイコンの画像 URL。60_log_sender.gs） */
function logSenderIcon_(text, options) {
  return logCreateLineSenderIcon_(text, options);
}

/** アプリ全体の設定（シート・URL・LINE の送り主）を返す。人ごとにちがう値は Script Properties から */
function logGetAppConfig_() {
  return {
    // ===== シート（くらぶボットのシートのタブ。LOgBOT のタブを写すときは、この名前に） =====
    logSheetName: LOG_SHEET_.logs, // 記録
    userSheetName: LOG_SHEET_.users, // 記録した人（LOgBOT の users）

    // ===== GitHub =====
    // トークン情報はスクリプトプロパティにて管理
    // GITHUB_TOKEN | GITHUB_OWNER | GITHUB_REPO
    github: {
      grassUrl: logResolveGrassUrl_(), // GitHub 草ページ URL（GRASS_URL か GITHUB_OWNER から）
    },

    // ===== LINE =====
    line: {
      // メッセージ送信者の表示切替（LINE sender）
      // name, iconUrl の両方を設定したときだけ有効
      senders: {
        default: {
          name: '草ログ',
          iconUrl: logSenderIcon_('草', { bgColor: '49cf27', textColor: 'ffffff', textSize: 100 }),
        },
        activity: {
          name: '草ログ',
          iconUrl: logSenderIcon_('草', { bgColor: '49cf27', textColor: 'ffffff', textSize: 100 }),
        },
        start: {
          name: '開始',
          iconUrl: logSenderIcon_('始', { bgColor: '3578e5', textColor: 'ffffff', textSize: 100 }),
        },
        end: {
          name: '完了',
          iconUrl: logSenderIcon_('終', { bgColor: '2e9b3f', textColor: 'ffffff', textSize: 100 }),
        },
        error: {
          name: 'おしらせ',
          iconUrl: logSenderIcon_('🚨', { bgColor: 'ffb300', textColor: '1b2438', textSize: 95 }),
        },
      },
    },
  };
}


/* =====================================================
 * Configs
 * ===================================================== */
/**
 * GitHub接続設定を取得する
 *
 * - Script Properties から取得
 * - commitLogToGithub_ 等から利用
 *
 * @return {{
 *   token: string,
 *   owner: string,
 *   repo: string
 * }}
 */
function logGetGithubConfig_() {
  const props = props_();
  return {
    token: props.getProperty('GITHUB_TOKEN'),
    owner: props.getProperty('GITHUB_OWNER'),
    repo: props.getProperty('GITHUB_REPO')
  };
}
