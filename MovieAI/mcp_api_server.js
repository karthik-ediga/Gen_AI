// =====================================================================
// mcp_api_server.js — MCP SERVER: WEATHER + CRYPTO TOOLS (Node/JS)
// =====================================================================
// Run standalone:  node mcp_api_server.js
// Talks over stdio (JS equivalent of FastMCP transport="stdio").
// The query router loads these tools via @langchain/mcp-adapters
// MultiServerMCPClient — same pattern as langchain-mcp-adapters.
//
// npm install @modelcontextprotocol/sdk zod @langchain/mcp-adapters
// =====================================================================

import dotenv from "dotenv";
import Parser from "rss-parser";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

dotenv.config();

const rssParser = new Parser({ timeout: 10_000 });

const server = new McpServer({
  name: "APIServer",
  version: "1.0.0",
});

// ---------------------------------------------------------------------
// WEATHER TOOL
// ---------------------------------------------------------------------
server.tool(
  "get_weather",
  "Get current weather for a given city name",
  {
    city: z.string().describe("City name, e.g. 'London'"),
  },
  async ({ city }) => {
    try {
      if (!city || !city.trim()) {
        throw new Error("City name not provided for weather lookup");
      }

      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
      );
      if (!geoRes.ok) {
        throw new Error(`Geocoding request failed with status ${geoRes.status}`);
      }
      const geoData = await geoRes.json();
      if (!geoData.results || geoData.results.length === 0) {
        throw new Error(`City "${city}" not found`);
      }

      const { latitude, longitude, name } = geoData.results[0];

      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m`
      );
      if (!weatherRes.ok) {
        throw new Error(`Weather request failed with status ${weatherRes.status}`);
      }
      const weatherData = await weatherRes.json();

      if (!weatherData.current) {
        throw new Error("Weather data missing from response");
      }

      const { temperature_2m: temp, relative_humidity_2m: humidity, wind_speed_10m: wind } =
        weatherData.current;

      const text = `The current weather in ${name} is ${temp}°C. Humidity is ${humidity}% and wind speed is ${wind} km/h.`;

      return { content: [{ type: "text", text }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error fetching weather: ${error.message}` }],
      };
    }
  }
);

// ---------------------------------------------------------------------
// CRYPTO TOOL
// ---------------------------------------------------------------------
server.tool(
  "get_crypto",
  "Get current price/market data for a coin using its CoinGecko id (e.g. 'bitcoin', 'ripple')",
  {
    coin: z.string().describe("CoinGecko coin id, e.g. 'bitcoin'"),
  },
  async ({ coin }) => {
    try {
      if (!coin || !coin.trim()) {
        throw new Error("Coin identifier not provided for crypto lookup");
      }

      const encodedCoin = encodeURIComponent(coin.trim().toLowerCase());
      const apiKey = process.env.COINGECKO_KEY?.trim();
      if (!apiKey) {
        throw new Error("COINGECKO_KEY is not set in the MCP server environment");
      }

      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=inr&ids=${encodedCoin}`,
        { headers: { "x-cg-demo-api-key": apiKey } }
      );
      if (!res.ok) {
        throw new Error(`HTTP error! Status: ${res.status}`);
      }

      const data = await res.json();

      if (!Array.isArray(data) || data.length === 0) {
        return {
          content: [{ type: "text", text: `Coin '${coin}' not found.` }],
        };
      }

      const c = data[0];
      const price = c.current_price != null ? `₹${c.current_price.toLocaleString("en-IN")}` : "N/A";
      const marketCap = c.market_cap != null ? `₹${c.market_cap.toLocaleString("en-IN")}` : "N/A";
      const change24h =
        c.price_change_percentage_24h != null ? c.price_change_percentage_24h.toFixed(2) : "0.00";

      const text = `${c.name} (${c.symbol.toUpperCase()}) is currently trading at ${price}. Market Cap: ${marketCap}, 24h Change: ${change24h}%.`;

      return { content: [{ type: "text", text }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error fetching crypto: ${error.message}` }],
      };
    }
  }
);

