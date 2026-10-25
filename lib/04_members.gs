/**
 * 04_members.gs：持ち主（ツール管理者）・持ち主が許した人（ユーザー）と、くらぶボット共通のカード
 *
 * 持ち主の決め方（LOgBOT と同じ）
 *   1. ボットとの1対1 で「🔑 持ち主の登録」を押す（か「#持ち主」と送る）。候補として10分だけ覚える
 *   2. システム管理者が GAS エディタで adoptOwner を実行する（LINE だけでは持ち主になれない）
 * 使う人の決め方
 *   友だちになった人が「🙋 使いたいと伝える」→ 持ち主にカード（「✅ 許す」「やめておく」。クイックリプライにも）
 *   1回きりの操作だが、押されるたびにいまの状態を見て返すので、カードに置いてよい（ux.md の H2）
 * 呼ばれるところ：01_router.gs（友だちになった・#持ち主・postback の m=core）と、機能のカード（coreQuick_・notAllowedText_）
 */

const OWNER_CANDIDATE_PROP_ = 'OWNER_CANDIDATE';

/** 「🔑 持ち主の登録」：押した人を持ち主の候補として10分覚える（決めるのは GAS エディタの adoptOwner）。返事の文を返す */
function ownerClaimReply_(userId) {
  if (!userId) return textMessage_('持ち主の登録は、ボットとの1対1 のトークでしてね。');
  if (userId === ownerUserId_()) return textMessage_('あなたは、このボットの持ち主として登録されています。', coreQuick_('owner'));
  props_().setProperty(OWNER_CANDIDATE_PROP_, JSON.stringify({ userId: userId, at: Date.now() }));
  return textMessage_('🔑 持ち主の登録を受けつけました。\n10分以内に、このボットを作った人が GAS エディタで adoptOwner を実行すると、持ち主になります。');
}

/** 「🙋 使いたいと伝える」：持ち主に知らせる（1人1日1回まで。push を使うため） */
function memberRequestReply_(event) {
  const userId = userIdOf_(event);
  const owner = ownerUserId_();
  if (!userId) return textMessage_('1対1 のトークで押してね。');
  if (!owner) return textMessage_('まだ持ち主が決まっていません。');
  if (canUse_(userId)) return textMessage_('もう使えます。', coreQuick_(roleOf_(userId)));
  const key = `REQUEST_${userId}`;
  if (cache_().get(key)) return textMessage_('持ち主に伝えてあります。許されたら、ここに知らせが届きます。');
  cache_().put(key, '1', MEMBER_REQUEST_SECONDS_);

  const name = displayNameOf_(userId) || '（名前を読めませんでした）';
  if (memberRow_(userId)) updateRow_('members', 'userId', userId, { displayName: name, status: 'requested' });
  else appendRow_('members', { userId: userId, displayName: name, status: 'requested', createdAt: new Date(), updatedAt: new Date() });

  const sent = push_(owner, [buildRequestCard_(userId, name)], 'high');
  return textMessage_(sent ? '持ち主に伝えました。許されたら、ここに知らせが届きます。' : '持ち主に伝えられませんでした。少しあとで、もう一度押してね。');
}

/**
 * 持ち主への「🙋 使いたい」の知らせのカード。ボタンは押されるたびに、いまの状態（使いたいと伝えているところか）を見て返すので、
 * カードに置いてよい（ux.md の H2）。何日もあとに押されても、やめさせた人をまた許してしまうことはない
 */
function buildRequestCard_(userId, name, options) {
  const mark = options && options.sample ? '🧪 ' : '';
  const card = bubble_(
    `${mark}🙋 ${name}さんが、${BOT_NAME_}を使いたいそうです`,
    header_(`${mark}🙋 使いたい人`, BOT_NAME_),
    [
      { type: 'text', text: `${name}さん`, size: 'lg', weight: 'bold', wrap: true },
      smallText_('許すと、天気の知らせなどの機能を使えるようになります。あとでやめさせるときは「👥 使う人」から。', { color: '#4B5563' })
    ],
    [
      { type: 'button', style: 'primary', color: BOT_COLOR_, height: 'sm', action: { type: 'postback', label: '✅ 許す', data: `m=core&a=allow&u=${encodeURIComponent(userId)}`, displayText: `✅ ${name}さんを許す` } },
      postbackButton_('やめておく', `m=core&a=deny&u=${encodeURIComponent(userId)}`)
    ]
  );
  return withQuickReply_(card, [
    postback_('✅ 許す', `m=core&a=allow&u=${encodeURIComponent(userId)}`, `✅ ${name}さんを許す`),
    postback_('やめておく', `m=core&a=deny&u=${encodeURIComponent(userId)}`, `${name}さんはやめておく`)
  ]);
}

