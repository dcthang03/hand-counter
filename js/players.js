export const state = {
  // config
  HOLD_TIME: 700,
  SEAT_COUNT: 9,
  TOP_SEAT: 5,
  SEAT_SIZE: 60,
  TABLE_BORDER: 4,
  SAFE_PADDING: 8,

  SB: 25,
  BB: 50,

  // session
  isSubmitting: false,

  TABLE_UID: null,
  TABLE_NAME: null,
  tablePin: "",

  DEALER_UID: null,
  DEALER_NAME: null,
  dealerPin: "",

  // seats + ui caches
  seatState: {},     // seatState[seat]={player_uid}
  seats: {},         // seats[seat]={el, stakeEl, seatNoEl}
  betFloats: {},     // betFloats[seat]={el}

  holdTimer: null,
  didHold: false,
  qrScanner: null,
  seatChannel: null,
  tableStateChannel: null,

  baseStakeByUid: {},
  stackByUid: {},
  stakeRefreshTimer: null,

  // hand
  handActive: false,
  actingSeat: null,
  handStreet: "Preflop",
  handState: {},
  handHistory: [],
  betDraft: 0,
  winnerSeat: null,
  betTarget: 0,

  // dealer token
  dealerPosSeat: 1,
};
