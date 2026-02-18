// js/app.js
import { createTableModule } from "./table.js";

/* ✅ extra anti copy (mobile) */
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("dragstart", (e) => e.preventDefault());

/* ===== LOCK ZOOM ===== */
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("gesturechange", (e) => e.preventDefault());
document.addEventListener("gestureend", (e) => e.preventDefault());

/* ===== CONFIG ===== */
const HOLD_TIME = 700;
const SEAT_COUNT = 9;
const TOP_SEAT = 5;
const SEAT_SIZE = 60;
const TABLE_BORDER = 4;
const SAFE_PADDING = 8;

/* ===== BLINDS (fixed) ===== */
const SB = 25;
const BB = 50;
const BBA = 50;

/* ===== SUPABASE ===== */
const SUPABASE_URL = 'https://jttwlfsfvaiivlyiyaxz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0dHdsZnNmdmFpaXZseWl5YXh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5ODcyNTgsImV4cCI6MjA4NjU2MzI1OH0.1c6iLV7Yznzs_3gQ_dV8Br02F9jJdHWhL-Hl2iASRuQ';
const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* =====================
   MINI SOUND SYSTEM
   ===================== */
let __audioCtx = null;
function __getAudioCtx() {
  if (!__audioCtx) __audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (__audioCtx.state === "suspended") __audioCtx.resume().catch(() => {});
  return __audioCtx;
}
function __beep({ freqs = [880], type = "sine", dur = 0.08, gain = 0.035, attack = 0.005 } = {}) {
  const ctx = __getAudioCtx();
  const now = ctx.currentTime;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.connect(ctx.destination);

  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), now + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(attack + 0.01, dur));

  freqs.forEach((f) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, now);
    o.connect(g);
    o.start(now);
    o.stop(now + dur);
  });
}
const Sound = {
  tick() {
    __beep({ freqs: [1760], type: "sine", dur: 0.045, gain: 0.02, attack: 0.003 });
  },
  success() {
    __beep({ freqs: [880, 1320], type: "sine", dur: 0.09, gain: 0.03, attack: 0.004 });
  },
  reject() {
    __beep({ freqs: [220], type: "triangle", dur: 0.1, gain: 0.03, attack: 0.004 });
  },
  error() {
    __beep({ freqs: [392], type: "square", dur: 0.055, gain: 0.02, attack: 0.003 });
    setTimeout(() => __beep({ freqs: [330], type: "square", dur: 0.055, gain: 0.02, attack: 0.003 }), 85);
  },
};
window.addEventListener(
  "pointerdown",
  () => {
    __getAudioCtx();
  },
  { once: true }
);

/* ===== STATE (shared) ===== */
const state = {
  // constants
  HOLD_TIME,
  SEAT_COUNT,
  TOP_SEAT,
  SEAT_SIZE,
  TABLE_BORDER,
  SAFE_PADDING,
  SB,
  BB,
  BBA,
  structureUid: "",
  structureLevel: "",
  structureRowsByUid: {},
  structureIndexByUid: {},
  quickAddValues: [100, 500, 1000],

  // session
  isSubmitting: false,
  TABLE_UID: null,
  TABLE_NAME: null,
  tablePin: "",
  TOURNAMENT_ID: null,
  TOURNAMENT_NAME: null,
  tourPin: "",

  DEALER_UID: null,
  DEALER_NAME: null,
  dealerPin: "",

  // table
  seatState: {}, // seatState[seat] = { player_uid }
  seats: {}, // seats[seat] = { el, stakeEl, seatNoEl }
  betFloats: {}, // betFloats[seat] = { el }

  holdTimer: null,
  didHold: false,
  qrScanner: null,
  seatChannel: null,

  baseStakeByUid: {},
  stackByUid: {},
  stakeRefreshTimer: null,

  handActive: false,
  actingSeat: null,
  handStreet: "Preflop",
  handState: {},
  handHistory: [],
  betDraft: 0,
  winnerSeat: null,
  betTarget: 0,

  dealerPosSeat: 1,
  tableStateChannel: null,

  panelInited: false,
  __buttonsBound: false,
  __sliderBound: false,

  // engine internals
  __engine: {
    street: "PREFLOP", // PREFLOP|FLOP|TURN|RIVER|SHOWDOWN
    currentBet: 0,
    pot: 0,
  },
};

