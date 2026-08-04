// =====================================================================
// 14_queryRouter.js — ROUTE QUERIES TO DATABASE OR LLM
// =====================================================================
//
// Decision Logic:
//   IF query is about movies → Use existing GraphRAG pipeline
//      (Entity Resolution → Classification → Graph/Similarity Handlers)
//
//   IF query is NOT about movies → Use livecalls or Gemini LLM directly
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

async function detectQuery(query) {
  const prompt = `
You are a query router.
Classify the user's query into ONE category and return ONLY valid JSON.
Categories:
1. Movie
Use for anything related to movies, TV shows, actors, directors, characters, genres, plots, awards, reviews, recommendations, or cinema.
Output:
{
  "type": "movie"
}
2. Weather
Use ONLY when the user asks for current or forecast weather.
Extract the city if mentioned.
Output:
{
  "type": "livecall",
  "service": "weather",
  "city": "<city>"
}
If no city is mentioned, return:
{
  "type": "general"
}
3. Crypto
Use ONLY when the user asks for cryptocurrency prices, market cap, trading volume, trends, or information about coins like Bitcoin, Ethereum, Solana, XRP, etc.
Extract the cryptocurrency as the CoinGecko coin ID.
Examples:XRP -> ripple,BNB -> binancecoin,Bitcoin -> bitcoin.
Output:
{
  "type": "livecall",
  "service": "crypto",
  "coin": "<coingecko_id>"
}
If no specific coin is mentioned, return:
{
  "type": "general"
}
4. General
Everything else.
Output:
{
  "type": "general"
}
Rules:
- Return ONLY valid JSON.
- Do not include markdown or explanations.
- Never return anything outside the JSON object.
`;

  try {
    const response = await llm.invoke([
      { role: "system", content: prompt },
      { role: "human", content: query },
    ]);

    const raw = extractTextContent(response.content).trim();
    return JSON.parse(raw);
  } catch (err) {
    console.warn("⚠️ Query classification failed:", err.message);

    return {
      type: "general",
    };
  }
}

// =====================================================================
// STEP 2: HANDLE MOVIE QUERIES (USE DATABASE)
// =====================================================================
// Run the full GraphRAG pipeline for structured movie data
// =====================================================================

async function handleMovieQuery(query) {
  console.log(
    "\n📽️  DETECTED: Movie-related query → Using Database Pipeline\n",
  );

  // ── Step 1: Entity Resolution ──
  console.log("🔍 ENTITY RESOLUTION");
  const resolved = await resolveQueryEntities(query);

  // ── Step 2: Classification ──
  console.log("\n🧠 CLASSIFICATION");
  const classification = await classifyQuery(query, resolved);
  console.log(
    `   Type: ${classification.type} | Reason: ${classification.reasoning}`,
  );

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

async function getWeather(city) {
  const response = await fetch(
    `http://api.weatherapi.com/v1/current.json?key=d6a3bcd7a43c4ed59c2155208252404&q=${city}&aqi=no`,
  );
  console.log(await response.text());
  if (!response.ok) {
    throw new Error("Weather API request failed");
  }

  const data = await response.json();

  return data;
}

async function getCrypto(coin) {
  const response = await fetch(
    `https://api.coingecko.com/api/v3/coins/markets?vs_currency=inr&ids=${coin}`,
  );
  console.log(await response.text());
  if (!response.ok) {
    throw new Error("CoinGecko request failed");
  }

  const data = await response.json();

  if (!data.length) {
    throw new Error("Cryptocurrency not found");
  }

  return data;
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
    const route = await detectQuery(query);
    console.log("📌 Route:", route);

    let answer;

    switch (route.type) {
      case "movie":
        try {
          console.log("🎬 Entering Movie Pipeline");
          answer = await handleMovieQuery(query);
        } catch (err) {
          console.warn("⚠️ Movie pipeline failed:", err.message);
          answer = await handleGeneralQuery(query);
        }
        break;

      case "livecall":
        try {
          console.log(`🌐 Live Call: ${route.service}`);

          switch (route.service) {
            case "weather":
              answer = await getWeather(route.city);
              return `The current weather in ${answer.location.name}, ${answer.location.country} is ${answer.current.temp_c}°C with ${answer.current.condition.text.toLowerCase()}. Humidity is ${answer.current.humidity}% and wind speed is ${answer.current.wind_kph} km/h.`;
              break;

            case "crypto":
              answer = await getCrypto(route.coin);
              return `${answer[0].name} (${answer[0].symbol.toUpperCase()}) is currently trading at ₹${answer[0].current_price.toLocaleString("en-IN")}. Its market capitalization is ₹${answer[0].market_cap.toLocaleString("en-IN")}, with a 24-hour price change of ${answer[0].price_change_percentage_24h.toFixed(2)}%.`;
              break;

            default:
              console.warn("⚠️ Unknown live service:", route.service);
              answer = await handleGeneralQuery(query);
          }
        } catch (err) {
          console.warn("⚠️ Live call failed:", err.message);
          answer = await handleGeneralQuery(query);
        }
        break;

      case "general":
      default:
        console.log("🤖 General LLM");
        answer = await handleGeneralQuery(query);
    }
    return answer;
  } catch (err) {
    console.error("❌ Router Error:", err);
    return await handleGeneralQuery(query);
  }
}

export { routeQuery, handleMovieQuery, handleGeneralQuery };
