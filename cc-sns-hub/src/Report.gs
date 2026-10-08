/**
 * 月次レポート生成 → Google ドキュメント出力
 */

function monthlyDataFor_(clientId, month) {
  var client = getClient_(clientId);
  return buildMonthlyData_(client, snapshotsFor_(clientId), postsFor_(clientId), month, null, audienceFor_(clientId));
}

function generateReport_(clientId, month, engine) {
  var s = getSettings_();
  engine = engine || s.defaultEngine;
  var data = monthlyDataFor_(clientId, month);
  if (!Object.keys(data.platforms).length) {
    throw new Error(monthLabel_(month) + ' のデータがありません。先に「データ取得」または手入力をしてください。');
  }
  var md = writeReport_(data, engine);
  var docUrl = '';
  try {
    docUrl = markdownToDoc_(data.client.name + '_SNSレポート_' + month, md);
  } catch (e) {
    log_('warn', 'report', 'ドキュメント出力失敗: ' + e.message);
  }
  var r = {
    id: 'r_' + Utilities.getUuid().slice(0, 8), clientId: clientId, month: month,
    engine: engine, createdAt: nowIso_(), docUrl: docUrl,
    markdown: md.slice(0, 49000) // セル上限 50,000 文字
  };
  saveReport_(r);
  return r;
}

/** 前月分レポートを全アクティブクライアントで生成（月初トリガー → ジョブキューで順次処理） */
function generateAllMonthlyReports_() {
  var month = prevMonth_(Utilities.formatDate(new Date(), TZ, 'yyyy-MM'));
  startJob_('report', activeClientIds_(), { month: month });
}

// ---------------- Markdown → Google ドキュメント ----------------

function reportFolder_() {
  var id = props_().getProperty(PROP.REPORT_FOLDER_ID);
  return id ? DriveApp.getFolderById(id) : DriveApp.getRootFolder();
}

function markdownToDoc_(title, md) {
  var doc = DocumentApp.create(title);
  var body = doc.getBody();
  body.clear();
  var lines = md.replace(/\r/g, '').split('\n');
  var i = 0;
  while (i < lines.length) {
    var line = lines[i];
    if (/^\s*\|/.test(line)) {
      var rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        if (!/^\s*\|[\s:\-|]+\|\s*$/.test(lines[i])) {
          rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return stripMd_(c.trim()); }));
        }
        i++;
      }
      var width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
      rows = rows.map(function (r) { while (r.length < width) r.push(''); return r; });
      var table = body.appendTable(rows);
      if (rows.length) {
        var head = table.getRow(0);
        for (var k = 0; k < head.getNumCells(); k++) head.getCell(k).editAsText().setBold(true);
      }
      continue;
    }
    var m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      var level = [DocumentApp.ParagraphHeading.TITLE, DocumentApp.ParagraphHeading.HEADING1,
                   DocumentApp.ParagraphHeading.HEADING2, DocumentApp.ParagraphHeading.HEADING3][m[1].length - 1];
      body.appendParagraph(stripMd_(m[2])).setHeading(level);
    } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      appendRich_(body.appendListItem(''), m[1]).setGlyphType(DocumentApp.GlyphType.BULLET);
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      appendRich_(body.appendListItem(''), m[1]).setGlyphType(DocumentApp.GlyphType.NUMBER);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      appendRich_(body.appendParagraph(''), m[1]).editAsText().setItalic(true);
    } else if (line.trim() && !/^```/.test(line)) {
      appendRich_(body.appendParagraph(''), line);
    }
    i++;
  }
  doc.saveAndClose();
  var file = DriveApp.getFileById(doc.getId());
  file.moveTo(reportFolder_());
  return doc.getUrl();
}

function stripMd_(s) {
  return String(s).replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}

/** **太字** を反映して段落に追記 */
function appendRich_(para, text) {
  var plain = '';
  var bolds = [];
  String(text).split(/(\*\*.+?\*\*)/).forEach(function (part) {
    if (/^\*\*.+\*\*$/.test(part)) {
      var t = part.slice(2, -2);
      bolds.push([plain.length, plain.length + t.length - 1]);
      plain += t;
    } else {
      plain += part.replace(/`([^`]+)`/g, '$1');
    }
  });
  if (!plain) return para;
  var el = para.appendText(plain);
  bolds.forEach(function (b) { if (b[1] >= b[0]) el.setBold(b[0], b[1], true); });
  return para;
}
