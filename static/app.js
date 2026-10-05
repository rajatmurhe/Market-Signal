/**
 * Market-Signal — Market Intelligence Terminal
 * Frontend Application (app.js)
 * Connects to Flask backend at /api/*
 */

'use strict';

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  API_BASE: 'http://localhost:5001',  // Flask backend
  POLL_NEWS_MS:     90_000,   // 90s news refresh
  POLL_MARKET_MS:   60_000,   // 60s market data refresh
  POLL_SIGNALS_MS: 120_000,   // 2min signals refresh
  NEWS_PAGE_SIZE:   15,
  DEBOUNCE_SEARCH:  350,
  WATCHLIST_SYMBOLS: [
    'RELIANCE.NS','TCS.NS','INFY.NS','HDFCBANK.NS',
    'ICICIBANK.NS','SBIN.NS','BHARTIARTL.NS','LT.NS','ITC.NS','WIPRO.NS'
  ],
};

// ============================================================
// STATE
// ============================================================
const STATE = {
  balance: parseFloat(localStorage.getItem('yeno_balance')) || 10000,
  tradeConfig: null,
  newsFilter:   'all',
  sectorFilter: '',
  newsPage:     1,
  allArticles:  [],
  selectedStock: null,
  signals:      [],
  alerts:       [],
  sentimentData: null,
  marketData:   null,
  stockData:    {},
  searchTimeout: null,
  pollingTimers: [],
};

// ============================================================
// API LAYER
// ============================================================
const API = {
  async get(path) {
    const res = await fetch(CONFIG.API_BASE + path);
    if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
    const json = await res.json();
    if (json.success === false) throw new Error(json.error || 'API error');
    return json;
  },
  async post(path, body) {
    const res = await fetch(CONFIG.API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
    return res.json();
  },

  news(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.get(`/api/news${q ? '?' + q : ''}`);
  },
  newsById(id) { return this.get(`/api/news/${id}`); },
  stocks(symbols) { return this.get(`/api/stocks?symbols=${symbols.join(',')}`); },
  stockDetail(sym) { return this.get(`/api/stocks/${sym}`); },
  sentiment(q) { return this.get(`/api/sentiment?q=${encodeURIComponent(q)}`); },
  market() { return this.get('/api/market'); },
  sectors() { return this.get('/api/sectors'); },
  signals() { return this.get('/api/signals'); },
  alerts() { return this.get('/api/alerts'); },
  search(q) { return this.get(`/api/search?q=${encodeURIComponent(q)}`); },
  ticker() { return this.get('/api/ticker'); },
  analyze(text) { return this.post('/api/analyze', { text }); },
  health() { return this.get('/health'); },
};

// ============================================================
// HELPERS
// ============================================================
function fmt(val, dec = 2) {
  if (val == null || isNaN(val)) return '—';
  return Number(val).toFixed(dec);
}
function fmtPrice(val) {
  if (val == null || isNaN(val)) return '—';
  return '₹' + Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(val) {
  if (val == null || isNaN(val)) return '—';
  const sign = val >= 0 ? '+' : '';
  return sign + Number(val).toFixed(2) + '%';
}
function fmtLargeNum(val) {
  if (val == null || isNaN(val)) return '—';
  if (val >= 1e12) return (val / 1e12).toFixed(2) + 'T';
  if (val >= 1e9) return (val / 1e9).toFixed(2) + 'B';
  if (val >= 1e7) return (val / 1e7).toFixed(2) + 'Cr';
  if (val >= 1e5) return (val / 1e5).toFixed(2) + 'L';
  return val.toLocaleString();
}
function timeAgo(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = Math.floor((now - d.getTime()) / 1000);
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  } catch { return dateStr; }
}
function sentimentClass(sentiment, score) {
  if (typeof score === 'number') {
    if (score >= 60) return 'bullish';
    if (score <= 40) return 'bearish';
    return 'neutral';
  }
  const s = (sentiment || '').toLowerCase();
  if (s === 'positive' || s === 'bullish') return 'bullish';
  if (s === 'negative' || s === 'bearish') return 'bearish';
  return 'neutral';
}
function sentimentLabel(cls) {
  if (cls === 'bullish') return 'BULLISH';
  if (cls === 'bearish') return 'BEARISH';
  return 'NEUTRAL';
}
function impactClass(impact) {
  if (!impact) return 'low';
  return impact.toLowerCase();
}
function scoreColor(score) {
  if (score >= 60) return 'var(--bullish)';
  if (score <= 40) return 'var(--bearish)';
  return 'var(--neutral)';
}
function el(tag, cls = '', html = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}
function qs(sel) { return document.querySelector(sel); }
function qsa(sel) { return document.querySelectorAll(sel); }
function stripNseSuffix(sym) { return sym.replace(/\.NS$/, ''); }

// ============================================================
// TOAST
// ============================================================
function toast(msg, type = 'info', duration = 3500) {
  const c = qs('#toastContainer');
  const t = el('div', `toast ${type}`, msg);
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)';
    setTimeout(() => t.remove(), 300); }, duration);
}

// ============================================================
// CLOCK
// ============================================================
function startClock() {
  function tick() {
    const d = new Date();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const clockEl = qs('#clockDisplay');
    if (clockEl) clockEl.textContent = `${h}:${m}:${s}`;
    // Market status
    const marketStatusEl = qs('#marketStatusText');
    const statusDot = qs('#marketStatusDot');
    const hour = d.getHours(), min = d.getMinutes();
    const mins = hour * 60 + min;
    const day = d.getDay();
    const isWeekday = day >= 1 && day <= 5;
    const isOpen = isWeekday && mins >= 555 && mins < 930; // 9:15 - 15:30
    if (marketStatusEl) marketStatusEl.textContent = isOpen ? 'NSE OPEN' : 'NSE CLOSED';
    if (statusDot) statusDot.className = 'status-dot' + (isOpen ? '' : ' closed');
  }
  tick();
  setInterval(tick, 1000);
}

// ============================================================
// LAST UPDATED
// ============================================================
function setLastUpdated() {
  const el = qs('#lastUpdatedTime');
  if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString();
}

// ============================================================
// TICKER BAR
// ============================================================
async function loadTicker() {
  try {
    const res = await API.ticker();
    const items = res.data || [];
    if (!items.length) return;
    const track = qs('#tickerTrack');
    const render = (list) => list.map(item => {
      const chg = item.changePercent;
      const cls = chg >= 0 ? 'up' : 'down';
      const sign = chg >= 0 ? '+' : '';
      return `<span class="ticker-item">
        <span class="ticker-sym">${item.symbol}</span>
        <span class="ticker-price">${fmtPrice(item.price)}</span>
        <span class="ticker-chg ${cls}">${sign}${fmt(chg)}%</span>
      </span>`;
    }).join('');
    // duplicate for seamless loop
    track.innerHTML = render(items) + render(items);
  } catch (e) {
    console.warn('Ticker error:', e.message);
  }
}

// ============================================================
// MARKET INDICES
// ============================================================
async function loadMarketData() {
  try {
    const res = await API.market();
    STATE.marketData = res.data || {};
    renderIndices();
    renderIntelMetrics();
    setLastUpdated();
  } catch (e) {
    console.warn('Market data error:', e.message);
    renderIndicesError();
  }
}

function renderIndices() {
  const d = STATE.marketData;
  const cont = qs('#indicesItems');
  if (!d || !cont) return;

  const indices = [
    { key: 'NIFTY50', name: 'NIFTY 50' },
    { key: 'SENSEX', name: 'SENSEX' },
    { key: 'BANKNIFTY', name: 'BANK NIFTY' },
  ];

  cont.innerHTML = indices.map(idx => {
    const item = d[idx.key] || {};
    const chg = item.changePercent || 0;
    const cls = chg >= 0 ? 'up' : 'down';
    return `<div class="index-row">
      <div class="index-top">
        <span class="index-name">${idx.name}</span>
        <span class="index-chg ${cls}">${fmtPct(chg)}</span>
      </div>
      <div class="index-bottom">
        <span class="index-price mono">${fmtPrice(item.price)}</span>
        <svg class="index-spark" width="60" height="20">${generateSparkSVG(item.sparkline || [])}</svg>
      </div>
    </div>`;
  }).join('');
}

function renderIndicesError() {
  const cont = qs('#indicesItems');
  if (cont) cont.innerHTML = '<div class="empty-state"><div class="empty-state-text">Market data unavailable</div></div>';
}

