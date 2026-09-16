const SPREADSHEET_ID = "1iKtVN9dTajgAVvASt700RzyPfKjd0Ju_9vVNPQKHN0g";
const LEGACY_SHEET_NAME = "wedding";
const TABS = {
  expenses: { name: "Expenses", columns: [
    ["id", "Record ID"], ["expense", "Expense Name"], ["category", "Category"], ["function", "Event"],
    ["bookingValue", "Booking Value"], ["advancePaid", "Advance Paid"], ["vendor", "Vendor"],
    ["vendorPhone", "Vendor Phone"], ["contactPerson", "Contact Person"], ["notes", "Remarks"], ["createdAt", "Created At"]
  ] },
  payments: { name: "Payments", columns: [
    ["id", "Record ID"], ["expenseId", "Expense ID"], ["expenseName", "Expense Name"], ["functionName", "Event"],
    ["category", "Category"], ["date", "Payment Date"], ["amount", "Amount"], ["mode", "Payment Mode"],
    ["vendor", "Vendor / Person"], ["reference", "Reference"], ["notes", "Notes"], ["createdAt", "Created At"]
  ] },
  guests: { name: "Guests", columns: [
    ["id", "Record ID"], ["name", "Guest Name"], ["phone", "Phone"], ["phoneAlt", "Alternate Phone"],
    ["functions", "Events"], ["side", "Side"], ["relation", "Relation"], ["city", "City / Place"],
    ["address", "Address"], ["adults", "Adults"], ["children", "Children"], ["rsvp", "RSVP Status"],
    ["stay", "Accommodation"], ["travel", "Transport"], ["notes", "Remarks"], ["createdAt", "Created At"],
    ["inviteEngagement", "Engagement Invite"], ["inviteWedding", "Wedding Invite"]
  ] },
  settings: { name: "Settings", columns: [["key", "Setting"], ["value", "Value"]] }
};

const EVENTS_TAB = { name: "Events", columns: [["name", "Event"], ["date", "Event Date"], ["type", "Event Type"], ["status", "Status"], ["notes", "Notes"]] };
const DASHBOARD_TAB = "Dashboard";
const EVENTS = [
  ["Engagement", "21 Oct 2026", "Ceremony", "Planned", ""],
  ["Ramayana", "", "Ceremony", "Planned", ""],
  ["Haldi", "22 Nov 2026", "Function", "Planned", ""],
  ["Mehendi", "23 Nov 2026", "Function", "Planned", ""],
  ["Sangeet", "24 Nov 2026", "Function", "Planned", ""],
  ["Mandap Reception", "25 Nov 2026", "Reception", "Planned", ""],
  ["Wedding", "25 Nov 2026", "Ceremony", "Planned", ""],
  ["Baraat", "25 Nov 2026", "Procession", "Planned", ""],
  ["Common / All Functions", "", "Shared", "Planned", ""],
  ["Engagement / Wedding", "", "Shared", "Planned", "Legacy combined event"]
];

var SS_CACHE = null;
var SHEET_CACHE = {};

function doGet(event) {
  const params = (event && event.parameter) || {};
  let payload;

  try {
    if (params.action === "delete") {
      payload = deleteRecord(params.type, params.id);
    } else if (params.action === "ping") {
      payload = { ok: true, updatedAt: getUpdatedAt(), ping: true };
    } else if (params.action === "rsvpGet") {
      payload = getRsvpGuest(params.id || params.g);
    } else if (params.action === "rsvpSubmit") {
      payload = submitRsvp(params);
    } else {
      const current = getUpdatedAt();
      if (params.since && String(params.since) === String(current)) {
        payload = { ok: true, unchanged: true, updatedAt: current };
      } else {
        payload = { ok: true, updatedAt: current || new Date().toISOString(), ...readDataFast() };
        if (!payload.settings) payload.settings = { initialized: true };
        if (!payload.updatedAt || payload.updatedAt === "false") {
          payload.updatedAt = bumpUpdatedAt(false);
        }
      }
    }
  } catch (error) {
    payload = { ok: false, error: error.message, updatedAt: new Date().toISOString() };
  }

  let callback = params.prefix || params.callback;
  if (!callback && event && event.queryString) {
    const match = event.queryString.match(/(?:^|&)(?:prefix|callback)=([^&]+)/);
    if (match) callback = decodeURIComponent(match[1]);
  }
  const safeCallback = callback && /^[A-Za-z_$][\w$]*$/.test(callback) ? callback : "";
  return safeCallback
    ? javascriptResponse(safeCallback + "(" + JSON.stringify(payload) + ");")
    : jsonResponse(payload);
}

