import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const BASE = "https://www.congreso.es";
const ENDPOINTS = {
  diputados: "https://www.congreso.es/es/opendata/diputados",
  votaciones: "https://www.congreso.es/es/opendata/votaciones",
  iniciativas: "https://www.congreso.es/es/opendata/iniciativas"
};

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const LIMIT_VOTES = Number(process.env.LIMIT_VOTES || 50);
const VOTE_BATCH_SIZE = Number(process.env.VOTE_BATCH_SIZE || 200);
const SLEEP_MS = Number(process.env.SLEEP_MS || 0);
const DRY_RUN = process.env.DRY_RUN === "1";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function sha1(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function normalizeName(value) {
  return value?.toString().trim().replace(/\s+/g, " ") || "";
}

function parseDate(value) {
  if (!value) return null;
  const cleaned = value.toString().trim();
  const match = cleaned.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  const iso = Date.parse(cleaned);
  if (!Number.isNaN(iso)) return new Date(iso).toISOString().slice(0, 10);
  return null;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "congreso-votos-ingest/0.1"
    }
  });
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} for ${url}`);
  }
  return res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "congreso-votos-ingest/0.1"
    }
  });
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} for ${url}`);
  }
  return res.json();
}

function extractHrefs(html) {
  const results = [];
  const regex = /href="([^"]+)"/gi;
  let match;
  while ((match = regex.exec(html))) {
    results.push(match[1]);
  }
  return results;
}

function resolveUrl(href) {
  try {
    return new URL(href, BASE).toString();
  } catch {
    return null;
  }
}

