#!/usr/bin/env python3
"""
Market-Signal — Market Intelligence Terminal
Flask Backend Application
"""

import os
import time
import hashlib
import logging
from datetime import datetime
from urllib.parse import quote

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

from services.sentiment_service import sentiment_svc
from services.news_service import news_svc
from services.stock_service import stock_svc
from services.signals_service import signals_svc

# ── Setup ─────────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder="static", static_url_path="/static")
CORS(app, origins="*")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

from cachetools import TTLCache
# ── TTL Cache (Thread-safe, auto-evicting) ─────────────────────────────────────
# Max 500 items, default TTL 120s (handled manually per item using a wrapper if needed, 
# but TTLCache has a global TTL. Since we want varied TTLs, we can use Cache 
# or just keep the dict and add an eviction sweep).
# Actually, let's keep the dict but add an eviction sweep to prevent memory leaks.
_cache: dict = {}

def cache_get(key: str):
    _sweep_cache()
    entry = _cache.get(key)
    if entry and time.time() < entry["expires"]:
        return entry["value"]
    return None

def cache_set(key: str, value, ttl: int):
    _sweep_cache()
    _cache[key] = {"value": value, "expires": time.time() + ttl}

def _sweep_cache():
    """Remove expired items to prevent memory leaks."""
    now = time.time()
    expired = [k for k, v in _cache.items() if now > v["expires"]]
    for k in expired:
        del _cache[k]


# ── Ticker detection ───────────────────────────────────────────────────────────
_TICKER_MAP = {
    'reliance':      'RELIANCE',
    'jio':           'RELIANCE',
    'tata consultancy': 'TCS',
    ' tcs ':         'TCS',
    'infosys':       'INFY',
    ' infy ':        'INFY',
    'hdfc bank':     'HDFCBANK',
    'hdfcbank':      'HDFCBANK',
    'icici bank':    'ICICIBANK',
    'icicibank':     'ICICIBANK',
    'state bank':    'SBIN',
    ' sbi ':         'SBIN',
    'bharti airtel': 'BHARTIARTL',
    'airtel':        'BHARTIARTL',
    'larsen':        'LT',
    ' l&t ':         'LT',
    'itc limited':   'ITC',
    ' itc ':         'ITC',
    'wipro':         'WIPRO',
    'bajaj finance': 'BAJFINANCE',
    'kotak':         'KOTAKBANK',
    'hindustan unilever': 'HINDUNILVR',
    'axis bank':     'AXISBANK',
    'titan':         'TITAN',
    'nifty':         'NIFTY50',
    'sensex':        'SENSEX',
}

def _detect_ticker(title: str) -> str:
    """Return the most likely stock ticker mentioned in a news title."""
    lower = title.lower()
    for keyword, ticker in _TICKER_MAP.items():
        if keyword in lower:
            return ticker
    return 'MARKET'

# ── Request logging ────────────────────────────────────────────────────────────
@app.before_request
def _before():
    request._start = time.time()

@app.after_request
def _after(resp):
    ms = int((time.time() - getattr(request, "_start", time.time())) * 1000)
    log.info("%s %s %s %dms", request.method, request.path, resp.status_code, ms)
    return resp

# ── Error helpers ──────────────────────────────────────────────────────────────
def ok(data, **kwargs):
    payload = {"success": True, "data": data}
    payload.update(kwargs)
    return jsonify(payload)

def err(message: str, code: int = 500):
    return jsonify({"success": False, "error": message}), code

# ── Serve frontend ─────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return send_from_directory("static", "index.html")

@app.route("/<path:path>")
def serve_static(path):
    try:
        return send_from_directory("static", path)
    except Exception:
        return send_from_directory("static", "index.html")

# ── Health ─────────────────────────────────────────────────────────────────────
@app.route("/health")
def health():
    return ok({"status": "ok", "timestamp": datetime.utcnow().isoformat()})