function doPost(event) {
  try {
    const body = JSON.parse((event.postData && event.postData.contents) || "{}");
    if (body.action === "replace") {
      const data = normalizePayload(body.data || {});
      const updatedAt = replaceAll(data);
      return jsonResponse({
        ok: true,
        updatedAt: updatedAt,
        expenses: data.expenses,
        payments: data.payments,
        guests: data.guests,
        settings: data.settings
      });
    }
    if (body.action === "clear") {
      const data = {
        expenses: [],
        payments: [],
        guests: [],
        settings: { initialized: true, clearedAt: new Date().toISOString() }
      };
      const updatedAt = replaceAll(data);
      return jsonResponse({
        ok: true,
        updatedAt: updatedAt,
        expenses: [],
        payments: [],
        guests: [],
        settings: data.settings
      });
    }
    if (body.action === "rsvpSubmit") {
      return jsonResponse(submitRsvp(body));
    }
    return jsonResponse({ ok: false, error: "Unsupported action" });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }
}

function normalizePayload(raw) {
  return {
    expenses: Array.isArray(raw.expenses) ? raw.expenses : [],
    payments: Array.isArray(raw.payments) ? raw.payments : [],
    guests: Array.isArray(raw.guests) ? raw.guests : [],
    settings: raw.settings && typeof raw.settings === "object" ? Object.assign({ initialized: true }, raw.settings) : { initialized: true }
  };
}

function getSpreadsheet() {
  if (!SS_CACHE) SS_CACHE = SpreadsheetApp.openById(SPREADSHEET_ID);
  return SS_CACHE;
}

function getSheetByName(name, createIfMissing) {
  if (SHEET_CACHE[name]) return SHEET_CACHE[name];
  const spreadsheet = getSpreadsheet();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet && createIfMissing) sheet = spreadsheet.insertSheet(name);
  if (sheet) SHEET_CACHE[name] = sheet;
  return sheet;
}

function ensureTab(tab) {
  const sheet = getSheetByName(tab.name, true);
  ensureHeaders(sheet, tab);
  return sheet;
}

function ensureHeaders(sheet, tab) {
  const headers = tab.columns.map((column) => column[1]);
  const lastCol = Math.max(sheet.getLastColumn(), 0);
  if (sheet.getLastRow() === 0 || lastCol < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

/** Fast read path used by website sync. No styling / dashboard rebuild. */
function readDataFast() {
  const result = readTabs();
  if (result.expenses.length || result.payments.length || result.guests.length) return result;

  const legacy = readLegacy();
  if (legacy.expenses.length || legacy.payments.length || legacy.guests.length) {
    replaceAll(legacy);
    return readTabs();
  }
  return result;
}

function getUpdatedAt() {
  const sheet = getSheetByName(TABS.settings.name, false);
  if (!sheet || sheet.getLastRow() < 2) return "";
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (let i = 0; i < rows.length; i += 1) {
    if (String(rows[i][0]).trim() === "updatedAt") return String(rows[i][1] || "");
  }
  return "";
}

function bumpUpdatedAt(writeNow) {
  const stamp = new Date().toISOString();
  if (writeNow === false) return stamp;
  const sheet = ensureTab(TABS.settings);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    sheet.getRange(2, 1, 1, 2).setValues([["updatedAt", stamp]]);
    return stamp;
  }
  const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < keys.length; i += 1) {
    if (String(keys[i][0]).trim() === "updatedAt") {
      sheet.getRange(i + 2, 2).setValue(stamp);
      return stamp;
    }
  }
  sheet.getRange(lastRow + 1, 1, 1, 2).setValues([["updatedAt", stamp]]);
  return stamp;
}

