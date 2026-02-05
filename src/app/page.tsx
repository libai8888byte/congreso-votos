"use client";

import { useMemo, useState } from "react";

type Deputy = {
  id: string;
  full_name: string;
  photo_url?: string | null;
  profile_url?: string | null;
};

type DeputySummary = {
  deputy: Deputy | null;
  totalVotes: number;
  breakdown: Record<string, number>;
  alignmentPct: number | null;
  alignmentTotal: number;
  byLegislature: { label: string; value: number }[];
};

const metrics = [
  { label: "Diputados", value: "4.000+" },
  { label: "Votaciones", value: "250.000+" },
  { label: "Legislaturas", value: "X – XV" }
];

const visuals = [
  {
    title: "Timeline de Carrera",
    description: "Legislaturas activas con intensidad de participación y cambios de grupo."
  },
  {
    title: "Huella de Voto",
    description: "Distribución sí/no/abstención/ausente y tendencia por tema."
  },
  {
    title: "Alineación con Grupo",
    description: "Porcentaje de votaciones en línea con el grupo parlamentario."
  },
  {
    title: "Mapa de Temas",
    description: "Temas más frecuentes usando iniciativas y expedientes asociados."
  }
];

function formatVoteLabel(value: string) {
  if (value === "si") return "Sí";
  if (value === "no") return "No";
  if (value === "abstencion") return "Abstención";
  if (value === "ausente") return "Ausente";
  if (value === "presente") return "Presente";
  return value;
}

