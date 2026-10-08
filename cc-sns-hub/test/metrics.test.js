// Metrics.gs の月次集計ロジックを Node で検証する: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// .gs は CommonJS として読み込めるよう一時ファイルにコピー
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ccsns-')), 'Metrics.js');
fs.copyFileSync(path.join(__dirname, '..', 'src', 'Metrics.gs'), tmp);
const M = require(tmp);

const client = { name: 'テスト工業', industry: '金属加工', goal: '採用', kpi: 'IG +100/月' };
const snaps = [
  { date: '2026-08-31', platform: 'instagram', followers: 900, views: '' },
  { date: '2026-09-01', platform: 'instagram', followers: 1000, views: 100, reach: 80 },
  { date: '2026-09-30', platform: 'instagram', followers: 1100, views: 200, reach: 150 },
  { date: '2026-10-01', platform: 'instagram', followers: 1150, views: 300, reach: '' },
  { date: '2026-10-15', platform: 'instagram', followers: 1210, views: 500, reach: 400 },
  { date: '2026-09-01', platform: 'youtube', followers: 50, totalViews: 10000 },
  { date: '2026-09-30', platform: 'youtube', followers: 60, totalViews: 12000 },
  { date: '2026-10-31', platform: 'youtube', followers: 75, totalViews: 15500 }
];
const posts = [
  { platform: 'instagram', publishedAt: '2026-10-02T03:00:00+0000', title: 'A', views: 1000, likes: 50, comments: 5, shares: 3, saves: 2 },
  { platform: 'instagram', publishedAt: '2026-10-20T03:00:00+0000', title: 'B', views: 3000, likes: 90, comments: 10, shares: 0, saves: 0 },
  // UTC 9/30 16:00 = JST 10/1 → 10 月扱い
  { platform: 'instagram', publishedAt: '2026-09-30T16:00:00Z', title: 'C', views: 500, likes: 10 },
  { platform: 'instagram', publishedAt: '2026-09-10T03:00:00Z', title: 'D', views: 800, likes: 40 },
  { platform: 'youtube', publishedAt: '2026-10-05T00:00:00Z', title: 'V', views: 2000, likes: 30, comments: 4 }
];

test('prevMonth_ は年をまたぐ', () => {
  assert.strictEqual(M.prevMonth_('2026-01'), '2025-12');
  assert.strictEqual(M.prevMonth_('2026-11'), '2026-10');
});

test('toJstMonth_ は日本時間で月を判定する', () => {
  assert.strictEqual(M.toJstMonth_('2026-09-30T16:00:00Z'), '2026-10');
  assert.strictEqual(M.toJstMonth_('2026-09-30T14:59:00Z'), '2026-09');
});

test('Instagram の月次指標（日次値の合計・前月末からのフォロワー増減）', () => {
  const d = M.buildMonthlyData_(client, snaps, posts, '2026-10');
  const ig = d.platforms.instagram;
  assert.strictEqual(ig.followersStart, 1100);     // 前月最終スナップショット
  assert.strictEqual(ig.followersEnd, 1210);
  assert.strictEqual(ig.followerGrowth, 110);
  assert.strictEqual(ig.views, 800);               // 300 + 500（日次合計）
  assert.strictEqual(ig.viewsSource, 'daily');
  assert.strictEqual(ig.reach, 400);               // 空欄は無視
  assert.strictEqual(ig.postsPublished, 3);        // A, B, C
  assert.strictEqual(ig.topPosts[0].title, 'B');
  // ER = (50+5+3+2 + 90+10 + 10) / (1000+3000+500)
  assert.strictEqual(ig.engagementRate, Math.round(170 / 4500 * 10000) / 100);
  assert.ok(ig.previous);
  assert.strictEqual(ig.previous.followersEnd, 1100);
  assert.strictEqual(ig.change.followers, 10);     // 1100 → 1210 = +10%
});

test('YouTube は累計再生数の差分で月間再生を出す', () => {
  const d = M.buildMonthlyData_(client, snaps, posts, '2026-10');
  const yt = d.platforms.youtube;
  assert.strictEqual(yt.views, 3500);
  assert.strictEqual(yt.viewsSource, 'cumulative');
  assert.strictEqual(yt.followerGrowth, 15);
});

test('データが無い媒体は含めない・合計を出す', () => {
  const d = M.buildMonthlyData_(client, snaps, posts, '2026-10');
  assert.deepStrictEqual(Object.keys(d.platforms).sort(), ['instagram', 'youtube']);
  assert.strictEqual(d.summary.followersEnd, 1210 + 75);
  assert.strictEqual(d.summary.followerGrowth, 110 + 15);
  const empty = M.buildMonthlyData_(client, snaps, posts, '2025-01');
  assert.deepStrictEqual(empty.platforms, {});
});

test('初月（前月データなし）は月初スナップショットを起点にする', () => {
  const d = M.buildMonthlyData_(client, snaps.filter(s => s.date >= '2026-10'),
    posts.filter(p => M.toJstMonth_(p.publishedAt) === '2026-10'), '2026-10');
  assert.strictEqual(d.platforms.instagram.followersStart, 1150);
  assert.strictEqual(d.platforms.instagram.change, undefined);
});

test('属性データ: 対象月以前で最新の月を使い、アカウントと投稿を分けて付与する', () => {
  const aud = [
    { month: '2026-09', platform: 'instagram', scope: 'account', basis: 'followers', dimension: 'age', key: '25-34', value: '40' },
    { month: '2026-10', platform: 'instagram', scope: 'account', basis: 'followers', dimension: 'age', key: '25-34', value: '45' },
    { month: '2026-10', platform: 'instagram', scope: 'account', basis: 'followers', dimension: 'age', key: '18-24', value: '30' },
    { month: '2026-10', platform: 'instagram', scope: 'account', basis: 'viewers', dimension: 'follow', key: 'non_follower', value: '62.5' },
    { month: '2026-11', platform: 'instagram', scope: 'account', basis: 'followers', dimension: 'age', key: '25-34', value: '99' },
    { month: '2026-10', platform: 'youtube', scope: 'v1', basis: 'viewers', dimension: 'gender', key: 'male', value: '70' }
  ];
  const posts2 = posts.concat([{ platform: 'youtube', postId: 'v1', publishedAt: '2026-10-06T00:00:00Z', title: 'V1', views: 9000 }]);
  const d = M.buildMonthlyData_(client, snaps, posts2, '2026-10', null, aud);
  const ig = d.platforms.instagram.audience;
  assert.strictEqual(ig.month, '2026-10');
  assert.deepStrictEqual(ig.followers.age, { '25-34': 45, '18-24': 30 });
  assert.strictEqual(ig.viewers.follow.non_follower, 62.5);
  const top = d.platforms.youtube.topPosts.find(p => p.postId === 'v1');
  assert.strictEqual(top.audience.viewers.gender.male, 70);
  assert.strictEqual(d.platforms.youtube.audience, undefined);
  // 9 月を指定すると 9 月のデータ
  assert.strictEqual(M.audienceSummary_(aud, 'instagram', 'account', '2026-09').followers.age['25-34'], 40);
  assert.ok(M.postAudienceMap_(aud, '2026-10')['youtube|v1']);
});
