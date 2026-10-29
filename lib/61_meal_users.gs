/**
 * 61_meal_users.gs：しょくじの人（シート「meal_users」）：読む・作る・目標や設定を直す（食事記録ボットの 03_domain.user.gs から）
 * だれが使えるか・持ち主かは、くらぶボットの決まり（シート「使う人」と持ち主。02_config.gs の roleOf_）。
 * 前の「許可待ち・承認・停止」と管理者への申請の知らせは、くらぶボットの「🙋 使いたい」「✅ 許す」にまとめた（status の列は残すが見ない）
 * 呼ばれるところ：しょくじの機能の 04_usecase・06_line・07_web
 */

// ユーザーのシートは呼び出し1回につき1回だけ読む（書いたら覚え書きを捨てる）
function mealGetUserRows_() {
  return mealMemo_('users', () => {
    const sheet = mealGetSpreadsheet_().getSheetByName(MEAL_SHEET.USERS);
    if (!sheet) return [];
    return sheet.getDataRange().getValues().slice(1);
  });
}

// LINE のユーザー ID で使う人を1人さがす（なければ null）
function mealGetUserById_(userId) {
  const row = mealGetUserRows_().find(record => record[MEAL_USER_COL_INDEX.userId - 1] === userId);
  return row ? mealMapUserRow_(row) : null;
}

// 使う人を全員返す
function mealListUsers_() {
  return mealGetUserRows_().map(mealMapUserRow_);
}

// 使う人がいなければ作り（許可待ちなら管理者へ知らせる）、名前・アイコンが変わっていれば直す。その人を返す
function mealEnsureUserExists_(userId, displayName, pictureUrl) {
  displayName = mealClampText_(displayName, MEAL_TEXT_LIMIT.displayName);
  pictureUrl = pictureUrl == null ? pictureUrl : mealClampText_(pictureUrl, MEAL_TEXT_LIMIT.url);
  const existing = mealGetUserById_(userId);
  if (existing) {
    if (
      (displayName && existing.displayName !== displayName) ||
      (pictureUrl != null && existing.pictureUrl !== String(pictureUrl || ''))
    ) {
      mealUpdateUserProfile_(userId, {
        displayName: displayName,
        pictureUrl: pictureUrl,
      });
      return mealGetUserById_(userId);
    }
    return existing;
  }

  const sheet = mealGetSpreadsheet_().getSheetByName(MEAL_SHEET.USERS);
  if (!sheet) {
    throw new Error('users sheet not found');
  }

  // 同じ人の最初の呼び出しが2つ重なっても、行が2つできないように
  const created = mealWithSheetLock_(() => {
    mealForgetMemo_('users');
    if (mealGetUserById_(userId)) return null;
    const now = new Date();
    const user = {
      userId: userId,
      displayName: displayName || '',
      pictureUrl: String(pictureUrl || ''),
      calorieTarget: 2000,
      goalType: MEAL_GOAL_TYPE.KEEP,
      notify: false, // 20時の知らせは、受けとると決めた人だけ（送れる数を分け合うため。しょくじの設定・「🍚 しょくじ」の 🔔 で変える）
      status: 'active',
      createdAt: now,
      updatedAt: now,
      favorites: '[]',
      richMenuId: '',
      richMenuKey: '',
    };
    sheet.appendRow(mealToSheetRow_(MEAL_USER_COLUMNS, user));
    mealForgetMemo_('users');
    return user;
  });
  if (!created) return mealGetUserById_(userId);
  return created;
}

// 目標カロリーを直す
function mealUpdateUserCalorieTarget_(userId, calorieTarget) {
  return mealUpdateUserProfile_(userId, { calorieTarget: calorieTarget });
}

// 送られた項目だけ直す。1行まとめて1回で書く（文字は safeCell を通す。読んだ値は ' が外れているので、そのままは書かない）
function mealUpdateUserProfile_(userId, patch) {
  const sheet = mealGetSpreadsheet_().getSheetByName(MEAL_SHEET.USERS);
  if (!sheet) return false;
  // 読んでから書くまでに、ほかの呼び出しが同じ行を書くと消してしまうので、1人ずつ
  return mealWithSheetLock_(() => mealWriteUserProfile_(sheet, userId, patch));
}

// シートの、その人の行に、patch の項目だけ書く（見つからなければ false）
function mealWriteUserProfile_(sheet, userId, patch) {
  const values = sheet.getDataRange().getValues();
  const rowIndex = values.findIndex(row => row[MEAL_USER_COL_INDEX.userId - 1] === userId);
  if (rowIndex < 1) return false;

  const has = key => Object.prototype.hasOwnProperty.call(patch, key);
  const row = MEAL_USER_COLUMNS.map((key, index) => (values[rowIndex][index] === undefined ? '' : values[rowIndex][index]));
  const set = (key, value) => {
    row[MEAL_USER_COL_INDEX[key] - 1] = value;
  };
  if (has('displayName')) set('displayName', mealClampText_(patch.displayName, MEAL_TEXT_LIMIT.displayName));
  if (has('pictureUrl')) set('pictureUrl', mealClampText_(patch.pictureUrl, MEAL_TEXT_LIMIT.url));
  if (has('calorieTarget')) set('calorieTarget', mealToNullableNumber_(patch.calorieTarget));
  if (has('goalType')) set('goalType', mealNormalizeGoalType_(patch.goalType));
  if (has('notify')) set('notify', Boolean(patch.notify));
  if (has('favorites')) set('favorites', JSON.stringify(mealNormalizeFavorites_(patch.favorites)));
  if (has('richMenuId')) set('richMenuId', String(patch.richMenuId || ''));
  if (has('richMenuKey')) set('richMenuKey', mealClampText_(patch.richMenuKey, 2000));
  if (has('status')) set('status', mealIsKnownUserStatus_(patch.status) ? String(patch.status) : 'active');
  set('updatedAt', new Date());

  sheet.getRange(rowIndex + 1, 1, 1, row.length).setValues([row.map(value => safeCell_(value))]); // qcheck-ok: G1 safeCell を通した行
  mealForgetMemo_('users');
  return true;
}

