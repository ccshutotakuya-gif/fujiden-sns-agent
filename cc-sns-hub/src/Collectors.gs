/**
 * 媒体別データ取得（Instagram / YouTube / X / TikTok）
 *
 * 各 collector は { snapshot: {...}, posts: [...] } を返す。
 * snapshot の followers / posts / totalViews は累計、views / reach / engagements / profileViews は前日 1 日分。
 * API キー未設定・未連携の媒体はスキップ（手入力で補完できる）。
 */

function httpJson_(url, opt) {
  opt = opt || {};
  opt.muteHttpExceptions = true;
  var res = UrlFetchApp.fetch(url, opt);
  var code = res.getResponseCode();
  var text = res.getContentText();
  var body;
  try { body = JSON.parse(text); } catch (e) { body = { raw: text }; }
  if (code >= 400) {
    var msg = (body.error && (body.error.message || body.error.code)) || body.detail || body.title || text;
    throw new Error('HTTP ' + code + ': ' + String(msg).slice(0, 300));
  }
  return body;
}

function num_(v) {
  var n = Number(v);
  return isFinite(n) ? n : '';
}

function yesterdayRange_() {
  var end = new Date();
  end.setHours(0, 0, 0, 0);
  var start = new Date(end.getTime() - 24 * 3600 * 1000);
  return { since: Math.floor(start.getTime() / 1000), until: Math.floor(end.getTime() / 1000) };
}

/** 1 クライアント・全媒体を取得して保存。結果サマリを返す */
function collectClient_(client) {
  var date = today_();
  var result = {};
  var collectors = {
    instagram: client.ig_user_id ? collectInstagram_ : null,
    youtube: client.yt_channel_id ? collectYouTube_ : null,
    x: client.x_username ? collectX_ : null,
    tiktok: getTikTokTokens_(client.id) ? collectTikTok_ : null
  };
  PLATFORMS.forEach(function (p) {
    var fn = collectors[p];
    if (!fn) { result[p] = 'skip'; return; }
    try {
      var out = fn(client);
      var snap = out.snapshot;
      snap.date = date; snap.clientId = client.id; snap.platform = p;
      snap.fetchedAt = nowIso_(); snap.source = 'api';
      saveSnapshots_([snap]);
      savePosts_(out.posts.map(function (post) {
        post.clientId = client.id; post.platform = p; post.fetchedAt = nowIso_();
        return post;
      }));
      result[p] = 'ok';
    } catch (e) {
      result[p] = 'error: ' + e.message;
      log_('error', 'collect:' + p, client.name + ' — ' + e.message);
    }
  });
  return result;
}

// ---------------- Instagram（Meta Graph API） ----------------
// 前提: クライアントの IG がプロアカウント（ビジネス/クリエイター）で Facebook ページに接続済み、
//       Cc のビジネスマネージャにパートナーとして追加 → システムユーザーのトークン 1 本で 7 社分取得。

function collectInstagram_(client) {
  var token = props_().getProperty(PROP.META_ACCESS_TOKEN);
  if (!token) throw new Error('META_ACCESS_TOKEN 未設定');
  var base = 'https://graph.facebook.com/' + META_GRAPH_VERSION + '/';
  var ig = encodeURIComponent(client.ig_user_id);
  var q = '&access_token=' + encodeURIComponent(token);

  var profile = httpJson_(base + ig + '?fields=username,followers_count,media_count' + q);
  var snap = { followers: num_(profile.followers_count), posts: num_(profile.media_count) };

  // アカウントの前日分インサイト（指標名は Meta 側で変わることがあるため 1 つずつ取得）
  var r = yesterdayRange_();
  var map = { reach: 'reach', views: 'views', accounts_engaged: 'engagements', profile_views: 'profileViews' };
  Object.keys(map).forEach(function (metric) {
    try {
      var ins = httpJson_(base + ig + '/insights?metric=' + metric + '&period=day&metric_type=total_value' +
        '&since=' + r.since + '&until=' + r.until + q);
      var d = ins.data && ins.data[0];
      if (d && d.total_value) snap[map[metric]] = num_(d.total_value.value);
    } catch (e) { /* 未対応の指標は空欄のまま */ }
  });

  var media = httpJson_(base + ig + '/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,like_count,comments_count&limit=40' + q);
  var items = media.data || [];
  // 投稿ごとのインサイトは並列取得（7 社 × 40 投稿でも数十秒で終わるように）
  var insights = UrlFetchApp.fetchAll(items.map(function (m) {
    return { url: base + m.id + '/insights?metric=views,reach,saved,shares' + q, muteHttpExceptions: true };
  }));
  var posts = items.map(function (m, idx) {
    var post = {
      postId: m.id, publishedAt: m.timestamp, title: (m.caption || '').slice(0, 120),
      url: m.permalink, type: m.media_product_type || m.media_type,
      likes: num_(m.like_count), comments: num_(m.comments_count)
    };
    var r = insights[idx];
    if (r.getResponseCode() < 400) { // ストーリーズ等インサイト非対応の投稿はスキップ
      (JSON.parse(r.getContentText()).data || []).forEach(function (x) {
        var v = x.values && x.values[0] ? x.values[0].value : x.total_value && x.total_value.value;
        if (x.name === 'views') post.views = num_(v);
        if (x.name === 'reach') post.reach = num_(v);
        if (x.name === 'saved') post.saves = num_(v);
        if (x.name === 'shares') post.shares = num_(v);
      });
    }
    return post;
  });
  return { snapshot: snap, posts: posts };
}

