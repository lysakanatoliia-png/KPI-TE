/** =======================
 *  KPI Backend (Google Apps Script)
 *  TZ: America/Los_Angeles
 *  Version: 4.0-weighted-kpi
 * ======================= */

const TZ = 'America/Los_Angeles';
const VERSION = '4.0-weighted-kpi';

// ВСТАВ СВІЙ ID ↓↓↓
const SPREADSHEET_ID = '1TKaz2GYQy05GWUwg2s6LgI-orU88Qua5otND7QSBcr8';

const SHEETS = {
  CONFIG_IND:   'Config_Indicators',
  STAFF:        'Staff',
  FORM:         'FormData',
  STAFF_LOGS:   'Staff_Logs',
  SUM_D:        'Summary_Day',
  SUM_M:        'Summary_Month',
  SUM_Q:        'Summary_Quarter',
  AUDIT:        'Audit_Log',
  ERR:          'Errors',
  DEBUG:        'Debug_Log'
};

/** ===== Debug settings ===== */
const DEBUG_VERBOSE = true;
const DEBUG_MAX_PAYLOAD = 10000;

/* ========== Utils ========== */
function nowIso(){ return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function uuid(){ return Utilities.getUuid(); }
function safeJson(o){ try{ return JSON.stringify(o); }catch(e){ return String(o); } }

function logDebug(tag,msg,obj){
  if (!DEBUG_VERBOSE) return;
  try{
    ensureHeader(SHEETS.DEBUG);
    getSheet(SHEETS.DEBUG).appendRow([
      nowIso(),
      tag,
      msg,
      obj ? safeJson(obj).slice(0,DEBUG_MAX_PAYLOAD) : ''
    ]);
  }catch(e){}
}

function getSheet(name){ return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name); }

function ensureHeader(name){
  const sh=getSheet(name);
  if(sh.getLastRow()===0){ 
    sh.appendRow(getHeadersForSheet(name)); 
    SpreadsheetApp.flush(); 
  }
}

function readTable(name){
  const sh=getSheet(name);
  const vals=sh.getDataRange().getValues();
  if(!vals.length) return {cols:[],rows:[]};
  const cols=vals[0].map(c=>String(c).trim());
  const rows=vals.slice(1)
    .filter(r=>r.join('').trim()!=='')
    .map(r=>{ const o={}; cols.forEach((c,i)=>o[c]=r[i]); return o; });
  return {cols,rows};
}

/* ========== Date Helpers ========== */
function getMonthKey(dateStr){
  const [mm,dd,yyyy]=String(dateStr).split("-");
  return mm+"."+yyyy;
}
function getQuarterKey(dateStr){
  const [mm,dd,yyyy]=String(dateStr).split("-");
  const q=Math.floor((parseInt(mm,10)-1)/3)+1;
  return "Q"+q+"-"+yyyy;
}

/* ========== Errors & Audit ========== */
function logError(where,message,payload){
  try{
    ensureHeader(SHEETS.ERR);
    getSheet(SHEETS.ERR).appendRow([
      nowIso(),
      where,
      message,
      payload?safeJson(payload):''
    ]);
  }catch(e){}
}
function audit(action,by,batchId,meta){
  try{
    ensureHeader(SHEETS.AUDIT);
    getSheet(SHEETS.AUDIT).appendRow([
      nowIso(),
      action,
      by||'',
      batchId||'',
      meta?safeJson(meta):''
    ]);
  }catch(e){}
}

/* ========== Headers generator ========== */
function getHeadersForSheet(name){
  if(name===SHEETS.FORM) 
    return ["EntryID","BatchID","Timestamp","Date","RoomCode","SlotCode","SubmittedBy","StaffScope","StaffId","StaffName","StaffSelected","Category","Indicator","Check","Value","Comment","SourceVersion"];
  if(name===SHEETS.STAFF_LOGS) 
    return ["EntryID","BatchID","Date","RoomCode","SlotCode","StaffId","StaffName","Category","Indicator","Check","Value","Comment"];
  if(name===SHEETS.AUDIT) 
    return ["Timestamp","Action","By","BatchID","Meta"];
  if(name===SHEETS.ERR) 
    return ["Timestamp","Where","Message","Payload"];
  if(name===SHEETS.DEBUG) 
    return ["Timestamp","Tag","Message","Payload"];
  if([SHEETS.SUM_D,SHEETS.SUM_M,SHEETS.SUM_Q].includes(name)){
    const cats=[...new Set(readTable(SHEETS.CONFIG_IND).rows.map(r=>String(r.Category).trim()))].filter(c=>c);
    let timeCol;
    if(name===SHEETS.SUM_D) timeCol="Date";
    else if(name===SHEETS.SUM_M) timeCol="Month";
    else timeCol="Quarter";
    return [timeCol,"RoomCode","StaffId","StaffName"]
      .concat(cats.map(c=>"%"+c))
      .concat(["%Total","ExpectedWeight","FailedWeight","TotalWeight"]);
  }
  return ["Unknown"];
}

