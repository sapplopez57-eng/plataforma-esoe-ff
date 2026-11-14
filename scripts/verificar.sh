#!/usr/bin/env bash
# Compuerta de calidad del ciclo de desarrollo. Ninguna vuelta se cierra si esto falla.
# Uso: npm run verificar

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
  DB_PASSWORD=verificacion JWT_SECRET=verificacion docker compose config -q
}

paso "Estilo y errores estaticos (eslint)" npx --no-install eslint .
paso "Pruebas con cobertura minima" npm run --silent test:cobertura
paso "Dependencias sin vulnerabilidades altas" npm audit --audit-level=high
paso "Sin secretos versionados" node scripts/buscar-secretos.js
paso ".env fuera del control de versiones" env_fuera_de_git
paso "docker-compose valido" compose_valido

if [ -z "${PRUEBAS_DATABASE_URL:-}" ]; then
  aviso "PRUEBAS_DATABASE_URL no definida: las pruebas del esquema se omitieron."
fi

printf '\n'
if [ "$fallos" -gt 0 ]; then
  printf 'RESULTADO: %d verificacion(es) fallaron. La vuelta NO se puede cerrar.\n' "$fallos"
  exit 1
fi
printf 'RESULTADO: todo en verde (%d aviso(s)).\n' "$avisos"
