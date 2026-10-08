/**
 * 視聴者・フォロワー属性（年齢層 / 性別 / フォロワー・フォロワー外）
 *
 * 取得できる範囲（各 SNS の公式 API の仕様による）
 *   Instagram … アカウント単位: フォロワーの年齢・性別、反応した人の年齢・性別、
 *               閲覧のフォロワー/フォロワー外比率（フォロワー 100 人以上が条件）
 *   YouTube   … YouTube Analytics 連携（チャンネルごとに OAuth）で、
 *               チャンネル単位と動画単位の視聴者の年齢・性別、登録者/非登録者の比率
 *   TikTok/X  … 公式 API で取得できないため手入力（各アプリの分析画面の数字を転記）
 *
 * 保存形式（Audience シート）: 1 行 = 1 つの区分の割合（%）
 *   month, clientId, platform, scope(account | 投稿ID), basis, dimension(age|gender|follow), key, value
 *   basis: followers=フォロワー / viewers=視聴者 / engaged=反応した人
 */

var AGE_KEYS = ['13-17', '18-24', '25-34', '35-44', '45-54', '55-64', '65+'];
var GENDER_KEYS = ['female', 'male', 'unknown'];
var FOLLOW_KEYS = ['follower', 'non_follower'];

function currentMonth_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
}

function saveAudience_(rows) {
  upsertRows_('Audience', rows, function (o) {
    return [o.month, o.clientId, o.platform, o.scope, o.basis, o.dimension, o.key].join('|');
  });
}

function audienceFor_(clientId) {
  return readAll_('Audience').filter(function (r) { return r.clientId === clientId; });
}

/** {key: 数値} を合計 100 の % に変換して行配列にする */
function toPercentRows_(base, dimension, counts) {
  var total = Object.keys(counts).reduce(function (a, k) { return a + (Number(counts[k]) || 0); }, 0);
  if (!total) return [];
  return Object.keys(counts).map(function (k) {
    var r = {};
    Object.keys(base).forEach(function (b) { r[b] = base[b]; });
    r.dimension = dimension;
    r.key = k;
    r.value = Math.round((Number(counts[k]) || 0) / total * 1000) / 10;
    return r;
  });
}

function normAge_(k) {
  var s = String(k).replace(/^age/, '').replace(/-$/, '+');
  return s === '65-' ? '65+' : s;
}

function normGender_(k) {
  var s = String(k).toLowerCase();
  if (s === 'f' || s === 'female') return 'female';
  if (s === 'm' || s === 'male') return 'male';
  return 'unknown';
}

/** 1 クライアントの属性を取得（毎日のデータ取得の最後に呼ばれる。失敗しても他は止めない） */
function collectAudience_(client) {
  var out = {};
  if (client.ig_user_id && props_().getProperty(PROP.META_ACCESS_TOKEN)) {
    try { saveAudience_(instagramAudience_(client)); out.instagram = 'ok'; }
    catch (e) { out.instagram = 'error: ' + e.message; log_('warn', 'audience:instagram', client.name + ' — ' + e.message); }
  }
  if (getGoogleTokens_(client.id)) {
    try { saveAudience_(youtubeAudience_(client)); out.youtube = 'ok'; }
    catch (e) { out.youtube = 'error: ' + e.message; log_('warn', 'audience:youtube', client.name + ' — ' + e.message); }
  }
  return out;
}

// ---------------- Instagram ----------------

