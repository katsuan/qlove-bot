# 🧩 くらぶボット（仮）

くらぶ（Qlove）のツール共通の LINE ボット。使う人は配布用シートをコピーして、自分の LINE 公式アカウントでボットを1つだけ持つ。くらぶのどのツールも、その1つの GAS の URL につなぐ。いまの機能は ☁️ 天気（そらくる）。あとで 🎉 記念日（くろのす）・🌱 節目（すくすく）・🧳 旅（ゆくさき）、さらにあとで LOgBOT と食事記録の配布版も、機能として足す。KazoQ（家族用のボット）は別のまま。

確かめ中（ユーザーが確かめるまで、そらくるの画面のたたみ欄・ポートフォリオには出さない）。手順書：https://katsuan.github.io/qlove-bot/docs/setup.html （noindex）

名前は仮。英字・アイコンは決めていない（案：Qlove Bot・くらぶBOT。アイコンは Qlove のアイコンにベルを添える、など）。

## 作り

```
配布用シート（使う人のコピー）            ライブラリ QloveBot（版つき・このリポジトリの lib/）
  entry/entry.gs（入口だけ）  ── env ─→   受け口（04_router.gs）
    doPost / doGet / hourlyQloveBot         ├ LINE の Webhook（?key=）→ 文字・postback・位置情報を機能へ
    setupBot・showWebhookUrl・adoptOwner     ├ ツールからの呼び出し（{ app: "qlove", tool, action }）（05_tool_api.gs）
    setupRichMenu・checkBot                 └ 機能（50_weather.gs ほか。registerModule_ で足す）
```

- **ライブラリ＋入口**（LOgBOT と同じ考え）：中身はライブラリ（版つき）、配布用シートには入口の1ファイルだけ。新しい版を出したとき、使う人がするのは「ライブラリの版を上げて保存」だけ
  - ライブラリの中で PropertiesService・CacheService・LockService・SpreadsheetApp を呼ぶと、ライブラリ自身のものになる。なので入口が自分のもの（スクリプト プロパティ・キャッシュ・ロック・シート・ウェブアプリの URL）を `env` にまとめて渡し、ライブラリはそれだけを使う（`00_config.gs` の `useEnv_`）。トリガーも入口が作る
- **受け口は1つ**（ウェブアプリの URL）：`?key=WEBHOOK_KEY` つきは LINE の Webhook、本文が `{ app: "qlove", v: 1, tool, action, … }` はツールからの呼び出し、それ以外は何もしない
- **LINE の出来事の振り分け**：postback は `m=`（`core` か機能の key）で、その機能へ。位置情報は機能を順番に聞き、受けとった機能が返事する（天気：「📍 地点を足す」を押した人のものだけ）。文字は決まった順：`#持ち主` → `#テスト`（持ち主）→ くらぶの言葉（メニュー）→ 機能の言葉（order 順）→ 1対1 なら案内。グループでは決まった言葉にだけ返す
- **使わない機能は切れる**：シート「機能」の `enabled` を `FALSE`。言葉・ボタン・位置情報・見張り・ツールのどれでも動かなくなる
- **送れる数（月200通）は全部の機能で分け合う**：`push_(to, messages, priority)`。急ぎでない知らせ（`normal`：天気など）は上限の 80%、急ぎ（`high`：持ち主への「使いたい」・当日の知らせなど）は 95% をこえたら止める
- **役割**：システム管理者＝シートをコピーした人（GAS エディタ）、ツール管理者＝持ち主（LINE で「🔑 持ち主の登録」→ 10分以内に `adoptOwner`）、ユーザー＝持ち主が許した人（「🙋 使いたいと伝える」→ 持ち主にクイックリプライの「✅ 許す」）。許していない人には送らない
- **トークの下のメニュー**：タブは2つ（ux.md の H6）。左はいちばん先の機能のツール（そらくるのアイコン＋名前：天気の知らせ・地点を足す・そらくるで見る）、右は Qlove（横長のロゴ：できること・ツールとつなぐ・使う人）。機能ごとにタブを足すと、機能がふえるたびに決まりをこえるので、ふえた機能は「🧩 できること」のカードとクイックリプライに並べる。画像は `assets/richmenu-*.png`（`tools/richmenu.py`）
- **#テスト**（H11）：持ち主の1対1 だけ。機能ごとの見本（機能の `samples()`）・くらぶの見本・自己点検・断られたときの文・季節の絵文字。すべて 🧪・reply だけ・シートに書かない

### ツールが URL を知る・本人の確かめ

- ブラウザ版のツール（LIFF でない。そらくるなど）からボットに入れるとき：`ping` が返すボットの LINE の ID（`line`：@…）で、ボットのトークに決まった形の文を入れて開く（`https://line.me/R/oaMessage/@…/?文`）。送るのは本人なので、ボットは送った人の役割で決める。天気は「📍 地点を足す 35.17,136.88 名古屋」（1対1 だけ）
- ボットからツールへ：天気の一覧の地点を押すと、その地点のそらくるが開く（`?at=…&name=…&from=qlovebot`）

