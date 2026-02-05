# Ingesta

Scripts para descargar datos abiertos del Congreso y cargarlos en Supabase.

## Requisitos

- Node 18+
- Variables de entorno (para carga a Supabase):
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

Si no se configuran, el script solo descarga y guarda JSON en `data/`.

## Uso

```bash
node scripts/ingest/congreso.mjs diputados
node scripts/ingest/congreso.mjs votaciones
node scripts/ingest/congreso.mjs iniciativas
node scripts/ingest/congreso.mjs all
node scripts/ingest/normalize.mjs
```

Opciones:
- `LIMIT_VOTES=50` limita la cantidad de votaciones descargadas.
- `DRY_RUN=1` evita escribir en Supabase.
- `DATA_DIR=./data` cambia la carpeta de salida.
