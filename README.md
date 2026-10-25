# 🧩 くらぶボット（仮）

くらぶ（Qlove）のツール共通の LINE ボット。使う人は配布用シートをコピーして、自分の LINE 公式アカウントでボットを1つだけ持つ。くらぶのどのツールも、その1つの GAS の URL につなぐ。いまの機能は ☁️ 天気（そらくる）。あとで 🎉 記念日（くろのす）・🌱 節目（すくすく）・🧳 旅（ゆくさき）、さらにあとで LOgBOT と食事記録の配布版も、機能として足す。KazoQ（家族用のボット）は別のまま。

確かめ中（ユーザーが確かめるまで、そらくるの画面のたたみ欄・ポートフォリオには出さない）。手順書：https://katsuan.github.io/qlove-bot/docs/setup.html （noindex）

名前は仮。英字・アイコンは決めていない（案：Qlove Bot・くらぶBOT。アイコンは Qlove のアイコンにベルを添える、など）。

## 作り

```
配布用シート（使う人のコピー）            ライブラリ QloveBot（版つき・このリポジトリの lib/）
  entry/（入口だけ）        ── env ─→   受け口（01_router.gs）
    doPost / doGet / hourlyQloveBot         ├ LINE の Webhook（?key=）→ 文字・postback・位置情報を機能へ
    setupBot・showWebhookUrl・adoptOwner     ├ ツールからの呼び出し（{ app: "qlove", tool, action }）（03_tool_api.gs）
    setupRichMenu・checkBot                 └ 機能（50_weather.gs ほか。registerModule_ で足す）
```

- **ライブラリ＋入口**（LOgBOT と同じ考え）：中身はライブラリ（版つき）、配布用シートには入口の1ファイルだけ。新しい版を出したとき、使う人がするのは「ライブラリの版を上げて保存」だけ
  - ライブラリの中で PropertiesService・CacheService・LockService・SpreadsheetApp を呼ぶと、ライブラリ自身のものになる。なので入口が自分のもの（スクリプト プロパティ・キャッシュ・ロック・シート・ウェブアプリの URL）を `env` にまとめて渡し、ライブラリはそれだけを使う（`02_config.gs` の `useEnv_`）。トリガーも入口が作る
- **受け口は1つ**（ウェブアプリの URL）：`?key=WEBHOOK_KEY` つきは LINE の Webhook、本文が `{ app: "qlove", v: 1, tool, action, … }` はツールからの呼び出し、それ以外は何もしない
- **LINE の出来事の振り分け**：postback は `m=`（`core` か機能の key）で、その機能へ。位置情報は機能を順番に聞き、受けとった機能が返事する（天気：「📍 地点を足す」を押した人のものだけ）。文字は決まった順：`#持ち主` → `#テスト`（持ち主）→ くらぶの言葉（メニュー）→ 機能の言葉（order 順）→ 1対1 なら案内。グループでは決まった言葉にだけ返す
- **使わない機能は切れる**：シート「機能」の `enabled` を `FALSE`。言葉・ボタン・位置情報・見張り・ツールのどれでも動かなくなる
- **送れる数（月200通）は全部の機能で分け合う**：`push_(to, messages, priority)`。急ぎでない知らせ（`normal`：天気など）は上限の 80%、急ぎ（`high`：持ち主への「使いたい」・当日の知らせなど）は 95% をこえたら止める
- **役割**：システム管理者＝シートをコピーした人（GAS エディタ）、ツール管理者＝持ち主（LINE で「🔑 持ち主の登録」→ 10分以内に `adoptOwner`）、ユーザー＝持ち主が許した人（「🙋 使いたいと伝える」→ 持ち主にクイックリプライの「✅ 許す」）。許していない人には送らない
- **トークの下のメニュー**：タブは2つ（ux.md の H6）。左はいちばん先の機能のツール（`richMenu.rank` がいちばん小さく画像があるもの。今はしょくじのアイコン＋名前：朝・昼・夜・間食・きょうの集計・一覧）、右は Qlove（横長のロゴ：天気の知らせ・記録・できること・使う人。ほかの機能の入口の組み合わせの絵がないときは、できること・ツールとつなぐ・使う人）。しょくじを切ると、左はそらくる（天気の知らせ・地点を足す・そらくるで見る）にもどる。機能ごとにタブを足すと、機能がふえるたびに決まりをこえるので、ふえた機能は「🧩 できること」のカードとクイックリプライに並べる。画像は `assets/richmenu-*.png`（`tools/richmenu.py`）
- **入力中…**（ux.md の H1。KazoQ と同じ形）：1対1 のトークで、ボタン（postback）・位置情報・機能の言葉・メニュー・決まった形の文（機能の `textPattern`）・持ち主の #テスト を受けたら、返事を作る前に「入力中…」（60秒。返事を送ると消える）。メニューのタブの切りかえ（返事をしない）・グループ・ふつうの案内では出さない。出せなくても返事は止めない（動作の記録に残す）
- **カードのボタン**（ux.md の H2）：押されるたびにボットがいまの状態を見て返す postback なら、1回きりの操作もカードに置く。data に何に対する操作か（地点の ID・人の ID）を入れ、もう済んだ・古い・ほかの人を見分けて、やさしく返す（天気の一覧の「⚙️ 変える」・使う人の「🚫 やめさせる」・持ち主に届く「🙋 使いたい」の「✅ 許す」「やめておく」）。クイックリプライにも同じものを出す。位置情報を送る、のように LINE の決まりでクイックリプライにしか置けないものは、クイックリプライだけ
- **#テスト**（H11）：持ち主の1対1 だけ。機能ごとの見本（機能の `samples()`）・くらぶの見本・自己点検・断られたときの文・季節の絵文字。すべて 🧪・reply だけ・シートに書かない