/* ===== DOM (app side: login buttons + modals) ===== */
const tableBtn = document.getElementById("tableBtn");
const tableBtnText = document.getElementById("tableBtnText");
const tableProgress = document.getElementById("tableProgress");

const dealerBtn = document.getElementById("dealerBtn");
const dealerBtnText = document.getElementById("dealerBtnText");
const dealerProgress = document.getElementById("dealerProgress");

const tourBtn = document.getElementById("tourBtn");
const tourBtnText = document.getElementById("tourBtnText");
const tourProgress = document.getElementById("tourProgress");

const tableModal = document.getElementById("tableModal");
const tableClose = document.getElementById("tableClose");
const tableSelect = document.getElementById("tableSelect");
const tableErrEl = document.getElementById("tableErr");

const tourModal = document.getElementById("tourModal");
const tourClose = document.getElementById("tourClose");
const tourSelect = document.getElementById("tourSelect");
const tourErrEl = document.getElementById("tourErr");

const dealerModal = document.getElementById("dealerModal");
const dealerClose = document.getElementById("dealerClose");
const dealerSelect = document.getElementById("dealerSelect");
const dealerErrEl = document.getElementById("dealerErr");

/* ===== Helpers (login gating) ===== */
function isTableLoggedIn() {
  return !!state.TABLE_UID;
}
function isTournamentLoggedIn() {
  return !!state.TOURNAMENT_ID;
}
function isDealerLoggedIn() {
  return !!state.DEALER_UID;
}

function setDots(containerId, len) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  wrap.querySelectorAll(".pin-dot").forEach((d, i) => d.classList.toggle("filled", i < len));
}

function setTableUI() {
  if (isTableLoggedIn()) {
    tableBtn.classList.remove("red", "gray");
    tableBtn.classList.add("green");
    tableBtnText.textContent = state.TABLE_NAME || state.TABLE_UID || "Table";
  } else {
    tableBtn.classList.remove("green", "gray");
    tableBtn.classList.add("red");
    tableBtnText.textContent = "Table Login";
  }
}

function setDealerUI() {
  if (!isTableLoggedIn() || !isTournamentLoggedIn()) {
    dealerBtn.classList.remove("green", "red");
    dealerBtn.classList.add("gray");
    dealerBtnText.textContent = !isTableLoggedIn() ? "Table Login" : "Tour Login";
    return;
  }
  if (isDealerLoggedIn()) {
    dealerBtn.classList.remove("red", "gray");
    dealerBtn.classList.add("green");
    dealerBtnText.textContent = state.DEALER_NAME || state.DEALER_UID || "Dealer";
  } else {
    dealerBtn.classList.remove("green", "gray");
    dealerBtn.classList.add("red");
    dealerBtnText.textContent = "Dealer Login";
  }
}

function setTourUI() {
  if (!isTableLoggedIn()) {
    tourBtn.classList.remove("green", "red");
    tourBtn.classList.add("gray");
    tourBtnText.textContent = "Table Login";
    return;
  }
  if (isTournamentLoggedIn()) {
    tourBtn.classList.remove("red", "gray");
    tourBtn.classList.add("green");
    tourBtnText.textContent = state.TOURNAMENT_NAME || state.TOURNAMENT_ID || "Tournament";
  } else {
    tourBtn.classList.remove("green", "gray");
    tourBtn.classList.add("red");
    tourBtnText.textContent = "Tour Login";
  }
}