// よく記録するものに固定した MYメニュー（masterKey の並び）
function mealParseFavorites_(value) {
  if (Array.isArray(value)) return mealNormalizeFavorites_(value);
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    return mealNormalizeFavorites_(JSON.parse(text));
  } catch (error) {
    return [];
  }
}

// よく記録するものの固定（MYメニューのキーの並び）を、重なりなし・上限までにそろえる
function mealNormalizeFavorites_(list) {
  const seen = {};
  return (Array.isArray(list) ? list : [])
    .map(key => mealClampText_(key, MEAL_TEXT_LIMIT.key))
    .filter(key => key && !seen[key] && (seen[key] = true))
    .slice(0, MEAL_FAVORITES_LIMIT);
}

// 管理者（くらぶボットの持ち主）なら true
function mealIsAdminUser_(userId) {
  return Boolean(userId) && roleOf_(String(userId || '').trim()) === 'owner';
}

// 使える人でなければ、許可待ち・停止のことばでエラーにする。使える人ならその人を返す
function mealEnsureUserCanUseService_(user) {
  if (!user) {
    throw new Error('user not found');
  }
  if (canUse_(user.userId)) {
    return user;
  }
  throw mealUserError_('使うには、このボットの持ち主の許可が要ります。');
}

// 画面に渡す許可のようす（使えるか・管理者か・お知らせ）を返す
function mealSerializeUserPermission_(user) {
  const safeUser = user || {};
  const canUse = canUse_(String(safeUser.userId || ''));
  return {
    status: canUse ? 'active' : 'pending',
    canUse: canUse,
    isAdmin: mealIsAdminUser_(safeUser.userId),
    notify: safeUser.notify === true,
  };
}

// シートの1行を、使う人のオブジェクトにする（列が1つずれた古い行も読む）
function mealMapUserRow_(row) {
  const currentMapped = {
    userId: String(row[MEAL_USER_COL_INDEX.userId - 1] || ''),
    displayName: String(row[MEAL_USER_COL_INDEX.displayName - 1] || ''),
    pictureUrl: String(row[MEAL_USER_COL_INDEX.pictureUrl - 1] || ''),
    calorieTarget: mealToNullableNumber_(row[MEAL_USER_COL_INDEX.calorieTarget - 1]),
    goalType: mealNormalizeGoalType_(row[MEAL_USER_COL_INDEX.goalType - 1]),
    notify: mealToBoolean_(row[MEAL_USER_COL_INDEX.notify - 1]),
    status: mealNormalizeUserStatus_(row[MEAL_USER_COL_INDEX.status - 1]),
    createdAt: row[MEAL_USER_COL_INDEX.createdAt - 1] || null,
    updatedAt: row[MEAL_USER_COL_INDEX.updatedAt - 1] || null,
    favorites: mealParseFavorites_(row[MEAL_USER_COL_INDEX.favorites - 1]),
    richMenuId: String(row[MEAL_USER_COL_INDEX.richMenuId - 1] || ''),
    richMenuKey: String(row[MEAL_USER_COL_INDEX.richMenuKey - 1] || ''),
  };

  const shiftedMapped = {
    userId: String(row[0] || ''),
    displayName: String(row[1] || ''),
    pictureUrl: String(row[2] || ''),
    calorieTarget: mealToNullableNumber_(row[3]),
    goalType: mealNormalizeGoalType_(row[4]),
    notify: mealToBoolean_(row[5]),
    status: mealNormalizeUserStatus_(row[6]),
    createdAt: row[7] || null,
    updatedAt: row[8] || null,
    favorites: [],
    richMenuId: '',
    richMenuKey: '',
  };

  if (mealIsPlausibleLegacyShiftedUserRow_(currentMapped, shiftedMapped)) {
    return shiftedMapped;
  }

  return currentMapped;
}

// 列が1つずれた古い行らしいか（ずらして読むと値がそろうか）
function mealIsPlausibleLegacyShiftedUserRow_(currentMapped, shiftedMapped) {
  return !mealIsKnownUserStatus_(currentMapped.status) &&
    mealIsKnownUserStatus_(shiftedMapped.status) &&
    currentMapped.calorieTarget == null &&
    shiftedMapped.calorieTarget != null;
}

// 目標の種類（減らす・保つ・増やす）にそろえる。知らない値なら「保つ」
function mealNormalizeGoalType_(value) {
  const text = String(value || '').trim();
  return Object.values(MEAL_GOAL_TYPE).includes(text) ? text : MEAL_GOAL_TYPE.KEEP;
}

// 許可のようすの文字を前後の空白なしで返す
function mealNormalizeUserStatus_(value) {
  const text = String(value || '').trim();
  return mealIsKnownUserStatus_(text) ? text : text;
}

// 許可のようすが active・inactive・pending のどれかなら true
function mealIsKnownUserStatus_(value) {
  return ['active', 'inactive', 'pending'].includes(String(value || '').trim());
}
