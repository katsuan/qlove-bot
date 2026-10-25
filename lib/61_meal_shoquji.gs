/**
 * 61_meal_shoquji.gs（食事記録ボットの 04_usecase.shoquji.gs から）
 * しょくじ（ShoQuji。https://katsuan.github.io/shoquji/）から、おくるんのカードと一緒に送られてくる「記録用の文字」を読んで記録する。
 * LINE のボットには Flex（カード）の中身が届かないので、しょくじはカードの後ろに次の形の文字を1通付けて送る（しょくじの設定でオンオフ）。
 *
 *   #しょくじ 2026/10/22
 *   朝 トースト 250kcal P8 F6 C40
 *   昼 カレーライス 780kcal
 *   間食 コーヒー
 *
 * - 1行目：「#しょくじ」と日付。2行目から 1品1行で「食事の種類 名前 [カロリー] [P/F/C]」（数字はあるものだけ）
 * - 間食は、このボットの「その他」に入れる。食事の種類で始まらない行（合計など）は読まない
 * - 数字がない品は、栄養マスタに同じ名前があればそれを、なければカロリー未入力（pending）で記録する
 * - 同じ日・同じ食事・同じ名前・同じカロリーの記録がもうあれば、二重に記録しない（同じカードを2回送ったとき）
 * - 使えるのは、ほかの記録と同じく、管理者が許可した人だけ（handleMealMessageFlow_ の許可の確認のあとで呼ぶ）
 */

const MEAL_SHOQUJI_TAG = '#しょくじ';
const MEAL_SHOQUJI_MEALS = { 朝: '朝', 昼: '昼', 夜: '夜', 間食: 'その他', その他: 'その他' };
const MEAL_SHOQUJI_NUTRI = { P: 'protein', F: 'fat', C: 'carb' };

// しょくじの記録用の文字（「#しょくじ」で始まる）なら true
function mealIsShoqujiText_(text) {
  return String(text || '').trim().indexOf(MEAL_SHOQUJI_TAG) === 0;
}

// しょくじの記録用の文字から、日付と品（食事・名前・カロリー・PFC）の一覧を読みとって返す
function mealParseShoqujiText_(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const head = lines.shift() || '';
  const m = head.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  const pad = value => String(value).padStart(2, '0');
  const mealDate = m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : mealFormatDateKey_(new Date());

  const items = [];
  lines.forEach(line => {
    const tokens = line.split(/\s+/);
    const meal = MEAL_SHOQUJI_MEALS[tokens[0]];
    if (!meal) return;
    tokens.shift();
    const nutrition = {};
    // 後ろから数字（250kcal・P8・F6・C40）を取る。名前に空白があってもよい
    while (tokens.length > 1) {
      const last = tokens[tokens.length - 1];
      const kcal = last.match(/^(\d+(?:\.\d+)?)kcal$/i);
      const pfc = last.match(/^([PFC])(\d+(?:\.\d+)?)g?$/i);
      if (kcal) nutrition.kcal = Number(kcal[1]);
      else if (pfc) nutrition[MEAL_SHOQUJI_NUTRI[pfc[1].toUpperCase()]] = Number(pfc[2]);
      else break;
      tokens.pop();
    }
    const menu = tokens.join(' ').trim().slice(0, 60);
    if (menu) items.push({ meal: meal, menu: menu, nutrition: nutrition });
  });
  return { mealDate: mealDate, items: items };
}

// しょくじの記録用の文字を読んで、まだない品だけ記録し、返事の見出しとひとことを返す
function mealHandleShoqujiText_(userId, text) {
  const parsedText = mealParseShoqujiText_(text);
  if (!parsedText.items.length) {
    return { kind: 'plain_text', text: 'しょくじの記録が読めませんでした（2行目から「朝 トースト 250kcal」の形で1品ずつ）。' };
  }

  const result = mealLogMealBatch_(userId, parsedText.items.map(item => Object.assign({
    meal: item.meal,
    menu: item.menu,
    mealDate: parsedText.mealDate,
  }, item.nutrition)), { source: MEAL_SOURCE.SHOQUJI, dedupe: true });
  const added = result.added.length;
  const skipped = result.skipped;
  const pending = result.pending;

  // 返事はふだんの記録と同じ、その日の集計カード（1_entry.gs の shoquji_logged）。
  // 気をつけてほしいこと（カロリーのない品・飛ばした品・きょう以外の日）があるときだけ、文字を1通添える
  const [, month, day] = parsedText.mealDate.split('-').map(Number);
  const notes = [];
  if (parsedText.mealDate !== mealFormatDateKey_(new Date())) notes.push(`${month}/${day} の分として記録しました（カードはきょうの集計です）。`);
  if (pending) notes.push(`カロリーがない品が ${pending} 品あります。カードの「入れる」から入れられます。`);
  if (skipped) notes.push(`同じものがもう記録されていた ${skipped} 品は、飛ばしました。`);
  return {
    kind: 'shoquji_logged',
    headline: added ? `🍚 しょくじから ${added} 品を記録` : '🍚 しょくじの記録はもう入っています',
    note: notes.join('\n'),
    dashboard: mealGetDashboardData_(userId),
  };
}
