import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const BASE = "https://quesevota.es";
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

const MAX_PAGES = Number(process.env.QV_MAX_PAGES || 309);
const SLEEP_MS = Number(process.env.SLEEP_MS || 0);
const INGEST = process.env.QV_INGEST === "1";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function sha1(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "congreso-votos-quesevota/0.1" }
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return res.text();
}

function extractVotePageLinks(html) {
  const results = new Set();
  const regex = /href=\"(\/votacion\/[^\"]+)\"/gi;
  let match;
  while ((match = regex.exec(html))) {
    results.add(`${BASE}${match[1]}`);
  }
  return Array.from(results);
}

function extractJsonUrls(html) {
  const results = new Set();
  const patterns = [
    new RegExp(
      "https://www\\.congreso\\.es/webpublica/opendata/votaciones/[^\\\"'\\s]+\\.json",
      "gi"
    ),
    new RegExp(
      "https:\\\\/\\\\/www\\.congreso\\.es\\\\/webpublica\\\\/opendata\\\\/votaciones\\\\/[^\\\"'\\s]+\\.json",
      "gi"
    ),
    new RegExp(
      "\\\\/webpublica\\\\/opendata\\\\/votaciones\\\\/[^\\\"'\\s]+\\.json",
      "gi"
    )
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(html))) {
      const raw = match[0];
      const cleaned = raw.replace(/\\\\/g, "").replace(/\\//g, "/");
      const url = cleaned.startsWith("http")
        ? cleaned
        : `${BASE}${cleaned}`;
      results.add(url);
    }
  }

  return Array.from(results);
}

async function supabaseUpsert(table, rows, onConflict = "id") {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { skipped: true };
  }
  if (!rows.length) return { skipped: false };

  const chunkSize = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const url = `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify(chunk)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Supabase upsert failed (${table}): ${res.status} ${text}`);
    }
    inserted += chunk.length;
  }

  return { skipped: false, inserted };
}

async function saveJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function ingestJsonUrls(jsonUrls) {
  const rows = [];
  for (const url of jsonUrls) {
    const raw = await fetch(url).then((r) => r.json());
    rows.push({
      id: sha1(url),
      legislature: null,
      session_date: null,
      source_url: url,
      raw
    });
    if (SLEEP_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));
    }
  }

  const uniqueRows = Array.from(new Map(rows.map((r) => [r.id, r])).values());
  const result = await supabaseUpsert("votes_raw", uniqueRows, "id");
  console.log(`[quesevota] ${uniqueRows.length} votos | supabase:`, result);
}

async function run() {
  const votePages = new Set();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${BASE}/votaciones?page=${page}`;
    const html = await fetchText(url);
    const links = extractVotePageLinks(html);
    links.forEach((link) => votePages.add(link));
    console.log(`[quesevota] page ${page} -> ${links.length} links`);
    if (SLEEP_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));
    }
  }

  const jsonUrls = new Set();
  for (const link of votePages) {
    const html = await fetchText(link);
    extractJsonUrls(html).forEach((u) => jsonUrls.add(u));
    if (SLEEP_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));
    }
  }

  const jsonList = Array.from(jsonUrls);
  await saveJson(path.join(DATA_DIR, "quesevota_vote_urls.json"), jsonList);
  console.log(`[quesevota] ${jsonList.length} urls oficiales encontradas`);

  if (INGEST) {
    await ingestJsonUrls(jsonList);
  } else {
    console.log("[quesevota] QV_INGEST=1 para cargar en Supabase");
  }
}

run().catch((error) => {
  console.error("Error en quesevota:", error.message);
  process.exit(1);
});
