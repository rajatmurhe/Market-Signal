const STATE = {
  stockData: {
    'TCS.NS': { symbol: 'TCS.NS', name: 'TCS', price: 3500.5, changePercent: 1.2 },
    'WIPRO.NS': { symbol: 'WIPRO.NS', name: 'Wipro', price: 450.0, changePercent: 2.1 }
  },
  signals: []
};

function fmtPrice(p) { return '₹' + p; }
function fmtPct(p) { return p + '%'; }

function generateAIResponse(query) {
  const q = query.toLowerCase();
  
  // 1. Identify intent
  const wantsPrice = q.includes('price') || q.includes('trading') || q.includes('how much') || q.includes('how is');
  
  // 2. Identify Stock robustly using aliases
  const aliases = {
    'TCS.NS': ['tcs', 'tata consultancy'],
    'WIPRO.NS': ['wipro']
  };

  let targetSymbol = null;
  let targetName = null;
  
  for (const [sym, names] of Object.entries(aliases)) {
    const symShort = sym.toLowerCase().replace('.ns', '');
    const regexSym = new RegExp(`(^|[^a-zA-Z0-9])${symShort}([^a-zA-Z0-9]|$)`, 'i');
    
    if (names.some(n => new RegExp(`(^|[^a-zA-Z0-9])${n.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}([^a-zA-Z0-9]|$)`, 'i').test(q)) || regexSym.test(q)) {
      targetSymbol = sym;
      targetName = names[0].charAt(0).toUpperCase() + names[0].slice(1);
      if (sym === 'TCS.NS') targetName = 'TCS';
      break;
    }
  }

  if (!targetSymbol) return "I couldn't identify a specific stock...";

  // 4. Fetch actual live data if available
  const stockData = (STATE.stockData || {})[targetSymbol];
  const actualName = stockData ? stockData.name : targetName;

  // Default to price or general summary
  if (stockData) {
    return `<strong>${actualName}</strong> is currently trading at <strong>${fmtPrice(stockData.price)}</strong>. <br>Today's change is <span class="${stockData.changePercent >= 0 ? 'up' : 'down'}">${fmtPct(stockData.changePercent)}</span>. <br><br>You can also ask me about its sentiment or AI predictions!`;
  } else {
    return `I know you are asking about <strong>${actualName}</strong>, but its live market data hasn't finished loading from the exchange yet. Please try again in a few moments!`;
  }
}

console.log("TEST 1:", generateAIResponse("tell about wipro"));
console.log("TEST 2:", generateAIResponse("what is wipro price"));