function openTableModal() {
  tableModal.style.display = "flex";
  resetTableModalUI();
  loadTablesForModal();
}
function closeTableModal() {
  tableModal.style.display = "none";
  resetTableModalUI();
}
function resetTableModalUI() {
  tableSelect.value = "";
  tableSelect.innerHTML = `<option value="">Loading…</option>`;
  state.tablePin = "";
  setDots("tablePinDots", 0);
  tableErrEl.style.display = "none";
}
tableClose.addEventListener("click", closeTableModal);
tableModal.addEventListener("click", (e) => {
  if (e.target === tableModal) closeTableModal();
});

function openTourModal() {
  if (!requireTable()) return;
  tourModal.style.display = "flex";
  resetTourModalUI();
  loadTournamentsForModal();
}
function closeTourModal() {
  tourModal.style.display = "none";
  resetTourModalUI();
}
function resetTourModalUI() {
  tourSelect.value = "";
  tourSelect.innerHTML = `<option value="">Loadingâ€¦</option>`;
  state.tourPin = "";
  setDots("tourPinDots", 0);
  tourErrEl.style.display = "none";
}
tourClose.addEventListener("click", closeTourModal);
tourModal.addEventListener("click", (e) => {
  if (e.target === tourModal) closeTourModal();
});

function openDealerModal() {
  if (!requireTournament()) return;
  dealerModal.style.display = "flex";
  resetDealerModalUI();
  loadDealersForModal();
}
function closeDealerModal() {
  dealerModal.style.display = "none";
  resetDealerModalUI();
}
function resetDealerModalUI() {
  dealerSelect.value = "";
  dealerSelect.innerHTML = `<option value="">Loading…</option>`;
  state.dealerPin = "";
  setDots("dealerPinDots", 0);
  dealerErrEl.style.display = "none";
}
dealerClose.addEventListener("click", closeDealerModal);
dealerModal.addEventListener("click", (e) => {
  if (e.target === dealerModal) closeDealerModal();
});

function requireTable() {
  if (isTableLoggedIn()) return true;
  alert("Table login required");
  openTableModal();
  return false;
}
function requireTournament() {
  if (!requireTable()) return false;
  if (isTournamentLoggedIn()) return true;
  alert("Tour login required");
  openTourModal();
  return false;
}
function requireDealer() {
  if (!requireTournament()) return false;
  if (isDealerLoggedIn()) return true;
  alert("Dealer login required");
  openDealerModal();
  return false;
}

/* ===== create table module ===== */
const table = createTableModule({
  state,
  sbClient,
  Sound,
  requireDealer,
  requireTable,
});

table.init();

/* ===== expose for table module if needed later ===== */
function dealerLogout() {
  state.DEALER_UID = null;
  state.DEALER_NAME = null;
  localStorage.removeItem("dealer_uid");
  localStorage.removeItem("dealer_name");
  setDealerUI();
  table.resetHandState();
  table.updateUI();
}

function tourLogout() {
  state.TOURNAMENT_ID = null;
  state.TOURNAMENT_NAME = null;
  localStorage.removeItem("tournament_id");
  localStorage.removeItem("tournament_name");
  Object.keys(state.baseStakeByUid).forEach((k) => delete state.baseStakeByUid[k]);
  Object.keys(state.stackByUid).forEach((k) => delete state.stackByUid[k]);
  dealerLogout();
  setTourUI();
}

/* ===== TABLE MODAL keypad (must be global for onclick) ===== */
window.tablePress = function tablePress(n) {
  if (!tableSelect.value) {
    Sound.error();
    tableErrEl.style.display = "block";
    tableErrEl.textContent = "❌ Select table first";
    return;
  }
  tableErrEl.style.display = "none";
  if (state.tablePin.length >= 4) return;
  state.tablePin += String(n);
  setDots("tablePinDots", state.tablePin.length);
  if (state.tablePin.length === 4) window.submitTableLogin();
};

window.tableBack = function tableBack() {
  tableErrEl.style.display = "none";
  state.tablePin = state.tablePin.slice(0, -1);
  setDots("tablePinDots", state.tablePin.length);
};

