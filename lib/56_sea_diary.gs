/**
 * 56_sea_diary.gs：機能「🎣 釣り」で、うみくるの日記から送られた釣果を読む
 *
 * うみくるの日記の「くらぶボットに送る」は、LINE でこのボットのトークを開き、入力欄に次の文を入れる（うみくるの js/diary.js の botText）：
 *   📔 うみくるの日記 2026-11-12
 *   📍 34.4370,133.7760 下津井（倉敷市）
 *   潮：下津井（tide736.net）
 *   06:42 アジ 2匹 20cm｜潮 上げ2分 32cm（60%）
 * 読んだら：
 *   1. 釣り場：200m 以内の釣り場。なければ足す（名前は日記の場所の名前）
 *   2. その日・その釣り場の記録と、時刻が SEA_.diaryMatchMin 分以内のものを同じ釣果とみなす。魚の名前（「魚」は名前なし）がちがえば直し、
 *      時刻がちがえば直す（潮と風を読みなおす）。合うものがなければ、記録を足す
 *   3. 日記の潮（うみくるの港＝tide736 の値）は、シート「うみくるの日記」に（同じ日・釣り場・時刻なら書きかえ。何度送っても増えない）
 *   4. その日1日の潮（潮位：20分ごと … ／ 満干：…）があれば、シート「うみくるの潮」に残し、その日・その釣り場の記録の潮をこれで直す。
 *      このあとのカード（グラフも）も、気象庁の潮位表のかわりにこの潮で（56_sea_tide.gs の seaInfoAt_）
 * 呼ばれるところ：56_sea_spots.gs の seaTextReply_（1対1・使える人だけ）
 */

/**
 * 日記の文を読む。{ ymd, lat, lon, place, port, items: [{ hm, min, fish, count, size, tideCm, tidePct, stageText }],
 *   cm（その日の20分ごとの潮位。72か73こ）, events（満潮・干潮 [{ k, time, m, cm }]） }。読めなければ null
 */
function seaParseDiary_(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim());
  const head = lines[0].match(SEA_DIARY_HEAD_);
  if (!head) return null;
  const out = { ymd: head[1], lat: null, lon: null, place: '', port: '', items: [], cm: null, events: [] };
  lines.slice(1).forEach((l) => {
    const p = l.match(/^📍\s*(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)(?:\s+(.+))?$/u);
    if (p) {
      out.lat = Number(p[1]);
      out.lon = Number(p[2]);
      out.place = cleanText_(p[3] || '', 30);
      return;
    }
    const port = l.match(/^潮：(.+)$/u);
    if (port) {
      out.port = cleanText_(port[1], 40);
      return;
    }
    // その日1日の潮（20分ごとの潮位）と、満潮・干潮
    const fine = l.match(/^潮位：20分ごと\s+([\d\s.-]+)$/u);
    if (fine) {
      const cms = fine[1].trim().split(/\s+/).map(Number);
      if (cms.length >= 72 && cms.length <= 73 && cms.every((v) => Number.isFinite(v) && Math.abs(v) < 2000)) out.cm = cms;
      return;
    }
    const marks = l.match(/^満干：(.+)$/u);
    if (marks) {
      out.events = marks[1].split('・').map((x) => x.trim().match(/^(満潮|干潮)\s+(\d{1,2}):(\d\d)\s+(-?\d+(?:\.\d+)?)$/u)).filter(Boolean)
        .map((m) => ({ k: m[1], time: `${m[2].padStart(2, '0')}:${m[3]}`, m: Number(m[2]) * 60 + Number(m[3]), cm: Math.round(Number(m[4])) }))
        .filter((e) => e.m < 1440);
      return;
    }
    const it = l.match(/^(\d{1,2}):(\d\d)\s+([^｜]+?)(?:｜潮\s+(\S+)\s+(\d+(?:\.\d+)?)cm(?:（(\d+)%）)?)?$/u);
    if (!it || Number(it[1]) > 23 || Number(it[2]) > 59) return;
    const words = it[3].split(/\s+/);
    const count = words.find((w) => /^\d+匹$/.test(w)) || '';
    const size = words.find((w) => /^\d+(?:\.\d+)?cm$/.test(w)) || '';
    const fish = words.filter((w) => w !== count && w !== size).join(' ');
    out.items.push({
      hm: `${it[1].padStart(2, '0')}:${it[2]}`,
      min: Number(it[1]) * 60 + Number(it[2]),
      fish: cleanText_(fish === '魚' ? '' : fish, SEA_.labelMax),
      count: count.replace('匹', ''),
      size: size.replace('cm', ''),
      tideCm: it[5] == null ? '' : Math.round(Number(it[5])),
      tidePct: it[6] == null ? '' : Number(it[6]),
      stageText: it[4] && it[4] !== '—' ? cleanText_(it[4], 10) : ''
    });
  });
  out.items = out.items.slice(0, SEA_.diaryMaxItems);
  return out;
}

