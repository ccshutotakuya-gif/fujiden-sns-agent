/**
 * 認証 — Cc 共通パスワードを知っている人だけが使える。
 *
 * - パスワードは平文保存せず、ソルト付き SHA-256 を Script Properties に保存
 * - ログイン成功でランダムなセッショントークンを発行（6 時間有効）
 * - 画面から呼ばれる全 API はトークン検証を通す（Api.gs の guard_）
 * - 連続 5 回失敗で 15 分ロック
 */

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

/** 定数時間比較（タイミング攻撃対策） */
function safeEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function hashPassword_(pass, salt) {
  // 簡易ストレッチング（1,000 回）
  var h = salt + ':' + pass;
  for (var i = 0; i < 1000; i++) h = sha256Hex_(h + salt);
  return h;
}

/** 初期設定・パスワード変更用（GAS エディタから setPassword('新しいPASS') を実行） */
function setPasswordInternal_(pass) {
  if (!pass || String(pass).length < 8) throw new Error('パスワードは 8 文字以上にしてください');
  var salt = Utilities.getUuid();
  props_().setProperties({ PASS_SALT: salt, PASS_HASH: hashPassword_(String(pass), salt) });
  // 既存セッションを無効化するため世代番号を更新
  props_().setProperty('SESSION_GEN', Utilities.getUuid().slice(0, 8));
}

function sessionKey_(token) {
  return 'sess:' + (props_().getProperty('SESSION_GEN') || '0') + ':' + token;
}

function login_(pass) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('login_fails') || 0);
  if (fails >= LOGIN_MAX_FAILS) {
    throw new Error('ログイン試行回数が上限に達しました。15 分後に再度お試しください。');
  }
  var salt = props_().getProperty(PROP.PASS_SALT);
  var hash = props_().getProperty(PROP.PASS_HASH);
  if (!salt || !hash) throw new Error('パスワードが未設定です。管理者が setPassword を実行してください。');

  if (!safeEqual_(hashPassword_(String(pass || ''), salt), hash)) {
    cache.put('login_fails', String(fails + 1), LOGIN_LOCK_SEC);
    log_('warn', 'auth', 'ログイン失敗 (' + (fails + 1) + '回目)');
    throw new Error('パスワードが正しくありません');
  }
  cache.remove('login_fails');
  var token = Utilities.getUuid() + Utilities.getUuid();
  cache.put(sessionKey_(token), '1', SESSION_TTL_SEC);
  return token;
}

function verify_(token) {
  if (!token) return false;
  return CacheService.getScriptCache().get(sessionKey_(token)) === '1';
}

function logout_(token) {
  if (token) CacheService.getScriptCache().remove(sessionKey_(token));
}
