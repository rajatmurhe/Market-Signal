"""
services/signals_service.py
----------------------------
Derives AI-style trading signals from news sentiment data.
Signals rank NSE watchlist stocks by the strength (magnitude)
of their sentiment deviation from neutral (50).
"""

from services.news_service import news_svc
from services.sentiment_service import sentiment_svc

# ---------------------------------------------------------------------------
# Watchlist & metadata
# ---------------------------------------------------------------------------
WATCHLIST = [
    'RELIANCE.NS', 'TCS.NS', 'INFY.NS', 'HDFCBANK.NS', 'ICICIBANK.NS',
    'SBIN.NS', 'BHARTIARTL.NS', 'LT.NS', 'ITC.NS', 'WIPRO.NS',
]

STOCK_NAMES = {
    'RELIANCE.NS':   'Reliance Industries',
    'TCS.NS':        'Tata Consultancy Services',
    'INFY.NS':       'Infosys',
    'HDFCBANK.NS':   'HDFC Bank',
    'ICICIBANK.NS':  'ICICI Bank',
    'SBIN.NS':       'State Bank of India',
    'BHARTIARTL.NS': 'Bharti Airtel',
    'LT.NS':         'Larsen & Toubro',
    'ITC.NS':        'ITC Limited',
    'WIPRO.NS':      'Wipro',
}

# Rough peer groupings for the 'related_stocks' field
RELATED = {
    'RELIANCE.NS':   ['ONGC.NS', 'IOC.NS', 'BPCL.NS'],
    'TCS.NS':        ['INFY.NS', 'WIPRO.NS', 'HCLTECH.NS'],
    'INFY.NS':       ['TCS.NS', 'WIPRO.NS', 'TECHM.NS'],
    'HDFCBANK.NS':   ['ICICIBANK.NS', 'KOTAKBANK.NS', 'AXISBANK.NS'],
    'ICICIBANK.NS':  ['HDFCBANK.NS', 'SBIN.NS', 'AXISBANK.NS'],
    'SBIN.NS':       ['ICICIBANK.NS', 'PNB.NS', 'BANKBARODA.NS'],
    'BHARTIARTL.NS': ['VODAFONE.NS', 'IDEA.NS'],
    'LT.NS':         ['ULTRACEMCO.NS', 'NTPC.NS', 'POWERGRID.NS'],
    'ITC.NS':        ['HINDUNILVR.NS', 'DABUR.NS', 'MARICO.NS'],
    'WIPRO.NS':      ['TCS.NS', 'INFY.NS', 'TECHM.NS'],
}

# Reason templates
_BULL_REASON = (
    "Strong positive news momentum around {name} with {count} recent articles "
    "showing bullish sentiment."
)
_BEAR_REASON = (
    "Recent news indicates negative sentiment for {name} with {count} articles "
    "reflecting bearish signals."
)
_NEUTRAL_REASON = (
    "Mixed news flow for {name} — sentiment is balanced across {count} recent articles."
)


import concurrent.futures

class SignalsService:
    """Computes trading signals from latest news sentiment for the watchlist."""

    def _process_symbol(self, symbol: str) -> dict | None:
        try:
            name = STOCK_NAMES.get(symbol, symbol)
            articles = news_svc.fetch_for_stock(symbol, limit=10)

            if not articles:
                # No news → flat neutral signal
                agg = sentiment_svc.compute_aggregate([])
            else:
                sentiments = [
                    sentiment_svc.analyze(a['title']) for a in articles
                ]
                agg = sentiment_svc.compute_aggregate(sentiments)

            score = agg['overall_score']
            count = agg['total']
            trend = agg['trend']                 # 'Bullish' | 'Bearish' | 'Neutral'
            velocity = agg.get('velocity', 0.0)

            direction = trend
            impact = sentiment_svc.score_to_impact(score)

            # More intelligent dynamic reasoning based on actual stats
            if trend == 'Bullish':
                reason = f"Strong positive news momentum around {name}. Out of {count} recent articles, {agg['positive_pct']}% show bullish sentiment, indicating potential upward pressure."
            elif trend == 'Bearish':
                reason = f"Recent news indicates negative sentiment for {name}. With {agg['negative_pct']}% of {count} recent articles reflecting bearish signals, near-term caution is advised."
            else:
                reason = f"Mixed news flow for {name}. Sentiment is highly neutral ({agg['neutral_pct']}%) across {count} recent articles, suggesting consolidation."

            # Confidence: scaled by how far score is from 50 (max deviation 50) + volume factor
            deviation = abs(score - 50)
            base_conf = deviation / 50.0
            volume_bonus = min(count / 20.0, 0.2)  # up to +20% confidence for high news volume
            confidence = round(min(base_conf + volume_bonus, 1.0), 2)

            return {
                'symbol':          symbol,
                'name':            name,
                'direction':       direction,
                'sentiment_score': score,
                'confidence':      confidence,
                'news_momentum':   velocity,
                'impact':          impact,
                'reason':          reason,
                'related_stocks':  RELATED.get(symbol, []),
                'article_count':   count,
                'positive_pct':    agg['positive_pct'],
                'negative_pct':    agg['negative_pct'],
                'neutral_pct':     agg['neutral_pct'],
            }
        except Exception:
            return None

    def compute_signals(self, top_n: int = 5) -> list:
        """
        For each symbol in WATCHLIST, fetch news concurrently and compute signal.
        """
        signals = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            future_to_sym = {executor.submit(self._process_symbol, sym): sym for sym in WATCHLIST}
            for future in concurrent.futures.as_completed(future_to_sym):
                res = future.result()
                if res:
                    signals.append(res)

        # Sort by signal strength (deviation from neutral) descending
        signals.sort(key=lambda s: abs(s['sentiment_score'] - 50), reverse=True)
        return signals[:top_n]

    def compute_alerts(self) -> list:
        """
        Derive actionable alerts from the current signal set.

        Alert types:
          - SENTIMENT_REVERSAL : a stock with recent strong signals
          - NEWS_SPIKE         : unusually high article count
          - HIGH_CONFIDENCE    : confidence >= 0.7
        """
        try:
            all_signals = self.compute_signals(top_n=len(WATCHLIST))
        except Exception:
            return []

        alerts = []
        for sig in all_signals:
            score = sig['sentiment_score']
            conf  = sig['confidence']
            count = sig['article_count']

            if conf >= 0.70:
                alerts.append({
                    'type':    'HIGH_CONFIDENCE',
                    'symbol':  sig['symbol'],
                    'name':    sig['name'],
                    'message': (
                        f"{sig['name']} shows {sig['direction'].lower()} signal "
                        f"with {int(conf * 100)}% confidence."
                    ),
                    'score':   score,
                    'impact':  sig['impact'],
                })
            if count >= 8:
                alerts.append({
                    'type':    'NEWS_SPIKE',
                    'symbol':  sig['symbol'],
                    'name':    sig['name'],
                    'message': (
                        f"News spike detected for {sig['name']}: "
                        f"{count} articles found in latest fetch."
                    ),
                    'score':   score,
                    'impact':  'HIGH',
                })
            if score >= 75 or score <= 25:
                alerts.append({
                    'type':    'SENTIMENT_REVERSAL',
                    'symbol':  sig['symbol'],
                    'name':    sig['name'],
                    'message': (
                        f"Extreme {'bullish' if score >= 75 else 'bearish'} sentiment "
                        f"detected for {sig['name']} (score: {score}/100). "
                        "Possible sentiment reversal risk."
                    ),
                    'score':   score,
                    'impact':  'HIGH',
                })

        return alerts


# Module-level singleton
signals_svc = SignalsService()
