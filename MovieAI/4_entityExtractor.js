// =====================================================================
// 4_entityExtractor.js — STEP 2: PDF → Gemini (with file upload) → JSON
// =====================================================================
//
// Upload PDF ONCE to Gemini Files API → ask "extract movies 1-50" → 20 requests
// Gemini reads entire PDF in context (1M token window)
// 1000 movies ÷ 50 per batch = only 20 API calls!
//
// RETRY STRATEGY:
//   - Every batch gets 3 attempts (retries on ANY error, not just 429)
//   - 429 (rate limit) → wait 30s/60s/90s
//   - Other errors (parse fail, network, etc.) → wait 10s/20s/30s
//   - After all batches done → retry ALL failed batches one more time
//   - Final summary shows exactly which movies were lost (if any)
// =====================================================================

import { genai } from "./2_config.js";
import { createPartFromUri } from "@google/genai";

const EXTRACTION_PROMPT = `You are a precise entity extractor for a movie knowledge graph.

From the attached PDF, extract movies {START} through {END} (by their order in the document).

For EACH movie, output this EXACT JSON structure:
{
  "movie": {"title": "string", "year": number},
  "director": {"name": "string"},
  "actors": ["string"],
  "genres": ["string"],
  "themes": ["string"],
  "awards": ["string"]
}

Rules:
- If awards say "None", return awards as empty array []
- Keep exact names as written in the PDF
- Year must be a number, not string
- Return a JSON ARRAY of objects: [{...}, {...}, ...]
- Return ONLY valid JSON. No markdown, no backticks, no explanation.`;

/**
 * Upload PDF to Gemini Files API.
 * File stays on Google servers for 48 hours.
 */
async function uploadPDF(pdfPath) {
  console.log("   📤 Uploading PDF to Gemini Files API...");

  const file = await genai.files.upload({
    file: pdfPath,
    config: { mimeType: "application/pdf" },
  });

  // Wait until processing completes
  let fileInfo = await genai.files.get({ name: file.name });
  while (fileInfo.state === "PROCESSING") {
    console.log("   ⏳ PDF processing...");
    await new Promise((r) => setTimeout(r, 3000));
    fileInfo = await genai.files.get({ name: file.name });
  }

  if (fileInfo.state === "FAILED") {
    throw new Error("PDF upload processing failed");
  }

  console.log(`   ✅ PDF uploaded: ${file.name}`);
  return fileInfo;
}

/**
 * Extract one batch of movies from the uploaded PDF.
 * Retries up to maxRetries times on ANY error (not just 429).
 *
 * WHY retry everything?
 *   - 429 → rate limit (wait longer)
 *   - JSON parse error → Gemini returned markdown/garbage (retry often fixes it)
 *   - Network timeout → transient (retry fixes it)
 *   - 500/503 → server overload (retry fixes it)
 */
async function extractBatch(fileInfo, start, end, attempt = 1) {
  const maxRetries = 3;
  const prompt = EXTRACTION_PROMPT
    .replace("{START}", start)
    .replace("{END}", end);

  try {
    const response = await genai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            //tell Gemini: “Use this already-uploaded file as part of my prompt.”
            createPartFromUri(fileInfo.uri, fileInfo.mimeType),
            { text: prompt },
          ],
        },
      ],
    });

    let raw = response.text.trim();
    raw = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err) {
    // If we have retries left → wait and try again
    if (attempt < maxRetries) {
      const is429 = err.message?.includes("429");
      const wait = is429 ? attempt * 30 : attempt * 10;
      const reason = is429 ? "Rate limited" : "Error";
      console.warn(`   ⚠️ ${reason}. Waiting ${wait}s (retry ${attempt + 1}/${maxRetries})...`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      return extractBatch(fileInfo, start, end, attempt + 1);
    }

    // All retries exhausted → return empty (will be tracked as failed)
    console.error(`   ❌ Batch ${start}-${end} FAILED after ${maxRetries} attempts:`, err.message?.substring(0, 150));
    return [];
  }
}

/**
 * Extract ALL entities from PDF.
 *
 * PAID TIER STRATEGY:
 *   - Run 5 batches in PARALLEL (not one by one)
 *   - No delays needed (1000+ RPM on paid tier)
 *   - 20 batches ÷ 5 parallel = 4 rounds ≈ 1-2 minutes total
 *   - Pass 2: Retry any failed batches
 */
async function extractAllEntities(pdfPath, totalMovies = 1000, batchSize = 50) {
  // Upload PDF once
  const fileInfo = await uploadPDF(pdfPath);

  const allBatches = [];
  const totalBatches = Math.ceil(totalMovies / batchSize);

  // Build batch list
  for (let i = 0; i < totalBatches; i++) {
    allBatches.push({
      start: i * batchSize + 1,
      end: Math.min((i + 1) * batchSize, totalMovies),
    });
  }

  // ── PASS 1: Run 5 batches in parallel ──
  const CONCURRENCY = 5;
  const results = [];
  const failedBatches = [];

  console.log(`\n   📊 Pass 1: Extracting ${totalBatches} batches (${CONCURRENCY} parallel)...\n`);

  for (let i = 0; i < allBatches.length; i += CONCURRENCY) {
    const chunk = allBatches.slice(i, i + CONCURRENCY);
    const roundNum = Math.floor(i / CONCURRENCY) + 1;
    const totalRounds = Math.ceil(allBatches.length / CONCURRENCY);

    console.log(`🤖 Round ${roundNum}/${totalRounds}: Movies ${chunk[0].start}-${chunk[chunk.length - 1].end}...`);

    // Fire all 5 requests at the same time
    const promises = chunk.map((batch) =>
      extractBatch(fileInfo, batch.start, batch.end)
        .then((res) => ({ batch, results: res }))
    );
//Executes array of async operations concurrently
    const batchResults = await Promise.all(promises);

    for (const { batch, results: res } of batchResults) {
      if (res.length > 0) {
        results.push(...res);
      } else {
        failedBatches.push(batch);
      }
    }

    console.log(`   ✅ Total so far: ${results.length} movies`);

    // Small 2s breather between rounds (not strictly needed)
    if (i + CONCURRENCY < allBatches.length) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // ── PASS 2: Retry failed batches (sequentially, with delay) ──
  if (failedBatches.length > 0) {
    console.log(`\n   🔄 Pass 2: Retrying ${failedBatches.length} failed batches...\n`);
    await new Promise((r) => setTimeout(r, 5000));

    for (const batch of failedBatches) {
      console.log(`🔄 Retrying movies ${batch.start}-${batch.end}...`);

      const batchResults = await extractBatch(fileInfo, batch.start, batch.end);

      if (batchResults.length > 0) {
        results.push(...batchResults);
        console.log(`   ✅ Retry success! Got ${batchResults.length} movies (total: ${results.length})`);
      } else {
        console.error(`   ❌ Movies ${batch.start}-${batch.end} permanently failed.`);
      }

      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Cleanup uploaded file
  try {//unique resource name given to file by server
    await genai.files.delete({ name: fileInfo.name });
    console.log("   🗑️ PDF deleted from Gemini servers");
  } catch (e) { /* auto-deletes in 48h anyway */ }

  console.log(`\n✅ Total extracted: ${results.length}/${totalMovies} movies`);
  if (results.length < totalMovies) {
    console.warn(`⚠️ ${totalMovies - results.length} movies missing. You can re-run indexing to fill gaps.`);
  }

  return results;
}

export { extractAllEntities, uploadPDF };
