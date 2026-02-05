import { NextResponse } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase";

export async function GET() {
  const env = getSupabaseEnv();
  return NextResponse.json({
    supabaseUrl: Boolean(env.url),
    supabaseKey: env.hasKey
  });
}
