/**
 * データ保存 — Google スプレッドシートを DB として使う。
 * Clients / Snapshots / Posts / Reports / Logs の 5 シート。
 */

function ss_() {
  var id = props_().getProperty(PROP.SPREADSHEET_ID);
  if (!id) throw new Error('初期セットアップ未実行です（GAS エディタで setup を実行してください）');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) {
    sh = ss_().insertSheet(name);
    // 日付や "2026-09" が勝手に日付型へ変換されないよう全体を書式なしテキストにする
    sh.getRange(1, 1, sh.getMaxRows(), SHEETS[name].length).setNumberFormat('@');
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** シート全体をオブジェクト配列で返す */
function readAll_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var cols = SHEETS[name];
  var values = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return values.map(function (row, i) {
    var o = { _row: i + 2 };
    cols.forEach(function (c, j) {
      var v = row[j];
      if (v instanceof Date) {
        var fmt = c === 'date' ? 'yyyy-MM-dd' : c === 'month' ? 'yyyy-MM' : "yyyy-MM-dd'T'HH:mm:ss";
        v = Utilities.formatDate(v, TZ, fmt);
      }
      o[c] = v;
    });
    return o;
  });
}

function toRow_(name, obj) {
  return SHEETS[name].map(function (c) { return obj[c] === undefined || obj[c] === null ? '' : obj[c]; });
}

function appendRows_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name);
  var rows = objs.map(function (o) { return toRow_(name, o); });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, SHEETS[name].length).setValues(rows);
}

function updateRow_(name, rowNum, obj) {
  sheet_(name).getRange(rowNum, 1, 1, SHEETS[name].length).setValues([toRow_(name, obj)]);
}

/**
 * キーが一致する行は上書き、無ければ追加（Snapshots / Posts の重複防止）
 */
function upsertRows_(name, objs, keyFn) {
  if (!objs.length) return;
  var existing = readAll_(name);
  var index = {};
  existing.forEach(function (o) { index[keyFn(o)] = o._row; });
  var toAppend = [];
  objs.forEach(function (o) {
    var row = index[keyFn(o)];
    if (row) updateRow_(name, row, o); else toAppend.push(o);
  });
  appendRows_(name, toAppend);
}

function log_(level, scope, message) {
  try {
    appendRows_('Logs', [{ at: nowIso_(), level: level, scope: scope, message: String(message).slice(0, 1000) }]);
  } catch (e) {
    console.log('[log failed] ' + scope + ': ' + message);
  }
}

function nowIso_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
}

function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

// ---------- Clients ----------

function listClients_() {
  return readAll_('Clients').map(function (c) {
    c.active = c.active === true || c.active === 'TRUE' || c.active === 'true' || c.active === '';
    return c;
  });
}

function getClient_(id) {
  var c = listClients_().filter(function (x) { return x.id === id; })[0];
  if (!c) throw new Error('クライアントが見つかりません: ' + id);
  return c;
}

function saveClient_(input) {
  var fields = ['name', 'industry', 'goal', 'kpi', 'tone', 'notes', 'active',
                'ig_user_id', 'yt_channel_id', 'x_username', 'tiktok_open_id'];
  if (!input || !String(input.name || '').trim()) throw new Error('クライアント名は必須です');
  if (input.x_username) input.x_username = String(input.x_username).replace(/^@/, '').trim();

  if (input.id) {
    var cur = getClient_(input.id);
    fields.forEach(function (f) { if (f in input) cur[f] = input[f]; });
    updateRow_('Clients', cur._row, cur);
    return cur;
  }
  var c = { id: 'c_' + Utilities.getUuid().slice(0, 8), createdAt: nowIso_(), active: true };
  fields.forEach(function (f) { if (f in input) c[f] = input[f]; });
  appendRows_('Clients', [c]);
  return c;
}

function deleteClient_(id) {
  var c = getClient_(id);
  sheet_('Clients').deleteRow(c._row);
}

// ---------- Metrics ----------

function saveSnapshots_(snaps) {
  upsertRows_('Snapshots', snaps, function (o) { return o.date + '|' + o.clientId + '|' + o.platform; });
}

function savePosts_(posts) {
  upsertRows_('Posts', posts, function (o) { return o.clientId + '|' + o.platform + '|' + o.postId; });
}

function snapshotsFor_(clientId) {
  return readAll_('Snapshots').filter(function (s) { return s.clientId === clientId; });
}

function postsFor_(clientId) {
  return readAll_('Posts').filter(function (p) { return p.clientId === clientId; });
}

// ---------- Reports ----------

function saveReport_(r) {
  appendRows_('Reports', [r]);
  return r;
}

function reportsFor_(clientId) {
  return readAll_('Reports').filter(function (r) { return r.clientId === clientId; })
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
}