async function loadTablesForModal() {
  try {
    const { data, error } = await sbClient.from("tables").select("table_uid, table_name").eq("active", true).order("table_uid");

    if (error) {
      console.error("loadTables error:", error);
      tableSelect.innerHTML = `<option value="">Load failed</option>`;
      return;
    }

    const rows = data || [];
    tableSelect.innerHTML =
      `<option value="">— Select table —</option>` +
      rows
        .map((t) => {
          const name = String(t.table_name || "").trim();
          const label = name ? name : String(t.table_uid);
          return `<option value="${String(t.table_uid)}">${label}</option>`;
        })
        .join("");

    if (!rows.length) {
      tableSelect.innerHTML = `<option value="">No active tables</option>`;
    }
  } catch (e) {
    console.error("loadTables exception:", e);
    tableSelect.innerHTML = `<option value="">Load failed</option>`;
  }
}

window.submitTableLogin = async function submitTableLogin() {
  const tableUid = tableSelect.value;
  if (!tableUid) return;
  if (state.tablePin.length !== 4) return;

  const { data, error } = await sbClient.from("tables").select("table_uid, table_name, pin_hash, active").eq("table_uid", tableUid).single();

  if (error || !data) {
    Sound.error();
    tableErrEl.textContent = "❌ Table not found";
    tableErrEl.style.display = "block";
    state.tablePin = "";
    setDots("tablePinDots", 0);
    return;
  }
  if (!data.active) {
    Sound.error();
    tableErrEl.textContent = "❌ Table locked";
    tableErrEl.style.display = "block";
    state.tablePin = "";
    setDots("tablePinDots", 0);
    return;
  }
  if (String(data.pin_hash) !== state.tablePin) {
    Sound.error();
    tableErrEl.textContent = "❌ Wrong PIN";
    tableErrEl.style.display = "block";
    state.tablePin = "";
    setDots("tablePinDots", 0);
    return;
  }

  if (state.TABLE_UID && state.TABLE_UID !== data.table_uid) {
    tourLogout();
  }

  state.TABLE_UID = data.table_uid;
  state.TABLE_NAME = (data.table_name || "").trim() || data.table_uid;

  localStorage.setItem("table_uid", state.TABLE_UID);
  localStorage.setItem("table_name", state.TABLE_NAME);

  setTableUI();
  setTourUI();
  setDealerUI();
  await table.startTableSession();
  closeTableModal();
};

/* ===== TOUR MODAL keypad (must be global for onclick) ===== */
window.tourPress = function tourPress(n) {
  if (!requireTable()) return;
  if (!tourSelect.value) {
    Sound.error();
    tourErrEl.style.display = "block";
    tourErrEl.textContent = "Select tournament first";
    return;
  }
  tourErrEl.style.display = "none";
  if (state.tourPin.length >= 4) return;
  state.tourPin += String(n);
  setDots("tourPinDots", state.tourPin.length);
  if (state.tourPin.length === 4) window.submitTourLogin();
};

window.tourBack = function tourBack() {
  tourErrEl.style.display = "none";
  state.tourPin = state.tourPin.slice(0, -1);
  setDots("tourPinDots", state.tourPin.length);
};

async function loadTournamentsForModal() {
  try {
    const { data, error } = await sbClient.from("tournaments").select("tournament_id").order("tournament_id", { ascending: true });
    if (error) {
      console.error("loadTournaments error:", error);
      tourSelect.innerHTML = `<option value="">Load failed</option>`;
      return;
    }
    const rows = data || [];
    if (!rows.length) {
      tourSelect.innerHTML = `<option value="">No tournaments</option>`;
      return;
    }
    tourSelect.innerHTML =
      `<option value=""> -Select Tournament- </option>` +
      rows.map((r) => `<option value="${String(r.tournament_id)}">${String(r.tournament_id)}</option>`).join("");
  } catch (e) {
    console.error("loadTournaments exception:", e);
    tourSelect.innerHTML = `<option value="">Load failed</option>`;
  }
}

