/**
 * AI 連携（Claude / ChatGPT）
 *
 * エンジン:
 *   claude      … Claude がレポートを作成
 *   gpt         … ChatGPT がレポートを作成
 *   claude+gpt  … ChatGPT が数値から分析メモを作成 → Claude がメモを踏まえて清書（推奨）
 */

/** 固定指示（設定画面で編集可能）。ボタン 1 つでこの指示に沿った月次レポートを出力する */
var DEFAULT_REPORT_INSTRUCTION = [
  'あなたは製造業クライアント専門の SNS 運用代理店のシニアアカウントプランナーです。',
  '以下の「クライアント情報」と「月次データ(JSON)」だけを根拠に、クライアントへそのまま提出できる月次レポートを日本語の Markdown で作成してください。',
  '',
  '# 構成（この順番・見出し名で出力）',
  '## 1. 今月のハイライト',
  '  - 今月の成果を 3 行で。最初の 1 行で「一番伝えたい成果」を数字付きで書く。',
  '## 2. KPI 達成状況',
  '  - クライアントの KPI と実績を表で比較（指標 / 目標 / 実績 / 前月比 / 判定 ◎○△）。KPI 未設定なら主要指標の前月比較表にする。',
  '## 3. 媒体別の結果',
  '  - 媒体ごとに「フォロワー（増減）/ 再生・表示 / 投稿数 / エンゲージメント率」の表と、所見を 2〜3 行。',
  '## 4. 見ている人の属性',
  '  - データの audience（年齢層・性別・フォロワー/フォロワー外の比率、単位 %）を媒体別に要約する。',
  '  - 「フォロワー外からの閲覧が何%か（＝新しい人に届いているか）」と「狙いたい層（例: 採用なら 18-34 歳）に届いているか」を必ず評価する。',
  '  - audience が無い媒体は「属性データ未取得」と 1 行だけ書く。',
  '## 5. 反応が良かった投稿 TOP3 と要因',
  '  - タイトル・数値・URL と、なぜ伸びたかの仮説（テーマ/尺/冒頭/投稿時間など）。投稿に audience があれば、どの層に届いたかも書く。',
  '## 6. 課題と原因の仮説',
  '## 7. 来月の打ち手',
  '  - 具体的な施策を 3〜5 個。各施策に「狙い / 具体的にやること / 期待する数値変化」を書く。',
  '## 8. 担当者からのひとこと',
  '  - クライアントの事業目標（採用・認知・問い合わせ等）に結び付けて 2〜3 行で前向きに締める。',
  '',
  '# ルール',
  '- 数値は必ずデータにあるものだけを使う。データが無い項目は推測せず「データ未取得」と書く。',
  '- 前月データがある指標は必ず前月比（%）を併記する。',
  '- 製造業の担当者にも伝わる平易な言葉を使い、専門用語には短い補足を付ける。',
  '- 誇張しない。悪い数字も隠さず、原因と次の手をセットで書く。',
  '- 丁寧語（です・ます調）。絵文字は使わない。',
  '- 冒頭にタイトル「# {クライアント名} 様 SNS 運用レポート（{YYYY年M月}）」を付ける。'
].join('\n');

var ANALYST_INSTRUCTION = [
  'あなたは SNS データアナリストです。以下の月次データ(JSON)を読み、レポート執筆者向けの分析メモを日本語の箇条書きで作成してください。',
  '- 前月比で大きく動いた指標（上位 5 つ）とその解釈',
  '- 媒体間の比較で見える傾向',
  '- 伸びた投稿の共通点',
  '- 視聴者の属性（年齢層・性別・フォロワー外比率）と、クライアントの狙う層とのズレ',
  '- 注意すべき数字（減少・データ欠損）',
  '- 来月の打ち手の候補（根拠付き）',
  '数値はデータにあるものだけを使い、推測は「仮説」と明記すること。800 字以内。'
].join('\n');

// GAS の UrlFetchApp は 1 リクエスト約 60 秒で打ち切られるため、
// レポートは前半・後半に分けて fetchAll で並列生成する。

function claudeRequest_(system, user) {
  var key = props_().getProperty(PROP.ANTHROPIC_API_KEY);
  if (!key) throw new Error('ANTHROPIC_API_KEY 未設定');
  return {
    url: 'https://api.anthropic.com/v1/messages',
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      // 安全フィルタで断られた場合に Anthropic 推奨の別モデルで自動再実行する
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    payload: JSON.stringify({
      model: getSettings_().claudeModel,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      fallbacks: 'default',
      system: system,
      messages: [{ role: 'user', content: user }]
    })
  };
}

function parseClaude_(res) {
  if (res.stop_reason === 'refusal') throw new Error('Claude が出力を辞退しました（内容を見直してください）');
  var text = (res.content || []).filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; }).join('');
  if (!text) throw new Error('Claude の応答が空でした (stop_reason=' + res.stop_reason + ')');
  if (res.stop_reason === 'max_tokens') text += '\n\n> ※出力が上限に達したため途中で終了しています。';
  return text;
}