function findJsonLinkAfterLabel(html, label) {
  const idx = html.indexOf(label);
  if (idx === -1) return null;
  const slice = html.slice(idx, idx + 2000);
  const match = slice.match(/href="([^"]+\.json[^"]*)"/i);
  if (!match) return null;
  return resolveUrl(match[1]);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function saveJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
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

async function ingestDiputados() {
  const html = await fetchText(ENDPOINTS.diputados);
  const jsonUrl = findJsonLinkAfterLabel(
    html,
    "Todos los diputados y diputadas de todas las legislaturas"
  );

  if (!jsonUrl) {
    throw new Error("No se encontró el enlace JSON de diputados (todos).");
  }

  const raw = await fetchJson(jsonUrl);
  const list = Array.isArray(raw) ? raw : raw?.diputados || [];

  const rows = list.map((item) => {
    const fullName = normalizeName(item.NOMBRE || item.NOMBRECOMPLETO || item.NOMBREYAPELLIDOS || "");
    const apellidos = normalizeName(item.APELLIDOS || "");
    const name = fullName || normalizeName([item.NOMBRE, apellidos].filter(Boolean).join(" "));
    const legislature = item.LEGISLATURA || item.legislatura || null;
    const start = parseDate(item.FECHAINICIOLEGISLATURA || item.FECHAINICIO || item.FECHAALTA);
    const end = parseDate(item.FECHAFINLEGISLATURA || item.FECHAFIN || item.FECHABAJA);
    const identitySeed = `${name}|${legislature || ""}|${start || ""}`;

    return {
      id: sha1(identitySeed),
      full_name: name || "(sin nombre)",
      legislature: legislature?.toString() || null,
      start_date: start,
      end_date: end,
      source_url: jsonUrl,
      raw: item
    };
  });

  const uniqueRows = Array.from(
    new Map(rows.map((row) => [row.id, row])).values()
  );

  await saveJson(path.join(DATA_DIR, "diputados.json"), raw);

  if (DRY_RUN) {
    console.log(`[diputados] ${uniqueRows.length} registros (dry run)`);
    return;
  }

  const result = await supabaseUpsert("deputies_raw", uniqueRows, "id");
  console.log(`[diputados] ${uniqueRows.length} registros | supabase:`, result);
}

async function discoverVotePages() {
  const html = await fetchText(ENDPOINTS.votaciones);
  const hrefs = extractHrefs(html)
    .map(resolveUrl)
    .filter(Boolean);

  const legPages = hrefs.filter((href) =>
    href.startsWith(ENDPOINTS.votaciones) && /legis|legislatura/i.test(href)
  );

  if (legPages.length === 0) return [ENDPOINTS.votaciones];
  return Array.from(new Set(legPages));
}

async function collectVoteJsonUrls() {
  const pages = await discoverVotePages();
  const urls = new Set();

  for (const page of pages) {
    const html = await fetchText(page);
    const hrefs = extractHrefs(html)
      .map(resolveUrl)
      .filter(Boolean);

    for (const href of hrefs) {
      if (href.includes("/webpublica/opendata/votaciones/") && href.endsWith(".json")) {
        urls.add(href);
      }
    }
  }

  return Array.from(urls);
}

function voteMetaFromUrl(url) {
  const file = url.split("/").pop() || "";
  const id = file.replace(/\.json$/i, "");
  const dateMatch = url.match(/\/Leg(\d+)\/Sesion(\d+)\/(\d{8})\//);
  const legislature = dateMatch ? `Leg${dateMatch[1]}` : null;
  const sessionDate = dateMatch ? `${dateMatch[3].slice(0, 4)}-${dateMatch[3].slice(4, 6)}-${dateMatch[3].slice(6, 8)}` : null;
  return { id, legislature, sessionDate };
}

async function ingestVotaciones() {
  const urls = await collectVoteJsonUrls();
  const limited = LIMIT_VOTES > 0 ? urls.slice(0, LIMIT_VOTES) : urls;

  if (limited.length === 0) {
    console.log("[votaciones] no se encontraron URLs");
    return;
  }

  let totalInserted = 0;
  const allRows = [];

  for (let i = 0; i < limited.length; i += VOTE_BATCH_SIZE) {
    const batch = limited.slice(i, i + VOTE_BATCH_SIZE);
    const rows = [];

    for (const url of batch) {
      const raw = await fetchJson(url);
      const meta = voteMetaFromUrl(url);
      rows.push({
        id: meta.id || sha1(url),
        legislature: meta.legislature,
        session_date: meta.sessionDate,
        source_url: url,
        raw
      });

      if (SLEEP_MS > 0) {
        await new Promise((resolve) => setTimeout(resolve, SLEEP_MS));
      }
    }

    const uniqueRows = Array.from(
      new Map(rows.map((row) => [row.id, row])).values()
    );

    allRows.push(...uniqueRows);

    if (!DRY_RUN) {
      const result = await supabaseUpsert("votes_raw", uniqueRows, "id");
      totalInserted += result.inserted || 0;
      console.log(
        `[votaciones] lote ${i + 1}-${i + batch.length} | supabase:`,
        result
      );
    } else {
      console.log(`[votaciones] lote ${i + 1}-${i + batch.length} (dry run)`);
    }
  }

  await saveJson(path.join(DATA_DIR, "votaciones.json"), allRows);

  if (DRY_RUN) {
    console.log(`[votaciones] ${allRows.length} votos (dry run)`);
    return;
  }

  console.log(`[votaciones] total insertados: ${totalInserted}`);
}

async function ingestIniciativas() {
  const html = await fetchText(ENDPOINTS.iniciativas);
  const hrefs = extractHrefs(html)
    .map(resolveUrl)
    .filter(Boolean)
    .filter((href) => href.includes("/webpublica/opendata/iniciativas/") && href.endsWith(".json"));

  await saveJson(path.join(DATA_DIR, "iniciativas_links.json"), hrefs);
  console.log(`[iniciativas] ${hrefs.length} enlaces JSON guardados.`);
}

const task = process.argv[2] || "all";

try {
  if (task === "diputados") await ingestDiputados();
  else if (task === "votaciones") await ingestVotaciones();
  else if (task === "iniciativas") await ingestIniciativas();
  else if (task === "all") {
    await ingestDiputados();
    await ingestVotaciones();
    await ingestIniciativas();
  } else {
    console.log("Uso: node scripts/ingest/congreso.mjs [diputados|votaciones|iniciativas|all]");
  }
} catch (error) {
  console.error("Error en ingesta:", error.message);
  process.exit(1);
}
