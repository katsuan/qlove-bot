/**
 * 50_weather_places.gs：機能「☁️ 天気」の地点（シート「天気の地点」）と、LINE の返事（地点を足す・時間・やめる）
 * 中身：地点の読み方・地点を足す（位置情報・そらくるからの文）・時間をかえる・やめる。呼ばれるところ：50_weather.gs の登録（onPostback・onLocation・onText・menu）
 */

// ---- 地点（シート「天気の地点」） ----

/** シート「天気の地点」の、見ている地点の並び（形のおかしい行は捨てる） */
function weatherNotices_() {
  return readRows_('weather')
    .filter((row) => isOn_(row.isActive))
    .map((row) => ({
      noticeId: String(row.noticeId || '').trim(),
      ownerUserId: String(row.ownerUserId || '').trim(),
      targetType: String(row.targetType || '').trim(),
      targetId: String(row.targetId || '').trim(),
      placeName: cleanText_(row.placeName, 20) || '登録した地点',
      lat: Number(row.lat),
      lon: Number(row.lon),
      notifyHour: Number(row.notifyHour),
      lastCheckedDate: row.lastCheckedDate instanceof Date ? formatDay_(row.lastCheckedDate) : String(row.lastCheckedDate || '').trim()
    }))
    .filter((n) => n.noticeId && n.targetId && Number.isFinite(n.lat) && Number.isFinite(n.lon) && Math.abs(n.lat) <= 90 && Math.abs(n.lon) <= 180);
}

/** このトーク（1対1・グループ）に送る地点 */
function weatherOfTarget_(event) {
  const target = targetOf_(event);
  return weatherNotices_().filter((n) => n.targetId === target.targetId);
}

/** 時間の言い方（「毎朝7時」「前の日の21時（明日のぶん）」） */
function weatherHourLabel_(hour) {
  return Number(hour) >= WEATHER_.eveningFrom ? `前の日の${hour}時（明日のぶん）` : `毎朝${hour}時`;
}

/** 変えてよい地点：このトークの地点で、持ち主か、その地点を足した本人 */
function editableWeather_(event, noticeId, role) {
  if (!role) return null;
  const userId = userIdOf_(event);
  return weatherOfTarget_(event).find((n) => n.noticeId === noticeId && (role === 'owner' || n.ownerUserId === userId)) || null;
}

/** 「📍 地点を足す」を押した人の、位置情報を待つ印のキャッシュの名前（トークと人ごと） */
function weatherPendingKey_(event) {
  return `WEATHER_PENDING_${targetOf_(event).targetId}_${userIdOf_(event)}`;
}

/** 時間を選ぶクイックリプライ（6・7・8・21時） */
function weatherHourActions_(notice) {
  return WEATHER_.hours.map((hour) => postback_(
    `⏰ ${hour >= WEATHER_.eveningFrom ? `${hour}時（明日のぶん）` : `${hour}時`}`,
    `m=weather&a=time&id=${encodeURIComponent(notice.noticeId)}&h=${hour}`,
    `⏰ ${notice.placeName}：${weatherHourLabel_(hour)}`
  ));
}

/** 「☁️ 天気の知らせ」の一覧を出すボタン（クイックリプライ） */
const weatherMenuButton_ = () => postback_(WEATHER_.label, 'm=weather&a=menu');

// ---- 返事 ----

// 「📍 地点を足す」：位置情報を送るクイックリプライ。押した人の位置情報だけを、10分のあいだ受けとる
function weatherAddReply_(event, role) {
  if (!role) return notAllowedText_();
  const userId = userIdOf_(event);
  const all = weatherNotices_();
  if (all.filter((n) => n.ownerUserId === userId).length >= WEATHER_.maxPerPerson) {
    return textMessage_(`地点は1人${WEATHER_.maxPerPerson}か所までです。「🗑️ やめる地点」から減らしてね。`, [postback_('🗑️ やめる地点', 'm=weather&a=pick&k=remove')]);
  }
  if (all.length >= WEATHER_.maxTotal) return textMessage_(`このボットで見られる地点は${WEATHER_.maxTotal}か所までです。持ち主に相談してね。`);
  cache_().put(weatherPendingKey_(event), '1', WEATHER_.pendingSeconds);
  return textMessage_('天気を知らせる場所を、下の「📍 位置情報を送る」から送ってね（10分のあいだ）。\n位置は1kmくらいに丸めて覚えます。', [{ type: 'location', label: '📍 位置情報を送る' }]);
}

