// Mock Global API for testing the dynamic fetch fallback
global.API = {
  stockDetail: async (sym) => {
    return { data: { price: 999, changePercent: 1.5 } };
  }
};
global.addChatMessage = (msg, sender) => {
    // Mock for chat insertion
};
global.fmtPrice = (p) => '₹' + p;
global.fmtPct = (p) => p + '%';

const STATE = {
  marketData: { 'NIFTY50': { price: 22000, changePercent: 0.8 } },
  stockData: {
    'TCS.NS': { symbol: 'TCS.NS', name: 'TCS', price: 3500.5, changePercent: 1.2 },
    'RELIANCE.NS': { symbol: 'RELIANCE.NS', name: 'Reliance Industries', price: 2900, changePercent: -0.5 },
    'LT.NS': { symbol: 'LT.NS', name: 'Larsen & Toubro', price: 3750, changePercent: 2.1 }
  },
  signals: [
    { symbol: 'TCS.NS', name: 'TCS', direction: 'Bullish', sentiment_score: 85, confidence: 0.9, reason: 'Strong earnings.' },
    { symbol: 'RELIANCE.NS', name: 'Reliance Industries', direction: 'Bearish', sentiment_score: 30, confidence: 0.8, reason: 'Weak guidance.' }
  ]
};

function matchesAlias(query, alias) {
  const escaped = alias.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
  const regex = new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, 'i');
  return regex.test(query);
}

function generateAIResponse(query) {
  const q = query.toLowerCase();
  
  const wantsPrice = q.includes('price') || q.includes('trading') || q.includes('how much') || q.includes('how is');
  const wantsSentiment = q.includes('sentiment') || q.includes('news') || q.includes('feeling') || q.includes('think');
  const wantsPrediction = q.includes('predict') || q.includes('buy') || q.includes('sell') || q.includes('target') || q.includes('should i') || q.includes('recommend');
  
  const aliases = {
    'RELIANCE.NS': ['reliance', 'ril'],
    'TCS.NS': ['tcs', 'tata consultancy'],
    'INFY.NS': ['infy', 'infosys'],
    'HDFCBANK.NS': ['hdfc', 'hdfc bank'],
    'ICICIBANK.NS': ['icici', 'icici bank'],
    'SBIN.NS': ['sbi', 'state bank'],
    'BHARTIARTL.NS': ['airtel', 'bharti'],
    'LT.NS': ['l&t', 'larsen', 'lt'],
    'ITC.NS': ['itc'],
    'WIPRO.NS': ['wipro']
  };

  let targetSymbol = null;
  let targetName = null;
  
  for (const [sym, names] of Object.entries(aliases)) {
    if (names.some(n => matchesAlias(q, n)) || matchesAlias(q, sym.toLowerCase().replace('.ns', ''))) {
      targetSymbol = sym;
      targetName = names[0].charAt(0).toUpperCase() + names[0].slice(1);
      if (sym === 'TCS.NS') targetName = 'TCS';
      if (sym === 'LT.NS') targetName = 'L&T';
      if (sym === 'ITC.NS') targetName = 'ITC';
      if (sym === 'SBIN.NS') targetName = 'SBI';
      break;
    }
  }

  if (!targetSymbol) {
    if (q.includes('market') || q.includes('nifty')) {
      const n = (STATE.marketData || {})['NIFTY50'];
      if (n) return `The market is currently ${n.changePercent >= 0 ? 'up' : 'down'}. NIFTY 50 is at ${fmtPrice(n.price)} (${fmtPct(n.changePercent)}).`;
      return "The market data is still loading, please wait a moment.";
    }
    if (q.includes('tata motors')) {
       return "I currently only monitor TCS (Tata Consultancy Services) among the Tata group companies on my active dashboard. Try asking: 'What is the sentiment for TCS?'";
    }
    if (q.includes('tata')) {
       return "If you are looking for Tata companies, I currently track TCS. Try asking about TCS!";
    }
    return "I couldn't identify a specific stock from my active watchlist in your query. I currently monitor major NIFTY stocks like Reliance, TCS, Infosys, HDFC, SBI, Airtel, L&T, ITC, and Wipro.";
  }

  const stockData = (STATE.stockData || {})[targetSymbol];
  const actualName = stockData ? stockData.name : targetName;
  const sig = (STATE.signals || []).find(s => s.symbol === targetSymbol);

  if (wantsPrediction || q.includes('what should')) {
    if (sig) {
      const upProb = sig.sentiment_score * (sig.confidence || 0.8) * 1.5;
      const finalProb = Math.min(Math.max(upProb, 10), 90);
      return `[PREDICTION] Based on my AI prediction models, ${actualName} has a ${finalProb.toFixed(1)}% probability...`;
    } else {
      return `[PREDICTION FAIL] I don't have enough recent prediction signals for ${actualName} right now.`;
    }
  }
  
  if (wantsSentiment) {
    if (sig) {
      return `[SENTIMENT] The current news sentiment for ${actualName} is ${sig.direction.toUpperCase()}...`;
    } else {
      return `[SENTIMENT FAIL] I am still analyzing the latest news corpus for ${actualName}.`;
    }
  }
  
  if (stockData) {
    return `[PRICE] ${actualName} is currently trading at ${fmtPrice(stockData.price)}.`;
  } else {
    // ACTIVE FETCH FALLBACK
    return `[DYNAMIC FETCH] Let me fetch the latest live data for ${actualName} from the exchange right now...`;
  }
}

