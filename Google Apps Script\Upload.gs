/** =======================
 *  KPI Backend (Google Apps Script)
 *  TZ: America/Los_Angeles
 *  Version: 3.31-full-debug-all
 * ======================= */

const TZ = 'America/Los_Angeles';
const VERSION = '3.31-full-debug-all';

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
    if(name===SHEETS.SUM_D) return ["Date","RoomCode","StaffId","StaffName"].concat(cats.map(c=>"%"+c)).concat(["%Total"]);
    if(name===SHEETS.SUM_M) return ["Month","RoomCode","StaffId","StaffName"].concat(cats.map(c=>"%"+c)).concat(["%Total"]);
    if(name===SHEETS.SUM_Q) return ["Quarter","RoomCode","StaffId","StaffName"].concat(cats.map(c=>"%"+c)).concat(["%Total"]);
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

/* ========== SUMMARIES with Scope-based weighting ========== */
function _allCategories(){
  return [...new Set(readTable(SHEETS.CONFIG_IND).rows.map(r=>String(r.Category).trim()))].filter(c=>c);
}

function recomputeSummary(level){
  const form = readTable(SHEETS.FORM).rows;
  const config = readTable(SHEETS.CONFIG_IND).rows;
  const categories = _allCategories();
  const grouped = {};

  form.forEach(r=>{
    const dStr = String(r.Date).trim();
    if (!dStr){ logError('recomputeSummary','Empty date',r); return; }

    const room = String(r.RoomCode||'').trim();
    const sid  = String(r.StaffId||'team').trim();

    let keyId;
    if(level==='day') keyId = dStr;
    if(level==='month') keyId = getMonthKey(dStr);
    if(level==='quarter') keyId = getQuarterKey(dStr);

    const fullKey = keyId+'|'+room+'|'+sid;
    if(!grouped[fullKey]) grouped[fullKey] = {staffName:r.StaffName, cats:{}};
    if(!grouped[fullKey].cats[r.Category]) grouped[fullKey].cats[r.Category] = [];
    grouped[fullKey].cats[r.Category].push(Number(r.Value||0));
  });

  const out = [];
  for(const k in grouped){
    const g = grouped[k];
    const [id,room,sid] = k.split('|');
    const row = [id,room,sid,g.staffName];

    let totalTeam=[], totalInd=[];
    categories.forEach(cat=>{
      const arr = g.cats[cat] || [];

      const conf = config.find(r => r.Category === cat);
      const scope = conf ? String(conf.Scope||'team').toLowerCase() : 'team';
      const isRelevant = conf && (
        String(conf.RoomCode).trim() === room || String(conf.RoomCode).trim() === '*'
      );

      let v;
      if(arr.length){
      v = Math.round(arr.reduce((a,b)=>a+b,0)/arr.length*100);
      } else {
      v = ''; // нічого не показуємо, якщо нема реальних даних
      }


      row.push(v);

      if(v !== ''){
        if(scope === 'individual'){ totalInd.push(v); }
        else { totalTeam.push(v); }
      }
    });

    let avgTeam = totalTeam.length ? totalTeam.reduce((a,b)=>a+b,0)/totalTeam.length : 0;
    let avgInd  = totalInd.length ? totalInd.reduce((a,b)=>a+b,0)/totalInd.length : 0;

    let weighted;
    if (room && room.trim().toLowerCase() === "admin") {
      // Для кімнати Admin рахуємо тільки Team KPI (без 80/20)
      weighted = avgTeam ? Math.round(avgTeam) : '';
    } else {
      // Стандартне 80/20
      weighted = (totalTeam.length||totalInd.length) ? Math.round(avgTeam*0.8+avgInd*0.2) : '';
    }
    

    row.push(weighted);

    logDebug("recomputeSummary","Weighted total",{staff:sid,avgTeam,avgInd,weighted});
    out.push(row);
  }
  return out;
}

function recomputeSummaryDay(){
  const out = recomputeSummary('day');
  const sh = getSheet(SHEETS.SUM_D); ensureHeader(SHEETS.SUM_D);
  if(sh.getLastRow()>1) sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).clearContent();
  if(out.length) sh.getRange(2,1,out.length,out[0].length).setValues(out);
  return out.length;
}

function recomputeSummaryMonth(){
  const out = recomputeSummary('month');
  const sh = getSheet(SHEETS.SUM_M); ensureHeader(SHEETS.SUM_M);
  if(sh.getLastRow()>1) sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).clearContent();
  if(out.length) sh.getRange(2,1,out.length,out[0].length).setValues(out);
  return out.length;
}

function recomputeSummaryQuarter(){
  const out = recomputeSummary('quarter');
  const sh = getSheet(SHEETS.SUM_Q); ensureHeader(SHEETS.SUM_Q);
  if(sh.getLastRow()>1) sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).clearContent();
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
