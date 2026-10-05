"""
services/stock_service.py
--------------------------
Retrieves live stock quotes, historical price data and market-index snapshots
using yfinance.  All public methods are safe to call without authentication.
"""

import yfinance as yf

# ---------------------------------------------------------------------------
# Known symbol → friendly name mapping (covers NSE watchlist + indices)
# ---------------------------------------------------------------------------
STOCK_NAMES = {
    'RELIANCE.NS':   'Reliance Industries',
    'TCS.NS':        'TCS',
    'INFY.NS':       'Infosys',
    'HDFCBANK.NS':   'HDFC Bank',
    'ICICIBANK.NS':  'ICICI Bank',
    'SBIN.NS':       'State Bank of India',
    'BHARTIARTL.NS': 'Bharti Airtel',
    'LT.NS':         'Larsen & Toubro',
    'ITC.NS':        'ITC Limited',
    'WIPRO.NS':      'Wipro',
    'BAJFINANCE.NS': 'Bajaj Finance',
    'KOTAKBANK.NS':  'Kotak Mahindra Bank',
    'HINDUNILVR.NS': 'Hindustan Unilever',
    'AXISBANK.NS':   'Axis Bank',
    'TITAN.NS':      'Titan Company',
}

INDEX_NAMES = {
    '^NSEI':    'NIFTY 50',
    '^BSESN':   'SENSEX',
    '^NSEBANK': 'BANK NIFTY',
}


class StockService:
    """Thin yfinance wrapper with safe, nullable field handling."""

    # ------------------------------------------------------------------
    # Single-stock quote
    # ------------------------------------------------------------------

    def get_quote(self, symbol: str) -> dict | None:
        """
        Return a quote dict for *symbol* or None on error.

        Fields: symbol, name, price, change, changePercent,
                open, high, low, volume, marketCap, pe_ratio,
                week52High, week52Low, currency
        """
        try:
            ticker = yf.Ticker(symbol)
            fi = ticker.fast_info          # lightweight, no full info call

            price = self._safe(fi, 'last_price')
            prev_close = self._safe(fi, 'previous_close')
            
            if price is not None and prev_close is not None and prev_close > 0:
                change = round(float(price) - float(prev_close), 2)
                change_pct = round(change / float(prev_close) * 100, 2)
            else:
                change = 0.0
                change_pct = 0.0

            name = STOCK_NAMES.get(symbol.upper(), symbol)

            alt_data = {}
            try:
                info = ticker.info
                alt_data = {
                    'analyst_consensus': str(info.get('recommendationKey', 'None')).replace('_', ' ').title(),
                    'target_mean_price': info.get('targetMeanPrice'),
                    'target_high_price': info.get('targetHighPrice'),
                    'inst_ownership': round(info.get('heldPercentInstitutions', 0) * 100, 2) if info.get('heldPercentInstitutions') else None,
                    'short_ratio': info.get('shortRatio')
                }
            except Exception:
                pass

            return {
                'symbol':        symbol,
                'name':          name,
                'price':         self._round(price),
                'change':        change,
                'changePercent': change_pct,
                'open':          self._round(self._safe(fi, 'open')),
                'high':          self._round(self._safe(fi, 'day_high')),
                'low':           self._round(self._safe(fi, 'day_low')),
                'volume':        self._int(self._safe(fi, 'three_month_average_volume')),
                'marketCap':     self._int(self._safe(fi, 'market_cap')),
                'week52High':    self._round(self._safe(fi, 'year_high')),
                'week52Low':     self._round(self._safe(fi, 'year_low')),
                'currency':      self._safe(fi, 'currency') or 'INR',
                'alt_data':      alt_data
            }
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Price history
    # ------------------------------------------------------------------

    def get_history(self, symbol: str, period: str = '30d') -> list:
        """
        Return a list of daily OHLCV dicts for *symbol* over *period*.

        Each item: {date, open, high, low, close, volume}
        """
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period=period)
            result = []
            for idx, row in hist.iterrows():
                result.append({
                    'date':   str(idx.date()),
                    'open':   round(float(row['Open']), 2),
                    'high':   round(float(row['High']), 2),
                    'low':    round(float(row['Low']), 2),
                    'close':  round(float(row['Close']), 2),
                    'volume': int(row['Volume']),
                })
            return result
        except Exception:
            return []

    # ------------------------------------------------------------------
    # Batch quotes
    # ------------------------------------------------------------------

    def get_quotes(self, symbols: list) -> dict:
        """
        Return a dict of {symbol: quote_dict} for a list of symbols.
        Missing / failed symbols are omitted from the output.
        """
        result = {}
        for sym in symbols:
            quote = self.get_quote(sym.strip())
            if quote:
                result[sym.strip()] = quote
        return result

    # ------------------------------------------------------------------
    # Market indices
    # ------------------------------------------------------------------

    def get_market_indices(self) -> dict:
        """
        Return current values for NIFTY 50, SENSEX, and BANK NIFTY.

        Returns: {
            'NIFTY50':   {symbol, name, price, change, changePercent},
            'SENSEX':    {...},
            'BANKNIFTY': {...},
        }
        """
        mapping = {
            'NIFTY50':   '^NSEI',
            'SENSEX':    '^BSESN',
            'BANKNIFTY': '^NSEBANK',
        }
        result = {}
        for key, yf_symbol in mapping.items():
            try:
                ticker = yf.Ticker(yf_symbol)
                fi = ticker.fast_info
                
                price = getattr(fi, 'last_price', None) or fi.get('lastPrice')
                prev = getattr(fi, 'previous_close', None) or fi.get('previousClose')
                
                if price is None:
                    hist = ticker.history(period='1d')
                    if hist is not None and not hist.empty:
                        price = float(hist['Close'].iloc[-1])
                    else:
                        continue
                
                price = round(float(price), 2)
                
                if prev is not None and float(prev) > 0:
                    prev = float(prev)
                    change = round(price - prev, 2)
                    change_pct = round(change / prev * 100, 2)
                else:
                    change = 0.0
                    change_pct = 0.0

                
                vol = getattr(fi, 'last_volume', None) or fi.get('lastVolume') or 0
                high = getattr(fi, 'day_high', None) or fi.get('dayHigh') or 0
                low = getattr(fi, 'day_low', None) or fi.get('dayLow') or 0

                result[key] = {
                    'symbol':        yf_symbol,
                    'name':          INDEX_NAMES.get(yf_symbol, key),
                    'price':         price,
                    'change':        change,
                    'changePercent': change_pct,
                    'volume':        int(vol),
                    'high':          round(float(high), 2),
                    'low':           round(float(low), 2),
                }
            except Exception:
                continue

        return result

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _safe(obj, attr: str):
        """Safely read an attribute; return None on any error."""
        try:
            v = getattr(obj, attr, None)
            if v is None:
                return None
            import math
            if isinstance(v, float) and math.isnan(v):
                return None
            return v
        except Exception:
            return None

    @staticmethod
    def _round(v, decimals: int = 2):
        try:
            return round(float(v), decimals) if v is not None else None
        except Exception:
            return None

    @staticmethod
    def _int(v):
        try:
            return int(v) if v is not None else None
        except Exception:
            return None


# Module-level singleton
stock_svc = StockService()