/** 日記の文を受けとって、記録を合わせる。返事のメッセージを返す */
function seaDiaryReply_(userId, text) {
  const d = seaParseDiary_(text);
  if (!d || d.lat == null || !d.items.length) return [textMessage_(`${UMIQRU_.name}の日記が読めませんでした。${UMIQRU_.name}の日記の「${BOT_NAME_}に送る」から、文を変えずに送ってね。`, [seaMenuButton_()])];
  const out = seaAddSpot_(userId, d.lat, d.lon, d.place);
  if (out.error) return [textMessage_(out.error, [seaMenuButton_()])];
  const spot = out.spot;
  // その日1日の潮が来ていれば、先に残す（このあと足す・直す記録も、この潮で）
  const tideDay = d.cm ? seaSaveUmiTide_(userId, spot, d) : null;
  const logs = () => readRows_('seaLogs').filter((r) => String(r.userId || '').trim() === userId && String(r.spotId || '').trim() === spot.spotId && r.at && formatDay_(new Date(r.at)) === d.ymd);
  const used = {};
  const lines = [];
  let last = null;
  d.items.forEach((it) => {
    const date = new Date(`${d.ymd}T${it.hm}:00+09:00`);
    const near = logs()
      .filter((r) => !used[r.recordId] && Math.abs(new Date(r.at).getTime() - date.getTime()) <= SEA_.diaryMatchMin * 60e3)
      .sort((a, b) => Math.abs(new Date(a.at).getTime() - date.getTime()) - Math.abs(new Date(b.at).getTime() - date.getTime()))[0];
    const name = it.fish || '魚';
    let recordId;
    if (near) {
      recordId = String(near.recordId);
      const changes = [];
      if (it.fish && it.fish !== String(near.label || '').trim()) {
        updateRow_('seaLogs', 'recordId', recordId, { label: it.fish });
        changes.push('名前');
      }
      if (Math.abs(new Date(near.at).getTime() - date.getTime()) >= 60e3) {
        updateRow_('seaLogs', 'recordId', recordId, seaLogFields_(seaInfoAt_(spot, date)));
        changes.push('時刻');
      }
      lines.push(`・${it.hm.replace(/^0/, '')} ${name}：${changes.length ? `${changes.join('と')}を直しました` : 'そのまま'}`);
    } else {
      recordId = seaAppendRecord_(userId, spot, `d${d.ymd.replace(/-/g, '')}${it.hm.replace(':', '')}`, date, it.fish).recordId;
      lines.push(`・${it.hm.replace(/^0/, '')} ${name}：足しました`);
    }
    used[recordId] = true;
    seaSaveDiaryRow_(userId, spot, d, it, recordId);
    last = { recordId: recordId, date: date };
  });
  // その日・その釣り場の記録の潮を、送られた潮で直す
  let retided = 0;
  if (tideDay) {
    logs().forEach((r) => {
      const hm = Utilities.formatDate(new Date(r.at), timeZone_(), 'HH:mm');
      const tide = seaTideAt_(tideDay, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)));
      if (!tide) return;
      tide.moon = seaMoonTitle_(d.ymd);
      updateRow_('seaLogs', 'recordId', String(r.recordId), seaTideFields_(tide, tideDay.port));
      retided += 1;
    });
  }
  const tideNote = tideDay
    ? `\n\n潮は ${tideDay.port}（${NAMES_TIDE736_}）の1日の潮で直しました（${retided}件）。シート「うみくるの潮」に残しています。`
    : d.port ? `\n\n${d.port} の潮は、シート「うみくるの日記」に残しました。` : '';
  const head = textMessage_(`📔 ${dayLabel_(d.ymd)} ${spot.name}の${UMIQRU_.name}の日記を、記録に合わせました（${d.items.length}件）。\n${lines.join('\n')}${tideNote}`);
  const row = readRows_('seaLogs').find((r) => String(r.recordId) === last.recordId);
  return [head].concat(seaCardsOf_(userId, seaInfoAt_(spot, new Date(row ? row.at : last.date)), last.recordId, String((row && row.messageId) || '').trim()));
}

