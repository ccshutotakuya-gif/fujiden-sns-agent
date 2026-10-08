/**
 * 月次集計（純粋関数のみ — GAS API を使わないので Node でテスト可能）
 */

function n_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var x = Number(v);
  return isFinite(x) ? x : null;
}

function sumOrNull_(arr) {
  var vals = arr.filter(function (v) { return v !== null; });
  return vals.length ? vals.reduce(function (a, b) { return a + b; }, 0) : null;
}

function prevMonth_(month) {
  var y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)) - 1;
  if (m === 0) { y -= 1; m = 12; }
  return y + '-' + (m < 10 ? '0' + m : m);
}

function pct_(a, b) {
  if (a === null || b === null || b === 0) return null;
  return Math.round(((a - b) / b) * 1000) / 10;
}

/** 1 媒体・1 か月分の指標 */
function platformMonth_(snaps, posts, month) {
  var sorted = snaps.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  var inMonth = sorted.filter(function (s) { return String(s.date).slice(0, 7) === month; });
  var before = sorted.filter(function (s) { return String(s.date).slice(0, 7) < month; });
  var monthPosts = posts.filter(function (p) { return toJstMonth_(p.publishedAt) === month; });

  if (!inMonth.length && !monthPosts.length) return null;

  var endSnap = inMonth[inMonth.length - 1] || null;
  var startSnap = before.length ? before[before.length - 1] : inMonth[0] || null;
  var followersEnd = endSnap ? n_(endSnap.followers) : null;
  var followersStart = startSnap ? n_(startSnap.followers) : null;

  // 再生/表示: 日次値 → 累計の差分 → 当月投稿の合計 の順で採用
  var dailyViews = sumOrNull_(inMonth.map(function (s) { return n_(s.views); }));
  var totalDiff = endSnap && startSnap && n_(endSnap.totalViews) !== null && n_(startSnap.totalViews) !== null
    ? n_(endSnap.totalViews) - n_(startSnap.totalViews) : null;
  var postViews = sumOrNull_(monthPosts.map(function (p) { return n_(p.views); }));
  var views = dailyViews !== null ? dailyViews : totalDiff !== null ? totalDiff : postViews;
  var viewsSource = dailyViews !== null ? 'daily' : totalDiff !== null ? 'cumulative' : postViews !== null ? 'posts' : null;

  var likes = sumOrNull_(monthPosts.map(function (p) { return n_(p.likes); }));
  var comments = sumOrNull_(monthPosts.map(function (p) { return n_(p.comments); }));
  var shares = sumOrNull_(monthPosts.map(function (p) { return n_(p.shares); }));
  var saves = sumOrNull_(monthPosts.map(function (p) { return n_(p.saves); }));
  var interactions = sumOrNull_([likes, comments, shares, saves]);
  var engagementRate = interactions !== null && postViews ? Math.round((interactions / postViews) * 10000) / 100 : null;

  var top = monthPosts.slice().sort(function (a, b) {
    return (n_(b.views) || 0) - (n_(a.views) || 0) || (n_(b.likes) || 0) - (n_(a.likes) || 0);
  }).slice(0, 3).map(function (p) {
    return { postId: p.postId, title: p.title, url: p.url, type: p.type, publishedAt: p.publishedAt,
             views: n_(p.views), likes: n_(p.likes), comments: n_(p.comments), shares: n_(p.shares), saves: n_(p.saves) };
  });

  return {
    followersStart: followersStart,
    followersEnd: followersEnd,
    followerGrowth: followersStart !== null && followersEnd !== null ? followersEnd - followersStart : null,
    followerGrowthRate: pct_(followersEnd, followersStart),
    postsPublished: monthPosts.length,
    views: views,
    viewsSource: viewsSource,
    reach: sumOrNull_(inMonth.map(function (s) { return n_(s.reach); })),
    engagements: sumOrNull_(inMonth.map(function (s) { return n_(s.engagements); })),
    profileViews: sumOrNull_(inMonth.map(function (s) { return n_(s.profileViews); })),
    likes: likes, comments: comments, shares: shares, saves: saves,
    engagementRate: engagementRate,
    dataDays: inMonth.length,
    topPosts: top
  };
}