// ---------------------------------------------------------------------
// NEWS TOOL — "RSS Feed Manager"
// Aggregates multiple RSS sources for ANY topic (not just crypto),
// dedupes overlapping stories, and sorts by most recent.
// The actual "concise summary" step happens LLM-side in the router,
// per: sources -> rss-parser -> dedupe -> sort -> LLM -> summary
// ---------------------------------------------------------------------

const NEWS_SOURCES = [
  {
    name: "Google News",
    buildUrl: (topic) =>
      `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`,
  },
  {
    name: "Bing News",
    buildUrl: (topic) =>
      `https://www.bing.com/news/search?q=${encodeURIComponent(topic)}&format=RSS`,
  },
  {
    name: "Yahoo News",
    buildUrl: (topic) =>
      `https://news.search.yahoo.com/rss?p=${encodeURIComponent(topic)}`,
  },
];

function normalizeTitle(title = "") {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "");
}

// Some unofficial RSS feeds (Bing/Yahoo News search results in particular) ship
// malformed XML with bare, un-escaped "&" characters (e.g. "Cricket & Politics"),
// which makes the XML parser throw "Invalid character in entity name". Fetch the
// raw text ourselves and escape any "&" that isn't already part of a valid entity
// before handing it to rss-parser, instead of relying on parseURL directly.
async function fetchAndSanitizeFeed(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsFeedBot/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`Feed request failed with status ${res.status}`);
  }
  const rawXml = await res.text();
  const sanitizedXml = rawXml.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;");
  return rssParser.parseString(sanitizedXml);
}

server.tool(
  "get_news",
  "Get the latest news headlines for ANY topic (not limited to crypto) by aggregating multiple RSS sources, removing duplicate stories, and sorting by most recent",
  {
    topic: z
      .string()
      .describe("News topic/subject to search for, e.g. 'crypto', 'AI regulation', 'cricket', 'elections'"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Max number of headlines to return (default 10)"),
  },
  async ({ topic, limit }) => {
    try {
      if (!topic || !topic.trim()) {
        throw new Error("News topic not provided");
      }
      const maxItems = limit && limit > 0 ? Math.min(limit, 20) : 10;

      // Fan out to all RSS sources in parallel; tolerate individual failures
      const results = await Promise.allSettled(
        NEWS_SOURCES.map(async (source) => {
          const feed = await fetchAndSanitizeFeed(source.buildUrl(topic));
          return (feed.items || []).map((item) => ({
            title: item.title?.trim() || "(untitled)",
            link: item.link,
            source: source.name,
            pubDate: item.pubDate ? new Date(item.pubDate) : null,
          }));
        })
      );

      let allItems = [];
      results.forEach((r, i) => {
        const sourceName = NEWS_SOURCES[i].name;
        if (r.status === "fulfilled") {
          allItems = allItems.concat(r.value);
        } else {
          console.warn(`⚠️ News source "${sourceName}" failed: ${r.reason?.message || r.reason}`);
        }
      });

      if (allItems.length === 0) {
        throw new Error(`No news found for topic "${topic}" (all sources failed or returned nothing)`);
      }

      // Remove duplicates (same story reported by multiple sources)
      const seen = new Set();
      const deduped = [];
      for (const item of allItems) {
        const key = normalizeTitle(item.title);
        if (key && !seen.has(key)) {
          seen.add(key);
          deduped.push(item);
        }
      }

      // Sort by latest first
      deduped.sort((a, b) => {
        if (a.pubDate && b.pubDate) return b.pubDate - a.pubDate;
        if (a.pubDate) return -1;
        if (b.pubDate) return 1;
        return 0;
      });

      const top = deduped.slice(0, maxItems);

      const text = top
        .map(
          (item, i) =>
            `${i + 1}. ${item.title} [${item.source}]${
              item.pubDate ? ` — ${item.pubDate.toISOString()}` : ""
            }\n   ${item.link}`
        )
        .join("\n\n");

      return { content: [{ type: "text", text }] };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error fetching news: ${error.message}` }],
      };
    }
  }
);

// ---------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal MCP server error:", err);
  process.exit(1);
});
