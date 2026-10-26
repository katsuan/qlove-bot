// 機能「☁️ 天気」のテスト
//   node --test test/
import test from "node:test";
import assert from "node:assert";
import os from "node:os";
import path from "node:path";
import {
  FRIEND, OWNER, STRANGER, addPlace, at, errorsOf, forecastJson, groupSource, jstDay, lastReply, makeBot, press, pushes, quickLabels, response, say,
  sendLocation, textsOf, userSource
} from "./helpers.mjs";

// そらくるの目安（となりの q-soraqru）
const M = await import(path.join(os.homedir(), "GitHub/q-soraqru/js/meteo.js"));

test("気圧の目安は、そらくるの js/meteo.js と同じ答え（段階・時間帯のまとめ・言い方）", () => {
  const gas = makeBot();
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 300; i++) {
    const change = Math.round((rand() * 10 - 5) * 10) / 10;
    assert.equal(gas.call("soraqruLevelOf_", change), M.levelOf(change), String(change));
  }
  for (const bad of [null, undefined, "", "x", NaN]) assert.equal(gas.call("soraqruLevelOf_", bad), M.levelOf(bad));
  assert.deepEqual(JSON.parse(JSON.stringify(gas.eval("SORAQRU_LEVELS_"))), M.LEVELS);
  for (let n = 0; n < 40; n++) {
    const rows = Array.from({ length: 24 }, (_, hour) => {
      const change = rand() < 0.1 ? null : Math.round((rand() * 8 - 4) * 10) / 10;
      return { hour, change, level: M.levelOf(change) };
    });
    const mine = JSON.parse(JSON.stringify(gas.call("soraqruAlertRanges_", rows)));
    assert.deepEqual(mine, M.alertRanges(rows));
    assert.deepEqual(mine.map((r) => gas.call("soraqruRangeText_", r)), M.alertRanges(rows).map(M.rangeText));
  }
});

test("予報の読みこみ：3時間前とくらべる（そらくると同じ値）。壊れた・欠けた返事は null", () => {
  const gas = makeBot();
  const json = forecastJson({ pressure: (di, h) => (di === 1 && h >= 12 ? 1013 - (h - 11) * 1.2 : 1013) });
  const mine = gas.call("weatherParseForecast_", json).days[jstDay(0)];
  const theirs = M.dayRows(M.parseForecast(json, new Date()), 0, new Date());
  assert.deepEqual(mine.map((r) => [r.hour, r.change, r.level]), theirs.map((r) => [r.hour, r.change, r.level]));
  for (const bad of [null, 1, "x", {}, { hourly: null }, { hourly: { time: "x", pressure_msl: [] } }, { hourly: { time: [], pressure_msl: [] } }]) {
    assert.equal(gas.call("weatherParseForecast_", bad), null, JSON.stringify(bad));
  }
});

test("知らせること：雨（6〜21時に60%以上）・気圧（注意から）・気温（前の日より5℃）。何もない日は []", () => {
  const gas = makeBot();
  const today = jstDay(0);
  const evaluate = (o) => JSON.parse(JSON.stringify(gas.call("weatherEvaluate_", gas.call("weatherParseForecast_", forecastJson(o)), today)));
  assert.deepEqual(evaluate({}), []);
  assert.deepEqual(evaluate({ pop: (di, h) => (di === 1 && (h === 5 || h === 22) ? 90 : 10) }), []);
  assert.deepEqual(evaluate({ pop: (di, h) => (di === 1 && h >= 12 && h <= 14 ? 70 : 10) }), [{ kind: "rain", emoji: "☔", title: "雨", lines: ["12〜15時 雨 70%"] }]);
  assert.deepEqual(evaluate({ pressure: (di, h) => (di === 1 && h >= 12 ? 1013 - (h - 11) * 0.5 : 1013) }), []);
  const pressure = evaluate({ pressure: (di, h) => (di === 1 && h >= 12 ? 1013 - (h - 11) * 1.2 : 1013) });
  assert.equal(pressure[0].lines[0], "12〜24時 警戒（下がる）");
  assert.deepEqual(evaluate({ max: [20, 13, 15] }), [{ kind: "temp", emoji: "🥶", title: "気温", lines: ["最高 13℃（前の日より 7℃ 低い）"] }]);
});

