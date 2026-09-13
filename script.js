"use strict";

/*
============================================================
 PRECISION SNIPER AI
============================================================

COMBINED STRATEGY

SCRIPT 1:
Market Structure
Swing Points
BOS
CHOCH
Order Block
FVG
Premium / Discount

SCRIPT 2:
Precision Swing / Direction Engine

SCRIPT 3:
EMA 9/21
VWAP
RSI
MACD
ADX
ATR
Volume
Risk / Reward

FINAL LOGIC:

MARKET STRUCTURE
       ↓
SWING
       ↓
LOCATION
       ↓
FVG / OB / SUPPORT / RESISTANCE
       ↓
CANDLE CONFIRMATION
       ↓
MOMENTUM
       ↓
SIGNAL
       ↓
ENTRY / SL / TP

CLOSED CANDLE ONLY
============================================================
*/


/* =========================================================
   CONFIGURATION
========================================================= */

const TWELVE_DATA_API_KEY = "YOUR_TWELVE_DATA_API_KEY";

const TWELVE_DATA_URL =
  "https://api.twelvedata.com/time_series";

const DERIV_WS =
  "wss://api.derivws.com/trading/v1/options/ws/public";


/* =========================================================
   STATE
========================================================= */

let candles = [];

let currentAnalysis = null;

let derivSocket = null;

let previousSignal = "WAIT";

let analysisTimer = null;

let lastCandleTime = null;


/* =========================================================
   DOM
========================================================= */

const $ = id => document.getElementById(id);

const symbolSelect = $("symbol");
const timeframeSelect = $("timeframe");

const analyzeBtn = $("analyzeBtn");

const questionInput = $("question");
const askBtn = $("askBtn");

const alertsToggle = $("alerts");


/* =========================================================
   CONNECTION UI
========================================================= */

function setConnection(connected, text) {

  const dot = $("connectionDot");
  const label = $("connectionText");

  dot.style.background =
    connected ? "#00d084" : "#ff4d5a";

  label.textContent = text;
}


/* =========================================================
   FORMAT NUMBER
========================================================= */

function decimalsForPrice(price) {

  if (price >= 1000) return 2;

  if (price >= 100) return 2;

  if (price >= 10) return 3;

  if (price >= 1) return 5;

  return 6;
}


function fmt(value) {

  if (
    value === null ||
    value === undefined ||
    Number.isNaN(value)
  ) {
    return "--";
  }

  const decimals =
    decimalsForPrice(Math.abs(value));

  return Number(value).toFixed(decimals);
}


/* =========================================================
   TIMEFRAME
========================================================= */

function timeframeText(tf) {

  const map = {
    "1min": "1 Minute",
    "5min": "5 Minutes",
    "15min": "15 Minutes",
    "30min": "30 Minutes",
    "1h": "1 Hour",
    "2h": "2 Hours",
    "4h": "4 Hours",
    "1day": "Daily"
  };

  return map[tf] || tf;
}


/* =========================================================
   SYMBOL TYPE
========================================================= */

function isDerivSymbol(symbol) {

  return symbol.startsWith("DERIV:");
}


/* =========================================================
   DERIV SYMBOL MAP
========================================================= */

const DERIV_SYMBOLS = {

  "DERIV:1HZ10V": "1HZ10V",
  "DERIV:1HZ25V": "1HZ25V",
  "DERIV:1HZ50V": "1HZ50V",
  "DERIV:1HZ75V": "1HZ75V",
  "DERIV:1HZ100V": "1HZ100V",
  "DERIV:1HZ150V": "1HZ150V",

  "DERIV:JD10": "JD10",
  "DERIV:JD25": "JD25",
  "DERIV:JD50": "JD50",
  "DERIV:JD75": "JD75",
  "DERIV:JD100": "JD100"
};


/* =========================================================
   TWELVE DATA SYMBOL
========================================================= */

function twelveSymbol(symbol) {

  return symbol;
}


/* =========================================================
   LOAD TWELVE DATA
========================================================= */

async function loadTwelveData(symbol, interval) {

  if (
    !TWELVE_DATA_API_KEY ||
    TWELVE_DATA_API_KEY ===
    "YOUR_TWELVE_DATA_API_KEY"
  ) {

    throw new Error(
      "Add your Twelve Data API key in script.js"
    );

  }

  const url =
    `${TWELVE_DATA_URL}` +
    `?symbol=${encodeURIComponent(twelveSymbol(symbol))}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&outputsize=250` +
    `&apikey=${encodeURIComponent(TWELVE_DATA_API_KEY)}`;

  const response =
    await fetch(url);

  if (!response.ok) {

    throw new Error(
      `Twelve Data HTTP ${response.status}`
    );

  }

  const data =
    await response.json();

  if (data.status === "error") {

    throw new Error(
      data.message || "Twelve Data error"
    );

  }

  if (!data.values) {

    throw new Error(
      "No candle data returned"
    );

  }

  return data.values
    .map(c => ({

      time:
        new Date(c.datetime).getTime(),

      open:
        Number(c.open),

      high:
        Number(c.high),

      low:
        Number(c.low),

      close:
        Number(c.close),

      volume:
        Number(c.volume || 0)

    }))
    .reverse();

}


