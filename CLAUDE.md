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
2. **sentiment-analyzer.ts**: Each post is sent to OpenRouter API (using `meta-llama/llama-3.1-8b-instruct`) which returns sentiment scores (happiness, sadness, anger, fear, surprise, disgust) and key concepts
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
- **validate**: Batch tests sentiment analysis on collected corpus files, useful for prompt engineering

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
- happinessAvg/sadnessAvg/angerAvg/fearAvg/surpriseAvg/disgustAvg: average scores 0-9
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

## Sentiment Analysis Prompt

The sentiment analyzer uses a strict prompt format (see `DEFAULT_SYSTEM_PROMPT` in `worker/sentiment-analyzer.ts`). The LLM must return exactly:
```
happiness:7
sadness:1
anger:0
fear:3
surprise:5
disgust:4
concepts:peace,ukraine war
```

Or `NO SENTIMENT` for posts without clear sentiment. This format is critical for parsing - any changes to the prompt must maintain this structure.

## Cloudflare-Specific Notes

- Worker uses `nodejs_compat` compatibility flag for Node.js APIs
- KV namespace binding: `SENTIMENT_DATA` (ID in wrangler.jsonc)
- Cron trigger: `*/10 * * * *` (every 10 minutes)
- Assets config enables SPA routing (all routes serve index.html)