function instagramAudience_(client) {
  var token = props_().getProperty(PROP.META_ACCESS_TOKEN);
  var base = 'https://graph.facebook.com/' + META_GRAPH_VERSION + '/' + encodeURIComponent(client.ig_user_id) + '/insights';
  var q = '&access_token=' + encodeURIComponent(token);
  var month = currentMonth_();
  var rows = [];
  var fetchedAt = nowIso_();
  var mk = function (basis) {
    return { month: month, clientId: client.id, platform: 'instagram', scope: 'account', basis: basis, fetchedAt: fetchedAt, source: 'api' };
  };

  // 年齢・性別（フォロワー / 反応した人）。timeframe の指定値は API バージョンで変わるため順に試す
  [['follower_demographics', 'followers'], ['engaged_audience_demographics', 'engaged']].forEach(function (m) {
    ['age', 'gender'].forEach(function (bd) {
      var res = tryInsights_(base, 'metric=' + m[0] + '&period=lifetime&metric_type=total_value&breakdown=' + bd, ['this_month', 'last_30_days', ''], q);
      if (!res) return;
      var counts = {};
      breakdownResults_(res).forEach(function (r) {
        var key = bd === 'age' ? normAge_(r.dimension_values[0]) : normGender_(r.dimension_values[0]);
        counts[key] = (counts[key] || 0) + Number(r.value || 0);
      });
      rows = rows.concat(toPercentRows_(mk(m[1]), bd, counts));
    });
  });

  // 閲覧のフォロワー / フォロワー外（今月 1 日〜今日、最大 30 日）
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), 1);
  if (now - start > 29 * 86400000) start = new Date(now.getTime() - 29 * 86400000);
  var range = '&since=' + Math.floor(start.getTime() / 1000) + '&until=' + Math.floor(now.getTime() / 1000);
  ['follow_type', 'follower_type'].some(function (bdName) {
    var res = tryInsights_(base, 'metric=views&period=day&metric_type=total_value&breakdown=' + bdName + range, [''], q);
    if (!res) return false;
    var counts = {};
    breakdownResults_(res).forEach(function (r) {
      var v = String(r.dimension_values[0]).toUpperCase();
      if (v === 'FOLLOWER') counts.follower = Number(r.value || 0);
      if (v === 'NON_FOLLOWER') counts.non_follower = Number(r.value || 0);
    });
    var pr = toPercentRows_(mk('viewers'), 'follow', counts);
    rows = rows.concat(pr);
    return pr.length > 0;
  });

  rows = rows.concat(instagramPostAudience_(client, token, month, fetchedAt));

  if (!rows.length) throw new Error('属性データを取得できませんでした（フォロワー 100 人未満、または権限 instagram_manage_insights 不足の可能性）');
  return rows;
}

/**
 * 投稿ごとのフォロワー / フォロワー外（直近 10 投稿）。
 * Meta が投稿単位の内訳を返すかは API バージョンによって異なるため、指定方法を順に試し、
 * 返らなければ何もしない（その場合は画面の「投稿」タブから手入力する）。
 */
function instagramPostAudience_(client, token, month, fetchedAt) {
  var recent = postsFor_(client.id).filter(function (p) { return p.platform === 'instagram'; })
    .sort(function (a, b) { return String(b.publishedAt).localeCompare(String(a.publishedAt)); }).slice(0, 10);
  if (!recent.length) return [];
  var q = '&access_token=' + encodeURIComponent(token);
  var variants = ['metric=views&metric_type=total_value&breakdown=follow_type',
                  'metric=views&metric_type=total_value&breakdown=follower_type',
                  'metric=reach&metric_type=total_value&breakdown=follow_type'];
  // どの指定方法が通るかを 1 投稿目で判定し、残りはその方法だけで並列取得する
  var probeBase = 'https://graph.facebook.com/' + META_GRAPH_VERSION + '/';
  var working = null;
  for (var i = 0; i < variants.length && !working; i++) {
    try {
      var res = httpJson_(probeBase + recent[0].postId + '/insights?' + variants[i] + q);
      if (followCounts_(res)) working = variants[i];
    } catch (e) { /* 非対応 */ }
  }
  if (!working) return [];
  var responses = UrlFetchApp.fetchAll(recent.map(function (p) {
    return { url: probeBase + p.postId + '/insights?' + working + q, muteHttpExceptions: true };
  }));
  var rows = [];
  responses.forEach(function (r, idx) {
    if (r.getResponseCode() >= 400) return;
    var counts = followCounts_(JSON.parse(r.getContentText()));
    if (!counts) return;
    rows = rows.concat(toPercentRows_({ month: month, clientId: client.id, platform: 'instagram',
      scope: String(recent[idx].postId), basis: 'viewers', fetchedAt: fetchedAt, source: 'api' }, 'follow', counts));
  });
  return rows;
}

