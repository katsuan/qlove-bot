/**
 * 50_weather_hourly.gs：機能「☁️ 天気」の見張り（1時間おき。決めた時間の地点だけ見て、知らせることがあれば push）
 * 呼ばれるところ：50_weather.gs の登録（hourly）→ 00_public.gs の botHourly（入口の hourlyQloveBot。1時間おきのトリガー）
 */

// ---- 見張り（1時間おき） ----

/** 決めた時間の地点だけ見て、知らせることがあれば push。1つの地点でつまずいても、ほかは続ける */
function weatherHourly_(now) {
  const hour = Number(Utilities.formatDate(now, timeZone_(), 'H'));
  const today = formatDay_(now);
  const date = hour >= WEATHER_.eveningFrom ? formatDay_(new Date(now.getTime() + 24 * 3600 * 1000)) : today;
  const notices = weatherNotices_().filter((n) => n.notifyHour === hour && n.lastCheckedDate !== today && canUse_(n.ownerUserId));
  const memo = {};
  const result = { checked: 0, sent: 0, failed: 0, skippedForQuota: 0 };
  notices.forEach((notice) => {
    try {
      const forecast = weatherFetchForecast_(notice.lat, notice.lon, memo);
      const alerts = weatherEvaluate_(forecast, date);
      if (alerts.length) {
        const rows = forecast && forecast.days ? forecast.days[date] : null;
        if (!hasPushRoom_('normal')) result.skippedForQuota += 1;
        else if (push_(notice.targetId, withToolSender_('weather', [weatherNoticeCard_(notice, date, alerts, { now: now, rows: rows })]), 'normal')) result.sent += 1;
        else result.failed += 1;
      }
      updateRow_('weather', 'noticeId', notice.noticeId, { lastCheckedDate: today });
      result.checked += 1;
    } catch (error) {
      result.failed += 1;
      writeLog_('weather:error', `${notice.placeName}：${error.message}`);
    }
  });
  if (result.skippedForQuota) writeLog_('weather:quota', `今月の送れる数が少ないので ${result.skippedForQuota} か所は送らない`);
  return result;
}