function generateSparkSVG(data) {
  if (!data || data.length < 2) return '';
  const w = 60, h = 20;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  const isUp = data[data.length - 1] >= data[0];
  const color = isUp ? 'var(--bullish)' : 'var(--bearish)';
  return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/>`;
}

// ============================================================
// INTEL METRICS
// ============================================================
function renderIntelMetrics() {
  const cont = qs('#intelMetrics');
  if (!cont) return;
  const s = STATE.sentimentData || {};
  const m = STATE.marketData || {};

  const nifty = m.NIFTY50 || {};
  const niftyClass = (nifty.changePercent || 0) >= 0 ? 'bullish' : 'bearish';

  const bullPct = s.positive_pct || 0;
  const bearPct = s.negative_pct || 0;
  const overallScore = s.overall_score || 50;
  const overallClass = overallScore >= 60 ? 'bullish' : overallScore <= 40 ? 'bearish' : '';
  const sentLabel = overallScore >= 60 ? 'BULLISH' : overallScore <= 40 ? 'BEARISH' : 'NEUTRAL';

  const total = s.total_articles || STATE.allArticles.length || 0;
  const highImpact = STATE.allArticles.filter(a => (a.impact || '').toLowerCase() === 'high').length;

  cont.innerHTML = `
    <div class="metric-card">
      <div class="metric-label">MARKET SENT.</div>
      <span class="metric-value ${overallClass}">${sentLabel}</span>
      <div class="metric-sub">Score: ${overallScore}/100</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">NEWS VELOCITY</div>
      <span class="metric-value">${total}</span>
      <div class="metric-sub">articles tracked</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">BULLISH NEWS</div>
      <span class="metric-value bullish">${bullPct}%</span>
      <div class="metric-sub">of analyzed articles</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">BEARISH NEWS</div>
      <span class="metric-value bearish">${bearPct}%</span>
      <div class="metric-sub">of analyzed articles</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">HIGH IMPACT</div>
      <span class="metric-value warning">${highImpact}</span>
      <div class="metric-sub">critical events</div>
    </div>
  `;
}

// ============================================================
// WATCHLIST
// ============================================================
async function loadWatchlist() {
  try {
    const res = await API.stocks(CONFIG.WATCHLIST_SYMBOLS);
    STATE.stockData = res.data || {};
    renderWatchlist();
  } catch (e) {
    console.warn('Watchlist error:', e.message);
    renderWatchlistError();
  }
}

function renderWatchlist() {
  const cont = qs('#watchlistItems');
  if (!cont) return;
  const stocks = STATE.stockData;

  if (!Object.keys(stocks).length) {
    cont.innerHTML = '<div class="empty-state"><div class="empty-state-text">No data</div></div>';
    return;
  }

  cont.innerHTML = Object.entries(stocks).map(([sym, s]) => {
    if (!s) return '';
    const chg = s.changePercent || 0;
    const cls = chg >= 0 ? 'up' : 'down';
    const isSelected = STATE.selectedStock === sym;
    return `<div class="watchlist-row${isSelected ? ' selected' : ''}" data-sym="${sym}">
      <div class="wl-left">
        <span class="wl-sym">${stripNseSuffix(sym)}</span>
        <span class="wl-name">${s.name || ''}</span>
      </div>
      <div class="wl-right">
        <span class="wl-price">${fmtPrice(s.price)}</span>
        <span class="wl-chg ${cls}">${fmtPct(chg)}</span>
      </div>
    </div>`;
  }).join('');

  // click handlers
  cont.querySelectorAll('.watchlist-row').forEach(row => {
    row.addEventListener('click', () => openStockModal(row.dataset.sym));
  });
}

function renderWatchlistError() {
  const cont = qs('#watchlistItems');
  if (cont) cont.innerHTML = '<div class="empty-state"><div class="empty-state-text">Price data unavailable</div></div>';
}

// ============================================================
// SECTOR SENTIMENT
// ============================================================
async function loadSectors() {
  try {
    const res = await API.sectors();
    STATE.sectorData = res.data || [];
    renderSectorSentiment(res.data || []);
  } catch (e) {
    console.warn('Sectors error:', e.message);
  }
}

function renderSectorSentiment(sectors) {
  const cont = qs('#sectorSentiment');
  if (!cont) return;

  if (!sectors.length) {
    cont.innerHTML = '<div class="empty-state"><div class="empty-state-text">Loading sectors…</div></div>';
    return;
  }

  cont.innerHTML = sectors.map(s => {
    const score = s.score || 50;
    const cls = score >= 60 ? 'bullish' : score <= 40 ? 'bearish' : 'neutral';
    const barWidth = score;
    return `<div class="sector-row">
      <span class="sector-name">${s.name}</span>
      <div class="sector-bar-wrap">
        <div class="sector-bar ${cls}" style="width:${barWidth}%"></div>
      </div>
      <span class="sector-score ${cls}">${score}</span>
    </div>`;
  }).join('');
}

// ============================================================
// AI SIGNALS
// ============================================================
async function loadSignals() {
  try {
    const res = await API.signals();
    STATE.signals = res.data || [];
    renderSignals();
    renderInsights();
  } catch (e) {
    console.warn('Signals error:', e.message);
    renderSignalsError();
  }
}

function renderSignals() {
  const cont = qs('#signalsRow');
  if (!cont) return;

  if (!STATE.signals.length) {
    cont.innerHTML = '<div class="empty-state"><div class="empty-state-text">Computing signals…</div></div>';
    return;
  }

  cont.innerHTML = STATE.signals.map(sig => {
    const cls = sentimentClass(sig.direction);
    const scoreColor_ = scoreColor(sig.sentiment_score);
    const impCls = impactClass(sig.impact);
    const momentum = sig.news_momentum >= 0 ? '+' + sig.news_momentum : sig.news_momentum;
    return `<div class="signal-card ${cls}" data-sym="${sig.symbol}">
      <div class="signal-top">
        <span class="signal-sym">${stripNseSuffix(sig.symbol)}</span>
        <span class="signal-dir ${cls}">${(sig.direction || 'NEUTRAL').toUpperCase()}</span>
      </div>
      <div class="signal-score-row">
        <div class="signal-score-item">
          <div class="signal-score-lbl">AI Score</div>
          <div class="signal-score-val" style="color:${scoreColor_}">${sig.sentiment_score}</div>
        </div>
        <div class="signal-score-item">
          <div class="signal-score-lbl">Confidence</div>
          <div class="signal-score-val">${Math.round((sig.confidence || 0.5) * 100)}%</div>
        </div>
        <div class="signal-score-item">
          <div class="signal-score-lbl">Momentum</div>
          <div class="signal-score-val" style="color:${sig.news_momentum >= 0 ? 'var(--bullish)' : 'var(--bearish)'}">${momentum}%</div>
        </div>
      </div>
      <div class="signal-impact ${impCls}">IMPACT: ${(sig.impact || 'LOW').toUpperCase()}</div>
      <div class="signal-reason">${sig.reason || '—'}</div>
    </div>`;
  }).join('');

  // click signal → open stock modal
  cont.querySelectorAll('.signal-card[data-sym]').forEach(c => {
    c.addEventListener('click', () => openStockModal(c.dataset.sym));
  });
}

function renderSignalsError() {
  const cont = qs('#signalsRow');
  if (cont) cont.innerHTML = '<div class="error-state"><div class="error-state-icon">⚠</div><div class="error-state-text">Could not compute signals</div></div>';
}

// ============================================================
// AI INSIGHTS (right sidebar)
// ============================================================
function renderInsights() {
  const cont = qs('#aiInsights');
  if (!cont) return;

  const items = STATE.signals.slice(0, 4);
  if (!items.length) {
    cont.innerHTML = '<div class="empty-state"><div class="empty-state-text">No insights yet</div></div>';
    return;
  }

  cont.innerHTML = items.map(sig => {
    const cls = sentimentClass(sig.direction);
    return `<div class="insight-card">
      <div class="insight-ticker-row">
        <span class="insight-ticker">${stripNseSuffix(sig.symbol)}</span>
        <span class="insight-dir ${cls}">${(sig.direction || 'NEUTRAL').toUpperCase()}</span>
      </div>
      <div class="insight-text">${sig.reason || '—'}</div>
      <div class="insight-meta">
        <span>Impact: <strong>${sig.impact || '—'}</strong></span>
        <span class="insight-conf">Conf: ${Math.round((sig.confidence || 0.5) * 100)}%</span>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// ALERTS
// ============================================================
async function loadAlerts() {
  try {
    const res = await API.alerts();
    STATE.alerts = res.data || [];
    renderAlerts();
  } catch (e) {
    console.warn('Alerts error:', e.message);
  }
}

function renderAlerts() {
  const cont = qs('#alertsList');
  const countEl = qs('#alertCount');
  if (!cont) return;

  if (countEl) countEl.textContent = STATE.alerts.length;

  if (!STATE.alerts.length) {
    cont.innerHTML = '<div class="empty-state"><div class="empty-state-text">No alerts</div></div>';
    return;
  }

  const iconMap = { sentiment: '⚠', spike: '🔥', impact: '⚡', sector: '📈', default: '•' };

  cont.innerHTML = STATE.alerts.map(a => {
    const icon = iconMap[a.type] || iconMap.default;
    return `<div class="alert-item">
      <span class="alert-icon">${icon}</span>
      <div class="alert-body">
        <div class="alert-type">${(a.type_label || a.type || 'ALERT').toUpperCase()}</div>
        <div class="alert-ticker-name">${a.symbol || a.sector || '—'}</div>
        <div class="alert-desc">${a.description || '—'}</div>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
// SENTIMENT OVERVIEW (right sidebar)
// ============================================================
async function loadSentimentOverview() {
  try {
    const q = STATE.selectedStock ? stripNseSuffix(STATE.selectedStock) : 'indian stock market';
    const res = await API.sentiment(q);
    STATE.sentimentData = res.data || res;
    renderSentimentOverview();
    renderIntelMetrics();
  } catch (e) {
    console.warn('Sentiment overview error:', e.message);
  }
}

function renderSentimentOverview() {
  const cont = qs('#sentimentOverview');
  if (!cont) return;
  const s = STATE.sentimentData || {};
  const score = s.overall_score || 50;
  const cls = score >= 60 ? 'bullish' : score <= 40 ? 'bearish' : 'neutral';
  const clrMap = { bullish: 'var(--bullish)', bearish: 'var(--bearish)', neutral: 'var(--neutral)' };

  cont.innerHTML = `
    <div class="sentiment-overall-score" style="color:${clrMap[cls]}">${score}</div>
    <div class="sentiment-overall-label">OVERALL SENTIMENT SCORE</div>
    <div class="sentiment-bar-section">
      <div class="sentiment-bar-label">
        <span>Bullish</span>
        <span style="color:var(--bullish)">${s.positive_pct || 0}%</span>
      </div>
      <div class="sentiment-bar-track">
        <div class="sentiment-bar-fill bullish" style="width:${s.positive_pct || 0}%"></div>
      </div>
    </div>
    <div class="sentiment-bar-section">
      <div class="sentiment-bar-label">
        <span>Neutral</span>
        <span style="color:var(--neutral)">${s.neutral_pct || 0}%</span>
      </div>
      <div class="sentiment-bar-track">
        <div class="sentiment-bar-fill neutral" style="width:${s.neutral_pct || 0}%"></div>
      </div>
    </div>
    <div class="sentiment-bar-section">
      <div class="sentiment-bar-label">
        <span>Bearish</span>
        <span style="color:var(--bearish)">${s.negative_pct || 0}%</span>
      </div>
      <div class="sentiment-bar-track">
        <div class="sentiment-bar-fill bearish" style="width:${s.negative_pct || 0}%"></div>
      </div>
    </div>
    ${s.trend ? `<div class="sentiment-change-note">${s.trend}</div>` : ''}
  `;
}

// ============================================================
// NEWS FEED
// ============================================================
async function loadNews(append = false) {
  if (!append) {
    STATE.newsPage = 1;
    qs('#newsFeed').innerHTML = '<div class="skeleton-news"><div class="skeleton-item tall"></div><div class="skeleton-item tall"></div><div class="skeleton-item tall"></div></div>';
  }

  try {
    const params = {
      limit: CONFIG.NEWS_PAGE_SIZE,
      page: STATE.newsPage,
    };
    if (STATE.sectorFilter) params.sector = STATE.sectorFilter;

    // For filter-based queries
    const filterQuery = {
      'all': 'indian stock market NSE',
      'bullish': 'indian stock market rally gains',
      'bearish': 'indian stock market fall decline',
      'neutral': 'indian stock market',
      'high_impact': 'indian stock market breaking news',
      'watchlist': 'RELIANCE TCS INFY HDFC bank NSE',
    };
    params.q = filterQuery[STATE.newsFilter] || 'indian stock market';
    if (STATE.newsFilter !== 'all') params.filter = STATE.newsFilter;

    const res = await API.news(params);
    const articles = res.data || [];

    if (!append) {
      STATE.allArticles = articles;
    } else {
      STATE.allArticles = [...STATE.allArticles, ...articles];
    }

    renderNewsFeed(append);
    renderIntelMetrics();
    setLastUpdated();

    // If we get fewer articles than page size, disable load more
    const loadMoreBtn = qs('#loadMoreBtn');
    if (loadMoreBtn) loadMoreBtn.disabled = articles.length < CONFIG.NEWS_PAGE_SIZE;
  } catch (e) {
    console.warn('News error:', e.message);
    if (!append) {
      qs('#newsFeed').innerHTML = `<div class="error-state">
        <div class="error-state-icon">⚠</div>
        <div class="error-state-text">Could not load news. Check if the backend is running.</div>
      </div>`;
    }
  }
}

function renderNewsFeed(append = false) {
  const cont = qs('#newsFeed');
  if (!cont) return;

  const articles = STATE.allArticles;
  if (!articles.length) {
    cont.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📰</div><div class="empty-state-text">No articles found</div></div>';
    return;
  }

  const html = articles.map(a => renderNewsCard(a)).join('');
  if (append) {
    cont.insertAdjacentHTML('beforeend', html);
  } else {
    cont.innerHTML = html;
  }

  // click handlers
  cont.querySelectorAll('.news-card[data-id]').forEach(card => {
    card.addEventListener('click', () => openNewsModal(card.dataset.id));
  });
}

function renderNewsCard(a) {
  const cls = sentimentClass(a.sentiment, a.score);
  const impCls = impactClass(a.impact);
  const impLabel = (a.impact || 'LOW').toUpperCase();
  const sentLbl = sentimentLabel(cls);

  return `<div class="news-card ${cls}" data-id="${a.id}">
    <div class="news-meta">
      ${a.ticker ? `<span class="news-ticker">${a.ticker}</span>` : ''}
      <span class="news-source">${a.source || 'Unknown'}</span>
      ${a.category ? `<span class="news-category">${a.category.toUpperCase()}</span>` : ''}
      <span class="news-time">${timeAgo(a.published)}</span>
    </div>
    <div class="news-headline">${a.title || '—'}</div>
    ${a.ai_summary ? `<div class="news-summary">"${a.ai_summary}"</div>` : ''}
    <div class="news-footer">
      <span class="sentiment-badge ${cls}">${sentLbl}</span>
      <span class="score-chip">Sentiment: <strong>${a.score || '—'}</strong></span>
      <span class="impact-badge ${impCls}">${impLabel} IMPACT</span>
    </div>
  </div>`;
}

// ============================================================
// NEWS MODAL
// ============================================================
async function openNewsModal(id) {
  const article = STATE.allArticles.find(a => a.id === id);
  if (!article) return;

  const cls = sentimentClass(article.sentiment, article.score);
  const sentLbl = sentimentLabel(cls);
  const impCls = impactClass(article.impact);

  qs('#modalTicker').textContent = article.ticker || 'MARKET';
  qs('#modalSource').textContent = article.source || '';
  qs('#modalTime').textContent = timeAgo(article.published);
  qs('#modalHeadline').textContent = article.title || '—';
  qs('#modalReadMore').href = article.link || '#';

  qs('#modalSentimentRow').innerHTML = `
    <span class="sentiment-badge ${cls}">${sentLbl}</span>
    <span class="score-chip">Score: <strong>${article.score || '—'}</strong></span>
    <span class="impact-badge ${impCls}">${(article.impact || 'LOW').toUpperCase()} IMPACT</span>
    ${article.category ? `<span class="news-category">${article.category.toUpperCase()}</span>` : ''}
  `;

  // AI commentary based on actual data
  const whyMatters = generateWhyMatters(article, cls);
  const whatMoves = generateWhatMoves(article, cls);

  qs('#modalWhyMatters').textContent = whyMatters;
  qs('#modalWhatMoves').textContent = whatMoves;
  
  // Fetch XAI Evidence
  qs('#modalAISummary').innerHTML = '<span style="opacity: 0.5;">Analyzing article for XAI Evidence...</span>';
  try {
    const detailRes = await fetch('/api/news/' + id).then(r => r.json());
    if (detailRes.success && detailRes.data && detailRes.data.evidence) {
      let evidenceHtml = '';
      detailRes.data.evidence.forEach(ev => {
        if (ev.type === 'bullish') {
          evidenceHtml += `<span class="highlight-bullish" title="Score: ${ev.score}">${ev.sentence}</span> `;
        } else if (ev.type === 'bearish') {
          evidenceHtml += `<span class="highlight-bearish" title="Score: ${ev.score}">${ev.sentence}</span> `;
        } else {
          evidenceHtml += `<span>${ev.sentence}</span> `;
        }
      });
      qs('#modalAISummary').innerHTML = evidenceHtml || (article.ai_summary || article.title);
    } else {
      qs('#modalAISummary').textContent = article.ai_summary || article.title || '—';
    }
  } catch (e) {
    qs('#modalAISummary').textContent = article.ai_summary || article.title || '—';
  }

  // Related stocks
  const relatedTags = (article.related_stocks || [article.ticker]).filter(Boolean);
  qs('#modalRelatedStocks').innerHTML = relatedTags.map(t =>
    `<span class="tag" data-sym="${t}.NS">${t}</span>`
  ).join('');

  // Sentiment breakdown
  qs('#modalSentimentBreakdown').innerHTML = `
    <div class="sentiment-bar-section">
      <div class="sentiment-bar-label"><span>Positive</span><span style="color:var(--bullish)">${article.positive_pct || '—'}%</span></div>
      <div class="sentiment-bar-track"><div class="sentiment-bar-fill bullish" style="width:${article.positive_pct || 0}%"></div></div>
    </div>
    <div class="sentiment-bar-section">
      <div class="sentiment-bar-label"><span>Negative</span><span style="color:var(--bearish)">${article.negative_pct || '—'}%</span></div>
      <div class="sentiment-bar-track"><div class="sentiment-bar-fill bearish" style="width:${article.negative_pct || 0}%"></div></div>
    </div>
    <div class="sentiment-bar-section">
      <div class="sentiment-bar-label"><span>Neutral</span><span style="color:var(--neutral)">${article.neutral_pct || '—'}%</span></div>
      <div class="sentiment-bar-track"><div class="sentiment-bar-fill neutral" style="width:${article.neutral_pct || 0}%"></div></div>
    </div>
  `;

  // tag click → stock modal
  qs('#modalRelatedStocks').querySelectorAll('.tag').forEach(t => {
    t.addEventListener('click', (e) => { e.stopPropagation(); openStockModal(t.dataset.sym); });
  });

  qs('#newsModal').classList.remove('hidden');

  // Try to fetch more detail from API
  try {
    const detail = await API.newsById(id);
    if (detail.data) {
      const d = detail.data;
      if (d.ai_summary) qs('#modalAISummary').textContent = d.ai_summary;
    }
  } catch (_) { /* use cached data */ }
}

function generateWhyMatters(article, cls) {
  const score = article.score || 50;
  const ticker = article.ticker || 'this stock';
  if (cls === 'bullish') {
    return `This article carries a strong bullish signal (score: ${score}/100) for ${ticker}. Positive news momentum typically precedes institutional accumulation and can drive short-term price appreciation.`;
  } else if (cls === 'bearish') {
    return `This article carries a bearish signal (score: ${score}/100) for ${ticker}. Negative news flow often precedes selling pressure and can impact near-term price action.`;
  }
  return `This article carries neutral sentiment (score: ${score}/100). Monitor for follow-up news that may shift the sentiment direction for ${ticker}.`;
}

function generateWhatMoves(article, cls) {
  const ticker = article.ticker || 'the stock';
  const cat = (article.category || '').toLowerCase();
  if (cat.includes('earn') || cat.includes('result')) return `${ticker} price action, particularly in the short term as earnings revisions occur.`;
  if (cat.includes('merger') || cat.includes('acquis')) return `${ticker} and its peers, with potential sector-wide repricing following the deal.`;
  if (cat.includes('ipo')) return `Sector valuations and peer companies competing for investor capital.`;
  if (cat.includes('policy') || cat.includes('rbi') || cat.includes('sebi')) return `Broader market indices and rate-sensitive sectors like Banking and NBFC.`;
  if (cls === 'bullish') return `${ticker} in the near term, potentially creating a momentum trade opportunity.`;
  if (cls === 'bearish') return `${ticker} downside and potentially drag correlated stocks lower.`;
  return `${ticker} depending on volume and institutional follow-through.`;
}

// ============================================================
// STOCK MODAL
// ============================================================
let stockChartInstance = null;

async function openStockModal(symbol) {
  if (!symbol) return;
  STATE.selectedStock = symbol;

  // Update watchlist selection
  qsa('.watchlist-row').forEach(r => r.classList.toggle('selected', r.dataset.sym === symbol));

  const shortSym = stripNseSuffix(symbol);
  qs('#stockModalSymbol').textContent = shortSym;
  qs('#stockModalName').textContent = 'Loading…';
  qs('#stockDetailPrice').textContent = '—';
  qs('#stockDetailChange').textContent = '';
  qs('#stockStatsRow').innerHTML = '';
  qs('#stockSentimentRow').innerHTML = '<div class="skeleton-item"></div>';
  qs('#stockNewsItems').innerHTML = '<div class="skeleton-item"></div>';
  qs('#stockModal').classList.remove('hidden');

  // Destroy old chart
  if (stockChartInstance) { stockChartInstance.destroy(); stockChartInstance = null; }

  try {
    const [detailRes, newsRes, sentRes] = await Promise.allSettled([
      API.stockDetail(symbol),
      API.news({ q: shortSym, limit: 6 }),
      API.sentiment(shortSym),
    ]);

    // Stock detail
    if (detailRes.status === 'fulfilled') {
      const s = detailRes.value.data || {};
      qs('#stockModalName').textContent = s.name || shortSym;
      qs('#stockDetailPrice').textContent = fmtPrice(s.price);
      const chgPct = s.changePercent || 0;
      const chgEl = qs('#stockDetailChange');
      chgEl.textContent = `${fmtPct(chgPct)} (${fmtPrice(s.change || 0)})`;
      chgEl.className = 'stock-detail-change mono ' + (chgPct >= 0 ? 'up' : 'down');

      qs('#stockStatsRow').innerHTML = [
        { label: 'HIGH', val: fmtPrice(s.high) },
        { label: 'LOW', val: fmtPrice(s.low) },
        { label: 'VOLUME', val: fmtLargeNum(s.volume) },
        { label: 'MKT CAP', val: fmtLargeNum(s.marketCap) },
      ].map(i => `<div class="stock-stat"><div class="stock-stat-label">${i.label}</div><span class="stock-stat-val">${i.val}</span></div>`).join('');
      
      if (s.alt_data) {
        qs('#stockAltDataRow').innerHTML = [
          { label: 'WALL ST CONSENSUS', val: s.alt_data.analyst_consensus && s.alt_data.analyst_consensus !== 'None' ? s.alt_data.analyst_consensus.toUpperCase() : 'HOLD' },
          { label: 'MEAN TARGET', val: fmtPrice(s.alt_data.target_mean_price) },
          { label: 'INSTITUTIONAL HELD', val: s.alt_data.inst_ownership ? s.alt_data.inst_ownership + '%' : '—' },
          { label: 'SHORT RATIO', val: s.alt_data.short_ratio || '—' }
        ].map(i => `<div class="stock-stat"><div class="stock-stat-label">${i.label}</div><span class="alt-data-val">${i.val}</span></div>`).join('');
      } else {
        qs('#stockAltDataRow').innerHTML = '';
      }

      // Price chart
      const history = s.history || [];
      if (history.length) {
        renderStockChart(history);
      }
    }

    // Sentiment
    if (sentRes.status === 'fulfilled') {
      const sent = sentRes.value.data || sentRes.value || {};
      const score = sent.overall_score || 50;
      const cls = sentimentClass(null, score);
      qs('#stockSentimentRow').innerHTML = `
        <div class="stock-sent-item">
          <div class="stock-sent-lbl">AI SENTIMENT</div>
          <span class="stock-sent-val" style="color:${scoreColor(score)}">${score}</span>
        </div>
        <div class="stock-sent-item">
          <div class="stock-sent-lbl">DIRECTION</div>
          <span class="stock-sent-val" style="color:${scoreColor(score)}">${sentimentLabel(cls)}</span>
        </div>
        <div class="stock-sent-item">
          <div class="stock-sent-lbl">BULLISH</div>
          <span class="stock-sent-val" style="color:var(--bullish)">${sent.positive_pct || 0}%</span>
        </div>
        <div class="stock-sent-item">
          <div class="stock-sent-lbl">BEARISH</div>
          <span class="stock-sent-val" style="color:var(--bearish)">${sent.negative_pct || 0}%</span>
        </div>
        <div class="stock-sent-item">
          <div class="stock-sent-lbl">ARTICLES</div>
          <span class="stock-sent-val">${sent.total_articles || 0}</span>
        </div>
      `;
      STATE.currentStockSentiment = sent;
    }

    // Chart Tabs setup
    const tabs = qsa('.chart-tab');
    tabs.forEach(t => {
      // Remove old listeners to prevent duplicates
      const newBtn = t.cloneNode(true);
      t.parentNode.replaceChild(newBtn, t);
    });
    
    qsa('.chart-tab').forEach(t => {
      t.addEventListener('click', (e) => {
        qsa('.chart-tab').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const chartType = e.target.dataset.chart;
        if (chartType === 'price' && detailRes.status === 'fulfilled') {
          renderStockChart(detailRes.value.data.history || []);
        } else if (chartType === 'sentiment') {
          renderSentimentChart(STATE.currentStockSentiment || {});
        }
      });
    });

    // Default to Price chart
    qsa('.chart-tab').forEach(b => b.classList.remove('active'));
    qs('.chart-tab[data-chart="price"]').classList.add('active');

    // News
    if (newsRes.status === 'fulfilled') {
      const articles = newsRes.value.data || [];
      qs('#stockNewsItems').innerHTML = articles.length ?
        articles.map(a => {
          const cls = sentimentClass(a.sentiment, a.score);
          return `<div class="stock-news-item" data-id="${a.id}">
            <div class="stock-news-item-title">${a.title}</div>
            <div class="stock-news-item-meta">
              <span class="sentiment-badge ${cls}" style="font-size:9px;padding:1px 5px">${sentimentLabel(cls)}</span>
              <span>${a.source || ''}</span>
              <span class="mono">${timeAgo(a.published)}</span>
            </div>
          </div>`;
        }).join('') :
        '<div class="empty-state-text" style="padding:10px;color:var(--text-muted)">No recent news</div>';

      qs('#stockNewsItems').querySelectorAll('.stock-news-item').forEach(item => {
        item.addEventListener('click', () => { qs('#stockModal').classList.add('hidden'); openNewsModal(item.dataset.id); });
      });
    }

  } catch (e) {
    toast('Error loading stock data: ' + e.message, 'error');
  }
}

function renderStockChart(history) {
  const canvas = qs('#stockPriceChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const labels = history.map(h => h.date);
  const prices = history.map(h => h.close);
  const isUp = prices[prices.length - 1] >= prices[0];
  const color = isUp ? '#3fb950' : '#f85149';

  if (stockChartInstance) stockChartInstance.destroy();

  stockChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: prices,
        borderColor: color,
        borderWidth: 1.5,
        backgroundColor: color + '15',
        fill: true,
        pointRadius: 0,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#161b22',
        titleColor: '#8b949e',
        bodyColor: '#e6edf3',
        borderColor: '#21262d',
        borderWidth: 1,
        callbacks: { label: ctx => '₹' + ctx.raw.toLocaleString('en-IN', {minimumFractionDigits: 2}) }
      }},
      scales: {
        x: { display: false },
        y: { display: true, grid: { color: '#21262d' }, ticks: { color: '#8b949e', font: { family: 'IBM Plex Mono', size: 10 },
          callback: v => '₹' + v.toLocaleString('en-IN', {minimumFractionDigits: 0}) } }
      }
    }
  });
}

function renderSentimentChart(sentiment) {
  const canvas = qs('#stockPriceChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (stockChartInstance) stockChartInstance.destroy();

  const pos = sentiment.positive_pct || 0;
  const neu = sentiment.neutral_pct || 0;
  const neg = sentiment.negative_pct || 0;

  stockChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Bullish', 'Neutral', 'Bearish'],
      datasets: [{
        data: [pos, neu, neg],
        backgroundColor: ['#3fb950', '#8b949e', '#f85149'],
        borderRadius: 4,
        barPercentage: 0.6
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#161b22',
          titleColor: '#8b949e',
          bodyColor: '#e6edf3',
          borderColor: '#21262d',
          borderWidth: 1,
          callbacks: { label: ctx => ctx.raw + '%' }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#8b949e', font: { family: 'Inter', size: 11, weight: '600' } } },
        y: { display: true, grid: { color: '#21262d' }, ticks: { color: '#8b949e', font: { family: 'IBM Plex Mono', size: 10 }, callback: v => v + '%' } }
      }
    }
  });
}

// ============================================================
// NEWS FILTERS
// ============================================================
function setupNewsFilters() {
  qs('#newsFilters').addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    qsa('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    STATE.newsFilter = btn.dataset.filter || 'all';
    loadNews(false);
  });

  qs('#newsSectorFilter').addEventListener('change', e => {
    STATE.sectorFilter = e.target.value;
    loadNews(false);
  });

  qs('#refreshNewsBtn').addEventListener('click', () => loadNews(false));

  qs('#loadMoreBtn').addEventListener('click', () => {
    STATE.newsPage++;
    loadNews(true);
  });
}

// ============================================================
// SENTIMENT ANALYZER
// ============================================================
function setupAnalyzer() {
  const btn = qs('#analyzeBtn');
  const textarea = qs('#analyzeText');
  const result = qs('#analyzeResult');

  btn.addEventListener('click', async () => {
    const text = textarea.value.trim();
    if (!text) { toast('Enter some text to analyze', 'info'); return; }

    btn.disabled = true;
    btn.textContent = 'ANALYZING…';
    result.classList.add('hidden');

    try {
      const res = await API.analyze(text);
      const d = res.data || res;
      const score = d.score || 50;
      const cls = sentimentClass(null, score);

      result.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span class="sentiment-badge ${cls}">${sentimentLabel(cls)}</span>
          <span class="score-chip">Score: <strong>${score}</strong>/100</span>
        </div>
        <div class="analyze-result-grid">
          <div class="analyze-result-item">
            <span class="analyze-result-val" style="color:var(--bullish)">${Math.round((d.positive_prob || 0) * 100)}%</span>
            <span class="analyze-result-lbl">BULLISH PROB</span>
          </div>
          <div class="analyze-result-item">
            <span class="analyze-result-val" style="color:var(--bearish)">${Math.round((d.negative_prob || 0) * 100)}%</span>
            <span class="analyze-result-lbl">BEARISH PROB</span>
          </div>
          <div class="analyze-result-item">
            <span class="analyze-result-val" style="color:var(--neutral)">${Math.round((d.neutral_prob || 0) * 100)}%</span>
            <span class="analyze-result-lbl">NEUTRAL PROB</span>
          </div>
        </div>
        <div style="margin-top:8px;font-size:10px;color:var(--text-muted)">
          Polarity: ${(d.polarity || 0).toFixed(3)} · Confidence: ${Math.round((d.confidence || 0) * 100)}%
        </div>
      `;
      result.classList.remove('hidden');
    } catch (e) {
      toast('Analysis failed: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'ANALYZE';
    }
  });
}

// ============================================================
// SEARCH
// ============================================================
function setupSearch() {
  const input = qs('#globalSearch');
  const dropdown = qs('#searchDropdown');

  input.addEventListener('input', () => {
    clearTimeout(STATE.searchTimeout);
    const q = input.value.trim();
    if (!q || q.length < 2) { dropdown.classList.add('hidden'); return; }

    STATE.searchTimeout = setTimeout(async () => {
      try {
        const res = await API.search(q);
        const results = res.data || [];
        if (!results.length) { dropdown.classList.add('hidden'); return; }

        dropdown.innerHTML = results.slice(0, 8).map(r => {
          const typeLabel = (r.type || 'result').toUpperCase();
          return `<div class="search-item" data-type="${r.type}" data-sym="${r.symbol || ''}" data-id="${r.id || ''}">
            <span class="search-item-type">${typeLabel}</span>
            <span>${r.name || r.title || r.symbol || r.query || '—'}</span>
          </div>`;
        }).join('');

        dropdown.classList.remove('hidden');

        dropdown.querySelectorAll('.search-item').forEach(item => {
          item.addEventListener('click', () => {
            if (item.dataset.type === 'stock' && item.dataset.sym) {
              openStockModal(item.dataset.sym);
            } else if (item.dataset.id) {
              openNewsModal(item.dataset.id);
            }
            dropdown.classList.add('hidden');
            input.value = '';
          });
        });
      } catch (e) { dropdown.classList.add('hidden'); }
    }, CONFIG.DEBOUNCE_SEARCH);
  });

  // Close on outside click
  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  // Close on Escape
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { dropdown.classList.add('hidden'); input.blur(); }
  });
}