// 位置情報：「📍 地点を足す」を押した人のものだけ受けとる（ほかは null で、次の機能へ）
function weatherLocationReply_(event, role) {
  const key = weatherPendingKey_(event);
  if (!cache_().get(key)) return null;
  cache_().remove(key);
  return weatherRegister_(event, role, {
    lat: Number(event.message.latitude),
    lon: Number(event.message.longitude),
    address: event.message.address,
    title: event.message.title
  });
}

// そらくるの「🔔 この地点を、くらぶボットの知らせに足す」から届く文：「📍 地点を足す 35.17,136.88 名古屋」
// LINE から本人が送った文なので、本人の確かめは位置情報と同じ（送った人の役割で決める）。1対1 だけ
const WEATHER_ADD_TEXT_ = /^📍?\s*地点を足す[\s\u3000]+(-?\d{1,2}(?:\.\d{1,6})?)\s*[,，、]\s*(-?\d{1,3}(?:\.\d{1,6})?)(?:[\s\u3000]+(.+))?$/u;

/** そらくるから届く「📍 地点を足す 緯度,経度 名前」の文なら、その場所を登録する（1対1 だけ）。ちがう文なら null */
function weatherTextReply_(event, text, role) {
  const m = WEATHER_ADD_TEXT_.exec(text);
  if (!m) return null;
  if (!isOneToOne_(event)) return [textMessage_('この文からの登録は、ボットとの1対1 のトークでしてね。')];
  return weatherRegister_(event, role, { lat: Number(m[1]), lon: Number(m[2]), name: cleanText_(m[3], 20) });
}

/** 地点を足す（位置情報・そらくるからの文の両方）。spot：{ lat, lon（丸める前）, address, title, name（名前を決めて送ってきたとき） } */
function weatherRegister_(event, role, spot) {
  if (!role) return [notAllowedText_()];
  const rawLat = spot.lat;
  const rawLon = spot.lon;
  const lat = Math.round(rawLat * 100) / 100;
  const lon = Math.round(rawLon * 100) / 100;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return [textMessage_('場所が読めませんでした。「📍 地点を足す」から、もう一度送ってね。', [postback_('📍 地点を足す', 'm=weather&a=add')])];
  }
  const userId = userIdOf_(event);
  const target = targetOf_(event);
  const all = weatherNotices_();
  if (all.some((n) => n.targetId === target.targetId && n.lat === lat && n.lon === lon)) return [textMessage_('この場所は、もう登録しています。', [weatherMenuButton_()])];
  if (all.filter((n) => n.ownerUserId === userId).length >= WEATHER_.maxPerPerson) return [textMessage_(`地点は1人${WEATHER_.maxPerPerson}か所までです。「🗑️ やめる地点」から減らしてね。`, [postback_('🗑️ やめる地点', 'm=weather&a=pick&k=remove')])];
  if (all.length >= WEATHER_.maxTotal) return [textMessage_(`このボットで見られる地点は${WEATHER_.maxTotal}か所までです。`)];

  // 地名は、送ってきた名前・住所・丸める前の位置（100m くらい）で調べる。シートに残すのは 1km に丸めた位置だけ
  const placeName = spot.name || weatherPlaceName_(rawLat, rawLon, spot.address) || cleanText_(spot.title, 20) || '登録した地点';
  const notice = {
    noticeId: Utilities.getUuid(), ownerUserId: userId, targetType: target.targetType, targetId: target.targetId,
    placeName: placeName, lat: lat, lon: lon, notifyHour: WEATHER_.defaultHour, isActive: true, lastCheckedDate: '',
    createdAt: new Date(), updatedAt: new Date()
  };
  appendRow_('weather', notice);
  return [textMessage_(
    QSeason.decorate(`📍 ${placeName} を登録しました。\n${weatherHourLabel_(notice.notifyHour)}ごろ、雨・気圧・気温で知らせることがある日だけ、このトークに送ります。時間は下から変えられます。`),
    weatherHourActions_(notice)
  )];
}

