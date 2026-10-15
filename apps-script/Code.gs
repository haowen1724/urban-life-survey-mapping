/**
 * Urban Life Survey Mapping 城市生活調查測繪 — Google Sheets backend (beta)
 *
 * Paste this whole file into Extensions → Apps Script of a new Google Sheet,
 * run setup() once, then Deploy → New deployment → Web app.
 * Full steps are in README.md.
 *
 * Data model
 *   points     one row per survey point (set up by the admin)
 *   surveyors  one row per surveyor name
 *   records    one row per saved survey; the full detail is in the payload column
 *   moving     people-moving counts, one row per record   (for analysis)
 *   staying    people-staying, one row per plotted person (for analysis)
 *   quality    quality scores, one row per record         (for analysis)
 *
 * Access
 *   Two codes are kept in Script Properties: ADMIN_CODE and STUDY_CODE.
 *   The admin link can change the setup and delete any record.
 *   The surveyor link can add records and delete only records from its own device.
 *   The codes are a shared secret, not real authentication. Treat the links like a
 *   door key, and change the codes (run rotateCodes) if a link leaks.
 */

var AGES = ["0-4", "5-14", "15-24", "25-44", "45-64", "65+"];
var GEN = ["f", "m", "u"];
var MODES = ["walk", "assist", "stroller", "cycle", "kick", "motor"];
var POSTURES = ["standing", "leaning", "sit_public", "sit_comm", "sit_informal", "lying", "moving_in"];
var ACTS = ["talking", "eating", "electronics", "waiting", "commerce", "rec_passive", "rec_active",
            "play", "cultural", "working", "care", "other"];
var PROPS = ["none", "brought", "natural", "fixed"];
var TYPES = ["moving", "stationary", "quality"];
var QKEYS = [];
for (var gi = 0; gi < 3; gi++) for (var qi = 0; qi < 4; qi++) QKEYS.push("q" + gi + "_" + qi);

var MAX_BODY = 400000;       // bytes per request
var MAX_PLAN = 3000000;      // bytes for the site plan image
var MAX_PEOPLE = 300;        // people per staying record
var FOLDER_NAME = "Urban Life Survey — site plans";

var HEAD = {
  points: ["id", "n", "name", "x", "y", "surveyor", "created_at"],
  surveyors: ["name", "created_at"],
  records: ["record_id", "type", "point_id", "point", "surveyor", "time", "time_local", "day_type", "slot",
            "weather", "total", "notes", "device", "created_at", "payload"],
  moving: (function () {
    var h = ["record_id", "point", "surveyor", "time_local", "day_type", "slot", "weather", "counted_seconds", "total"];
    AGES.forEach(function (a) { GEN.forEach(function (g) { h.push("n_" + a + "_" + g); }); });
    MODES.forEach(function (m) { h.push("mode_" + m); });
    h.push("notes");
    return h;
  })(),
  staying: ["record_id", "point", "surveyor", "time_local", "day_type", "slot", "weather", "person", "x", "y",
            "age", "gender", "posture", "activities", "group_size", "mobility_aid", "with"],
  quality: ["record_id", "point", "surveyor", "time_local", "weather", "score", "max"].concat(QKEYS).concat(["notes"])
};

/* ------------------------------------------------------------------ setup */

/** Run once from the editor. Creates the tabs and the two access codes, and prints the codes. */
function setup() {
  Object.keys(HEAD).forEach(sheet_);
  var p = props_();
  if (!p.getProperty("ADMIN_CODE")) p.setProperty("ADMIN_CODE", code_(10));
  if (!p.getProperty("STUDY_CODE")) p.setProperty("STUDY_CODE", code_(8));
  Logger.log("ADMIN_CODE (keep to yourself): " + p.getProperty("ADMIN_CODE"));
  Logger.log("STUDY_CODE (give to surveyors): " + p.getProperty("STUDY_CODE"));
}

/** Run if a link has leaked. Old links stop working at once. */
function rotateCodes() {
  var p = props_();
  p.setProperty("ADMIN_CODE", code_(10));
  p.setProperty("STUDY_CODE", code_(8));
  Logger.log("New ADMIN_CODE: " + p.getProperty("ADMIN_CODE"));
  Logger.log("New STUDY_CODE: " + p.getProperty("STUDY_CODE"));
}

