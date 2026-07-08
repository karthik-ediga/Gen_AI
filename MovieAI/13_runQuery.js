// =====================================================================
// 13_runQuery.js — INTERACTIVE QUERY CLI
// =====================================================================
//
// THE UNIVERSAL FLOW (same for every query):
//
//   User Query
//       │
//       ▼
//   QUERY ROUTER (14_queryRouter.js)
//   Detects: Is this query about movies?
//       │
//       ├─ YES → MOVIE PIPELINE ─────────────────────┐
//       │        (Entity Resolution → Classification │
//       │         → Graph/Similarity Handlers)        │
//       │                                             │
//       └─ NO  → LLM DIRECT ──────────────────────────┤
//                (Query Gemini for general topics)   │
//                                                    │
//       ┌────────────────────────────────────────────┘
//       │
//       ▼
//     Answer
//
// =====================================================================

import readline from "readline";
import { routeQuery } from "./14_queryRouter.js";
import { closeConnections } from "./2_config.js";

async function processQuery(query) {
  // Router detects: movie query → use database OR general query → use LLM
  await routeQuery(query);
}

async function startCLI() {
  console.log("===========================================");
  console.log("   🎬 GraphRAG Movie Query System");
  console.log("===========================================");
  console.log('Type your question. Type "exit" to quit.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = () => {
    rl.question("🎬 You: ", async (input) => {
      const query = input.trim();

      if (query.toLowerCase() === "exit") {
        console.log("\n👋 Goodbye!");
        rl.close();
        await closeConnections();
        process.exit(0);
      }

      if (!query) { ask(); return; }

      try {
        await processQuery(query);
      } catch (err) {
        console.error("\n❌ Error:", err.message);
      }

      ask();
    });
  };

  ask();
}

startCLI();