function DonutChart({ items }: { items: { label: string; value: number; color: string }[] }) {
  const total = items.reduce((acc, item) => acc + item.value, 0) || 1;
  let cumulative = 0;

  return (
    <svg viewBox="0 0 42 42" className="h-40 w-40">
      <circle cx="21" cy="21" r="15.9155" fill="transparent" stroke="#e6dfd4" strokeWidth="6" />
      {items.map((item) => {
        const dash = (item.value / total) * 100;
        const offset = 100 - cumulative;
        cumulative += dash;
        return (
          <circle
            key={item.label}
            cx="21"
            cy="21"
            r="15.9155"
            fill="transparent"
            stroke={item.color}
            strokeWidth="6"
            strokeDasharray={`${dash} ${100 - dash}`}
            strokeDashoffset={offset}
          />
        );
      })}
      <text x="21" y="22" textAnchor="middle" className="fill-ink text-[5px] font-semibold">
        {total}
      </text>
      <text x="21" y="27" textAnchor="middle" className="fill-ink/60 text-[3px]">
        votos
      </text>
    </svg>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Deputy[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<DeputySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const breakdownItems = useMemo(() => {
    if (!selected) return [];
    const entries = Object.entries(selected.breakdown || {});
    const total = selected.totalVotes || 1;
    return entries
      .map(([key, value]) => ({
        key,
        label: formatVoteLabel(key),
        value,
        percent: Math.round((value / total) * 100)
      }))
      .sort((a, b) => b.value - a.value);
  }, [selected]);

  const donutItems = useMemo(() => {
    const palette = ["#1B5B6A", "#C7A34A", "#7B2031", "#0C0B10", "#6A8E6A"];
    return breakdownItems.map((item, index) => ({
      label: item.label,
      value: item.value,
      color: palette[index % palette.length]
    }));
  }, [breakdownItems]);

  const legislatureSeries = selected?.byLegislature || [];
  const maxLegislature = Math.max(1, ...legislatureSeries.map((item) => item.value));

  async function runSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setSelected(null);

    try {
      const res = await fetch(`/api/deputies?query=${encodeURIComponent(query.trim())}`);
      if (!res.ok) throw new Error("No se pudieron buscar diputados");
      const data = await res.json();
      setResults(data.results || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDeputy(id: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deputies/${id}`);
      if (!res.ok) throw new Error("No se pudo cargar el perfil");
      const data = await res.json();
      setSelected(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-paper-texture">
      <div className="grid-cut">
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="flex flex-col gap-6">
            <div className="text-sm uppercase tracking-[0.3em] text-wine">
              Observatorio de voto
            </div>
            <h1 className="text-4xl md:text-6xl font-semibold text-ink">
              Congreso Votos
            </h1>
            <p className="max-w-2xl text-lg text-ink/80">
              Resumen visual del historial de voto de cada diputado y diputada del Congreso
              de los Diputados. Una vista clara, comparable y con contexto por legislatura.
            </p>
            <div className="flex flex-wrap gap-4">
              <button
                className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-paper"
                onClick={() => document.getElementById("search")?.scrollIntoView({ behavior: "smooth" })}
              >
                Explorar diputados
              </button>
              <button className="rounded-full border border-ink/20 px-6 py-3 text-sm font-semibold text-ink">
                Ver metodología
              </button>
            </div>
          </div>
        </section>
      </div>

      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="grid gap-4 md:grid-cols-3">
          {metrics.map((item) => (
            <div key={item.label} className="card rounded-2xl px-6 py-5">
              <div className="text-sm text-ink/60">{item.label}</div>
              <div className="text-2xl font-semibold text-ink">{item.value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold text-ink">Perfil de diputado</h2>
            <p className="mt-2 text-ink/70">
              Cada perfil explica cómo ha votado a lo largo de su carrera, con foco en
              participación, consistencia y temas clave.
            </p>
            <div className="mt-6 grid gap-4">
              {visuals.map((item) => (
                <div key={item.title} className="rounded-xl border border-ink/10 bg-white/60 p-4">
                  <div className="text-base font-semibold text-ink">{item.title}</div>
                  <div className="text-sm text-ink/70">{item.description}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card rounded-2xl p-8">
            <h2 className="text-2xl font-semibold text-ink">Metodología</h2>
            <p className="mt-2 text-ink/70">
              Ingesta automática de datos abiertos del Congreso, normalización de votos,
              cálculo de métricas y generación de visuales comparables.
            </p>
            <div className="mt-6 space-y-3 text-sm text-ink/70">
              <div>
                Datos base: Diputados y Votaciones (Legislaturas X–XV).
              </div>
              <div>
                Enriquecimiento: iniciativas y expedientes para clasificar temas.
              </div>
              <div>
                Próximo paso: histórico pre‑2011 con diarios de sesiones.
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="search" className="mx-auto max-w-6xl px-6 pb-24">
        <div className="card rounded-2xl p-8">
          <h2 className="text-2xl font-semibold text-ink">Busca un diputado</h2>
          <p className="mt-2 text-ink/70">
            Escribe un nombre o apellido. Luego selecciona para ver el resumen visual.
          </p>
          <div className="mt-6 flex flex-col gap-3 md:flex-row">
            <input
              className="flex-1 rounded-xl border border-ink/20 bg-white/80 px-4 py-3 text-sm"
              placeholder="Ej. María, Sánchez, García..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button
              className="rounded-xl bg-ink px-6 py-3 text-sm font-semibold text-paper"
              onClick={runSearch}
              disabled={loading}
            >
              {loading ? "Buscando..." : "Buscar"}
            </button>
          </div>

          {error && <div className="mt-4 text-sm text-wine">{error}</div>}

          {results.length > 0 && (
            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {results.map((deputy) => (
                <button
                  key={deputy.id}
                  className="rounded-xl border border-ink/10 bg-white/70 p-4 text-left hover:border-ink/30"
                  onClick={() => loadDeputy(deputy.id)}
                >
                  <div className="text-base font-semibold text-ink">{deputy.full_name}</div>
                  <div className="text-xs text-ink/60">{deputy.id}</div>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div className="mt-8 rounded-2xl border border-ink/10 bg-white/70 p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-xl font-semibold text-ink">
                    {selected.deputy?.full_name || "Diputado"}
                  </div>
                  <div className="text-sm text-ink/60">Total de votos: {selected.totalVotes}</div>
                </div>
                {selected.deputy?.profile_url && (
                  <a
                    className="text-sm font-semibold text-sea"
                    href={selected.deputy.profile_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver perfil oficial
                  </a>
                )}
              </div>

              <div className="mt-6 grid gap-6 md:grid-cols-3">
                <div className="flex flex-col items-center justify-center gap-4">
                  <DonutChart items={donutItems} />
                  <div className="text-xs text-ink/60">Distribución de voto</div>
                </div>
                <div className="md:col-span-2 space-y-3">
                  {breakdownItems.map((item) => (
                    <div key={item.key}>
                      <div className="flex items-center justify-between text-sm text-ink">
                        <span>{item.label}</span>
                        <span>
                          {item.value} ({item.percent}%)
                        </span>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-ink/10">
                        <div
                          className="h-2 rounded-full bg-gold"
                          style={{ width: `${item.percent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8 grid gap-6 md:grid-cols-2">
                <div className="rounded-xl border border-ink/10 bg-white/60 p-4">
                  <div className="text-sm font-semibold text-ink">Alineación con grupo</div>
                  <div className="mt-2 text-3xl font-semibold text-ink">
                    {selected.alignmentPct !== null ? `${selected.alignmentPct}%` : "N/D"}
                  </div>
                  <div className="text-xs text-ink/60">
                    Basado en {selected.alignmentTotal} votos comparables.
                  </div>
                </div>
                <div className="rounded-xl border border-ink/10 bg-white/60 p-4">
                  <div className="text-sm font-semibold text-ink">Participación por legislatura</div>
                  <div className="mt-4 space-y-2">
                    {legislatureSeries.map((item) => (
                      <div key={item.label} className="flex items-center gap-3 text-xs text-ink">
                        <span className="w-16">{item.label}</span>
                        <div className="h-2 flex-1 rounded-full bg-ink/10">
                          <div
                            className="h-2 rounded-full bg-sea"
                            style={{ width: `${Math.round((item.value / maxLegislature) * 100)}%` }}
                          />
                        </div>
                        <span className="w-10 text-right">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
