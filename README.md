# 🎬 MovieAI — Atlas AI

A **GraphRAG** (Graph + Retrieval-Augmented Generation) movie assistant. It combines a **Neo4j** knowledge graph, **Pinecone** vector search, and **Google Gemini** to answer questions about movies, directors, actors, genres, and how they relate to each other — with a chat web UI ("Atlas AI") and live tools for weather, crypto, and news via **MCP** (Model Context Protocol).

## ✨ Features

- **Movie knowledge graph Q&A** — factual, descriptive, and relationship questions answered by traversing a Neo4j graph of movies, directors, actors, genres, themes, and awards
- **Semantic "similar movies" recommendations** — Pinecone vector search + genre/theme cross-checking in Neo4j for taste-based recommendations
- **Entity resolution** — before answering, free-text mentions ("DiCaprio", "Nolan") are resolved against the graph's actual node types, so the query planner never has to guess
- **Safe, read-only Cypher** — the LLM never writes raw Cypher. It outputs a structured JSON plan, which is validated against a whitelist and compiled into Cypher — no `DELETE`/`SET`/`CREATE` can ever reach the database
- **Smart query routing** — a lightweight classifier decides whether a query is about movies (→ GraphRAG pipeline), a live-data request (→ MCP tools), or general knowledge (→ Gemini directly), so non-movie questions don't waste a graph lookup
- **Live data tools (via MCP)**:
  - 🌤️ **Weather** — current conditions for any city (Open-Meteo, with a wttr.in fallback)
  - 💰 **Crypto** — live price, market cap, and 24h change for any CoinGecko coin ID
  - 📰 **News** — aggregates headlines from multiple RSS sources for any topic, deduplicates, sorts by recency, and has Gemini write a short summary
- **Graceful degradation** — if the graph pipeline or a live tool fails, the router automatically falls back to a direct LLM answer instead of erroring out
- **Web chat UI + HTTP API** — a dependency-free Node `http` server serves the frontend and a `POST /api/query` endpoint

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ES Modules) |
| LLM | Google Gemini (`gemini-2.5-flash`) via `@google/genai` and `@langchain/google-genai` |
| Embeddings | Gemini `gemini-embedding-001` (3072-dim) via `@google/genai` |
| Graph database | Neo4j (Aura or self-hosted, via `neo4j-driver`) |
| Vector database | Pinecone (`@pinecone-database/pinecone`) |
| Tool protocol | Model Context Protocol — `@modelcontextprotocol/sdk`, `@langchain/mcp-adapters` |
| PDF parsing | `pdf-parse` |
| RSS parsing | `rss-parser` |
| Validation | `zod` (MCP tool schemas) |
| Web server | Node's built-in `http` module (no framework) |
| Frontend | Static HTML/CSS/JS ("Atlas AI") |

## 📁 Project Structure

```
MovieAI/
├── server.js                 # HTTP server — serves the UI and POST /api/query
├── mcp_api_server.js         # MCP server (stdio) — weather / crypto / news tools
├── 2_config.js                # All connections in one place: Neo4j, Pinecone, Gemini LLM, embeddings
├── 1_testConnection.js        # Verifies Neo4j / Pinecone / Gemini connectivity — run this first
│
│   ── Indexing pipeline ──
├── 3_pdfParser.js             # PDF → raw per-movie text blocks
├── 4_entityExtractor.js       # PDF → Gemini file upload → structured movie JSON (batched, with retry)
├── 5_graphBuilder.js          # Structured JSON → Neo4j nodes/relationships (MERGE, no duplicates)
├── 6_vectorStore.js           # PDF text → chunks → Gemini embeddings → Pinecone upsert
├── 7_runIndexing.js           # Orchestrates the full indexing pipeline (steps 3–6)
│
│   ── Query pipeline ──
├── 8_cypherTemplates.js       # Whitelisted, safe Cypher builder (read-only)
├── 9_entityResolver.js        # Extracts + resolves entities against Neo4j node types
├── 10_queryClassifier.js      # Classifies a movie query as "graph" or "similarity"
├── 11_graphHandler.js         # Builds a query plan and executes graph traversal / describe / path queries
├── 12_similarityHandler.js    # Pinecone similarity search + Neo4j genre/theme cross-check
├── 13_runQuery.js             # Interactive CLI for querying the assistant
├── 14_queryRouter.js          # Top-level router: movie vs. live-data (MCP) vs. general LLM
│
├── utils/
│   └── llmUtils.js            # Shared helpers: extractTextContent, normalizeRecords
├── public/                    # Static frontend ("Atlas AI" chat UI)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── data/
│   └── movies.pdf             # Source data for indexing
├── package.json
└── package-lock.json
```

## 🧠 How It Works

