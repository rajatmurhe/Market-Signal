"""
services/sentiment_service.py
-------------------------------
Lightweight sentiment analysis using VADER.
Intentionally avoids torch/transformers to keep the web-server start-up fast.
"""

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer


class SentimentService:
    """Wrapper around VADER SentimentIntensityAnalyzer with helper utilities."""

    def __init__(self):
        self.analyzer = SentimentIntensityAnalyzer()

    # ------------------------------------------------------------------
    # Core analysis
    # ------------------------------------------------------------------

    def analyze(self, text: str) -> dict:
        """
        Analyse a single piece of text.

        Returns a dict with:
            score         : int  0-100  (VADER compound mapped linearly)
            polarity      : float -1 to 1  (raw VADER compound)
            sentiment     : str  'Positive' | 'Negative' | 'Neutral'
            confidence    : float 0-1
            positive_prob : float
            negative_prob : float
            neutral_prob  : float
        """
        if not text or not text.strip():
            return {
                'score': 50,
                'polarity': 0.0,
                'sentiment': 'Neutral',
                'confidence': 0.5,
                'positive_prob': 0.33,
                'negative_prob': 0.33,
                'neutral_prob': 0.34,
            }

        scores = self.analyzer.polarity_scores(text)
        compound = scores['compound']

        # Map compound (-1…1) → score (0…100)
        score = int((compound + 1) * 50)

        pos = scores['pos']
        neg = scores['neg']
        neu = scores['neu']

        if compound >= 0.05:
            sentiment = 'Positive'
        elif compound <= -0.05:
            sentiment = 'Negative'
        else:
            sentiment = 'Neutral'

        confidence = max(pos, neg, neu)

        return {
            'score': score,
            'polarity': round(compound, 4),
            'sentiment': sentiment,
            'confidence': round(confidence, 3),
            'positive_prob': round(pos, 3),
            'negative_prob': round(neg, 3),
            'neutral_prob': round(neu, 3),
        }

    def analyze_batch(self, texts: list) -> list:
        """Analyse a list of texts and return a list of result dicts."""
        return [self.analyze(t) for t in texts]

    # ------------------------------------------------------------------
    # Aggregation helpers
    # ------------------------------------------------------------------

    def compute_aggregate(self, sentiment_results: list) -> dict:
        """
        Aggregate a list of analyze() results into summary statistics.

        Returns:
            overall_score : int
            positive_pct  : int
            negative_pct  : int
            neutral_pct   : int
            total         : int
            trend         : str  'Bullish' | 'Bearish' | 'Neutral'
            velocity      : float  (std-dev of scores as a proxy for momentum)
        """
        if not sentiment_results:
            return {
                'overall_score': 50,
                'positive_pct': 33,
                'negative_pct': 33,
                'neutral_pct': 34,
                'total': 0,
                'trend': 'Neutral',
                'velocity': 0.0,
            }

        total = len(sentiment_results)
        pos_count = sum(1 for s in sentiment_results if s['sentiment'] == 'Positive')
        neg_count = sum(1 for s in sentiment_results if s['sentiment'] == 'Negative')
        neu_count = total - pos_count - neg_count

        avg_score = sum(s['score'] for s in sentiment_results) / total

        # Simple trend label
        if avg_score >= 60:
            trend = 'Bullish'
        elif avg_score <= 40:
            trend = 'Bearish'
        else:
            trend = 'Neutral'

        # Velocity: std-dev of scores (higher = more volatile/fast-moving sentiment)
        try:
            import math
            variance = sum((s['score'] - avg_score) ** 2 for s in sentiment_results) / total
            velocity = round(math.sqrt(variance), 2)
        except Exception:
            velocity = 0.0

        return {
            'overall_score': round(avg_score),
            'positive_pct': round(pos_count / total * 100),
            'negative_pct': round(neg_count / total * 100),
            'neutral_pct': round(neu_count / total * 100),
            'total': total,
            'trend': trend,
            'velocity': velocity,
        }

    # ------------------------------------------------------------------
    # Convenience label helpers
    # ------------------------------------------------------------------


    def get_evidence(self, text: str) -> list:
        """Splits text into sentences and analyzes each to highlight bullish/bearish evidence."""
        if not text:
            return []
        import re
        # Simple sentence splitter
        sentences = re.split(r'(?<=[.!?]) +', text.replace('\\n', ' '))
        evidence = []
        for s in sentences:
            s = s.strip()
            if len(s) < 10:
                continue
            res = self.analyze(s)
            score = res['score']
            lbl = 'neutral'
            if score >= 60:
                lbl = 'bullish'
            elif score <= 40:
                lbl = 'bearish'
            evidence.append({"sentence": s, "type": lbl, "score": score})
        return evidence

    @staticmethod

    def score_to_label(score: int) -> str:
        """Map 0-100 score to Bullish / Neutral / Bearish."""
        if score >= 60:
            return 'Bullish'
        if score <= 40:
            return 'Bearish'
        return 'Neutral'

    @staticmethod
    def score_to_impact(score: int) -> str:
        """Map 0-100 score to HIGH / MEDIUM / LOW impact."""
        if score >= 70:
            return 'HIGH'
        if score >= 50:
            return 'MEDIUM'
        return 'LOW'


# Module-level singleton — import and reuse across the app
sentiment_svc = SentimentService()