function deleteRecord(type, id) {
  const key = String(type || "").trim();
  const recordId = String(id || "").trim();
  if (!TABS[key] || key === "settings") {
    return { ok: false, error: "Invalid delete type", updatedAt: new Date().toISOString() };
  }
  if (!recordId) {
    return { ok: false, error: "Missing record id", updatedAt: new Date().toISOString() };
  }

  const sheet = getSheetByName(TABS[key].name, true);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { ok: false, error: "Record not found", updatedAt: getUpdatedAt(), ...readDataFast() };
  }

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let deleted = false;
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    if (String(ids[i][0]).trim() === recordId) {
      sheet.deleteRow(i + 2);
      deleted = true;
      break;
    }
  }

  if (!deleted) {
    return { ok: false, error: "Record not found", updatedAt: getUpdatedAt(), ...readDataFast() };
  }

  const updatedAt = bumpUpdatedAt(true);
  return { ok: true, deleted: true, type: key, id: recordId, updatedAt: updatedAt };
}

function replaceAll(data) {
  const stamp = new Date().toISOString();
  Object.keys(TABS).forEach((key) => {
    const tab = TABS[key];
    const sheet = ensureTab(tab);
    const fields = tab.columns.map((column) => column[0]);

    let rows = [];
    if (key === "settings") {
      const settings = data.settings && typeof data.settings === "object" ? Object.assign({}, data.settings) : { initialized: true };
      settings.updatedAt = stamp;
      data.settings = settings;
      rows = Object.keys(settings).map((name) => [name, String(settings[name])]);
    } else {
      rows = (data[key] || []).map((item) => fields.map((field) => {
        if (field === "functions") return Array.isArray(item[field]) ? item[field].join(" | ") : String(item[field] || "");
        const value = item[field];
        return value == null ? "" : value;
      }));
    }

    const lastRow = sheet.getLastRow();
    const lastCol = Math.max(sheet.getLastColumn(), fields.length);
    if (lastRow >= 2) {
      sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    }

    if (rows.length) {
      sheet.getRange(2, 1, rows.length, fields.length).setValues(rows);
      const leftover = lastRow - 1 - rows.length;
      if (leftover > 0) {
        sheet.deleteRows(rows.length + 2, leftover);
      }
    } else if (lastRow >= 2) {
      sheet.deleteRows(2, lastRow - 1);
      ensureHeaders(sheet, tab);
    }
  });
  return stamp;
}

function readTabs() {
  const result = { expenses: [], payments: [], guests: [], settings: { initialized: true } };
  Object.keys(TABS).forEach((key) => {
    const tab = TABS[key];
    const sheet = getSheetByName(tab.name, false);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    const fields = tab.columns.map((column) => column[0]);
    const rows = sheet.getRange(2, 1, lastRow - 1, fields.length).getValues();
    rows.forEach((row) => {
      const item = {};
      let allEmpty = true;
      for (let index = 0; index < fields.length; index += 1) {
        const value = row[index];
        item[fields[index]] = value;
        if (value !== "" && value != null) allEmpty = false;
      }
      if (allEmpty) return;
      if (key === "settings") {
        const settingKey = String(item.key || "").trim();
        if (settingKey) result.settings[settingKey] = item.value;
        return;
      }
      if (key === "guests") {
        item.functions = String(item.functions || "").split(/\s*\|\s*/).filter(Boolean);
      }
      result[key].push(item);
    });
  });
  return result;
}