### Indexing (`npm run index`)
1. **`3_pdfParser.js`** parses `data/movies.pdf` into individual movie text blocks.
2. **`4_entityExtractor.js`** uploads the PDF to Gemini's Files API and extracts structured entities (title, cast, director, genre, themes, awards, etc.) in batches of 50, with automatic retries on rate limits or transient errors.
3. **`5_graphBuilder.js`** writes the extracted entities into Neo4j as nodes and relationships, using `MERGE` so re-running indexing never creates duplicates.
4. **`6_vectorStore.js`** chunks the PDF text, embeds each chunk with Gemini (`gemini-embedding-001`), and upserts the vectors into Pinecone for similarity search.

### Querying (`npm run query` or the web UI)
1. **`14_queryRouter.js`** first classifies the query into one of three routes:
   - **movie** → the full GraphRAG pipeline below
   - **livecall** → weather / crypto / news via the MCP server
   - **general** → answered directly by Gemini
2. For movie queries: **`9_entityResolver.js`** extracts entity names and resolves each one against all 6 node types in Neo4j (exact match first, then fuzzy `CONTAINS` matching).
3. **`10_queryClassifier.js`** classifies the (now entity-aware) query as `graph` (factual/descriptive/relationship/count) or `similarity` (recommendations).
4. **`graph`** queries go to **`11_graphHandler.js`**, which has the LLM produce a structured JSON plan, compiles it into safe Cypher via **`8_cypherTemplates.js`**, and runs it read-only against Neo4j.
5. **`similarity`** queries go to **`12_similarityHandler.js`**, which embeds the query, searches Pinecone for candidate movies, and cross-references genres/themes in Neo4j to refine recommendations.
6. Gemini composes the final natural-language answer from the raw results — the LLM never sees or writes raw Cypher, and the user never sees database internals.

### Graph schema

```
Nodes:          Movie(title, year), Director(name), Actor(name),
                Genre(name), Theme(name), Award(name, category)

Relationships:  Director -[:DIRECTED]-> Movie
                Actor    -[:ACTED_IN]-> Movie
                Movie    -[:BELONGS_TO]-> Genre
                Movie    -[:EXPLORES]-> Theme
                Movie    -[:WON]-> Award
```

## ⚙️ Setup

### Prerequisites

- Node.js
- A [Google Gemini API key](https://ai.google.dev/)
- A [Neo4j](https://neo4j.com/) instance (e.g. Neo4j Aura)
- A [Pinecone](https://www.pinecone.io/) index
- A [CoinGecko](https://www.coingecko.com/en/api) API key (only required for the crypto tool)

### Install

```bash
cd MovieAI
npm install
```

### Configure environment variables

Create a `.env` file in `MovieAI/`:

```env
GEMINI_API_KEY=your_gemini_api_key
NEO4J_URI=your_neo4j_connection_uri
NEO4J_USERNAME=your_neo4j_username
NEO4J_PASSWORD=your_neo4j_password
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=your_pinecone_index_name
COINGECKO_KEY=your_coingecko_api_key
PORT=3000
```

> `COINGECKO_KEY` is only needed if you want the crypto live-data tool to work — everything else runs without it. Weather has no key requirement (Open-Meteo, with a wttr.in fallback).

### Verify connections

```bash
npm test
```
Runs `1_testConnection.js` to confirm Neo4j, Pinecone, and Gemini are all reachable.

### Build the knowledge graph + vector index

```bash
npm run index
```
Runs the full indexing pipeline (steps 3–6 above) against `data/movies.pdf`. Only needs to be run once, or whenever the source data changes.

### Query it

**Interactively via CLI:**
```bash
npm run query
```

**Via the web app:**
```bash
npm start
```
Then open **http://localhost:3000** (or your configured `PORT`) for the Atlas AI chat UI, or call the API directly:

```bash
curl -X POST http://localhost:3000/api/query \
  -H "Content-Type: application/json" \
  -d '{"message": "Movies directed by Christopher Nolan"}'
```

## 🗺️ API

| Method | Route | Description |
|---|---|---|
| GET | `/` | Serves the Atlas AI chat UI |
| GET | `/<static-file>` | Serves static frontend assets from `public/` |
| POST | `/api/query` | Body: `{"message": "<user question>"}` → Returns `{"reply": "<answer>"}` |

## 💬 Example Queries

- `Movies directed by Christopher Nolan`
- `Tell me about Inception`
- `How is Leonardo DiCaprio related to Christopher Nolan?`
- `Action movies with Tom Hardy`
- `How many sci-fi movies are there?`
- `Movies like Inception`
- `What's the weather in London?`
- `Bitcoin price`
- `Latest news on AI regulation`

## 📌 Notes

- The MCP server (`mcp_api_server.js`) is spawned automatically by the query router over stdio — you don't need to run it separately.
- `.env` and `node_modules` are already git-ignored.
- There is an earlier, CLI-only version of this pipeline in the sibling `Movie Recommendaions/` folder in this repo; `MovieAI` is the actively developed, more complete version (web server, MCP tools, query router) and is the recommended entry point.
- This README was generated from a direct inspection of the source code, since the project did not previously include one.
