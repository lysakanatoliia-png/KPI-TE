/**
 * =======================
 * KPI Backend — WEIGHT-BASED Summary (replace recomputeSummary block in your GAS)
 * TZ: America/Los_Angeles
 * Use: paste these functions into your existing GAS project and remove the old
 *      recomputeSummary / recomputeSummaryDay / Month / Quarter.
 * =======================
 */

/* ========== Weight from Config (default 1) ========== */
function getWeightForIndicator(configRows, roomCode, slotCode, category, indicator) {
  var r = String(roomCode || '').trim();
  var s = String(slotCode || '').trim();
  var c = String(category || '').trim();
  var i = String(indicator || '').trim();
  for (var k = 0; k < configRows.length; k++) {
    var row = configRows[k];
    var cr = String(row.RoomCode || '').trim();
    var cs = String(row.SlotCode || '').trim();
    var cc = String(row.Category || '').trim();
    var ci = String(row.Indicator || '').trim();
    if (cc !== c || ci !== i) continue;
    if (cr !== '' && cr !== '*' && cr !== r) continue;
    if (cs !== '' && cs !== '*' && cs !== s) continue;
    var w = row.Weight;
    if (w === '' || w === null || w === undefined) return 1;
    return Math.max(0, Number(w)) || 1;
  }
  return 1;
}

/* ========== Weight-based Summary (Day/Month/Quarter) ========== */
function _allCategories() {
  var rows = readTable(SHEETS.CONFIG_IND).rows;
  var set = {};
  rows.forEach(function(r) {
    var c = String(r.Category || '').trim();
    if (c) set[c] = true;
  });
  return Object.keys(set).sort();
}

/**
 * level = 'day' | 'month' | 'quarter'
 * Returns array of rows for Summary sheet.
 * Math: ExpectedWeight = SUM(weight), FailedWeight = SUM(weight where Value=0), PassedWeight = ExpectedWeight - FailedWeight.
 * SlotScore = PassedWeight/ExpectedWeight*100. For period we aggregate: PeriodScore = sum(PassedWeight)/sum(ExpectedWeight)*100.
 */
function recomputeSummary(level) {
  var form = readTable(SHEETS.FORM).rows;
  var config = readTable(SHEETS.CONFIG_IND).rows;
  var categories = _allCategories();

  // Group by (dateKey, RoomCode, StaffId)
  var grouped = {};
  form.forEach(function(r) {
    var dStr = String(r.Date || '').trim();
    if (!dStr) return;

    var room = String(r.RoomCode || '').trim();
    var sid = String(r.StaffId || 'team').trim();
    var dateKey;
    if (level === 'day') dateKey = dStr;
    else if (level === 'month') dateKey = getMonthKey(dStr);
    else if (level === 'quarter') dateKey = getQuarterKey(dStr);
    else return;

    var key = dateKey + '|' + room + '|' + sid;
    if (!grouped[key]) {
      grouped[key] = { staffName: r.StaffName, rows: [] };
    }
    grouped[key].rows.push(r);
  });

  var out = [];
  for (var k in grouped) {
    var g = grouped[k];
    var parts = k.split('|');
    var dateKey = parts[0];
    var room = parts[1];
    var sid = parts[2];
    var staffName = (g.rows[0] && g.rows[0].StaffName) ? String(g.rows[0].StaffName) : '';

    var totalExpected = 0, totalPassed = 0;
    var catExpected = {}, catPassed = {};
    categories.forEach(function(cat) { catExpected[cat] = 0; catPassed[cat] = 0; });

    g.rows.forEach(function(row) {
      var weight = getWeightForIndicator(config, row.RoomCode, row.SlotCode, row.Category, row.Indicator);
      var value = Number(row.Value);
      if (isNaN(value)) value = 0;
      totalExpected += weight;
      totalPassed += weight * value;
      var c = String(row.Category || '').trim();
      if (catExpected.hasOwnProperty(c)) {
        catExpected[c] += weight;
        catPassed[c] += weight * value;
      }
    });

    var failedWeight = totalExpected - totalPassed;
    var pctTotal = totalExpected > 0 ? Math.round((totalPassed / totalExpected) * 100) : '';

    var row = [dateKey, room, sid, staffName];
    categories.forEach(function(cat) {
      var exp = catExpected[cat] || 0;
      var pct = exp > 0 ? Math.round((catPassed[cat] / exp) * 100) : '';
      row.push(pct);
    });
    row.push(pctTotal);
    row.push(totalExpected);
    row.push(failedWeight);
    row.push(totalExpected); // TotalWeight = ExpectedWeight

    if (typeof logDebug === 'function') {
      logDebug('recomputeSummary', 'Weighted row', { staff: sid, totalExpected: totalExpected, totalPassed: totalPassed, pctTotal: pctTotal });
    }
    out.push(row);
  }

  return out;
}

function recomputeSummaryDay() {
  var out = recomputeSummary('day');
  var sh = getSheet(SHEETS.SUM_D);
  ensureHeader(SHEETS.SUM_D);
  var lastRow = sh.getLastRow();
  var dataRows = Math.max(0, lastRow - 1);
  if (dataRows > 0) {
    sh.getRange(2, 1, dataRows, sh.getLastColumn()).clearContent();
  }
  if (out.length > 0) {
    sh.getRange(2, 1, out.length, out[0].length).setValues(out);
  }
  return out.length;
}

function recomputeSummaryMonth() {
  var out = recomputeSummary('month');
  var sh = getSheet(SHEETS.SUM_M);
  ensureHeader(SHEETS.SUM_M);
  var lastRow = sh.getLastRow();
  var dataRows = Math.max(0, lastRow - 1);
  if (dataRows > 0) {
    sh.getRange(2, 1, dataRows, sh.getLastColumn()).clearContent();
  }
  if (out.length > 0) {
    sh.getRange(2, 1, out.length, out[0].length).setValues(out);
  }
  return out.length;
}

function recomputeSummaryQuarter() {
  var out = recomputeSummary('quarter');
  var sh = getSheet(SHEETS.SUM_Q);
  ensureHeader(SHEETS.SUM_Q);
  var lastRow = sh.getLastRow();
  var dataRows = Math.max(0, lastRow - 1);
  if (dataRows > 0) {
    sh.getRange(2, 1, dataRows, sh.getLastColumn()).clearContent();
  }
  if (out.length > 0) {
    sh.getRange(2, 1, out.length, out[0].length).setValues(out);
  }
  return out.length;
}

/* ========== Headers for Summary sheets (with Weight columns) ========== */
// In your getHeadersForSheet(name), REPLACE the block for SUM_D/SUM_M/SUM_Q with:

function getHeadersForSheet_Summary(name) {
  var cats = _allCategories();
  var base = (name === SHEETS.SUM_D) ? ['Date', 'RoomCode', 'StaffId', 'StaffName'] :
             (name === SHEETS.SUM_M) ? ['Month', 'RoomCode', 'StaffId', 'StaffName'] :
             ['Quarter', 'RoomCode', 'StaffId', 'StaffName'];
  var pctCats = cats.map(function(c) { return '%' + c; });
  return base.concat(pctCats).concat(['%Total', 'ExpectedWeight', 'FailedWeight', 'TotalWeight']);
}

// In getHeadersForSheet(name) use:
//   if ([SHEETS.SUM_D, SHEETS.SUM_M, SHEETS.SUM_Q].indexOf(name) !== -1) return getHeadersForSheet_Summary(name);
