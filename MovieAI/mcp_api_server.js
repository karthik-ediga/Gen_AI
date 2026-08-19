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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

dotenv.config();

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
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal MCP server error:", err);
  process.exit(1);
});