/* =========================================================
   DERIV WEBSOCKET
========================================================= */

function connectDeriv(symbol) {

  return new Promise((resolve, reject) => {

    if (derivSocket) {

      try {
        derivSocket.close();
      } catch {}

      derivSocket = null;
    }


    const derivSymbol =
      DERIV_SYMBOLS[symbol];

    if (!derivSymbol) {

      reject(
        new Error("Unsupported Deriv symbol")
      );

      return;
    }


    derivSocket =
      new WebSocket(DERIV_WS);


    let resolved = false;


    derivSocket.onopen = () => {

      setConnection(
        true,
        "Deriv connected"
      );


      derivSocket.send(
        JSON.stringify({

          ticks_history: derivSymbol,

          adjust_start_time: 1,

          count: 250,

          end: "latest",

          style: "candles",

          granularity:
            granularityFromTimeframe(
              timeframeSelect.value
            )

        })
      );

    };


    derivSocket.onmessage = event => {

      try {

        const data =
          JSON.parse(event.data);


        if (
          data.error
        ) {

          reject(
            new Error(
              data.error.message
            )
          );

          return;
        }


        if (
          data.msg_type === "candles" &&
          data.candles
        ) {

          candles =
            data.candles.map(c => ({

              time:
                Number(c.epoch) * 1000,

              open:
                Number(c.open),

              high:
                Number(c.high),

              low:
                Number(c.low),

              close:
                Number(c.close),

              volume: 0

            }));


          if (!resolved) {

            resolved = true;

            resolve(candles);

          }

        }

      }

      catch (error) {

        console.error(error);

      }

    };


    derivSocket.onerror = () => {

      setConnection(
        false,
        "Deriv connection error"
      );

      reject(
        new Error(
          "Deriv WebSocket error"
        )
      );

    };


    derivSocket.onclose = () => {

      setConnection(
        false,
        "Disconnected"
      );

    };

  });

}


/* =========================================================
   GRANULARITY
========================================================= */

function granularityFromTimeframe(tf) {

  const map = {

    "1min": 60,
    "5min": 300,
    "15min": 900,
    "30min": 1800,

    "1h": 3600,
    "2h": 7200,
    "4h": 14400,

    "1day": 86400

  };

  return map[tf] || 300;
}


/* =========================================================
   LOAD MARKET
========================================================= */

async function loadMarket() {

  const symbol =
    symbolSelect.value;

  const timeframe =
    timeframeSelect.value;


  $("displaySymbol").textContent =
    symbol;

  $("displayTimeframe").textContent =
    timeframeText(timeframe);


  setConnection(
    false,
    "Loading market..."
  );


  try {

    if (isDerivSymbol(symbol)) {

      await connectDeriv(symbol);

    }

    else {

      candles =
        await loadTwelveData(
          symbol,
          timeframe
        );

      setConnection(
        true,
        "Market connected"
      );

    }


    if (!candles.length) {

      throw new Error(
        "No candles available"
      );

    }


    /*
      IMPORTANT:

      Remove the currently forming candle.

      This makes the analysis
      CLOSED-CANDLE / NON-REPAINTING.
    */

    candles =
      candles.slice(
        0,
        Math.max(
          1,
          candles.length - 1
        )
      );


    updatePrice();

    renderCandles();

    runAnalysis();

  }

  catch (error) {

    console.error(error);

    setConnection(
      false,
      "Market unavailable"
    );

    $("analysis").innerHTML =
      `<div class="warning">
        ${escapeHtml(error.message)}
      </div>`;

  }

}


/* =========================================================
   UPDATE PRICE
========================================================= */

function updatePrice() {

  if (!candles.length) return;

  const last =
    candles[candles.length - 1];

  $("currentPrice").textContent =
    fmt(last.close);

  $("lastUpdate").textContent =
    new Date(last.time)
      .toLocaleTimeString();

}


/* =========================================================
   RENDER CANDLES
========================================================= */

function renderCandles() {

  const tbody =
    $("candleTable");

  tbody.innerHTML = "";


  candles
    .slice(-15)
    .reverse()
    .forEach(c => {

      const tr =
        document.createElement("tr");

      tr.innerHTML = `

        <td>
          ${new Date(c.time)
            .toLocaleTimeString()}
        </td>

        <td>${fmt(c.open)}</td>

        <td>${fmt(c.high)}</td>

        <td>${fmt(c.low)}</td>

        <td>${fmt(c.close)}</td>

        <td>${c.volume || "-"}</td>

      `;

      tbody.appendChild(tr);

    });

}