// ============================================================
// MODALS: CLOSE
// ============================================================
function setupModals() {
  qs('#modalClose').addEventListener('click', () => qs('#newsModal').classList.add('hidden'));
  qs('#stockModalClose').addEventListener('click', () => qs('#stockModal').classList.add('hidden'));

  // Close on overlay click
  qs('#newsModal').addEventListener('click', e => {
    if (e.target === qs('#newsModal')) qs('#newsModal').classList.add('hidden');
  });
  qs('#stockModal').addEventListener('click', e => {
    if (e.target === qs('#stockModal')) qs('#stockModal').classList.add('hidden');
  });

  // Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      qs('#newsModal').classList.add('hidden');
      qs('#stockModal').classList.add('hidden');
    }
  });
}

// ============================================================
// VOLUME CHART (right sidebar)
// ============================================================
let volumeChartInstance = null;
function renderVolumeChart() {
  const canvas = qs('#volumeChart');
  if (!canvas) return;
  if (volumeChartInstance) volumeChartInstance.destroy();

  // Simulate hourly distribution from actual article counts
  const hours = ['9am','10','11','12','1pm','2','3','4','5'];
  const counts = hours.map((_, i) => {
    const base = STATE.allArticles.filter(a => {
      try {
        const h = new Date(a.published).getHours();
        return h === 9 + i;
      } catch { return false; }
    }).length;
    return base || Math.floor(Math.random() * 3) + 1; // fallback
  });

  volumeChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: hours,
      datasets: [{
        data: counts,
        backgroundColor: '#58a6ff30',
        borderColor: '#58a6ff',
        borderWidth: 1,
        borderRadius: 2,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#484f58', font: { size: 9 } } },
        y: { display: false }
      }
    }
  });
}