### ツールが URL を知る・本人の確かめ

- ブラウザ版のツール（LIFF でない。そらくるなど）からボットに入れるとき：`ping` が返すボットの LINE の ID（`line`：@…）で、ボットのトークに決まった形の文を入れて開く（`https://line.me/R/oaMessage/@…/?文`）。送るのは本人なので、ボットは送った人の役割で決める。天気は「📍 地点を足す 35.17,136.88 名古屋」（1対1 だけ）
- ボットからツールへ：天気の一覧の地点を押すと、その地点のそらくるが開く（`?at=…&name=…&from=qlovebot`）

- URL は、Q キットの `shared/qlove-bot.js`（`QloveBotLink`）で、端末に1つだけ残す（localStorage の `qlove:bot`）。katsuan.github.io のツールなら、どれで入れてもほかのツールも読める。LINE の中とブラウザは別の保存場所なので、それぞれで入れる
- ツールの LINE ログイン（LIFF）から見た ID と、使う人のボットから見た ID は別の番号になる。そこで、**はじめに1回だけ「つなぐ番号」でひもづける**：ボットの「🔗 ツールとつなぐ」→ 6けたの番号（10分・1回きり・まちがいは10分に5回まで）→ ツールが LIFF の ID トークンと番号を送る → LINE に確かめて（`/oauth2/v2.1/verify`、くらぶのツールのチャネルあてだけ）、その人をシート「つないだツール」にひもづける（ID は SHA-256）。そのあとの呼び出しも、毎回 ID トークンを確かめる。送られてきた userId は使わない
- **URL に合言葉を入れるやり方は、とらない**：URL はツールの端末に残り、人に渡すこともあるので、合言葉を入れると端末に鍵を残すことになる（docs/security.md の W7）。ブラウザ版（LIFF でない）からは `ping` だけ受ける

## 機能の足し方

ファイルの名前（`q-oqrn/docs/structure.md` の GAS の決まり：「番号＋役わり」）：

- 入口（配布用シート）も同じ：`entry/00_setup.gs`（人が実行する関数。いちばん上に実行の順番）・`entry/01_entry.gs`（`doPost`・`doGet`・見張りのトリガー）
- コメント：ファイルの先頭に「何のためか・中に何があるか・どこから呼ばれるか」、関数の前に「何をするか（と返すもの）」。中で使うだけの関数は名前の最後に `_`（GAS の「実行」の一覧に出ない）
- 名前を変えないもの：入口の関数（`checkBot`・`setupBot`・`showWebhookUrl`・`adoptOwner`・`setupRichMenu`・`doPost`・`doGet`・`hourlyQloveBot`）と、入口から呼ぶライブラリの関数（`bot*`）。もうコピーした人のボットとトリガーが、この名前で呼ぶため

| 番号 | 中身 |
|---|---|
| `00`〜`09` | くらぶボット共通。人が実行する・よく見るものを上に：`00` 入口から呼ぶ関数（人が実行する関数の中身）・`01` 受け口（ボットから呼ばれる入口）・`02` 設定・`03` ツールの呼び出し・`04` 役割・`05` LINE・`06` シート・`07` #テスト・`08` メニュー |
| `50`〜`59` | くらぶのツールの機能：`50` ☁️ 天気（そらくる）・`51` 🎉 記念日（くろのす）・`52` 🌱 節目（すくすく）・`53` 🧳 旅（ゆくさき） |
| `60`〜`69` | 合流したボット：`60` 📝 記録（LOgBOT）・`61` 🍚 しょくじ（食事記録ボット）。前のファイルを写し、名前に `log`・`meal` を付けて、くらぶボットの名前とぶつからないようにした |
| `season.gs` | 共通の部品（季節の絵文字の写し。番号を付けない） |

- 1つの機能は `NN_key.gs`（決まった値と登録）に、大きくなったら役わりごとに `NN_key_forecast.gs`・`NN_key_places.gs`・`NN_key_cards.gs`・`NN_key_hourly.gs` のように分ける（`key` は機能の key と同じ小文字の英語）
- 登録は `registerModule_(() => ({ … }))`（中身を作る関数で渡す）。GAS はファイルを名前の順に読むので、ぜんぶ読み終わってから組み立てる（`02_config.gs` の `modulesReady_`）。どのファイルの関数も使える
- 決まった値（`WEATHER_` など）は `NN_key.gs` に。関数・決まった値の名前は `key` ではじめる（`weatherNotices_`・`WEATHER_RULES_`）。もとのツールから写したもの（そらくるの目安の `soraqruLevelOf_` など）は、そのツールの名前ではじめる。ほかの機能の関数は呼ばない（共通のものは `0x` に）