/** One-time / manual beautify. Not used on sync path. */
function setupWorkbook() {
  Object.keys(TABS).forEach((key) => {
    const tab = TABS[key];
    const sheet = ensureTab(tab);
    styleTab(sheet, tab);
  });
  ensureEventsTab();
  ensureWeddingSettings();
  updateDashboard();
  bumpUpdatedAt(true);
}

function ensureWeddingSettings() {
  const sheet = ensureTab(TABS.settings);
  const defaults = [
    ["coupleNames", "Groom & Bride"],
    ["side", "Groom"],
    ["engagementDate", "21 Oct 2026"],
    ["weddingDate", "25 Nov 2026"],
    ["otherFunctions", "22, 23 & 24 Nov 2026"],
    ["expectedGuests", "250-300"],
    ["theme", "Floral Rose"],
    ["updatedAt", new Date().toISOString()]
  ];
  if (sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, defaults.length, 2).setValues(defaults);
    return;
  }
  const existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat().map(String);
  const missing = defaults.filter((row) => existing.indexOf(row[0]) === -1);
  if (missing.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, 2).setValues(missing);
  }
}

function ensureEventsTab() {
  const sheet = ensureTab(EVENTS_TAB);
  if (sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, EVENTS.length, EVENTS_TAB.columns.length).setValues(EVENTS);
  }
  styleTab(sheet, EVENTS_TAB);
}

function styleTab(sheet, tab) {
  const columnCount = tab.columns.length;
  const header = sheet.getRange(1, 1, 1, columnCount);
  header.setFontWeight("bold").setFontColor("#ffffff").setBackground("#b84d6d").setHorizontalAlignment("center");
  sheet.setFrozenRows(1);
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), columnCount).createFilter();
  if (tab.name === "Expenses") {
    sheet.setColumnWidth(2, 220);
    sheet.getRange("E2:F").setNumberFormat("₹#,##0");
    sheet.hideColumns(1);
  }
  if (tab.name === "Payments") {
    sheet.setColumnWidth(3, 220);
    sheet.getRange("G2:G").setNumberFormat("₹#,##0");
    sheet.hideColumns(1, 2);
  }
  if (tab.name === "Guests") {
    sheet.setColumnWidth(2, 200);
    sheet.hideColumns(1);
  }
}

function updateDashboard() {
  const sheet = getSheetByName(DASHBOARD_TAB, true);
  sheet.clear();
  sheet.getRange("A1:F1").merge().setValue("🌸 Wedding Expense Manager").setFontSize(18).setFontWeight("bold").setFontColor("#ffffff").setBackground("#b84d6d");
  sheet.getRange("A2:F2").merge().setValue("Groom Side · Google Sheets database").setFontColor("#8a6475");
  sheet.getRange("A4:B4").setValues([["Key Metric", "Value"]]).setFontWeight("bold").setFontColor("#ffffff").setBackground("#8e2f4c");
  sheet.getRange("A5:A10").setValues([["Total Booked"], ["Total Paid"], ["Total Remaining"], ["Booked Items"], ["Fully Paid Items"], ["Guest People"]]);
  sheet.getRange("B5:B10").setFormulas([
    ["=SUM(Expenses!E2:E)"], ["=SUM(Expenses!F2:F)+SUM(Payments!G2:G)"], ["=MAX(0,B5-B6)"],
    ['=COUNTIF(Expenses!E2:E,">0")'], ['=SUMPRODUCT((Expenses!E2:E>0)*(Expenses!F2:F>=Expenses!E2:E))'], ["=SUM(Guests!J2:J)+SUM(Guests!K2:K)"]
  ]);
  sheet.getRange("B5:B7").setNumberFormat("₹#,##0");
}