/** ISO 日時を日本時間の yyyy-MM に変換 */
function toJstMonth_(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 7);
  var j = new Date(d.getTime() + 9 * 3600 * 1000);
  var m = j.getUTCMonth() + 1;
  return j.getUTCFullYear() + '-' + (m < 10 ? '0' + m : m);
}

/**
 * レポート用の月次データ一式
 * @return {{month, prevMonth, client, platforms: Object, summary: Object}}
 */
function buildMonthlyData_(client, snapshots, posts, month, platforms, audienceRows) {
  var prev = prevMonth_(month);
  var out = {
    month: month,
    prevMonth: prev,
    client: { name: client.name, industry: client.industry, goal: client.goal, kpi: client.kpi, tone: client.tone, notes: client.notes },
    platforms: {},
    summary: { followersEnd: 0, followerGrowth: 0, views: 0, postsPublished: 0 }
  };
  (platforms || ['instagram', 'youtube', 'x', 'tiktok']).forEach(function (p) {
    var s = snapshots.filter(function (x) { return x.platform === p; });
    var ps = posts.filter(function (x) { return x.platform === p; });
    var cur = platformMonth_(s, ps, month);
    if (!cur) return;
    var before = platformMonth_(s, ps, prev);
    if (before) {
      delete before.topPosts;
      cur.previous = before;
      cur.change = {
        followers: pct_(cur.followersEnd, before.followersEnd),
        views: pct_(cur.views, before.views),
        postsPublished: pct_(cur.postsPublished, before.postsPublished),
        engagementRate: cur.engagementRate !== null && before.engagementRate !== null
          ? Math.round((cur.engagementRate - before.engagementRate) * 100) / 100 : null
      };
    }
    if (audienceRows) {
      var aud = audienceSummary_(audienceRows, p, 'account', month);
      if (aud) cur.audience = aud;
      cur.topPosts.forEach(function (tp) {
        var pa = audienceSummary_(audienceRows, p, String(tp.postId), month);
        if (pa) tp.audience = pa;
      });
    }
    out.platforms[p] = cur;
    out.summary.followersEnd += cur.followersEnd || 0;
    out.summary.followerGrowth += cur.followerGrowth || 0;
    out.summary.views += cur.views || 0;
    out.summary.postsPublished += cur.postsPublished || 0;
  });
  return out;
}

/**
 * 属性データの要約。対象月以前で最も新しい月のデータを使う。
 * @return {{month, followers?: {age, gender}, viewers?: {age, gender, follow}, engaged?: {...}}|null}
 */
function audienceSummary_(rows, platform, scope, month) {
  var mine = rows.filter(function (r) {
    return r.platform === platform && String(r.scope) === scope && String(r.month) <= month;
  });
  if (!mine.length) return null;
  var latest = mine.map(function (r) { return String(r.month); }).sort().pop();
  var out = { month: latest };
  mine.filter(function (r) { return String(r.month) === latest; }).forEach(function (r) {
    var b = out[r.basis] = out[r.basis] || {};
    var d = b[r.dimension] = b[r.dimension] || {};
    d[r.key] = n_(r.value);
  });
  return out;
}

/** 投稿 ID → 属性要約（投稿一覧の表示用） */
function postAudienceMap_(rows, month) {
  var map = {};
  rows.filter(function (r) { return r.scope !== 'account'; }).forEach(function (r) {
    var k = r.platform + '|' + r.scope;
    if (!map[k]) map[k] = audienceSummary_(rows, r.platform, String(r.scope), month);
  });
  return map;
}

/** 直近 N 日のフォロワー推移（ダッシュボードのグラフ用） */
function followerSeries_(snapshots, days) {
  var since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  var series = {};
  snapshots.filter(function (s) { return String(s.date) >= since; })
    .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); })
    .forEach(function (s) {
      (series[s.platform] = series[s.platform] || []).push({ date: String(s.date).slice(0, 10), followers: n_(s.followers) });
    });
  return series;
}

if (typeof module !== 'undefined') {
  module.exports = { buildMonthlyData_: buildMonthlyData_, platformMonth_: platformMonth_, prevMonth_: prevMonth_,
                     toJstMonth_: toJstMonth_, followerSeries_: followerSeries_,
                     audienceSummary_: audienceSummary_, postAudienceMap_: postAudienceMap_ };
}