/**
 * 持ち主が「✅ 許す」「やめておく」「🚫 やめさせる」を押したとき。押されるたびに、いまの状態を見て返す：
 *   許す・やめておく … 相手が「使いたい」と伝えているとき（requested）だけ。ほかは、もう決めたことをやさしく返す
 *   やめさせる       … 使える人（allowed）のときだけ
 */
function memberDecisionReply_(action, userId) {
  const row = userId ? memberRow_(userId) : null;
  if (!row) return textMessage_('この人は見つかりませんでした（もう決めたかもしれません）。', [postback_('👥 使う人', 'm=core&a=members')]);
  const name = cleanText_(row.displayName, 30) || '（名前なし）';
  const status = String(row.status).trim();
  if ((action === 'allow' || action === 'deny') && status !== 'requested' && status !== 'allowed') {
    return textMessage_(`この知らせは前のものです（${name}さんは${status === 'removed' ? 'やめさせています' : 'やめておきました'}）。また使いたいときは、相手に「🙋 使いたいと伝える」を押してもらってね。`, [postback_('👥 使う人', 'm=core&a=members')]);
  }
  if (action === 'allow') {
    if (status === 'allowed') return textMessage_(`${name}さんは、もう使えます。`, [postback_('👥 使う人', 'm=core&a=members')]);
    updateRow_('members', 'userId', userId, { status: 'allowed' });
    push_(userId, [textMessage_(QSeason.decorate('✅ 持ち主が許してくれました。下のボタンから使いはじめられます。'), coreQuick_('member'))], 'high');
    return textMessage_(`✅ ${name}さんを許しました。`, [postback_('👥 使う人', 'm=core&a=members')]);
  }
  if (action === 'deny') {
    if (status === 'allowed') return textMessage_(`${name}さんは、もう許しています。やめさせるときは「👥 使う人」から。`, [postback_('👥 使う人', 'm=core&a=members')]);
    updateRow_('members', 'userId', userId, { status: 'denied' });
    return textMessage_(`${name}さんは、やめておきました（相手には知らせません）。`);
  }
  // unallow：やめさせる。その人が機能に入れたもの（天気の地点など）も止める
  if (status !== 'allowed') return textMessage_(`${name}さんは、もう使えないようになっています。`, [postback_('👥 使う人', 'm=core&a=members')]);
  updateRow_('members', 'userId', userId, { status: 'removed' });
  Object.keys(MODULES_).forEach((k) => MODULES_[k].onMemberRemoved && MODULES_[k].onMemberRemoved(userId));
  return textMessage_(`🚫 ${name}さんをやめさせました（入れていた知らせも止めました）。`, [postback_('👥 使う人', 'm=core&a=members')]);
}

/** シート「使う人」を { userId, displayName, status } の並びにする（カード用） */
function membersForCard_() {
  return readRows_('members').map((row) => ({
    userId: String(row.userId || '').trim(),
    displayName: cleanText_(row.displayName, 30),
    status: String(row.status || '').trim()
  })).filter((m) => m.userId);
}

// ---- くらぶボット共通のカード・クイックリプライ ----

/** 次に押せるもの：使える人には機能の一覧、まだの人には「🙋 使いたい」か「🔑 持ち主の登録」 */
function coreQuick_(role) {
  if (!role) return ownerUserId_() ? [postback_('🙋 使いたいと伝える', 'm=core&a=request')] : [postback_('🔑 持ち主の登録', 'm=core&a=owner')];
  return [
    ...enabledModules_().filter((m) => m.menu).map((m) => postback_(`${m.emoji} ${m.name}`, `m=${m.key}&a=menu`)),
    postback_('🧩 機能', 'm=core&a=modules'),
    role === 'owner' ? postback_('👥 使う人', 'm=core&a=members') : null
  ].filter(Boolean);
}