function getRsvpGuest(guestId) {
  const id = String(guestId || "").trim();
  if (!id) return { ok: false, error: "Missing guest id" };
  const data = readDataFast();
  const guest = (data.guests || []).find((item) => String(item.id) === id);
  if (!guest) return { ok: false, error: "Invitation not found" };
  return {
    ok: true,
    guest: {
      id: String(guest.id),
      name: String(guest.name || ""),
      functions: Array.isArray(guest.functions) ? guest.functions : String(guest.functions || "").split(/\s*\|\s*/).filter(Boolean),
      adults: Number(guest.adults) || 1,
      children: Number(guest.children) || 0,
      rsvp: String(guest.rsvp || "Not Invited"),
      stay: String(guest.stay || "No"),
      travel: String(guest.travel || "No"),
      side: String(guest.side || "Groom")
    },
    settings: {
      coupleNames: data.settings && data.settings.coupleNames ? String(data.settings.coupleNames) : "",
      engagementDate: data.settings && data.settings.engagementDate ? String(data.settings.engagementDate) : "",
      weddingDate: data.settings && data.settings.weddingDate ? String(data.settings.weddingDate) : ""
    }
  };
}

function submitRsvp(params) {
  const id = String((params && (params.id || params.g)) || "").trim();
  if (!id) return { ok: false, error: "Missing guest id" };

  const allowedRsvp = { Confirmed: 1, Maybe: 1, Declined: 1, "Invite Sent": 1 };
  const rsvp = String((params && params.rsvp) || "").trim();
  if (!allowedRsvp[rsvp]) return { ok: false, error: "Choose Confirmed, Maybe, or Declined" };

  const sheet = ensureTab(TABS.guests);
  const fields = TABS.guests.columns.map((column) => column[0]);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: "Invitation not found" };

  const width = fields.length;
  const values = sheet.getRange(2, 1, lastRow - 1, width).getValues();
  const idIndex = fields.indexOf("id");
  let rowIndex = -1;
  for (let i = 0; i < values.length; i += 1) {
    if (String(values[i][idIndex]).trim() === id) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex < 0) return { ok: false, error: "Invitation not found" };

  const row = values[rowIndex];
  const setField = function (key, value) {
    const index = fields.indexOf(key);
    if (index >= 0) row[index] = value;
  };

  setField("rsvp", rsvp);
  if (params.adults != null && params.adults !== "") setField("adults", Math.max(0, Math.round(Number(params.adults) || 0)));
  if (params.children != null && params.children !== "") setField("children", Math.max(0, Math.round(Number(params.children) || 0)));
  if (params.stay) setField("stay", String(params.stay));
  if (params.travel) setField("travel", String(params.travel));
  if (params.notes != null) {
    const notesIndex = fields.indexOf("notes");
    if (notesIndex >= 0 && String(params.notes).trim()) {
      const existing = String(row[notesIndex] || "").trim();
      const note = String(params.notes).trim();
      row[notesIndex] = existing ? existing + " | RSVP: " + note : "RSVP: " + note;
    }
  }

  sheet.getRange(rowIndex + 2, 1, 1, width).setValues([row]);
  const updatedAt = bumpUpdatedAt(true);
  return { ok: true, updatedAt: updatedAt, rsvp: rsvp, id: id };
}

function readLegacy() {
  const result = { expenses: [], payments: [], guests: [], settings: { initialized: true } };
  const sheet = getSheetByName(LEGACY_SHEET_NAME, false);
  if (!sheet || sheet.getLastRow() < 2) return result;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  rows.forEach((row) => {
    if (!row[1] || !row[2]) return;
    try {
      const item = JSON.parse(row[2]);
      if (row[1] === "expense") result.expenses.push(item);
      if (row[1] === "payment") result.payments.push(item);
      if (row[1] === "guest") result.guests.push(item);
      if (row[1] === "settings") result.settings = item;
    } catch (ignored) {}
  });
  return result;
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function javascriptResponse(content) {
  return ContentService.createTextOutput(content)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