// ---------------- YouTube（Data API v3 / API キーのみ） ----------------
// 公開統計（登録者・総再生・動画ごとの再生/高評価/コメント）を取得。クォータ消費は 1 社あたり約 3 ユニット/日。

function collectYouTube_(client) {
  var key = props_().getProperty(PROP.YOUTUBE_API_KEY);
  if (!key) throw new Error('YOUTUBE_API_KEY 未設定');
  var base = 'https://www.googleapis.com/youtube/v3/';
  var k = '&key=' + encodeURIComponent(key);
  var idParam = /^UC/.test(client.yt_channel_id)
    ? 'id=' + encodeURIComponent(client.yt_channel_id)
    : 'forHandle=' + encodeURIComponent(String(client.yt_channel_id).replace(/^@/, ''));

  var ch = httpJson_(base + 'channels?part=statistics,contentDetails&' + idParam + k);
  var c = ch.items && ch.items[0];
  if (!c) throw new Error('チャンネルが見つかりません: ' + client.yt_channel_id);
  var st = c.statistics;
  var snap = { followers: num_(st.subscriberCount), posts: num_(st.videoCount), totalViews: num_(st.viewCount) };

  var uploads = c.contentDetails.relatedPlaylists.uploads;
  var pl = httpJson_(base + 'playlistItems?part=contentDetails&maxResults=30&playlistId=' + uploads + k);
  var ids = (pl.items || []).map(function (i) { return i.contentDetails.videoId; });
  var posts = [];
  if (ids.length) {
    var vids = httpJson_(base + 'videos?part=snippet,statistics,contentDetails&id=' + ids.join(',') + k);
    posts = (vids.items || []).map(function (v) {
      var isShort = isoDurationSec_(v.contentDetails.duration) <= 180;
      return {
        postId: v.id, publishedAt: v.snippet.publishedAt, title: v.snippet.title,
        url: 'https://www.youtube.com/watch?v=' + v.id, type: isShort ? 'short' : 'video',
        views: num_(v.statistics.viewCount), likes: num_(v.statistics.likeCount),
        comments: num_(v.statistics.commentCount)
      };
    });
  }
  return { snapshot: snap, posts: posts };
}

/** "PT1M5S" → 65 */
function isoDurationSec_(d) {
  var m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d || '');
  if (!m) return Infinity;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

// ---------------- X（API v2 / Bearer Token） ----------------
// X API は 2026 年から従量課金（投稿の読み取り 1 件あたり課金）。直近 10 件だけ取得して費用を抑える。
// 契約しない場合は X だけ手入力運用にする。

function collectX_(client) {
  var bearer = props_().getProperty(PROP.X_BEARER_TOKEN);
  if (!bearer) throw new Error('X_BEARER_TOKEN 未設定');
  var opt = { headers: { Authorization: 'Bearer ' + bearer } };
  var base = 'https://api.x.com/2/';
  var u = httpJson_(base + 'users/by/username/' + encodeURIComponent(client.x_username) + '?user.fields=public_metrics', opt);
  var pm = u.data.public_metrics;
  var snap = { followers: num_(pm.followers_count), posts: num_(pm.tweet_count) };

  var tw = httpJson_(base + 'users/' + u.data.id + '/tweets?max_results=10&exclude=replies,retweets&tweet.fields=created_at,public_metrics', opt);
  var posts = (tw.data || []).map(function (t) {
    var m = t.public_metrics || {};
    return {
      postId: t.id, publishedAt: t.created_at, title: (t.text || '').slice(0, 120),
      url: 'https://x.com/' + client.x_username + '/status/' + t.id, type: 'post',
      views: num_(m.impression_count), likes: num_(m.like_count), comments: num_(m.reply_count),
      shares: num_((m.retweet_count || 0) + (m.quote_count || 0)), saves: num_(m.bookmark_count)
    };
  });
  return { snapshot: snap, posts: posts };
}