/** どの地点の時間をかえる・やめるかを選ぶクイックリプライ（持ち主か、その地点を足した人の地点だけ） */
function weatherPickReply_(event, mode, role) {
  if (!role) return notAllowedText_();
  const userId = userIdOf_(event);
  const notices = weatherOfTarget_(event).filter((n) => role === 'owner' || n.ownerUserId === userId);
  if (!notices.length) return textMessage_('あなたが変えられる地点は、このトークにはありません。', [postback_('📍 地点を足す', 'm=weather&a=add')]);
  return textMessage_(mode === 'remove' ? 'どの地点の知らせをやめる？' : 'どの地点の時間をかえる？', notices.map((n) => (mode === 'remove'
    ? postback_(`🗑️ ${n.placeName}`, `m=weather&a=remove&id=${encodeURIComponent(n.noticeId)}`, `🗑️ ${n.placeName}の知らせをやめる`)
    : postback_(`⏰ ${n.placeName}`, `m=weather&a=hours&id=${encodeURIComponent(n.noticeId)}`, `⏰ ${n.placeName}の時間をかえる`))));
}

/** 天気の postback（地点を足す・時間・やめる・一覧）。押されるたびに、地点がまだあるか・押した人が変えてよいかを見て返す */
function weatherPostback_(event, p, role) {
  // 何日もあとに押された・もうやめた・ほかの人の地点：変えずに、やさしく返す
  const gone = () => [textMessage_('この地点は、もうやめているか、あなたが変えられない地点です。', [weatherMenuButton_()])];
  switch (p.a) {
    case 'add':
      return [weatherAddReply_(event, role)];
    case 'edit':
      return [role ? textMessage_('どうする？', [postback_('⏰ 時間をかえる', 'm=weather&a=pick&k=time'), postback_('🗑️ やめる地点', 'm=weather&a=pick&k=remove')]) : notAllowedText_()];
    case 'pick':
      return [weatherPickReply_(event, p.k === 'remove' ? 'remove' : 'time', role)];
    case 'hours': {
      const n = editableWeather_(event, String(p.id || ''), role);
      return n ? [textMessage_(`📍 ${n.placeName}（いまは${weatherHourLabel_(n.notifyHour)}）。何時にする？ やめるときは「🗑️ やめる」。`, weatherHourActions_(n).concat([postback_('🗑️ やめる', `m=weather&a=remove&id=${encodeURIComponent(n.noticeId)}`, `🗑️ ${n.placeName}の知らせをやめる`)]))] : gone();
    }
    case 'time': {
      const n = editableWeather_(event, String(p.id || ''), role);
      const hour = Number(p.h);
      if (!n) return gone();
      if (!WEATHER_.hours.includes(hour)) return [textMessage_('この時間はえらべません。', weatherHourActions_(n))];
      if (n.notifyHour !== hour) updateRow_('weather', 'noticeId', n.noticeId, { notifyHour: hour, lastCheckedDate: '' });
      return [textMessage_(`⏰ ${n.placeName}：${weatherHourLabel_(hour)}ごろに送ります（知らせることがある日だけ）。`, [weatherMenuButton_()])];
    }
    case 'remove': {
      const n = editableWeather_(event, String(p.id || ''), role);
      if (!n) return [textMessage_('この地点の知らせは、もうやめています。', [weatherMenuButton_()])];
      updateRow_('weather', 'noticeId', n.noticeId, { isActive: false });
      return [textMessage_(`🗑️ ${n.placeName}の知らせをやめました。`, [weatherMenuButton_()])];
    }
    default:
      return [weatherListCard_(weatherOfTarget_(event), role)];
  }
}

