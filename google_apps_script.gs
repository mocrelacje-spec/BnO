/**
 * Google Apps Script backend for Bieg na Orientację QR logger
 * Instrukcje wdrożenia:
 * 1) W Google Drive: Nowy → Apps Script. Wklej ten kod (zamień cały plik).
 * 2) Z menu: Usługi zaawansowane → włącz "Sheets API" (opcjonalne; niekonieczne dla SpreadsheetApp).
 * 3) Zrób "Publikuj" → "Deploy as web app" / "Wdróż" → "Aplikacja sieciowa".
 *    - New deployment → Type: Web app
 *    - Execute as: Me (Autor skryptu)
 *    - Who has access: Anyone with the link (Każdy, kto ma link)
 *    Skopiuj URL wdrożenia i wklej go do config.js jako APP_SCRIPT_URL.
 * 4) Utwórz Arkusz Google i wklej jego ID do SHEET_ID poniżej (lub pozwól skryptowi samemu utworzyć arkusz).
 */

// Jeżeli chcesz użyć istniejącego arkusza, podaj jego ID. W przeciwnym razie pozostaw pusty string.
const SHEET_ID = ""; // np. "1AbC...". Puste = automatyczne tworzenie przy pierwszym uruchomieniu.

/** Nazwa arkusza z wpisami */
const LOG_SHEET_NAME = "checkins";

/** Struktura kolumn */
const HEADERS = ["timestamp_server_iso", "event_id", "participant_id", "checkpoint_id", "client_ts_iso", "user_agent", "ip"];

/** Lazy init: upewnij się, że mamy arkusz i nagłówki */
function getSheet_() {
  let ss;
  if (SHEET_ID && SHEET_ID.trim() !== "") {
    ss = SpreadsheetApp.openById(SHEET_ID.trim());
  } else {
    // Autotworzenie
    const files = DriveApp.getFilesByName("BNO_QR_Checkins");
    if (files.hasNext()) {
      ss = SpreadsheetApp.open(files.next());
    } else {
      ss = SpreadsheetApp.create("BNO_QR_Checkins");
    }
  }
  let sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(LOG_SHEET_NAME);
  const firstRow = sheet.getRange(1,1,1,HEADERS.length).getValues()[0];
  const same = HEADERS.every((h,i)=>String(firstRow[i]||"")===h);
  if (!same) {
    sheet.clear();
    sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
  }
  return sheet;
}

/** Helper: JSON response */
function json_(obj, code) {
  const output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  if (code) {
    // Apps Script nie pozwala ustawić kodu HTTP wprost; zwracamy status w JSON
    return output;
  }
  return output;
}

/** GET: 
 * - ?action=health → {"ok":true}
 * - ?action=list&eventId=... → zwraca ostatnie wpisy (max 1000) posortowane malejąco czasem
 * - ?action=sheet → zwraca URL do arkusza
 */
function doGet(e) {
  try {
    const action = (e.parameter.action||"health").toLowerCase();
    if (action === "health") {
      return json_({ ok: true, now: new Date().toISOString() });
    }
    if (action === "sheet") {
      const sheet = getSheet_();
      return json_({ ok: true, url: sheet.getParent().getUrl(), sheetName: sheet.getName() });
    }
    if (action === "list") {
      const eventId = (e.parameter.eventId||"").trim();
      const sheet = getSheet_();
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return json_({ ok: true, entries: [] });
      const range = sheet.getRange(2,1,lastRow-1,HEADERS.length).getValues();
      const all = range.map(r => ({
        timestamp_server_iso: r[0],
        event_id: r[1],
        participant_id: r[2],
        checkpoint_id: r[3],
        client_ts_iso: r[4],
        user_agent: r[5],
        ip: r[6],
      }));
      const filtered = eventId ? all.filter(x=>String(x.event_id)===eventId) : all;
      filtered.sort((a,b)=>String(b.timestamp_server_iso).localeCompare(String(a.timestamp_server_iso)));
      return json_({ ok: true, entries: filtered.slice(0,1000) });
    }
    return json_({ ok:false, error: "Unknown action" });
  } catch (err) {
    return json_({ ok:false, error: String(err) });
  }
}

/** POST JSON body: { eventId, participantId, checkpointId, clientTsIso }
 * zapis do arkusza + echo
 */
function doPost(e) {
  try {
    const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const eventId = String(body.eventId||"").trim();
    const participantId = String(body.participantId||"").trim();
    const checkpointId = String(body.checkpointId||"").trim();
    const clientTsIso = String(body.clientTsIso||"").trim();

    if (!eventId || !participantId || !checkpointId) {
      return json_({ ok:false, error:"Missing eventId/participantId/checkpointId" });
    }

    const sheet = getSheet_();
    const row = [
      new Date().toISOString(),
      eventId,
      participantId,
      checkpointId,
      clientTsIso || "",
      (e.parameter && e.parameter.ua) || (e.postData && e.postData.type) || "",
      (e.parameter && e.parameter.ip) || (e && e.headers && e.headers['X-Forwarded-For']) || "",
    ];
    sheet.appendRow(row);
    return json_({ ok:true });
  } catch (err) {
    return json_({ ok:false, error:String(err) });
  }
}