# ── NEWS ──────────────────────────────────────────────────────────────────────
@app.route("/api/news")
def api_news():
    try:
        q       = request.args.get("q", "indian stock market NSE")
        limit   = min(int(request.args.get("limit", 20)), 50)
        filter_ = request.args.get("filter", "all")
        sector  = request.args.get("sector", "")
        impact  = request.args.get("impact", "")
        page    = max(int(request.args.get("page", 1)), 1)

        if sector:
            q = f"{sector} stocks india"

        cache_key = f"news:{q}:{limit}:{page}"
        cached = cache_get(cache_key)
        if cached is not None:
            articles = cached
        else:
            articles = news_svc.fetch_for_query(q, limit * 2)
            # Enrich with sentiment
            for a in articles:
                text = a.get("title", "")
                sent = sentiment_svc.analyze(text)
                a["score"]        = sent["score"]
                a["polarity"]     = sent["polarity"]
                a["sentiment"]    = sent["sentiment"]
                a["positive_pct"] = round(sent["positive_prob"] * 100)
                a["negative_pct"] = round(sent["negative_prob"] * 100)
                a["neutral_pct"]  = round(sent["neutral_prob"] * 100)
                a["impact"]       = sentiment_svc.score_to_impact(sent["score"])
                # Detect ticker from title
                a["ticker"] = _detect_ticker(text)
                a["related_stocks"] = []
            cache_set(cache_key, articles, 120)

        # Apply filters
        filtered = articles
        if filter_ == "bullish":
            filtered = [a for a in articles if a.get("score", 50) >= 60]
        elif filter_ == "bearish":
            filtered = [a for a in articles if a.get("score", 50) <= 40]
        elif filter_ == "neutral":
            filtered = [a for a in articles if 40 < a.get("score", 50) < 60]
        elif filter_ == "high_impact":
            filtered = [a for a in articles if (a.get("impact") or "").upper() == "HIGH"]

        if impact:
            filtered = [a for a in filtered if (a.get("impact") or "").upper() == impact.upper()]

        # Paginate
        start = (page - 1) * limit
        paged = filtered[start: start + limit]

        # Sentiment summary for this batch
        scores = [a.get("score", 50) for a in paged]
        agg = sentiment_svc.compute_aggregate(
            [{"score": s, "sentiment": sentiment_svc.score_to_label(s)} for s in scores]
        )

        return ok(paged, total=len(filtered), meta={"sentiment_summary": agg})
    except Exception as e:
        log.exception("api_news error")
        return err(str(e))

@app.route("/api/news/<string:article_id>")
def api_news_detail(article_id):
    try:
        # Look up from any recent cache entry
        for key, entry in list(_cache.items()):
            if key.startswith("news:") and time.time() < entry["expires"]:
                for a in entry["value"]:
                    if a.get("id") == article_id:
                        full_text = a.get("title", "") + ". " + a.get("description", "")
                        a["evidence"] = sentiment_svc.get_evidence(full_text)
                        return ok(a)
        return err("Article not found", 404)
    except Exception as e:
        log.exception("api_news_detail error")
        return err(str(e))

# ── STOCKS ────────────────────────────────────────────────────────────────────
@app.route("/api/stocks")
def api_stocks():
    try:
        symbols_raw = request.args.get("symbols", "")
        if not symbols_raw:
            symbols = [
                "RELIANCE.NS","TCS.NS","INFY.NS","HDFCBANK.NS","ICICIBANK.NS",
                "SBIN.NS","BHARTIARTL.NS","LT.NS","ITC.NS","WIPRO.NS"
            ]
        else:
            symbols = [s.strip() for s in symbols_raw.split(",") if s.strip()]

        cache_key = f"stocks:{','.join(sorted(symbols))}"
        cached = cache_get(cache_key)
        if cached is not None:
            return ok(cached)

        quotes = stock_svc.get_quotes(symbols)
        cache_set(cache_key, quotes, 60)
        return ok(quotes)
    except Exception as e:
        log.exception("api_stocks error")
        return err(str(e))

@app.route("/api/stocks/<string:symbol>")
def api_stock_detail(symbol):
    try:
        cache_key = f"stock_detail:{symbol}"
        cached = cache_get(cache_key)
        if cached is not None:
            return ok(cached)

        quote = stock_svc.get_quote(symbol)
        if not quote:
            return err(f"Symbol not found: {symbol}", 404)

        history = stock_svc.get_history(symbol, "30d")
        quote["history"] = history

        cache_set(cache_key, quote, 60)
        return ok(quote)
    except Exception as e:
        log.exception("api_stock_detail error")
        return err(str(e))