// ============================================================
// POLLING
// ============================================================
function startPolling() {
  const poll = async (fn, ms) => {
    try { await fn(); } 
    catch (e) { console.error('Polling error:', e); }
    setTimeout(() => poll(fn, ms), ms);
  };

  // News
  poll(async () => {
    await loadNews(false);
  }, CONFIG.POLL_NEWS_MS);

  // Market
  poll(async () => {
    await loadMarketData();
    await loadWatchlist();
    await loadTicker();
  }, CONFIG.POLL_MARKET_MS);

  // Signals
  poll(async () => {
    await loadSignals();
    await loadAlerts();
    await loadSentimentOverview();
  }, CONFIG.POLL_SIGNALS_MS);
}

// ============================================================
// NAV LINKS (page switching placeholder)
// ============================================================
function setupNav() {
  qsa('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      qsa('.nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      const page = link.dataset.page;
      
      const dashboard = qs('#dashboardView');
      const focused = qs('#predictionsView'); // Re-using this container for all focused views
      const grid = qs('#predGrid');
      
      if (page === 'dashboard') {
        dashboard.classList.remove('hidden');
        focused.classList.add('hidden');
      } else {
        dashboard.classList.add('hidden');
        focused.classList.remove('hidden');
        
        const titleEl = qs('#predictionsView h2');
        grid.innerHTML = '<div style="color:var(--text-muted)">Loading...</div>';
        
        if (page === 'market') {
            titleEl.textContent = 'Market Overview';
            renderMarketFocused(grid);
        } else if (page === 'news') {
            titleEl.textContent = 'Live News Terminal';
            renderNewsFocused(grid);
        } else if (page === 'stocks') {
            titleEl.textContent = 'Stock Screener';
            renderStocksFocused(grid);
        } else if (page === 'sectors') {
            titleEl.textContent = 'Sector Heatmap';
            renderSectorsFocused(grid);
        } else if (page === 'signals') {
            titleEl.textContent = 'Prediction Markets (Yeno)';
            renderPredictions(); // The existing Betmoar one
        } else if (page === 'alerts') {
            titleEl.textContent = 'System Alerts';
            renderAlertsFocused(grid);
        }
      }
    });
  });
}

