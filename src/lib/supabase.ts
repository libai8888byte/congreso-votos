export function getSupabaseEnv() {
  const url = process.env.SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || "";

  return {
    url,
    key: serviceKey || anonKey,
    hasKey: Boolean(serviceKey || anonKey)
  };
}

export async function supabaseSelect(path: string, params: Record<string, string>) {
  const { url, key, hasKey } = getSupabaseEnv();
  if (!url || !hasKey) {
    throw new Error("Supabase env no configurado");
  }

  const query = new URLSearchParams(params);
  const response = await fetch(`${url}/rest/v1/${path}?${query.toString()}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase error ${response.status}: ${text}`);
  }

  return response.json();
}