// ---------------- TikTok（Display API / クライアントごとに OAuth 連携） ----------------

var TIKTOK_SCOPES = 'user.info.basic,user.info.profile,user.info.stats,video.list';

function getTikTokTokens_(clientId) {
  var raw = props_().getProperty('TIKTOK_TOKENS_' + clientId);
  return raw ? JSON.parse(raw) : null;
}

function setTikTokTokens_(clientId, t) {
  props_().setProperty('TIKTOK_TOKENS_' + clientId, JSON.stringify(t));
}

function tiktokTokenRequest_(payload) {
  var res = httpJson_('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'post', contentType: 'application/x-www-form-urlencoded', payload: payload
  });
  if (!res.access_token) throw new Error('TikTok トークン取得失敗: ' + JSON.stringify(res).slice(0, 200));
  return {
    access_token: res.access_token,
    refresh_token: res.refresh_token,
    open_id: res.open_id,
    expires_at: Date.now() + (Number(res.expires_in) - 300) * 1000
  };
}

/** 連携開始 URL を作る（ログイン済みユーザーのみ呼べる） */
function tiktokAuthUrl_(clientId) {
  var key = props_().getProperty(PROP.TIKTOK_CLIENT_KEY);
  if (!key) throw new Error('TIKTOK_CLIENT_KEY 未設定');
  var state = Utilities.getUuid();
  CacheService.getScriptCache().put('tt_state:' + state, clientId, 1800);
  return 'https://www.tiktok.com/v2/auth/authorize/?client_key=' + encodeURIComponent(key) +
    '&scope=' + encodeURIComponent(TIKTOK_SCOPES) + '&response_type=code' +
    '&redirect_uri=' + encodeURIComponent(ScriptApp.getService().getUrl()) +
    '&state=' + state;
}

/** doGet から呼ばれる OAuth コールバック */
function tiktokHandleCallback_(code, state) {
  var cache = CacheService.getScriptCache();
  var clientId = cache.get('tt_state:' + state);
  if (!clientId) throw new Error('連携リンクの有効期限が切れています。もう一度やり直してください。');
  cache.remove('tt_state:' + state);
  var t = tiktokTokenRequest_({
    client_key: props_().getProperty(PROP.TIKTOK_CLIENT_KEY),
    client_secret: props_().getProperty(PROP.TIKTOK_CLIENT_SECRET),
    code: code, grant_type: 'authorization_code',
    redirect_uri: ScriptApp.getService().getUrl()
  });
  setTikTokTokens_(clientId, t);
  var c = getClient_(clientId);
  c.tiktok_open_id = t.open_id;
  updateRow_('Clients', c._row, c);
  return c;
}

function tiktokAccessToken_(clientId) {
  var t = getTikTokTokens_(clientId);
  if (!t) throw new Error('TikTok 未連携');
  if (Date.now() < t.expires_at) return t.access_token;
  var nt = tiktokTokenRequest_({
    client_key: props_().getProperty(PROP.TIKTOK_CLIENT_KEY),
    client_secret: props_().getProperty(PROP.TIKTOK_CLIENT_SECRET),
    grant_type: 'refresh_token', refresh_token: t.refresh_token
  });
  setTikTokTokens_(clientId, nt);
  return nt.access_token;
}

function collectTikTok_(client) {
  var token = tiktokAccessToken_(client.id);
  var auth = { Authorization: 'Bearer ' + token };
  var info = httpJson_('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,follower_count,likes_count,video_count',
    { headers: auth });
  var u = info.data.user;
  var snap = { followers: num_(u.follower_count), posts: num_(u.video_count) };

  var list = httpJson_('https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,share_url,view_count,like_count,comment_count,share_count', {
    method: 'post', contentType: 'application/json', headers: auth, payload: JSON.stringify({ max_count: 20 })
  });
  var posts = ((list.data && list.data.videos) || []).map(function (v) {
    return {
      postId: v.id, publishedAt: new Date(v.create_time * 1000).toISOString(),
      title: (v.title || v.video_description || '').slice(0, 120), url: v.share_url, type: 'video',
      views: num_(v.view_count), likes: num_(v.like_count), comments: num_(v.comment_count), shares: num_(v.share_count)
    };
  });
  return { snapshot: snap, posts: posts };
}