function followCounts_(res) {
  var counts = {};
  breakdownResults_(res).forEach(function (r) {
    var v = String(r.dimension_values[0]).toUpperCase();
    if (v === 'FOLLOWER') counts.follower = Number(r.value || 0);
    if (v === 'NON_FOLLOWER') counts.non_follower = Number(r.value || 0);
  });
  return Object.keys(counts).length ? counts : null;
}

function tryInsights_(base, params, timeframes, q) {
  for (var i = 0; i < timeframes.length; i++) {
    try {
      return httpJson_(base + '?' + params + (timeframes[i] ? '&timeframe=' + timeframes[i] : '') + q);
    } catch (e) { /* 次の候補を試す */ }
  }
  return null;
}

function breakdownResults_(res) {
  var d = res && res.data && res.data[0];
  var b = d && d.total_value && d.total_value.breakdowns && d.total_value.breakdowns[0];
  return (b && b.results) || [];
}

// ---------------- YouTube Analytics（Google OAuth・チャンネルごと） ----------------

var GOOGLE_SCOPES = 'https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly';

function getGoogleTokens_(clientId) {
  var raw = props_().getProperty('GOOGLE_TOKENS_' + clientId);
  return raw ? JSON.parse(raw) : null;
}

function googleAuthUrl_(clientId) {
  var cid = props_().getProperty(PROP.GOOGLE_OAUTH_CLIENT_ID);
  if (!cid) throw new Error('Google OAuth クライアント ID が未登録です（設定画面）');
  return 'https://accounts.google.com/o/oauth2/v2/auth?client_id=' + encodeURIComponent(cid) +
    '&redirect_uri=' + encodeURIComponent(ScriptApp.getService().getUrl()) +
    '&response_type=code&access_type=offline&prompt=consent&include_granted_scopes=true' +
    '&scope=' + encodeURIComponent(GOOGLE_SCOPES) +
    '&state=' + newOAuthState_('google', clientId);
}

function googleTokenRequest_(payload) {
  payload.client_id = props_().getProperty(PROP.GOOGLE_OAUTH_CLIENT_ID);
  payload.client_secret = props_().getProperty(PROP.GOOGLE_OAUTH_CLIENT_SECRET);
  return httpJson_('https://oauth2.googleapis.com/token', { method: 'post', payload: payload });
}

function googleHandleCallback_(clientId, code) {
  var t = googleTokenRequest_({ code: code, grant_type: 'authorization_code', redirect_uri: ScriptApp.getService().getUrl() });
  if (!t.refresh_token) throw new Error('更新用トークンが取得できませんでした。もう一度連携してください。');
  props_().setProperty('GOOGLE_TOKENS_' + clientId, JSON.stringify({
    access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: Date.now() + (Number(t.expires_in) - 300) * 1000
  }));
  return getClient_(clientId);
}

