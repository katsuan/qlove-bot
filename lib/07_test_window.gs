/**
 * 07_test_window.gs：持ち主のテストの窓口「#テスト」（ux.md の H11）
 * 持ち主が1対1 で「#テスト」と送ると 🧪 のカード。押すだけで、機能ごとの見本・くらぶの見本・自己点検・
 * カードが断られたときの文・季節の絵文字（出る／出ない）を見られる。
 * 見本はためしのデータで作り、すべて 🧪 付き。シートには書かない。返事（reply）だけで、push は使わない。
 * 呼ばれるところ：01_router.gs（持ち主の「#テスト」と、postback の m=core&a=test&t=…）
 */

/** #テストのカード（見本・自己点検などを選べる） */
function buildTestWindowCard_() {
  const modules = enabledModules_().filter((m) => m.samples);
  const card = bubble_(
    `🧪 テストの窓口：${modules.map((m) => m.name).join('・')}の見本・自己点検・断られたときの文・季節の絵文字`,
    header_('🧪 テストの窓口', `${BOT_NAME_}（版 ${BOT_VERSION_}）`),
    [
      { type: 'text', text: '下のボタンで、見本を返します（ためしのデータ。シートには書かず、push もしません）。', size: 'sm', wrap: true },
      smallText_(`機能：${modules.map((m) => `${m.emoji}${m.name}`).join('・') || 'なし'}`)
    ],
    [postbackButton_('🩺 自己点検', 'm=core&a=test&t=check')]
  );
  return withQuickReply_(card, testQuickReply_());
}

/** #テストで選べるもの（機能ごと・くらぶの見本・自己点検・断られたとき・季節の絵文字）。機能を押すと、その機能の見本が並ぶ */
function testQuickReply_() {
  const moduleItems = enabledModules_().filter((m) => m.samples).map((m) => postback_(`🧪 ${m.emoji} ${m.name}の見本`, `m=core&a=test&t=${m.key}`));
  return [
    ...moduleItems.slice(0, 8),
    postback_('🧩 くらぶの見本', 'm=core&a=test&t=core'),
    postback_('🩺 自己点検', 'm=core&a=test&t=check'),
    postback_('🧯 断られたとき', 'm=core&a=test&t=fallback'),
    postback_('🎃 季節の絵文字あり', 'm=core&a=test&t=season_on'),
    postback_('🍂 季節の絵文字なし', 'm=core&a=test&t=season_off')
  ];
}

/** #テストで選んだものの見本を返す（すべて 🧪 付き・シートに書かない・reply だけ） */
function testWindowReply_(kind) {
  const last = (messages) => {
    withQuickReply_(messages[messages.length - 1], testQuickReply_());
    return messages.slice(0, 5);
  };
  const [key, id] = String(kind).split('.');
  const module = moduleOf_(key);
  if (module && module.samples) {
    const samples = module.samples();
    const sample = id ? samples.find((s) => s.id === id) : null;
    // 見本を返したあとも、同じ機能のほかの見本を押せるように（クイックリプライは13こまで）
    const moduleQuick = () => samples.slice(0, 11).map((s) => postback_(s.label, `m=core&a=test&t=${module.key}.${s.id}`)).concat([postback_('🧪 テストの窓口', 'm=core&a=test')]);
    if (sample) {
      const messages = sample.build().slice(0, 5);
      withQuickReply_(messages[messages.length - 1], moduleQuick());
      return messages;
    }
    return [textMessage_(`🧪 ${module.emoji} ${module.name}の見本（${samples.length}こ）：下のボタンから選んでね。`, moduleQuick())];
  }
  switch (kind) {
    case 'core':
      return last([
        buildModulesCard_('owner', { sample: true }),
        buildMembersCard_([{ userId: 'Usample', displayName: 'ためしの人', status: 'allowed' }], { sample: true }),
        buildRequestCard_('Usample', 'ためしの人', { sample: true }),
        textMessage_('🧪 ここまでが、「🧩 できること」「👥 使う人」と、持ち主に届く「🙋 使いたい」の見本です（見本のボタンは、ためしの人なので何も変わりません）。')
      ]);
    case 'check':
      return last([textMessage_(`🧪 自己点検\n${checkSummary_(runChecks_())}`)]);
    case 'fallback': {
      const any = enabledModules_().find((m) => m.samples);
      const sample = any ? any.samples()[0].build()[0] : buildModulesCard_('owner');
      return last([textMessage_(`🧪 ${fallbackText_([sample])}`)]);
    }
    case 'season_on':
      return last([textMessage_(`🧪 ${QSeason.decorate('📍 名古屋市中村区 を登録しました。', { rand: () => 0 })}`)]);
    case 'season_off':
      return last([textMessage_(`🧪 ${QSeason.decorate('📍 名古屋市中村区 を登録しました。', { rand: () => 0.999 })}`)]);
    default:
      return [buildTestWindowCard_()];
  }
}
