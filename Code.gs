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
    ["stay", "Accommodation"], ["travel", "Transport"], ["notes", "Remarks"], ["createdAt", "Created At"]
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

function doGet(event) {
  const payload = { ok: true, ...readAll() };
  let callback = event && event.parameter && (event.parameter.prefix || event.parameter.callback);
  if (!callback && event && event.queryString) {
    const match = event.queryString.match(/(?:^|&)(?:prefix|callback)=([^&]+)/);
    if (match) callback = decodeURIComponent(match[1]);
  }
  const safeCallback = callback && /^[A-Za-z_$][\w$]*$/.test(callback) ? callback : "";
  return safeCallback ? javascriptResponse(safeCallback + "(" + JSON.stringify(payload) + ");") : jsonResponse(payload);
}

function doPost(event) {
  try {
    const body = JSON.parse(event.postData.contents || "{}");
    if (body.action === "replace") {
      replaceAll(body.data || {});
      return jsonResponse({ ok: true, ...readAll() });
    }
    return jsonResponse({ ok: false, error: "Unsupported action" });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }
}

function getSheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function ensureTab(tab) {
  const spreadsheet = getSheet();
  const sheet = spreadsheet.getSheetByName(tab.name) || spreadsheet.insertSheet(tab.name);
  const headers = tab.columns.map((column) => column[1]);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (headers.some((header, index) => current[index] !== header)) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  styleTab(sheet, tab);
}

function readAll() {
  Object.keys(TABS).forEach((key) => ensureTab(TABS[key]));
  ensureEventsTab();
  updateDashboard();
  const result = readTabs();
  if (result.expenses.length || result.payments.length || result.guests.length) return result;

  const legacy = readLegacy();
  if (legacy.expenses.length || legacy.payments.length || legacy.guests.length) {
    replaceAll(legacy);
    return legacy;
  }
  return result;
}

function replaceAll(data) {
  Object.keys(TABS).forEach((key) => {
    const tab = TABS[key];
    const sheet = getSheet().getSheetByName(tab.name) || getSheet().insertSheet(tab.name);
    ensureTab(tab);
    const headers = tab.columns.map((column) => column[0]);
    const existingRows = Math.max(sheet.getLastRow() - 1, 0);
    if (existingRows) sheet.getRange(2, 1, existingRows, headers.length).clearContent();
    const rows = key === "settings"
      ? Object.keys(data.settings || { initialized: true }).map((name) => [name, String(data.settings[name])])
      : (data[key] || []).map((item) => headers.map((header) => header === "functions" ? (item[header] || []).join(" | ") : item[header] ?? ""));
    if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    styleTab(sheet, tab);
  });
  ensureEventsTab();
  updateDashboard();
}

function readTabs() {
  const result = { expenses: [], payments: [], guests: [], settings: { initialized: true } };
  Object.keys(TABS).forEach((key) => {
    const tab = TABS[key];
    const sheet = getSheet().getSheetByName(tab.name);
    if (!sheet || sheet.getLastRow() < 2) return;
    const fields = tab.columns.map((column) => column[0]);
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, fields.length).getValues();
    rows.forEach((row) => {
      const item = {};
      fields.forEach((field, index) => item[field] = row[index]);
      if (key === "guests") item.functions = String(item.functions || "").split(" | ").filter(Boolean);
      if (key === "settings") result.settings[item.key] = item.value;
      else result[key].push(item);
    });
  });
  return result;
}

function ensureEventsTab() {
  ensureTab(EVENTS_TAB);
  const sheet = getSheet().getSheetByName(EVENTS_TAB.name);
  if (sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, EVENTS.length, EVENTS_TAB.columns.length).setValues(EVENTS);
  }
  const eventRange = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1);
  const rule = SpreadsheetApp.newDataValidation().requireValueInRange(eventRange, true).setAllowInvalid(true).build();
  const expenses = getSheet().getSheetByName(TABS.expenses.name);
  expenses.getRange(2, 4, 1000, 1).setDataValidation(rule);
  styleTab(sheet, EVENTS_TAB);
}