持てるもの：

- `key`・`emoji`・`name`・`desc`・`order`・`words`・`sheets`
- `menu(event, role)`・`onPostback(event, p, role)`（postback の data は `m=key&a=…`）・`onLocation(event, role)`・`onText(event, text, role)`（決まった形の文。どちらも自分あてでなければ `null`）
- `hourly(now)`（1時間おき）・`tool`（ツールからの `action`）・`samples()`（#テスト）・`richMenu`（いちばん先の機能のとき、左のタブになる）・`onMemberRemoved(userId)`・`checks()`
- 送るのは `push_(to, messages, 'normal' | 'high')`。カードは `bubble_`・`header_`（H2・H10）、文の受けつけに季節の絵文字は `QSeason.decorate`
- テストは `test/` に（`test/helpers.mjs` の `makeBot` で、ライブラリと入口をそのまま動かす）

LOgBOT・食事記録ボットは、こうして機能として合流させた（2026-10-25）：

- 文字の受けとり順：天気（📍 の文）→ 📝 記録（`#` ではじまる文・`+15`）→ 🍚 しょくじ（ほかの文はぜんぶ食事の名前。`order` 90 で最後）
- ツールの名前：つづくは `tool: "tuzuq"`、しょくじは `tool: "shoquji"`（機能の `toolKeys`）。しょくじの LIFF（`2012187502-BVvVhWZM`。つづくと同じ Q のチャネル。前の `2010088825` も受ける）
- 前の決まりから変えたもの：使える人・持ち主はくらぶボットの「使う人」と持ち主に（前の承認・管理者・つづくの持ち主の登録はやめた）。`#テスト` はくらぶボット共通に。Alfred は `{ sourceApp: "alfred" }` を機能の `webhook` で受ける
- やめたもの：LOgBOT の持ち主だけの画面・クエストの週の設定の画面・`# alfred report`・todo・`# users`、食事記録の前の画面用の action（`getHeaderState`・`searchNutritionMaster`・`setupMainRichMenu`）と人ごとの「⚡ よく記録」のメニュー
- シート：`meal_users`（食事記録の users）・`meal_logs`・`nutrition_master`・`logs`・`log_users`（LOgBOT の users）・`action_aliases`・`log_actions`（記録の種類ごとの決まり。前は LOgBOT のコードに書いてあった）
- テスト：前のテストを写したもの（`test/meal-*.test.mjs`・`test/log-*.test.mjs`。道具は `meal-helpers.mjs`・`log-helpers.mjs`）

## ファイル

| ファイル | 中身 |
|---|---|
| `lib/00_public.gs` | 入口から呼ぶ関数（`bot*`。人が実行する関数の中身を、よく使う順に）と点検 |
| `lib/01_router.gs` | 受け口と振り分け（ボットから呼ばれる入口の中身） |
| `lib/02_config.gs` | 決まった値・入口から渡される `env`・機能の登録・役割 |
| `lib/03_tool_api.gs` | ツールからの呼び出し・つなぐ番号 |
| `lib/04_members.gs` | 持ち主・使う人・ようこそ・できること |
| `lib/05_line.gs` | LINE（返事・push・送れる数・入力中）とカードの部品 |
| `lib/06_sheet.gs` | シート（機能・使う人・つないだツール・動作の記録と、機能のシート）。外の文字は `safeCell_` |
| `lib/07_test_window.gs` | #テスト |
| `lib/08_richmenu.gs` | トークの下のメニュー（2つのタブ） |
| `lib/50_weather.gs` | 機能「☁️ 天気」の決まった値と登録（KazoQ の天気の知らせから） |
| `lib/50_weather_forecast.gs` | 天気：予報を読む・知らせることを決める・地名（気圧の目安は、そらくるの `js/meteo.js` と同じ答えかをテストで見る） |
| `lib/50_weather_places.gs` | 天気：地点（シート「天気の地点」）と返事（地点を足す・時間・やめる） |
| `lib/50_weather_cards.gs` | 天気：カード（知らせ・一覧）と #テスト の見本 |
| `lib/50_weather_hourly.gs` | 天気：見張り（1時間おき） |
| `lib/60_log*.gs` | 機能「📝 記録」（LOgBOT から。中身は `lib/60_log.gs` の先頭） |
| `lib/61_meal*.gs` | 機能「🍚 しょくじ」（食事記録ボットから。中身は `lib/61_meal.gs` の先頭） |
| `lib/season.gs` | 季節の絵文字（`q-oqrn/shared/season.js` とまったく同じ中身。テストで確かめる） |
| `entry/` | 配布用シートの入口（`00_setup.gs`＝人が実行する関数・`01_entry.gs`＝doPost とトリガー・manifest。ライブラリの ID と版は、送るときに入れる） |
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
