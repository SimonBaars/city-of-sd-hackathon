# OpenSD

**San Diego's open data, explored by AI.**

An AI-powered civic data explorer that lets anyone query, visualize, and cross-reference 270+ City of San Diego datasets through natural conversation. Ask a question in plain English and get answers with charts, maps, and data tables — all backed by real city data.

**Live at [opensd.app](https://opensd.app)**

---

## Team

- **Nathan** — vibes
- **Simon** — more vibes
- **Ari** — domain knowledge and more vibes
- **Amin** — superior vibes

---

## Problem Statement

San Diego publishes hundreds of open datasets — council votes, 311 complaints, budgets, permits, police calls, street conditions, and more — but they're scattered across CSVs, GeoJSON files, and disconnected portals. A resident who wants to know "which council district has the worst potholes?" would need to download files, write SQL, and cross-reference multiple sources. Nobody does that.

OpenSD makes all of this data instantly queryable through conversation.

---

## What It Does

- **Natural language queries** over 270+ tables loaded from the City of San Diego Open Data Portal
- **Council voting analysis** — 1,216 vote items across 72 meetings (Jan 2025 – Mar 2026), with per-member attendance, agreement matrices, and split-vote analysis
- **Inline visualizations** — bar charts, line charts, pie charts, and data tables rendered directly in the chat
- **Interactive maps** — point maps with color/size coding, and district choropleths for per-district comparisons
- **Spatial queries** — 57K geocoded road segments and 104 geocoded schools for proximity analysis (e.g., "how many miles of street are within 200 feet of schools?")
- **Cross-dataset joins** — the AI decides which datasets to combine based on shared keys like `council_district`, `community`, `iamfloc`, `beat`, and coordinates
- **Mobile-friendly** — responsive layout with full-width chat on mobile, maps appear only when relevant

---

## Data Sources

| Source | What | Records |
|--------|------|---------|
| [data.sandiego.gov](https://data.sandiego.gov/datasets/) | 109 datasets: Get It Done 311, permits, budgets, police, fire, parking, code enforcement, businesses, water quality, and more | ~15M rows across 270 tables |
| [roads_datasd.geojson](https://data.sandiego.gov/) | Street centerline network with coordinates | 57,479 segments, 4,340 miles |
| [addrapn_datasd.geojson](https://data.sandiego.gov/) | Address points with lat/lng | 460,513 points |
| Council voting records | Scraped from [sandiego.hylandcloud.com](https://sandiego.hylandcloud.com/211agendaonlinecouncil) | 1,216 items, 72 meetings, 9 members |
| Council district boundaries | GeoJSON boundary files | 9 districts |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Frontend (React + Vite + Tailwind)             │
│  ├─ Chat interface with streaming responses     │
│  ├─ Recharts (bar, line, pie)                   │
│  ├─ Leaflet maps (points, choropleths)          │
│  └─ Responsive: mobile-first layout             │
├─────────────────────────────────────────────────┤
│  Backend (FastAPI + uvicorn)                    │
│  ├─ /api/chat — SSE streaming endpoint          │
│  ├─ /api/datasets — table catalog               │
│  └─ /api/boundaries/:name — GeoJSON files       │
├─────────────────────────────────────────────────┤
│  AI Agent (Claude claude-sonnet-4-20250514 + tool use)      │
│  ├─ query_data — execute SQL against DuckDB     │
│  ├─ list_tables / describe_table — schema tools │
│  └─ create_visualization — charts, maps, tables │
├─────────────────────────────────────────────────┤
│  DuckDB (1.8 GB, in-process, read-only)         │
│  └─ 270+ tables from CSV/GeoJSON ingestion      │
└─────────────────────────────────────────────────┘
```

**Key design decisions:**
- **DuckDB** for in-process analytical queries — no database server, millisecond SQL over multi-GB datasets
- **Claude tool use** — the agent decides which tables to query, what SQL to write, and when to visualize
- **Server-Sent Events** for streaming — real-time status updates as the agent thinks and queries
- **No pre-classification** — the AI reads raw data and categorizes on the fly, avoiding expensive preprocessing

---

## Running Locally

### Prerequisites
- Python 3.11+
- Node.js 18+
- `ANTHROPIC_API_KEY` environment variable set

### Data Download & Ingestion

```bash
# Download datasets (~10 GB)
python download_datasets.py --csv-only

# Load into DuckDB
cd backend
python -m venv ../.venv && source ../.venv/bin/activate
pip install -r requirements.txt
python ingest.py --force
```

### Start Backend

```bash
source .venv/bin/activate
cd backend
uvicorn server:app --host 0.0.0.0 --port 8000
```

### Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

---

## Deployment

The app is deployed on a Linode (Ubuntu 24.04) at [opensd.app](https://opensd.app):

- **nginx** reverse proxy with Let's Encrypt SSL
- **systemd** service for the backend (`opensd.service`)
- **Vite production build** served as static files
- API key stored in `/opt/opensd/.env` with restricted permissions

---

## Links

- **Live app**: [https://opensd.app](https://opensd.app)
- **Repository**: [github.com/SimonBaars/opensd](https://github.com/SimonBaars/opensd)
