// =====================================================================
// 14_queryRouter.js — ROUTE QUERIES TO DATABASE OR LLM
// =====================================================================
//
// Decision Logic:
//   IF query is about movies → Use existing GraphRAG pipeline
//      (Entity Resolution → Classification → Graph/Similarity Handlers)
//   IF query is about weather/Crypto → MCP server (get_weather / get_crypto tools)
//   IF query is NOT about movies/API → Use Gemini LLM directly
//      (Fast, handles any topic)
//
// This prevents wasting compute on non-movie queries that won't
// find entities in the movie database.
//
// =====================================================================

import path from "path";
import { fileURLToPath } from "url";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

import { llm } from "./2_config.js";
import { resolveQueryEntities } from "./9_entityResolver.js";
import { classifyQuery } from "./10_queryClassifier.js";
import { handleGraphQuery } from "./11_graphHandler.js";
import { handleSimilarityQuery } from "./12_similarityHandler.js";
import { extractTextContent } from "./utils/llmUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_PATH = path.join(__dirname, "mcp_api_server.js");

// =====================================================================
// MCP CLIENT (WEATHER + CRYPTO)
// Uses @langchain/mcp-adapters MultiServerMCPClient (stateless sessions
// by default). Tools are loaded once, then invoked as LangChain tools.
// See: https://github.com/langchain-ai/langchainjs/tree/main/libs/langchain-mcp-adapters
// =====================================================================

let mcpClient = null;
let mcpTools = null;
let mcpConnecting = null;
const MCP_CALL_TIMEOUT_MS = 15_000;

async function connectMcpClient() {
  const client = new MultiServerMCPClient({
    throwOnLoadError: true,
    prefixToolNameWithServerName: false,
    useStandardContentBlocks: true,
    defaultToolTimeout: MCP_CALL_TIMEOUT_MS,
    onConnectionError: "throw",
    mcpServers: {
      apiserver: {
        transport: "stdio",
        command: "node",
        args: [MCP_SERVER_PATH],
        // Stdio MCP children only inherit a small env whitelist by default
        // (PATH, USERPROFILE, …) — custom keys like COINGECKO_KEY must be passed.
        env: {
          COINGECKO_KEY: process.env.COINGECKO_KEY ?? "",
        },
        restart: {
          enabled: true,
          maxAttempts: 3,
          delayMs: 1000,
        },
      },
    },
  });

  const tools = await client.getTools();
  return { client, tools };
}

async function getMcpTools() {
  if (mcpTools) return mcpTools;

  if (!mcpConnecting) {
    mcpConnecting = connectMcpClient()
      .then(({ client, tools }) => {
        mcpClient = client;
        mcpTools = tools;
        return tools;
      })
      .finally(() => {
        mcpConnecting = null;
      });
  }

  return mcpConnecting;
}

async function closeMcpClient() {
  if (mcpClient) {
    try {
      await mcpClient.close();
    } catch (err) {
      console.warn("⚠️ Error closing MCP client:", err.message);
    } finally {
      mcpClient = null;
      mcpTools = null;
    }
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await closeMcpClient();
    process.exit(0);
  });
}

function extractToolOutput(result) {
  if (result == null) return null;
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    const text = result
      .map((block) => {
        if (typeof block === "string") return block;
        if (block?.text) return block.text;
        if (block?.type === "text" && typeof block?.text === "string") return block.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
    return text || JSON.stringify(result);
  }
  if (typeof result === "object" && result.text) return result.text;
  return String(result);
}

async function callMcpTool(name, args) {
  const tools = await getMcpTools();
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`MCP tool "${name}" not found. Available: ${tools.map((t) => t.name).join(", ") || "(none)"}`);
  }

  try {
    return extractToolOutput(await tool.invoke(args));
  } catch (err) {
    // Tool execution errors (e.g. CoinGecko 401) are not a dead session — don't reconnect.
    const msg = err?.message || String(err);
    if (/returned an error|HTTP error|401|403|404/i.test(msg)) {
      throw err;
    }

    // Drop cached client/tools so the next call reconnects (stdio child may have died).
    mcpTools = null;
    try {
      await mcpClient?.close();
    } catch {
      // ignore close errors during reconnect
    }
    mcpClient = null;

    console.warn(`⚠️ MCP call "${name}" failed (${err.message}), retrying once...`);
    const freshTools = await getMcpTools();
    const freshTool = freshTools.find((t) => t.name === name);
    if (!freshTool) {
      throw new Error(`MCP tool "${name}" not found after reconnect`);
    }
    return extractToolOutput(await freshTool.invoke(args));
  }
}

async function getWeather(city) {
  if (!city || !city.trim()) {
    throw new Error("City name not provided for weather lookup");
  }
  try {
    return await callMcpTool("get_weather", { city });
  } catch (error) {
    console.error("Error fetching weather via MCP:", error.message);
    return { error: error.message };
  }
}

async function getCrypto(coin) {
  if (!coin || !coin.trim()) {
    throw new Error("Coin identifier not provided for crypto lookup");
  }
  try {
    return await callMcpTool("get_crypto", { coin });
  } catch (error) {
    console.warn("⚠️ Crypto MCP call failed:", error.message);
    return null;
  }
}

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
          console.log(`🌐 Live Call (MCP): ${route.service}`);

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

export { routeQuery, handleMovieQuery, handleGeneralQuery, closeMcpClient };
