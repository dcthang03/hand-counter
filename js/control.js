import { state } from "./players.js";

/* =====================
   SOUND (giữ đúng như bản gốc)
   ===================== */
let __audioCtx = null;
function __getAudioCtx(){
  if(!__audioCtx) __audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if(__audioCtx.state === "suspended") __audioCtx.resume().catch(()=>{});
  return __audioCtx;
}
function __beep({ freqs=[880], type="sine", dur=0.08, gain=0.035, attack=0.005 } = {}){
  const ctx = __getAudioCtx();
  const now = ctx.currentTime;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.connect(ctx.destination);

  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), now + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(attack + 0.01, dur));

  freqs.forEach(f=>{
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, now);
    o.connect(g);
    o.start(now);
    o.stop(now + dur);
  });
}

export const Sound = {
  tick(){    __beep({ freqs:[1760], type:"sine",     dur:0.045, gain:0.020, attack:0.003 }); },
  success(){ __beep({ freqs:[880,1320], type:"sine", dur:0.090, gain:0.030, attack:0.004 }); },
  reject(){  __beep({ freqs:[220], type:"triangle",  dur:0.100, gain:0.030, attack:0.004 }); },
  error(){
    __beep({ freqs:[392], type:"square", dur:0.055, gain:0.020, attack:0.003 });
    setTimeout(()=> __beep({ freqs:[330], type:"square", dur:0.055, gain:0.020, attack:0.003 }), 85);
  }
};

export function initSoundUnlock(){
  window.addEventListener("pointerdown", () => { __getAudioCtx(); }, { once:true });
}

/* =====================
   DOTS
   ===================== */
export function setDots(containerId, len){
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  wrap.querySelectorAll('.pin-dot').forEach((d,i)=> d.classList.toggle('filled', i < len));
}

/* =====================
   TABLE MODAL
   ===================== */
export function initTableModal({
  // from table.js
  setTableUI,
  setDealerUI,
  startTableSession,
  dealerLogout,
}){
  const tableModal   = document.getElementById('tableModal');
  const tableClose   = document.getElementById('tableClose');
  const tableSelect  = document.getElementById('tableSelect');
  const tableErrEl   = document.getElementById('tableErr');

  function resetTableModalUI(){
    tableSelect.value = "";
    tableSelect.innerHTML = `<option value="">Loading…</option>`;
    state.tablePin = "";
    setDots('tablePinDots', 0);
    tableErrEl.style.display = "none";
  }

  async function loadTablesForModal(){
    try{
      const { data, error } = await state.sbClient
        .from('tables')
        .select('table_uid, table_name')
        .eq('active', true)
        .order('table_uid');

      if (error){
        console.error("loadTables error:", error);
        tableSelect.innerHTML = `<option value="">Load failed</option>`;
        return;
      }

      const rows = data || [];
      tableSelect.innerHTML =
        `<option value="">— Select table —</option>` +
        rows.map(t => {
          const name = String((t.table_name||"")).trim();
          const label = name ? name : String(t.table_uid);
          return `<option value="${String(t.table_uid)}">${label}</option>`;
        }).join("");

      if (!rows.length){
        tableSelect.innerHTML = `<option value="">No active tables</option>`;
      }
    }catch(e){
      console.error("loadTables exception:", e);
      tableSelect.innerHTML = `<option value="">Load failed</option>`;
    }
  }

  async function submitTableLogin(){
    const table = tableSelect.value;
    if (!table) return;
    if (state.tablePin.length !== 4) return;

    const { data, error } = await state.sbClient
      .from('tables')
      .select('table_uid, table_name, pin_hash, active')
      .eq('table_uid', table)
      .single();

    if (error || !data){
      Sound.error();
      tableErrEl.textContent = "❌ Table not found";
      tableErrEl.style.display = "block";
      state.tablePin = ""; setDots('tablePinDots', 0);
      return;
    }
    if (!data.active){
      Sound.error();
      tableErrEl.textContent = "❌ Table locked";
      tableErrEl.style.display = "block";
      state.tablePin = ""; setDots('tablePinDots', 0);
      return;
    }
    if (String(data.pin_hash) !== state.tablePin){
      Sound.error();
      tableErrEl.textContent = "❌ Wrong PIN";
      tableErrEl.style.display = "block";
      state.tablePin = ""; setDots('tablePinDots', 0);
      return;
    }

    // nếu đổi table thì logout dealer
    if (state.TABLE_UID && state.TABLE_UID !== data.table_uid){
      dealerLogout();
    }

    state.TABLE_UID = data.table_uid;
    state.TABLE_NAME = (data.table_name || "").trim() || data.table_uid;

    localStorage.setItem("table_uid", state.TABLE_UID);
    localStorage.setItem("table_name", state.TABLE_NAME);

    setTableUI();
    setDealerUI();
    await startTableSession();
    closeTableModal();
  }

  function tablePress(n){
    if (!tableSelect.value){
      Sound.error();
      tableErrEl.style.display="block";
      tableErrEl.textContent="❌ Select table first";
      return;
    }
    tableErrEl.style.display = "none";
    if (state.tablePin.length >= 4) return;
    state.tablePin += String(n);
    setDots('tablePinDots', state.tablePin.length);
    if (state.tablePin.length === 4) submitTableLogin();
  }

  function tableBack(){
    tableErrEl.style.display = "none";
    state.tablePin = state.tablePin.slice(0,-1);
    setDots('tablePinDots', state.tablePin.length);
  }

  function openTableModal(){
    tableModal.style.display = "flex";
    resetTableModalUI();
    loadTablesForModal();
  }

  function closeTableModal(){
    tableModal.style.display = "none";
    resetTableModalUI();
  }

  tableClose.addEventListener('click', closeTableModal);
  tableModal.addEventListener('click', (e) => { if (e.target === tableModal) closeTableModal(); });

  // expose api for app.js to mount to window
  return {
    openTableModal,
    closeTableModal,
    tablePress,
    tableBack,
    submitTableLogin,
  };
}