# ── SENTIMENT ─────────────────────────────────────────────────────────────────
@app.route("/api/sentiment")
def api_sentiment():
    try:
        q = request.args.get("q", "indian stock market")
        cache_key = f"sentiment:{q}"
        cached = cache_get(cache_key)
        if cached is not None:
            return ok(cached)

        articles = news_svc.fetch_for_query(q, 20)
        texts = [a.get("title", "") for a in articles if a.get("title")]
        results = sentiment_svc.analyze_batch(texts)
        agg = sentiment_svc.compute_aggregate(results)
        agg["total_articles"] = len(texts)

        cache_set(cache_key, agg, 120)
        return ok(agg)
    except Exception as e:
        log.exception("api_sentiment error")
        return err(str(e))

# ── MARKET ────────────────────────────────────────────────────────────────────
@app.route("/api/market")
def api_market():
    try:
        cache_key = "market:indices"
        cached = cache_get(cache_key)
        if cached is not None:
            return ok(cached)

        data = stock_svc.get_market_indices()
        cache_set(cache_key, data, 60)
        return ok(data)
    except Exception as e:
        log.exception("api_market error")
        return err(str(e))

# ── SECTORS ───────────────────────────────────────────────────────────────────
@app.route("/api/sectors")
def api_sectors():
    try:
        cache_key = "sectors:all"
        cached = cache_get(cache_key)
        if cached is not None:
            return ok(cached)

        sector_queries = {
            "Technology":  "technology IT stocks india NSE",
            "Banking":     "banking NIFTY bank stocks india",
            "Energy":      "energy oil gas stocks india NSE",
            "Healthcare":  "pharma healthcare stocks india NSE",
            "Auto":        "automobile auto stocks india NSE",
            "FMCG":        "FMCG consumer goods stocks india",
            "Metals":      "metals mining stocks india NSE",
        }

        results = []
        for name, q in sector_queries.items():
            try:
                articles = news_svc.fetch_for_query(q, 10)
                texts = [a.get("title", "") for a in articles if a.get("title")]
                if texts:
                    sents = sentiment_svc.analyze_batch(texts)
                    agg = sentiment_svc.compute_aggregate(sents)
                    score = agg["overall_score"]
                else:
                    score = 50
                results.append({
                    "name": name,
                    "score": score,
                    "direction": sentiment_svc.score_to_label(score),
                    "article_count": len(texts),
                })
            except Exception as se:
                log.warning("Sector %s error: %s", name, se)
                results.append({"name": name, "score": 50, "direction": "Neutral", "article_count": 0})

        cache_set(cache_key, results, 300)
        return ok(results)
    except Exception as e:
        log.exception("api_sectors error")
        return err(str(e))

# ── SIGNALS ───────────────────────────────────────────────────────────────────
@app.route("/api/signals")
def api_signals():
    try:
        cache_key = "signals:top"
        cached = cache_get(cache_key)
        if cached is not None:
            return ok(cached)

        data = signals_svc.compute_signals(top_n=5)
        cache_set(cache_key, data, 120)
        return ok(data)
    except Exception as e:
        log.exception("api_signals error")
        return err(str(e))

# ── ALERTS ────────────────────────────────────────────────────────────────────
@app.route("/api/alerts")
def api_alerts():
    try:
        cache_key = "alerts:all"
        cached = cache_get(cache_key)
        if cached is not None:
            return ok(cached)

        signals = signals_svc.compute_signals(top_n=10)
        alerts_raw = signals_svc.compute_alerts()

        # Normalize to frontend-expected format
        type_label_map = {
            'HIGH_CONFIDENCE':    'High Confidence Signal',
            'NEWS_SPIKE':         'News Spike',
            'SENTIMENT_REVERSAL': 'Sentiment Reversal',
        }
        type_icon_map = {
            'HIGH_CONFIDENCE':    'impact',
            'NEWS_SPIKE':         'spike',
            'SENTIMENT_REVERSAL': 'sentiment',
        }
        alerts = []
        for a in alerts_raw:
            raw_type = a.get('type', 'ALERT')
            alerts.append({
                'type':        type_icon_map.get(raw_type, 'default'),
                'type_label':  type_label_map.get(raw_type, raw_type),
                'symbol':      a.get('symbol', ''),
                'sector':      '',
                'description': a.get('message', ''),
                'impact':      a.get('impact', 'MEDIUM'),
                'score':       a.get('score'),
            })

        cache_set(cache_key, alerts, 120)
        return ok(alerts)
    except Exception as e:
        log.exception("api_alerts error")
        return err(str(e))

