// ===== Google Apps Script =====

// SETUP: Replace with YOUR spreadsheet ID
const SS_ID = '1TKaz2GYQy05GWUwg2s6LgI-orU88Qua5otND7QSBcr8';

/**
 * Web App endpoint: ?action=getAll
 * Returns JSON with all config sheets or error
 */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'getAll') {
      const out = getAllData();
      return ContentService
        .createTextOutput(JSON.stringify(out))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'Missing or invalid ?action=getAll' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'Exception: ' + err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Assembles data from all config sheets
 */
function getAllData() {
  const ss = SpreadsheetApp.openById(SS_ID);
  const required = ['Config_Rooms', 'Config_Slots', 'Config_Indicators', 'Staff'];
  required.forEach(name => {
    if (!ss.getSheetByName(name)) {
      throw new Error('Sheet not found: ' + name);
    }
  });

  const roomsData      = getSheetData(ss, 'Config_Rooms');
  const slotsData      = getSheetData(ss, 'Config_Slots');
  const indicatorsData = getSheetData(ss, 'Config_Indicators');
  const staffData      = getSheetData(ss, 'Staff');

  return {
    rooms: roomsData,
    slots: slotsData,
    indicators: indicatorsData,
    staff: staffData,
    _meta: {
      ok: true,
      version: 'v2',
      ssId: SS_ID,
      ssName: ss.getName(),
      generatedAt: new Date().toISOString()
    }
  };
}

/**
 * Reads sheet data as array of objects {header: value, ...}
 */
function getSheetData(ss, sheetName) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet not found: ' + sheetName);

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return [];
  }
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const values  = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();

  const out = [];
  values.forEach(row => {
    if (row.every(v => v === '' || v === null)) return;
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx];
    });
    out.push(obj);
  });
  return out;
}
