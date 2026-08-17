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

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};

async function getWeather(city) {
  const encodedCity = encodeURIComponent(city);

  try {
    // =========================
    // 1. WeatherAPI
    // =========================
    const res = await fetch(
      `https://api.weatherapi.com/v1/current.json?key=${process.env.WEATHER_API_KEY}&q=${encodedCity}&aqi=no`,
      { headers: FETCH_HEADERS }
    );

    if (res.ok) {
      const data = await res.json();

      return `The current weather in ${data.location.name}, ${data.location.country} is ${data.current.temp_c}°C with ${data.current.condition.text.toLowerCase()}. Humidity is ${data.current.humidity}% and wind speed is ${data.current.wind_kph} km/h.`;
    }

    console.warn(
      `⚠️ WeatherAPI returned ${res.status}, trying Open-Meteo fallback...`
    );

  } catch (e) {
    console.warn(
      "⚠️ WeatherAPI failed, trying Open-Meteo fallback:",
      e.message
    );
  }

  // =========================
  // 2. Open-Meteo Fallback
  // =========================
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodedCity}&count=1&language=en&format=json`,
      { headers: FETCH_HEADERS }
    );

    if (!geoRes.ok) {
      throw new Error(`Geocoding API returned ${geoRes.status}`);
    }

    const geoData = await geoRes.json();

    if (geoData.results && geoData.results.length > 0) {
      const { latitude, longitude, name, country } = geoData.results[0];

      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`,
        { headers: FETCH_HEADERS }
      );

      if (!weatherRes.ok) {
        throw new Error(`Open-Meteo returned ${weatherRes.status}`);
      }

      const weatherData = await weatherRes.json();

      if (weatherData.current) {
        return `The current weather in ${name}, ${country} is ${weatherData.current.temperature_2m}°C. Humidity is ${weatherData.current.relative_humidity_2m}% and wind speed is ${weatherData.current.wind_speed_10m} km/h.`;
      }
    }

  } catch (e) {
    console.warn("⚠️ Open-Meteo fallback failed:", e.message);
  }

  // =========================
  // 3. Both APIs failed
  // =========================
  throw new Error("Unable to fetch weather data from any live source");
}

async function getCrypto(coin) {
  if (!coin || !coin.trim()) {
    throw new Error("Coin identifier not provided for crypto lookup");
  }

  const encodedCoin = encodeURIComponent(coin.trim().toLowerCase());

  // ==========================================
  // 1. Primary: CoinGecko
  // ==========================================
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=inr&ids=${encodedCoin}`,
      { headers: FETCH_HEADERS }
    );

    if (res.ok) {
      const data = await res.json();

      if (Array.isArray(data) && data.length > 0) {
        const c = data[0];

        const price = c.current_price != null
          ? `₹${c.current_price.toLocaleString("en-IN")}`
          : "N/A";

        const marketCap = c.market_cap != null
          ? `₹${c.market_cap.toLocaleString("en-IN")}`
          : "N/A";

        const change24h = c.price_change_percentage_24h != null
          ? c.price_change_percentage_24h.toFixed(2)
          : "0.00";

        return `${c.name} (${c.symbol.toUpperCase()}) is currently trading at ${price}. Market Cap: ${marketCap}, 24h Change: ${change24h}%.`;
      }
    } else {
      console.warn(
        `⚠️ CoinGecko returned ${res.status}, trying CoinCap fallback...`
      );
    }
  } catch (e) {
    console.warn(
      "⚠️ CoinGecko primary failed, trying CoinCap fallback:",
      e.message
    );
  }

  // ==========================================
  // 2. Secondary: CoinCap
  // ==========================================
  try {
    const res = await fetch(
      `https://api.coincap.io/v2/assets/${encodedCoin}`,
      { headers: FETCH_HEADERS }
    );

    if (res.ok) {
      const { data } = await res.json();

      if (data) {
        const priceUsd = parseFloat(data.priceUsd);
        const change24h = parseFloat(data.changePercent24Hr);

        if (!Number.isNaN(priceUsd)) {
          // Approximate USD → INR conversion
          const priceInr = priceUsd * 86.5;

          return `${data.name} (${data.symbol.toUpperCase()}) is trading at approximately ₹${priceInr.toLocaleString(
            "en-IN",
            { maximumFractionDigits: 2 }
          )} ($${priceUsd.toFixed(2)} USD). 24h Change: ${
            Number.isNaN(change24h) ? "0.00" : change24h.toFixed(2)
          }%.`;
        }
      }
    } else {
      console.warn(`⚠️ CoinCap returned ${res.status}`);
    }
  } catch (e) {
    console.warn("⚠️ CoinCap fallback failed:", e.message);
  }

  // ==========================================
  // 3. Both APIs failed
  // ==========================================
  throw new Error(
    "Cryptocurrency data unreachable from live sources"
  );
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
          try {
            answer = await handleGeneralQuery(query);
          } catch (fallbackErr) {
            answer = `Movie pipeline unavailable (${err.message || 'Service error'}). Please try again.`;
          }
        }
        break;

      case "livecall":
        try {
          console.log(`🌐 Live Call: ${route.service}`);

          switch (route.service) {
            case "weather":
              answer = await getWeather(route.city);
              return answer;

            case "crypto":
              answer = await getCrypto(route.coin);
              return answer;

            default:
              console.warn("⚠️ Unknown live service:", route.service);
              try {
                answer = await handleGeneralQuery(query);
              } catch (fallbackErr) {
                answer = "Service unavailable for this query.";
              }
          }
        } catch (err) {
          console.warn("⚠️ Live call failed:", err.message);
          try {
            answer = await handleGeneralQuery(query);
          } catch (fallbackErr) {
            answer = `Unable to fetch live data (${err.message || 'API error'}).`;
          }
        }
        break;

      case "general":
      default:
        console.log("🤖 General LLM");
        try {
          answer = await handleGeneralQuery(query);
        } catch (err) {
          answer = "The assistant is temporarily unavailable. Please try again in a few moments.";
        }
    }
    return answer;
  } catch (err) {
    console.error("❌ Router Error:", err);
    try {
      return await handleGeneralQuery(query);
    } catch (fallbackErr) {
      return "Service is temporarily busy. Please try again shortly.";
    }
  }
}

export { routeQuery, handleMovieQuery, handleGeneralQuery };