/* =====================
   DEALER MODAL
   ===================== */
export function initDealerModal({
  // from table.js
  requireTable,
  setDealerUI,
  startNewHandLocal,
  updateUI,
}){
  const dealerModal  = document.getElementById('dealerModal');
  const dealerClose  = document.getElementById('dealerClose');
  const dealerSelect = document.getElementById('dealerSelect');
  const dealerErrEl  = document.getElementById('dealerErr');

  function resetDealerModalUI(){
    dealerSelect.value = "";
    dealerSelect.innerHTML = `<option value="">Loading…</option>`;
    state.dealerPin = "";
    setDots('dealerPinDots', 0);
    dealerErrEl.style.display = "none";
  }

  async function loadDealersForModal(){
    const { data, error } = await state.sbClient
      .from('dealers')
      .select('dealer_uid, dealer_name')
      .order('dealer_name', { ascending: true });
    if (error){
      console.error(error);
      dealerSelect.innerHTML = `<option value="">Load failed</option>`;
      return;
    }
    const rows = data || [];
    if (!rows.length){
      dealerSelect.innerHTML = `<option value="">No dealers</option>`;
      return;
    }
    dealerSelect.innerHTML =
      `<option value="">— Select your name —</option>` +
      rows.map(d => `<option value="${String(d.dealer_uid)}">${String(d.dealer_name||"")}</option>`).join("");
  }

  async function submitDealerLogin(){
    if (!requireTable()) return;
    if (!dealerSelect.value) return;
    if (state.dealerPin.length !== 4) return;

    const { data, error } = await state.sbClient
      .from('dealers')
      .select('dealer_uid, dealer_name, dealer_pin')
      .eq('dealer_uid', dealerSelect.value)
      .single();

    if (error){
      console.error(error);
      Sound.error();
      dealerErrEl.textContent = "❌ Verify failed";
      dealerErrEl.style.display = "block";
      state.dealerPin = "";
      setDots('dealerPinDots', 0);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (row && String(row.dealer_pin ?? "") === String(state.dealerPin)){
      state.DEALER_UID = row.dealer_uid;
      state.DEALER_NAME = row.dealer_name;

      localStorage.setItem("dealer_uid", state.DEALER_UID);
      localStorage.setItem("dealer_name", state.DEALER_NAME);

      setDealerUI();
      closeDealerModal();

      if(!state.handActive){
        startNewHandLocal();
      }else{
        updateUI();
      }
    }else{
      Sound.error();
      dealerErrEl.textContent = "❌ Wrong PIN";
      dealerErrEl.style.display = "block";
      state.dealerPin = "";
      setDots('dealerPinDots', 0);
    }
  }

  function dealerPress(n){
    if (!requireTable()) return;

    if (!dealerSelect.value) {
      Sound.error();
      dealerErrEl.style.display="block";
      dealerErrEl.textContent="❌ Select dealer first";
      return;
    }
    dealerErrEl.style.display = "none";

    if (state.dealerPin.length >= 4) return;
    state.dealerPin += String(n);
    setDots('dealerPinDots', state.dealerPin.length);

    if (state.dealerPin.length === 4) submitDealerLogin();
  }

  function dealerBack(){
    dealerErrEl.style.display = "none";
    state.dealerPin = state.dealerPin.slice(0,-1);
    setDots('dealerPinDots', state.dealerPin.length);
  }

  function openDealerModal(){
    if (!requireTable()) return;
    dealerModal.style.display = "flex";
    resetDealerModalUI();
    loadDealersForModal();
  }

  function closeDealerModal(){
    dealerModal.style.display = "none";
    resetDealerModalUI();
  }

  dealerClose.addEventListener('click', closeDealerModal);
  dealerModal.addEventListener('click', (e) => { if (e.target === dealerModal) closeDealerModal(); });

  return {
    openDealerModal,
    closeDealerModal,
    dealerPress,
    dealerBack,
    submitDealerLogin,
  };
}
