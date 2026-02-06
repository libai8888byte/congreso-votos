import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const OUT_DIR = process.env.OUT_DIR || path.join(process.cwd(), "data", "normalized");
const DRY_RUN = process.env.DRY_RUN === "1";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function sha1(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function normalizeText(value) {
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

function getPath(obj, pathArr) {
  return pathArr.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function pickFirst(obj, paths) {
  for (const pathArr of paths) {
    const value = getPath(obj, pathArr);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function findArray(obj, keys) {
  for (const key of keys) {
    if (Array.isArray(obj?.[key])) return obj[key];
  }
  // search one level deep
  for (const value of Object.values(obj || {})) {
    if (value && typeof value === "object") {
      for (const key of keys) {
        if (Array.isArray(value?.[key])) return value[key];
      }
    }
  }
  return null;
}

function normalizeVoteValue(value) {
  if (!value) return "desconocido";
  const raw = value.toString().toLowerCase();
  if (raw.includes("sí") || raw.includes("si")) return "si";
  if (raw.includes("no")) return "no";
  if (raw.includes("abst")) return "abstencion";
  if (raw.includes("aus")) return "ausente";
  if (raw.includes("pres")) return "presente";
  return raw.replace(/\s+/g, "_");
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

async function readJson(filePath) {
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content);
}

function extractDeputyId(item) {
  const rawId = pickFirst(item, [
    ["ID_DIPUTADO"],
    ["IDDIPUTADO"],
    ["idDiputado"],
    ["ID"],
    ["id"],
    ["IDPERSONA"],
    ["idPersona"]
  ]);
  if (rawId) return rawId.toString();

  const name = normalizeText(
    pickFirst(item, [
      ["NOMBRE"],
      ["NOMBRECOMPLETO"],
      ["NOMBREYAPELLIDOS"],
      ["APELLIDOS"],
      ["nombre"],
      ["nombreCompleto"],
      ["nombreyapellidos"]
    ])
  );
  return sha1(name || JSON.stringify(item));
}

function extractDeputyName(item) {
  const fullName = normalizeText(
    pickFirst(item, [
      ["NOMBRECOMPLETO"],
      ["NOMBREYAPELLIDOS"],
      ["NOMBRE"],
      ["APELLIDOS"],
      ["nombreCompleto"],
      ["nombreyapellidos"],
      ["nombre"],
      ["apellidos"]
    ])
  );
  if (!fullName) return "(sin nombre)";
  return fullName;
}

function extractParty(item) {
  return normalizeText(
    pickFirst(item, [
      ["GRUPO"],
      ["GRUPOPARLAMENTARIO"],
      ["GRUP_PARL"],
      ["PARTIDO"],
      ["grupo"],
      ["grupoParlamentario"],
      ["partido"]
    ])
  );
}

function extractLegislature(item) {
  return normalizeText(
    pickFirst(item, [
      ["LEGISLATURA"],
      ["legislatura"],
      ["Legislatura"],
      ["LEG"],
      ["leg"]
    ])
  );
}

function extractVoteEntries(raw) {
  const candidates = findArray(raw, [
    "VOTOS",
    "VOTANTES",
    "votos",
    "votantes",
    "DIPUTADOS",
    "diputados",
    "VOTACIONINDIVIDUAL",
    "votacionIndividual"
  ]);

  if (candidates) return candidates;

  if (Array.isArray(raw?.votacion)) return raw.votacion;
  if (Array.isArray(raw?.VOTACION)) return raw.VOTACION;

  return [];
}

function extractVoteValue(entry) {
  return pickFirst(entry, [
    ["VOTO"],
    ["VOTACION"],
    ["voto"],
    ["votacion"],
    ["VOTO_TEXTO"],
    ["votoTexto"],
    ["DECISION"],
    ["decision"]
  ]);
}

function extractVoteDeputyName(entry) {
  return normalizeText(
    pickFirst(entry, [
      ["NOMBRE"],
      ["APELLIDOS"],
      ["NOMBRECOMPLETO"],
      ["NOMBREYAPELLIDOS"],
      ["nombre"],
      ["apellidos"],
      ["nombreCompleto"],
      ["nombreyapellidos"],
      ["DIPUTADO"],
      ["diputado"]
    ])
  );
}

async function normalizeDeputies() {
  const diputadosPath = path.join(DATA_DIR, "diputados.json");
  const list = await readJson(diputadosPath);
  const rawList = Array.isArray(list) ? list : list?.diputados || [];

  const deputies = [];
  const parties = new Map();
  const memberships = [];

  for (const item of rawList) {
    const deputyId = extractDeputyId(item);
    const fullName = extractDeputyName(item);
    const birthDate = parseDate(item.FECHANACIMIENTO || item.fechaNacimiento || item.NACIMIENTO);
    const birthplace = normalizeText(item.LUGARNACIMIENTO || item.lugarNacimiento);
    const photo = item.FOTO || item.FOTOURL || item.foto || item.fotoUrl || null;
    const profile = item.URL || item.url || item.PERFIL || null;

    deputies.push({
      id: deputyId,
      full_name: fullName,
      gender: item.SEXO || item.sexo || null,
      birth_date: birthDate,
      birthplace: birthplace || null,
      profile_url: profile,
      photo_url: photo
    });

    const partyName = extractParty(item);
    const legislature = extractLegislature(item);
    const startDate = parseDate(item.FECHAINICIOLEGISLATURA || item.FECHAINICIO || item.FECHAALTA);
    const endDate = parseDate(item.FECHAFINLEGISLATURA || item.FECHAFIN || item.FECHABAJA);
    const constituency = normalizeText(item.CIRCUNSCRIPCION || item.circunscripcion || "");

    if (partyName) {
      const partyId = sha1(partyName.toUpperCase());
      parties.set(partyId, { id: partyId, name: partyName, abbreviation: null });

      memberships.push({
        id: sha1(`${deputyId}|${legislature || ""}|${partyId}|${startDate || ""}`),
        deputy_id: deputyId,
        legislature_id: legislature || null,
        party_id: partyId,
        constituency: constituency || null,
        start_date: startDate,
        end_date: endDate
      });
    }
  }

  const uniqueDeputies = Array.from(
    new Map(deputies.map((row) => [row.id, row])).values()
  );
  const uniqueMemberships = Array.from(
    new Map(memberships.map((row) => [row.id, row])).values()
  );

  return {
    deputies: uniqueDeputies,
    parties: Array.from(parties.values()),
    memberships: uniqueMemberships
  };
}

async function normalizeVotes(deputyNameMap) {
  const votesPath = path.join(DATA_DIR, "votaciones.json");
  const rawList = await readJson(votesPath);
  const rows = Array.isArray(rawList) ? rawList : rawList?.votaciones || [];

  const votes = [];
  const voteResults = [];

  for (const row of rows) {
    const raw = row.raw || row;
    const voteId = row.id || pickFirst(raw, [["ID"], ["id"], ["IDVOTACION"], ["idVotacion"]]) || sha1(JSON.stringify(raw));
    const legislature = row.legislature || extractLegislature(raw);
    const sessionDate = row.session_date || parseDate(pickFirst(raw, [["FECHA"], ["fecha"], ["FECHAVOTACION"], ["fechaVotacion"]]));
    const title = normalizeText(
      pickFirst(raw, [
        ["TITULO"],
        ["TITULOEXPEDIENTE"],
        ["ASUNTO"],
        ["DESCRIPCION"],
        ["descripcion"],
        ["titulo"],
        ["expediente", "titulo"]
      ])
    );
    const summary = normalizeText(pickFirst(raw, [["RESUMEN"], ["resumen"], ["OBSERVACIONES"], ["observaciones"]]));
    const initiativeId = pickFirst(raw, [["IDEXPEDIENTE"], ["idExpediente"], ["EXPEDIENTE"], ["expediente"]]);
    const result = normalizeText(pickFirst(raw, [["RESULTADO"], ["resultado"], ["ACUERDO"], ["acuerdo"]]));

    votes.push({
      id: voteId.toString(),
      legislature_id: legislature || null,
      session_date: sessionDate,
      title: title || null,
      summary: summary || null,
      initiative_id: initiativeId ? initiativeId.toString() : null,
      result: result || null
    });

    const entries = extractVoteEntries(raw);
    for (const entry of entries) {
      const deputyIdRaw = pickFirst(entry, [["ID_DIPUTADO"], ["IDDIPUTADO"], ["idDiputado"], ["id"], ["ID"]]);
      const deputyName = extractVoteDeputyName(entry);
      const deputyId = deputyIdRaw?.toString() || deputyNameMap.get(deputyName);
      if (!deputyId) continue;
      const voteValue = normalizeVoteValue(extractVoteValue(entry));
      const partyName = extractParty(entry);
      const partyId = partyName ? sha1(partyName.toUpperCase()) : null;

      voteResults.push({
        vote_id: voteId.toString(),
        deputy_id: deputyId,
        party_id: partyId,
        vote_value: voteValue
      });
    }
  }

  const uniqueVotes = Array.from(
    new Map(votes.map((row) => [row.id, row])).values()
  );
  const uniqueVoteResults = Array.from(
    new Map(
      voteResults.map((row) => [`${row.vote_id}|${row.deputy_id}`, row])
    ).values()
  );

  return { votes: uniqueVotes, voteResults: uniqueVoteResults };
}

async function run() {
  const { deputies, parties, memberships } = await normalizeDeputies();
  const deputyNameMap = new Map(deputies.map((d) => [normalizeText(d.full_name), d.id]));
  const { votes, voteResults } = await normalizeVotes(deputyNameMap);

  await saveJson(path.join(OUT_DIR, "deputies.json"), deputies);
  await saveJson(path.join(OUT_DIR, "parties.json"), parties);
  await saveJson(path.join(OUT_DIR, "memberships.json"), memberships);
  await saveJson(path.join(OUT_DIR, "votes.json"), votes);
  await saveJson(path.join(OUT_DIR, "vote_results.json"), voteResults);

  if (DRY_RUN) {
    console.log(`[normalize] deputies ${deputies.length} | votes ${votes.length} | vote_results ${voteResults.length} (dry run)`);
    return;
  }

  const p1 = await supabaseUpsert("deputies", deputies, "id");
  const p2 = await supabaseUpsert("parties", parties, "id");
  const p3 = await supabaseUpsert(
    "deputy_memberships",
    memberships,
    "deputy_id,legislature_id,party_id,start_date"
  );
  const p4 = await supabaseUpsert("votes", votes, "id");
  const p5 = await supabaseUpsert("vote_results", voteResults, "vote_id,deputy_id");

  console.log("[normalize] supabase:", { p1, p2, p3, p4, p5 });
}

run().catch((error) => {
  console.error("Error en normalización:", error.message);
  process.exit(1);
});