window.submitTourLogin = async function submitTourLogin() {
  if (!requireTable()) return;
  const tournamentId = tourSelect.value;
  if (!tournamentId) return;
  if (state.tourPin.length !== 4) return;

  const { data, error } = await sbClient
    .from("tournaments")
    .select("tournament_id, pin")
    .eq("tournament_id", tournamentId)
    .single();

  if (error || !data) {
    Sound.error();
    tourErrEl.textContent = "âŒ Tournament not found";
    tourErrEl.style.display = "block";
    state.tourPin = "";
    setDots("tourPinDots", 0);
    return;
  }

  if (String(data.pin ?? "") !== String(state.tourPin)) {
    Sound.error();
    tourErrEl.textContent = "âŒ Wrong PIN";
    tourErrEl.style.display = "block";
    state.tourPin = "";
    setDots("tourPinDots", 0);
    return;
  }

  if (state.TOURNAMENT_ID && state.TOURNAMENT_ID !== String(data.tournament_id)) {
    dealerLogout();
  }

  state.TOURNAMENT_ID = String(data.tournament_id);
  state.TOURNAMENT_NAME = String(data.tournament_id);
  localStorage.setItem("tournament_id", state.TOURNAMENT_ID);
  localStorage.setItem("tournament_name", state.TOURNAMENT_NAME);
  Object.keys(state.baseStakeByUid).forEach((k) => delete state.baseStakeByUid[k]);
  Object.keys(state.stackByUid).forEach((k) => delete state.stackByUid[k]);
  await table.refreshStakesForOccupiedSeats();

  setTourUI();
  setDealerUI();
  closeTourModal();
};

/* ===== DEALER MODAL keypad (must be global for onclick) ===== */
window.dealerPress = function dealerPress(n) {
  if (!requireTournament()) return;

  if (!dealerSelect.value) {
    Sound.error();
    dealerErrEl.style.display = "block";
    dealerErrEl.textContent = "❌ Select dealer first";
    return;
  }
  dealerErrEl.style.display = "none";

  if (state.dealerPin.length >= 4) return;
  state.dealerPin += String(n);
  setDots("dealerPinDots", state.dealerPin.length);

  if (state.dealerPin.length === 4) window.submitDealerLogin();
};

window.dealerBack = function dealerBack() {
  dealerErrEl.style.display = "none";
  state.dealerPin = state.dealerPin.slice(0, -1);
  setDots("dealerPinDots", state.dealerPin.length);
};

async function loadDealersForModal() {
  const { data, error } = await sbClient
    .from("dealers")
    .select("dealer_uid, dealer_name")
    .order("dealer_name", { ascending: true });
  if (error) {
    console.error(error);
    dealerSelect.innerHTML = `<option value="">Load failed</option>`;
    return;
  }
  const rows = data || [];
  if (!rows.length) {
    dealerSelect.innerHTML = `<option value="">No dealers</option>`;
    return;
  }
  dealerSelect.innerHTML =
    `<option value="">— Select your name —</option>` + rows.map((d) => `<option value="${String(d.dealer_uid)}">${String(d.dealer_name || "")}</option>`).join("");
}