function getCompanyLogo(symbol) {
  const domains = {
    'RELIANCE.NS': 'ril.com',
    'TCS.NS': 'tcs.com',
    'INFY.NS': 'infosys.com',
    'HDFCBANK.NS': 'hdfcbank.com',
    'ICICIBANK.NS': 'icicibank.com',
    'SBIN.NS': 'sbi.co.in',
    'BHARTIARTL.NS': 'airtel.in',
    'LT.NS': 'larsentoubro.com',
    'ITC.NS': 'itcportal.com',
    'WIPRO.NS': 'wipro.com',
    'BAJFINANCE.NS': 'bajajfinserv.in',
    'KOTAKBANK.NS': 'kotak.com',
    'HINDUNILVR.NS': 'hul.co.in',
    'AXISBANK.NS': 'axisbank.com',
    'TITAN.NS': 'titancompany.in'
  };
  const d = domains[symbol];
  if (d) return `https://logo.clearbit.com/${d}`;
  return `https://ui-avatars.com/api/?name=${symbol.replace('.NS','')}&background=random&color=fff`;
}

// === NEW FOCUSED VIEW RENDERERS ===

function renderMarketFocused(grid) {
  if (!STATE.marketData) return;
  let html = '';
  Object.keys(STATE.marketData).forEach(key => {
    const m = STATE.marketData[key];
    const chg = m.changePercent || 0;
    const cls = chg >= 0 ? 'up' : 'down';
    html += `<div class="pred-card" style="padding:20px; display:flex; flex-direction:column; justify-content:center; align-items:center; height:180px;">
        <div style="font-size:24px; font-weight:bold; color:var(--text-main)">${m.name || key}</div>
        <div style="font-size:32px; font-family:'IBM Plex Mono'; margin:12px 0">${fmtPrice(m.price)}</div>
        <div class="stock-detail-change ${cls}" style="font-size:16px">${fmtPct(chg)}</div>
    </div>`;
  });
  grid.innerHTML = html;
}

