#!/bin/bash
set -e

# Setup git
git init
git config user.name "Rajat Murhe" || true
git config user.email "rajatmurhe@example.com" || true

# 1
git add app.py
git commit -m "feat: setup initial flask backend structure"

# 2
git add services/__init__.py
git commit -m "chore: add services package initialization"

# 3
git add services/sentiment_service.py
git commit -m "feat: implement VADER sentiment analysis module"

# 4
git add services/news_service.py
git commit -m "feat: implement Google News RSS parser with topic classification"

# 5
git add services/stock_service.py
git commit -m "feat: integrate yfinance for live stock market data"

# 6
git add services/signals_service.py
git commit -m "feat: develop AI signal generation algorithm for predictive modeling"

# 7
git add requirements_new.txt
git commit -m "chore: add project dependencies"

# 8
git add static/style.css
git commit -m "ui: add base UI styling, dark theme, and css variables"

# 9
git add static/index.html
git commit -m "ui: create main dashboard HTML layout"

# 10
git add static/app.js
git commit -m "feat: implement core frontend logic for market data fetching"

# 11
git add static/bot-icon.png
git commit -m "ui: add custom 3D avatar for autonomous copilot"

# 12
echo "# Market-Signal Dashboard" > README.md
git add README.md
git commit -m "docs: initialize README"

# 13
echo "" >> README.md
echo "An AI-driven stock market prediction terminal that synthesizes live market data, news sentiment, and autonomous chat." >> README.md
git add README.md
git commit -m "docs: add project description to README"

# 14
echo "" >> README.md
echo "## Features" >> README.md
git add README.md
git commit -m "docs: add features section"

# 15
echo "- **Live Stock Prices:** Real-time data from Yahoo Finance." >> README.md
git add README.md
git commit -m "docs: add live stock prices feature"

# 16
echo "- **AI News Sentiment:** Analyzes Google News RSS feeds using VADER to generate bullish/bearish indicators." >> README.md
git add README.md
git commit -m "docs: add sentiment analysis feature"

# 17
echo "- **Market-Signal Copilot:** Autonomous chatbot for natural language stock queries." >> README.md
git add README.md
git commit -m "docs: add chatbot feature to docs"

# 18
echo "- **Prediction Market Engine:** Calculates Fair Value odds based on AI signal confidence." >> README.md
git add README.md
git commit -m "docs: add prediction market engine feature"

# 19
echo "" >> README.md
echo "## Installation" >> README.md
echo "\`\`\`bash" >> README.md
echo "pip install -r requirements_new.txt" >> README.md
echo "python3 app.py" >> README.md
echo "\`\`\`" >> README.md
git add README.md
git commit -m "docs: add installation instructions"

# 20
# Clean up junk
rm -f patch_*.py rename.py test_*.py
git add .
git commit -m "chore: final polish and cleanup"

echo "COMMITS CREATED!"
