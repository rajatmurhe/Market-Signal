"""
services/news_service.py
-------------------------
Fetches news from Google News RSS (via feedparser) and enriches each article
with source, category, and a short AI summary — without hitting individual
article URLs (which would be too slow for a web API).
"""

import hashlib
import re
from urllib.parse import quote

import feedparser


# ---------------------------------------------------------------------------
# Known NSE stock → company name mapping
# ---------------------------------------------------------------------------
STOCK_NAMES = {
    'RELIANCE':    'Reliance Industries',
    'TCS':         'Tata Consultancy Services',
    'INFY':        'Infosys',
    'HDFCBANK':    'HDFC Bank',
    'ICICIBANK':   'ICICI Bank',
    'SBIN':        'State Bank of India',
    'BHARTIARTL':  'Bharti Airtel',
    'LT':          'Larsen & Toubro',
    'ITC':         'ITC Limited',
    'WIPRO':       'Wipro',
    'BAJFINANCE':  'Bajaj Finance',
    'KOTAKBANK':   'Kotak Mahindra Bank',
    'HINDUNILVR':  'Hindustan Unilever',
    'AXISBANK':    'Axis Bank',
    'TITAN':       'Titan Company',
}

# Category keyword rules (checked in order — first match wins)
_CATEGORY_RULES = [
    ('Earnings',            ['earnings', 'profit', 'revenue', 'quarterly', 'results', 'q1', 'q2', 'q3', 'q4', 'fy']),
    ('Merger/Acquisition',  ['merger', 'acquisition', 'acquires', 'takeover', 'buyout', 'deal', 'stake']),
    ('IPO',                 ['ipo', 'listing', 'public offer', 'initial public']),
    ('Policy',              ['policy', 'rbi', 'sebi', 'government', 'regulation', 'budget', 'tax', 'rate']),
    ('Results',             ['results', 'announces', 'reported', 'net profit', 'net loss']),
    ('Investment',          ['investment', 'invest', 'fund', 'raise', 'capital', 'funding', 'venture']),
    ('Management',          ['ceo', 'cfo', 'md', 'director', 'appoints', 'resigns', 'leadership', 'management']),
    ('Expansion',           ['expansion', 'launch', 'plant', 'capacity', 'new facility', 'enters', 'opens']),
]


class NewsService:
    """Fetches and enriches news articles for stocks / market topics."""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def fetch_for_query(self, query: str, limit: int = 20) -> list:
        """
        Fetch up to *limit* articles from Google News RSS for *query*.

        Each returned article dict contains:
            id, title, link, published, source, description, category, ai_summary
        """
        rss_url = f"https://news.google.com/rss/search?q={quote(query)}&hl=en-IN&gl=IN&ceid=IN:en"
        try:
            import requests
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
            resp = requests.get(rss_url, headers=headers, timeout=10)
            feed = feedparser.parse(resp.content)
            entries = feed.entries[:limit]
        except Exception:
            return []

        articles = []
        for entry in entries:
            title = getattr(entry, 'title', '') or ''
            link  = getattr(entry, 'link',  '') or ''
            pub   = getattr(entry, 'published', '') or ''
            desc  = getattr(entry, 'summary', '') or ''

            # Strip HTML tags from description
            desc_clean = re.sub(r'<[^>]+>', '', desc).strip()

            article_id = self._make_id(link)
            source     = self.extract_source(title)
            category   = self.categorize(title)
            ai_summary = self.generate_summary(title, desc_clean)

            articles.append({
                'id':         article_id,
                'title':      title,
                'link':       link,
                'published':  pub,
                'source':     source,
                'description': desc_clean,
                'category':   category,
                'ai_summary': ai_summary,
            })

        return articles

    def fetch_for_stock(self, symbol: str, limit: int = 15) -> list:
        """
        Fetch news for an NSE stock symbol (e.g. 'RELIANCE.NS' or 'RELIANCE').
        Strips the '.NS' suffix and looks up the full company name for a richer query.
        """
        bare = symbol.replace('.NS', '').replace('.BO', '').upper()
        company = STOCK_NAMES.get(bare, bare)
        query = f"{company} stock India"
        return self.fetch_for_query(query, limit)

    # ------------------------------------------------------------------
    # Enrichment helpers
    # ------------------------------------------------------------------

    @staticmethod
    def extract_source(title: str) -> str:
        """
        Google News titles commonly end with '- Source Name'.
        Extract and return the source, or 'Unknown' if not found.
        """
        # Match ' - Anything at End'
        match = re.search(r'\s-\s([^-]+)$', title)
        if match:
            return match.group(1).strip()
        return 'Unknown'

    @staticmethod
    def categorize(title: str) -> str:
        """
        Return the best-matching category for the article title
        using simple keyword matching.  Falls back to 'General'.
        """
        lower = title.lower()
        for category, keywords in _CATEGORY_RULES:
            if any(kw in lower for kw in keywords):
                return category
        return 'General'

    @staticmethod
    def generate_summary(title: str, content: str) -> str:
        """
        Generate a short AI-style summary from available text.
        We avoid hitting the live URL, so we work with the RSS description only.
        Returns first 200 chars of content, or a rephrasing of the title.
        """
        if content and len(content) > 20:
            snippet = content[:200].strip()
            if not snippet.endswith('.'):
                snippet += '…'
            return snippet
        # Fallback: rephrase the title slightly
        clean = re.sub(r'\s-\s[^-]+$', '', title).strip()
        return f"News report: {clean}." if clean else title

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _make_id(link: str) -> str:
        """Create a stable 12-char hex id from the article URL."""
        return hashlib.md5(link.encode()).hexdigest()[:12]


# Module-level singleton
news_svc = NewsService()
