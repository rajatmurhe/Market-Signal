// Mocking the STATE
const STATE = {
  watchlist: [
    { symbol: 'TCS.NS', name: 'TCS', price: 3500.5, changePercent: 1.2 },
    { symbol: 'RELIANCE.NS', name: 'Reliance Industries', price: 2900.0, changePercent: -0.5 },
    { symbol: 'WIPRO.NS', name: 'Wipro', price: 450.0, changePercent: 2.1 }
  ],
  signals: [
    { symbol: 'TCS.NS', name: 'TCS', direction: 'Bullish', sentiment_score: 85, confidence: 0.9, reason: 'Strong earnings.' },
    { symbol: 'WIPRO.NS', name: 'Wipro', direction: 'Bearish', sentiment_score: 30, confidence: 0.8, reason: 'Weak guidance.' }
  ],
  marketData: {
    'NIFTY50': { price: 22000, changePercent: 0.8 }
  }
};

function fmtPrice(p) { return '₹' + p; }
function fmtPct(p) { return p + '%'; }

function generateAIResponse(query) {
  const q = query.toLowerCase();
  
  // 1. Identify intent
  const wantsPrice = q.includes('price') || q.includes('trading') || q.includes('how much') || q.includes('how is');
  const wantsSentiment = q.includes('sentiment') || q.includes('news') || q.includes('feeling') || q.includes('think') || q.includes('opinion');
  const wantsPrediction = q.includes('predict') || q.includes('buy') || q.includes('sell') || q.includes('target') || q.includes('should i') || q.includes('recommend') || q.includes('forecast') || q.includes('invest');
  
  // 2. Identify Stock robustly using aliases
  const aliases = {
    'RELIANCE.NS': ['reliance', 'ril', 'reilance'],
    'TCS.NS': ['tcs', 'tata consultancy'],
    'INFY.NS': ['infy', 'infosys', 'infosis'],
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
    // Regex boundary match to prevent "itc" matching inside "pitch" or "lt" matching inside "felt"
    if (names.some(n => new RegExp(`\\b${n}\\b`, 'i').test(q)) || q.includes(sym.toLowerCase().replace('.ns', ''))) {
      targetSymbol = sym;
      targetName = names[0].charAt(0).toUpperCase() + names[0].slice(1);
      if (sym === 'TCS.NS') targetName = 'TCS';
      if (sym === 'LT.NS') targetName = 'L&T';
      if (sym === 'ITC.NS') targetName = 'ITC';
      if (sym === 'SBIN.NS') targetName = 'SBI';
      break;
    }
  }

  // 3. Handle unidentified / out-of-scope stocks
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

  // 4. Fetch actual live data if available
  const stockData = (STATE.watchlist || []).find(w => w.symbol === targetSymbol);
  const actualName = stockData ? stockData.name : targetName;
  const sig = (STATE.signals || []).find(s => s.symbol === targetSymbol);

  // 5. Generate Response
  if (wantsPrediction || q.includes('what should')) {
    if (sig) {
      const upProb = sig.sentiment_score * (sig.confidence || 0.8) * 1.5;
      const finalProb = Math.min(Math.max(upProb, 10), 90);
      return `Based on my AI prediction models, <strong>${actualName}</strong> has a <strong>${finalProb.toFixed(1)}% probability</strong> of upward momentum. <br><br>The Fair Value for a YES contract on Yeno is <strong>₹${(finalProb/10).toFixed(1)}</strong>. <br><br><em>(Not financial advice)</em>`;
    } else {
      return `I don't have enough recent prediction signals for ${actualName} right now.`;
    }
  }
  
  if (wantsSentiment) {
    if (sig) {
      const cls = sig.direction.toLowerCase() === 'bullish' ? 'var(--bullish)' : (sig.direction.toLowerCase() === 'bearish' ? 'var(--bearish)' : 'var(--text-muted)');
      return `The current news sentiment for <strong>${actualName}</strong> is <strong style="color:${cls}">${sig.direction.toUpperCase()}</strong> (Score: ${sig.sentiment_score}). <br><br>Reasoning: ${sig.reason}`;
    } else {
      return `I am still analyzing the latest news corpus for ${actualName}. Please try again in a few seconds.`;
    }
  }
  
  // Default to price or general summary
  if (stockData) {
    return `<strong>${actualName}</strong> is currently trading at <strong>${fmtPrice(stockData.price)}</strong>. <br>Today's change is <span class="${stockData.changePercent >= 0 ? 'up' : 'down'}">${fmtPct(stockData.changePercent)}</span>. <br><br>You can also ask me about its sentiment or AI predictions!`;
  } else {
    return `I know you are asking about <strong>${actualName}</strong>, but its live market data hasn't finished loading from the exchange yet. Please try again in a few moments!`;
  }
}

const tests = [
  "tell me about tcs",
  "what is the price of tcs?",
  "should i invest in wipro?",
  "give me the sentiment for reliance",
  "what do you think about HDFC bank?",
  "is the market up today?",
  "tell me about tata motors",
  "i have 100 shares of infosis, what's the forecast?", // Typo handling
  "how is sbi feeling?",
  "just wipro",
  "is it a good idea to buy l&t right now?",
  "i felt like buying", // Edge case: "felt" contains "lt"! Word boundary check needed!
];

console.log("=== CHATBOT NATURAL LANGUAGE TEST ===");
for (let t of tests) {
  console.log(`\nUser: "${t}"`);
  console.log(`AI: ${generateAIResponse(t).replace(/<[^>]*>?/gm, '')}`); // Strip HTML tags for console
}