function renderNewsFocused(grid) {
  let html = '';
  (STATE.allArticles || []).forEach(a => {
    const cls = sentimentClass(a.sentiment, a.score);
    // Extract domain from source for favicon
    let domain = a.source.toLowerCase().replace(' ', '');
    if (!domain.includes('.')) domain += '.com';
    const iconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    
    html += `<div class="pred-card hover-glow" style="padding:16px; height:auto; min-height:160px; display:flex; flex-direction:column; justify-content:space-between; cursor:pointer" onclick="openNewsModal('${a.id}')">
        <div style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-muted); margin-bottom:12px">
            <img src="${iconUrl}" style="width:16px; height:16px; border-radius:4px" onerror="this.style.display='none'">
            <span>${a.ticker || 'MARKET'} • ${a.source}</span>
        </div>
        <div style="font-size:15px; font-weight:600; line-height:1.4; margin-bottom:16px; color:var(--text-main)">${a.title}</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:auto">
            <span class="sentiment-badge ${cls}">${sentimentLabel(cls)} ${a.score}</span>
            <span style="font-size:11px; color:var(--text-muted)">${timeAgo(a.published)}</span>
        </div>
    </div>`;
  });
  grid.innerHTML = html;
}

function renderStocksFocused(grid) {
  let html = '';
  Object.values(STATE.stockData || {}).forEach(w => {
    const chg = w.changePercent || 0;
    const cls = chg >= 0 ? 'up' : 'down';
    html += `<div class="pred-card hover-glow" style="padding:16px; cursor:pointer; height:auto; min-height:160px; display:flex; flex-direction:column; justify-content:space-between;" onclick="openStockModal('${w.symbol}')">
        <div style="font-size:18px; font-weight:bold; margin-bottom:8px">${w.name} <span style="font-size:12px; font-weight:normal; color:var(--text-muted)">${w.symbol.replace('.NS','')}</span></div>
        <div style="font-size:24px; font-family:'IBM Plex Mono'">${fmtPrice(w.price)}</div>
        <div class="stock-detail-change ${cls}" style="margin-top:8px">${fmtPct(chg)}</div>
    </div>`;
  });
  grid.innerHTML = html;
}