/* =========================================================
   EMA
========================================================= */

function ema(values, period) {

  if (values.length < period)
    return [];

  const result = [];

  const multiplier =
    2 / (period + 1);

  let previous =
    values
      .slice(0, period)
      .reduce(
        (a, b) => a + b,
        0
      ) / period;


  result.push(previous);


  for (
    let i = period;
    i < values.length;
    i++
  ) {

    previous =
      (
        values[i] - previous
      ) * multiplier + previous;

    result.push(previous);

  }

  return result;
}


/* =========================================================
   SMA
========================================================= */

function sma(values, period) {

  if (values.length < period)
    return [];

  const result = [];

  for (
    let i = period - 1;
    i < values.length;
    i++
  ) {

    let sum = 0;

    for (
      let j = i - period + 1;
      j <= i;
      j++
    ) {

      sum += values[j];

    }

    result.push(
      sum / period
    );

  }

  return result;
}


/* =========================================================
   RSI
========================================================= */

function calculateRSI(values, period = 14) {

  if (values.length <= period)
    return 50;

  let gains = 0;
  let losses = 0;


  for (
    let i = 1;
    i <= period;
    i++
  ) {

    const change =
      values[i] - values[i - 1];

    if (change >= 0)
      gains += change;
    else
      losses += Math.abs(change);

  }


  let avgGain =
    gains / period;

  let avgLoss =
    losses / period;


  for (
    let i = period + 1;
    i < values.length;
    i++
  ) {

    const change =
      values[i] - values[i - 1];

    const gain =
      Math.max(change, 0);

    const loss =
      Math.max(-change, 0);


    avgGain =
      (
        avgGain * (period - 1)
        + gain
      ) / period;


    avgLoss =
      (
        avgLoss * (period - 1)
        + loss
      ) / period;

  }


  if (avgLoss === 0)
    return 100;


  const rs =
    avgGain / avgLoss;


  return 100 -
    (100 / (1 + rs));

}


/* =========================================================
   ATR
========================================================= */

function calculateATR(
  data,
  period = 14
) {

  if (data.length < period + 1)
    return 0;


  const trs = [];


  for (
    let i = 1;
    i < data.length;
    i++
  ) {

    const high =
      data[i].high;

    const low =
      data[i].low;

    const previousClose =
      data[i - 1].close;


    const tr =
      Math.max(

        high - low,

        Math.abs(
          high - previousClose
        ),

        Math.abs(
          low - previousClose
        )

      );


    trs.push(tr);

  }


  const recent =
    trs.slice(-period);


  return recent.reduce(
    (a, b) => a + b,
    0
  ) / recent.length;

}


/* =========================================================
   MACD
========================================================= */

function calculateMACD(values) {

  const ema12 =
    ema(values, 12);

  const ema26 =
    ema(values, 26);


  if (
    !ema12.length ||
    !ema26.length
  ) {

    return {
      macd: 0,
      signal: 0,
      histogram: 0
    };

  }


  /*
    Align the arrays by taking
    the final values.
  */

  const macdValues = [];


  const offset =
    ema12.length -
    ema26.length;


  for (
    let i = 0;
    i < ema26.length;
    i++
  ) {

    macdValues.push(
      ema12[i + offset] -
      ema26[i]
    );

  }


  const signalValues =
    ema(
      macdValues,
      9
    );


  const macd =
    macdValues[
      macdValues.length - 1
    ];


  const signal =
    signalValues.length
      ? signalValues[
          signalValues.length - 1
        ]
      : 0;


  return {

    macd,

    signal,

    histogram:
      macd - signal

  };

}


/* =========================================================
   VWAP
========================================================= */

function calculateVWAP(data) {

  let cumulativePV = 0;

  let cumulativeVolume = 0;


  for (const c of data) {

    const typical =
      (
        c.high +
        c.low +
        c.close
      ) / 3;


    const volume =
      c.volume || 1;


    cumulativePV +=
      typical * volume;


    cumulativeVolume +=
      volume;

  }


  if (!cumulativeVolume)
    return data[data.length - 1].close;


  return (
    cumulativePV /
    cumulativeVolume
  );

}


/* =========================================================
   SWING POINTS
========================================================= */

function findSwingPoints(
  data,
  left = 3,
  right = 3
) {

  const highs = [];
  const lows = [];


  for (
    let i = left;
    i < data.length - right;
    i++
  ) {

    let swingHigh = true;
    let swingLow = true;


    for (
      let j = 1;
      j <= left;
      j++
    ) {

      if (
        data[i].high <=
        data[i - j].high
      ) {

        swingHigh = false;

      }


      if (
        data[i].low >=
        data[i - j].low
      ) {

        swingLow = false;

      }

    }


    for (
      let j = 1;
      j <= right;
      j++
    ) {

      if (
        data[i].high <=
        data[i + j].high
      ) {

        swingHigh = false;

      }


      if (
        data[i].low >=
        data[i + j].low
      ) {

        swingLow = false;

      }

    }


    if (swingHigh) {

      highs.push({

        index: i,

        price:
          data[i].high

      });

    }


    if (swingLow) {

      lows.push({

        index: i,

        price:
          data[i].low

      });

    }

  }


  return {
    highs,
    lows
  };

}