window.submitDealerLogin = async function submitDealerLogin() {
  if (!requireTournament()) return;
  if (!dealerSelect.value) return;
  if (state.dealerPin.length !== 4) return;

  const { data, error } = await sbClient
    .from("dealers")
    .select("dealer_uid, dealer_name, dealer_pin")
    .eq("dealer_uid", dealerSelect.value)
    .single();

  if (error) {
    console.error(error);
    Sound.error();
    dealerErrEl.textContent = "❌ Verify failed";
    dealerErrEl.style.display = "block";
    state.dealerPin = "";
    setDots("dealerPinDots", 0);
    return;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (row && String(row.dealer_pin ?? "") === String(state.dealerPin)) {
    state.DEALER_UID = row.dealer_uid;
    state.DEALER_NAME = row.dealer_name;

    localStorage.setItem("dealer_uid", state.DEALER_UID);
    localStorage.setItem("dealer_name", state.DEALER_NAME);

    setDealerUI();
    closeDealerModal();

    if (!state.handActive) {
      table.startNewHandLocal();
    } else {
      table.updateUI();
    }
  } else {
    Sound.error();
    dealerErrEl.textContent = "❌ Wrong PIN";
    dealerErrEl.style.display = "block";
    state.dealerPin = "";
    setDots("dealerPinDots", 0);
  }
};

/* ===== Hold logout (Table + Dealer) ===== */
let tableHoldTimer = null;
let tableHoldStart = 0;

function startTableHold() {
  if (tableHoldTimer) return;
  tableHoldStart = performance.now();
  tableBtn.classList.add("holding");
  tableProgress.style.width = "0%";

  tableHoldTimer = setInterval(() => {
    const t = performance.now() - tableHoldStart;
    const pct = Math.min(100, (t / HOLD_TIME) * 100);
    tableProgress.style.width = pct.toFixed(0) + "%";
    if (t >= HOLD_TIME) stopTableHold(true);
  }, 16);
}
function stopTableHold(trigger = false) {
  if (tableHoldTimer) {
    clearInterval(tableHoldTimer);
    tableHoldTimer = null;
  }
  tableBtn.classList.remove("holding");
  tableProgress.style.width = "0%";

  if (trigger && isTableLoggedIn()) {
    if (confirm(`Logout table ${state.TABLE_UID}?`)) tableLogout();
  }
}

let tourHoldTimer = null;
let tourHoldStart = 0;

function startTourHold() {
  if (tourHoldTimer) return;
  tourHoldStart = performance.now();
  tourBtn.classList.add("holding");
  tourProgress.style.width = "0%";

  tourHoldTimer = setInterval(() => {
    const t = performance.now() - tourHoldStart;
    const pct = Math.min(100, (t / HOLD_TIME) * 100);
    tourProgress.style.width = pct.toFixed(0) + "%";
    if (t >= HOLD_TIME) stopTourHold(true);
  }, 16);
}
function stopTourHold(trigger = false) {
  if (tourHoldTimer) {
    clearInterval(tourHoldTimer);
    tourHoldTimer = null;
  }
  tourBtn.classList.remove("holding");
  tourProgress.style.width = "0%";

  if (trigger && isTournamentLoggedIn()) {
    if (confirm(`Logout tournament ${state.TOURNAMENT_NAME || state.TOURNAMENT_ID}?`)) tourLogout();
  }
}

let dealerHoldTimer = null;
let dealerHoldStart = 0;

function startDealerHold() {
  if (dealerHoldTimer) return;
  dealerHoldStart = performance.now();
  dealerBtn.classList.add("holding");
  dealerProgress.style.width = "0%";

  dealerHoldTimer = setInterval(() => {
    const t = performance.now() - dealerHoldStart;
    const pct = Math.min(100, (t / HOLD_TIME) * 100);
    dealerProgress.style.width = pct.toFixed(0) + "%";
    if (t >= HOLD_TIME) stopDealerHold(true);
  }, 16);
}
function stopDealerHold(trigger = false) {
  if (dealerHoldTimer) {
    clearInterval(dealerHoldTimer);
    dealerHoldTimer = null;
  }
  dealerBtn.classList.remove("holding");
  dealerProgress.style.width = "0%";

  if (trigger && isDealerLoggedIn()) {
    if (confirm(`Logout dealer ${state.DEALER_NAME}?`)) dealerLogout();
  }
}

/* bind table btn */
tableBtn.addEventListener("pointerdown", (e) => {
  if (e.button !== undefined && e.button !== 0) return;
  startTableHold();
});
tableBtn.addEventListener("pointerup", () => stopTableHold(false));
tableBtn.addEventListener("pointerleave", () => stopTableHold(false));
tableBtn.addEventListener("pointercancel", () => stopTableHold(false));
tableBtn.addEventListener("click", () => {
  if (!isTableLoggedIn()) openTableModal();
});

/* bind tour btn */
tourBtn.addEventListener("pointerdown", (e) => {
  if (e.button !== undefined && e.button !== 0) return;
  startTourHold();
});
tourBtn.addEventListener("pointerup", () => stopTourHold(false));
tourBtn.addEventListener("pointerleave", () => stopTourHold(false));
tourBtn.addEventListener("pointercancel", () => stopTourHold(false));
tourBtn.addEventListener("click", () => {
  if (!isTableLoggedIn()) return openTableModal();
  if (!isTournamentLoggedIn()) openTourModal();
});

/* bind dealer btn */
dealerBtn.addEventListener("pointerdown", (e) => {
  if (e.button !== undefined && e.button !== 0) return;
  startDealerHold();
});
dealerBtn.addEventListener("pointerup", () => stopDealerHold(false));
dealerBtn.addEventListener("pointerleave", () => stopDealerHold(false));
dealerBtn.addEventListener("pointercancel", () => stopDealerHold(false));
dealerBtn.addEventListener("click", () => {
  if (!isTableLoggedIn()) return openTableModal();
  if (!isTournamentLoggedIn()) return openTourModal();
  if (!isDealerLoggedIn()) openDealerModal();
});

/* ===== table logout ===== */
async function tableLogout() {
  if (state.seatChannel) {
    try {
      await state.seatChannel.unsubscribe();
    } catch (e) {}
    state.seatChannel = null;
  }
  if (state.tableStateChannel) {
    try {
      await state.tableStateChannel.unsubscribe();
    } catch (e) {}
    state.tableStateChannel = null;
  }

  state.TABLE_UID = null;
  state.TABLE_NAME = null;
  localStorage.removeItem("table_uid");
  localStorage.removeItem("table_name");

  tourLogout();

  for (let i = 1; i <= SEAT_COUNT; i++) {
    state.seatState[i] = { player_uid: null };
  }
  Object.keys(state.baseStakeByUid).forEach((k) => delete state.baseStakeByUid[k]);
  Object.keys(state.stackByUid).forEach((k) => delete state.stackByUid[k]);

  table.resetHandState();
  table.renderSeats();

  setTableUI();
  setTourUI();
  setDealerUI();

  setTimeout(openTableModal, 120);
}

/* ===== Restore ===== */
(async function restoreSessions() {
  table.initPanelOnce();

  const savedUid = localStorage.getItem("table_uid");
  const savedName = localStorage.getItem("table_name");

  if (savedUid) {
    state.TABLE_UID = savedUid;
    state.TABLE_NAME = savedName || savedUid;

    try {
      const { data } = await sbClient.from("tables").select("table_name").eq("table_uid", state.TABLE_UID).single();
      const name = (data?.table_name || "").trim();
      if (name) {
        state.TABLE_NAME = name;
        localStorage.setItem("table_name", state.TABLE_NAME);
      }
    } catch (e) {}

    const tid = localStorage.getItem("tournament_id");
    const tname = localStorage.getItem("tournament_name");
    if (tid) {
      state.TOURNAMENT_ID = tid;
      state.TOURNAMENT_NAME = tname || tid;
    }

    const duid = localStorage.getItem("dealer_uid");
    const dname = localStorage.getItem("dealer_name");
    if (duid && state.TOURNAMENT_ID) {
      state.DEALER_UID = duid;
      state.DEALER_NAME = dname || duid;
    }

    setTableUI();
    setTourUI();
    setDealerUI();
    table.updateUI();
    await table.startTableSession();
  } else {
    setTableUI();
    setTourUI();
    setDealerUI();
    table.updateUI();
    setTimeout(openTableModal, 120);
  }
})();


// Compatibility hook used by table.js; keep as no-op to avoid double engine logic.
window.__tourEngine = {
  init() {},
};