- URL は、Q キットの `shared/qlove-bot.js`（`QloveBotLink`）で、端末に1つだけ残す（localStorage の `qlove:bot`）。katsuan.github.io のツールなら、どれで入れてもほかのツールも読める。LINE の中とブラウザは別の保存場所なので、それぞれで入れる
- ツールの LINE ログイン（LIFF）から見た ID と、使う人のボットから見た ID は別の番号になる。そこで、**はじめに1回だけ「つなぐ番号」でひもづける**：ボットの「🔗 ツールとつなぐ」→ 6けたの番号（10分・1回きり・まちがいは10分に5回まで）→ ツールが LIFF の ID トークンと番号を送る → LINE に確かめて（`/oauth2/v2.1/verify`、くらぶのツールのチャネルあてだけ）、その人をシート「つないだツール」にひもづける（ID は SHA-256）。そのあとの呼び出しも、毎回 ID トークンを確かめる。送られてきた userId は使わない
- **URL に合言葉を入れるやり方は、とらない**：URL はツールの端末に残り、人に渡すこともあるので、合言葉を入れると端末に鍵を残すことになる（docs/security.md の W7）。ブラウザ版（LIFF でない）からは `ping` だけ受ける

## 機能の足し方

`lib/` に `5x_名前.gs` を足し、`registerModule_({ … })` を呼ぶ（持てるものは `00_config.gs` の上）。

- `key`・`emoji`・`name`・`desc`・`order`・`words`・`sheets`
- `menu(event, role)`・`onPostback(event, p, role)`（postback の data は `m=key&a=…`）・`onLocation(event, role)`・`onText(event, text, role)`（決まった形の文。どちらも自分あてでなければ `null`）
- `hourly(now)`（1時間おき）・`tool`（ツールからの `action`）・`samples()`（#テスト）・`richMenu`（いちばん先の機能のとき、左のタブになる）・`onMemberRemoved(userId)`・`checks()`
- 送るのは `push_(to, messages, 'normal' | 'high')`。カードは `bubble_`・`header_`（H2・H10）、文の受けつけに季節の絵文字は `QSeason.decorate`
- テストは `test/` に（`test/helpers.mjs` の `makeBot` で、ライブラリと入口をそのまま動かす）

LOgBOT・食事記録を合流するときも、同じく機能として足す（シート・言葉・ツールの action を持たせる）。

## ファイル

| ファイル | 中身 |
|---|---|
| `lib/00_config.gs` | 決まった値・入口から渡される `env`・機能の登録・役割 |
| `lib/01_sheet.gs` | シート（機能・使う人・つないだツール・動作の記録と、機能のシート）。外の文字は `safeCell` |
| `lib/02_line.gs` | LINE（返事・push・送れる数・入力中）とカードの部品 |
| `lib/03_members.gs` | 持ち主・使う人・ようこそ・できること |
| `lib/04_router.gs` | 受け口と振り分け |
| `lib/05_tool_api.gs` | ツールからの呼び出し・つなぐ番号 |
| `lib/06_test_window.gs` | #テスト |
| `lib/07_richmenu.gs` | トークの下のメニュー（2つのタブ） |
| `lib/08_public.gs` | 入口から呼ぶ関数（`bot*`）と点検 |
| `lib/50_weather.gs` | 機能「☁️ 天気」（KazoQ の天気の知らせから。気圧の目安は、そらくるの `js/meteo.js` と同じ答えかをテストで見る） |
| `lib/90_season.gs` | 季節の絵文字（`q-oqrn/shared/season.js` の写し） |
| `entry/` | 配布用シートの入口（`entry.gs` と manifest。ライブラリの ID と版は、送るときに入れる） |
| `docs/setup.html` | 使う人の手順書（noindex） |
| `assets/` | メニューの画像 |
| `tools/` | `publish.sh`（clasp で送る）・`richmenu.py`・`svg2png.swift`・`clasp/targets.example.json` |
| `test/` | `npm test`（となりの `q-oqrn/tools/qtest/fake-gas.js` と `q-soraqru/js/meteo.js` を読む） |

確かめ方：`npm test` と `node ../q-oqrn/tools/qtest/check-code.mjs .`

## 出すとき（持ち主の Google アカウントでの作業）

1. ライブラリ：Apps Script で新しいプロジェクト「くらぶボット（ライブラリ）」を作る →「プロジェクトの設定」のスクリプト ID を `tools/clasp/targets.json` の `lib` に。共有は「リンクを知っている全員」が「閲覧者」（コピーした人がライブラリを読めるように）
2. 配布用シート：Google スプレッドシートを新しく作る（「くらぶボット（配布用）」）→「拡張機能」→「Apps Script」→ スクリプト ID を `targets.json` の `dist` に
3. `tools/publish.sh all`（ライブラリを送って版を作り、配布用シートの入口をその版につなぐ。テストが通り、コミットずみのときだけ）
4. 配布用シートの共有を「リンクを知っている全員」が「閲覧者」に。コピーのリンク（`…/copy`）を `docs/setup.html` の `COPY_URL` に入れる
5. 配布用シートのスクリプト プロパティ・シートの中身は空のまま（鍵が渡らないように）
6. 新しい版：`tools/publish.sh lib` → 使う人は「ライブラリ」の版を上げる（入口を変えたときだけ `dist` も）
