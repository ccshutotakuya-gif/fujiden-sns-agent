/* デモ用の疑似サーバー（google.script.run の代わり）。データはすべて架空のサンプルです。 */
(function(){
  var PL = ['instagram','youtube','x','tiktok'];
  function seed(n){ var s = n; return function(){ s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
  var DEF = [
    ['c_fuji','有限会社藤電設工業','電気設備工事','採用（20代の電気工事士）と地域での認知','IG フォロワー 月+50 / YouTube 月間再生 1万回 / 採用ページ遷移 月30件'],
    ['c_yama','山田精機株式会社','精密部品加工','技術力の発信で新規取引の問い合わせを増やす','YouTube 月間再生 2万回 / 問い合わせ 月3件'],
    ['c_toho','東邦金属工業','板金・溶接','若手採用と職人の魅力発信','TikTok 月間再生 5万回 / 応募 月2件'],
    ['c_kita','北村樹脂成形','樹脂成形','BtoB の認知拡大','IG フォロワー 月+40'],
    ['c_sanw','三和塗装','工業塗装','採用と地域認知','IG フォロワー 月+30 / TikTok 月間再生 3万回'],
    ['c_naka','中央ボルト製作所','ねじ・締結部品','展示会集客と指名検索','X インプレッション 月5万 / YouTube 月間再生 8千回'],
    ['c_aoba','青葉機工','産業機械メンテナンス','採用（未経験者）','TikTok 月間再生 4万回 / 応募 月2件']
  ];
  var clients = DEF.map(function(d, i){ return { id:d[0], name:d[1], industry:d[2], goal:d[3], kpi:d[4], tone:'丁寧・前向き・数字重視', notes:'', active:true,
    ig_user_id:'1784140000000000' + i, yt_channel_id:'@sample' + i, x_username: i % 3 === 2 ? '' : 'sample' + i }; });

  function platforms(i){
    var r = seed(i + 7), out = {};
    PL.forEach(function(p, k){
      if(p === 'x' && !clients[i].x_username) return;
      var base = [1200, 800, 1500, 900][k] * (0.6 + r());
      var g = Math.round((r() - 0.25) * 90);
      out[p] = { followersEnd: Math.round(base), followerGrowth: g, followersStart: Math.round(base) - g,
        views: Math.round((p === 'youtube' ? 18000 : p === 'tiktok' ? 30000 : 9000) * (0.5 + r())),
        postsPublished: Math.round(4 + r() * 10), engagementRate: Math.round((1 + r() * 6) * 100) / 100,
        change: { followers: Math.round((r() - 0.3) * 80) / 10, views: Math.round((r() - 0.4) * 400) / 10 } };
      var aud = audienceFor(i, p, k);
      if(aud) out[p].audience = aud;
    });
    return out;
  }
  function pctMap(keys, weights, r){ var raw = keys.map(function(k, j){ return weights[j] * (0.7 + r() * 0.6); });
    var t = raw.reduce(function(a, b){ return a + b; }, 0), o = {}; keys.forEach(function(k, j){ o[k] = Math.round(raw[j] / t * 1000) / 10; }); return o; }
  var AGEK = ['13-17','18-24','25-34','35-44','45-54','55-64','65+'];
  function audienceFor(i, p, seedOffset){
    var r = seed(i * 31 + seedOffset), young = p === 'tiktok' ? 2.2 : p === 'instagram' ? 1.4 : 0.8;
    var age = pctMap(AGEK, [3 * young, 20 * young, 30, 22, 14, 7, 4], r);
    var gender = pctMap(['female','male','unknown'], [p === 'instagram' ? 42 : 25, 70, 3], r);
    var follow = pctMap(['follower','non_follower'], [p === 'tiktok' ? 20 : 45, 55], r);
    var m = new Date(); var month = m.getFullYear() + '-' + String(m.getMonth()+1).padStart(2,'0');
    if(p === 'instagram') return { month:month, followers:{ age:age, gender:gender }, viewers:{ follow:follow }, engaged:{ age:pctMap(AGEK, [2, 26, 34, 20, 10, 5, 3], r), gender:pctMap(['female','male','unknown'], [45, 52, 3], r) } };
    if(p === 'youtube') return { month:month, viewers:{ age:age, gender:gender, follow:follow } };
    if(p === 'tiktok' && i % 2 === 0) return { month:month, viewers:{ age:age, gender:gender, follow:follow } };
    return null;
  }
  function summary(pl){ var s = {followersEnd:0,followerGrowth:0,views:0,postsPublished:0};
    Object.keys(pl).forEach(function(p){ s.followersEnd += pl[p].followersEnd; s.followerGrowth += pl[p].followerGrowth; s.views += pl[p].views; s.postsPublished += pl[p].postsPublished; }); return s; }
  function series(i){ var pl = platforms(i), s = {}, r = seed(i + 99);
    Object.keys(pl).forEach(function(p){ var v = pl[p].followersEnd - pl[p].followerGrowth * 4; s[p] = [];
      for(var d = 119; d >= 0; d--){ var dt = new Date(Date.now() - d * 86400000); v += pl[p].followerGrowth / 30 + (r() - 0.5) * 3; s[p].push({ date: dt.toISOString().slice(0,10), followers: Math.round(v) }); } });
    return s; }
  var TITLES = ['朝礼から始まる現場の一日','新人が初めて任された仕事','職人の手元アップ 30 秒','工場見学ツアー','社長が語る創業のきっかけ','失敗から学んだ安全対策','完成した製品ができるまで','先輩社員インタビュー'];
  function postsFor(i){ var r = seed(i + 3), out = [];
    for(var k = 0; k < 14; k++){ var p = PL[k % 4]; if(p === 'x' && !clients[i].x_username) p = 'instagram';
      var dt = new Date(Date.now() - k * 2.3 * 86400000);
      out.push({ postId:'p' + i + '_' + k, platform:p, publishedAt: dt.toISOString(), title: TITLES[(k + i) % TITLES.length], url:'https://example.com/post/' + i + '-' + k,
        views: Math.round(500 + r() * 8000), likes: Math.round(20 + r() * 400), comments: Math.round(r() * 30), shares: Math.round(r() * 25), saves: Math.round(r() * 40) }); }
    return out; }
  function monthJa(m){ return m.slice(0,4) + '年' + Number(m.slice(5,7)) + '月'; }
  function sampleReport(c, month, pl){
    var rows = Object.keys(pl).map(function(p){ var x = pl[p]; var L = {instagram:'Instagram',youtube:'YouTube',x:'X',tiktok:'TikTok'}[p];
      return '| ' + L + ' | ' + x.followersEnd.toLocaleString() + '（' + (x.followerGrowth >= 0 ? '+' : '') + x.followerGrowth + '） | ' + x.views.toLocaleString() + ' | ' + x.postsPublished + ' | ' + x.engagementRate + '% |'; }).join('\n');
    var ig = pl.instagram || {followerGrowth:0, change:{}};
    var igA = (pl.instagram && pl.instagram.audience) || {}; ig = Object.assign({}, ig, { followers: igA.followers, viewers: igA.viewers });
    return '# ' + c.name + ' 様 SNS 運用レポート（' + monthJa(month) + '）\n\n' +
      '## 1. 今月のハイライト\n- Instagram のフォロワーが **' + (ig.followerGrowth >= 0 ? '+' : '') + ig.followerGrowth + ' 人**（前月比 ' + ig.change.followers + '%）と、職人の手元動画を起点に増加しました。\n- TikTok は「新人が初めて任された仕事」が今月最多の再生となり、採用ページへの導線が機能し始めています。\n- 一方で YouTube の長尺動画は再生が伸び悩んでおり、来月はショート動画への切り出しで補います。\n\n' +
      '## 2. KPI 達成状況\n| 指標 | 目標 | 実績 | 前月比 | 判定 |\n|---|---|---|---|---|\n| Instagram フォロワー増 | +50 | ' + ig.followerGrowth + ' | ' + ig.change.followers + '% | ' + (ig.followerGrowth >= 50 ? '◎' : ig.followerGrowth >= 30 ? '○' : '△') + ' |\n| YouTube 月間再生 | 10,000 | ' + (pl.youtube ? pl.youtube.views.toLocaleString() : 'データ未取得') + ' | ' + (pl.youtube ? pl.youtube.change.views + '%' : '—') + ' | ○ |\n| 採用ページ遷移 | 30 | データ未取得 | — | — |\n\n' +
      '## 3. 媒体別の結果\n| 媒体 | フォロワー（増減） | 再生・表示 | 投稿数 | ER |\n|---|---|---|---|---|\n' + rows + '\n\n所見：現場の「人」が映る投稿ほど保存・シェアが多く、製品単体の紹介は反応が控えめでした。\n\n' +
      '## 4. 見ている人の属性\n- **Instagram**：フォロワーの中心は 25〜34 歳（' + (ig.followers ? ig.followers.age['25-34'] : '—') + '%）。閲覧の ' + (ig.viewers ? ig.viewers.follow.non_follower : '—') + '% がフォロワー外からで、新しい人に届いています。\n- **YouTube**：視聴者は 35〜44 歳と男性が中心で、取引先・業界関係者に近い層です。\n- **TikTok**：18〜24 歳の比率が最も高く、採用ターゲットに届いています。\n- **X**：属性データ未取得\n\n' +
      '## 5. 反応が良かった投稿 TOP3 と要因\n1. **新人が初めて任された仕事**（TikTok）— 冒頭 2 秒で結末を見せる構成が離脱を防いだと考えられます。\n2. **職人の手元アップ 30 秒**（Instagram リール）— 音と手元のみのシンプルな構成で保存数が多く出ました。\n3. **工場見学ツアー**（YouTube ショート）— 平日 12 時台の投稿で初速が伸びました。\n\n' +
      '## 6. 課題と原因の仮説\n- YouTube 長尺の視聴が伸びない → 冒頭の説明が長く、最初の 30 秒で離脱している可能性（仮説）。\n- X はインプレッションに対して反応率が低い → 文字だけの投稿が多く、画像付きが少ないため。\n\n' +
      '## 7. 来月の打ち手\n- **長尺動画のショート化**：狙い＝新規視聴者の獲得 / やること＝既存 3 本から 60 秒以内を 6 本切り出し / 期待＝ショート再生 +30%\n- **「先輩社員」シリーズ化**：狙い＝採用ページ遷移 / やること＝毎週木曜に 1 本 / 期待＝遷移 月30件\n- **X は画像付き投稿に統一**：狙い＝反応率改善 / 期待＝ER 1.5% → 2.5%\n\n' +
      '## 8. 担当者からのひとこと\n現場の皆さまの協力のおかげで「人が見える発信」が定着してきました。来月はこの流れを採用につなげることに集中します。引き続きよろしくお願いいたします。\n\n> ※これはデモ用のサンプルです。実際のレポートは取得したデータと固定指示から AI が作成します。';
  }
  var reports = {};
  var manualPA = {};
  var settings = { agencyName:'株式会社Cc', claudeModel:'claude-opus-5-5', openaiModel:'gpt-5', defaultEngine:'claude+gpt', autoMonthlyReport:true, notifyEmail:'',
    reportInstruction:'あなたは製造業クライアント専門の SNS 運用代理店のシニアアカウントプランナーです。\n以下の「クライアント情報」と「月次データ(JSON)」だけを根拠に、クライアントへそのまま提出できる月次レポートを日本語の Markdown で作成してください。\n\n# 構成（この順番・見出し名で出力）\n## 1. 今月のハイライト\n## 2. KPI 達成状況\n## 3. 媒体別の結果\n## 4. 見ている人の属性\n## 5. 反応が良かった投稿 TOP3 と要因\n## 6. 課題と原因の仮説\n## 7. 来月の打ち手\n## 8. 担当者からのひとこと\n\n# ルール\n- 数値は必ずデータにあるものだけを使う。\n- 前月データがある指標は必ず前月比（%）を併記する。\n- 製造業の担当者にも伝わる平易な言葉を使う。',
    keys:{ANTHROPIC_API_KEY:true,OPENAI_API_KEY:true,META_ACCESS_TOKEN:true,YOUTUBE_API_KEY:true,X_BEARER_TOKEN:false,TIKTOK_CLIENT_KEY:true,TIKTOK_CLIENT_SECRET:true,GOOGLE_OAUTH_CLIENT_ID:true,GOOGLE_OAUTH_CLIENT_SECRET:true},
    redirectUri:'https://script.google.com/macros/s/（デプロイ後に表示されます）/exec' };
  function idx(id){ for(var i = 0; i < clients.length; i++) if(clients[i].id === id) return i; return 0; }
  function prevMonth(m){ var y = +m.slice(0,4), mo = +m.slice(5,7) - 1; if(!mo){ y--; mo = 12; } return y + '-' + String(mo).padStart(2,'0'); }
  var api = {
    apiLogin: function(p){ if(!p) throw new Error('パスワードを入力してください'); return { token:'demo' }; },
    apiBootstrap: function(){ var m = new Date(); var month = m.getFullYear() + '-' + String(m.getMonth()+1).padStart(2,'0');
      return { month: month, jobs:{}, settings: settings, clients: clients.map(function(c, i){ var pl = platforms(i);
        return { client:c, tiktokLinked: i !== 3, summary: summary(pl), platforms: pl, lastFetchedAt: new Date().toISOString().slice(0,10) + 'T06:0' + i + ':00' }; }) }; },
    apiClientDetail: function(id, month){ var i = idx(id), pl = platforms(i);
      if(!reports[id]) reports[id] = [{ month: prevMonth(month), engine:'claude+gpt', createdAt: new Date().toISOString().slice(0,10) + 'T08:03:00', docUrl:'https://docs.google.com/', markdown: sampleReport(clients[i], prevMonth(month), pl) }];
      var posts = postsFor(i), pa = {};
      posts.forEach(function(p, k){
        if(p.platform === 'youtube'){ pa['youtube|' + p.postId] = audienceFor(i, 'youtube', 50 + k); }
        if(p.platform === 'instagram' && k < 9){ var r = seed(i * 7 + k), nf = Math.round((35 + r() * 45) * 10) / 10;
          pa['instagram|' + p.postId] = { month: audienceFor(i, 'youtube', 0).month, viewers: { follow: { follower: Math.round((100 - nf) * 10) / 10, non_follower: nf } } }; }
      });
      Object.keys(manualPA).forEach(function(key){ if(key.indexOf(id + '|') === 0) pa[key.slice(id.length + 1)] = manualPA[key]; });
      return { client: clients[i], tiktokLinked: i !== 3, googleLinked: i % 3 !== 1, postAudience: pa, monthly:{ month:month, prevMonth:prevMonth(month), summary:summary(pl), platforms:pl }, series: series(i), recentPosts: posts, reports: reports[id] }; },
    apiGenerateReport: function(id, month, engine){ var i = idx(id); var r = { month:month, engine:engine, createdAt:new Date().toISOString().slice(0,19), docUrl:'https://docs.google.com/', markdown: sampleReport(clients[i], month, platforms(i)) };
      reports[id] = [r].concat(reports[id] || []); return r; },
    apiAsk: function(id, month, q){ return '**デモ回答**（実際は Claude / ChatGPT がこの会社のデータをもとに回答します）\n\n質問：' + q + '\n\n- 反応が良い「人が映る投稿」を週 2 本に増やす\n- YouTube 長尺は 60 秒以内のショートに切り出す\n- 投稿時間は平日 12 時台に寄せる'; },
    apiManualAudience: function(input){
      if(input.scope && input.scope !== 'account'){
        var v = {}; ['age','gender','follow'].forEach(function(dim){ var src = input[dim] || {}, o = {}, any = false;
          Object.keys(src).forEach(function(k){ if(src[k] !== '' && src[k] != null){ o[k] = Number(src[k]); any = true; } }); if(any) v[dim] = o; });
        if(!Object.keys(v).length) throw new Error('数値が 1 つも入力されていません');
        manualPA[input.clientId + '|' + input.platform + '|' + input.scope] = { month: input.month, viewers: v };
      }
      return 10; },
    apiGoogleAuthUrl: function(){ throw new Error('デモ版では YouTube 詳細分析の連携は動きません（本番では Google のログイン画面が開きます）'); },
    apiCollect: function(){ return { instagram:'ok', youtube:'ok', x:'skip', tiktok:'ok' }; },
    apiCollectAll: function(){ return {}; },
    apiSaveClient: function(o){ if(o.id){ var i = idx(o.id); Object.keys(o).forEach(function(k){ clients[i][k] = o[k]; }); return clients[i]; }
      o.id = 'c_new' + clients.length; clients.push(o); return o; },
    apiDeleteClient: function(id){ clients.splice(idx(id), 1); return true; },
    apiSaveSettings: function(p){ Object.keys(p).forEach(function(k){ settings[k] = p[k]; }); return settings; },
    apiSaveSecret: function(k, v){ settings.keys[k] = !!v; return settings; },
    apiTestAi: function(){ return '接続OK（デモ）'; },
    apiTikTokAuthUrl: function(){ throw new Error('デモ版では TikTok 連携は動きません（本番では TikTok のログイン画面が開きます）'); },
    apiLogs: function(){ return [{ at:new Date().toISOString().slice(0,19), level:'info', scope:'job:collect', message:'完了 7 件（デモ）' }]; },
    apiChangePassword: function(){ return true; }
  };
  function runner(){
    var ok = function(){}, ng = function(){}, P;
    var o = { withSuccessHandler:function(f){ ok = f; return P; }, withFailureHandler:function(f){ ng = f; return P; } };
    P = new Proxy(o, { get:function(t, k){ if(k in t) return t[k];
      return function(){ var a = Array.prototype.slice.call(arguments); if(k !== 'apiLogin') a.shift();
        setTimeout(function(){ try{ ok(api[k] ? api[k].apply(null, a) : true); }catch(e){ ng(e); } }, k === 'apiGenerateReport' ? 1200 : 250); }; } });
    return P;
  }
  window.google = { script: { run: new Proxy({}, { get:function(_, k){ return runner()[k]; } }) } };
  // 埋め込み表示では確認ダイアログが出ないため、デモでは常に「はい」として扱う
  window.confirm = function(){ return true; };
})();