/* ========== HTTP ========== */
function jsonOut(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function doPost(e){
  try{
    const body=JSON.parse(e.postData.contents||'{}');
    const {action,payload}=body;
    logDebug("doPost","Incoming",{action,payload});
    switch(action){
      case 'saveTeamKPI': return jsonOut(saveTeamKPI(payload));
      case 'saveIndividualKPI': return jsonOut(saveIndividualKPI(payload));
      case 'finalizeBatch': return jsonOut(finalizeFullRebuild(payload));
      case 'rebuildSummaries': return jsonOut(rebuildSummaries(payload));
      default: return jsonOut({ok:false,error:'Unknown action'});
    }
  }catch(err){ 
    logError('doPost',String(err),e); 
    return jsonOut({ok:false,error:String(err)}); 
  }
}

/* ========== SAVE TEAM ========== */
function saveTeamKPI(payload){
  try{
    ensureHeader(SHEETS.FORM); ensureHeader(SHEETS.STAFF_LOGS);
    const h=payload.header||{};
    const dateStr=h.date?String(h.date).trim():Utilities.formatDate(new Date(),TZ,"MM-dd-yyyy");

    const staff=readTable(SHEETS.STAFF).rows;
    const id2name={}; staff.forEach(s=>id2name[String(s.StaffId)]=String(s.StaffName||''));
    const ids=(h.presentStaffIds||[]).map(String);
    const ts=nowIso(); const by=payload.by||'ui';

    const formData=readTable(SHEETS.FORM).rows;
    const existingKeys=new Set(formData.map(r=>[r.BatchID,r.Date,r.RoomCode,r.SlotCode,r.StaffId,r.Indicator].join('|')));

    const rowsForm=[],rowsLogs=[],writtenIds=[];
    (payload.items||[]).forEach(it=>{
      const val=(String(it.check).toLowerCase()==='yes')?1:0;
      ids.forEach(id=>{
        const staffName=id2name[id]||'';
        const key=[payload.batchId,dateStr,h.roomCode,h.slotCode||'',id,it.indicator].join('|');
        if(existingKeys.has(key)){ logDebug("saveTeamKPI","Skip duplicate",{key}); return; }
        existingKeys.add(key);

        const entryId=uuid();
        rowsForm.push([
          entryId,payload.batchId,ts,dateStr,h.roomCode,h.slotCode||'',
          by,'Team',id,staffName,ids.join(','),it.category,it.indicator,it.check,val,it.comment||'',VERSION
        ]);
        rowsLogs.push([
          entryId,payload.batchId,dateStr,h.roomCode,h.slotCode||'',
          id,staffName,it.category,it.indicator,it.check,val,it.comment||''
        ]);
        writtenIds.push(entryId);
      });
    });

    if(rowsForm.length) getSheet(SHEETS.FORM).getRange(getSheet(SHEETS.FORM).getLastRow()+1,1,rowsForm.length,rowsForm[0].length).setValues(rowsForm);
    if(rowsLogs.length) getSheet(SHEETS.STAFF_LOGS).getRange(getSheet(SHEETS.STAFF_LOGS).getLastRow()+1,1,rowsLogs.length,rowsLogs[0].length).setValues(rowsLogs);

    audit('saveTeamKPI',by,payload.batchId,{form:rowsForm.length,logs:rowsLogs.length,dateStr});

    logDebug("saveTeamKPI","Written",{rowsForm,rowsLogs});
    return {ok:true,written:rowsForm.length,logs:rowsLogs.length,writtenIds};
  }catch(e){ logError('saveTeamKPI',String(e),payload); return {ok:false,error:String(e)}; }
}

/* ========== SAVE INDIVIDUAL ========== */
function saveIndividualKPI(payload){
  try{
    ensureHeader(SHEETS.FORM); ensureHeader(SHEETS.STAFF_LOGS);
    const h=payload.header||{};
    const dateStr=h.date?String(h.date).trim():Utilities.formatDate(new Date(),TZ,"MM-dd-yyyy");
    const room=String(h.roomCode||'').trim(); const slot=String(h.slotCode||'').trim();
    const ts=nowIso(); const by=payload.by||'ui';

    const staff=readTable(SHEETS.STAFF).rows;
    const id2name={}; staff.forEach(s=>id2name[String(s.StaffId)]=String(s.StaffName||''));

    const indicators=readTable(SHEETS.CONFIG_IND).rows.filter(r=>{
      return String(r.Scope).trim().toLowerCase()==='individual'
        && (String(r.RoomCode).trim()===room||String(r.RoomCode).trim()==='*')
        && (String(r.SlotCode).trim()===slot||String(r.SlotCode).trim()==='*');
    });

    const staffIds=(h.presentStaffIds&&h.presentStaffIds.length)
      ?h.presentStaffIds.map(String)
      :[(payload.member&&payload.member.staffId)?String(payload.member.staffId):''];

    const formData=readTable(SHEETS.FORM).rows;
    const existingKeys=new Set(
      formData.filter(r=>String(r.BatchID)===String(payload.batchId))
        .map(r=>[r.Date,r.RoomCode,r.SlotCode,r.StaffId,r.Indicator].join('|'))
    );

    const rowsForm=[],rowsLogs=[],writtenIds=[];
    const items=payload.items&&payload.items.length?payload.items:indicators.map(ind=>({
      category:ind.Category,indicator:ind.Indicator,check:'yes',comment:''
    }));

    staffIds.forEach(staffId=>{
      const staffName=id2name[staffId]||'';
      (items||[]).forEach(it=>{
        const val=(String(it.check).toLowerCase()==='yes')?1:0;
        const key=[dateStr,room,slot,staffId,it.indicator].join('|');
        if(existingKeys.has(key)){ logDebug("saveIndividualKPI","Skip duplicate",{key}); return; }
        existingKeys.add(key);

        const entryId=uuid();
        rowsForm.push([
          entryId,payload.batchId,ts,dateStr,room,slot,
          by,'Individual',staffId,staffName,(h.presentStaffIds||[]).map(String).join(','), // повний список
          it.category,it.indicator,it.check,val,it.comment||'',VERSION
        ]);
        rowsLogs.push([
          entryId,payload.batchId,dateStr,room,slot,
          staffId,staffName,it.category,it.indicator,it.check,val,it.comment||''
        ]);
        writtenIds.push(entryId);
      });
    });

    if(rowsForm.length) getSheet(SHEETS.FORM).getRange(getSheet(SHEETS.FORM).getLastRow()+1,1,rowsForm.length,rowsForm[0].length).setValues(rowsForm);
    if(rowsLogs.length) getSheet(SHEETS.STAFF_LOGS).getRange(getSheet(SHEETS.STAFF_LOGS).getLastRow()+1,1,rowsLogs.length,rowsLogs[0].length).setValues(rowsLogs);

    audit('saveIndividualKPI',by,payload.batchId,{form:rowsForm.length,logs:rowsLogs.length,dateStr});

    logDebug("saveIndividualKPI","Written",{rowsForm,rowsLogs});
    return {ok:true,written:rowsForm.length,logs:rowsLogs.length,writtenIds};
  }catch(e){ logError('saveIndividualKPI',String(e),payload); return {ok:false,error:String(e)}; }
}

/* ========== SUMMARIES with Weight-based scoring ========== */

/* Weight from Config_Indicators (default 1) */
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

function _allCategories(){
  return [...new Set(readTable(SHEETS.CONFIG_IND).rows.map(r=>String(r.Category).trim()))].filter(c=>c);
}

/**
 * Weight-based Summary calculation.
 * level = 'day' | 'month' | 'quarter'
 *
 * Math per (dateKey, RoomCode, StaffId):
 *   Per indicator: weight = Config_Indicators.Weight (default 1)
 *   %Category = ROUND((catPassed / catExpected) × 100)   [weighted]
 *   Team score  = (teamPassed / teamExpected) × 100       [weighted]
 *   Ind  score  = (indPassed  / indExpected)  × 100       [weighted]
 *   %Total = ROUND(teamScore × 0.8 + indScore × 0.2)     [80/20 blend]
 *   %Total (Admin) = ROUND(teamScore)                     [team only]
 *
 * Extra columns: ExpectedWeight, FailedWeight, TotalWeight
 */
function recomputeSummary(level){
  const form = readTable(SHEETS.FORM).rows;
  const config = readTable(SHEETS.CONFIG_IND).rows;
  const categories = _allCategories();

  // ---- Group by (dateKey, RoomCode, StaffId) ----
  const grouped = {};
  form.forEach(r=>{
    const dStr = String(r.Date||'').trim();
    if (!dStr){ logError('recomputeSummary','Empty date',r); return; }

    const room = String(r.RoomCode||'').trim();
    const sid  = String(r.StaffId||'team').trim();

    let keyId;
    if(level==='day')     keyId = dStr;
    else if(level==='month')   keyId = getMonthKey(dStr);
    else if(level==='quarter') keyId = getQuarterKey(dStr);
    else return;

    const fullKey = keyId+'|'+room+'|'+sid;
    if(!grouped[fullKey]) grouped[fullKey] = { staffName: r.StaffName, rows: [] };
    grouped[fullKey].rows.push(r);
  });

  // ---- Compute weighted scores per group ----
  const out = [];
  for(const k in grouped){
    const g = grouped[k];
    const [dateKey, room, sid] = k.split('|');
    const staffName = g.rows[0] ? String(g.rows[0].StaffName||'') : '';

    // Accumulators: per-category
    const catExpected = {}, catPassed = {};
    categories.forEach(cat=>{ catExpected[cat] = 0; catPassed[cat] = 0; });

    // Accumulators: per-scope (Team / Individual)
    let teamExpected = 0, teamPassed = 0;
    let indExpected  = 0, indPassed  = 0;

    // Accumulators: grand total (for weight columns)
    let totalExpected = 0, totalPassed = 0;

    g.rows.forEach(row=>{
      const weight = getWeightForIndicator(config, row.RoomCode, row.SlotCode, row.Category, row.Indicator);
      let value = Number(row.Value);
      if(isNaN(value)) value = 0;

      const passed = weight * value;

      // Grand total
      totalExpected += weight;
      totalPassed   += passed;

      // Per-category
      const cat = String(row.Category||'').trim();
      if(catExpected.hasOwnProperty(cat)){
        catExpected[cat] += weight;
        catPassed[cat]   += passed;
      }

      // Per-scope (from FormData.StaffScope: 'Team' or 'Individual')
      const scope = String(row.StaffScope||'Team').trim().toLowerCase();
      if(scope === 'individual'){
        indExpected  += weight;
        indPassed    += passed;
      } else {
        teamExpected += weight;
        teamPassed   += passed;
      }
    });

    // ---- Build output row ----
    const row = [dateKey, room, sid, staffName];

    // Category % columns (informational slices)
    categories.forEach(cat=>{
      const exp = catExpected[cat];
      row.push(exp > 0 ? Math.round((catPassed[cat] / exp) * 100) : '');
    });

    // %Total with 80/20 blend
    const avgTeam = teamExpected > 0 ? (teamPassed / teamExpected) * 100 : 0;
    const avgInd  = indExpected  > 0 ? (indPassed  / indExpected)  * 100 : 0;

    let weighted;
    if(room && room.trim().toLowerCase() === 'admin'){
      // Admin: тільки Team KPI
      weighted = teamExpected > 0 ? Math.round(avgTeam) : '';
    } else {
      // Стандартне 80/20
      weighted = (teamExpected > 0 || indExpected > 0) ? Math.round(avgTeam * 0.8 + avgInd * 0.2) : '';
    }
    row.push(weighted);

    // Technical weight columns
    const failedWeight = totalExpected - totalPassed;
    row.push(totalExpected);   // ExpectedWeight
    row.push(failedWeight);    // FailedWeight
    row.push(totalExpected);   // TotalWeight

    logDebug("recomputeSummary","Weighted row",{staff:sid, totalExpected, totalPassed, avgTeam:Math.round(avgTeam), avgInd:Math.round(avgInd), weighted});
    out.push(row);
  }
  return out;
}

function recomputeSummaryDay(){
  const out = recomputeSummary('day');
  const sh = getSheet(SHEETS.SUM_D);
  sh.clearContents();          // очищуємо все, включно з заголовками
  ensureHeader(SHEETS.SUM_D);  // записує нові заголовки (з колонками ваг)
  if(out.length) sh.getRange(2,1,out.length,out[0].length).setValues(out);
  return out.length;
}

function recomputeSummaryMonth(){
  const out = recomputeSummary('month');
  const sh = getSheet(SHEETS.SUM_M);
  sh.clearContents();
  ensureHeader(SHEETS.SUM_M);
  if(out.length) sh.getRange(2,1,out.length,out[0].length).setValues(out);
  return out.length;
}

function recomputeSummaryQuarter(){
  const out = recomputeSummary('quarter');
  const sh = getSheet(SHEETS.SUM_Q);
  sh.clearContents();
  ensureHeader(SHEETS.SUM_Q);
  if(out.length) sh.getRange(2,1,out.length,out[0].length).setValues(out);
  return out.length;
}


/* ========== FINALIZE ========== */
function finalizeFullRebuild(meta){
  try{
    const writtenDay=recomputeSummaryDay();
    const writtenMonth=recomputeSummaryMonth();
    const writtenQuarter=recomputeSummaryQuarter();
    audit('finalizeFullRebuild',(Session.getActiveUser()&&Session.getActiveUser().getEmail())||"ui",meta&&meta.batchId,{writtenDay,writtenMonth,writtenQuarter});
    logDebug("finalizeFullRebuild","Done",{writtenDay,writtenMonth,writtenQuarter});
    return {ok:true,writtenDay,writtenMonth,writtenQuarter};
  }catch(e){ logError('finalizeFullRebuild',String(e),meta); return {ok:false,error:String(e)}; }
}
function rebuildSummaries(payload){ return finalizeFullRebuild(payload); }
