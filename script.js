/* Wedding Expense Manager — Google Sheets is the only database. */

const SYNC_API_URL = "https://script.google.com/macros/s/AKfycbwwmRmRZU-2tFSplx1jr--PJJeEVMWZwg2E37iXHjS9_d2iuZjDuUOnr6uYO_uLmIyr/exec";
const LEGACY_LOCAL_KEYS = [
  "wedding_expenses",
  "wedding_payments",
  "wedding_guests",
  "wedding_settings"
];

const CATEGORIES = [
  "Venue",
  "Food",
  "Decoration",
  "Photography",
  "Entertainment",
  "Groom",
  "Jewellery",
  "Gifts",
  "Transportation",
  "Accommodation",
  "Invitations",
  "Rituals",
  "Miscellaneous"
];

const FUNCTIONS = [
  "Engagement",
  "Ramayana",
  "Haldi",
  "Mehendi",
  "Sangeet",
  "Mandap Reception",
  "Wedding",
  "Baraat",
  "Common / All Functions"
];

const GUEST_FUNCTIONS = [
  "Engagement",
  "Ramayana",
  "Haldi",
  "Mehendi",
  "Sangeet",
  "Mandap Reception",
  "Wedding",
  "Baraat",
  "Common / All Functions"  
];

const GUEST_RELATIONS = [
  "Family",
  "Relative",
  "Friend",
  "Colleague",
  "Neighbour",
  "Vendor / Helper",
  "Other"
];

const RSVP_STATUSES = ["Not Invited", "Invite Sent", "Confirmed", "Maybe", "Declined"];
const INVITE_STATUSES = ["Not Sent", "Sent"];
const PAYMENT_MODES = ["Cash", "UPI", "Bank Transfer", "Card", "Other"];
const PENDING_LIMIT = 8;
const OTHER = "__other__";

const INVITE_CARDS = {
  engagement: {
    key: "engagement",
    label: "Engagement",
    guestField: "inviteEngagement",
    files: [
      "invitations/engagement.png",
      "invitations/Engagement Card.png"
    ]
  },
  wedding: {
    key: "wedding",
    label: "Wedding",
    guestField: "inviteWedding",
    files: [
      "invitations/wedding.png",
      "invitations/Wedding Card.png"
    ]
  }
};

const inviteShareState = {
  contact: null,
  cardKey: "engagement",
  cardUrl: "",
  resolved: {}
};

const state = {
  expenses: [],
  payments: [],
  guests: [],
  settings: { initialized: true },
  tab: "dashboard",
  loadError: "",
  syncError: "",
  apiUrl: SYNC_API_URL,
  busy: false,
  pullQueued: false,
  saveQueued: false,
  pendingWrite: false,
  ready: false,
  updatedAt: "",
  dataFingerprint: ""
};

const confirmState = { resolve: null };
let saveChain = Promise.resolve();

/* Sheets database — no LocalStorage */

function purgeLegacyLocalStorage() {
  LEGACY_LOCAL_KEYS.forEach((key) => {
    try {
      localStorage.removeItem(key);
    } catch (ignored) {}
  });
}

function getSyncUrl() {
  return String(state.apiUrl || SYNC_API_URL || "").trim();
}

function setLoader(visible) {
  const loader = document.getElementById("page-loader");
  if (loader) loader.hidden = !visible;
}

function settingValue(key, fallback) {
  const value = state.settings && state.settings[key];
  const text = value == null ? "" : String(value).trim();
  if (!text) return fallback;
  return formatSettingDisplay(text);
}

function formatSettingDisplay(value) {
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    }
  }
  return value;
}

function renderWeddingDetails() {
  const target = document.getElementById("wedding-details");
  if (!target) return;
  const rows = [
    ["💍 Engagement", settingValue("engagementDate", "Add in Settings sheet")],
    ["💒 Wedding", settingValue("weddingDate", "Add in Settings sheet")],
    ["🎉 Other Functions", settingValue("otherFunctions", "Add in Settings sheet")],
    ["👥 Expected Guests", settingValue("expectedGuests", "Add in Settings sheet")],
    ["🤵 Side", settingValue("side", "Groom")],
    ["🌸 Couple", settingValue("coupleNames", "Add in Settings sheet")]
  ];
  target.innerHTML = rows.map(([label, value]) => `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `).join("");
}

function setSyncStatus(message, isError) {
  const status = document.getElementById("sync-status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", Boolean(isError));
}

function applyRemoteData(data) {
  if (!data || !Array.isArray(data.expenses) || !Array.isArray(data.payments)) {
    throw new Error("The sheet returned invalid data.");
  }
  state.expenses = data.expenses.map(sanitizeExpense).filter(Boolean);
  state.payments = data.payments.map(sanitizePayment).filter(Boolean);
  state.guests = Array.isArray(data.guests) ? data.guests.map(sanitizeGuest).filter(Boolean) : [];
  state.settings = {
    initialized: true,
    ...(data.settings && typeof data.settings === "object" ? data.settings : {})
  };
  state.updatedAt = String(data.updatedAt || state.settings.updatedAt || "");
  state.dataFingerprint = [
    state.expenses.length,
    state.payments.length,
    state.guests.length,
    state.updatedAt
  ].join(":");
  state.ready = true;
}

function jsonpRequest(url, extraParams) {
  return new Promise((resolve, reject) => {
    const callbackName = `weddingSheetCallback${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    const script = document.createElement("script");
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.remove();
      try {
        delete window[callbackName];
      } catch (ignored) {
        window[callbackName] = undefined;
      }
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    window[callbackName] = (payload) => finish(resolve, payload);
    script.onerror = () => finish(reject, new Error("Could not reach the wedding sheet."));
    const timeout = window.setTimeout(() => {
      finish(reject, new Error("The wedding sheet timed out."));
    }, 20000);

    const params = new URLSearchParams();
    params.set("prefix", callbackName);
    params.set("_", String(Date.now()));
    if (extraParams && typeof extraParams === "object") {
      Object.keys(extraParams).forEach((key) => {
        if (extraParams[key] != null && extraParams[key] !== "") {
          params.set(key, String(extraParams[key]));
        }
      });
    }
    script.src = `${url}${url.includes("?") ? "&" : "?"}${params.toString()}`;
    document.head.appendChild(script);
  });
}

async function postToSheet(payload) {
  const url = getSyncUrl();
  if (!url) throw new Error("Sheet API URL is missing.");
  const expected = {
    expenses: (payload.data && payload.data.expenses ? payload.data.expenses.length : 0),
    payments: (payload.data && payload.data.payments ? payload.data.payments.length : 0),
    guests: (payload.data && payload.data.guests ? payload.data.guests.length : 0)
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow"
    });
    const text = await response.text();
    const data = JSON.parse(text);
    if (!data || data.ok === false) {
      throw new Error((data && data.error) || "Sheet save failed.");
    }
    return data;
  } catch (fetchError) {
    const body = JSON.stringify(payload);
    const sent = navigator.sendBeacon(url, new Blob([body], { type: "text/plain;charset=utf-8" }));
    if (!sent) throw new Error(fetchError.message || "The wedding sheet rejected the save request.");
    return confirmSheetWrite(url, expected);
  }
}

async function confirmSheetWrite(url, expected) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await wait(400 + attempt * 300);
    last = await jsonpRequest(url);
    if (!last || last.ok === false) continue;
    const expenses = Array.isArray(last.expenses) ? last.expenses.length : -1;
    const payments = Array.isArray(last.payments) ? last.payments.length : -1;
    const guests = Array.isArray(last.guests) ? last.guests.length : -1;
    if (expenses === expected.expenses && payments === expected.payments && guests === expected.guests) {
      return last;
    }
  }
  if (last && last.ok !== false) return last;
  throw new Error("Saved to sheet, but confirmation failed.");
}

async function deleteOnSheet(type, id) {
  const url = getSyncUrl();
  if (!url) throw new Error("Sheet API URL is missing.");
  const remote = await jsonpRequest(url, {
    action: "delete",
    type,
    id
  });
  if (!remote || remote.ok === false) {
    throw new Error((remote && remote.error) || "Delete failed on Google Sheet.");
  }
  return remote;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Pull only - never writes to the sheet. */
async function pullFromSheet(options) {
  const opts = options || {};
  const quiet = Boolean(opts.quiet);
  const url = getSyncUrl();
  if (!url) {
    setSyncStatus("Sheet API not configured", true);
    return false;
  }
  if (state.busy || state.pendingWrite) {
    state.pullQueued = true;
    return false;
  }
  state.busy = true;
  if (!quiet) setSyncStatus("Syncing…", false);
  try {
    const params = {};
    if (state.updatedAt) params.since = state.updatedAt;
    const remote = await jsonpRequest(url, params);

    if (remote && remote.unchanged) {
      state.syncError = "";
      setSyncStatus(`Live · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, false);
      setLoader(false);
      return true;
    }

    applyRemoteData(remote);
    if (reconcileAdvancePayments()) state.saveQueued = true;
    state.syncError = "";
    setSyncStatus(`Live · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, false);
    setLoader(false);
    render();
    return true;
  } catch (error) {
    state.syncError = error.message;
    if (!quiet) setSyncStatus("Sheet unavailable", true);
    setLoader(false);
    return false;
  } finally {
    state.busy = false;
    if (state.saveQueued) {
      state.saveQueued = false;
      state.pullQueued = false;
      queueSave();
    } else if (state.pullQueued) {
      state.pullQueued = false;
      pullFromSheet({ quiet: true });
    }
  }
}

async function writeSnapshotToSheet() {
  const result = await postToSheet({
    action: "replace",
    data: {
      expenses: state.expenses,
      payments: state.payments,
      guests: state.guests,
      settings: state.settings
    }
  });
  applyRemoteData(result);
  return result;
}

/** Push current in-memory state to Sheets. Used only after website edits. */
function saveData() {
  return queueSave();
}

function queueSave() {
  const run = runSave();
  saveChain = saveChain.then(() => run, () => run);
  return run;
}

async function runSave() {
  const url = getSyncUrl();
  if (!url) {
    setSyncStatus("Sheet API not configured", true);
    showToast("Cannot save - sheet API URL missing");
    return false;
  }
  if (state.busy) {
    state.saveQueued = true;
    return false;
  }
  state.busy = true;
  state.pendingWrite = true;
  setSyncStatus("Saving to sheet…", false);
  try {
    await writeSnapshotToSheet();
    state.syncError = "";
    setSyncStatus(`Saved · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, false);
    render();
    return true;
  } catch (error) {
    state.syncError = error.message;
    setSyncStatus("Save failed", true);
    showToast("Could not save to Google Sheet");
    return false;
  } finally {
    state.pendingWrite = false;
    state.busy = false;
    if (state.saveQueued) {
      state.saveQueued = false;
      state.pullQueued = false;
      queueSave();
    } else if (state.pullQueued) {
      state.pullQueued = false;
      pullFromSheet();
    }
  }
}