/* ------------------------------------------------------------------ http */

function doGet(e) {
  try {
    var q = (e && e.parameter) || {};
    var role = role_(q.k);
    if (!role) return out_({ ok: false, error: "bad_code" });
    if (q.action === "plan") return out_({ ok: true, plan: readPlan_() });
    return out_({
      ok: true,
      role: role,
      points: rows_("points").filter(function (r) { return r.id; }),
      surveyors: rows_("surveyors").map(function (r) { return String(r.name || ""); }).filter(String),
      records: rows_("records").filter(function (r) { return r.record_id; }).map(parseRecord_),
      planVersion: props_().getProperty("PLAN_VERSION") || ""
    });
  } catch (err) {
    return out_({ ok: false, error: "server", message: String(err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = (e && e.postData && e.postData.contents) || "";
    if (body.length > MAX_BODY + MAX_PLAN) return out_({ ok: false, error: "too_large" });
    var d = JSON.parse(body);
    var role = role_(d.k);
    if (!role) return out_({ ok: false, error: "bad_code" });
    lock.waitLock(20000);

    switch (d.action) {
      case "addRecord": return out_(addRecord_(d.record));
      case "deleteRecord": return out_(deleteRecord_(String(d.id || ""), String(d.device || ""), role));
    }
    if (role !== "admin") return out_({ ok: false, error: "admin_only" });
    switch (d.action) {
      case "setPlan": return out_(setPlan_(String(d.dataUrl || "")));
      case "addPoint": return out_(addPoint_(d));
      case "updatePoint": return out_(updatePoint_(d));
      case "deletePoint": return out_(deleteWhere_("points", "id", String(d.id || "")));
      case "addSurveyor": return out_(addSurveyor_(String(d.name || "")));
      case "deleteSurveyor": return out_(deleteWhere_("surveyors", "name", String(d.name || "")));
    }
    return out_({ ok: false, error: "unknown_action" });
  } catch (err) {
    return out_({ ok: false, error: "server", message: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* ------------------------------------------------------------------ records */

function addRecord_(r) {
  if (!r || typeof r !== "object") return { ok: false, error: "bad_record" };
  var id = String(r.id || "");
  if (!/^r[a-z0-9]{4,40}$/.test(id)) return { ok: false, error: "bad_id" };
  if (TYPES.indexOf(r.type) < 0) return { ok: false, error: "bad_type" };

  // The phone retries until it hears back, so the same record can arrive twice.
  if (findRow_("records", "record_id", id) > 0) return { ok: true, id: id, duplicate: true };

  var pt = rows_("points").filter(function (p) { return p.id === r.pointId; })[0];
  if (!pt) return { ok: false, error: "unknown_point" };

  var ts = String(r.ts || "").slice(0, 40);
  var base = {
    id: id, type: r.type, pointId: pt.id, point: String(pt.name), surveyor: String(pt.surveyor || ""),
    ts: ts, tsLocal: str_(r.tsLocal, 20), dayType: pick_(r.dayType, ["weekday", "weekend"], ""),
    slot: pick_(r.slot, ["morning", "midday", "afternoon", "evening"], ""),
    wx: str_(r.wx, 20), notes: str_(r.notes, 1000), device: str_(r.device, 40)
  };

  var payload = {}, total = 0;
  if (r.type === "moving") {
    var tally = {}, modes = {};
    AGES.forEach(function (a) { GEN.forEach(function (g) {
      var k = a + "|" + g, v = int_((r.tally || {})[k]);
      if (v) tally[k] = v; total += v;
    }); });
    MODES.forEach(function (m) { var v = int_((r.modes || {})[m]); if (v) modes[m] = v; });
    payload = { tally: tally, modes: modes, countedSec: int_(r.countedSec), durationSec: int_(r.durationSec) };
    var row = [id, base.point, base.surveyor, base.tsLocal, base.dayType, base.slot, base.wx, payload.countedSec, total];
    AGES.forEach(function (a) { GEN.forEach(function (g) { row.push(tally[a + "|" + g] || 0); }); });
    MODES.forEach(function (m) { row.push(modes[m] || 0); });
    row.push(base.notes);
    sheet_("moving").appendRow(row);
  } else if (r.type === "stationary") {
    var people = (Array.isArray(r.people) ? r.people : []).slice(0, MAX_PEOPLE).map(function (p) {
      return {
        x: num01_(p.x), y: num01_(p.y),
        age: pick_(p.age, AGES, "25-44"), gender: pick_(p.gender, GEN, "u"), posture: pick_(p.posture, POSTURES, "standing"),
        acts: (Array.isArray(p.acts) ? p.acts : []).filter(function (a) { return ACTS.indexOf(a) >= 0; }),
        group: Math.max(1, Math.min(50, int_(p.group) || 1)), assist: !!p.assist, prop: pick_(p.prop, PROPS, "none")
      };
    });
    if (!people.length) return { ok: false, error: "no_people" };
    total = people.length;
    payload = { people: people };
    var sh = sheet_("staying");
    var out = people.map(function (p, i) {
      return [id, base.point, base.surveyor, base.tsLocal, base.dayType, base.slot, base.wx, i + 1,
              Math.round(p.x * 10000) / 10000, Math.round(p.y * 10000) / 10000,
              p.age, p.gender, p.posture, p.acts.join(";"), p.group, p.assist ? 1 : 0, p.prop];
    });
    sh.getRange(sh.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
  } else {
    var scores = {}, scored = 0;
    QKEYS.forEach(function (k) {
      var v = (r.scores || {})[k];
      if (v === 0 || v === 1 || v === 2) { scores[k] = v; scored++; total += v; }
    });
    if (!scored) return { ok: false, error: "no_scores" };
    payload = { scores: scores, scored: scored };
    var qrow = [id, base.point, base.surveyor, base.tsLocal, base.wx, total, scored * 2];
    QKEYS.forEach(function (k) { qrow.push(scores[k] == null ? "" : scores[k]); });
    qrow.push(base.notes);
    sheet_("quality").appendRow(qrow);
  }

  sheet_("records").appendRow([id, base.type, base.pointId, base.point, base.surveyor, base.ts, base.tsLocal,
    base.dayType, base.slot, base.wx, total, base.notes, base.device, new Date().toISOString(),
    JSON.stringify(payload)]);
  return { ok: true, id: id };
}

function deleteRecord_(id, device, role) {
  var row = rows_("records").filter(function (r) { return r.record_id === id; })[0];
  if (!row) return { ok: true, id: id, missing: true };
  if (role !== "admin" && String(row.device) !== device) return { ok: false, error: "not_yours" };
  ["records", "moving", "staying", "quality"].forEach(function (s) { deleteWhere_(s, "record_id", id); });
  return { ok: true, id: id };
}

function parseRecord_(r) {
  var p = {};
  try { p = JSON.parse(r.payload || "{}"); } catch (e) {}
  return {
    id: r.record_id, type: r.type, pointId: r.point_id, pointName: r.point, student: r.surveyor,
    ts: r.time, tsLocal: r.time_local, dayType: r.day_type, slot: r.slot, wx: r.weather,
    total: Number(r.total) || 0, notes: r.notes, device: r.device,
    tally: p.tally, modes: p.modes, countedSec: p.countedSec, durationSec: p.durationSec,
    people: p.people, scores: p.scores, scored: p.scored
  };
}

/* ------------------------------------------------------------------ setup actions */

function addPoint_(d) {
  var pts = rows_("points");
  var n = pts.reduce(function (a, p) { return Math.max(a, Number(p.n) || 0); }, 0) + 1;
  var id = "p" + Utilities.getUuid().replace(/-/g, "").slice(0, 10);
  var name = str_(d.name, 60) || ("調查點 Point " + n);
  sheet_("points").appendRow([id, n, name, num01_(d.x), num01_(d.y), "", new Date().toISOString()]);
  return { ok: true, id: id, n: n };
}

function updatePoint_(d) {
  var r = findRow_("points", "id", String(d.id || ""));
  if (r < 0) return { ok: false, error: "unknown_point" };
  var sh = sheet_("points");
  if (d.name != null) sh.getRange(r, HEAD.points.indexOf("name") + 1).setValue(str_(d.name, 60));
  if (d.surveyor != null) sh.getRange(r, HEAD.points.indexOf("surveyor") + 1).setValue(str_(d.surveyor, 60));
  return { ok: true };
}

function addSurveyor_(name) {
  name = str_(name, 60);
  if (!name) return { ok: false, error: "no_name" };
  if (findRow_("surveyors", "name", name) > 0) return { ok: true, duplicate: true };
  sheet_("surveyors").appendRow([name, new Date().toISOString()]);
  return { ok: true };
}

function setPlan_(dataUrl) {
  var m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return { ok: false, error: "bad_image" };
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > MAX_PLAN) return { ok: false, error: "too_large" };
  var folders = DriveApp.getFoldersByName(FOLDER_NAME);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
  var file = folder.createFile(Utilities.newBlob(bytes, m[1], "site-plan-" + Date.now() + (m[1] === "image/png" ? ".png" : ".jpg")));
  var p = props_(), old = p.getProperty("PLAN_FILE_ID");
  if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) {} }
  var version = new Date().toISOString();
  p.setProperty("PLAN_FILE_ID", file.getId());
  p.setProperty("PLAN_VERSION", version);
  return { ok: true, version: version };
}

function readPlan_() {
  var p = props_(), id = p.getProperty("PLAN_FILE_ID");
  if (!id) return null;
  var blob = DriveApp.getFileById(id).getBlob();
  return { version: p.getProperty("PLAN_VERSION") || "",
           dataUrl: "data:" + blob.getContentType() + ";base64," + Utilities.base64Encode(blob.getBytes()) };
}

/* ------------------------------------------------------------------ helpers */

function props_() { return PropertiesService.getScriptProperties(); }

function role_(k) {
  if (!k) return null;
  var p = props_();
  if (k === p.getProperty("ADMIN_CODE")) return "admin";
  if (k === p.getProperty("STUDY_CODE")) return "surveyor";
  return null;
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, HEAD[name].length).setValues([HEAD[name]]).setFontWeight("bold");
    sh.setFrozenRows(1);
    // keep ids, times and codes as plain text so Sheets does not reformat them
    sh.getRange(2, 1, sh.getMaxRows() - 1, HEAD[name].length).setNumberFormat("@");
  }
  return sh;
}

function rows_(name) {
  var v = sheet_(name).getDataRange().getValues();
  var h = v.shift() || [];
  return v.map(function (r) {
    var o = {};
    h.forEach(function (k, i) { o[k] = r[i] instanceof Date ? r[i].toISOString() : r[i]; });
    if (name === "points") { o.n = Number(o.n) || 0; o.x = Number(o.x) || 0; o.y = Number(o.y) || 0; }
    return o;
  });
}

function findRow_(name, col, val) {
  var sh = sheet_(name), c = HEAD[name].indexOf(col) + 1, last = sh.getLastRow();
  if (last < 2) return -1;
  var v = sh.getRange(2, c, last - 1, 1).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]) === val) return i + 2;
  return -1;
}

function deleteWhere_(name, col, val) {
  var sh = sheet_(name), c = HEAD[name].indexOf(col) + 1, last = sh.getLastRow();
  if (last < 2 || !val) return { ok: true, deleted: 0 };
  var v = sh.getRange(2, c, last - 1, 1).getValues(), n = 0;
  for (var i = v.length - 1; i >= 0; i--) if (String(v[i][0]) === val) { sh.deleteRow(i + 2); n++; }
  return { ok: true, deleted: n };
}

function code_(len) {
  var chars = "abcdefghjkmnpqrstuvwxyz23456789", s = "";
  for (var i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
function str_(v, max) { return v == null ? "" : String(v).slice(0, max).trim(); }
function int_(v) { var n = parseInt(v, 10); return isFinite(n) && n > 0 ? Math.min(n, 100000) : 0; }
function num01_(v) { var n = Number(v); return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
function pick_(v, list, fallback) { return list.indexOf(v) >= 0 ? v : fallback; }