function styleTab(sheet, tab) {
  const columnCount = tab.columns.length;
  const header = sheet.getRange(1, 1, 1, columnCount);
  header.setFontWeight("bold").setFontColor("#ffffff").setBackground("#1c2430").setHorizontalAlignment("center");
  sheet.setFrozenRows(1);
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), columnCount).createFilter();
  sheet.getBandings().forEach((banding) => banding.remove());
  if (sheet.getLastRow() > 1) sheet.getRange(1, 1, sheet.getLastRow(), columnCount).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
  sheet.setColumnWidths(1, columnCount, 130);
  sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), columnCount).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  if (tab.name === "Expenses") {
    sheet.setColumnWidth(2, 220); sheet.setColumnWidth(7, 180); sheet.setColumnWidth(10, 260);
    sheet.getRange("E2:F1000").setNumberFormat("₹#,##0");
    sheet.hideColumns(1);
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=$E2=0").setBackground("#fff7ed").setRanges([sheet.getRange("A2:K1000")]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=AND($E2>0,$F2>=$E2)").setBackground("#e7f3ec").setRanges([sheet.getRange("A2:K1000")]).build()
    ]);
  }
  if (tab.name === "Payments") {
    sheet.setColumnWidth(3, 220); sheet.setColumnWidth(11, 240); sheet.getRange("G2:G1000").setNumberFormat("₹#,##0");
    sheet.hideColumns(1, 2);
  }
  if (tab.name === "Guests") {
    sheet.setColumnWidth(2, 200); sheet.setColumnWidth(15, 240); sheet.getRange("J2:K1000").setNumberFormat("0");
    sheet.hideColumns(1);
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Confirmed").setBackground("#e7f3ec").setRanges([sheet.getRange("L2:L1000")]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Declined").setBackground("#f8e8e4").setRanges([sheet.getRange("L2:L1000")]).build()
    ]);
  }
  if (tab.name === "Settings") sheet.setColumnWidth(2, 260);
  if (tab.name === "Events") {
    sheet.setColumnWidth(1, 220); sheet.setColumnWidth(5, 260);
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Completed").setBackground("#e7f3ec").setRanges([sheet.getRange("A2:E1000")]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Cancelled").setBackground("#f8e8e4").setRanges([sheet.getRange("A2:E1000")]).build()
    ]);
  }
}

function updateDashboard() {
  const sheet = getSheet().getSheetByName(DASHBOARD_TAB) || getSheet().insertSheet(DASHBOARD_TAB);
  sheet.clear();
  sheet.setHiddenGridlines(true);
  sheet.getRange("A1:F1").merge().setValue("Wedding Expense Manager").setFontSize(18).setFontWeight("bold").setFontColor("#ffffff").setBackground("#1c2430");
  sheet.getRange("A2:F2").merge().setValue("Groom Side • 2026 • Live sheet dashboard").setFontColor("#5e6874");
  sheet.getRange("A4:B4").setValues([["Key Metric", "Value"]]).setFontWeight("bold").setFontColor("#ffffff").setBackground("#8d7344");
  sheet.getRange("A5:A10").setValues([["Total Booked"], ["Total Paid"], ["Total Remaining"], ["Booked Items"], ["Fully Paid Items"], ["Guest People"]]);
  sheet.getRange("B5:B10").setFormulas([
    ["=SUM(Expenses!E2:E)"], ["=SUM(Expenses!F2:F)+SUM(Payments!G2:G)"], ["=MAX(0,B5-B6)"],
    ['=COUNTIF(Expenses!E2:E,">0")'], ['=SUMPRODUCT((Expenses!E2:E>0)*(Expenses!F2:F>=Expenses!E2:E))'], ["=SUM(Guests!J2:J)+SUM(Guests!K2:K)"]
  ]);
  sheet.getRange("B5:B7").setNumberFormat("₹#,##0");
  sheet.getRange("A12:D12").setValues([["Event", "Booked", "Paid", "Remaining"]]).setFontWeight("bold").setFontColor("#ffffff").setBackground("#8d7344");
  const eventRows = EVENTS.filter((event) => event[0] !== "Common / All Functions").map((event) => [event[0], "", "", ""]);
  sheet.getRange(13, 1, eventRows.length, 4).setValues(eventRows);
  eventRows.forEach((_, index) => {
    const row = index + 13;
    sheet.getRange(row, 2, 1, 3).setFormulas([[`=SUMIF(Expenses!D:D,A${row},Expenses!E:E)`, `=SUMIF(Expenses!D:D,A${row},Expenses!F:F)+SUMIF(Payments!D:D,A${row},Payments!G:G)`, `=MAX(0,B${row}-C${row})`]]);
  });
  sheet.getRange(13, 2, eventRows.length, 3).setNumberFormat("₹#,##0");
  sheet.getRange("A1:F40").setVerticalAlignment("middle");
  sheet.setColumnWidths(1, 4, 150); sheet.setColumnWidth(1, 220);
  sheet.setFrozenRows(2);
  if (sheet.getFilter()) sheet.getFilter().remove();
  sheet.getRange(12, 1, Math.max(eventRows.length + 1, 2), 4).createFilter();
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=$D13=0").setBackground("#fff7ed").setRanges([sheet.getRange(13, 1, Math.max(eventRows.length, 1), 4)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied("=$C13>=$B13").setBackground("#e7f3ec").setRanges([sheet.getRange(13, 1, Math.max(eventRows.length, 1), 4)]).build()
  ]);
}

function readLegacy() {
  const result = { expenses: [], payments: [], guests: [], settings: { initialized: true } };
  const sheet = getSheet().getSheetByName(LEGACY_SHEET_NAME);
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
