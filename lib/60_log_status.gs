/**
 * 60_log_status.gs：機能「📝 記録」のつづいている「はじめ・おわり」（LOgBOT の 05_features/session_status.gs から）
 * 中身：はじめたまま、まだおわっていないものの一覧
 * 呼ばれる（LOgBOT のときのファイル名）：quick_reply（おわるボタン）
 */

/** その人の、はじめたまままだおわっていないもの（移動・出退勤・充電など）の一覧を返す */
function logGetOngoingSessionInfos_(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return [];

  const props = props_().getProperties();
  const infos = [];

  Object.keys(props).forEach(key => {
    const raw = props[key];
    if (key.indexOf(`attendance:lastStart:${uid}`) === 0) {
      infos.push({ command: 'attendance', source: 'place', icon: '🏢', label: '出退勤' });
      return;
    }
    if (key.indexOf(`trip:lastStart:${uid}:`) === 0) {
      const source = key.split(':').slice(-1)[0] || 'trip';
      let data = {};
      try { data = JSON.parse(raw || '{}'); } catch (e) {}
      infos.push({
        command: 'trip',
        source,
        icon: data.icon || '🚙',
        label: data.label || 'Trip',
      });
      return;
    }
    if (key.indexOf(`command:lastStart:${uid}:`) === 0) {
      let data = {};
      try { data = JSON.parse(raw || '{}'); } catch (e) {}
      infos.push({
        command: data.command || key.split(':')[3] || 'command',
        source: data.source || key.split(':')[4] || '',
        icon: data.icon || '',
        label: data.label || '',
      });
    }
  });

  const seen = {};
  const uniq = infos.filter(info => {
    const k = `${info.command}:${info.source}`;
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
  uniq.sort((a, b) => `${a.command}:${a.source}`.localeCompare(`${b.command}:${b.source}`));
  return uniq;
}
