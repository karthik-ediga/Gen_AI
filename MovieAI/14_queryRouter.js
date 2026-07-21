// =====================================================================
// 14_queryRouter.js — ROUTE QUERIES TO DATABASE OR LLM
// =====================================================================
//
// Decision Logic:
//   IF query is about movies → Use existing GraphRAG pipeline
//      (Entity Resolution → Classification → Graph/Similarity Handlers)
//
//   IF query is NOT about movies → Use Gemini LLM directly
//      (Fast, handles any topic)
//
// This prevents wasting compute on non-movie queries that won't
// find entities in the movie database.
//
// =====================================================================

import { llm } from "./2_config.js";
import { resolveQueryEntities } from "./9_entityResolver.js";
import { classifyQuery } from "./10_queryClassifier.js";
import { handleGraphQuery } from "./11_graphHandler.js";
import { handleSimilarityQuery } from "./12_similarityHandler.js";
import { extractTextContent } from "./utils/llmUtils.js";

// =====================================================================
// STEP 1: DETECT IF QUERY IS ABOUT MOVIES
// =====================================================================
// Use LLM with lightweight prompt to classify quickly
// Keywords checked: film, movie, actor, director, cinema, genre, plot, etc.
// =====================================================================

async function detectMovieQuery(query) {
  const prompt = `You are a query classifier. Determine if this question is about MOVIES/FILMS/CINEMA.

Answer ONLY "true" or "false" (no explanation).

Movie topics include:
- Actors, directors, producers
- Movie titles, genres, plots
- Studios, cinematography, awards
- Film industry, releases
- Character names, scripts

Non-movie topics:
- History, science, geography
- Math, technology, languages
- Sports, food, travel
- Current events, politics
- General knowledge questions

Question: "${query}"`;

  try {
    const response = await llm.invoke([
      { role: "system", content: "You are a query classifier. Answer only 'true' or 'false'." },
      { role: "human", content: prompt },
    ]);

    const raw = extractTextContent(response.content).trim().toLowerCase();
    return raw.includes("true");
  } catch (err) {
    console.warn("⚠️  Movie detection failed, defaulting to LLM");
    return false; // Default to LLM for non-movie queries if detection fails
  }
}

// =====================================================================
// STEP 2: HANDLE MOVIE QUERIES (USE DATABASE)
// =====================================================================
// Run the full GraphRAG pipeline for structured movie data
// =====================================================================

async function handleMovieQuery(query) {
  console.log("\n📽️  DETECTED: Movie-related query → Using Database Pipeline\n");

  // ── Step 1: Entity Resolution ──
  console.log("🔍 ENTITY RESOLUTION");
  const resolved = await resolveQueryEntities(query);

  // ── Step 2: Classification ──
  console.log("\n🧠 CLASSIFICATION");
  const classification = await classifyQuery(query, resolved);
  console.log(`   Type: ${classification.type} | Reason: ${classification.reasoning}`);

  // ── Step 3: Route to handler ──
  let answer;

  if (classification.type === "similarity") {
    console.log("\n📐 → SIMILARITY handler (Pinecone + Neo4j)...");
    answer = await handleSimilarityQuery(query, resolved);
  } else {
    console.log("\n🗄️  → GRAPH handler (Neo4j)...");
    answer = await handleGraphQuery(query, resolved);
  }

  return answer;
}

// =====================================================================
// STEP 3: HANDLE GENERAL QUERIES (USE LLM DIRECTLY)
// =====================================================================
// Query Gemini directly for non-movie topics
// Fast, no database lookup needed
// =====================================================================

async function handleGeneralQuery(query) {
  console.log("\n🤖 DETECTED: General query → Using LLM (Gemini)\n");

  const response = await llm.invoke([
    {
      role: "system",
      content:
        "You are a knowledgeable and helpful assistant. Answer questions accurately and clearly.",
    },
    { role: "human", content: query },
  ]);

  return extractTextContent(response.content);
}

// =====================================================================
// MAIN ROUTER FUNCTION
// =====================================================================
// Entry point: determines movie vs general and routes appropriately
// =====================================================================

async function routeQuery(query) {
  console.log("\n═══════════════════════════════════════════");
  console.log("🔀 QUERY ROUTER");

  try {
    // Detect if movie query
    const isMovieQuery = await detectMovieQuery(query);

    // Route to appropriate handler
    let answer;
    if (isMovieQuery) {
      answer = await handleMovieQuery(query);
    } else {
      answer = await handleGeneralQuery(query);
    }

    console.log("\n═══════════════════════════════════════════");
    console.log("💬 Answer:\n");
    console.log(answer);
    console.log("\n═══════════════════════════════════════════");

    return answer;
  } catch (err) {
    console.error("\n❌ Router error:", err.message);
    throw err;
  }
}

export { routeQuery, detectMovieQuery, handleMovieQuery, handleGeneralQuery };