function renderSectorsFocused(grid) {
  if (!STATE.sectorData) return;
  let html = '';
  STATE.sectorData.forEach(data => {
    const sec = data.name;
    const score = data.score || 50;
    const cls = sentimentClass(data.direction, score);
    html += `<div class="pred-card" style="padding:20px; display:flex; flex-direction:column; justify-content:center; align-items:center; height: auto; min-height: 180px;">
        <div style="font-size:20px; font-weight:bold; margin-bottom:16px; text-transform:uppercase">${sec}</div>
        <div class="sentiment-badge ${cls}" style="font-size:16px; padding:6px 12px">${sentimentLabel(cls)} ${score}</div>
        <div style="margin-top:16px; font-size:13px; color:var(--text-muted)">Based on ${data.article_count} recent articles</div>
    </div>`;
  });
  grid.innerHTML = html;
}

function renderAlertsFocused(grid) {
  let html = '';
  (STATE.alerts || []).forEach(al => {
    // Determine sentiment styling from direction
    const isBull = al.direction.toUpperCase() === 'BULLISH';
    const isBear = al.direction.toUpperCase() === 'BEARISH';
    const borderColor = isBull ? 'var(--bullish)' : (isBear ? 'var(--bearish)' : 'var(--warning)');
    
    html += `<div class="pred-card hover-glow" style="padding:16px; height:auto; min-height:120px; cursor:pointer; display:flex; flex-direction:column; justify-content:space-between; border-left:4px solid ${borderColor}" onclick="openStockModal('${al.symbol}')">
        <div>
          <div style="font-size:14px; font-weight:bold; color:var(--text-main); margin-bottom:8px">${al.name} <span class="sentiment-badge ${isBull ? 'bullish' : (isBear ? 'bearish' : 'neutral')}" style="margin-left:8px; font-size:10px">${al.direction}</span></div>
          <div style="font-size:13px; color:var(--text-muted); line-height:1.5">${al.reason}</div>
        </div>
        <div style="margin-top:16px; font-size:11px; color:var(--text-muted); font-family:'IBM Plex Mono'">IMPACT: ${al.impact.toUpperCase()}</div>
    </div>`;
  });
  grid.innerHTML = html || '<div style="color:var(--text-muted)">No alerts yet...</div>';
}


function renderPredictions() {
  const grid = qs('#predGrid');
  if (!grid) return;
  
  let items = STATE.signals || [];
  if (items.length === 0) {
    grid.innerHTML = '<div style="color:var(--text-muted)">Waiting for AI signals...</div>';
    return;
  }
  
  const brandColors = [
    'linear-gradient(135deg, #1e3a8a, #3b82f6)',
    'linear-gradient(135deg, #065f46, #10b981)',
    'linear-gradient(135deg, #701a75, #d946ef)',
    'linear-gradient(135deg, #991b1b, #ef4444)',
    'linear-gradient(135deg, #854d0e, #eab308)',
    'linear-gradient(135deg, #3730a3, #6366f1)'
  ];

  let html = '';
  items.forEach((sig, i) => {
    const color = brandColors[i % brandColors.length];
    const letter = (sig.symbol || 'X').charAt(0);
    const score = sig.sentiment_score || 50;
    const upProb = (sig.positive_pct || 33);
    const downProb = (sig.negative_pct || 33);
    const isBull = score >= 60;
    const isBear = score <= 40;
    
        
    const yesPrice = upProb / 10;
    const noPrice = downProb / 10;
    const q1 = `${sig.name} Up or Down this week?`;
    const q2 = `What price will ${sig.name} hit by Friday?`;

    
    html += `
      <div class="pred-card">
        <div class="pred-card-left" style="background: ${color}; position:relative; overflow:hidden;" onclick="openStockModal('${sig.symbol}')">
          <img src="${getCompanyLogo(sig.symbol)}" style="width:60px; height:60px; object-fit:contain; position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); z-index:2; border-radius:12px; background:white; padding:4px;" onerror="this.style.display='none'">
          <div class="pred-logo" style="position:relative; z-index:1;">${letter}</div>
        </div>
        <div class="pred-card-right">
          <div class="pred-title" onclick="openStockModal('${sig.symbol}')">${q1}</div>
          <div class="pred-rows">
            <div class="pred-row" style="margin-bottom:4px; cursor:pointer" onclick="openTradeModal('${sig.symbol}', '${sig.name}', ${yesPrice}, ${noPrice}, '${q1}')">
              <span class="pred-val">Yes (Bullish) <span style="font-size:10px; opacity:0.6; margin-left:4px">Fair Value: ₹${yesPrice.toFixed(1)}</span></span>
              <span class="pred-pct ${isBull ? 'high' : (isBear ? 'low' : 'med')}">${upProb.toFixed(1)}%</span>
            </div>
            <div class="pred-row" style="cursor:pointer" onclick="openTradeModal('${sig.symbol}', '${sig.name}', ${yesPrice}, ${noPrice}, '${q1}')">
              <span class="pred-val">No (Bearish) <span style="font-size:10px; opacity:0.6; margin-left:4px">Fair Value: ₹${noPrice.toFixed(1)}</span></span>
              <span class="pred-pct ${isBear ? 'high' : (isBull ? 'low' : 'med')}">${downProb.toFixed(1)}%</span>
            </div>
          </div>
          <div class="pred-footer">
            <span class="pred-vol">$${(Math.random()*10 + 1).toFixed(1)}M Vol · ${sig.article_count} sources</span>
            <button onclick="openTradeModal('${sig.symbol}', '${sig.name}', ${yesPrice}, ${noPrice}, '${q1}')" style="background:var(--info);color:#fff;border:none;border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer">TRADE</button>
          </div>
        </div>
      </div>
    `;
    
    if (i % 2 === 0) {
        html += `
          <div class="pred-card">
            <div class="pred-card-left" style="background: ${brandColors[(i+1) % brandColors.length]}; position:relative; overflow:hidden;" onclick="openStockModal('${sig.symbol}')">
              <img src="${getCompanyLogo(sig.symbol)}" style="width:60px; height:60px; object-fit:contain; position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); z-index:2; border-radius:12px; background:white; padding:4px;" onerror="this.style.display='none'">
              <div class="pred-logo" style="position:relative; z-index:1;">${letter}</div>
            </div>
            <div class="pred-card-right">
              <div class="pred-title" onclick="openStockModal('${sig.symbol}')">${q2}</div>
              <div class="pred-rows">
                <div class="pred-row" style="margin-bottom:4px; cursor:pointer" onclick="openTradeModal('${sig.symbol}', '${sig.name}', ${yesPrice}, ${noPrice}, '${q2}')">
                  <span class="pred-val"><i>▲</i> High Target</span>
                  <span class="pred-pct ${isBull ? 'high' : 'med'}">${(upProb + 10).toFixed(1)}%</span>
                </div>
                <div class="pred-row" style="cursor:pointer" onclick="openTradeModal('${sig.symbol}', '${sig.name}', ${yesPrice}, ${noPrice}, '${q2}')">
                  <span class="pred-val"><i>▼</i> Low Target</span>
                  <span class="pred-pct ${isBear ? 'high' : 'low'}">${(downProb + 10).toFixed(1)}%</span>
                </div>
              </div>
              <div class="pred-footer">
                <span class="pred-vol">$${(Math.random()*5 + 1).toFixed(1)}M Vol · ${sig.article_count + 3} sources</span>
                <button onclick="openTradeModal('${sig.symbol}', '${sig.name}', ${yesPrice}, ${noPrice}, '${q2}')" style="background:var(--info);color:#fff;border:none;border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer">TRADE</button>
              </div>
            </div>
          </div>
        `;
    }

  });
  
  grid.innerHTML = html;
}

// ============================================================
// HEALTH CHECK
// ============================================================
async function checkBackendHealth() {
  try {
    await API.health();
    return true;
  } catch (e) {
    console.error('Backend not reachable:', e.message);
    toast('⚠ Backend server not responding. Start app.py first.', 'error', 8000);
    return false;
  }
}