/* =========================================================
   MARKET STRUCTURE
========================================================= */

function marketStructure(data) {

  const swings =
    findSwingPoints(
      data,
      3,
      3
    );


  const lastHigh =
    swings.highs[
      swings.highs.length - 1
    ];


  const previousHigh =
    swings.highs[
      swings.highs.length - 2
    ];


  const lastLow =
    swings.lows[
      swings.lows.length - 1
    ];


  const previousLow =
    swings.lows[
      swings.lows.length - 2
    ];


  const last =
    data[data.length - 1];


  let bias = "NEUTRAL";

  let structure = "RANGE";

  let bos = "NONE";


  if (
    lastHigh &&
    previousHigh &&
    lastLow &&
    previousLow
  ) {

    const higherHigh =
      lastHigh.price >
      previousHigh.price;

    const higherLow =
      lastLow.price >
      previousLow.price;

    const lowerHigh =
      lastHigh.price <
      previousHigh.price;

    const lowerLow =
      lastLow.price <
      previousLow.price;


    if (
      higherHigh &&
      higherLow
    ) {

      bias = "BULLISH";

      structure = "HH + HL";

    }

    else if (
      lowerHigh &&
      lowerLow
    ) {

      bias = "BEARISH";

      structure = "LH + LL";

    }


    if (
      lastHigh &&
      last.close >
      lastHigh.price
    ) {

      bos = "BULLISH BOS";

      bias = "BULLISH";

    }


    if (
      lastLow &&
      last.close <
      lastLow.price
    ) {

      bos = "BEARISH BOS";

      bias = "BEARISH";

    }

  }


  return {

    bias,

    structure,

    bos,

    swingHigh:
      lastHigh
        ? lastHigh.price
        : null,

    swingLow:
      lastLow
        ? lastLow.price
        : null,

    highs:
      swings.highs,

    lows:
      swings.lows

  };

}


/* =========================================================
   FVG
========================================================= */

function detectFVG(data) {

  if (data.length < 3)
    return null;


  const i =
    data.length - 1;


  const a =
    data[i - 2];

  const b =
    data[i - 1];

  const c =
    data[i];


  /*
    Bullish FVG:

    Current low > candle 2 high
  */

  if (
    c.low > a.high
  ) {

    return {

      type: "BULLISH FVG",

      low: a.high,

      high: c.low

    };

  }


  /*
    Bearish FVG:

    Current high < candle 2 low
  */

  if (
    c.high < a.low
  ) {

    return {

      type: "BEARISH FVG",

      low: c.high,

      high: a.low

    };

  }


  return null;

}


/* =========================================================
   ORDER BLOCK
========================================================= */

function detectOrderBlock(data) {

  if (data.length < 6)
    return null;


  const structure =
    marketStructure(data);


  /*
    Search recent opposite candle
    before directional movement.
  */

  for (
    let i = data.length - 2;
    i >= Math.max(0, data.length - 10);
    i--
  ) {

    const c =
      data[i];


    if (
      structure.bias ===
      "BULLISH" &&
      c.close < c.open
    ) {

      return {

        type:
          "BULLISH ORDER BLOCK",

        low: c.low,

        high: c.high

      };

    }


    if (
      structure.bias ===
      "BEARISH" &&
      c.close > c.open
    ) {

      return {

        type:
          "BEARISH ORDER BLOCK",

        low: c.low,

        high: c.high

      };

    }

  }


  return null;

}


/* =========================================================
   CANDLE CONFIRMATION
========================================================= */

