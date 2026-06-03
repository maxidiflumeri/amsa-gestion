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

echo "==> Pull + migraciones (prisma db push) + up"
docker compose -f docker-compose.prod.yml pull backend
# db push SIN --accept-data-loss: si el cambio fuese destructivo, FALLA en vez de borrar datos
docker compose -f docker-compose.prod.yml run --rm backend npx prisma db push --skip-generate
docker compose -f docker-compose.prod.yml up -d
docker image prune -f || true

echo "==> Esperando /api/health"
for _ in $(seq 1 30); do
  if curl -fsS http://localhost:3001/api/health >/dev/null 2>&1; then
    echo "OK: backend saludable"
    exit 0
  fi
  sleep 2
done

echo "ERROR: /api/health no respondió a tiempo"
docker compose -f docker-compose.prod.yml logs --tail=80 backend || true
exit 1
