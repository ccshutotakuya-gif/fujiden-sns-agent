/**
 * 画面（index.html）から google.script.run で呼ぶ公開 API。
 * login 以外はすべて第 1 引数にセッショントークンを取り、guard_ で検証する。
 */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.code && p.state) {
    // TikTok OAuth コールバック
    try {
      var c = tiktokHandleCallback_(p.code, p.state);
      return simplePage_('TikTok 連携が完了しました', c.name + ' の TikTok を連携しました。このタブを閉じて Hub に戻ってください。');
    } catch (err) {
      return simplePage_('TikTok 連携に失敗しました', err.message);
    }
  }
  return HtmlService.createTemplateFromFile('index').evaluate()
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function simplePage_(title, msg) {
  var t = HtmlService.createHtmlOutput('<div style="font-family:sans-serif;padding:40px;max-width:560px;margin:auto">' +
    '<h2></h2><p></p></div>');
  // XSS 防止のため文字列は後からエスケープして埋め込む
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (ch) { return '&#' + ch.charCodeAt(0) + ';'; }); };
  t.setContent(t.getContent().replace('<h2></h2>', '<h2>' + esc(title) + '</h2>').replace('<p></p>', '<p>' + esc(msg) + '</p>'));
  return t.setTitle(title);
}

function guard_(token) {
  if (!verify_(token)) throw new Error('SESSION_EXPIRED');
}

function publicSettings_() {
  var s = getSettings_();
  var keys = {};
  SECRET_KEYS.forEach(function (k) { keys[k] = !!props_().getProperty(k); });
  s.keys = keys;
  s.redirectUri = ScriptApp.getService().getUrl();
  return s;
}

// ---------- 認証 ----------

function apiLogin(pass) {
  return { token: login_(pass) };
}

function apiLogout(token) {
  logout_(token);
  return true;
}

// ---------- ダッシュボード ----------

function apiBootstrap(token) {
  guard_(token);
  var month = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
  var snaps = readAll_('Snapshots');
  var posts = readAll_('Posts');
  var clients = listClients_().map(function (c) {
    var mine = snaps.filter(function (s) { return s.clientId === c.id; });
    var myPosts = posts.filter(function (p) { return p.clientId === c.id; });
    var data = buildMonthlyData_(c, mine, myPosts, month);
    var last = mine.map(function (s) { return s.fetchedAt; }).sort().pop() || '';
    return {
      client: stripRow_(c),
      tiktokLinked: !!getTikTokTokens_(c.id),
      summary: data.summary,
      platforms: data.platforms,
      lastFetchedAt: last
    };
  });
  return { month: month, clients: clients, settings: publicSettings_(), jobs: jobStatus_() };
}

function stripRow_(o) {
  var c = {};
  Object.keys(o).forEach(function (k) { if (k !== '_row') c[k] = o[k]; });
  return c;
}

function apiClientDetail(token, clientId, month) {
  guard_(token);
  var c = getClient_(clientId);
  var snaps = snapshotsFor_(clientId);
  var posts = postsFor_(clientId);
  return {
    client: stripRow_(c),
    tiktokLinked: !!getTikTokTokens_(clientId),
    monthly: buildMonthlyData_(c, snaps, posts, month),
    series: followerSeries_(snaps, 120),
    recentPosts: posts.sort(function (a, b) { return String(b.publishedAt).localeCompare(String(a.publishedAt)); })
      .slice(0, 30).map(stripRow_),
    reports: reportsFor_(clientId).slice(0, 12).map(function (r) {
      var o = stripRow_(r); o.markdown = String(o.markdown); return o;
    })
  };
}

// ---------- クライアント管理 ----------

function apiSaveClient(token, input) {
  guard_(token);
  return stripRow_(saveClient_(input));
}

function apiDeleteClient(token, clientId) {
  guard_(token);
  deleteClient_(clientId);
  return true;
}

// ---------- データ取得 ----------

function apiCollect(token, clientId) {
  guard_(token);
  return collectClient_(getClient_(clientId));
}

/** 全社一括取得（時間がかかる分はバックグラウンドで続行） */
function apiCollectAll(token) {
  guard_(token);
  startJob_('collect', activeClientIds_(), {});
  return jobStatus_();
}

/** API が使えない媒体用の手入力（月末時点の数字など） */
function apiManualSnapshot(token, input) {
  guard_(token);
  if (PLATFORMS.indexOf(input.platform) < 0) throw new Error('媒体が不正です');
  getClient_(input.clientId);
  var snap = { date: input.date || today_(), clientId: input.clientId, platform: input.platform,
               fetchedAt: nowIso_(), source: 'manual' };
  ['followers', 'posts', 'totalViews', 'views', 'reach', 'engagements', 'profileViews'].forEach(function (k) {
    if (input[k] !== '' && input[k] !== undefined && input[k] !== null) snap[k] = Number(input[k]);
  });
  saveSnapshots_([snap]);
  return true;
}

/** 投稿単位の手入力（X を API なしで運用する場合など） */
function apiManualPost(token, input) {
  guard_(token);
  if (PLATFORMS.indexOf(input.platform) < 0) throw new Error('媒体が不正です');
  getClient_(input.clientId);
  var post = { clientId: input.clientId, platform: input.platform,
               postId: input.postId || 'manual_' + Utilities.getUuid().slice(0, 8),
               publishedAt: input.publishedAt, title: input.title || '', url: input.url || '', type: input.type || 'post',
               fetchedAt: nowIso_() };
  ['views', 'reach', 'likes', 'comments', 'shares', 'saves'].forEach(function (k) {
    if (input[k] !== '' && input[k] !== undefined && input[k] !== null) post[k] = Number(input[k]);
  });
  savePosts_([post]);
  return true;
}

function apiTikTokAuthUrl(token, clientId) {
  guard_(token);
  getClient_(clientId);
  return tiktokAuthUrl_(clientId);
}

// ---------- AI ----------

function apiGenerateReport(token, clientId, month, engine) {
  guard_(token);
  return generateReport_(clientId, month, engine);
}

function apiAsk(token, clientId, month, question, engine) {
  guard_(token);
  return askAi_(String(question).slice(0, 2000), monthlyDataFor_(clientId, month), engine);
}

// ---------- 設定 ----------

function apiSaveSettings(token, patch) {
  guard_(token);
  saveSettings_(patch || {});
  return publicSettings_();
}

/** API キー類の登録（空文字なら削除）。値は画面に返さない */
function apiSaveSecret(token, key, value) {
  guard_(token);
  if (SECRET_KEYS.indexOf(key) < 0) throw new Error('不正なキー');
  if (value) props_().setProperty(key, String(value).trim()); else props_().deleteProperty(key);
  return publicSettings_();
}

function apiChangePassword(token, current, next) {
  guard_(token);
  var salt = props_().getProperty(PROP.PASS_SALT);
  if (!safeEqual_(hashPassword_(String(current || ''), salt), props_().getProperty(PROP.PASS_HASH))) {
    throw new Error('現在のパスワードが違います');
  }
  setPasswordInternal_(next);
  return true; // 全員ログアウトされる
}

function apiTestAi(token, engine) {
  guard_(token);
  var q = 'テストです。「接続OK」とだけ返してください。';
  return engine === 'gpt' ? callOpenAI_('簡潔に答える。', q) : callClaude_('簡潔に答える。', q);
}

function apiLogs(token) {
  guard_(token);
  return readAll_('Logs').slice(-100).reverse().map(stripRow_);
}