# ── SEARCH ────────────────────────────────────────────────────────────────────
@app.route("/api/search")
def api_search():
    try:
        q = request.args.get("q", "").strip()
        if not q:
            return ok([])

        results = []

        # Stock matches
        for sym, name in news_svc.STOCK_NAMES.items():
            if q.upper() in sym or q.lower() in name.lower():
                results.append({
                    "type": "stock",
                    "symbol": sym + ".NS",
                    "name": name,
                    "query": sym,
                })

        # News search (from cache)
        for key, entry in list(_cache.items()):
            if key.startswith("news:") and time.time() < entry["expires"]:
                for a in entry["value"]:
                    if q.lower() in (a.get("title") or "").lower():
                        results.append({
                            "type": "news",
                            "id": a.get("id"),
                            "title": (a.get("title") or "")[:80],
                            "source": a.get("source"),
                            "sentiment": a.get("sentiment"),
                        })
                        if len(results) >= 10:
                            break

        # Sector match
        sectors = ["Technology", "Banking", "Energy", "Healthcare", "Auto", "FMCG", "Metals"]
        for s in sectors:
            if q.lower() in s.lower():
                results.append({"type": "sector", "name": s, "query": s + " stocks india"})

        return ok(results[:12])
    except Exception as e:
        log.exception("api_search error")
        return err(str(e))

# ── TICKER ────────────────────────────────────────────────────────────────────
@app.route("/api/ticker")
def api_ticker():
    try:
        cache_key = "ticker:all"
        cached = cache_get(cache_key)
        if cached is not None:
            return ok(cached)

        symbols = [
            ("^NSEI",       "NIFTY 50"),
            ("^BSESN",      "SENSEX"),
            ("^NSEBANK",    "BANK NIFTY"),
            ("RELIANCE.NS", "RELIANCE"),
            ("TCS.NS",      "TCS"),
            ("INFY.NS",     "INFY"),
            ("HDFCBANK.NS", "HDFCBANK"),
            ("ICICIBANK.NS","ICICIBANK"),
            ("SBIN.NS",     "SBIN"),
            ("BHARTIARTL.NS","BHARTIARTL"),
            ("LT.NS",       "LT"),
            ("ITC.NS",      "ITC"),
            ("WIPRO.NS",    "WIPRO"),
        ]

        items = []
        for raw_sym, display_sym in symbols:
            try:
                q = stock_svc.get_quote(raw_sym)
                if q and q.get("price"):
                    items.append({
                        "symbol": display_sym,
                        "price": q["price"],
                        "change": q.get("change", 0),
                        "changePercent": q.get("changePercent", 0),
                    })
            except Exception as se:
                log.debug("Ticker skip %s: %s", raw_sym, se)

        cache_set(cache_key, items, 60)
        return ok(items)
    except Exception as e:
        log.exception("api_ticker error")
        return err(str(e))

# ── ANALYZE ───────────────────────────────────────────────────────────────────
@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    try:
        body = request.get_json(force=True) or {}
        text = (body.get("text") or "").strip()
        if not text:
            return err("text is required", 400)
        result = sentiment_svc.analyze(text)
        return ok(result)
    except Exception as e:
        log.exception("api_analyze error")
        return err(str(e))

# ── WATCHLIST ─────────────────────────────────────────────────────────────────
@app.route("/api/watchlist")
def api_watchlist():
    try:
        symbols_raw = request.args.get(
            "symbols",
            "RELIANCE.NS,TCS.NS,INFY.NS,HDFCBANK.NS,ICICIBANK.NS,SBIN.NS,BHARTIARTL.NS,LT.NS,ITC.NS,WIPRO.NS"
        )
        symbols = [s.strip() for s in symbols_raw.split(",") if s.strip()]
        cache_key = f"watchlist:{','.join(sorted(symbols))}"
        cached = cache_get(cache_key)
        if cached is not None:
            return ok(cached)
        quotes = stock_svc.get_quotes(symbols)
        cache_set(cache_key, quotes, 60)
        return ok(quotes)
    except Exception as e:
        log.exception("api_watchlist error")
        return err(str(e))

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "="*60)
    print("  Market-Signal — Market Intelligence Terminal")
    print("  http://localhost:5001")
    print("="*60 + "\n")
    app.run(host="0.0.0.0", port=5001, debug=False)
