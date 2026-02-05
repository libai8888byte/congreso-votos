# Congreso Votos

Resumen visual del historial de voto de cada diputado y diputada del Congreso de los Diputados.

## Arranque local

1. Instala dependencias (requiere acceso a internet):

```bash
npm install
```

2. Inicia el entorno de desarrollo:

```bash
npm run dev
```

## Base de datos (Supabase)

1. Crea un proyecto en Supabase.
2. Ejecuta el esquema base desde `sql/schema.sql`.
3. Crea un archivo `.env.local` con:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_ANON_KEY=...
```

## Ingesta de datos

```bash
node scripts/ingest/congreso.mjs all
```

## Normalización (a tablas finales)

```bash
node scripts/ingest/normalize.mjs
```

## API local

- `GET /api/deputies?query=...` busca por nombre
- `GET /api/deputies/:id` devuelve resumen de votos

Opciones útiles:
- `LIMIT_VOTES=50` limita votaciones descargadas.
- `DRY_RUN=1` evita escribir en Supabase.

## Estructura

- `src/app` UI principal (Next.js App Router)
- `sql/schema.sql` esquema base para Postgres/Supabase
- `scripts/ingest` scripts de ingesta
- `docs` notas de arquitectura y roadmap

## Notas

- El MVP usa datos abiertos del Congreso (diputados + votaciones de legislaturas X–XV).
- El histórico pre‑2011 se plantea como fase 2.