const testCases = [
  // 1. Exact Matches (Intent + Symbol)
  { prompt: "what is the price of tcs", expected: "[PRICE]" },
  { prompt: "should i buy tcs", expected: "[PREDICTION]" },
  { prompt: "what is the news feeling for reliance", expected: "[SENTIMENT]" },
  
  // 2. Default Intent (Just naming the stock)
  { prompt: "l&t", expected: "[PRICE]" },
  { prompt: "ril", expected: "[PRICE]" },
  
  // 3. Regex Boundaries (Anti-False-Positive)
  { prompt: "i felt like buying", expected: "I couldn't identify" }, // "felt" contains "lt"
  { prompt: "pitch it", expected: "I couldn't identify" }, // "pitch" contains "itc"
  { prompt: "switch it off", expected: "I couldn't identify" }, // "switch" contains "itc"
  { prompt: "infusion", expected: "I couldn't identify" }, // "infusion" contains "infy" (wait, it shouldn't match)
  
  // 4. Fallbacks (Out of scope)
  { prompt: "tata motors", expected: "I currently only monitor TCS" },
  { prompt: "how is tata doing", expected: "If you are looking for Tata companies" },
  { prompt: "how is the market", expected: "The market is currently" },
  
  // 5. Dynamic Fetch Logic (Stock identified, but NO data in STATE)
  { prompt: "wipro", expected: "[DYNAMIC FETCH]" }, // Wipro is NOT in our mock STATE above
  { prompt: "price of infosys", expected: "[DYNAMIC FETCH]" }, // INFY is NOT in our mock STATE above
  
  // 6. Signal Missing (Stock identified, data present, but NO signal in STATE)
  { prompt: "should i buy l&t", expected: "[PREDICTION FAIL]" } // LT has price data but no signal in mock
];

console.log("=== EXHAUSTIVE CHATBOT UNIT TESTS ===");
let passed = 0;
for (const tc of testCases) {
  const result = generateAIResponse(tc.prompt);
  const success = result.includes(tc.expected);
  console.log(`[${success ? 'PASS' : 'FAIL'}] Prompt: "${tc.prompt}"`);
  if (!success) {
      console.log(`   Expected to contain: "${tc.expected}"`);
      console.log(`   Actual output: "${result}"`);
  } else {
      passed++;
  }
}
console.log(`\nRESULTS: ${passed}/${testCases.length} Passed.`);
