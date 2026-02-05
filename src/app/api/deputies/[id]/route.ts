import { NextResponse } from "next/server";
import { supabaseSelect } from "@/lib/supabase";

const MAX_VOTES = 2000;
const CHUNK_SIZE = 200;

function chunkArray<T>(arr: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function buildInParam(values: string[]) {
  return `in.(${values.map((value) => `\"${value}\"`).join(",")})`;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const deputyId = params.id;

    const [deputy] = await supabaseSelect("deputies", {
      select: "*",
      id: `eq.${deputyId}`
    });

    const voteResults = await supabaseSelect("vote_results", {
      select: "vote_id,vote_value,party_id",
      deputy_id: `eq.${deputyId}`,
      limit: `${MAX_VOTES}`
    });

    const counts: Record<string, number> = {};
    for (const row of voteResults) {
      counts[row.vote_value] = (counts[row.vote_value] || 0) + 1;
    }

    const totalVotes = voteResults.length;

    const voteIds = voteResults.map((row: { vote_id: string }) => row.vote_id).filter(Boolean);
    const byParty = new Map<string, Set<string>>();
    for (const row of voteResults) {
      if (!row.party_id || !row.vote_id) continue;
      if (!byParty.has(row.party_id)) byParty.set(row.party_id, new Set());
      byParty.get(row.party_id)?.add(row.vote_id);
    }

    let aligned = 0;
    let comparable = 0;

    for (const [partyId, voteSet] of byParty.entries()) {
      const voteIdChunks = chunkArray(Array.from(voteSet), CHUNK_SIZE);

      for (const chunk of voteIdChunks) {
        const partyVotes = await supabaseSelect("vote_results", {
          select: "vote_id,vote_value",
          party_id: `eq.${partyId}`,
          vote_id: buildInParam(chunk)
        });

        const majorityMap = new Map<string, string>();
        const countMap = new Map<string, Record<string, number>>();

        for (const row of partyVotes) {
          if (!countMap.has(row.vote_id)) countMap.set(row.vote_id, {});
          const voteCount = countMap.get(row.vote_id)!;
          voteCount[row.vote_value] = (voteCount[row.vote_value] || 0) + 1;
        }

        for (const [voteId, tally] of countMap.entries()) {
          let max = 0;
          let winner: string | null = null;
          let tie = false;
          for (const [value, count] of Object.entries(tally)) {
            if (count > max) {
              max = count;
              winner = value;
              tie = false;
            } else if (count === max) {
              tie = true;
            }
          }
          if (!tie && winner) majorityMap.set(voteId, winner);
        }

        for (const row of voteResults) {
          if (!chunk.includes(row.vote_id)) continue;
          if (row.party_id !== partyId) continue;
          const majority = majorityMap.get(row.vote_id);
          if (!majority) continue;
          comparable += 1;
          if (row.vote_value === majority) aligned += 1;
        }
      }
    }

    const alignmentPct = comparable ? Math.round((aligned / comparable) * 100) : null;

    const voteIdChunks = chunkArray(voteIds, CHUNK_SIZE);
    const votesMeta: { id: string; legislature_id: string | null }[] = [];
    for (const chunk of voteIdChunks) {
      const rows = await supabaseSelect("votes", {
        select: "id,legislature_id",
        id: buildInParam(chunk)
      });
      votesMeta.push(...rows);
    }

    const byLegislature: Record<string, number> = {};
    for (const row of votesMeta) {
      const key = row.legislature_id || "Sin legislatura";
      byLegislature[key] = (byLegislature[key] || 0) + 1;
    }

    const legislatureSeries = Object.entries(byLegislature)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));

    return NextResponse.json({
      deputy,
      totalVotes,
      breakdown: counts,
      alignmentPct,
      alignmentTotal: comparable,
      byLegislature: legislatureSeries
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
