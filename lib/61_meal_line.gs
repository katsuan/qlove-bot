/**
 * 61_meal_line.gs：機能「🍚 しょくじ」の LINE のできごと（文字・写真・ボタン）を受けて返事をする（食事記録ボットの 06_line.webhook.gs から）
 * 返事のカードは 05_ui、記録の流れは 04_usecase。返事はこの機能が送る（カードが断られたら文で送りなおす。08_infra の mealReplyLineMessages_）。
 * 「入力中…」は、くらぶボットの受け口が出す（01_router.gs）。#テスト・使う人の許可は、くらぶボット共通のもの
 * 呼ばれるところ：61_meal.gs の onText・onImage・onPostback（mealHandleEvent_）
 */

// 文字だけで返す結果（目標の更新・管理者・許可待ち・ふつうの文）
const MEAL_TEXT_RESULT_KINDS = ['admin_text', 'permission_pending', 'plain_text'];

// 返事を送れなかったとき、送ってきた人が持ち主なら原因を push で知らせる（ふつうの人には何も送らない）
function mealNotifyAdminOfLineFailure_(event, error, replyError) {
  try {
    const userId = String(event && event.source && event.source.userId || '');
    if (!userId || !mealIsAdminUser_(userId)) return;
    const what = event.type === 'postback' ? `ボタン（${String(event.postback && event.postback.data || '').slice(0, 80)}）` : `「${String(event.message && event.message.text || event.message && event.message.type || '').slice(0, 40)}」`;
    mealPushLineMessages_(userId, [{
      type: 'text',
      text: [
        `（持ち主へ）🍚 ${what} への返事を送れませんでした。`,
        `処理：${String(error && error.message || error).slice(0, 400)}`, // qcheck-ok: G2 持ち主にだけ送る
        replyError ? `返事：${String(replyError && replyError.message || replyError).slice(0, 400)}` : '',
      ].filter(Boolean).join('\n'),
    }]);
  } catch (ignored) {
    // 知らせられなくても止めない
  }
}

// 文字だけの返事に付ける、次にすること（きょうの集計・画面で入力）
function mealNextStepQuickReply_() {
  return {
    items: [
      { type: 'action', action: { type: 'postback', label: '📊 きょうの集計', data: mealPostbackData_({ action: 'showSummary' }), displayText: 'きょうの集計' } },
      { type: 'action', action: { type: 'uri', label: '📝 画面で入力', uri: mealBuildLiffUrl_({ mode: 'input' }) } },
    ],
  };
}

// この機能のボタンの data（くらぶボットの振り分けの m=meal を先に付ける。01_router.gs の postbackReply_）
function mealPostbackData_(params) {
  return `m=meal&${mealBuildQueryString_(params)}`;
}

// 文字だけで返す（次にすることのクイックリプライ付き）
function mealReplyTextWithNext_(replyToken, text) {
  mealReplyLineMessages_(replyToken, [{ type: 'text', text: text, quickReply: mealNextStepQuickReply_() }]);
}

// できごと1つ（使える人の1対1 の文字・写真・この機能のボタン）を処理する。思いがけないエラーは、やさしいことばで返す（持ち主には push で原因も）。
// 返事はここで送るので、くらぶボットには空の返事（[]）を返す
function mealHandleEvent_(event) {
  try {
    mealHandleLineEvent_(event);
  } catch (error) {
    // 中身は実行ログへ。使う人には、やさしい言葉だけ
    mealPublicErrorMessage_(error);
    try {
      if (event && event.replyToken) mealReplyTextWithNext_(event.replyToken, error && error.forUser ? error.message : 'うまくいきませんでした。少し待って、もう一度送ってね。');
    } catch (replyError) {
      // 返事も送れなかったとき：持ち主なら、原因を返事とは別の送り方（push）で知らせる
      mealNotifyAdminOfLineFailure_(event, error, replyError);
    }
  }
  return [];
}