function openaiRequest_(system, user) {
  var key = props_().getProperty(PROP.OPENAI_API_KEY);
  if (!key) throw new Error('OPENAI_API_KEY 未設定');
  return {
    url: 'https://api.openai.com/v1/chat/completions',
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify({
      model: getSettings_().openaiModel,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
    })
  };
}

function parseOpenAI_(res) {
  var text = res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
  if (!text) throw new Error('ChatGPT の応答が空でした');
  return text;
}

/** 複数の AI リクエストを並列実行してテキスト配列を返す */
function aiParallel_(engine, pairs) {
  var reqFn = engine === 'gpt' ? openaiRequest_ : claudeRequest_;
  var parseFn = engine === 'gpt' ? parseOpenAI_ : parseClaude_;
  var name = engine === 'gpt' ? 'ChatGPT' : 'Claude';
  var responses;
  try {
    responses = UrlFetchApp.fetchAll(pairs.map(function (p) { return reqFn(p[0], p[1]); }));
  } catch (e) {
    throw new Error(name + ' への接続に失敗しました（' + e.message + '）。時間切れの場合は設定画面で軽いモデルに切り替えてください。');
  }
  return responses.map(function (r) {
    var body;
    try { body = JSON.parse(r.getContentText()); } catch (e) { body = {}; }
    if (r.getResponseCode() >= 400) {
      var msg = (body.error && (body.error.message || body.error.type)) || r.getContentText();
      throw new Error(name + ' API エラー ' + r.getResponseCode() + ': ' + String(msg).slice(0, 300));
    }
    return parseFn(body);
  });
}

function callClaude_(system, user) { return aiParallel_('claude', [[system, user]])[0]; }
function callOpenAI_(system, user) { return aiParallel_('gpt', [[system, user]])[0]; }

function monthLabel_(month) {
  return month.slice(0, 4) + '年' + Number(month.slice(5, 7)) + '月';
}

function buildReportUserPrompt_(data, analystMemo) {
  var c = data.client;
  var parts = [
    '# クライアント情報',
    '- クライアント名: ' + c.name,
    '- 業種: ' + (c.industry || '未設定'),
    '- SNS 運用の目的: ' + (c.goal || '未設定'),
    '- KPI: ' + (c.kpi || '未設定'),
    '- レポートのトーン: ' + (c.tone || '丁寧・前向き'),
    '- 補足: ' + (c.notes || 'なし'),
    '- 対象月: ' + monthLabel_(data.month) + '（比較対象: ' + monthLabel_(data.prevMonth) + '）',
    '',
    '# 月次データ(JSON)',
    '```json', JSON.stringify(data, null, 1), '```'
  ];
  if (analystMemo) {
    parts.push('', '# 別 AI（ChatGPT）による分析メモ — 参考情報。数値はデータ(JSON)を正とすること', analystMemo);
  }
  return parts.join('\n');
}

var REPORT_PARTS = [
  '【今回の出力範囲】構成のうちタイトルと「## 1.」〜「## 4.」だけを出力してください（5 以降は別担当が書きます）。',
  '【今回の出力範囲】構成のうち「## 5.」〜「## 8.」だけを出力してください（タイトルと 1〜4 は別担当が書いたので不要です）。'
];

/**
 * 月次レポート本文（Markdown）を生成。前半・後半を並列生成して結合する。
 */
function writeReport_(data, engine) {
  var s = getSettings_();
  var system = s.reportInstruction + '\n\n報告元: ' + s.agencyName;
  var memo = '';
  if (engine === 'claude+gpt') {
    try {
      memo = callOpenAI_(ANALYST_INSTRUCTION, '```json\n' + JSON.stringify(data) + '\n```');
    } catch (e) {
      log_('warn', 'ai', 'ChatGPT 分析メモをスキップ: ' + e.message);
    }
  }
  var user = buildReportUserPrompt_(data, memo);
  var parts = aiParallel_(engine === 'gpt' ? 'gpt' : 'claude',
    REPORT_PARTS.map(function (scope) { return [system, user + '\n\n' + scope]; }));
  return parts.map(function (t) { return t.trim(); }).join('\n\n');
}

/** 自由質問（「このクライアントの今月の課題は？」など） */
function askAi_(question, data, engine) {
  var system = 'あなたは製造業専門の SNS 運用代理店のアナリストです。与えられたデータだけを根拠に、簡潔かつ具体的に日本語で回答してください。';
  var user = '# データ\n```json\n' + JSON.stringify(data) + '\n```\n\n# 質問\n' + question;
  return engine === 'gpt' ? callOpenAI_(system, user) : callClaude_(system, user);
}
