import { NextResponse } from "next/server";
import { supabaseSelect } from "@/lib/supabase";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("query")?.trim() || "";

    if (!query) {
      return NextResponse.json({ results: [] });
    }

    const results = await supabaseSelect("deputies", {
      select: "id,full_name,photo_url,profile_url",
      full_name: `ilike.*${query}*`,
      limit: "20"
    });

    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