function candleConfirmation(data) {

  const c =
    data[data.length - 1];


  const range =
    c.high - c.low;


  if (range <= 0) {

    return {
      direction: "NONE",
      pattern: "NONE"
    };

  }


  const body =
    Math.abs(
      c.close - c.open
    );


  const upperWick =
    c.high -
    Math.max(
      c.open,
      c.close
    );


  const lowerWick =
    Math.min(
      c.open,
      c.close
    ) -
    c.low;


  /*
    Bullish engulfing
  */

  if (data.length >= 2) {

    const p =
      data[data.length - 2];


    if (
      p.close < p.open &&
      c.close > c.open &&
      c.close >= p.open &&
      c.open <= p.close
    ) {

      return {

        direction: "BULLISH",

        pattern:
          "Bullish Engulfing"

      };

    }


    if (
      p.close > p.open &&
      c.close < c.open &&
      c.open >= p.close &&
      c.close <= p.open
    ) {

      return {

        direction: "BEARISH",

        pattern:
          "Bearish Engulfing"

      };

    }

  }


  /*
    Bullish rejection
  */

  if (
    lowerWick > body * 1.5 &&
    c.close > c.open
  ) {

    return {

      direction: "BULLISH",

      pattern:
        "Bullish Rejection"

    };

  }


  /*
    Bearish rejection
  */

  if (
    upperWick > body * 1.5 &&
    c.close < c.open
  ) {

    return {

      direction: "BEARISH",

      pattern:
        "Bearish Rejection"

    };

  }


  /*
    Strong bullish candle
  */

  if (
    c.close > c.open &&
    body / range > .65
  ) {

    return {

      direction: "BULLISH",

      pattern:
        "Strong Bullish Candle"

    };

  }


  /*
    Strong bearish candle
  */

  if (
    c.close < c.open &&
    body / range > .65
  ) {

    return {

      direction: "BEARISH",

      pattern:
        "Strong Bearish Candle"

    };

  }


  return {

    direction: "NONE",

    pattern: "No strong confirmation"

  };

}


/* =========================================================
   MOMENTUM
========================================================= */

function momentumAnalysis(data) {

  const closes =
    data.map(
      c => c.close
    );


  const ema9 =
    ema(closes, 9);


  const ema21 =
    ema(closes, 21);


  const rsi =
    calculateRSI(
      closes,
      14
    );


  const macd =
    calculateMACD(
      closes
    );


  const vwap =
    calculateVWAP(
      data
    );


  const price =
    closes[closes.length - 1];


  const e9 =
    ema9[ema9.length - 1];


  const e21 =
    ema21[ema21.length - 1];


  return {

    price,

    ema9: e9,

    ema21: e21,

    emaBias:
      e9 > e21
        ? "BULLISH"
        : e9 < e21
        ? "BEARISH"
        : "NEUTRAL",

    rsi,

    macd,

    vwap,

    vwapBias:
      price > vwap
        ? "BULLISH"
        : price < vwap
        ? "BEARISH"
        : "NEUTRAL"

  };

}


/* =========================================================
   SIGNAL ENGINE
========================================================= */