/** 日記の釣果1つを、シート「うみくるの日記」に（同じ人・釣り場・日・時刻なら書きかえ） */
function seaSaveDiaryRow_(userId, spot, d, it, recordId) {
  const diaryId = sha256Hex_(`${userId}|${spot.spotId}|${d.ymd}|${it.hm}`).slice(0, 24);
  const data = {
    userId: userId, ymd: d.ymd, at: new Date(`${d.ymd}T${it.hm}:00+09:00`), spotId: spot.spotId, place: d.place || spot.name, lat: d.lat, lon: d.lon, port: d.port,
    fish: it.fish, count: it.count, size: it.size, tideCm: it.tideCm, tidePct: it.tidePct, stageText: it.stageText, recordId: recordId
  };
  if (readRows_('seaDiary').some((r) => String(r.diaryId) === diaryId)) updateRow_('seaDiary', 'diaryId', diaryId, data);
  else appendRow_('seaDiary', Object.assign({ diaryId: diaryId, createdAt: new Date(), updatedAt: new Date() }, data));
}

/** 送られた1日の潮を、シート「うみくるの潮」に（同じ人・釣り場・日なら書きかえ）。seaUmiTideDay_ と同じ形の潮を返す */
function seaSaveUmiTide_(userId, spot, d) {
  const key = sha256Hex_(`${userId}|${spot.spotId}|${d.ymd}`).slice(0, 24);
  const port = String(d.port || '').replace(/（.*$/u, '').trim() || '港';
  const data = { userId: userId, spotId: spot.spotId, ymd: d.ymd, port: port, cm: d.cm.join('_'), events: JSON.stringify(d.events) };
  if (readRows_('seaTide').some((r) => String(r.key) === key)) updateRow_('seaTide', 'key', key, data);
  else appendRow_('seaTide', Object.assign({ key: key, createdAt: new Date(), updatedAt: new Date() }, data));
  return seaUmiDayOf_(port, d.cm, d.events);
}

/** その釣り場・その日の、うみくるから送られた潮（seaTideAt_ に渡せる形）。なければ null */
function seaUmiTideDay_(spotId, ymd) {
  const r = readRows_('seaTide').find((x) => String(x.spotId || '').trim() === String(spotId) && String(x.ymd || '').trim() === ymd);
  if (!r) return null;
  try {
    const cm = String(r.cm).split('_').map(Number);
    if (cm.length < 72 || cm.some((v) => !Number.isFinite(v))) return null;
    return seaUmiDayOf_(String(r.port || ''), cm, JSON.parse(String(r.events || '[]')));
  } catch (error) {
    return null;
  }
}

/** 20分ごとの潮位と満潮・干潮から、seaTideAt_ に渡せる1日の潮（fine … 20分ごとの点。hourly … 毎時） */
function seaUmiDayOf_(port, cm, events) {
  const list = (events || []).slice().sort((a, b) => a.m - b.m);
  return {
    port: port,
    fine: cm.map((v, k) => ({ m: k * 20, cm: v })),
    hourly: Array.from({ length: 24 }, (_, h) => cm[h * 3]),
    prevHour: null,
    nextHour: cm.length > 72 ? cm[72] : null,
    own: list,
    events: list
  };
}