// LINE の名前とアイコン。LINE への問い合わせは6時間覚えておく（返事を速く）
const MEAL_LINE_PROFILE_CACHE_SECONDS = 6 * 60 * 60;
// LINE の名前とアイコンを返す（6時間覚える。読めなければシートの名前）
function mealResolveLineProfile_(userId) {
  return mealMemo_(`lineProfile:${userId}`, () => {
    const cache = cache_();
    const cacheKey = `LINE_PROFILE:${userId}`;
    try {
      const cached = cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch (error) {
      // 読めなければ問い合わせる
    }
    const existingUser = mealGetUserById_(userId);
    const fallbackProfile = { displayName: String(existingUser && existingUser.displayName || '') };
    try {
      const profile = mealGetLineProfile_(userId) || {};
      const result = {
        displayName: String(profile.displayName || fallbackProfile.displayName || ''),
        pictureUrl: String(profile.pictureUrl || ''),
      };
      try {
        cache.put(cacheKey, JSON.stringify(result), MEAL_LINE_PROFILE_CACHE_SECONDS);
      } catch (error) {
        // 覚えられなくても使える
      }
      return result;
    } catch (error) {
      return fallbackProfile;
    }
  });
}

// できごと1つを、ボタン・写真・文字に分けて処理する
function mealHandleLineEvent_(event) {
  if (!event) {
    return;
  }

  const userId = String(event.source && event.source.userId || '').trim();
  if (!userId) {
    return;
  }
  mealSetLineEventUser_(userId);

  if (event.type === 'postback') {
    mealHandleLinePostbackEvent_(event, userId);
    return;
  }

  if (event.type !== 'message' || !event.message) {
    return;
  }

  if (event.message.type === 'image') {
    mealHandleLineImageEvent_(event, userId);
    return;
  }

  if (event.message.type === 'text') {
    mealHandleLineTextEvent_(event, userId);
  }
}

// 文字が届いたとき：記録して、結果に合う形で返す
function mealHandleLineTextEvent_(event, userId) {
  const profile = mealResolveLineProfile_(userId);
  const result = mealHandleMealMessageFlow_(
    userId,
    String(event.message.text || ''),
    String(profile.displayName || ''),
    MEAL_SOURCE.LINE,
    String(profile.pictureUrl || '')
  );

  if (MEAL_TEXT_RESULT_KINDS.indexOf(result.kind) !== -1) {
    // ふつうの文には次にすることを付ける（管理者・許可待ちには付けない）
    if (result.kind === 'plain_text') mealReplyTextWithNext_(event.replyToken, result.text);
    else mealReplyText_(event.replyToken, result.text);
    return;
  }

  // 目標を変えた：あとどれだけかが見える集計カードで返す（見出しに新しい目標）
  if (result.kind === 'target_updated') {
    mealReplyLineMessages_(event.replyToken, mealBuildDailySummaryMessages_(userId, {
      dashboard: result.dashboard,
      headline: result.headline,
      senderProfile: profile,
      withTarget: true,
    }));
    return;
  }

  // しょくじ（ShoQuji）からの記録：ふだんの記録と同じ集計カードで返す。ひとことはカードの中に（3_usecase.shoquji.gs）
  if (result.kind === 'shoquji_logged') {
    mealReplyLineMessages_(event.replyToken, mealBuildDailySummaryMessages_(userId, {
      dashboard: result.dashboard,
      headline: result.headline,
      note: result.note,
      senderProfile: profile,
    }));
    return;
  }

  if (result.kind === 'pending_kcal_selection') {
    mealReplyLineMessages_(event.replyToken, [
      mealBuildPendingKcalSelectionMessage_(result.kcal, result.pendingLogs),
    ]);
    return;
  }

  if (result.kind === 'logged') {
    mealReplyLineMessages_(event.replyToken, mealBuildLoggedReplyMessages_(userId, result.record, result.dashboard, profile));
    return;
  }

  mealReplyLineMessages_(event.replyToken, [
    mealBuildMealInputPromptFlexMessage_(result.parsed, result.draft, profile),
  ]);
}

// 写真が届いたとき：保存して記録に付ける。記録がいくつかあれば、どれに付けるかを聞く
function mealHandleLineImageEvent_(event, userId) {
  const profile = mealResolveLineProfile_(userId);

  try {
    const result = mealAttachMealImageToNearestLog_(userId, {
      displayName: String(profile.displayName || ''),
      messageId: event && event.message && event.message.id,
      timestamp: event && event.timestamp,
    });

    if (result.selectionToken && result.candidateLogs && result.candidateLogs.length) {
      mealReplyLineMessages_(event.replyToken, [
        mealBuildImageAttachChoiceFlexMessage_(result.mealType, result.candidateLogs, result.selectionToken, profile),
      ]);
      return;
    }

    const text = result.linkedLog
      ? `画像を保存して、${result.mealType}の「${result.linkedLog.menu}」に付けました。`
      : `画像を保存しました。${result.mealType}の記録がまだないので、記録したあとに付けられます。`;

    mealReplyTextWithNext_(event.replyToken, text);
  } catch (error) {
    mealReplyText_(event.replyToken, '画像を保存できませんでした。少し待って、もう一度送ってね。');
  }
}

// ボタン（postback）の action ごとの処理
const MEAL_LINE_POSTBACK_HANDLERS = {
  attachMealImage: (event, userId, data) => mealHandleLineImageAttachPostback_(event, userId, data),
  resolvePendingKcal: (event, userId, data) => mealHandleLinePendingKcalPostback_(event, userId, data),
  savePendingMaster: (event, userId, data) => mealHandleLinePendingMasterSavePostback_(event, userId, data),
  showPopularDetail: (event, userId, data) => mealHandleLinePopularDetailPostback_(event, userId, data),
  // だいたいのカロリー（ご飯◯杯分）
  estimateKcal: (event, userId, data) => mealHandleEstimateKcalPostback_(event, userId, data),
  askEstimate: (event, userId, data) => mealHandleAskEstimatePostback_(event, userId, data),
  showSummary: (event, userId) => {
    try {
      mealHandleShowSummaryPostback_(event, userId);
    } catch (error) {
      // 許可待ち・停止はそのまま伝える（ほかは、やさしい言葉で）
      const text = /許可待ち|停止/.test(String(error && error.message || ''))
        ? String(error.message)
        : '集計を出せませんでした。少し待って、もう一度押してね。';
      mealReplyText_(event.replyToken, text);
    }
  },
  logCandidate: (event, userId, data) => mealHandleLogCandidatePostback_(event, userId, data),
  // 20時の知らせを受けとる・やめる（人ごとにえらぶ。押されるたびに、そのとおりにして今のようすを返す）
  notify: (event, userId, data) => mealHandleNotifyPostback_(event, userId, data),
};

// 「🔔 20時の知らせ」のボタン：on=1 で受けとる・0 でやめる。今のようすを文で返す
function mealHandleNotifyPostback_(event, userId, data) {
  mealEnsureProjectSetup_();
  const user = mealEnsureUserCanUseService_(mealEnsureUserExists_(userId, mealResolveLineProfile_(userId).displayName));
  const on = String(data.on || '') === '1';
  if (user.notify !== on) mealUpdateUserProfile_(userId, { notify: on });
  mealReplyTextWithNext_(event.replyToken, on
    ? '🔔 20時に、その日の食事の記録がまだなら知らせます（記録があれば送りません）。'
    : '🔕 20時の知らせは送りません。また受けとるときは「🍚 しょくじ」から。');
}

// 20時の知らせを切りかえるクイックリプライ（いまの逆のもの1つ）
function mealNotifyQuickItem_(user) {
  const on = Boolean(user && user.notify);
  return { type: 'action', action: { type: 'postback', label: on ? '🔕 20時の知らせをやめる' : '🔔 20時に知らせてもらう', data: mealPostbackData_({ action: 'notify', on: on ? '0' : '1' }), displayText: on ? '20時の知らせをやめる' : '20時に知らせてもらう' } };
}

// ボタン（postback）を、action ごとの処理（LINE_POSTBACK_HANDLERS）に回す
function mealHandleLinePostbackEvent_(event, userId) {
  const data = mealParseQueryString_(event && event.postback && event.postback.data);
  const action = String(data.action || '');
  if (!action || !Object.prototype.hasOwnProperty.call(MEAL_LINE_POSTBACK_HANDLERS, action)) {
    return;
  }
  MEAL_LINE_POSTBACK_HANDLERS[action](event, userId, data);
}

// もうカロリーが入っている記録へのお知らせ
function mealBuildAlreadyHasKcalText_(log) {
  return `「${log.menu}」はもう ${mealFormatKcalDisplay_(log.kcal)} kcal で入っています。`;
}

// カロリーを入れるボタン（あとで押されることがある）：その記録がないか、もう入っていれば、そう返して true
function mealReplyIfKcalNotNeeded_(event, userId, data) {
  const log = mealResolveMealLogReference_(data.logId || data.row);
  if (!log || log.userId !== userId) {
    mealReplyTextWithNext_(event.replyToken, 'その記録が見つかりませんでした（消したか、もう入っているかもしれません）。');
    return true;
  }
  if (log.kcal != null) {
    mealReplyTextWithNext_(event.replyToken, mealBuildAlreadyHasKcalText_(log));
    return true;
  }
  return false;
}

// 「🍚 ご飯◯杯分で入れる」：もう入っていなければ、ご飯何杯分かを聞きなおす
function mealHandleAskEstimatePostback_(event, userId, data) {
  if (mealReplyIfKcalNotNeeded_(event, userId, data)) return;
  mealReplyLineMessages_(event.replyToken, [mealBuildEstimateAskMessage_(mealResolveMealLogReference_(data.logId || data.row))]);
}

// 近い候補のボタン：その MYメニューの数字で記録して（未記入ならそこに入れて）集計カードを返す
function mealHandleLogCandidatePostback_(event, userId, data) {
  if ((data.logId || data.row) && mealReplyIfKcalNotNeeded_(event, userId, data)) return;
  const profile = mealResolveLineProfile_(userId);
  try {
    const result = mealSubmitMealCandidate_(userId, {
      displayName: String(profile.displayName || ''),
      logId: data.logId,
      masterKey: data.masterKey,
      meal: data.meal,
      menu: data.menu,
      mealDate: data.mealDate,
    }, MEAL_SOURCE.LINE);

    mealReplyLineMessages_(event.replyToken, mealBuildLoggedReplyMessages_(userId, result.record, result.dashboard, profile));
  } catch (error) {
    mealReplyTextWithNext_(event.replyToken, '候補で記録できませんでした。画面からも記録できます。');
  }
}

// ご飯◯杯分のボタン：未記入の記録にだいたいのカロリーを入れて、集計カードを返す
function mealHandleEstimateKcalPostback_(event, userId, data) {
  if (mealReplyIfKcalNotNeeded_(event, userId, data)) return;
  const profile = mealResolveLineProfile_(userId);
  try {
    const result = mealApplyPendingKcalInput_(userId, {
      logId: data.logId,
      row: data.row,
      kcal: data.kcal,
      estimated: true,
      note: data.note,
      displayName: String(profile.displayName || ''),
    }, MEAL_SOURCE.LINE);
    mealReplyLineMessages_(event.replyToken, mealBuildLoggedReplyMessages_(userId, result.record, result.dashboard, profile));
  } catch (error) {
    mealReplyTextWithNext_(event.replyToken, 'カロリーを入れられませんでした。画面からも入れられます。');
  }
}

// どの未記入に入れるかのボタン：その記録に送られた数を入れて、集計カードを返す
function mealHandleLinePendingKcalPostback_(event, userId, data) {
  if (mealReplyIfKcalNotNeeded_(event, userId, data)) return;
  const profile = mealResolveLineProfile_(userId);
  try {
    const result = mealApplyPendingKcalInput_(userId, {
      logId: data.logId,
      row: data.row,
      kcal: data.kcal,
      displayName: String(profile.displayName || ''),
    }, MEAL_SOURCE.LINE);

    mealReplyLineMessages_(event.replyToken, mealBuildLoggedReplyMessages_(userId, result.record, result.dashboard, profile));
  } catch (error) {
    mealReplyTextWithNext_(event.replyToken, 'カロリーを入れられませんでした。画面からも入れられます。');
  }
}

// 記録したときの返事（集計カード、MYメニューにない品なら保存をすすめるカードも）を返す
function mealBuildLoggedReplyMessages_(userId, record, dashboard, profile) {
  const messages = mealBuildDailySummaryMessages_(userId, {
    dashboard: dashboard,
    record: record,
    headline: `${mealBuildRecordDisplayName_(record)} を記録`,
    senderProfile: profile,
  }).map(mealStripQuickReply_);
  if (mealShouldOfferMasterSave_(record) && !String(record.masterKey || '').trim()) {
    messages.push(mealBuildPendingMasterSavePromptFlexMessage_(record, profile));
  }
  // クイックリプライ（よく記録するもの）は最後のメッセージにだけ付く
  return mealAttachQuickMenus_(messages, dashboard);
}

// メッセージからクイックリプライを外した写しを返す（最後のメッセージにだけ付けるため）
function mealStripQuickReply_(message) {
  const copy = Object.assign({}, message);
  delete copy.quickReply;
  return copy;
}

// 「📒 MYメニューに保存」のボタン：その記録を MYメニューに保存する（もう保存ずみ・消した・ほかの人の記録なら、書かずにそう返す）
function mealHandleLinePendingMasterSavePostback_(event, userId, data) {
  // カードのボタンは何日もあとや2回目にも押される：消した・ほかの人の記録・もう保存ずみなら、書かずにそう返す
  const log = mealResolveMealLogReference_(data.logId || data.row);
  if (!log || log.userId !== userId) {
    mealReplyTextWithNext_(event.replyToken, 'その記録が見つかりませんでした（消したのかもしれません）。');
    return;
  }
  const saved = String(log.masterKey || '').trim() ? mealGetNutritionMaster_(log.masterKey) : null;
  if (saved && String(saved.status || 'active') !== 'disabled') {
    mealReplyTextWithNext_(event.replyToken, `「${mealBuildRecordDisplayName_(log)}」はもうMYメニューにあります。名前を送るだけで記録できます。`);
    return;
  }
  const profile = mealResolveLineProfile_(userId);
  try {
    const result = mealSavePendingLogAsMaster_(userId, {
      logId: data.logId,
      row: data.row,
      displayName: String(profile.displayName || ''),
    }, MEAL_SOURCE.LINE);
    mealReplyTextWithNext_(event.replyToken, QSeason.decorate(`「${mealBuildRecordDisplayName_(result.record)}」をMYメニューに保存しました。次から名前を送るだけで記録できます。`));
  } catch (error) {
    mealReplyTextWithNext_(event.replyToken, 'MYメニューに保存できませんでした。画面からも保存できます。');
  }
}

// よく食べるもののボタン：その品のカードを返す
function mealHandleLinePopularDetailPostback_(event, userId, data) {
  const profile = mealResolveLineProfile_(userId);
  const item = mealFindPopularMenuByGroupKey_(userId, data.groupKey);
  if (!item) {
    mealReplyTextWithNext_(event.replyToken, 'そのメニューが見つかりませんでした。');
    return;
  }

  mealReplyLineMessages_(event.replyToken, [
    mealBuildPopularMenuDetailFlexMessage_(item, profile),
  ]);
}

// 写真の付け先のボタン：えらばれた記録に写真を付ける
function mealHandleLineImageAttachPostback_(event, userId, data) {
  const profile = mealResolveLineProfile_(userId);
  try {
    const result = mealAttachMealImageBySelection_(userId, {
      displayName: String(profile.displayName || ''),
      selectionToken: data.token,
      logId: data.logId,
      row: data.row,
    });
    mealReplyTextWithNext_(event.replyToken, `画像を${result.mealType}の「${result.linkedLog.menu}」に付けました。`);
  } catch (error) {
    mealReplyText_(event.replyToken, '画像を付けられませんでした。少し待って、もう一度画像を送ってね。');
  }
}

// 「きょうの集計」：集計カードを返す
function mealHandleShowSummaryPostback_(event, userId) {
  const user = mealEnsureUserExists_(userId);
  mealEnsureUserCanUseService_(user);
  const profile = mealResolveLineProfile_(userId);
  mealReplyLineMessages_(event.replyToken, mealBuildDailySummaryMessages_(userId, {
    dashboard: mealGetDashboardData_(userId),
    headline: 'きょうの集計',
    senderProfile: profile,
    withTarget: true,
  }));
}
