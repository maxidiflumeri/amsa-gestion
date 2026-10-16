#!/usr/bin/env bash
# Deploy del backend en la EC2. Lo invoca GitHub Actions vía SSM con la URI de imagen ECR.
# Self-update: re-baja compose + render-env.sh desde SSM en cada corrida.
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"
APP_DIR=/opt/amsa-gestion
IMAGE="${1:?uso: deploy.sh <ecr-image-uri>}"
cd "$APP_DIR"

echo "==> Refrescando compose + render-env desde SSM"
aws ssm get-parameter --name /amsa-gestion/_compose       --query Parameter.Value --output text --region "$REGION" > docker-compose.prod.yml
aws ssm get-parameter --name /amsa-gestion/_render_env_sh --query Parameter.Value --output text --region "$REGION" > render-env.sh
chmod +x render-env.sh

echo "==> Renderizando .env"
AWS_REGION="$REGION" ./render-env.sh

echo "==> Fijando BACKEND_IMAGE"
if grep -q '^BACKEND_IMAGE=' .env; then
  sed -i "s|^BACKEND_IMAGE=.*|BACKEND_IMAGE=${IMAGE}|" .env
else
  echo "BACKEND_IMAGE=${IMAGE}" >> .env
fi

echo "==> Login a ECR"
REGISTRY="${IMAGE%%/*}"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"

echo "==> Pull"
docker compose -f docker-compose.prod.yml pull backend

# Espera hasta 5 min a que no haya cargas ni reversiones con latido (< 2 min), contra el contenedor viejo.
# Si no se puede consultar, sigue. Lo que quede lo corta el cierre ordenado con números exactos.
if docker ps -q -f name='^amsa-gestion-backend$' | grep -q .; then
  for i in $(seq 1 15); do
    out=$(docker exec -i -w /app amsa-gestion-backend node - 2>&1 <<'JS'
const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient();
(async () => {
  const d = new Date(Date.now() - 120000);
  const c = await p.import_progreso.findMany({ where: { startedAt: { not: null }, finishedAt: null, heartbeatAt: { gt: d } }, select: { remesaId: true, fase: true, procesadas: true, totalEsperado: true } });
  const r = await p.reversion_accion.findMany({ where: { estado: 'REVIRTIENDO', heartbeatAt: { gt: d } }, select: { remesaId: true, hechos: true, total: true } });
  c.forEach((x) => console.log(`carga remesa=${x.remesaId} ${x.fase} ${x.procesadas}/${x.totalEsperado}`));
  r.forEach((x) => console.log(`reversion remesa=${x.remesaId} ${x.hechos}/${x.total}`));
  console.log(`N=${c.length + r.length}`);
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
JS
) || { echo "==> No se pudo consultar los trabajos en curso, sigo sin esperar: $out"; break; }
    n=${out##*N=}
    case "$n" in ''|*[!0-9]*) echo "==> Respuesta inesperada, sigo sin esperar: $out"; break;; esac
    [ "$n" = 0 ] && break
    echo "==> Esperando ($i/15): $(echo "$out" | head -n -1 | tr '\n' ';')"
    if [ "$i" = 15 ]; then echo "==> Siguen trabajos en curso: el cierre ordenado los corta con números exactos"; else sleep 20; fi
  done
fi

echo "==> Migraciones (prisma db push) + up"
# db push SIN --accept-data-loss: si el cambio fuese destructivo, FALLA en vez de borrar datos
docker compose -f docker-compose.prod.yml run --rm backend npx prisma db push --skip-generate
docker compose -f docker-compose.prod.yml up -d

echo "==> Esperando /api/health"
for _ in $(seq 1 30); do
  if curl -fsS http://localhost:3001/api/health >/dev/null 2>&1; then
    echo "OK: backend saludable"
    # Cada deploy deja la imagen anterior con su tag (el SHA): `prune -f` solo borra las que quedaron sin
    # tag. El 09/10/2026 el disco (60 GB) se llenó con 54 imágenes y el pull de la siguiente falló. Con el
    # backend nuevo ya sano, se borran todas las que no usa ningún contenedor; volver atrás es un pull de
    # ECR, que guarda las últimas 10.
    echo "==> Borrando imágenes que no usa ningún contenedor"
    docker image prune -af || true
    exit 0
  fi
  sleep 2
done

echo "ERROR: /api/health no respondió a tiempo"
docker compose -f docker-compose.prod.yml logs --tail=80 backend || true
exit 1