// ============================================================
// INIT
// ============================================================
function updateBalanceUI() {
  const el = document.getElementById('balanceAmount');
  if (el) el.textContent = '₹' + STATE.balance.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

async function init() {
  updateBalanceUI();
  startClock();
  setupNav();
  setupNewsFilters();
  setupAnalyzer();
  setupSearch();
  setupModals();

  // Check backend
  const healthy = await checkBackendHealth();
  if (!healthy) {
    // Show skeleton states with error
    qs('#newsFeed').innerHTML = `<div class="error-state">
      <div class="error-state-icon">⚠</div>
      <div class="error-state-text">Backend not running. Please start app.py (port 5000).</div>
    </div>`;
    return;
  }

  // Load all data in parallel
  await Promise.allSettled([
    loadTicker(),
    loadMarketData(),
    loadWatchlist(),
    loadSectors(),
    loadSignals(),
    loadAlerts(),
    loadSentimentOverview(),
    loadNews(false),
  ]);

  renderVolumeChart();
  startPolling();
}

// Start when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ============================================================
// SIMULATED TRADING ENGINE (YENO MARKET)
// ============================================================
function openTradeModal(symbol, name, yesPrice, noPrice, question) {
  STATE.tradeConfig = { symbol, name, yesPrice, noPrice, side: 'Yes' };
  
  qs('#tradeModalHeadline').textContent = name;
  qs('#tradeModalSub').textContent = question;
  
  qs('#tradePriceYes').textContent = `₹${yesPrice.toFixed(1)}`;
  qs('#tradePriceNo').textContent = `₹${noPrice.toFixed(1)}`;
  
  qs('#tradeModal').classList.remove('hidden');
  updateTradeSummary();
}

function updateTradeSummary() {
  if (!STATE.tradeConfig) return;
  const qty = parseInt(qs('#tradeQty').value) || 0;
  const price = STATE.tradeConfig.side === 'Yes' ? STATE.tradeConfig.yesPrice : STATE.tradeConfig.noPrice;
  const total = qty * price;
  const payout = qty * 10.0;
  
  qs('#summaryPrice').textContent = `₹${price.toFixed(1)}`;
  qs('#summaryTotal').textContent = `₹${total.toFixed(2)}`;
  qs('#summaryPayout').textContent = `₹${payout.toFixed(2)}`;
  
  const btn = qs('#submitTradeBtn');
  if (total > STATE.balance) {
    btn.textContent = 'Insufficient Funds';
    btn.disabled = true;
    btn.style.opacity = '0.5';
  } else {
    btn.textContent = `Place Order • ₹${total.toFixed(2)}`;
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

// Setup Trade Modal Listeners
document.addEventListener('DOMContentLoaded', () => {
  const tm = qs('#tradeModal');
  if (!tm) return;
  
  qs('#tradeModalClose').addEventListener('click', () => tm.classList.add('hidden'));
  
  qsa('.trade-side-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      qsa('.trade-side-btn').forEach(b => b.classList.remove('active'));
      const t = e.target.closest('.trade-side-btn');
      t.classList.add('active');
      STATE.tradeConfig.side = t.dataset.side;
      updateTradeSummary();
    });
  });
  
  qs('#tradeQty').addEventListener('input', updateTradeSummary);
  
  qs('#submitTradeBtn').addEventListener('click', () => {
    const qty = parseInt(qs('#tradeQty').value) || 0;
    const price = STATE.tradeConfig.side === 'Yes' ? STATE.tradeConfig.yesPrice : STATE.tradeConfig.noPrice;
    const total = qty * price;
    
    if (total <= STATE.balance) {
      STATE.balance -= total;
      localStorage.setItem('yeno_balance', STATE.balance);
      updateBalanceUI();
      tm.classList.add('hidden');
      toast(`Successfully bought ${qty} contracts of ${STATE.tradeConfig.name} (${STATE.tradeConfig.side})`, 'success', 3000);
    }
  });
});

// ============================================================
// CHATBOT COPILOT LOGIC
// ============================================================
function addChatMessage(text, sender, isTyping = false) {
  const messagesEl = qs('#chatMessages');
  if (!messagesEl) return null;
  
  const d = document.createElement('div');
  d.className = `chat-msg ${sender} ${isTyping ? 'typing' : ''}`;
  
  if (isTyping) {
    d.id = 'typingIndicator';
    d.innerHTML = '<span></span><span></span><span></span>';
  } else {
    d.innerHTML = text;
  }
  
  messagesEl.appendChild(d);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return d;
}

function matchesAlias(query, alias) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, 'i');
  return regex.test(query);
}

function generateAIResponse(query) {
  const q = query.toLowerCase();
  
  // 1. Identify intent
  const wantsPrice = q.includes('price') || q.includes('trading') || q.includes('how much') || q.includes('how is');
  const wantsSentiment = q.includes('sentiment') || q.includes('news') || q.includes('feeling') || q.includes('think');
  const wantsPrediction = q.includes('predict') || q.includes('buy') || q.includes('sell') || q.includes('target') || q.includes('should i') || q.includes('recommend');
  
  // 2. Identify Stock robustly using regex aliases
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
  const stockData = (STATE.stockData || {})[targetSymbol];
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
    // ACTIVE FETCH FALLBACK!
    // If the data is missing from the state, fetch it dynamically.
    API.stockDetail(targetSymbol).then(res => {
        if (res.data) {
            STATE.stockData[targetSymbol] = res.data;
            setTimeout(() => {
                addChatMessage(`I just retrieved the live exchange data for <strong>${actualName}</strong>! It is currently trading at <strong>${fmtPrice(res.data.price)}</strong> with a change of <span class="${res.data.changePercent >= 0 ? 'up' : 'down'}">${fmtPct(res.data.changePercent)}</span>.`, 'ai');
            }, 600);
        }
    }).catch(err => {
        setTimeout(() => {
            addChatMessage(`I tried to fetch live data for ${actualName}, but the exchange API is temporarily unavailable.`, 'ai');
        }, 600);
    });
    
    return `Let me fetch the latest live data for <strong>${actualName}</strong> from the exchange right now...`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const tm = qs('#tradeModal');
  if (!tm) return;
  
  qs('#tradeModalClose').addEventListener('click', () => tm.classList.add('hidden'));
  
  qsa('.trade-side-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      qsa('.trade-side-btn').forEach(b => b.classList.remove('active'));
      const t = e.target.closest('.trade-side-btn');
      t.classList.add('active');
      STATE.tradeConfig.side = t.dataset.side;
      updateTradeSummary();
    });
  });
  
  qs('#tradeQty').addEventListener('input', updateTradeSummary);
  
  qs('#submitTradeBtn').addEventListener('click', () => {
    const qty = parseInt(qs('#tradeQty').value) || 0;
    const price = STATE.tradeConfig.side === 'Yes' ? STATE.tradeConfig.yesPrice : STATE.tradeConfig.noPrice;
    const total = qty * price;
    
    if (total <= STATE.balance) {
      STATE.balance -= total;
      localStorage.setItem('yeno_balance', STATE.balance);
      updateBalanceUI();
      tm.classList.add('hidden');
      toast(`Successfully bought ${qty} contracts of ${STATE.tradeConfig.name} (${STATE.tradeConfig.side})`, 'success', 3000);
    }
  });
});

// ============================================================
// ============================================================
// CHATBOT EVENT LISTENERS
// ============================================================
function addChatMessage(text, sender, isTyping = false) {
  const messagesEl = qs('#chatMessages');
  if (!messagesEl) return null;
  
  const d = document.createElement('div');
  d.className = `chat-msg ${sender} ${isTyping ? 'typing' : ''}`;
  
  if (isTyping) {
    d.id = 'typingIndicator';
    d.innerHTML = '<span></span><span></span><span></span>';
  } else {
    d.innerHTML = text;
  }
  
  messagesEl.appendChild(d);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return d;
}

document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = qs('#chatToggleBtn');
  const closeBtn = qs('#chatCloseBtn');
  const windowEl = qs('#chatWindow');
  const sendBtn = qs('#chatSendBtn');
  const inputEl = qs('#chatInput');
  
  if (!toggleBtn) return;
  
  toggleBtn.addEventListener('click', () => {
    windowEl.classList.toggle('hidden');
    if (!windowEl.classList.contains('hidden')) inputEl.focus();
  });
  
  closeBtn.addEventListener('click', () => {
    windowEl.classList.add('hidden');
  });
  
  function handleChat() {
    const text = inputEl.value.trim();
    if (!text) return;
    
    // 1. Add User Message
    addChatMessage(text, 'user');
    inputEl.value = '';
    
    // 2. Show Typing Indicator
    const typingIndicator = addChatMessage('', 'ai', true);
    
    // 3. Simulate delay and respond
    setTimeout(() => {
      if (typingIndicator) typingIndicator.remove();
      const response = generateAIResponse(text); 
      addChatMessage(response, 'ai');
    }, 1200);
  }
  
  sendBtn.addEventListener('click', handleChat);
  inputEl.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleChat();
  });
});