test("地点を足す：「📍 地点を足す」を押した人の位置情報だけ。1km に丸める・地名は国土地理院とそらくるの表", () => {
  const gas = makeBot();
  sendLocation(gas, userSource(OWNER), 35.17, 136.88);
  assert.equal(gas.call("weatherNotices_").length, 0);
  const reply = addPlace(gas, userSource(OWNER), 35.17123, 136.88456);
  const [notice] = gas.call("weatherNotices_");
  assert.deepEqual([notice.lat, notice.lon, notice.placeName, notice.notifyHour, notice.targetId], [35.17, 136.88, "名古屋市中村区", 7, OWNER]);
  assert.deepEqual(quickLabels(reply.messages[0]), ["⏰ 6時", "⏰ 7時", "⏰ 8時", "⏰ 21時（明日のぶん）"]);
  addPlace(gas, userSource(OWNER), 35.171, 136.884);
  assert.match(textsOf(lastReply(gas).messages), /もう登録しています/);
  assert.equal(gas.call("weatherNotices_").length, 1);
});

test("知らない人は地点を足せない。1人3か所まで。地名が読めないときは位置情報の題（式にならないように）", () => {
  const gas = makeBot();
  press(gas, userSource(STRANGER), "m=weather&a=add");
  assert.match(textsOf(lastReply(gas).messages), /持ち主の許可が要ります/);
  gas.ctx.UrlFetchApp.fetch = ((orig) => (url, opt) => (url.startsWith("https://mreversegeocoder") ? response(500, "") : orig(url, opt)))(gas.ctx.UrlFetchApp.fetch);
  addPlace(gas, userSource(OWNER), 35.1, 136.1, "=HYPERLINK(\"https://example.com\",\"x\")");
  addPlace(gas, userSource(OWNER), 35.2, 136.2, "職場");
  addPlace(gas, userSource(OWNER), 35.3, 136.3, "");
  // 本物のシートは、書くときに付けた先頭の ' を、読むときに外す（偽物は外さないので、ここで外して比べる）
  const names = gas.call("weatherNotices_").map((n) => n.placeName.replace(/^'/, ""));
  assert.ok(names[0].startsWith("=HYPERLINK("));
  assert.deepEqual(names.slice(1), ["職場", "登録した地点"]);
  assert.deepEqual(gas.formulaCells(), []);
  press(gas, userSource(OWNER), "m=weather&a=add");
  assert.match(textsOf(lastReply(gas).messages), /1人3か所まで/);
});

test("時間をかえる・やめる：選ぶのはクイックリプライ。ほかの人の地点・やめた地点はさわれない", () => {
  const gas = makeBot({ members: [[FRIEND, "ともだち", "allowed", "", ""]] });
  addPlace(gas, groupSource(OWNER), 35.17, 136.88);
  const [notice] = gas.call("weatherNotices_");
  assert.equal(notice.targetType, "group");
  press(gas, groupSource(FRIEND), "m=weather&a=pick&k=time");
  assert.match(textsOf(lastReply(gas).messages), /変えられる地点は/);
  press(gas, groupSource(FRIEND), `m=weather&a=time&id=${notice.noticeId}&h=21`);
  assert.equal(gas.call("weatherNotices_")[0].notifyHour, 7);
  press(gas, groupSource(OWNER), "m=weather&a=pick&k=time");
  assert.deepEqual(quickLabels(lastReply(gas).messages[0]), ["⏰ 名古屋市中村区"]);
  press(gas, groupSource(OWNER), `m=weather&a=time&id=${notice.noticeId}&h=21`);
  assert.equal(gas.call("weatherNotices_")[0].notifyHour, 21);
  press(gas, groupSource(OWNER), `m=weather&a=time&id=${notice.noticeId}&h=13`);
  assert.match(textsOf(lastReply(gas).messages), /えらべません/);
  press(gas, groupSource(OWNER), `m=weather&a=remove&id=${notice.noticeId}`);
  assert.equal(gas.call("weatherNotices_").length, 0);
  press(gas, groupSource(OWNER), `m=weather&a=remove&id=${notice.noticeId}`);
  assert.match(textsOf(lastReply(gas).messages), /もうやめています/);
});

test("決めた時間に、知らせることがある日だけ push。同じ地点は1回だけ聞く。同じ日に2回は送らない", () => {
  const rainy = forecastJson({ pop: (di, h) => (di === 1 && h >= 12 && h <= 14 ? 70 : 10) });
  // 天気の知らせだけを見る（同じ見張りで届く 📝 記録・🍚 しょくじの知らせは切る）
  const gas = makeBot({ forecast: rainy, members: [[FRIEND, "ともだち", "allowed", "", ""]], modulesOff: ["log", "meal"] });
  addPlace(gas, userSource(OWNER), 35.17, 136.88);
  addPlace(gas, userSource(FRIEND), 35.17, 136.88);
  gas.reset();
  assert.equal(gas.call("botHourly", gas.call("env_"), at(6)).weather.checked, 0);
  const result = gas.call("botHourly", gas.call("env_"), at(7)).weather;
  assert.equal(result.sent, 2);
  assert.equal(gas.fetches.filter((f) => f.url.startsWith("https://api.open-meteo.com/")).length, 1);
  assert.deepEqual(pushes(gas).map((p) => p.to).sort(), [FRIEND, OWNER].sort());
  const card = pushes(gas)[0].messages[0];
  assert.equal(card.altText, "☔ 名古屋市中村区：12〜15時 雨 70%");
  assert.deepEqual(errorsOf([card]), []);
  const button = card.contents.footer.contents[0].action;
  assert.equal(button.type, "uri");
  assert.match(button.uri, /^https:\/\/katsuan\.github\.io\/soraqru\/\?at=35\.17,136\.88&name=/);
  assert.match(JSON.stringify(card), /Open-Meteo\.com（CC BY 4\.0）/);
  assert.doesNotMatch(JSON.stringify(card), /頭痛/);
  assert.equal(gas.call("botHourly", gas.call("env_"), at(7)).weather.sent, 0);
});

test("何もない日は送らない。21時は明日のぶん", () => {
  const gas = makeBot({ forecast: forecastJson({ pop: (di, h) => (di === 2 && h === 9 ? 80 : 10) }) });
  addPlace(gas, userSource(OWNER), 35.17, 136.88);
  const [notice] = gas.call("weatherNotices_");
  gas.reset();
  assert.equal(gas.call("weatherHourly_", at(7)).sent, 0, "今日は何もない");
  gas.call("updateRow_", "weather", "noticeId", notice.noticeId, { notifyHour: 21, lastCheckedDate: "" });
  assert.equal(gas.call("weatherHourly_", at(21)).sent, 1);
  assert.match(JSON.stringify(pushes(gas)[0].messages[0].contents.header), /明日の天気の知らせ/);
});

test("Open-Meteo に断られたら（429）1回だけやりなおす。それでもだめなら送らずに記録", () => {
  let calls = 0;
  const gas = makeBot({ meteo: () => (++calls, response(429, "{}")) });
  addPlace(gas, userSource(OWNER), 35.17, 136.88);
  gas.reset();
  const result = gas.call("weatherHourly_", at(7));
  assert.equal(calls, 2);
  assert.deepEqual([result.sent, result.failed], [0, 1]);
  assert.equal(pushes(gas).length, 0);
  assert.ok(gas.rows("動作の記録").some((row) => /Open-Meteo 429/.test(row[2])));
  let n = 0;
  const ok = makeBot({ meteo: () => (++n === 1 ? response(429, "{}") : response(200, forecastJson({ pop: (di, h) => (di === 1 && h === 12 ? 90 : 10) }))) });
  addPlace(ok, userSource(OWNER), 35.17, 136.88);
  assert.equal(ok.call("weatherHourly_", at(7)).sent, 1);
});

test("天気は急ぎでない知らせ：送った数が上限の8割をこえたら止める。許されなくなった人の地点にも送らない", () => {
  const rainy = forecastJson({ pop: (di, h) => (di === 1 && h === 12 ? 90 : 10) });
  const full = makeBot({ forecast: rainy, quota: { value: 200, used: 170 } });
  addPlace(full, userSource(OWNER), 35.17, 136.88);
  full.reset();
  assert.equal(full.call("weatherHourly_", at(7)).skippedForQuota, 1);
  assert.equal(pushes(full).length, 0);

  const gas = makeBot({ forecast: rainy, members: [[FRIEND, "ともだち", "allowed", "", ""]] });
  addPlace(gas, userSource(FRIEND), 35.17, 136.88);
  gas.call("updateRow_", "members", "userId", FRIEND, { status: "removed" });
  gas.reset();
  assert.equal(gas.call("weatherHourly_", at(7)).checked, 0);
});

test("グループでは、決まった言葉にだけ返す（ふだんの会話にまじらない）", () => {
  const gas = makeBot();
  say(gas, groupSource(OWNER), "今日は雨かな");
  assert.equal(gas.replies().length, 0);
  say(gas, groupSource(OWNER), "天気の知らせ");
  assert.equal(lastReply(gas).messages[0].type, "flex");
});

test("ツールから：その人が足した地点の名前と時間だけ（位置・送り先は返さない）", () => {
  const gas = makeBot();
  addPlace(gas, userSource(OWNER), 35.17, 136.88);
  const places = JSON.parse(JSON.stringify(gas.call("weatherNotices_").map((n) => n)));
  assert.equal(places.length, 1);
  const out = JSON.parse(JSON.stringify(gas.eval("MODULES_.weather.tool.list({}, { userId: " + JSON.stringify(OWNER) + " })")));
  assert.deepEqual(out, { ok: true, places: [{ name: "名古屋市中村区", hour: 7 }] });
});

test("地名：市のさかいの近くでも、送った場所の市区町村（住所 → 100m に丸めた位置）。残す位置は 1km に丸めたまま", () => {
  const gas = makeBot();
  const asked = [];
  gas.ctx.UrlFetchApp.fetch = ((orig) => (url, opt) => {
    if (url.startsWith("https://katsuan.github.io/soraqru/data/muni.json")) return response(200, { 33100: "岡山市", 33104: "岡山市南区", 33202: "倉敷市", 24202: "四日市市", 13101: "千代田区" });
    if (url.startsWith("https://mreversegeocoder.gsi.go.jp/")) {
      asked.push(url);
      // 1km に丸めた点（34.55, 133.82）は岡山市南区、送った点のそば（100m）は倉敷市
      return response(200, { results: { muniCd: /lat=34\.55&lon=133\.82$/.test(url) ? "33104" : "33202" } });
    }
    return orig(url, opt);
  })(gas.ctx.UrlFetchApp.fetch);
  const send = (address) => {
    press(gas, userSource(OWNER), "m=weather&a=add");
    gas.lineEvent({ type: "message", replyToken: `rl${asked.length}${address}`, source: userSource(OWNER), message: { type: "location", id: "m", latitude: 34.5531, longitude: 133.8166, title: "", address } }, { key: "k".repeat(32) });
  };
  // 住所があれば、住所から（国土地理院には聞かない）
  send("日本、〒710-0046 岡山県倉敷市林１２３４");
  assert.equal(gas.call("weatherNotices_")[0].placeName, "倉敷市");
  assert.equal(asked.length, 0);
  // 住所がなければ、100m に丸めた位置で国土地理院に
  gas.call("updateRow_", "weather", "noticeId", gas.call("weatherNotices_")[0].noticeId, { isActive: false });
  send("");
  const [n] = gas.call("weatherNotices_");
  assert.equal(n.placeName, "倉敷市");
  assert.match(asked[0], /lat=34\.553&lon=133\.817$/);
  // 残すのは 1km に丸めた位置
  assert.deepEqual([n.lat, n.lon], [34.55, 133.82]);
  // 住所の読み方：いちばん長い名前・都道府県のすぐあとだけ
  const table = { 33100: "岡山市", 33104: "岡山市南区", 24202: "四日市市", 13101: "千代田区", 12203: "市川市" };
  const read = (a) => gas.call("weatherPlaceFromAddress_", a, table);
  assert.equal(read("〒702-8001 岡山県岡山市南区沖元"), "岡山市南区");
  assert.equal(read("三重県四日市市諏訪町"), "四日市市");
  assert.equal(read("東京都千代田区丸の内"), "千代田区");
  assert.equal(read("千葉県市川市八幡"), "市川市");
  assert.equal(read("岡山県総社市岡山市町"), "");
  assert.equal(read(""), "");
});

test("そらくるから届く文「📍 地点を足す 緯度,経度 名前」：1対1 で、使える人だけ。名前はそのまま・位置は 1km に丸める", () => {
  const gas = makeBot();
  say(gas, userSource(STRANGER), "📍 地点を足す 34.5531,133.8166 倉敷市");
  assert.match(textsOf(lastReply(gas).messages), /持ち主の許可が要ります/);
  say(gas, groupSource(OWNER), "📍 地点を足す 34.5531,133.8166 倉敷市");
  assert.match(textsOf(lastReply(gas).messages), /1対1/);
  say(gas, userSource(OWNER), "📍 地点を足す 34.5531,133.8166 倉敷市");
  assert.match(textsOf(lastReply(gas).messages), /倉敷市 を登録しました/);
  const [n] = gas.call("weatherNotices_");
  assert.deepEqual([n.lat, n.lon, n.placeName, n.targetId], [34.55, 133.82, "倉敷市", OWNER]);
  // 名前がなければ調べる。形のちがう文は、ふつうの案内
  say(gas, userSource(OWNER), "地点を足す 35.171,136.884");
  assert.equal(gas.call("weatherNotices_")[1].placeName, "名古屋市中村区");
  say(gas, userSource(OWNER), "📍 地点を足す ここ");
  assert.equal(lastReply(gas).messages[0].text, "下のボタンから選んでね。");
  say(gas, userSource(OWNER), "📍 地点を足す 99,999 x");
  assert.match(textsOf(lastReply(gas).messages), /場所が読めませんでした/);
  assert.deepEqual(gas.formulaCells(), []);
});

test("一覧の地点を押すと、その地点のそらくるが開く", () => {
  const gas = makeBot();
  addPlace(gas, userSource(OWNER), 35.17, 136.88);
  say(gas, userSource(OWNER), "天気の知らせ");
  const card = lastReply(gas).messages[0];
  const row = card.contents.body.contents.find((c) => c.action);
  assert.equal(row.action.type, "uri");
  assert.match(row.action.uri, /^https:\/\/katsuan\.github\.io\/soraqru\/\?at=35\.17,136\.88&name=/);
  assert.deepEqual(errorsOf([card]), []);
});

test("天気の一覧の「⚙️ 変える」：カードに置く。何日もあとに押す（もうやめた）・2回やめる・ほかの人が押す", () => {
  const gas = makeBot({ members: [[FRIEND, "ともだち", "allowed", "", ""]] });
  addPlace(gas, groupSource(OWNER), 35.17, 136.88);
  say(gas, groupSource(OWNER), "天気の知らせ");
  const card = lastReply(gas).messages[0];
  const data = JSON.stringify(card.contents.body).match(/"data":"(m=weather&a=hours&id=[^"]+)"/)[1];
  assert.deepEqual(card.contents.footer.contents.map((b) => b.action.label), ["📍 地点を足す", "🌤️ そらくるで見る"]);
  // 押すと、時間と「🗑️ やめる」を選べる
  press(gas, groupSource(OWNER), data);
  const reply = lastReply(gas).messages[0];
  assert.deepEqual(quickLabels(reply), ["⏰ 6時", "⏰ 7時", "⏰ 8時", "⏰ 21時（明日のぶん）", "🗑️ やめる"]);
  // ほかの人（許した人でも、足した本人でない）が押すと、変えずに返す
  press(gas, groupSource(FRIEND), data);
  assert.match(textsOf(lastReply(gas).messages), /あなたが変えられない地点/);
  const remove = reply.quickReply.items.at(-1).action.data;
  press(gas, groupSource(FRIEND), remove);
  assert.equal(gas.call("weatherNotices_").length, 1);
  // やめる → 2回目は「もうやめています」
  press(gas, groupSource(OWNER), remove);
  assert.equal(gas.call("weatherNotices_").length, 0);
  press(gas, groupSource(OWNER), remove);
  assert.match(textsOf(lastReply(gas).messages), /もうやめています/);
  // 何日もあとに、前のカードの「⚙️ 変える」を押した
  press(gas, groupSource(OWNER), data);
  assert.match(textsOf(lastReply(gas).messages), /もうやめているか/);
  assert.deepEqual(errorsOf([card]), []);
});

test("知らせのカードに時間ごとの表：6〜21時の3時間ごとに、天気・気温・降水確率・気圧の段階。注意の行は色と太字。LINE が受けつける形", () => {
  // 15〜17時に雨 70%・気圧が下がる（3時間で 2.4hPa → 注意）
  const rough = forecastJson({
    pop: (di, h) => (di === 1 && h >= 15 && h <= 17 ? 70 : 10),
    pressure: (di, h) => (di === 1 && h >= 15 ? 1013 - (h - 14) * 0.8 : 1013)
  });
  const gas = makeBot({ forecast: rough, modulesOff: ["log", "meal"] });
  addPlace(gas, userSource(OWNER), 35.17, 136.88);
  gas.reset();
  gas.call("botHourly", gas.call("env_"), at(7));
  const card = pushes(gas)[0].messages[0];
  assert.deepEqual(errorsOf([card]), []);
  const table = card.contents.body.contents.find((c) => c.type === "box" && c.layout === "vertical" && JSON.stringify(c).includes('"時間"'));
  assert.ok(table, "表がある");
  const rows = table.contents.slice(2);
  assert.deepEqual(rows.map((r) => r.contents[0].text), ["6時", "9時", "12時", "15時", "18時", "21時"]);
  const row15 = rows[3];
  assert.equal(row15.contents[3].text, "70%");
  assert.match(row15.contents[4].text, /● (注意|警戒)/);
  assert.ok(row15.backgroundColor, "注意の行は色");
  assert.equal(row15.contents[0].weight, "bold");
  assert.equal(rows[0].backgroundColor, undefined, "ふつうの行は色なし");
  assert.match(rows[0].contents[4].text, /● 通常/);
  assert.ok(JSON.stringify(card).length < 30000, "1枚に収まる");
});

test("#テストの天気の見本：雨・気圧・気温・何もない日の4枚、どれも表つき", () => {
  const gas = makeBot();
  press(gas, userSource(OWNER), "m=core&a=test&t=weather.notice");
  const cards = lastReply(gas).messages;
  assert.equal(cards.length, 4);
  for (const c of cards) {
    assert.match(c.altText, /^🧪/);
    assert.match(JSON.stringify(c.contents), /"text":"6時"[\s\S]*"text":"21時"/);
  }
  assert.match(cards[3].altText, /どれもふつう/);
  assert.deepEqual(errorsOf(cards), []);
});
