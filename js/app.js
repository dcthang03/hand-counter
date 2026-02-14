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

/* ===== SUPABASE ===== */
const SUPABASE_URL = 'https://ymtmipkmknnsqleahlmi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltdG1pcGtta25uc3FsZWFobG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwOTU1MjUsImV4cCI6MjA4NTY3MTUyNX0.7pEza-TKBKJ_xqdBu93nLo-PRaHDcDIxW-bjZnrFJxw';
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

  // session
  isSubmitting: false,
  TABLE_UID: null,
  TABLE_NAME: null,
  tablePin: "",

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

const tableModal = document.getElementById("tableModal");
const tableClose = document.getElementById("tableClose");
const tableSelect = document.getElementById("tableSelect");
const tableErrEl = document.getElementById("tableErr");

const dealerModal = document.getElementById("dealerModal");
const dealerClose = document.getElementById("dealerClose");
const dealerSelect = document.getElementById("dealerSelect");
const dealerErrEl = document.getElementById("dealerErr");

/* ===== Helpers (login gating) ===== */
function isTableLoggedIn() {
  return !!state.TABLE_UID;
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
  if (!isTableLoggedIn()) {
    dealerBtn.classList.remove("green", "red");
    dealerBtn.classList.add("gray");
    dealerBtnText.textContent = "Table Login";
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

function openDealerModal() {
  if (!requireTable()) return;
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
function requireDealer() {
  if (!requireTable()) return false;
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
    dealerLogout();
  }

  state.TABLE_UID = data.table_uid;
  state.TABLE_NAME = (data.table_name || "").trim() || data.table_uid;

  localStorage.setItem("table_uid", state.TABLE_UID);
  localStorage.setItem("table_name", state.TABLE_NAME);

  setTableUI();
  setDealerUI();
  await table.startTableSession();
  closeTableModal();
};

/* ===== DEALER MODAL keypad (must be global for onclick) ===== */
window.dealerPress = function dealerPress(n) {
  if (!requireTable()) return;

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
  const { data, error } = await sbClient.rpc("list_dealers");
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
  if (!requireTable()) return;
  if (!dealerSelect.value) return;
  if (state.dealerPin.length !== 4) return;

  const { data, error } = await sbClient.rpc("verify_dealer_pin", {
    p_dealer_uid: dealerSelect.value,
    p_pin: state.dealerPin,
  });

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
  if (row?.ok) {
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

  dealerLogout();

  for (let i = 1; i <= SEAT_COUNT; i++) {
    state.seatState[i] = { player_uid: null };
  }
  Object.keys(state.baseStakeByUid).forEach((k) => delete state.baseStakeByUid[k]);
  Object.keys(state.stackByUid).forEach((k) => delete state.stackByUid[k]);

  table.resetHandState();
  table.renderSeats();

  setTableUI();
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

    const duid = localStorage.getItem("dealer_uid");
    const dname = localStorage.getItem("dealer_name");
    if (duid) {
      state.DEALER_UID = duid;
      state.DEALER_NAME = dname || duid;
    }

    setTableUI();
    setDealerUI();
    table.updateUI();
    await table.startTableSession();
  } else {
    setTableUI();
    setDealerUI();
    table.updateUI();
    setTimeout(openTableModal, 120);
  }
})();

/* =========================
   TOUR COUNTER - HAND ENGINE (INTEGRATED WITH state + table.js)
   - acting ring pulse on seat.el
   - tap seat => winner orange
   - slide locked until winner
   - call uses currentBet - streetPutIn (no fold bug)
   - auto street: PREFLOP->FLOP->TURN->RIVER
   - first-to-act: preflop next after BB; postflop next after dealer token
========================= */

/* ---------- DOM (control panel) ---------- */
const potCenter = document.getElementById("potCenter");
const potLabel = document.getElementById("potLabel");
const toCallLabel = document.getElementById("toCallLabel");
const draftLabel = document.getElementById("draftLabel");
const streetLabel = document.getElementById("streetLabel");
const actingTitle = document.getElementById("actingTitle");

const q25 = document.getElementById("q25");
const q100 = document.getElementById("q100");
const q500 = document.getElementById("q500");

const betBtn = document.getElementById("betBtn");
const callBtn = document.getElementById("callBtn");
const foldBtn = document.getElementById("foldBtn");
const allinBtn = document.getElementById("allinBtn");
const backBtn = document.getElementById("backBtn");
const nextBtn = document.getElementById("nextBtn");

const newHandTrack = document.getElementById("newHandTrack");
const slideThumb = document.getElementById("slideThumb");
const slideText = document.getElementById("slideText");

/* ---------- helpers: seat model ---------- */
function seatHasPlayer(seatNo) {
  const uid = state.seatState?.[seatNo]?.player_uid;
  return !!uid;
}
function seatUid(seatNo) {
  return state.seatState?.[seatNo]?.player_uid || null;
}
function seatStake(seatNo) {
  const uid = seatUid(seatNo);
  if (!uid) return 0;
  const v = state.stackByUid?.[uid];
  if (typeof v === "number") return v;
  const b = state.baseStakeByUid?.[uid];
  return typeof b === "number" ? b : 0;
}
function setSeatStake(seatNo, newStake) {
  const uid = seatUid(seatNo);
  if (!uid) return;
  state.stackByUid[uid] = Math.max(0, Math.floor(newStake));
  // update UI immediately (table.updateUI should read stackByUid)
  table.updateUI();
}

function seatEl(seatNo) {
  return state.seats?.[seatNo]?.el || null;
}
function seatTitle(seatNo) {
  const uid = seatUid(seatNo);
  if (!uid) return `Seat ${seatNo}`;
  // nếu bạn có tên player somewhere thì thay ở đây
  return `Seat ${seatNo}`;
}

/* ---------- engine seat runtime (per street) ---------- */
function ensureHandRuntime() {
  if (!state.handState) state.handState = {};
  for (let seat = 1; seat <= SEAT_COUNT; seat++) {
    if (!state.handState[seat]) {
      state.handState[seat] = {
        inHand: seatHasPlayer(seat),
        streetPutIn: 0,
        hasActed: false,
      };
    } else {
      // keep existing but sync player presence if empty seat
      if (!seatHasPlayer(seat)) state.handState[seat].inHand = false;
    }
  }
}

function inHand(seatNo) {
  return !!state.handState?.[seatNo]?.inHand;
}
function setInHand(seatNo, val) {
  if (!state.handState?.[seatNo]) return;
  state.handState[seatNo].inHand = !!val;
}

function streetPutIn(seatNo) {
  return state.handState?.[seatNo]?.streetPutIn || 0;
}
function addStreetPutIn(seatNo, amt) {
  if (!state.handState?.[seatNo]) return;
  state.handState[seatNo].streetPutIn = (state.handState[seatNo].streetPutIn || 0) + amt;
}
function markActed(seatNo) {
  if (!state.handState?.[seatNo]) return;
  state.handState[seatNo].hasActed = true;
}
function resetActedAll() {
  for (let seat = 1; seat <= SEAT_COUNT; seat++) {
    if (!state.handState?.[seat]) continue;
    if (!inHand(seat)) continue;
    state.handState[seat].hasActed = false;
  }
}
function activeCount() {
  let c = 0;
  for (let seat = 1; seat <= SEAT_COUNT; seat++) if (inHand(seat)) c++;
  return c;
}

/* ---------- turn order ---------- */
function nextActiveSeat(fromSeat) {
  for (let step = 1; step <= SEAT_COUNT; step++) {
    const s = ((fromSeat - 1 + step) % SEAT_COUNT) + 1;
    if (inHand(s)) return s;
  }
  return null;
}
function firstToActSeat() {
  // PREFLOP: next after BB
  if (state.__engine.street === "PREFLOP") {
    const bbSeat = nextActiveSeat(nextActiveSeat(state.dealerPosSeat) || state.dealerPosSeat); // approximate BB
    // better: BB = next after SB = next after dealer
    const sbSeat = nextActiveSeat(state.dealerPosSeat);
    const bbSeat2 = sbSeat ? nextActiveSeat(sbSeat) : null;
    return bbSeat2 ? nextActiveSeat(bbSeat2) : nextActiveSeat(state.dealerPosSeat);
  }
  // POSTFLOP: next after dealer
  return nextActiveSeat(state.dealerPosSeat);
}

/* ---------- betting/call ---------- */
function getCallAmount(seatNo) {
  if (!inHand(seatNo)) return 0;
  return Math.max(0, state.__engine.currentBet - streetPutIn(seatNo));
}

function putChips(seatNo, amount) {
  if (amount <= 0) return;
  if (!inHand(seatNo)) return;

  const cur = seatStake(seatNo);
  const real = Math.min(amount, cur);
  setSeatStake(seatNo, cur - real);

  state.__engine.pot += real;
  addStreetPutIn(seatNo, real);

  renderHUD();
}

/* ---------- round complete / street advance ---------- */
function isBettingRoundComplete() {
  if (activeCount() <= 1) return true;

  for (let seat = 1; seat <= SEAT_COUNT; seat++) {
    if (!inHand(seat)) continue;
    if (streetPutIn(seat) !== state.__engine.currentBet) return false;
  }

  if (state.__engine.currentBet === 0) {
    for (let seat = 1; seat <= SEAT_COUNT; seat++) {
      if (!inHand(seat)) continue;
      if (!state.handState[seat].hasActed) return false;
    }
  }
  return true;
}

function advanceStreetIfNeeded() {
  if (!isBettingRoundComplete()) return false;

  const st = state.__engine.street;
  if (st === "PREFLOP") state.__engine.street = "FLOP";
  else if (st === "FLOP") state.__engine.street = "TURN";
  else if (st === "TURN") state.__engine.street = "RIVER";
  else if (st === "RIVER") state.__engine.street = "SHOWDOWN";

  state.__engine.currentBet = 0;
  for (let seat = 1; seat <= SEAT_COUNT; seat++) {
    if (!state.handState?.[seat]) continue;
    state.handState[seat].streetPutIn = 0;
    state.handState[seat].hasActed = false;
  }

  state.actingSeat = state.__engine.street === "SHOWDOWN" ? null : firstToActSeat();
  syncStreetLabel();
  renderHUD();
  applyActingUI();
  return true;
}

/* ---------- action advance ---------- */
function advanceAction() {
  if (activeCount() <= 1) {
    state.__engine.street = "SHOWDOWN";
    state.actingSeat = null;
    syncStreetLabel();
    renderHUD();
    applyActingUI();
    return;
  }
  if (advanceStreetIfNeeded()) return;

  state.actingSeat = nextActiveSeat(state.actingSeat || state.dealerPosSeat);
  renderHUD();
  applyActingUI();
}

/* ---------- actions ---------- */
function actionFold(seatNo) {
  if (!inHand(seatNo)) return;
  setInHand(seatNo, false);
  state.handState[seatNo].hasActed = true;

  const el = seatEl(seatNo);
  if (el) el.classList.remove("is-acting");

  advanceAction();
}

function actionCall(seatNo) {
  const add = getCallAmount(seatNo);
  if (add <= 0) {
    markActed(seatNo);
    advanceAction();
    return;
  }
  putChips(seatNo, add);
  markActed(seatNo);
  advanceAction();
}

function actionBetWithDraft(seatNo) {
  const draft = state.betDraft || 0;
  if (draft <= 0) return;
  if (!inHand(seatNo)) return;

  const newPutIn = streetPutIn(seatNo) + draft;

  if (newPutIn <= state.__engine.currentBet) {
    state.betDraft = 0;
    renderHUD();
    return actionCall(seatNo);
  }

  const delta = newPutIn - streetPutIn(seatNo);
  putChips(seatNo, delta);

  state.__engine.currentBet = newPutIn;

  // force re-action for others
  resetActedAll();
  state.handState[seatNo].hasActed = true;

  state.betDraft = 0;
  renderHUD();
  advanceAction();
}

function actionAllin(seatNo) {
  if (!inHand(seatNo)) return;
  const all = seatStake(seatNo);
  if (all <= 0) {
    markActed(seatNo);
    return advanceAction();
  }

  const newPutIn = streetPutIn(seatNo) + all;
  putChips(seatNo, all);

  if (newPutIn > state.__engine.currentBet) {
    state.__engine.currentBet = newPutIn;
    resetActedAll();
    state.handState[seatNo].hasActed = true;
  } else {
    markActed(seatNo);
  }

  renderHUD();
  advanceAction();
}

/* ---------- UI: acting highlight + winner ---------- */
function clearSeatClasses() {
  for (let seat = 1; seat <= SEAT_COUNT; seat++) {
    const el = seatEl(seat);
    if (!el) continue;
    el.classList.remove("is-acting");
  }
}
function applyActingUI() {
  clearSeatClasses();
  const s = state.actingSeat;
  if (!s) return;
  const el = seatEl(s);
  if (el) el.classList.add("is-acting");
}

function setWinnerSeat(seatNo) {
  state.winnerSeat = seatNo;

  // only 1 winner
  for (let seat = 1; seat <= SEAT_COUNT; seat++) {
    const el = seatEl(seat);
    if (!el) continue;
    el.classList.toggle("is-winner", seat === seatNo);
  }
  updateSlideLock();
}

function updateSlideLock() {
  const locked = !state.winnerSeat;
  newHandTrack.classList.toggle("is-locked", locked);
  slideText.textContent = locked ? "Pick Winner to Unlock" : "Slide to New Hand";
}

/* ---------- HUD render ---------- */
function streetText() {
  const st = state.__engine.street;
  if (st === "PREFLOP") return "Preflop";
  if (st === "FLOP") return "Flop";
  if (st === "TURN") return "Turn";
  if (st === "RIVER") return "River";
  return "Showdown";
}
function syncStreetLabel() {
  state.handStreet = streetText();
  streetLabel.textContent = state.handStreet;
}

function renderHUD() {
  potCenter.innerHTML = `$${state.__engine.pot}<small>POT</small>`;
  potLabel.textContent = state.__engine.pot;

  syncStreetLabel();

  const a = state.actingSeat;
  if (a) {
    actingTitle.textContent = seatTitle(a);
    const tc = getCallAmount(a);
    toCallLabel.textContent = tc;
    callBtn.textContent = tc > 0 ? `Call ${tc}` : "Check";
  } else {
    actingTitle.textContent = "No action";
    toCallLabel.textContent = "0";
    callBtn.textContent = "Call";
  }

  draftLabel.textContent = state.betDraft || 0;
  updateSlideLock();
}

/* ---------- bind seat clicks (winner) ---------- */
function bindSeatClicksOnce() {
  // table.renderSeats() có thể re-render => mình bind theo delegation để không bị mất
  const tableEl = document.getElementById("table");
  if (!tableEl || tableEl.__winnerBound) return;
  tableEl.__winnerBound = true;

  tableEl.addEventListener("click", (e) => {
    // click vào seat element hoặc con của seat
    const seatElNode = e.target.closest?.(".seat");
    if (!seatElNode) return;

    // seat của bạn đang render theo state.seats[seat].el
    // nên mình tìm seatNo bằng cách scan
    let seatNo = null;
    for (let s = 1; s <= SEAT_COUNT; s++) {
      if (state.seats?.[s]?.el === seatElNode) {
        seatNo = s;
        break;
      }
    }
    if (!seatNo) return;
    if (!inHand(seatNo)) return;

    setWinnerSeat(seatNo);
  });
}

/* ---------- buttons binding ---------- */
function bindButtonsOnce() {
  if (state.__buttonsBound) return;
  state.__buttonsBound = true;

  q25.addEventListener("click", () => {
    if (!state.actingSeat) return;
    state.betDraft = (state.betDraft || 0) + 25;
    renderHUD();
  });
  q100.addEventListener("click", () => {
    if (!state.actingSeat) return;
    state.betDraft = (state.betDraft || 0) + 100;
    renderHUD();
  });
  q500.addEventListener("click", () => {
    if (!state.actingSeat) return;
    state.betDraft = (state.betDraft || 0) + 500;
    renderHUD();
  });

  betBtn.addEventListener("click", () => {
    if (!requireDealer()) return;
    if (!state.actingSeat) return;
    actionBetWithDraft(state.actingSeat);
  });

  callBtn.addEventListener("click", () => {
    if (!requireDealer()) return;
    if (!state.actingSeat) return;
    actionCall(state.actingSeat);
  });

  foldBtn.addEventListener("click", () => {
    if (!requireDealer()) return;
    if (!state.actingSeat) return;
    actionFold(state.actingSeat);
  });

  allinBtn.addEventListener("click", () => {
    if (!requireDealer()) return;
    if (!state.actingSeat) return;
    actionAllin(state.actingSeat);
  });

  // Next = default CHECK/CALL (giống bạn đang muốn dealer bấm nhanh)
  nextBtn.addEventListener("click", () => {
    if (!requireDealer()) return;
    if (!state.actingSeat) return;
    actionCall(state.actingSeat);
  });

  // Back: optional (chưa làm history rollback)
  backBtn.addEventListener("click", () => {});
}

/* ---------- slider binding ---------- */
function bindSliderOnce() {
  if (state.__sliderBound) return;
  state.__sliderBound = true;

  let isDragging = false;
  let startX = 0;
  let thumbStartLeft = 0;

  function resetSlide() {
    slideThumb.style.left = "0px";
    isDragging = false;
    startX = 0;
    thumbStartLeft = 0;
  }

  function slideCommitNewHand() {
    if (!state.winnerSeat) {
      resetSlide();
      return;
    }

    // pay pot to winner
    const winSeat = state.winnerSeat;
    setSeatStake(winSeat, seatStake(winSeat) + state.__engine.pot);
    state.__engine.pot = 0;

    // reset hand engine
    state.winnerSeat = null;
    state.betDraft = 0;
    state.__engine.street = "PREFLOP";
    state.__engine.currentBet = 0;

    // rotate dealer to next active seat
    ensureHandRuntime();
    const nextD = nextActiveSeat(state.dealerPosSeat) || state.dealerPosSeat;
    state.dealerPosSeat = nextD;

    // reset per-hand runtime
    for (let seat = 1; seat <= SEAT_COUNT; seat++) {
      state.handState[seat].inHand = seatHasPlayer(seat) && seatStake(seat) > 0;
      state.handState[seat].streetPutIn = 0;
      state.handState[seat].hasActed = false;

      const el = seatEl(seat);
      if (el) el.classList.remove("is-winner");
    }

    state.actingSeat = firstToActSeat();
    state.handActive = true;

    renderHUD();
    applyActingUI();
    resetSlide();
  }

  newHandTrack.addEventListener("pointerdown", (e) => {
    if (!state.winnerSeat) return;
    isDragging = true;
    startX = e.clientX;
    thumbStartLeft = slideThumb.offsetLeft || 0;
    slideThumb.setPointerCapture(e.pointerId);
  });

  newHandTrack.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const track = newHandTrack.getBoundingClientRect();
    const thumbW = slideThumb.getBoundingClientRect().width;
    const maxLeft = Math.max(0, track.width - thumbW - 6);

    const dx = e.clientX - startX;
    let left = thumbStartLeft + dx;
    left = Math.max(0, Math.min(maxLeft, left));
    slideThumb.style.left = left + "px";
  });

  newHandTrack.addEventListener("pointerup", () => {
    if (!isDragging) return;
    isDragging = false;

    const track = newHandTrack.getBoundingClientRect();
    const thumb = slideThumb.getBoundingClientRect();
    const progress = (thumb.left - track.left) / (track.width - thumb.width);

    if (progress > 0.85) slideCommitNewHand();
    else resetSlide();
  });
}

/* ---------- init engine (call after seats rendered) ---------- */
function initHandEngineFromCurrentTable() {
  ensureHandRuntime();

  // initial hand start (if not active, start when dealer logs in OR first render)
  if (!state.handActive) {
    // do not auto-start if dealer not logged in (dealer login will startNewHandLocal)
    // but still render HUD properly
  }

  // if no actingSeat yet, set it
  if (!state.actingSeat) {
    state.actingSeat = firstToActSeat();
  }

  bindSeatClicksOnce();
  bindButtonsOnce();
  bindSliderOnce();
  renderHUD();
  applyActingUI();
}

/* --- make engine available for table.js if you want to call it after renderSeats() --- */
window.__tourEngine = {
  init: initHandEngineFromCurrentTable,
};

/* Hook: whenever table module updates UI / renders seats, call init to rebind safely */
setTimeout(() => initHandEngineFromCurrentTable(), 250);
setTimeout(() => initHandEngineFromCurrentTable(), 900);
