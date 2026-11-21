#!/usr/bin/env bash

set -uo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

fallos=0
avisos=0

paso() {
  local nombre="$1"; shift
  printf '\n== %s\n' "$nombre"
  if "$@"; then
    printf '   OK  %s\n' "$nombre"
  else
    printf '   FALLO  %s\n' "$nombre"
    fallos=$((fallos + 1))
  fi
}

aviso() {
  printf '   AVISO  %s\n' "$1"
  avisos=$((avisos + 1))
}

env_fuera_de_git() {
  if git ls-files --error-unmatch .env >/dev/null 2>&1; then
    echo "   .env esta versionado: retirelo con 'git rm --cached .env'"
    return 1
  fi
  git check-ignore -q .env
}

compose_valido() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "   docker no instalado; se omite"
    return 0
  fi
  DB_PASSWORD=x CLERK_PUBLISHABLE_KEY=x CLERK_SECRET_KEY=x ORIGEN_PUBLICO=x CLAVE_CIFRADO=x docker compose config -q
}

base_de_pruebas_viva() {
  if [ -z "${PRUEBAS_DATABASE_URL:-}" ]; then
    echo "   PRUEBAS_DATABASE_URL no definida; las pruebas del esquema se omitiran"
    return 0
  fi
  if node -e "
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.PRUEBAS_DATABASE_URL, connectionTimeoutMillis: 3000 });
    c.connect().then(() => c.end()).catch((e) => { console.error('   ' + e.message); process.exit(1); });
  "; then
    return 0
  fi
  echo "   La base de pruebas no responde. Arranquela antes de seguir (p. ej. pg_ctlcluster 16 main start)."
  return 1
}

paso "Base de datos de pruebas disponible" base_de_pruebas_viva
paso "Estilo y errores estaticos (eslint)" npx --no-install eslint .
paso "Pruebas con cobertura minima" npm run --silent test:cobertura
paso "Dependencias sin vulnerabilidades altas" npm audit --audit-level=high
paso "Sin secretos versionados" node scripts/buscar-secretos.js
paso "Codigo sin comentarios ni terminos no permitidos" node scripts/estilo.js
paso ".env fuera del control de versiones" env_fuera_de_git
paso "docker-compose valido" compose_valido

if [ -z "${PRUEBAS_DATABASE_URL:-}" ]; then
  aviso "PRUEBAS_DATABASE_URL no definida: las pruebas del esquema se omitieron."
fi

printf '\n'
if [ "$fallos" -gt 0 ]; then
  printf 'RESULTADO: %d verificacion(es) fallaron. El cambio NO se puede entregar.\n' "$fallos"
  exit 1
fi
printf 'RESULTADO: todo en verde (%d aviso(s)).\n' "$avisos"
