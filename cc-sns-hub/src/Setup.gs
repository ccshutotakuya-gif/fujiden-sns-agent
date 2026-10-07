/**
 * 初期セットアップ・定期実行
 *
 * 【最初に 1 回だけ GAS エディタで実行】
 *   1. プロジェクトの設定 → スクリプト プロパティ に INITIAL_PASS = (Cc の共通パスワード) を追加
 *   2. 関数 setup を選んで実行（権限の承認を求められたら許可）
 *      → スプレッドシート / レポート用フォルダ作成、パスワード登録、定期実行トリガー作成
 *   3. INITIAL_PASS はセットアップ時に自動で削除されます
 *
 * ※ setup / runDailyCollect / runMonthlyReports は末尾に _ が無いので画面からも呼べてしまうが、
 *   いずれも「何度実行しても安全（冪等）」で、秘密情報を返さない設計にしている。
 */

function setup() {
  var p = props_();
  if (!p.getProperty(PROP.SPREADSHEET_ID)) {
    var ss = SpreadsheetApp.create(APP_NAME + ' データベース');
    p.setProperty(PROP.SPREADSHEET_ID, ss.getId());
    Object.keys(SHEETS).forEach(function (name) { sheet_(name); });
    var def = ss.getSheetByName('Sheet1') || ss.getSheetByName('シート1');
    if (def) ss.deleteSheet(def);
  }
  if (!p.getProperty(PROP.REPORT_FOLDER_ID)) {
    p.setProperty(PROP.REPORT_FOLDER_ID, DriveApp.createFolder(APP_NAME + ' 月次レポート').getId());
  }
  var initial = p.getProperty('INITIAL_PASS');
  if (initial) {
    setPasswordInternal_(initial);
    p.deleteProperty('INITIAL_PASS');
  }
  installTriggers_();
  return 'セットアップ完了';
}

function installTriggers_() {
  var existing = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (existing.indexOf('runDailyCollect') < 0) {
    ScriptApp.newTrigger('runDailyCollect').timeBased().everyDays(1).atHour(6).inTimezone(TZ).create();
  }
  if (existing.indexOf('runMonthlyReports') < 0) {
    ScriptApp.newTrigger('runMonthlyReports').timeBased().onMonthDay(1).atHour(8).inTimezone(TZ).create();
  }
}

/** 毎朝 6 時: 全クライアントのデータ取得（外部から連打されても 1 日 1 回まで） */
function runDailyCollect() {
  if (!onceFor_('LAST_DAILY_COLLECT', today_())) return;
  startJob_('collect', activeClientIds_(), {});
}

/** 毎月 1 日 8 時: 前月の月次レポート下書きを全社分作成（設定でオフ可・月 1 回まで） */
function runMonthlyReports() {
  if (!getSettings_().autoMonthlyReport) return;
  if (!onceFor_('LAST_MONTHLY_REPORT', Utilities.formatDate(new Date(), TZ, 'yyyy-MM'))) return;
  generateAllMonthlyReports_();
}

/** 同じ期間キーで 2 回目以降の実行なら false（AI 費用の空打ち防止） */
function onceFor_(propKey, period) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (props_().getProperty(propKey) === period) return false;
    props_().setProperty(propKey, period);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function activeClientIds_() {
  return listClients_().filter(function (c) { return c.active; }).map(function (c) { return c.id; });
}

// ---------------- ジョブキュー（GAS の 6 分制限対策） ----------------
// 7 社分のデータ取得・レポート生成は 1 回の実行で終わらないことがあるため、
// 一定時間を超えたら残りを保存し、1 分後に runJobQueue で続きから再開する。

// 1 件が最大 2 分程度かかるレポートは余裕を持たせる
var JOB_TIME_BUDGET_MS = { collect: 4 * 60 * 1000, report: 3 * 60 * 1000 };

function startJob_(kind, clientIds, meta) {
  var job = { kind: kind, queue: clientIds, results: [], meta: meta || {}, startedAt: nowIso_() };
  props_().setProperty('JOB_' + kind, JSON.stringify(job));
  processJob_(kind);
}

function processJob_(kind) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { scheduleContinuation_(); return; } // 別の実行が処理中 → 後で再開
  try {
    var raw = props_().getProperty('JOB_' + kind);
    if (!raw) return;
    var job = JSON.parse(raw);
    var t0 = Date.now();
    while (job.queue.length && Date.now() - t0 < JOB_TIME_BUDGET_MS[kind]) {
      var id = job.queue.shift();
      var name = id;
      try {
        var c = getClient_(id);
        name = c.name;
        if (kind === 'collect') {
          job.results.push(name + ': ' + JSON.stringify(collectClient_(c)));
        } else {
          var r = generateReport_(id, job.meta.month);
          job.results.push(name + ': ' + (r.docUrl || '作成済み'));
        }
      } catch (e) {
        job.results.push(name + ': 失敗 — ' + e.message);
        log_('error', 'job:' + kind, name + ' — ' + e.message);
      }
      props_().setProperty('JOB_' + kind, JSON.stringify(job));
    }
    if (job.queue.length) {
      scheduleContinuation_();
    } else {
      props_().deleteProperty('JOB_' + kind);
      finishJob_(job);
    }
  } finally {
    lock.releaseLock();
  }
}

function finishJob_(job) {
  log_('info', 'job:' + job.kind, '完了 ' + job.results.length + ' 件');
  var to = getSettings_().notifyEmail;
  if (job.kind === 'report' && to) {
    MailApp.sendEmail(to, '[' + APP_NAME + '] ' + monthLabel_(job.meta.month) + ' 月次レポート下書き完了',
      job.results.join('\n') + '\n\n内容を確認のうえクライアントへ送付してください。');
  }
}

function scheduleContinuation_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'runJobQueue'; });
  if (!exists) ScriptApp.newTrigger('runJobQueue').timeBased().after(60 * 1000).create();
}

/** 続き処理（トリガー専用。キューに残っている分だけを処理するので外部から呼ばれても無害） */
function runJobQueue() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runJobQueue') ScriptApp.deleteTrigger(t);
  });
  ['collect', 'report'].forEach(processJob_);
}

function jobStatus_() {
  var out = {};
  ['collect', 'report'].forEach(function (k) {
    var raw = props_().getProperty('JOB_' + k);
    if (raw) { var j = JSON.parse(raw); out[k] = { remaining: j.queue.length, done: j.results.length }; }
  });
  return out;
}