function buildSignal(data) {

  const structure =
    marketStructure(data);


  const momentum =
    momentumAnalysis(data);


  const candle =
    candleConfirmation(data);


  const fvg =
    detectFVG(data);


  const ob =
    detectOrderBlock(data);


  let bullish = 0;

  let bearish = 0;


  const reasons = [];


  /*
    MARKET STRUCTURE
  */

  if (
    structure.bias ===
    "BULLISH"
  ) {

    bullish += 25;

    reasons.push(
      "Market structure is bullish."
    );

  }

  else if (
    structure.bias ===
    "BEARISH"
  ) {

    bearish += 25;

    reasons.push(
      "Market structure is bearish."
    );

  }


  /*
    EMA
  */

  if (
    momentum.emaBias ===
    "BULLISH"
  ) {

    bullish += 10;

    reasons.push(
      "EMA 9 is above EMA 21."
    );

  }

  else if (
    momentum.emaBias ===
    "BEARISH"
  ) {

    bearish += 10;

    reasons.push(
      "EMA 9 is below EMA 21."
    );

  }


  /*
    RSI
  */

  if (
    momentum.rsi > 50 &&
    momentum.rsi < 75
  ) {

    bullish += 10;

    reasons.push(
      `RSI supports bullish momentum (${momentum.rsi.toFixed(1)}).`
    );

  }

  else if (
    momentum.rsi < 50 &&
    momentum.rsi > 25
  ) {

    bearish += 10;

    reasons.push(
      `RSI supports bearish momentum (${momentum.rsi.toFixed(1)}).`
    );

  }


  /*
    MACD
  */

  if (
    momentum.macd.histogram > 0
  ) {

    bullish += 10;

    reasons.push(
      "MACD momentum is bullish."
    );

  }

  else if (
    momentum.macd.histogram < 0
  ) {

    bearish += 10;

    reasons.push(
      "MACD momentum is bearish."
    );

  }


  /*
    VWAP
  */

  if (
    momentum.vwapBias ===
    "BULLISH"
  ) {

    bullish += 5;

  }

  else if (
    momentum.vwapBias ===
    "BEARISH"
  ) {

    bearish += 5;

  }


  /*
    CANDLE
  */

  if (
    candle.direction ===
    "BULLISH"
  ) {

    bullish += 15;

    reasons.push(
      `Bullish candle confirmation: ${candle.pattern}.`
    );

  }

  else if (
    candle.direction ===
    "BEARISH"
  ) {

    bearish += 15;

    reasons.push(
      `Bearish candle confirmation: ${candle.pattern}.`
    );

  }


  /*
    FVG
  */

  if (fvg) {

    if (
      fvg.type ===
      "BULLISH FVG"
    ) {

      bullish += 10;

      reasons.push(
        "Bullish Fair Value Gap detected."
      );

    }

    else {

      bearish += 10;

      reasons.push(
        "Bearish Fair Value Gap detected."
      );

    }

  }


  /*
    ORDER BLOCK
  */

  if (ob) {

    if (
      ob.type ===
      "BULLISH ORDER BLOCK"
    ) {

      bullish += 10;

      reasons.push(
        "Bullish order block detected."
      );

    }

    else {

      bearish += 10;

      reasons.push(
        "Bearish order block detected."
      );

    }

  }


  /*
    FINAL SCORE
  */

  const maxScore =
    Math.max(
      bullish,
      bearish
    );


  const difference =
    Math.abs(
      bullish -
      bearish
    );


  let direction =
    "WAIT";


  if (
    bullish >= 60 &&
    bullish > bearish
  ) {

    direction =
      "BUY";

  }

  else if (
    bearish >= 60 &&
    bearish > bullish
  ) {

    direction =
      "SELL";

  }


  /*
    CONFIDENCE
  */

  let confidence =
    "C";


  if (
    direction !== "WAIT"
  ) {

    if (
      maxScore >= 85 &&
      difference >= 25
    ) {

      confidence = "A+";

    }

    else if (
      maxScore >= 70 &&
      difference >= 15
    ) {

      confidence = "A";

    }

    else {

      confidence = "B";

    }

  }


  /*
    ATR RISK
  */

  const atr =
    calculateATR(
      data,
      14
    );


  const entry =
    data[data.length - 1].close;


  let sl =
    null;

  let tp1 =
    null;

  let tp2 =
    null;

  let tp3 =
    null;

  let be =
    null;


  /*
    BUY PLAN
  */

  if (
    direction ===
    "BUY"
  ) {

    const structuralSL =
      structure.swingLow
        ? structure.swingLow
        : entry - atr * 1.5;


    sl =
      Math.min(
        structuralSL,
        entry - atr * 1.2
      );


    const risk =
      entry - sl;


    tp1 =
      entry + risk;

    tp2 =
      entry + risk * 2;

    tp3 =
      entry + risk * 3;

    be =
      entry + risk * .8;

  }


  /*
    SELL PLAN
  */

  if (
    direction ===
    "SELL"
  ) {

    const structuralSL =
      structure.swingHigh
        ? structure.swingHigh
        : entry + atr * 1.5;


    sl =
      Math.max(
        structuralSL,
        entry + atr * 1.2
      );


    const risk =
      sl - entry;


    tp1 =
      entry - risk;

    tp2 =
      entry - risk * 2;

    tp3 =
      entry - risk * 3;

    be =
      entry - risk * .8;

  }


  let rr =
    "--";


  if (
    direction !== "WAIT" &&
    sl !== null &&
    tp3 !== null
  ) {

    const risk =
      Math.abs(
        entry - sl
      );


    const reward =
      Math.abs(
        tp3 - entry
      );


    if (risk > 0) {

      rr =
        `1:${(
          reward / risk
        ).toFixed(1)}`;

    }

  }


  return {

    direction,

    confidence,

    bullish,

    bearish,

    score:
      maxScore,

    entry,

    sl,

    be,

    tp1,

    tp2,

    tp3,

    rr,

    atr,

    structure,

    momentum,

    candle,

    fvg,

    ob,

    reasons

  };

}


/* =========================================================
   DISPLAY ANALYSIS
========================================================= */

