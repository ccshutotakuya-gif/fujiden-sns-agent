/**
 * Cc SNS Hub — 設定・定数
 *
 * 命名ルール（重要）:
 *   google.script.run から呼べるのは「末尾が _ でない」グローバル関数のみ。
 *   画面から呼ぶ関数は Api.gs に集約し、それ以外の内部関数は必ず末尾に _ を付ける。
 */

var APP_NAME = 'Cc SNS Hub';
var SESSION_TTL_SEC = 6 * 60 * 60;       // ログイン有効時間（CacheService の上限 6 時間）
var LOGIN_MAX_FAILS = 5;                 // 連続失敗の上限
var LOGIN_LOCK_SEC = 15 * 60;            // 上限到達時のロック時間
var TZ = 'Asia/Tokyo';

var PLATFORMS = ['instagram', 'youtube', 'x', 'tiktok'];
var PLATFORM_LABELS = { instagram: 'Instagram', youtube: 'YouTube', x: 'X', tiktok: 'TikTok' };

// 外部 API のバージョン（仕様変更時はここだけ直す）
var META_GRAPH_VERSION = 'v23.0';

// AI 既定値（設定画面から上書き可能）
var DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
var DEFAULT_OPENAI_MODEL = 'gpt-5';

// スプレッドシートのシート定義（1 行目がヘッダー）
var SHEETS = {
  Clients: ['id', 'name', 'industry', 'goal', 'kpi', 'tone', 'notes', 'active',
            'ig_user_id', 'yt_channel_id', 'x_username', 'tiktok_open_id', 'createdAt'],
  // followers / posts / totalViews は「その時点の累計」、views / reach / engagements / profileViews は「その日 1 日分」
  Snapshots: ['date', 'clientId', 'platform', 'followers', 'posts', 'totalViews', 'views', 'reach',
              'engagements', 'profileViews', 'fetchedAt', 'source'],
  Posts: ['clientId', 'platform', 'postId', 'publishedAt', 'title', 'url', 'type',
          'views', 'reach', 'likes', 'comments', 'shares', 'saves', 'fetchedAt'],
  Reports: ['id', 'clientId', 'month', 'engine', 'createdAt', 'docUrl', 'markdown'],
  Logs: ['at', 'level', 'scope', 'message']
};

/** Script Properties のキー（秘密情報はシートではなくここに置く） */
var PROP = {
  PASS_HASH: 'PASS_HASH',
  PASS_SALT: 'PASS_SALT',
  SPREADSHEET_ID: 'SPREADSHEET_ID',
  REPORT_FOLDER_ID: 'REPORT_FOLDER_ID',
  ANTHROPIC_API_KEY: 'ANTHROPIC_API_KEY',
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  META_ACCESS_TOKEN: 'META_ACCESS_TOKEN',
  YOUTUBE_API_KEY: 'YOUTUBE_API_KEY',
  X_BEARER_TOKEN: 'X_BEARER_TOKEN',
  TIKTOK_CLIENT_KEY: 'TIKTOK_CLIENT_KEY',
  TIKTOK_CLIENT_SECRET: 'TIKTOK_CLIENT_SECRET',
  SETTINGS_JSON: 'SETTINGS_JSON'
};

/** 画面で扱う秘密情報キー（値そのものは画面に返さない） */
var SECRET_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'META_ACCESS_TOKEN',
                   'YOUTUBE_API_KEY', 'X_BEARER_TOKEN', 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'];

function props_() {
  return PropertiesService.getScriptProperties();
}

function getSettings_() {
  var raw = props_().getProperty(PROP.SETTINGS_JSON);
  var s = raw ? JSON.parse(raw) : {};
  return {
    agencyName: s.agencyName || '株式会社Cc',
    claudeModel: s.claudeModel || DEFAULT_CLAUDE_MODEL,
    openaiModel: s.openaiModel || DEFAULT_OPENAI_MODEL,
    defaultEngine: s.defaultEngine || 'claude+gpt',
    autoMonthlyReport: s.autoMonthlyReport !== false,
    notifyEmail: s.notifyEmail || '',
    reportInstruction: s.reportInstruction || DEFAULT_REPORT_INSTRUCTION
  };
}

function saveSettings_(patch) {
  var cur = getSettings_();
  Object.keys(patch || {}).forEach(function (k) {
    if (k in cur) cur[k] = patch[k];
  });
  props_().setProperty(PROP.SETTINGS_JSON, JSON.stringify(cur));
  return cur;
}