function googleAccessToken_(clientId) {
  var t = getGoogleTokens_(clientId);
  if (!t) throw new Error('YouTube 詳細分析が未連携です');
  if (Date.now() < t.expires_at) return t.access_token;
  var nt = googleTokenRequest_({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
  t.access_token = nt.access_token;
  t.expires_at = Date.now() + (Number(nt.expires_in) - 300) * 1000;
  props_().setProperty('GOOGLE_TOKENS_' + clientId, JSON.stringify(t));
  return t.access_token;
}

function ytReport_(token, params) {
  return httpJson_('https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3DMINE&' + params,
    { headers: { Authorization: 'Bearer ' + token } });
}

/** 年齢 × 性別の viewerPercentage を年齢別・性別別に集計 */
function ytDemographicRows_(token, range, filter, base) {
  var res = ytReport_(token, range + '&metrics=viewerPercentage&dimensions=ageGroup,gender' + filter);
  var age = {}, gender = {};
  (res.rows || []).forEach(function (r) {
    var a = normAge_(r[0]), g = normGender_(r[1]), v = Number(r[2]) || 0;
    age[a] = (age[a] || 0) + v;
    gender[g] = (gender[g] || 0) + v;
  });
  return toPercentRows_(base, 'age', age).concat(toPercentRows_(base, 'gender', gender));
}

function ytFollowRows_(token, range, filter, base) {
  var res = ytReport_(token, range + '&metrics=views&dimensions=subscribedStatus' + filter);
  var counts = {};
  (res.rows || []).forEach(function (r) {
    counts[r[0] === 'SUBSCRIBED' ? 'follower' : 'non_follower'] = Number(r[1]) || 0;
  });
  return toPercentRows_(base, 'follow', counts);
}

function youtubeAudience_(client) {
  var token = googleAccessToken_(client.id);
  var month = currentMonth_();
  var fetchedAt = nowIso_();
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  // 属性は件数が少ないと返らないため、直近 90 日分で集計する
  var start = Utilities.formatDate(new Date(Date.now() - 89 * 86400000), TZ, 'yyyy-MM-dd');
  var range = 'startDate=' + start + '&endDate=' + today;
  var mk = function (scope) {
    return { month: month, clientId: client.id, platform: 'youtube', scope: scope, basis: 'viewers', fetchedAt: fetchedAt, source: 'api' };
  };
  var rows = ytDemographicRows_(token, range, '', mk('account')).concat(ytFollowRows_(token, range, '', mk('account')));

  // 動画単位: 直近の動画 10 本
  var recent = postsFor_(client.id).filter(function (p) { return p.platform === 'youtube'; })
    .sort(function (a, b) { return String(b.publishedAt).localeCompare(String(a.publishedAt)); }).slice(0, 10);
  recent.forEach(function (p) {
    var f = '&filters=video%3D%3D' + encodeURIComponent(p.postId);
    try {
      rows = rows.concat(ytDemographicRows_(token, range, f, mk(p.postId)), ytFollowRows_(token, range, f, mk(p.postId)));
    } catch (e) { /* 再生数が少ない動画は属性が返らない */ }
  });
  return rows;
}

// ---------------- OAuth の state（TikTok / Google 共通） ----------------

function newOAuthState_(provider, clientId) {
  var state = Utilities.getUuid();
  CacheService.getScriptCache().put('oauth:' + state, JSON.stringify({ provider: provider, clientId: clientId }), 1800);
  return state;
}

function takeOAuthState_(state) {
  var cache = CacheService.getScriptCache();
  var raw = cache.get('oauth:' + state);
  if (!raw) throw new Error('連携リンクの有効期限が切れています。もう一度やり直してください。');
  cache.remove('oauth:' + state);
  return JSON.parse(raw);
}

// ---------------- 手入力 ----------------

/**
 * input: { clientId, platform, month, scope, basis, age: {'18-24': 30, ...}, gender: {...}, follow: {...} }
 */
function saveManualAudience_(input) {
  var base = { month: input.month || currentMonth_(), clientId: input.clientId, platform: input.platform,
               scope: input.scope || 'account', basis: input.basis || 'viewers', fetchedAt: nowIso_(), source: 'manual' };
  var allowed = { age: AGE_KEYS, gender: GENDER_KEYS, follow: FOLLOW_KEYS };
  var rows = [];
  Object.keys(allowed).forEach(function (dim) {
    var src = input[dim] || {}, counts = {};
    allowed[dim].forEach(function (k) {
      if (src[k] !== '' && src[k] !== undefined && src[k] !== null && isFinite(Number(src[k]))) counts[k] = Number(src[k]);
    });
    rows = rows.concat(toPercentRows_(base, dim, counts));
  });
  if (!rows.length) throw new Error('数値が 1 つも入力されていません');
  saveAudience_(rows);
  return rows.length;
}