async function mutateDelete(type, id, successMessage) {
  const url = getSyncUrl();
  if (!url) {
    showToast("Sheet API URL missing");
    return false;
  }
  if (state.busy) {
    showToast("Please wait - sync in progress");
    return false;
  }

  state.busy = true;
  state.pendingWrite = true;
  setSyncStatus("Deleting…", false);
  try {
    const remote = await deleteOnSheet(type, id);
    if (type === "expenses") state.expenses = state.expenses.filter((item) => item.id !== id);
    else if (type === "payments") state.payments = state.payments.filter((item) => item.id !== id);
    else if (type === "guests") state.guests = state.guests.filter((item) => item.id !== id);
    state.updatedAt = String(remote.updatedAt || state.updatedAt || "");
    state.ready = true;
    state.syncError = "";
    setSyncStatus(`Live · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, false);
    render();
    showToast(successMessage);
    return true;
  } catch (error) {
    state.syncError = error.message;
    setSyncStatus("Delete failed", true);
    showToast(error.message || "Could not delete on Google Sheet");
    state.busy = false;
    state.pendingWrite = false;
    await pullFromSheet();
    return false;
  } finally {
    state.pendingWrite = false;
    state.busy = false;
    if (state.pullQueued) {
      state.pullQueued = false;
      pullFromSheet({ quiet: true });
    }
  }
}

async function syncFromSheet() {
  return pullFromSheet();
}

function configureSync() {
  const current = getSyncUrl();
  const url = window.prompt("Paste your deployed Google Apps Script web-app URL:", current);
  if (url === null) return;
  state.apiUrl = url.trim() || SYNC_API_URL;
  if (!state.apiUrl) {
    setSyncStatus("Sheet API not configured", true);
    showToast("Sheet API disabled");
    return;
  }
  pullFromSheet().then((ok) => {
    showToast(ok ? "Connected to Google Sheet" : "Could not connect to the sheet");
  });
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function uid(prefix) {
  return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sanitizeExpense(raw) {
  if (!raw || typeof raw !== "object") return null;
  const expense = String(raw.expense || "").trim();
  if (!expense) return null;
  return {
    id: String(raw.id || uid("exp")),
    expense,
    category: String(raw.category || "Miscellaneous").trim() || "Miscellaneous",
    function: String(raw.function || "Common / All Functions").trim() || "Common / All Functions",
    bookingValue: Math.max(0, num(raw.bookingValue)),
    advancePaid: Math.max(0, num(raw.advancePaid)),
    vendor: String(raw.vendor || "").trim(),
    vendorPhone: String(raw.vendorPhone || "").trim(),
    contactPerson: String(raw.contactPerson || "").trim(),
    notes: String(raw.notes || raw.remark || ""),
    createdAt: raw.createdAt || new Date().toISOString()
  };
}

function sanitizePayment(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!raw.expenseId) return null;
  return {
    id: String(raw.id || uid("pay")),
    expenseId: String(raw.expenseId),
    expenseName: String(raw.expenseName || "Unknown expense"),
    functionName: String(raw.functionName || ""),
    category: String(raw.category || ""),
    date: String(raw.date || "").slice(0, 10),
    amount: Math.max(0, num(raw.amount)),
    mode: PAYMENT_MODES.includes(raw.mode) ? raw.mode : "Other",
    vendor: String(raw.vendor || ""),
    reference: String(raw.reference || ""),
    notes: String(raw.notes || ""),
    createdAt: raw.createdAt || new Date().toISOString()
  };
}

function sanitizeGuest(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || "").trim();
  if (!name) return null;
  const functions = Array.isArray(raw.functions)
    ? raw.functions.map((item) => String(item).trim()).filter(Boolean)
    : String(raw.function || "").split(",").map((item) => item.trim()).filter(Boolean);
  const adults = Math.max(0, Math.round(num(raw.adults)));
  const children = Math.max(0, Math.round(num(raw.children)));
  return {
    id: String(raw.id || uid("gst")),
    name,
    phone: String(raw.phone || "").trim(),
    phoneAlt: String(raw.phoneAlt || "").trim(),
    functions: functions.length ? functions : ["Wedding"],
    side: ["Groom", "Bride", "Common"].includes(raw.side) ? raw.side : "Groom",
    relation: String(raw.relation || "Family").trim() || "Family",
    city: String(raw.city || "").trim(),
    address: String(raw.address || "").trim(),
    adults: adults || 1,
    children,
    rsvp: RSVP_STATUSES.includes(raw.rsvp) ? raw.rsvp : "Not Invited",
    stay: ["Yes", "No", "Maybe"].includes(raw.stay) ? raw.stay : "No",
    travel: ["Yes", "No", "Pickup Needed"].includes(raw.travel) ? raw.travel : "No",
    notes: String(raw.notes || raw.remark || ""),
    inviteEngagement: INVITE_STATUSES.includes(raw.inviteEngagement) ? raw.inviteEngagement : "Not Sent",
    inviteWedding: INVITE_STATUSES.includes(raw.inviteWedding) ? raw.inviteWedding : "Not Sent",
    createdAt: raw.createdAt || new Date().toISOString()
  };
}

/* Calculations */

function getExpense(id) {
  return state.expenses.find((item) => item.id === id) || null;
}

function getGuest(id) {
  return state.guests.find((item) => item.id === id) || null;
}

function getLinkedPayments(expenseId) {
  return state.payments.filter((payment) => payment.expenseId === expenseId);
}

function advancePaymentId(expenseId) {
  return `pay-adv-${expenseId}`;
}

function findAdvancePayment(expenseId) {
  const advId = advancePaymentId(expenseId);
  const byId = state.payments.find((payment) => payment.id === advId);
  if (byId) return byId;
  return state.payments.find((payment) => {
    if (payment.expenseId !== expenseId) return false;
    const reference = String(payment.reference || "").trim().toUpperCase();
    const notes = String(payment.notes || "").trim().toLowerCase();
    return reference === "ADVANCE" || notes === "advance" || notes === "auto advance";
  }) || null;
}

/** Keep a single advance Payment row in sync with expense.advancePaid (idempotent). */
function ensureAdvancePayment(expense) {
  if (!expense || !expense.id) return false;
  const advance = num(expense.advancePaid);
  const advId = advancePaymentId(expense.id);
  const existing = findAdvancePayment(expense.id);

  if (advance <= 0) {
    if (!existing) return false;
    if (existing.id !== advId && String(existing.reference || "").toUpperCase() !== "ADVANCE") return false;
    state.payments = state.payments.filter((payment) => payment.id !== existing.id);
    return true;
  }

  if (existing) {
    let changed = false;
    if (num(existing.amount) !== advance) {
      existing.amount = advance;
      changed = true;
    }
    if (existing.expenseName !== expense.expense) {
      existing.expenseName = expense.expense;
      changed = true;
    }
    if (existing.functionName !== expense.function) {
      existing.functionName = expense.function;
      changed = true;
    }
    if (existing.category !== expense.category) {
      existing.category = expense.category;
      changed = true;
    }
    if (expense.vendor && existing.vendor !== expense.vendor) {
      existing.vendor = expense.vendor;
      changed = true;
    }
    if (!String(existing.reference || "").trim()) {
      existing.reference = "ADVANCE";
      changed = true;
    }
    return changed;
  }

  state.payments.push({
    id: advId,
    expenseId: expense.id,
    expenseName: expense.expense,
    functionName: expense.function,
    category: expense.category,
    date: String(expense.createdAt || todayISO()).slice(0, 10),
    amount: advance,
    mode: "Cash",
    vendor: expense.vendor || "",
    reference: "ADVANCE",
    notes: "Advance",
    createdAt: new Date().toISOString()
  });
  return true;
}

function reconcileAdvancePayments() {
  let changed = false;
  state.expenses.forEach((expense) => {
    if (ensureAdvancePayment(expense)) changed = true;
  });
  return changed;
}

function syncAdvanceFromPayment(payment) {
  if (!payment) return;
  const expense = getExpense(payment.expenseId);
  if (!expense) return;
  const advance = findAdvancePayment(expense.id);
  if (!advance || advance.id !== payment.id) return;
  expense.advancePaid = num(payment.amount);
}

/** Payments only — single source of truth for paid amounts. */
function getTotalPaid(expense) {
  return getLinkedPayments(expense.id).reduce((sum, payment) => sum + num(payment.amount), 0);
}

function getBookingRemaining(expense) {
  if (!(num(expense.bookingValue) > 0)) return 0;
  return Math.max(0, num(expense.bookingValue) - getTotalPaid(expense));
}

function getDisplayRemaining(expense) {
  return getBookingRemaining(expense);
}

function getStatus(expense) {
  if (!(num(expense.bookingValue) > 0)) return { key: "not-booked", label: "Not Booked" };
  if (getTotalPaid(expense) >= num(expense.bookingValue)) return { key: "paid", label: "Fully Paid" };
  return { key: "advance", label: "Advance Paid" };
}

function guestPeople(guest) {
  return num(guest.adults) + num(guest.children);
}

function calculateTotals() {
  const totals = {
    totalBooked: 0,
    totalPaid: 0,
    totalRemaining: 0,
    unbookedCount: 0,
    bookedCount: 0,
    paidCount: 0,
    guestEntries: state.guests.length,
    guestPeople: 0,
    guestConfirmed: 0
  };

  state.expenses.forEach((expense) => {
    const booked = num(expense.bookingValue);
    totals.totalBooked += booked;
    totals.totalRemaining += getBookingRemaining(expense);
    if (booked <= 0) totals.unbookedCount += 1;
    else totals.bookedCount += 1;
    if (getStatus(expense).key === "paid") totals.paidCount += 1;
  });

  state.payments.forEach((payment) => {
    totals.totalPaid += num(payment.amount);
  });

  state.guests.forEach((guest) => {
    totals.guestPeople += guestPeople(guest);
    if (guest.rsvp === "Confirmed") totals.guestConfirmed += guestPeople(guest);
  });

  return totals;
}

function resolvePayment(payment) {
  const expense = getExpense(payment.expenseId);
  return {
    ...payment,
    expenseName: expense ? expense.expense : payment.expenseName,
    functionName: expense ? expense.function : payment.functionName,
    category: expense ? expense.category : payment.category
  };
}

function summarize(kind) {
  const groups = new Map();

  function ensure(name) {
    const key = name || "Uncategorised";
    if (!groups.has(key)) {
      groups.set(key, { name: key, booked: 0, paid: 0, remaining: 0, count: 0 });
    }
    return groups.get(key);
  }

  if (kind === "function") FUNCTIONS.forEach(ensure);
  if (kind === "category") CATEGORIES.forEach(ensure);

  state.expenses.forEach((expense) => {
    const row = ensure(kind === "function" ? expense.function : expense.category);
    row.booked += num(expense.bookingValue);
    row.paid += getTotalPaid(expense);
    row.remaining += getBookingRemaining(expense);
    row.count += 1;
  });

  state.payments.forEach((payment) => {
    if (getExpense(payment.expenseId)) return;
    const resolved = resolvePayment(payment);
    const row = ensure(kind === "function" ? resolved.functionName : resolved.category);
    row.paid += num(payment.amount);
  });

  const standard = kind === "function" ? FUNCTIONS : CATEGORIES;
  const ordered = standard.map((name) => groups.get(name)).filter(Boolean);
  groups.forEach((row) => {
    if (!standard.includes(row.name)) ordered.push(row);
  });
  return ordered;
}

function summarizeGuests() {
  const rows = GUEST_FUNCTIONS.map((name) => ({
    name,
    entries: 0,
    people: 0,
    confirmed: 0,
    stay: 0
  }));
  const map = new Map(rows.map((row) => [row.name, row]));

  state.guests.forEach((guest) => {
    const people = guestPeople(guest);
    const targets = guest.functions.length ? guest.functions : ["Wedding"];
    targets.forEach((fn) => {
      const row = map.get(fn) || { name: fn, entries: 0, people: 0, confirmed: 0, stay: 0 };
      row.entries += 1;
      row.people += people;
      if (guest.rsvp === "Confirmed") row.confirmed += people;
      if (guest.stay === "Yes") row.stay += people;
      if (!map.has(fn)) {
        map.set(fn, row);
        rows.push(row);
      }
    });
  });

  return rows;
}

function getPendingExpenses() {
  return state.expenses
    .filter((expense) => getBookingRemaining(expense) > 0)
    .sort((a, b) => getBookingRemaining(b) - getBookingRemaining(a) || a.expense.localeCompare(b.expense));
}

/* Formatting */

function formatCurrency(amount) {
  const value = Math.max(0, Math.round(num(amount)));
  return "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
}

function formatDate(iso) {
  if (!iso) return "—";
  const parts = String(iso).split("-");
  if (parts.length !== 3) return iso;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatPhone(phone) {
  const text = String(phone || "").trim();
  if (!text) return "—";
  const digits = text.replace(/\D/g, "");
  const href = digits ? `tel:${digits}` : "";
  return href
    ? `<a class="phone-link" href="${escapeHtml(href)}">${escapeHtml(text)}</a>`
    : escapeHtml(text);
}

function todayISO() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dash(value) {
  const text = String(value || "").trim();
  return text ? escapeHtml(text) : "—";
}

function parseAmount(value) {
  const cleaned = String(value ?? "").trim().replace(/[₹,\s]/g, "");
  if (cleaned === "") return 0;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

function uniqueOptions(base, values) {
  const seen = new Set(base.map((item) => item.toLowerCase()));
  const extra = [];
  values.forEach((value) => {
    const text = String(value || "").trim();
    if (!text || seen.has(text.toLowerCase())) return;
    seen.add(text.toLowerCase());
    extra.push(text);
  });
  extra.sort((a, b) => a.localeCompare(b));
  return base.concat(extra);
}

function chips(list) {
  if (!list || !list.length) return "—";
  return `<div class="chip-row">${list.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div>`;
}

/* Render */

function render(parts) {
  const which = parts || ["dashboard", "budget", "payments", "guests", "invitations"];
  if (which.includes("dashboard")) renderDashboard();
  if (which.includes("budget")) renderBudget();
  if (which.includes("payments")) renderPayments();
  if (which.includes("guests")) renderGuests();
  if (which.includes("invitations")) renderInvitations();
  const detail = document.getElementById("budget-detail");
  if (detail && !detail.hidden && detail.dataset.expenseId) {
    if (getExpense(detail.dataset.expenseId)) openBudgetDetail(detail.dataset.expenseId);
    else closeBudgetDetail();
  }
}

function renderDashboard() {
  const totals = calculateTotals();
  const paidPercent = totals.totalBooked > 0 ? Math.min(100, Math.round((totals.totalPaid / totals.totalBooked) * 100)) : 0;
  const pending = getPendingExpenses();
  const topPending = pending[0];
  const cards = [
    ["💰", "Total Booked", formatCurrency(totals.totalBooked), "Sum of booking values"],
    ["✅", "Total Paid", formatCurrency(totals.totalPaid), `${paidPercent}% of booked budget`],
    ["⏳", "Total Remaining", formatCurrency(totals.totalRemaining), "Still due on bookings"],
    ["📋", "Booked Items", String(totals.bookedCount), `${totals.unbookedCount} still unbooked`],
    ["🎉", "Fully Paid", String(totals.paidCount), "Bookings settled in full"],
    ["👥", "Guests", String(totals.guestPeople), `${totals.guestEntries} entries · ${totals.guestConfirmed} confirmed`]
  ];

  document.getElementById("stat-grid").innerHTML = cards.map(([icon, label, value, note]) => `
    <article class="stat">
      <div class="stat-label"><span class="stat-icon" aria-hidden="true">${icon}</span>${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(value)}</div>
      <div class="stat-note">${escapeHtml(note)}</div>
    </article>
  `).join("");

  const dashboardMeta = document.getElementById("dashboard-meta");
  dashboardMeta.textContent = state.syncError
    ? "Could not reach Google Sheets"
    : state.ready
      ? "Google Sheets is the live database"
      : "Loading from Google Sheets…";
  renderDashboardInsights(totals, paidPercent, topPending);
  renderWeddingDetails();

  renderSummary("function-summary", summarize("function"), "Function");
  renderSummary("category-summary", summarize("category"), "Category");
  renderGuestSummary();
  renderPending();
}

function renderDashboardInsights(totals, paidPercent, topPending) {
  const eventRows = summarize("function")
    .filter((row) => row.booked > 0 || row.count > 0)
    .sort((a, b) => b.remaining - a.remaining || b.booked - a.booked)
    .slice(0, 5);
  const eventPulse = eventRows.length
    ? eventRows.map((row) => {
      const percent = row.booked > 0 ? Math.min(100, Math.round((row.paid / row.booked) * 100)) : 0;
      return `<button type="button" class="pulse-row" data-action="view-event" data-event="${escapeHtml(row.name)}">
        <span class="pulse-name"><span class="summary-icon" aria-hidden="true">${summaryIcon(row.name, "Function")}</span>${escapeHtml(row.name)}</span>
        <span class="pulse-track"><span style="width:${percent}%"></span></span>
        <strong>${percent}%</strong>
      </button>`;
    }).join("")
    : `<p class="empty-inline">Add bookings to see event progress.</p>`;

  document.getElementById("dashboard-insights").innerHTML = `
    <section class="block health-card" aria-labelledby="health-title">
      <div class="block-head">
        <h3 id="health-title">📊 Budget Health</h3>
        <span class="health-badge">${paidPercent}% paid</span>
      </div>
      <div class="health-track"><span style="width:${paidPercent}%"></span></div>
      <div class="health-meta"><span>${formatCurrency(totals.totalPaid)} paid</span><span>${formatCurrency(totals.totalRemaining)} remaining</span></div>
      <div class="insight-grid">
        <div><span>Largest pending</span><strong>${topPending ? escapeHtml(topPending.expense) : "Nothing pending"}</strong></div>
        <div><span>Next amount due</span><strong>${topPending ? formatCurrency(getBookingRemaining(topPending)) : "₹0"}</strong></div>
        <div><span>Confirmed guests</span><strong>${totals.guestConfirmed} people</strong></div>
      </div>
    </section>
    <section class="block pulse-card" aria-labelledby="pulse-title">
      <div class="block-head"><h3 id="pulse-title">🎯 Event Pulse</h3><span class="hint">Click an event to filter Budget</span></div>
      <div class="pulse-list">${eventPulse}</div>
    </section>
  `;
}

function summaryIcon(name, label) {
  const icons = label === "Category"
    ? { Venue: "🏛️", Food: "🍽️", Decoration: "🌸", Photography: "📸", Entertainment: "🎵", Groom: "🤵", Jewellery: "💎", Gifts: "🎁", Transportation: "🚗", Accommodation: "🏨", Invitations: "💌", Rituals: "🪔", Miscellaneous: "🧾" }
    : { Engagement: "💍", Ramayana: "📖", Haldi: "🌼", Mehendi: "🌿", Sangeet: "🎶", "Mandap Reception": "✨", Wedding: "💒", Baraat: "🐎", "Common / All Functions": "🧩" };
  return icons[name] || "•";
}

function renderSummary(targetId, rows, label) {
  const totals = rows.reduce((sum, row) => {
    sum.booked += row.booked;
    sum.paid += row.paid;
    sum.remaining += row.remaining;
    return sum;
  }, { booked: 0, paid: 0, remaining: 0 });

  const body = rows.map((row) => {
    const empty = row.count === 0 && row.paid === 0;
    return `
      <tr class="${empty ? "is-empty" : ""}">
        <td><span class="summary-icon" aria-hidden="true">${summaryIcon(row.name, label)}</span> ${escapeHtml(row.name)}</td>
        <td class="num">${formatCurrency(row.booked)}</td>
        <td class="num">${formatCurrency(row.paid)}</td>
        <td class="num">${formatCurrency(row.remaining)}</td>
      </tr>
    `;
  }).join("");

  document.getElementById(targetId).innerHTML = `
    <div class="table-scroll">
      <table class="data-table summary-table">
        <thead>
          <tr>
            <th>${escapeHtml(label)}</th>
            <th class="num">Booked</th>
            <th class="num">Paid</th>
            <th class="num">Remaining</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td class="num">${formatCurrency(totals.booked)}</td>
            <td class="num">${formatCurrency(totals.paid)}</td>
            <td class="num">${formatCurrency(totals.remaining)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

function renderGuestSummary() {
  const rows = summarizeGuests();
  const totals = rows.reduce((sum, row) => {
    sum.entries += row.entries;
    sum.people += row.people;
    sum.confirmed += row.confirmed;
    sum.stay += row.stay;
    return sum;
  }, { entries: 0, people: 0, confirmed: 0, stay: 0 });

  if (!state.guests.length) {
    document.getElementById("guest-summary").innerHTML = `
      <div class="empty">
        <span class="empty-emoji">🥂</span>
        <p>No guests in the sheet yet.</p>
        <button type="button" class="linkish" data-action="add-guest">Add your first guest</button>
      </div>
    `;
    return;
  }

  document.getElementById("guest-summary").innerHTML = `
    <div class="table-scroll">
      <table class="data-table summary-table">
        <thead>
          <tr>
            <th>Function</th>
            <th class="num">Entries</th>
            <th class="num">People</th>
            <th class="num">Confirmed</th>
            <th class="num">Need Stay</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr class="${row.entries ? "" : "is-empty"}">
              <td>${escapeHtml(row.name)}</td>
              <td class="num">${row.entries}</td>
              <td class="num">${row.people}</td>
              <td class="num">${row.confirmed}</td>
              <td class="num">${row.stay}</td>
            </tr>
          `).join("")}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td class="num">${totals.entries}</td>
            <td class="num">${totals.people}</td>
            <td class="num">${totals.confirmed}</td>
            <td class="num">${totals.stay}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

function renderPending() {
  const pending = getPendingExpenses();
  const list = document.getElementById("pending-list");
  const viewAll = document.getElementById("view-pending");

  if (!pending.length) {
    list.innerHTML = `<div class="empty"><span class="empty-emoji">🎉</span><p>No pending payments</p></div>`;
    viewAll.hidden = true;
    return;
  }

  const shown = pending.slice(0, PENDING_LIMIT);
  viewAll.hidden = pending.length <= PENDING_LIMIT;

  list.innerHTML = `
    <div class="table-scroll">
      <table class="data-table summary-table">
        <thead>
          <tr>
            <th>Expense</th>
            <th>Vendor</th>
            <th>Function</th>
            <th class="num">Remaining</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${shown.map((expense) => {
            const status = getStatus(expense);
            return `
              <tr>
                <td>${escapeHtml(expense.expense)}</td>
                <td>${dash(expense.vendor)}</td>
                <td>${escapeHtml(expense.function)}</td>
                <td class="num">${formatCurrency(getBookingRemaining(expense))}</td>
                <td>${statusBadge(status)}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function statusBadge(status) {
  return `<span class="badge badge-${status.key}">${escapeHtml(status.label)}</span>`;
}

function rsvpBadge(rsvp) {
  const key = rsvp === "Confirmed" ? "paid" : rsvp === "Declined" ? "not-booked" : rsvp === "Maybe" || rsvp === "Invite Sent" ? "advance" : "not-booked";
  return `<span class="badge badge-${key}">${escapeHtml(rsvp)}</span>`;
}

function fillSelect(select, options, current, placeholder) {
  const previous = current != null ? current : select.value;
  const html = [];
  if (placeholder) html.push(`<option value="">${escapeHtml(placeholder)}</option>`);
  options.forEach((option) => {
    html.push(`<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`);
  });
  select.innerHTML = html.join("");
  if (previous && [...select.options].some((option) => option.value === previous)) {
    select.value = previous;
  }
}

function renderBudget() {
  const functions = uniqueOptions(FUNCTIONS, state.expenses.map((item) => item.function));
  const categories = uniqueOptions(CATEGORIES, state.expenses.map((item) => item.category));
  fillSelect(document.getElementById("budget-function"), functions, null, "All functions");
  fillSelect(document.getElementById("budget-category"), categories, null, "All categories");

  const query = document.getElementById("budget-search").value.trim().toLowerCase();
  const fn = document.getElementById("budget-function").value;
  const category = document.getElementById("budget-category").value;
  const status = document.getElementById("budget-status").value;
  const filtered = state.expenses.filter((expense) => {
    const itemStatus = getStatus(expense).key;
    const haystack = [
      expense.expense,
      expense.vendor,
      expense.vendorPhone,
      expense.contactPerson,
      expense.category,
      expense.function,
      expense.notes
    ].join(" ").toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (fn && expense.function !== fn) return false;
    if (category && expense.category !== category) return false;
    if (status && itemStatus !== status) return false;
    return true;
  });

  const bookedCount = state.expenses.filter((expense) => num(expense.bookingValue) > 0).length;
  document.getElementById("budget-meta").textContent = state.expenses.length
    ? `${filtered.length} shown · ${state.expenses.length} expenses · ${bookedCount} booked`
    : "";

  const empty = document.getElementById("budget-empty");
  const tableWrap = document.getElementById("budget-table-wrap");
  const cards = document.getElementById("budget-cards");

  if (!filtered.length) {
    tableWrap.hidden = true;
    cards.hidden = true;
    empty.hidden = false;
    empty.innerHTML = state.expenses.length
      ? `<span class="empty-emoji">🔍</span><p>No expenses found.</p><button type="button" class="linkish" id="budget-clear-empty">Clear Filters</button>`
      : `<span class="empty-emoji">🌸</span><p>No expenses in the sheet yet.</p><button type="button" class="linkish" data-action="add-expense">Add your first expense</button>`;
    return;
  }

  empty.hidden = true;
  tableWrap.hidden = false;
  cards.hidden = false;

  document.getElementById("budget-body").innerHTML = filtered.map(expenseRow).join("");
  cards.innerHTML = filtered.map(expenseCard).join("");
}

function expenseRow(expense) {
  const status = getStatus(expense);
  const remaining = getDisplayRemaining(expense);
  const paid = getTotalPaid(expense);
  const contact = [expense.contactPerson, expense.vendorPhone].filter(Boolean).join(" · ");
  const vendorCell = expense.vendor
    ? `<span class="expense-name">${escapeHtml(expense.vendor)}</span>${contact ? `<span class="sub">${escapeHtml(contact)}</span>` : ""}`
    : dash(contact || "");
  return `
    <tr class="is-clickable" data-action="view-expense" data-id="${escapeHtml(expense.id)}">
      <td><span class="expense-name">${escapeHtml(expense.expense)}</span></td>
      <td>${vendorCell}</td>
      <td>${escapeHtml(expense.category)}</td>
      <td>${escapeHtml(expense.function)}</td>
      <td class="num">${formatCurrency(expense.bookingValue)}</td>
      <td class="num">${formatCurrency(expense.advancePaid)}</td>
      <td class="num" title="Paid ${escapeHtml(formatCurrency(paid))}">${formatCurrency(remaining)}</td>
      <td>${statusBadge(status)}</td>
      <td>${dash(expense.notes)}</td>
      <td>${actionButtons("expense", expense.id)}</td>
    </tr>
  `;
}

function expenseCard(expense) {
  const status = getStatus(expense);
  return `
    <article class="item-card is-clickable" data-action="view-expense" data-id="${escapeHtml(expense.id)}">
      <div class="item-card-top">
        <div>
          <span class="expense-name">${escapeHtml(expense.expense)}</span>
          <span class="sub">${escapeHtml(expense.category)} · ${escapeHtml(expense.function)}</span>
          ${expense.vendor ? `<span class="sub">Vendor: ${escapeHtml(expense.vendor)}</span>` : ""}
          ${expense.vendorPhone ? `<span class="sub">${formatPhone(expense.vendorPhone)}</span>` : ""}
          ${expense.notes ? `<span class="note">${escapeHtml(expense.notes)}</span>` : ""}
        </div>
        ${statusBadge(status)}
      </div>
      <div class="metrics">
        <div><span>Booking</span><strong>${formatCurrency(expense.bookingValue)}</strong></div>
        <div><span>Advance</span><strong>${formatCurrency(expense.advancePaid)}</strong></div>
        <div><span>Paid Total</span><strong>${formatCurrency(getTotalPaid(expense))}</strong></div>
        <div><span>Remaining</span><strong>${formatCurrency(getDisplayRemaining(expense))}</strong></div>
      </div>
      ${actionButtons("expense", expense.id)}
    </article>
  `;
}

function openBudgetDetail(id) {
  const expense = getExpense(id);
  if (!expense) return;
  const status = getStatus(expense);
  const paid = getTotalPaid(expense);
  const remaining = getDisplayRemaining(expense);
  const payments = getLinkedPayments(expense.id)
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));

  document.getElementById("budget-detail-title").textContent = expense.expense || "Expense";
  document.getElementById("budget-detail-body").innerHTML = `
    <section class="detail-section">
      <h3>Booking</h3>
      <div class="detail-grid">
        <div><span>Category</span><strong>${escapeHtml(expense.category || "—")}</strong></div>
        <div><span>Function</span><strong>${escapeHtml(expense.function || "—")}</strong></div>
        <div><span>Vendor</span><strong>${escapeHtml(expense.vendor || "—")}</strong></div>
        <div><span>Contact</span><strong>${escapeHtml(expense.contactPerson || "—")}</strong></div>
        <div><span>Phone</span><strong>${expense.vendorPhone ? escapeHtml(formatPhone(expense.vendorPhone)) : "—"}</strong></div>
        <div><span>Status</span><strong>${statusBadge(status)}</strong></div>
        <div><span>Booking amount</span><strong>${formatCurrency(expense.bookingValue)}</strong></div>
        <div><span>Advance (field)</span><strong>${formatCurrency(expense.advancePaid)}</strong></div>
        <div><span>Total paid</span><strong>${formatCurrency(paid)}</strong></div>
        <div><span>Remaining</span><strong>${formatCurrency(remaining)}</strong></div>
        <div class="wide"><span>Remarks</span><strong>${escapeHtml(expense.notes || "—")}</strong></div>
        <div class="wide"><span>Created</span><strong>${escapeHtml(expense.createdAt ? String(expense.createdAt).slice(0, 10) : "—")}</strong></div>
      </div>
    </section>
    <section class="detail-section">
      <h3>Payment History</h3>
      <div class="payment-history">
        ${payments.length ? payments.map((payment) => `
          <article class="payment-history-item">
            <div class="row">
              <strong>${formatCurrency(payment.amount)}</strong>
              <span>${escapeHtml(payment.date || "—")}</span>
            </div>
            <span class="sub">${escapeHtml(payment.mode || "—")}${payment.reference ? ` · ${escapeHtml(payment.reference)}` : ""}</span>
            ${payment.vendor ? `<span class="sub">${escapeHtml(payment.vendor)}</span>` : ""}
            ${payment.notes ? `<span class="sub">${escapeHtml(payment.notes)}</span>` : ""}
          </article>
        `).join("") : `<p class="hint">No payments recorded for this booking yet.</p>`}
      </div>
    </section>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" data-action="edit-expense" data-id="${escapeHtml(expense.id)}">Edit</button>
      <button type="button" class="btn btn-primary" data-action="add-payment" data-expense-id="${escapeHtml(expense.id)}">Add Payment</button>
    </div>
  `;

  const drawer = document.getElementById("budget-detail");
  drawer.dataset.expenseId = expense.id;
  drawer.hidden = false;
  document.body.classList.add("modal-open");
}

function closeBudgetDetail() {
  const drawer = document.getElementById("budget-detail");
  if (!drawer || drawer.hidden) return;
  drawer.hidden = true;
  delete drawer.dataset.expenseId;
  if (document.getElementById("form-modal").hidden && document.getElementById("confirm-modal").hidden) {
    document.body.classList.remove("modal-open");
  }
}

function renderPayments() {
  const resolved = state.payments.map(resolvePayment);
  const functions = uniqueOptions(FUNCTIONS, resolved.map((item) => item.functionName));
  const categories = uniqueOptions(CATEGORIES, resolved.map((item) => item.category).concat(state.expenses.map((item) => item.category)));
  fillSelect(document.getElementById("payment-function"), functions, null, "All functions");
  fillSelect(document.getElementById("payment-category"), categories, null, "All categories");

  const query = document.getElementById("payment-search").value.trim().toLowerCase();
  const fn = document.getElementById("payment-function").value;
  const category = document.getElementById("payment-category").value;
  const filtered = resolved
    .filter((payment) => {
      const haystack = [payment.expenseName, payment.vendor, payment.reference, payment.notes].join(" ").toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (fn && payment.functionName !== fn) return false;
      if (category && payment.category !== category) return false;
      return true;
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));

  const totalShown = filtered.reduce((sum, payment) => sum + num(payment.amount), 0);
  document.getElementById("payment-meta").textContent = state.payments.length
    ? `${filtered.length} shown · ${formatCurrency(totalShown)}`
    : "";

  const empty = document.getElementById("payment-empty");
  const tableWrap = document.getElementById("payment-table-wrap");
  const cards = document.getElementById("payment-cards");

  if (!filtered.length) {
    tableWrap.hidden = true;
    cards.hidden = true;
    empty.hidden = false;
    empty.innerHTML = state.payments.length
      ? `<span class="empty-emoji">🔍</span><p>No payments match your search.</p><button type="button" class="linkish" id="payment-clear-empty">Clear Filters</button>`
      : `<span class="empty-emoji">💸</span><p>No payments recorded in the sheet yet.</p>`;
    return;
  }

  empty.hidden = true;
  tableWrap.hidden = false;
  cards.hidden = false;
  document.getElementById("payment-body").innerHTML = filtered.map(paymentRow).join("");
  cards.innerHTML = filtered.map(paymentCard).join("");
}

function paymentRow(payment) {
  return `
    <tr data-id="${escapeHtml(payment.id)}">
      <td>${escapeHtml(formatDate(payment.date))}</td>
      <td>${escapeHtml(payment.expenseName)}</td>
      <td>${dash(payment.functionName)}</td>
      <td>${dash(payment.vendor)}</td>
      <td class="num">${formatCurrency(payment.amount)}</td>
      <td>${escapeHtml(payment.mode)}</td>
      <td>${dash(payment.reference)}</td>
      <td>${dash(payment.notes)}</td>
      <td>${actionButtons("payment", payment.id)}</td>
    </tr>
  `;
}

function paymentCard(payment) {
  return `
    <article class="item-card" data-id="${escapeHtml(payment.id)}">
      <div class="item-card-top">
        <div>
          <span class="expense-name">${escapeHtml(payment.expenseName)}</span>
          <span class="sub">${escapeHtml(formatDate(payment.date))} · ${escapeHtml(payment.functionName || "—")}</span>
        </div>
        <strong class="num">${formatCurrency(payment.amount)}</strong>
      </div>
      <div class="metrics">
        <div><span>Vendor / Person</span><strong>${dash(payment.vendor)}</strong></div>
        <div><span>Mode</span><strong>${escapeHtml(payment.mode)}</strong></div>
        <div><span>Reference</span><strong>${dash(payment.reference)}</strong></div>
        <div><span>Notes</span><strong>${dash(payment.notes)}</strong></div>
      </div>
      ${actionButtons("payment", payment.id)}
    </article>
  `;
}

function renderGuests() {
  fillSelect(document.getElementById("guest-function"), GUEST_FUNCTIONS, null, "All functions");

  const query = document.getElementById("guest-search").value.trim().toLowerCase();
  const fn = document.getElementById("guest-function").value;
  const side = document.getElementById("guest-side-filter").value;
  const rsvp = document.getElementById("guest-rsvp-filter").value;

  const filtered = state.guests
    .filter((guest) => {
      const haystack = [
        guest.name,
        guest.phone,
        guest.phoneAlt,
        guest.city,
        guest.address,
        guest.relation,
        guest.notes,
        guest.functions.join(" ")
      ].join(" ").toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (fn && !guest.functions.includes(fn)) return false;
      if (side && guest.side !== side) return false;
      if (rsvp && guest.rsvp !== rsvp) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const people = filtered.reduce((sum, guest) => sum + guestPeople(guest), 0);
  const confirmed = filtered.filter((guest) => guest.rsvp === "Confirmed").reduce((sum, guest) => sum + guestPeople(guest), 0);
  document.getElementById("guest-meta").textContent = state.guests.length
    ? `${filtered.length} shown · ${people} people · ${confirmed} confirmed`
    : "";

  const empty = document.getElementById("guest-empty");
  const tableWrap = document.getElementById("guest-table-wrap");
  const cards = document.getElementById("guest-cards");

  if (!filtered.length) {
    tableWrap.hidden = true;
    cards.hidden = true;
    empty.hidden = false;
    empty.innerHTML = state.guests.length
      ? `<span class="empty-emoji">🔍</span><p>No guests found.</p><button type="button" class="linkish" id="guest-clear-empty">Clear Filters</button>`
      : `<span class="empty-emoji">🥂</span><p>No guests in the sheet yet.</p><button type="button" class="linkish" data-action="add-guest">Add your first guest</button>`;
    return;
  }

  empty.hidden = true;
  tableWrap.hidden = false;
  cards.hidden = false;
  document.getElementById("guest-body").innerHTML = filtered.map(guestRow).join("");
  cards.innerHTML = filtered.map(guestCard).join("");
}

function guestRow(guest) {
  const stayTravel = [
    guest.stay !== "No" ? `Stay: ${guest.stay}` : "",
    guest.travel !== "No" ? `Travel: ${guest.travel}` : ""
  ].filter(Boolean).join(" · ") || "—";
  return `
    <tr data-id="${escapeHtml(guest.id)}">
      <td>
        <span class="expense-name">${escapeHtml(guest.name)}</span>
        ${guest.city ? `<span class="sub">${escapeHtml(guest.city)}</span>` : ""}
      </td>
      <td>${formatPhone(guest.phone)}${guest.phoneAlt ? `<span class="sub">${formatPhone(guest.phoneAlt)}</span>` : ""}</td>
      <td>${chips(guest.functions)}</td>
      <td>${escapeHtml(guest.side)}</td>
      <td>${escapeHtml(guest.relation)}</td>
      <td class="num">${guestPeople(guest)}<span class="sub">${guest.adults}A · ${guest.children}C</span></td>
      <td>${rsvpBadge(guest.rsvp)}</td>
      <td>${escapeHtml(stayTravel)}</td>
      <td>${dash(guest.notes)}</td>
      <td>${actionButtons("guest", guest.id)}</td>
    </tr>
  `;
}

function guestCard(guest) {
  return `
    <article class="item-card" data-id="${escapeHtml(guest.id)}">
      <div class="item-card-top">
        <div>
          <span class="expense-name">${escapeHtml(guest.name)}</span>
          <span class="sub">${escapeHtml(guest.side)} · ${escapeHtml(guest.relation)}${guest.city ? " · " + escapeHtml(guest.city) : ""}</span>
          ${chips(guest.functions)}
          ${guest.notes ? `<span class="note">${escapeHtml(guest.notes)}</span>` : ""}
        </div>
        ${rsvpBadge(guest.rsvp)}
      </div>
      <div class="metrics">
        <div><span>Phone</span><strong>${formatPhone(guest.phone)}</strong></div>
        <div><span>People</span><strong>${guestPeople(guest)} (${guest.adults}A · ${guest.children}C)</strong></div>
        <div><span>Stay</span><strong>${escapeHtml(guest.stay)}</strong></div>
        <div><span>Travel</span><strong>${escapeHtml(guest.travel)}</strong></div>
      </div>
      ${actionButtons("guest", guest.id)}
    </article>
  `;
}

function actionButtons(type, id) {
  const whatsapp = type === "guest"
    ? whatsappButton("whatsapp-guest", { id })
    : "";
  return `
    <div class="actions">
      ${whatsapp}
      <button type="button" data-action="edit-${type}" data-id="${escapeHtml(id)}">Edit</button>
      <button type="button" class="danger" data-action="delete-${type}" data-id="${escapeHtml(id)}">Delete</button>
    </div>
  `;
}

function whatsappIcon(size) {
  const s = size || 16;
  return `<svg class="wa-icon" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><path fill="currentColor" d="M12.04 2C6.58 2 2.15 6.43 2.15 11.89c0 1.96.52 3.8 1.44 5.42L2 22l4.85-1.55a9.86 9.86 0 0 0 5.19 1.44h.01c5.46 0 9.89-4.43 9.89-9.89C21.94 6.43 17.5 2 12.04 2zm5.75 14.08c-.24.68-1.4 1.25-1.93 1.33-.49.07-1.12.1-1.81-.11-.42-.13-.96-.31-1.66-.61-2.92-1.26-4.82-4.2-4.97-4.39-.14-.19-1.18-1.57-1.18-3 0-1.42.75-2.12 1.01-2.41.27-.29.58-.36.78-.36h.56c.18 0 .42-.07.66.5.24.59.82 2.01.89 2.16.07.15.12.32.02.51-.1.2-.15.32-.3.5-.15.17-.31.39-.44.52-.15.15-.3.31-.13.6.17.29.76 1.25 1.63 2.03 1.12 1 2.07 1.31 2.36 1.46.29.15.46.12.63-.07.17-.2.73-.85.93-1.14.2-.29.39-.24.66-.15.27.1 1.72.81 2.02.96.29.15.49.22.56.34.08.13.08.74-.16 1.42z"/></svg>`;
}

function whatsappButton(action, attrs) {
  const extra = Object.keys(attrs || {}).map((key) => `data-${key}="${escapeHtml(String(attrs[key]))}"`).join(" ");
  return `<button type="button" class="btn-wa" data-action="${escapeHtml(action)}" ${extra}>${whatsappIcon(16)} WhatsApp</button>`;
}

/* Invitations + WhatsApp */

function getVendorInviteMap() {
  try {
    const raw = state.settings && state.settings.vendorInvites;
    if (!raw) return {};
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (ignored) {
    return {};
  }
}

function setVendorInvite(expenseId, cardKey, status) {
  const map = getVendorInviteMap();
  const current = map[expenseId] && typeof map[expenseId] === "object" ? map[expenseId] : {};
  current[cardKey] = status;
  map[expenseId] = current;
  state.settings.vendorInvites = JSON.stringify(map);
}

function getVendorInviteStatus(expenseId, cardKey) {
  const map = getVendorInviteMap();
  const row = map[expenseId];
  return row && INVITE_STATUSES.includes(row[cardKey]) ? row[cardKey] : "Not Sent";
}

function normalizeWhatsAppPhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) digits = "91" + digits;
  if (digits.length === 11 && digits.startsWith("0")) digits = "91" + digits.slice(1);
  return digits;
}

function rsvpPageUrl(guestId) {
  const url = new URL("rsvp.html", window.location.href);
  if (guestId) url.searchParams.set("g", guestId);
  return url.href;
}

function inviteMessageFor(contact, cardKey) {
  const isEngagement = cardKey === "engagement";
  const couple = String((state.settings && state.settings.coupleNames) || "").trim() || "Aman & Aakansha";
  const when = settingValue(isEngagement ? "engagementDate" : "weddingDate", "");
  const name = String(contact.name || "").trim() || "Ji";
  const occasionEn = isEngagement ? "Engagement Celebration" : "Wedding Celebration";
  const occasionHi = isEngagement ? "सगाई समारोह" : "विवाह समारोह";
  const stepLine = isEngagement
    ? "bless the couple as they take their first step towards a lifetime of togetherness"
    : "bless the couple as they begin their sacred journey of marriage";
  const rsvp = contact.kind === "guest" ? rsvpPageUrl(contact.id) : "";

  return [
    `🌸🙏 *Namaste ${name},* 🙏🌸`,
    ``,
    `With immense joy and heartfelt gratitude, we are delighted to share a very special moment of our lives with you. 💕✨`,
    ``,
    `💍 *${couple}* 💍`,
    `are beginning a beautiful new chapter together, and it would mean so much to us to have your _blessings_ and presence on this auspicious occasion. 🥰🙏`,
    ``,
    `🌺 *हमारे जीवन के इस शुभ और खूबसूरत अवसर पर आपका आशीर्वाद हमारे लिए सबसे अनमोल उपहार होगा।*`,
    `आपकी गरिमामयी उपस्थिति हमारे *${occasionHi}* की खुशियों को और भी खास बना देगी। ❤️`,
    ``,
    when ? `📅 *Date:* ${when}` : null,
    `💑 *Celebration:* ${couple}'s ${occasionEn}`,
    ``,
    `We warmly invite you to celebrate this beautiful beginning with us and ${stepLine}. 💞🌿`,
    ``,
    `🌸 आप सादर आमंत्रित हैं। कृपया अपना बहुमूल्य समय निकालकर हमें अपने आशीर्वाद से अनुग्रहित करें। 🌸`,
    ``,
    rsvp ? `📩 *Kindly RSVP here:*` : `🙏 We look forward to celebrating with you.`,
    rsvp || null,
    ``,
    `💌 Invitation card is also being shared with you here on WhatsApp.`,
    ``,
    `🙏✨ आपका आशीर्वाद और स्नेह हमारे लिए सदैव विशेष रहेगा। ✨🙏`,
    ``,
    `_With love & warm regards,_`,
    `*${couple}* 💕💍`
  ].filter((line) => line !== null).join("\n");
}

function listInviteContacts() {
  const guests = state.guests.map((guest) => ({
    id: guest.id,
    kind: "guest",
    name: guest.name,
    phone: guest.phone || guest.phoneAlt,
    secondary: guest.functions.join(", "),
    rsvp: guest.rsvp,
    inviteEngagement: guest.inviteEngagement || "Not Sent",
    inviteWedding: guest.inviteWedding || "Not Sent"
  }));

  const vendors = [];
  const seen = new Set();
  state.expenses.forEach((expense) => {
    const phone = expense.vendorPhone || "";
    const name = expense.vendor || expense.contactPerson || expense.expense;
    if (!phone || !name) return;
    const key = normalizeWhatsAppPhone(phone) + "|" + name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    vendors.push({
      id: expense.id,
      kind: "vendor",
      name,
      phone,
      secondary: expense.expense,
      rsvp: "—",
      inviteEngagement: getVendorInviteStatus(expense.id, "engagement"),
      inviteWedding: getVendorInviteStatus(expense.id, "wedding")
    });
  });

  return guests.concat(vendors);
}

function inviteSent(contact, cardKey) {
  return cardKey === "engagement" ? contact.inviteEngagement === "Sent" : contact.inviteWedding === "Sent";
}

function calculateInviteStats() {
  const contacts = listInviteContacts().filter((item) => item.kind === "guest");
  const total = contacts.length;
  const engagementSent = contacts.filter((item) => item.inviteEngagement === "Sent").length;
  const weddingSent = contacts.filter((item) => item.inviteWedding === "Sent").length;
  const rsvpDone = contacts.filter((item) => ["Confirmed", "Maybe", "Declined"].includes(item.rsvp)).length;
  const inviteSentCount = contacts.filter((item) => item.rsvp !== "Not Invited" || item.inviteEngagement === "Sent" || item.inviteWedding === "Sent").length;
  return {
    total,
    engagementSent,
    engagementRemaining: Math.max(0, total - engagementSent),
    weddingSent,
    weddingRemaining: Math.max(0, total - weddingSent),
    inviteSentCount,
    inviteRemaining: Math.max(0, total - inviteSentCount),
    rsvpDone,
    rsvpPending: Math.max(0, total - rsvpDone)
  };
}

function resolveCardUrl(cardKey) {
  const card = INVITE_CARDS[cardKey];
  if (!card) return Promise.resolve("");
  if (inviteShareState.resolved[cardKey]) return Promise.resolve(inviteShareState.resolved[cardKey]);

  const tryFile = (index) => new Promise((resolve) => {
    if (index >= card.files.length) {
      resolve("");
      return;
    }
    const path = card.files[index];
    const img = new Image();
    img.onload = () => resolve(path);
    img.onerror = () => tryFile(index + 1).then(resolve);
    img.src = encodeURI(path) + (path.includes("?") ? "&" : "?") + "v=3";
  });

  return tryFile(0).then((path) => {
    inviteShareState.resolved[cardKey] = path;
    return path;
  });
}

async function renderInviteCardPreview() {
  const target = document.getElementById("invite-card-preview");
  if (!target) return;
  const parts = [];
  for (const key of Object.keys(INVITE_CARDS)) {
    const card = INVITE_CARDS[key];
    const url = await resolveCardUrl(key);
    parts.push(`
      <article class="invite-preview">
        <div class="invite-preview-art">${url ? `<img src="${escapeHtml(encodeURI(url))}" alt="${escapeHtml(card.label)} invitation card">` : `<div class="invite-missing">Add ${escapeHtml(card.label)} PNG card</div>`}</div>
        <strong>${escapeHtml(card.label)}</strong>
      </article>
    `);
  }
  target.innerHTML = parts.join("");
}

function renderInvitations() {
  const statsTarget = document.getElementById("invite-stats");
  if (!statsTarget) return;
  const stats = calculateInviteStats();
  statsTarget.innerHTML = [
    ["Guests", stats.total, "On invite list"],
    ["Engagement sent", stats.engagementSent, `${stats.engagementRemaining} remaining`],
    ["Wedding sent", stats.weddingSent, `${stats.weddingRemaining} remaining`],
    ["RSVP in", stats.rsvpDone, `${stats.rsvpPending} awaiting reply`]
  ].map(([label, value, note]) => `
    <article class="stat">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(String(value))}</div>
      <div class="stat-note">${escapeHtml(note)}</div>
    </article>
  `).join("");

  renderInviteCardPreview();

  const query = (document.getElementById("invite-search") && document.getElementById("invite-search").value || "").trim().toLowerCase();
  const type = (document.getElementById("invite-type-filter") && document.getElementById("invite-type-filter").value) || "";
  const card = (document.getElementById("invite-card-filter") && document.getElementById("invite-card-filter").value) || "";
  const status = (document.getElementById("invite-status-filter") && document.getElementById("invite-status-filter").value) || "";
  const contacts = listInviteContacts().filter((item) => {
    const haystack = [item.name, item.phone, item.secondary, item.kind].join(" ").toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (type && item.kind !== type) return false;
    if (card === "engagement" && status === "pending" && item.inviteEngagement === "Sent") return false;
    if (card === "wedding" && status === "pending" && item.inviteWedding === "Sent") return false;
    if (card === "engagement" && status === "sent" && item.inviteEngagement !== "Sent") return false;
    if (card === "wedding" && status === "sent" && item.inviteWedding !== "Sent") return false;
    if (!card && status === "pending" && item.inviteEngagement === "Sent" && item.inviteWedding === "Sent") return false;
    if (!card && status === "sent" && item.inviteEngagement !== "Sent" && item.inviteWedding !== "Sent") return false;
    if (status === "rsvp") {
      if (item.kind !== "guest") return false;
      if (!["Confirmed", "Maybe", "Declined"].includes(item.rsvp)) return false;
    }
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));

  document.getElementById("invite-meta").textContent = contacts.length
    ? `${contacts.length} contacts · ${stats.engagementSent}/${stats.total} engagement · ${stats.weddingSent}/${stats.total} wedding`
    : "";

  const empty = document.getElementById("invite-empty");
  const tableWrap = document.getElementById("invite-table-wrap");
  const cards = document.getElementById("invite-cards");
  if (!contacts.length) {
    tableWrap.hidden = true;
    cards.hidden = true;
    empty.hidden = false;
    empty.innerHTML = `<span class="empty-emoji">💌</span><p>No matching contacts with phone numbers yet.</p>`;
    return;
  }
  empty.hidden = true;
  tableWrap.hidden = false;
  cards.hidden = false;
  document.getElementById("invite-body").innerHTML = contacts.map(inviteRow).join("");
  cards.innerHTML = contacts.map(inviteCard).join("");
}

function inviteStatusChip(status) {
  const sent = status === "Sent";
  return `<span class="badge badge-${sent ? "paid" : "not-booked"}">${escapeHtml(status)}</span>`;
}

function inviteRow(contact) {
  return `
    <tr data-id="${escapeHtml(contact.id)}">
      <td>
        <span class="expense-name">${escapeHtml(contact.name)}</span>
        ${contact.secondary ? `<span class="sub">${escapeHtml(contact.secondary)}</span>` : ""}
      </td>
      <td>${escapeHtml(contact.kind === "guest" ? "Guest" : "Vendor")}</td>
      <td>${formatPhone(contact.phone)}</td>
      <td>${inviteStatusChip(contact.inviteEngagement)}</td>
      <td>${inviteStatusChip(contact.inviteWedding)}</td>
      <td>${contact.kind === "guest" ? rsvpBadge(contact.rsvp) : "—"}</td>
      <td>
        <div class="actions">
          <button type="button" data-action="whatsapp-contact" data-kind="${escapeHtml(contact.kind)}" data-id="${escapeHtml(contact.id)}" class="btn-wa">${whatsappIcon(16)} WhatsApp</button>
        </div>
      </td>
    </tr>
  `;
}

function inviteCard(contact) {
  return `
    <article class="item-card" data-id="${escapeHtml(contact.id)}">
      <div class="item-card-top">
        <div>
          <span class="expense-name">${escapeHtml(contact.name)}</span>
          <span class="sub">${escapeHtml(contact.kind === "guest" ? "Guest" : "Vendor")} · ${escapeHtml(contact.phone || "No phone")}</span>
        </div>
        ${contact.kind === "guest" ? rsvpBadge(contact.rsvp) : ""}
      </div>
      <div class="metrics">
        <div><span>Engagement</span><strong>${escapeHtml(contact.inviteEngagement)}</strong></div>
        <div><span>Wedding</span><strong>${escapeHtml(contact.inviteWedding)}</strong></div>
      </div>
      <div class="actions">
        ${whatsappButton("whatsapp-contact", { kind: contact.kind, id: contact.id })}
      </div>
    </article>
  `;
}

async function openInviteShareModal(kind, id, preferredCard) {
  let contact = null;
  if (kind === "guest") {
    const guest = getGuest(id);
    if (!guest) return;
    contact = {
      id: guest.id,
      kind: "guest",
      name: guest.name,
      phone: guest.phone || guest.phoneAlt,
      inviteEngagement: guest.inviteEngagement,
      inviteWedding: guest.inviteWedding
    };
  } else {
    const expense = getExpense(id);
    if (!expense) return;
    contact = {
      id: expense.id,
      kind: "vendor",
      name: expense.vendor || expense.contactPerson || expense.expense,
      phone: expense.vendorPhone,
      inviteEngagement: getVendorInviteStatus(expense.id, "engagement"),
      inviteWedding: getVendorInviteStatus(expense.id, "wedding")
    };
  }

  if (!normalizeWhatsAppPhone(contact.phone)) {
    showToast("Add a phone number before sharing on WhatsApp");
    return;
  }

  inviteShareState.contact = contact;
  inviteShareState.cardKey = preferredCard || (contact.inviteEngagement === "Sent" ? "wedding" : "engagement");
  const error = document.getElementById("invite-error");
  if (error) error.hidden = true;
  document.getElementById("invite-modal-title").textContent = `Share with ${contact.name}`;
  document.getElementById("invite-modal-subtitle").textContent = `WhatsApp · ${contact.phone}`;
  await renderInvitePickGrid();
  document.getElementById("invite-message").value = inviteMessageFor(contact, inviteShareState.cardKey);
  document.getElementById("invite-modal").hidden = false;
  document.body.classList.add("modal-open");
}

async function renderInvitePickGrid() {
  const grid = document.getElementById("invite-pick-grid");
  const parts = [];
  for (const key of Object.keys(INVITE_CARDS)) {
    const card = INVITE_CARDS[key];
    const url = await resolveCardUrl(key);
    if (key === inviteShareState.cardKey) inviteShareState.cardUrl = url;
    const selected = key === inviteShareState.cardKey ? "is-selected" : "";
    parts.push(`
      <button type="button" class="invite-pick ${selected}" data-action="pick-invite-card" data-card="${escapeHtml(key)}">
        <span class="invite-pick-art">${url ? `<img src="${escapeHtml(encodeURI(url))}" alt="">` : "No PNG card"}</span>
        <strong>${escapeHtml(card.label)}</strong>
        <span class="sub">${inviteSent(inviteShareState.contact, key) ? "Already sent" : "Not sent yet"}</span>
      </button>
    `);
  }
  grid.innerHTML = parts.join("");
}

function closeInviteModal() {
  const modal = document.getElementById("invite-modal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  if (document.getElementById("form-modal").hidden && document.getElementById("confirm-modal").hidden) {
    const detail = document.getElementById("budget-detail");
    if (!detail || detail.hidden) document.body.classList.remove("modal-open");
  }
}

async function markInviteSent(contact, cardKey) {
  if (!contact) return false;
  if (contact.kind === "guest") {
    const guest = getGuest(contact.id);
    if (!guest) return false;
    if (cardKey === "engagement") guest.inviteEngagement = "Sent";
    else guest.inviteWedding = "Sent";
    if (guest.rsvp === "Not Invited") guest.rsvp = "Invite Sent";
  } else {
    setVendorInvite(contact.id, cardKey, "Sent");
  }
  render();
  return saveData();
}

async function blobToPngBlob(blob) {
  if (blob.type === "image/png") return blob;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load invitation card."));
      img.src = objectUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    canvas.getContext("2d").drawImage(image, 0, 0);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("Could not prepare invitation card.");
    return png;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function copyInviteCardToClipboard(cardUrl) {
  if (!cardUrl || !navigator.clipboard || !window.ClipboardItem) {
    throw new Error("Clipboard image copy is not supported in this browser.");
  }
  const response = await fetch(encodeURI(cardUrl));
  if (!response.ok) throw new Error("Could not load invitation card.");
  const pngBlob = await blobToPngBlob(await response.blob());
  await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
}

function openWhatsAppTab(phone, message) {
  const waUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
  const waLink = document.createElement("a");
  waLink.href = waUrl;
  waLink.target = "_blank";
  waLink.rel = "noopener noreferrer";
  document.body.appendChild(waLink);
  waLink.click();
  waLink.remove();
  return waUrl;
}

async function openWhatsAppShare() {
  const contact = inviteShareState.contact;
  const cardKey = inviteShareState.cardKey;
  const error = document.getElementById("invite-error");
  if (!contact) return;
  const phone = normalizeWhatsAppPhone(contact.phone);
  if (!phone) {
    error.hidden = false;
    error.textContent = "Valid phone number required.";
    return;
  }

  const message = document.getElementById("invite-message").value.trim() || inviteMessageFor(contact, cardKey);
  const cardUrl = inviteShareState.cardUrl || await resolveCardUrl(cardKey);
  error.hidden = true;

  let imageCopied = false;
  if (cardUrl) {
    try {
      await copyInviteCardToClipboard(cardUrl);
      imageCopied = true;
    } catch (copyError) {
      const download = document.createElement("a");
      download.href = encodeURI(cardUrl);
      download.download = `${cardKey}-invitation.png`;
      document.body.appendChild(download);
      download.click();
      download.remove();
    }
  }

  openWhatsAppTab(phone, message);
  await markInviteSent(contact, cardKey);
  closeInviteModal();

  if (imageCopied) {
    showToast("WhatsApp opened · card copied — press Ctrl+V in the chat to paste the image");
  } else if (cardUrl) {
    showToast("WhatsApp opened · card downloaded — attach the PNG in the chat");
  } else {
    showToast("WhatsApp opened · marked sent");
  }
}

async function downloadSelectedInviteCard() {
  const cardUrl = inviteShareState.cardUrl || await resolveCardUrl(inviteShareState.cardKey);
  if (!cardUrl) {
    showToast("Add the card file in the invitations folder first");
    return;
  }
  const link = document.createElement("a");
  link.href = encodeURI(cardUrl);
  link.download = `${inviteShareState.cardKey}-invitation.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function copyRsvpHomeLink() {
  const url = rsvpPageUrl("");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => showToast("RSVP page link copied")).catch(() => showToast(url));
  } else {
    showToast(url);
  }
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab;
  });
}

/* Modals */

let lastFocus = null;

function openModal(which) {
  const modal = document.getElementById("form-modal");
  const dialog = modal.querySelector(".modal-dialog");
  lastFocus = document.activeElement;
  document.getElementById("expense-form").hidden = which !== "expense";
  document.getElementById("payment-form").hidden = which !== "payment";
  document.getElementById("guest-form").hidden = which !== "guest";
  dialog.classList.toggle("wide", which === "guest" || which === "expense");
  modal.hidden = false;
  document.body.classList.add("modal-open");
  document.getElementById("app").setAttribute("aria-hidden", "true");
  const focusTarget = which === "expense"
    ? document.getElementById("expense-name")
    : which === "guest"
      ? document.getElementById("guest-name")
      : document.getElementById("payment-date");
  window.setTimeout(() => focusTarget.focus(), 0);
}

function closeModal() {
  document.getElementById("form-modal").hidden = true;
  document.getElementById("expense-form").reset();
  document.getElementById("payment-form").reset();
  document.getElementById("guest-form").reset();
  clearFormError("expense");
  clearFormError("payment");
  clearFormError("guest");
  if (document.getElementById("confirm-modal").hidden && document.getElementById("invite-modal").hidden) {
    const detail = document.getElementById("budget-detail");
    if (!detail || detail.hidden) {
      document.body.classList.remove("modal-open");
      document.getElementById("app").removeAttribute("aria-hidden");
    }
  }
  if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
}

function setFormError(which, message) {
  const el = document.getElementById(which + "-error");
  el.textContent = message;
  el.hidden = !message;
}

function clearFormError(which) {
  setFormError(which, "");
}

function fillChoice(select, options, current) {
  const known = options.some((option) => option.toLowerCase() === String(current || "").toLowerCase());
  const values = current && !known ? options.concat(current) : options.slice();
  select.innerHTML = values.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("")
    + `<option value="${OTHER}">Other</option>`;
  if (current && known) {
    const match = options.find((option) => option.toLowerCase() === current.toLowerCase());
    select.value = match || current;
  } else if (current) {
    select.value = current;
  }
}

function toggleCustom(selectId, wrapId) {
  const wrap = document.getElementById(wrapId);
  wrap.hidden = document.getElementById(selectId).value !== OTHER;
}

function openExpenseModal(id) {
  const expense = id ? getExpense(id) : null;
  if (id && !expense) return;

  const form = document.getElementById("expense-form");
  form.dataset.id = expense ? expense.id : "";
  document.getElementById("expense-modal-title").textContent = expense ? "Edit Expense" : "Add Expense";
  document.querySelector("#form-modal .modal-dialog").setAttribute("aria-labelledby", "expense-modal-title");

  const categories = uniqueOptions(CATEGORIES, state.expenses.map((item) => item.category));
  const functions = uniqueOptions(FUNCTIONS, state.expenses.map((item) => item.function));
  fillChoice(document.getElementById("expense-category"), categories, expense ? expense.category : "Miscellaneous");
  fillChoice(document.getElementById("expense-function"), functions, expense ? expense.function : "Common / All Functions");
  document.getElementById("expense-category-custom").value = "";
  document.getElementById("expense-function-custom").value = "";
  document.getElementById("expense-category-custom-wrap").hidden = true;
  document.getElementById("expense-function-custom-wrap").hidden = true;

  document.getElementById("expense-name").value = expense ? expense.expense : "";
  document.getElementById("expense-vendor").value = expense ? expense.vendor : "";
  document.getElementById("expense-vendor-phone").value = expense ? expense.vendorPhone : "";
  document.getElementById("expense-contact").value = expense ? expense.contactPerson : "";
  document.getElementById("expense-booking").value = expense ? String(expense.bookingValue) : "";
  document.getElementById("expense-advance").value = expense ? String(expense.advancePaid) : "";
  document.getElementById("expense-notes").value = expense ? expense.notes : "";
  clearFormError("expense");
  openModal("expense");
}

function chosenValue(selectId, customId) {
  const select = document.getElementById(selectId);
  if (select.value !== OTHER) return select.value.trim();
  return document.getElementById(customId).value.trim();
}

function readAmounts(ids) {
  const values = {};
  for (const id of ids) {
    const parsed = parseAmount(document.getElementById(id).value);
    if (Number.isNaN(parsed) || parsed < 0) return { error: "Amounts cannot be negative or include letters." };
    values[id] = parsed;
  }
  return { values };
}

async function saveExpense(event) {
  event.preventDefault();
  clearFormError("expense");
  const name = document.getElementById("expense-name").value.trim();
  const category = chosenValue("expense-category", "expense-category-custom");
  const fn = chosenValue("expense-function", "expense-function-custom");
  const amounts = readAmounts(["expense-booking", "expense-advance"]);

  if (!name) {
    setFormError("expense", "Expense name is required.");
    document.getElementById("expense-name").focus();
    return;
  }
  if (!category) {
    setFormError("expense", "Enter a category.");
    document.getElementById("expense-category-custom").focus();
    return;
  }
  if (!fn) {
    setFormError("expense", "Enter a function.");
    document.getElementById("expense-function-custom").focus();
    return;
  }
  if (amounts.error) {
    setFormError("expense", "Amounts cannot be negative.");
    return;
  }

  const payload = {
    expense: name,
    category,
    function: fn,
    bookingValue: amounts.values["expense-booking"],
    advancePaid: amounts.values["expense-advance"],
    vendor: document.getElementById("expense-vendor").value.trim(),
    vendorPhone: document.getElementById("expense-vendor-phone").value.trim(),
    contactPerson: document.getElementById("expense-contact").value.trim(),
    notes: document.getElementById("expense-notes").value.trim()
  };

  const id = document.getElementById("expense-form").dataset.id;
  let savedId = id;
  state.pendingWrite = true;
  if (id) {
    const current = getExpense(id);
    if (!current) {
      state.pendingWrite = false;
      return;
    }
    Object.assign(current, payload);
    ensureAdvancePayment(current);
  } else {
    savedId = uid("exp");
    const created = { id: savedId, ...payload, createdAt: new Date().toISOString() };
    state.expenses.push(created);
    ensureAdvancePayment(created);
  }

  closeModal();
  switchTab("budget");
  render();
  const ok = await saveData();
  if (ok) {
    showToast(id ? "Expense updated" : "Expense added");
    highlight(savedId);
  }
}

function openPaymentModal(id, preferredExpenseId) {
  if (!state.expenses.length) {
    showToast("Add an expense before recording a payment.");
    return;
  }

  const payment = id ? state.payments.find((item) => item.id === id) : null;
  if (id && !payment) return;

  const form = document.getElementById("payment-form");
  form.dataset.id = payment ? payment.id : "";
  document.getElementById("payment-modal-title").textContent = payment ? "Edit Payment" : "Add Payment";
  document.querySelector("#form-modal .modal-dialog").setAttribute("aria-labelledby", "payment-modal-title");

  const select = document.getElementById("payment-expense");
  const sorted = state.expenses.slice().sort((a, b) => a.expense.localeCompare(b.expense));
  select.innerHTML = sorted.map((expense) => {
    const label = `${expense.expense} — ${expense.function}`;
    return `<option value="${escapeHtml(expense.id)}">${escapeHtml(label)}</option>`;
  }).join("");

  document.getElementById("payment-mode").innerHTML = PAYMENT_MODES
    .map((mode) => `<option value="${escapeHtml(mode)}">${escapeHtml(mode)}</option>`)
    .join("");

  document.getElementById("payment-date").value = payment ? payment.date : todayISO();
  document.getElementById("payment-amount").value = payment ? String(payment.amount) : "";
  document.getElementById("payment-vendor").value = payment ? payment.vendor : "";
  document.getElementById("payment-reference").value = payment ? payment.reference : "";
  document.getElementById("payment-notes").value = payment ? payment.notes : "";
  document.getElementById("payment-mode").value = payment && PAYMENT_MODES.includes(payment.mode) ? payment.mode : "Cash";
  if (payment && sorted.some((expense) => expense.id === payment.expenseId)) {
    select.value = payment.expenseId;
  } else if (!payment) {
    const preferred = preferredExpenseId && sorted.find((expense) => expense.id === preferredExpenseId);
    const firstWithVendor = preferred || sorted.find((expense) => expense.vendor) || sorted[0];
    if (firstWithVendor) {
      select.value = firstWithVendor.id;
      document.getElementById("payment-vendor").value = firstWithVendor.vendor || "";
    }
  }
  clearFormError("payment");
  openModal("payment");
}

function savePayment(event) {
  event.preventDefault();
  clearFormError("payment");
  const date = document.getElementById("payment-date").value;
  const expenseId = document.getElementById("payment-expense").value;
  const expense = getExpense(expenseId);
  const amount = parseAmount(document.getElementById("payment-amount").value);

  if (!date) {
    setFormError("payment", "Date is required.");
    document.getElementById("payment-date").focus();
    return;
  }
  if (!expense) {
    setFormError("payment", "Choose an expense.");
    return;
  }
  if (Number.isNaN(amount) || amount < 0) {
    setFormError("payment", "Amounts cannot be negative.");
    return;
  }
  if (amount <= 0) {
    setFormError("payment", "Enter an amount greater than zero.");
    document.getElementById("payment-amount").focus();
    return;
  }

  const payload = {
    expenseId: expense.id,
    expenseName: expense.expense,
    functionName: expense.function,
    category: expense.category,
    date,
    amount,
    mode: document.getElementById("payment-mode").value,
    vendor: document.getElementById("payment-vendor").value.trim() || expense.vendor,
    reference: document.getElementById("payment-reference").value.trim(),
    notes: document.getElementById("payment-notes").value.trim()
  };

  const id = document.getElementById("payment-form").dataset.id;
  let savedId = id;
  state.pendingWrite = true;
  if (id) {
    const current = state.payments.find((item) => item.id === id);
    if (!current) {
      state.pendingWrite = false;
      return;
    }
    Object.assign(current, payload);
    syncAdvanceFromPayment(current);
  } else {
    savedId = uid("pay");
    state.payments.push({ id: savedId, ...payload, createdAt: new Date().toISOString() });
  }

  closeModal();
  switchTab("payments");
  render();
  saveData().then((ok) => {
    if (ok) {
      showToast(id ? "Payment updated" : "Payment recorded");
      highlight(savedId);
    }
  });
}

function renderGuestFunctionChecks(selected) {
  const chosen = new Set(selected || []);
  document.getElementById("guest-functions").innerHTML = GUEST_FUNCTIONS.map((fn) => `
    <label>
      <input type="checkbox" name="guest-function" value="${escapeHtml(fn)}" ${chosen.has(fn) ? "checked" : ""}>
      <span>${escapeHtml(fn)}</span>
    </label>
  `).join("");
}

function updateGuestPeoplePreview() {
  const adults = Math.max(0, Math.round(num(document.getElementById("guest-adults").value)));
  const children = Math.max(0, Math.round(num(document.getElementById("guest-children").value)));
  document.getElementById("guest-people-preview").value = String(adults + children);
}

function openGuestModal(id) {
  const guest = id ? getGuest(id) : null;
  if (id && !guest) return;

  const form = document.getElementById("guest-form");
  form.dataset.id = guest ? guest.id : "";
  document.getElementById("guest-modal-title").textContent = guest ? "Edit Guest" : "Add Guest";
  document.querySelector("#form-modal .modal-dialog").setAttribute("aria-labelledby", "guest-modal-title");

  fillSelect(document.getElementById("guest-relation"), uniqueOptions(GUEST_RELATIONS, state.guests.map((item) => item.relation)), guest ? guest.relation : "Family");
  renderGuestFunctionChecks(guest ? guest.functions : ["Wedding"]);

  document.getElementById("guest-name").value = guest ? guest.name : "";
  document.getElementById("guest-phone").value = guest ? guest.phone : "";
  document.getElementById("guest-phone-alt").value = guest ? guest.phoneAlt : "";
  document.getElementById("guest-side").value = guest ? guest.side : "Groom";
  document.getElementById("guest-city").value = guest ? guest.city : "";
  document.getElementById("guest-address").value = guest ? guest.address : "";
  document.getElementById("guest-adults").value = guest ? String(guest.adults) : "1";
  document.getElementById("guest-children").value = guest ? String(guest.children) : "0";
  document.getElementById("guest-rsvp").value = guest ? guest.rsvp : "Not Invited";
  document.getElementById("guest-stay").value = guest ? guest.stay : "No";
  document.getElementById("guest-travel").value = guest ? guest.travel : "No";
  document.getElementById("guest-notes").value = guest ? guest.notes : "";
  updateGuestPeoplePreview();
  clearFormError("guest");
  openModal("guest");
}

function saveGuest(event) {
  event.preventDefault();
  clearFormError("guest");
  const name = document.getElementById("guest-name").value.trim();
  const functions = [...document.querySelectorAll('input[name="guest-function"]:checked')].map((input) => input.value);
  const adults = Math.max(0, Math.round(num(document.getElementById("guest-adults").value)));
  const children = Math.max(0, Math.round(num(document.getElementById("guest-children").value)));

  if (!name) {
    setFormError("guest", "Guest name is required.");
    document.getElementById("guest-name").focus();
    return;
  }
  if (!functions.length) {
    setFormError("guest", "Select at least one function type (Engagement, Wedding, etc.).");
    return;
  }
  if (adults + children <= 0) {
    setFormError("guest", "Add at least one adult or child.");
    document.getElementById("guest-adults").focus();
    return;
  }

  const payload = {
    name,
    phone: document.getElementById("guest-phone").value.trim(),
    phoneAlt: document.getElementById("guest-phone-alt").value.trim(),
    functions,
    side: document.getElementById("guest-side").value,
    relation: document.getElementById("guest-relation").value,
    city: document.getElementById("guest-city").value.trim(),
    address: document.getElementById("guest-address").value.trim(),
    adults,
    children,
    rsvp: document.getElementById("guest-rsvp").value,
    stay: document.getElementById("guest-stay").value,
    travel: document.getElementById("guest-travel").value,
    notes: document.getElementById("guest-notes").value.trim()
  };

  const id = document.getElementById("guest-form").dataset.id;
  let savedId = id;
  state.pendingWrite = true;
  if (id) {
    const current = getGuest(id);
    if (!current) {
      state.pendingWrite = false;
      return;
    }
    Object.assign(current, payload);
  } else {
    savedId = uid("gst");
    state.guests.push({
      id: savedId,
      ...payload,
      inviteEngagement: "Not Sent",
      inviteWedding: "Not Sent",
      createdAt: new Date().toISOString()
    });
  }

  closeModal();
  switchTab("guests");
  render();
  saveData().then((ok) => {
    if (ok) {
      showToast(id ? "Guest updated" : "Guest added");
      highlight(savedId);
    }
  });
}

function highlight(id) {
  window.setTimeout(() => {
    const nodes = [...document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)];
    const visible = nodes.find((el) => el.offsetParent !== null) || nodes[0];
    if (!visible) return;
    visible.classList.add("is-highlight");
    visible.scrollIntoView({ block: "nearest" });
    window.setTimeout(() => visible.classList.remove("is-highlight"), 1600);
  }, 0);
}

/* Deletes, export, import */

function confirmAction({ title, message, detail, confirmLabel, danger }) {
  return new Promise((resolve) => {
    confirmState.resolve = resolve;
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-message").textContent = message;
    const detailEl = document.getElementById("confirm-detail");
    detailEl.textContent = detail || "";
    detailEl.hidden = !detail;
    const ok = document.getElementById("confirm-ok");
    ok.textContent = confirmLabel || "Delete";
    ok.className = danger === false ? "btn btn-primary" : "btn btn-danger";
    document.getElementById("confirm-modal").hidden = false;
    document.body.classList.add("modal-open");
    window.setTimeout(() => document.getElementById("confirm-cancel").focus(), 0);
  });
}

function closeConfirm(result) {
  document.getElementById("confirm-modal").hidden = true;
  if (document.getElementById("form-modal").hidden) {
    document.body.classList.remove("modal-open");
  }
  const resolve = confirmState.resolve;
  confirmState.resolve = null;
  if (resolve) resolve(result);
}

async function deleteExpense(id) {
  const expense = getExpense(id);
  if (!expense) return;
  const linked = getLinkedPayments(id);
  let message = `Delete “${expense.expense}”? This cannot be undone.`;
  let detail = "";
  let confirmLabel = "Delete";
  if (linked.length) {
    message = "This expense has payments linked to it.";
    detail = "Deleting it may affect your payment records. The advance saved on this expense will be removed. Linked payments will be kept.";
    confirmLabel = "Delete Anyway";
  }
  const ok = await confirmAction({
    title: "Delete expense?",
    message,
    detail,
    confirmLabel
  });
  if (!ok) return;
  await mutateDelete("expenses", id, "Expense deleted");
}

async function deletePayment(id) {
  const payment = state.payments.find((item) => item.id === id);
  if (!payment) return;
  const resolved = resolvePayment(payment);
  const ok = await confirmAction({
    title: "Delete payment?",
    message: `Delete this ${formatCurrency(payment.amount)} payment for ${resolved.expenseName}?`,
    detail: "Totals will update immediately.",
    confirmLabel: "Delete"
  });
  if (!ok) return;
  const expense = getExpense(payment.expenseId);
  const advanceRow = expense ? findAdvancePayment(expense.id) : null;
  const wasAdvance = Boolean(advanceRow && advanceRow.id === payment.id);
  const deleted = await mutateDelete("payments", id, "Payment deleted");
  if (deleted && wasAdvance) {
    const current = getExpense(payment.expenseId);
    if (current) {
      current.advancePaid = 0;
      await saveData();
      render();
    }
  }
}

async function deleteGuest(id) {
  const guest = getGuest(id);
  if (!guest) return;
  const ok = await confirmAction({
    title: "Delete guest?",
    message: `Delete “${guest.name}” from the guest list?`,
    detail: "This cannot be undone.",
    confirmLabel: "Delete"
  });
  if (!ok) return;
  await mutateDelete("guests", id, "Guest deleted");
}

function exportData() {
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    expenses: state.expenses,
    payments: state.payments,
    guests: state.guests,
    settings: state.settings
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `wedding-expenses-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Data exported");
}

function requestImport() {
  document.getElementById("import-file").click();
}

async function handleImport(file) {
  const input = document.getElementById("import-file");
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.expenses) || !Array.isArray(data.payments)) {
      showToast("That file is not a valid export.");
      return;
    }
    if (state.expenses.length || state.payments.length || state.guests.length) {
      const ok = await confirmAction({
        title: "Import data?",
        message: "Import will replace all expenses, payments, and guests in Google Sheets.",
        confirmLabel: "Import",
        danger: false
      });
      if (!ok) return;
    }
    state.pendingWrite = true;
    state.expenses = data.expenses.map(sanitizeExpense).filter(Boolean);
    state.payments = data.payments.map(sanitizePayment).filter(Boolean);
    state.guests = Array.isArray(data.guests) ? data.guests.map(sanitizeGuest).filter(Boolean) : [];
    state.settings = { initialized: true, ...(data.settings && typeof data.settings === "object" ? data.settings : {}) };
    reconcileAdvancePayments();
    render();
    const saved = await saveData();
    if (saved) showToast("Data imported to Google Sheet");
  } catch (err) {
    showToast("That file is not a valid export.");
  } finally {
    input.value = "";
  }
}

async function clearAllData() {
  const ok = await confirmAction({
    title: "Clear all data?",
    message: "This will permanently delete all expenses, payments, and guests in Google Sheets.",
    detail: "This cannot be undone.",
    confirmLabel: "Clear All Data"
  });
  if (!ok) return;
  state.pendingWrite = true;
  state.expenses = [];
  state.payments = [];
  state.guests = [];
  state.settings = { initialized: true, clearedAt: new Date().toISOString() };
  clearFilters("budget");
  clearFilters("payment");
  clearFilters("guest");
  switchTab("dashboard");
  render();
  const saved = await saveData();
  if (saved) showToast("Google Sheet cleared");
}

function clearFilters(which) {
  if (which === "budget") {
    document.getElementById("budget-search").value = "";
    document.getElementById("budget-function").value = "";
    document.getElementById("budget-category").value = "";
    document.getElementById("budget-status").value = "";
    renderBudget();
    return;
  }
  if (which === "guest") {
    document.getElementById("guest-search").value = "";
    document.getElementById("guest-function").value = "";
    document.getElementById("guest-side-filter").value = "";
    document.getElementById("guest-rsvp-filter").value = "";
    renderGuests();
    return;
  }
  document.getElementById("payment-search").value = "";
  document.getElementById("payment-function").value = "";
  document.getElementById("payment-category").value = "";
  renderPayments();
}

function showToast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.getElementById("toasts").appendChild(el);
  window.setTimeout(() => el.remove(), 2800);
}

function toggleSettings(force) {
  const menu = document.getElementById("settings-menu");
  const button = document.getElementById("settings-btn");
  const open = typeof force === "boolean" ? force : menu.hidden;
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}

function viewPendingInBudget() {
  switchTab("budget");
  document.getElementById("budget-search").value = "";
  document.getElementById("budget-function").value = "";
  document.getElementById("budget-category").value = "";
  document.getElementById("budget-status").value = "advance";
  renderBudget();
}

function viewEventInBudget(eventName) {
  switchTab("budget");
  renderBudget();
  document.getElementById("budget-search").value = "";
  document.getElementById("budget-function").value = eventName;
  document.getElementById("budget-category").value = "";
  document.getElementById("budget-status").value = "";
  renderBudget();
}

function onClick(event) {
  const button = event.target.closest("[data-action], [data-tab], #budget-clear, #payment-clear, #guest-clear, #invite-clear, #budget-clear-empty, #payment-clear-empty, #guest-clear-empty, #view-pending");
  if (!button) {
    if (!event.target.closest(".settings")) toggleSettings(false);
    return;
  }

  if (button.dataset.tab) {
    switchTab(button.dataset.tab);
    return;
  }

  if (button.id === "budget-clear" || button.id === "budget-clear-empty") {
    clearFilters("budget");
    return;
  }
  if (button.id === "payment-clear" || button.id === "payment-clear-empty") {
    clearFilters("payment");
    return;
  }
  if (button.id === "guest-clear" || button.id === "guest-clear-empty") {
    clearFilters("guest");
    return;
  }
  if (button.id === "invite-clear") {
    document.getElementById("invite-search").value = "";
    document.getElementById("invite-type-filter").value = "";
    document.getElementById("invite-card-filter").value = "";
    document.getElementById("invite-status-filter").value = "";
    renderInvitations();
    return;
  }
  if (button.id === "view-pending") {
    viewPendingInBudget();
    return;
  }

  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === "add-expense") openExpenseModal();
  if (action === "edit-expense") {
    closeBudgetDetail();
    openExpenseModal(id);
  }
  if (action === "view-expense") openBudgetDetail(id);
  if (action === "close-budget-detail") closeBudgetDetail();
  if (action === "delete-expense") deleteExpense(id);
  if (action === "add-payment") {
    closeBudgetDetail();
    openPaymentModal(null, button.dataset.expenseId || "");
  }
  if (action === "edit-payment") openPaymentModal(id);
  if (action === "delete-payment") deletePayment(id);
  if (action === "add-guest") openGuestModal();
  if (action === "edit-guest") openGuestModal(id);
  if (action === "delete-guest") deleteGuest(id);
  if (action === "whatsapp-guest") openInviteShareModal("guest", id);
  if (action === "whatsapp-contact") openInviteShareModal(button.dataset.kind || "guest", id);
  if (action === "close-invite-modal") closeInviteModal();
  if (action === "pick-invite-card") {
    inviteShareState.cardKey = button.dataset.card || "engagement";
    resolveCardUrl(inviteShareState.cardKey).then((url) => {
      inviteShareState.cardUrl = url;
      renderInvitePickGrid();
      if (inviteShareState.contact) {
        document.getElementById("invite-message").value = inviteMessageFor(inviteShareState.contact, inviteShareState.cardKey);
      }
    });
  }
  if (action === "open-whatsapp-share") openWhatsAppShare();
  if (action === "download-invite-card") downloadSelectedInviteCard();
  if (action === "copy-rsvp-home") copyRsvpHomeLink();
  if (action === "close-modal") closeModal();
  if (action === "export") {
    toggleSettings(false);
    exportData();
  }
  if (action === "import") {
    toggleSettings(false);
    requestImport();
  }
  if (action === "configure-sync") {
    toggleSettings(false);
    configureSync();
  }
  if (action === "sync") {
    toggleSettings(false);
    pullFromSheet().then((ok) => showToast(ok ? "Loaded latest sheet data" : "Could not load from Google Sheet"));
  }
  if (action === "view-event") viewEventInBudget(button.dataset.event || "");
  if (action === "clear") {
    toggleSettings(false);
    clearAllData();
  }
}