function displayAnalysis(result) {

  currentAnalysis =
    result;


  /*
    SIGNAL
  */

  const signal =
    $("signal");


  signal.className =
    "signal " +
    (
      result.direction === "BUY"
        ? "buy"
        : result.direction === "SELL"
        ? "sell"
        : "wait"
    );


  signal.textContent =
    result.direction;


  $("confidence").textContent =
    result.direction === "WAIT"
      ? "No valid setup"
      : `Confidence: ${result.confidence}`;


  $("score").textContent =
    `${result.score}/100`;


  /*
    TRADE PLAN
  */

  $("entry").textContent =
    result.entry
      ? fmt(result.entry)
      : "--";


  $("sl").textContent =
    result.sl
      ? fmt(result.sl)
      : "--";


  $("be").textContent =
    result.be
      ? fmt(result.be)
      : "--";


  $("tp1").textContent =
    result.tp1
      ? fmt(result.tp1)
      : "--";


  $("tp2").textContent =
    result.tp2
      ? fmt(result.tp2)
      : "--";


  $("tp3").textContent =
    result.tp3
      ? fmt(result.tp3)
      : "--";


  $("rr").textContent =
    result.rr;


  $("invalidation").textContent =
    result.direction === "BUY"
      ? "Close below SL / structure"
      : result.direction === "SELL"
      ? "Close above SL / structure"
      : "No trade";


  /*
    STRUCTURE
  */

  $("htfBias").textContent =
    result.structure.bias;


  $("structure").textContent =
    result.structure.structure;


  $("swing").textContent =
    result.structure.bias;


  $("swingHigh").textContent =
    result.structure.swingHigh
      ? fmt(result.structure.swingHigh)
      : "--";


  $("swingLow").textContent =
    result.structure.swingLow
      ? fmt(result.structure.swingLow)
      : "--";


  $("bos").textContent =
    result.structure.bos;


  /*
    MOMENTUM
  */

  $("emaStatus").textContent =
    `${result.momentum.emaBias} | ` +
    `${fmt(result.momentum.ema9)} / ` +
    `${fmt(result.momentum.ema21)}`;


  $("rsiStatus").textContent =
    result.momentum.rsi.toFixed(1);


  $("macdStatus").textContent =
    result.momentum.macd.histogram > 0
      ? "BULLISH"
      : result.momentum.macd.histogram < 0
      ? "BEARISH"
      : "NEUTRAL";


  $("vwapStatus").textContent =
    result.momentum.vwapBias;


  $("fvgStatus").textContent =
    result.fvg
      ? result.fvg.type
      : "NONE";


  $("obStatus").textContent =
    result.ob
      ? result.ob.type
      : "NONE";


  $("candleStatus").textContent =
    result.candle.pattern;


  $("momentumStatus").textContent =
    result.momentum.emaBias;


  /*
    ANALYSIS
  */

  let html = "";


  if (
    result.direction ===
    "WAIT"
  ) {

    html += `
      <div class="analysis-line warning">
        NO SETUP — market conditions are not sufficiently aligned.
      </div>
    `;

  }

  else {

    html += `
      <div class="analysis-line">
        <strong>
          ${result.direction}
          ${result.confidence}
          setup detected.
        </strong>
      </div>
    `;

  }


  result.reasons
    .forEach(reason => {

      html += `
        <div class="analysis-line">
          ✓ ${escapeHtml(reason)}
        </div>
      `;

    });


  if (
    result.direction !==
    "WAIT"
  ) {

    html += `

      <br>

      <div class="analysis-line">
        <strong>ENTRY:</strong>
        ${fmt(result.entry)}
      </div>

      <div class="analysis-line">
        <strong>STOP:</strong>
        ${fmt(result.sl)}
      </div>

      <div class="analysis-line">
        <strong>TP1:</strong>
        ${fmt(result.tp1)}
      </div>

      <div class="analysis-line">
        <strong>TP2:</strong>
        ${fmt(result.tp2)}
      </div>

      <div class="analysis-line">
        <strong>TP3:</strong>
        ${fmt(result.tp3)}
      </div>

      <div class="analysis-line">
        <strong>RR:</strong>
        ${result.rr}
      </div>

    `;

  }


  html += `

    <br>

    <div class="analysis-line warning">
      This is automated market analysis,
      not a guarantee of profit.
    </div>

  `;


  $("analysis").innerHTML =
    html;


  /*
    ALERT
  */

  sendSignalAlert(result);

}


/* =========================================================
   RUN ANALYSIS
========================================================= */

function runAnalysis() {

  if (
    !candles ||
    candles.length < 50
  ) {

    $("analysis").innerHTML =
      `<div class="warning">
        Waiting for enough market data...
      </div>`;

    return;

  }


  const result =
    buildSignal(candles);


  displayAnalysis(result);

}


/* =========================================================
   ALERTS
========================================================= */

function sendSignalAlert(result) {

  if (
    !alertsToggle.checked
  ) {

    previousSignal =
      result.direction;

    return;

  }


  if (
    result.direction ===
    "WAIT"
  ) {

    previousSignal =
      result.direction;

    return;

  }


  const current =
    `${result.direction}-${result.confidence}`;


  if (
    current ===
    previousSignal
  ) {

    return;

  }


  previousSignal =
    current;


  if (
    "Notification" in window
  ) {

    if (
      Notification.permission ===
      "granted"
    ) {

      new Notification(
        `PRECISION SNIPER AI — ${result.direction}`,
        {

          body:
            `${result.confidence} setup | ` +
            `Entry ${fmt(result.entry)} | ` +
            `SL ${fmt(result.sl)} | ` +
            `TP3 ${fmt(result.tp3)}`

        }

      );

    }

  }

}


/* =========================================================
   ENABLE NOTIFICATIONS
========================================================= */

alertsToggle.addEventListener(
  "change",
  async () => {

    if (
      alertsToggle.checked &&
      "Notification" in window
    ) {

      try {

        await Notification.requestPermission();

      }

      catch {}

    }

  }
);


/* =========================================================
   QUESTION BAR
========================================================= */

