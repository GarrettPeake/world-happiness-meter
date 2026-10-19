# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

World Happiness Meter is a real-time sentiment analysis application that monitors the Bluesky social network firehose, analyzes posts using LLM-based sentiment analysis, and visualizes global emotional trends. The app consists of:

1. **Cloudflare Worker** (backend): Scheduled job that analyzes Bluesky firehose data and stores results in KV storage
2. **React Frontend**: Vite-based SPA that visualizes sentiment data from the worker API
3. **CLI Scripts**: Development tools for testing sentiment analysis and collecting corpus data

## Development Commands

### Frontend & Worker
```bash
npm run dev              # Start Vite dev server (frontend only)
npm run build            # Build both TypeScript and frontend
npm run preview          # Build and preview production build locally
npm run deploy           # Build and deploy to Cloudflare Workers
npm run lint             # Run ESLint
npm run cf-typegen       # Generate Cloudflare Workers types from wrangler.jsonc
```

### Testing & Analysis Scripts
```bash
npm run sentimize        # Run sentiment analysis on live firehose for 1 minute
npm run corpus [count]   # Collect sample posts from firehose (default: 100)
npm run validate <file>  # Test sentiment analysis on a corpus file
```

## Architecture

### Worker Architecture (worker/)

The worker is configured to run as a **scheduled cron job every 10 minutes** (see `wrangler.jsonc`). On each execution:

1. **firehose-client.ts**: Connects to Bluesky Jetstream firehose (`@skyware/jetstream`) and streams live posts for 1 minute
2. **sentiment-analyzer.ts**: Each non-empty post is sent to OpenRouter's Decisions API (`perplexity/pplx-decider-flash-v1.2`) as one terse yes/no (`noul`) question per emotion (happiness, sadness, anger, fear, surprise, disgust); each emotion score is the probability of "true" × 10. Concepts are extracted separately by `deepseek/deepseek-v4.1-flash` in batches of 50 posts
3. **sentiment-meter.ts**: Aggregates sentiment scores, calculates averages, and identifies top 200 concepts from the batch
4. **index.ts**: Stores aggregated data in Cloudflare KV with ISO timestamp as key and full data in metadata

The worker also exposes a `/api/*` endpoint that:
- Fetches historical sentiment data from KV for the past 24 hours
- Uses `generateHourPrefixes()` to efficiently query KV by hour prefixes
- Returns time-series data for the frontend to visualize

### Frontend Architecture (src/)

Standard React + Vite SPA that:
- Fetches sentiment data from the worker's `/api/` endpoint
- Visualizes emotional trends over time
- Currently contains boilerplate React code from the Cloudflare template (needs implementation)

### Scripts Architecture (scripts.ts)

Development utilities that reuse worker code:
- **sentimize**: Live test of the sentiment pipeline - runs for 1 minute and displays results
- **corpus**: Collects sample posts to JSON files for testing
- **validate**: Batch tests sentiment analysis on collected corpus files and prints per-post concepts; an optional extra argument overrides the concept prompt

## Environment Setup

Requires `.env` file with:
```
OPENROUTER_API_KEY=<your-key>
```

The worker expects `OPENROUTER_API_KEY` as a Cloudflare secret (not in wrangler.jsonc).

## Key Data Structures

**SentimentData** (stored in KV):
- timestamp: ISO8601 string
- messageCount: number of posts analyzed
- happinessAvg/sadnessAvg/angerAvg/fearAvg/surpriseAvg/disgustAvg: average scores 0-10 (0-9 for data before the Decider migration)
- topConcepts: object mapping concept names to frequency counts (top 200)

**KV Storage Pattern**:
- Keys are ISO timestamps (e.g., "2025-10-25T14:32:00.000Z")
- Data is stored in metadata field for efficient prefix queries
- Historical queries use hour-based prefixes for performance

## TypeScript Configuration

Three tsconfig files for different compilation targets:
- `tsconfig.app.json`: Frontend React code
- `tsconfig.worker.json`: Cloudflare Worker code
- `tsconfig.node.json`: Build tools and scripts

## Sentiment Analysis

- **Emotions** (`SENTIMENT_QUESTIONS`): Decider returns `answers.<name>.noul`, the probability (0-1) that the question is true. If all six are < 0.5 the post is `{ error: "NO SENTIMENT" }`. Empty (image-only) posts are skipped before any call: the terse questions score empty input ~0.9 on every emotion.
- **Rate limits**: a 429 returns `{ error: RATE_LIMITED }`; `updateMeters` retries those once within the remaining subrequest budget (`SUBREQUEST_BUDGET`).
- **Concepts** (`DEFAULT_CONCEPT_PROMPT`): posts are sent as `<n>:<post>` lines; the model returns strict JSON `{"t":["<n>:<topic>", ...]}`. Keep this schema minimal; it exists to minimize input/output tokens. Requests use `provider.sort: "price"` because provider prices for this model vary by >20x.

## Cloudflare-Specific Notes

- Worker uses `nodejs_compat` compatibility flag for Node.js APIs
- KV namespace binding: `SENTIMENT_DATA` (ID in wrangler.jsonc)
- Cron trigger: `*/10 * * * *` (every 10 minutes)
- Assets config enables SPA routing (all routes serve index.html)
