/**
 * 56_sea_spots.gs：機能「🎣 釣り」の釣り場（シート「釣り場」）・写真・記録（シート「釣りの記録」）と、LINE の返事
 * 中身：釣り場の読み方・写真を受ける・釣り場を選ぶ／現在地で足す・記録する・一覧・名前・やめる・#テストの見本。
 * 呼ばれるところ：56_sea.gs の登録（onImage・onLocation・onPostback・onText・menu・samples）
 */

// ---- 釣り場（シート「釣り場」） ----

/** その人の釣り場（使っているものだけ。最近使った順。同じときは、あとに足したものが先） */
function seaSpotsOf_(userId) {
  const time = (v) => (v instanceof Date ? v.getTime() : Date.parse(v) || 0);
  return readRows_('seaSpots')
    .map((r, row) => Object.assign({ row: row }, r))
    .filter((r) => isOn_(r.isActive) && String(r.userId || '').trim() === userId)
    .map((r) => ({
      row: r.row,
      spotId: String(r.spotId || '').trim(),
      name: cleanText_(r.name, 14) || '釣り場',
      lat: Number(r.lat),
      lon: Number(r.lon),
      used: Math.max(time(r.lastUsedAt), time(r.createdAt))
    }))
    .filter((s) => s.spotId && Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .sort((a, b) => b.used - a.used || b.row - a.row);
}

/** 位置から釣り場を足す（200m 以内に前の釣り場があれば、それを返す）。{ spot, added } か { error } */
function seaAddSpot_(userId, lat, lon, title) {
  const la = Math.round(Number(lat) * 1e4) / 1e4;
  const lo = Math.round(Number(lon) * 1e4) / 1e4;
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return { error: '場所が読めませんでした。もう一度送ってね。' };
  const spots = seaSpotsOf_(userId);
  const same = spots.find((s) => seaKm_(s, { lat: la, lon: lo }) * 1000 <= SEA_.sameSpotM);
  if (same) return { spot: same, added: false };
  if (spots.length >= SEA_.maxSpots) return { error: `釣り場は1人${SEA_.maxSpots}か所までです。「🗑️ 釣り場をやめる」から減らしてね。` };
  const station = seaNearestStation_(la, lo);
  const name = cleanText_(title, 14) || (station ? `${station.name}の近く` : `釣り場${spots.length + 1}`);
  const spot = { spotId: Utilities.getUuid(), userId: userId, name: name, lat: la, lon: lo, isActive: true, lastUsedAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
  appendRow_('seaSpots', spot);
  return { spot: spot, added: true };
}

// 写真を送った人の、どこで釣ったかを待つ印（写真の ID と時刻）
const seaPhotoKey_ = (userId) => `SEA_PHOTO_${userId}`;
// 「📍 釣り場を足す」を押した人の、位置情報を待つ印
const seaAddKey_ = (userId) => `SEA_ADD_${userId}`;
// 「✏️ 名前を変える」で選んだ釣り場（名前の文を待つ）
const seaRenameKey_ = (userId) => `SEA_RENAME_${userId}`;
// 「🎣 釣り」の一覧を出すボタン（クイックリプライ）
const seaMenuButton_ = () => postback_(SEA_.label, 'm=sea&a=menu');
// 「📍 釣り場を足す」のボタン（クイックリプライ）
const seaAddButton_ = () => postback_('📍 釣り場を足す', 'm=sea&a=add');

// ---- 写真 ----

// 写真：使える人の1対1 の写真なら、どこで釣ったかを聞く（釣り場がまだなければ「📍 現在地」だけ）
function seaImageReply_(event, role) {
  if (!role || !isOneToOne_(event)) return null;
  const userId = userIdOf_(event);
  const spots = seaSpotsOf_(userId);
  const id = String((event.message && event.message.id) || '');
  const t = Number(event.timestamp) || Date.now();
  if (!/^\d{1,30}$/.test(id)) return null;
  cache_().put(seaPhotoKey_(userId), JSON.stringify({ id: id, t: t }), SEA_.pendingSeconds);
  const hm = Utilities.formatDate(new Date(t), timeZone_(), 'H:mm');
  const actions = spots.slice(0, SEA_.quickSpots).map((s) => postback_(`🎣 ${s.name}`, `m=sea&a=at&s=${encodeURIComponent(s.spotId)}&p=${id}&t=${t}`, `🎣 ${s.name}`))
    .concat([{ type: 'location', label: '📍 現在地' }]);
  return [textMessage_(spots.length
    ? `どこで釣った写真？ ${hm}（送った時刻）の潮と風を返します。`
    : `釣った場所を「📍 現在地」から送ってね。${hm}（送った時刻）の潮と風を返します。`, actions)];
}

/** 写真の時刻（postback の t）を読む。古すぎる・先すぎるものは null */
function seaPhotoTime_(t) {
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const now = Date.now();
  return n > now + 5 * 60e3 || n < now - SEA_.maxPastDays * 864e5 ? null : new Date(n);
}

/** その人の、その写真の記録（なければ null） */
function seaLogOf_(userId, messageId) {
  return readRows_('seaLogs').find((r) => String(r.userId || '').trim() === userId && String(r.messageId || '').trim() === messageId) || null;
}

/** 記録する：潮と風を調べてシートに残し、返事のメッセージを返す */
function seaRecord_(userId, spot, messageId, date) {
  const info = seaInfoAt_(spot, date);
  const t = info.tide || {};
  const w = info.wind || {};
  appendRow_('seaLogs', {
    recordId: Utilities.getUuid(), userId: userId, messageId: messageId, spotId: spot.spotId, spotName: spot.name, at: date,
    port: info.port, moon: t.moon || '', tideCm: t.cm == null ? '' : t.cm, tidePct: t.pct == null ? '' : t.pct, phase: t.phase || '', stage: t.stage == null ? '' : t.stage,
    stageText: t.stageText || '', fromHighMin: t.fromHigh == null ? '' : t.fromHigh, tideEvents: t.events || '', mazume: info.mazume,
    windMs: w.ms == null ? '' : w.ms, windDir: w.dir || '', windTrend: w.trend || '', windSeries: (w.series || []).map((v) => (v == null ? '-' : v)).join('→'),
    label: '', createdAt: new Date(), updatedAt: new Date()
  });
  updateRow_('seaSpots', 'spotId', spot.spotId, { lastUsedAt: new Date() });
  return seaRecordMessage_(info);
}

/** "85" → "1時間25分" */
function seaMinText_(n) {
  const a = Math.abs(Math.round(n));
  return a >= 60 ? `${Math.floor(a / 60)}時間${a % 60 ? `${a % 60}分` : ''}` : `${a}分`;
}

/** 記録の返事（長押しでコピーできるように文で）。info … seaInfoAt_ の中身 */
function seaRecordMessage_(info) {
  const t = info.tide;
  const w = info.wind;
  const lines = [`🎣 ${info.spot.name}　${dayLabel_(info.ymd)} ${info.hm.replace(/^0/, '')}`];
  if (t) {
    lines.push(`潮 ${[t.moon, t.stageText].filter(Boolean).join('・')}（${info.port}）`);
    const high = t.fromHigh == null ? '' : t.fromHigh === 0 ? '・満潮' : t.fromHigh < 0 ? `・満潮の${seaMinText_(t.fromHigh)}前` : `・満潮から${seaMinText_(t.fromHigh)}`;
    lines.push(`潮位 ${t.cm}cm${t.pct == null ? '' : `（その日の${t.pct}%）`}${high}`);
    if (t.events) lines.push(t.events);
  } else {
    lines.push(info.port ? `潮：${info.port}の潮位表を読めませんでした` : `潮：${SEA_.portMaxKm}km 以内に潮位表の地点がありません`);
  }
  if (w) {
    const around = [w.before == null ? '' : `3時間前 ${w.before}`, w.after == null ? '' : `1時間後 ${w.after}`].filter(Boolean).join(' → ');
    lines.push(`風 ${w.dir} ${w.ms}m/s${w.trend ? `・${w.trend}` : ''}${around ? `（${around}）` : ''}`);
  } else {
    lines.push('風：読めませんでした');
  }
  if (info.mazume) lines.push(`🌅 ${info.mazume}`);
  const near = seaNearLines_(info);
  if (near.length) lines.push('', '近い時刻の値（潮位表・風の予報のまま）', ...near);
  return textMessage_(lines.join('\n'), [seaMenuButton_()]);
}

/** 分（0:00 から。前の日ならマイナス）→ "6:00" */
function seaMinClock_(m) {
  const a = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

/**
 * 写真の時刻の前後（3時間前〜1時間後）の、取ってきた値の並び（時刻の順）。写真の時刻の行は「▶」で、潮は曲線で読んだ値。
 * 例："5:00 潮 112cm・風 北 3.2m/s" "5:31 潮 104cm 干潮" "▶6:42 潮 98cm"
 */
function seaNearLines_(info) {
  const rows = {};
  const row = (m) => (rows[m] = rows[m] || { m: m });
  const min = Number(info.hm.slice(0, 2)) * 60 + Number(info.hm.slice(3, 5));
  ((info.tide && info.tide.points) || []).forEach((p) => Object.assign(row(p.m), { cm: p.cm, k: p.k }));
  const day = Math.floor(min / 1440) * 1440;
  ((info.wind && info.wind.hours) || []).forEach((h) => {
    if (h.ms == null) return;
    let m = Number(h.hm.slice(0, 2)) * 60 + Number(h.hm.slice(3, 5)) + day;
    if (m - min > 12 * 60) m -= 1440; // 前の日の夜
    Object.assign(row(m), { ms: h.ms, dir: h.dir });
  });
  if (!Object.keys(rows).length) return [];
  Object.assign(row(min), { now: true, cm: rows[min] && rows[min].cm != null ? rows[min].cm : info.tide ? info.tide.cm : null });
  return Object.keys(rows).map(Number).sort((a, b) => a - b).map((m) => {
    const r = rows[m];
    const parts = [];
    if (r.cm != null) parts.push(`潮 ${Math.round(r.cm)}cm${r.k ? ` ${r.k}` : ''}`);
    if (r.ms != null) parts.push(`風 ${r.dir} ${r.ms}m/s`);
    return `${r.now ? '▶' : '　'}${seaMinClock_(m)} ${parts.join('・')}`;
  });
}

// ---- 位置情報 ----

// 位置情報：写真のあとの「📍 現在地」か、「📍 釣り場を足す」を押した人のものだけ受けとる（ほかは null で、次の機能へ）
function seaLocationReply_(event, role) {
  const userId = userIdOf_(event);
  const cache = cache_();
  const photo = cache.get(seaPhotoKey_(userId));
  const add = cache.get(seaAddKey_(userId));
  if (!photo && !add) return null;
  if (!role) return [notAllowedText_()];
  const out = seaAddSpot_(userId, event.message.latitude, event.message.longitude, event.message.title);
  if (out.error) return [textMessage_(out.error, [seaMenuButton_()])];
  const station = seaNearestStation_(out.spot.lat, out.spot.lon);
  const head = out.added ? `📍 ${out.spot.name} を釣り場に足しました${station ? `（潮は${station.name}）` : ''}。` : `📍 前の釣り場「${out.spot.name}」にしました。`;
  if (photo) {
    cache.remove(seaPhotoKey_(userId));
    cache.remove(seaAddKey_(userId));
    const p = JSON.parse(photo);
    const date = seaPhotoTime_(p.t);
    if (!date) return [textMessage_(`${head}\n写真が古いので、もう一度送ってね。`, [seaMenuButton_()])];
    if (seaLogOf_(userId, p.id)) return [textMessage_(`${head}\nこの写真は、もう記録しています。`, [seaMenuButton_()])];
    return [textMessage_(head), seaRecord_(userId, out.spot, p.id, date)];
  }
  cache.remove(seaAddKey_(userId));
  return [textMessage_(`${head}\n釣った魚の写真を送ると、その時刻の潮と風を返します。`, [seaMenuButton_()])];
}

// ---- 文 ----

// 「釣り場の名前 グンカン」：「✏️ 名前を変える」で選んだ釣り場の名前を変える（10分のあいだ）。ほかは null
function seaTextReply_(event, text, role) {
  const m = text.match(SEA_RENAME_TEXT_);
  if (!m || !isOneToOne_(event)) return null;
  if (!role) return [notAllowedText_()];
  const userId = userIdOf_(event);
  const spotId = cache_().get(seaRenameKey_(userId));
  const spot = spotId && seaSpotsOf_(userId).find((s) => s.spotId === spotId);
  if (!spot) return [textMessage_('名前を変える釣り場を、先に選んでね。', [postback_('✏️ 名前を変える', 'm=sea&a=pick&k=name')])];
  const name = cleanText_(m[1].replace(/[=,]/g, ''), 14);
  if (!name) return [textMessage_('名前が空です。「釣り場の名前 グンカン」のように送ってね。')];
  cache_().remove(seaRenameKey_(userId));
  updateRow_('seaSpots', 'spotId', spot.spotId, { name: name });
  return [textMessage_(`✏️ 「${spot.name}」を「${name}」にしました。`, [seaMenuButton_()])];
}

// ---- 一覧・ボタン ----

/** 「🎣 釣り」：その人の釣り場の一覧と、足す・名前・やめるのボタン */
function seaMenuReply_(event, role) {
  if (!role) return [notAllowedText_()];
  if (!isOneToOne_(event)) return [textMessage_(`${SEA_.label}は、ボットとの1対1 のトークで使えます。`)];
  const spots = seaSpotsOf_(userIdOf_(event));
  const text = spots.length
    ? `${SEA_.label}\n釣った魚の写真を送ると、その時刻の潮と風を返して記録します。\n\n釣り場（最近使った順）\n${spots.map((s) => { const st = seaNearestStation_(s.lat, s.lon); return `・${s.name}${st ? `（潮は${st.name}）` : ''}`; }).join('\n')}`
    : `${SEA_.label}\n釣った魚の写真を送ると、その時刻の潮と風を返して記録します。まず、釣り場を足してね（写真のあとの「📍 現在地」でも足せます）。`;
  return [textMessage_(`${text}\n\n${SEA_SOURCE_TEXT_}`, [seaAddButton_()].concat(spots.length ? [postback_('✏️ 名前を変える', 'm=sea&a=pick&k=name'), postback_('🗑️ 釣り場をやめる', 'm=sea&a=pick&k=remove')] : []))];
}

/** 釣り場の postback。押されるたびに、写真・釣り場がまだあるか・押した人のものかを見て返す */
function seaPostback_(event, p, role) {
  if (!role) return [notAllowedText_()];
  if (!isOneToOne_(event)) return [textMessage_(`${SEA_.label}は、ボットとの1対1 のトークで使えます。`)];
  const userId = userIdOf_(event);
  const spotOf = (id) => seaSpotsOf_(userId).find((s) => s.spotId === String(id || '')) || null;
  const gone = () => [textMessage_('この釣り場は、もうやめています。', [seaMenuButton_()])];
  switch (p.a) {
    case 'add':
      cache_().put(seaAddKey_(userId), '1', SEA_.pendingSeconds);
      return [textMessage_('釣り場を、下の「📍 位置情報を送る」から送ってね（10分のあいだ）。地図の上で場所を動かしてから送れます。', [{ type: 'location', label: '📍 位置情報を送る' }])];
    case 'at': {
      const spot = spotOf(p.s);
      if (!spot) return gone();
      const id = String(p.p || '');
      if (!/^\d{1,30}$/.test(id)) return [textMessage_('写真が読めませんでした。もう一度送ってね。')];
      if (seaLogOf_(userId, id)) return [textMessage_('この写真は、もう記録しています。', [seaMenuButton_()])];
      const date = seaPhotoTime_(p.t);
      if (!date) return [textMessage_('写真が古いので、もう一度送ってね。', [seaMenuButton_()])];
      cache_().remove(seaPhotoKey_(userId));
      return [seaRecord_(userId, spot, id, date)];
    }
    case 'pick': {
      const spots = seaSpotsOf_(userId);
      if (!spots.length) return [textMessage_('釣り場は、まだありません。', [seaAddButton_()])];
      const rename = p.k === 'name';
      return [textMessage_(rename ? 'どの釣り場の名前を変える？' : 'どの釣り場をやめる？（記録は残ります）', spots.slice(0, 13).map((s) => (rename
        ? { type: 'postback', label: Array.from(`✏️ ${s.name}`).slice(0, 20).join(''), data: `m=sea&a=name&s=${encodeURIComponent(s.spotId)}`, inputOption: 'openKeyboard', fillInText: '釣り場の名前 ' }
        : postback_(`🗑️ ${s.name}`, `m=sea&a=remove&s=${encodeURIComponent(s.spotId)}`, `🗑️ ${s.name}をやめる`))))];
    }
    case 'name': {
      // 入力欄を開くだけ（返事はしない）。どの釣り場かを10分覚えておく
      const spot = spotOf(p.s);
      if (spot) cache_().put(seaRenameKey_(userId), spot.spotId, SEA_.pendingSeconds);
      return spot ? [] : gone();
    }
    case 'remove': {
      const spot = spotOf(p.s);
      if (!spot) return gone();
      updateRow_('seaSpots', 'spotId', spot.spotId, { isActive: false });
      return [textMessage_(`🗑️ ${spot.name} をやめました（記録は残ります）。`, [seaMenuButton_()])];
    }
    default:
      return seaMenuReply_(event, role);
  }
}

// ---- #テストの見本 ----

/** 見本の値（読みこみなし） */
function seaSampleInfo_() {
  return {
    spot: { name: 'グンカン' },
    ymd: formatDay_(new Date()),
    hm: '06:42',
    port: '赤羽根',
    tide: { cm: 152, pct: 78, stageText: '上げ8分', fromHigh: -63, moon: '中潮', events: '干潮 00:49・満潮 07:45・干潮 13:07・満潮 18:44',
      points: [{ m: 240, cm: 101 }, { m: 300, cm: 118 }, { m: 360, cm: 136 }, { m: 420, cm: 158 }, { m: 465, cm: 163, k: '満潮' }, { m: 480, cm: 162 }] },
    mazume: '朝まづめ',
    wind: { dir: '北西', ms: 6.2, before: 9.1, after: 5.4, trend: '弱まってきた',
      hours: [['04:00', 9.1], ['05:00', 8.0], ['06:00', 7.1], ['07:00', 6.2], ['08:00', 5.4]].map((h) => ({ hm: h[0], ms: h[1], dir: '北西' })) }
  };
}