/** 🧩 機能の一覧（このボットでできること） */
function buildModulesCard_(role, options) {
  const mark = options && options.sample ? '🧪 ' : '';
  const modules = enabledModules_();
  const rows = modules.map((m) => ({
    type: 'box',
    layout: 'vertical',
    contents: [
      { type: 'text', text: `${m.emoji} ${m.name}`, size: 'sm', weight: 'bold', wrap: true },
      smallText_(m.desc || '')
    ]
  }));
  const card = bubble_(
    `${mark}🧩 ${BOT_NAME_}でできること：${modules.map((m) => m.name).join('・') || 'まだありません'}`,
    header_(`${mark}🧩 できること`, BOT_NAME_),
    [
      ...(rows.length ? rows : [smallText_('いまは使える機能がありません（シート「機能」で切っています）', { size: 'sm' })]),
      role ? null : smallText_('使うには、このボットの持ち主の許可が要ります。')
    ]
  );
  // ツールとつなぐ（ページから呼ぶ機能を使うとき）は、ここからだけ出す
  return withQuickReply_(card, coreQuick_(role).concat(role ? [postback_('🔗 ツールとつなぐ', 'm=core&a=link')] : []));
}

/** 👥 使う人（持ち主だけ） */
function buildMembersCard_(members, options) {
  const mark = options && options.sample ? '🧪 ' : '';
  const allowed = members.filter((m) => m.status === 'allowed');
  const card = bubble_(
    `${mark}👥 使う人：${allowed.length ? allowed.map((m) => m.displayName || '（名前なし）').join('・') : 'まだいません'}`,
    header_(`${mark}👥 使う人`, '持ち主が許した人'),
    [
      smallText_('このボットの友だちになった人が「🙋 使いたいと伝える」を押すと、持ち主に知らせが届きます。許した人だけが使えます。', { color: '#4B5563' }),
      ...(allowed.length
        ? allowed.map((m) => ({
          type: 'box',
          layout: 'horizontal',
          spacing: 'sm',
          contents: [
            { type: 'text', text: `🙂 ${m.displayName || '（名前なし）'}`, size: 'sm', weight: 'bold', wrap: true, flex: 3, gravity: 'center' },
            // 押されるたびに、まだ使える人かを見て返す（もうやめさせていれば、そう返す）
            { type: 'button', style: 'link', height: 'sm', flex: 0, action: { type: 'postback', label: '🚫 やめさせる', data: `m=core&a=unallow&u=${encodeURIComponent(m.userId)}`, displayText: `🚫 ${m.displayName || '名前なし'}さんをやめさせる` } }
          ]
        }))
        : [smallText_('まだいません（持ち主だけが使えます）', { size: 'sm' })])
    ]
  );
  // クイックリプライにも同じものを出す
  return withQuickReply_(card, allowed.slice(0, 11).map((m) => postback_(`🚫 ${m.displayName || '名前なし'}`, `m=core&a=unallow&u=${encodeURIComponent(m.userId)}`, `🚫 ${m.displayName || '名前なし'}さんをやめさせる`)).concat([postback_('🧩 機能', 'm=core&a=modules')]));
}

/** はじめのあいさつ（友だちになったとき） */
function buildWelcomeCard_(role) {
  const hasOwner = Boolean(ownerUserId_());
  const modules = enabledModules_();
  const card = bubble_(
    `${BOT_NAME_}：${modules.map((m) => `${m.emoji}${m.name}`).join('・')}を、このトークで`,
    header_('👋 ようこそ', BOT_NAME_),
    [
      { type: 'text', text: 'くらぶのツールの知らせを、このトークで受けとれます。', size: 'sm', wrap: true },
      ...modules.map((m) => ({ type: 'text', text: `${m.emoji} ${m.name}：${m.desc || ''}`, size: 'sm', wrap: true })),
      role
        ? smallText_('下のボタンか、トークの下のメニューから始められます。')
        : smallText_(hasOwner ? 'このボットは、持ち主が許した人だけが使えます。「🙋 使いたいと伝える」を押すと、持ち主に届きます。' : 'まだ持ち主が決まっていません。このボットを作った人は「🔑 持ち主の登録」を押してね。')
    ],
    [postbackButton_('🧩 できること', 'm=core&a=modules')]
  );
  return withQuickReply_(card, coreQuick_(role));
}