function answerQuestion(question) {

  if (
    !currentAnalysis
  ) {

    return "Run a market analysis first.";

  }


  const q =
    question
      .toLowerCase()
      .trim();


  const r =
    currentAnalysis;


  if (
    q.includes("why") &&
    (
      q.includes("buy") ||
      q.includes("sell") ||
      q.includes("signal")
    )
  ) {

    if (
      r.direction ===
      "WAIT"
    ) {

      return `
        There is currently no valid BUY or SELL setup.
        The strategy requires structure, location,
        candle confirmation and momentum to align.
      `;

    }


    return `
      The ${r.direction} signal is based on
      ${r.confidence} confluence.

      Structure:
      ${r.structure.bias}.

      EMA:
      ${r.momentum.emaBias}.

      RSI:
      ${r.momentum.rsi.toFixed(1)}.

      Candle:
      ${r.candle.pattern}.

      The engine does not use one indicator alone.
      It requires multiple conditions to agree.
    `;

  }


  if (
    q.includes("sl") ||
    q.includes("stop")
  ) {

    return `
      The Stop Loss is placed beyond the
      recent structural swing or ATR-based
      risk boundary.

      Current SL:
      ${fmt(r.sl)}.

      The purpose is to invalidate the trade
      if the expected market structure fails.
    `;

  }


  if (
    q.includes("tp") ||
    q.includes("take profit")
  ) {

    return `
      Targets are calculated from the risk distance.

      TP1:
      ${fmt(r.tp1)}

      TP2:
      ${fmt(r.tp2)}

      TP3:
      ${fmt(r.tp3)}

      TP3 targets approximately 3R when
      a valid setup exists.
    `;

  }


  if (
    q.includes("fvg")
  ) {

    return r.fvg

      ? `
        A ${r.fvg.type} was detected.

        FVG zone:
        ${fmt(r.fvg.low)}
        to
        ${fmt(r.fvg.high)}.

        It represents an imbalance between
        price candles and may act as a reaction
        or retracement area.
      `

      : `
        No recent Fair Value Gap was detected
        in the current closed-candle data.
      `;

  }


  if (
    q.includes("rsi")
  ) {

    return `
      RSI is currently
      ${r.momentum.rsi.toFixed(2)}.

      RSI above 50 generally supports bullish
      momentum while RSI below 50 supports
      bearish momentum.

      RSI is not used alone to create a trade.
    `;

  }


  if (
    q.includes("ema")
  ) {

    return `
      EMA 9:
      ${fmt(r.momentum.ema9)}

      EMA 21:
      ${fmt(r.momentum.ema21)}

      Current EMA bias:
      ${r.momentum.emaBias}.
    `;

  }


  if (
    q.includes("structure") ||
    q.includes("bos") ||
    q.includes("choch")
  ) {

    return `
      Current market structure:
      ${r.structure.structure}.

      Bias:
      ${r.structure.bias}.

      Structure event:
      ${r.structure.bos}.

      The strategy gives market structure
      priority over individual indicators.
    `;

  }


  if (
    q.includes("risk") ||
    q.includes("rr")
  ) {

    return `
      Current planned Risk/Reward:
      ${r.rr}.

      The system uses the structural swing
      and ATR to calculate the invalidation
      point, then projects TP targets from
      the risk distance.
    `;

  }


  return `
    I can explain:

    • Why this is BUY/SELL/WAIT
    • Stop Loss
    • TP1/TP2/TP3
    • FVG
    • Order Block
    • RSI
    • EMA
    • BOS/CHOCH
    • Market structure
    • Risk/Reward

    Ask something specific about the current setup.
  `;

}


askBtn.addEventListener(
  "click",
  () => {

    const question =
      questionInput.value;

    if (!question.trim())
      return;


    $("answer").textContent =
      answerQuestion(question);

  }
);


questionInput.addEventListener(
  "keydown",
  event => {

    if (
      event.key ===
      "Enter"
    ) {

      askBtn.click();

    }

  }
);


/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(text) {

  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

}


/* =========================================================
   BUTTON
========================================================= */

analyzeBtn.addEventListener(
  "click",
  () => {

    loadMarket();

  }
);


/* =========================================================
   MARKET / TIMEFRAME CHANGE
========================================================= */

symbolSelect.addEventListener(
  "change",
  () => {

    loadMarket();

  }
);


timeframeSelect.addEventListener(
  "change",
  () => {

    loadMarket();

  }
);


/* =========================================================
   AUTO ANALYSIS
========================================================= */

function startAutoAnalysis() {

  if (analysisTimer) {

    clearInterval(
      analysisTimer
    );

  }


  /*
    Refresh every 60 seconds.

    This is intentionally slower than
    the market tick stream because the
    strategy analyzes CLOSED candles.
  */

  analysisTimer =
    setInterval(
      () => {

        loadMarket();

      },
      60000
    );

}


/* =========================================================
   INITIALIZE
========================================================= */

async function initialize() {

  $("displayTimeframe").textContent =
    timeframeText(
      timeframeSelect.value
    );


  await loadMarket();


  startAutoAnalysis();

}


initialize();