function onKeydown(event) {
  if (event.key !== "Escape") return;
  if (!document.getElementById("confirm-modal").hidden) {
    closeConfirm(false);
    return;
  }
  if (!document.getElementById("invite-modal").hidden) {
    closeInviteModal();
    return;
  }
  if (!document.getElementById("form-modal").hidden) {
    closeModal();
    return;
  }
  if (!document.getElementById("budget-detail").hidden) {
    closeBudgetDetail();
    return;
  }
  toggleSettings(false);
}

function bindEvents() {
  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeydown);

  document.getElementById("settings-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSettings();
  });

  document.getElementById("expense-form").addEventListener("submit", saveExpense);
  document.getElementById("payment-form").addEventListener("submit", savePayment);
  document.getElementById("guest-form").addEventListener("submit", saveGuest);
  document.getElementById("expense-category").addEventListener("change", () => {
    toggleCustom("expense-category", "expense-category-custom-wrap");
  });
  document.getElementById("expense-function").addEventListener("change", () => {
    toggleCustom("expense-function", "expense-function-custom-wrap");
  });
  document.getElementById("guest-adults").addEventListener("input", updateGuestPeoplePreview);
  document.getElementById("guest-children").addEventListener("input", updateGuestPeoplePreview);

  ["budget-search", "budget-function", "budget-category", "budget-status"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderBudget);
  });
  ["payment-search", "payment-function", "payment-category"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderPayments);
  });
  ["guest-search", "guest-function", "guest-side-filter", "guest-rsvp-filter"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderGuests);
  });
  ["invite-search", "invite-type-filter", "invite-card-filter", "invite-status-filter"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", renderInvitations);
  });

  document.getElementById("confirm-cancel").addEventListener("click", () => closeConfirm(false));
  document.getElementById("confirm-ok").addEventListener("click", () => closeConfirm(true));
  document.querySelector("[data-action='confirm-cancel']").addEventListener("click", () => closeConfirm(false));

  document.getElementById("import-file").addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) handleImport(file);
  });
}

function init() {
  purgeLegacyLocalStorage();
  bindEvents();
  switchTab("dashboard");
  setLoader(true);
  setSyncStatus("Loading from sheet…", false);
  pullFromSheet().then((ok) => {
    if (!ok) showToast("Could not load Google Sheet data");
  });
  window.setInterval(() => {
    if (document.hidden) return;
    if (state.busy || state.pendingWrite) return;
    pullFromSheet({ quiet: true });
  }, 12000);
}

init();
