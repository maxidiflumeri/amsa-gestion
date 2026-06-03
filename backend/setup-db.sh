#!/usr/bin/env bash
set -euo pipefail

# Reinicia el container de mysql con el compose ya editado (network_mode: host),
# crea la DB amsa_gestion, sincroniza el schema con prisma db push,
# regenera el client y corre todos los seeds del proyecto.
#
# Uso: bash setup-db.sh  (pide sudo solo para docker)

cd "$(dirname "$0")"

echo ">>> 1) Recreando containers con el compose nuevo"
sudo docker compose -f /home/maxi/infra/docker-compose.yml up -d --force-recreate
echo ">>> Esperando MySQL..."
for i in $(seq 1 30); do
  if sudo docker exec dev-mysql mysqladmin -uroot -proot ping >/dev/null 2>&1; then
    echo "    MySQL listo (intento $i)"
    break
  fi
  sleep 1
  [ "$i" = "30" ] && { echo "MySQL no respondio en 30s"; exit 1; }
done

echo ">>> 2) Probando conectividad TCP host->mysql"
if timeout 3 bash -c 'exec 3<>/dev/tcp/127.0.0.1/3306 && head -c 80 <&3 | xxd' >/dev/null 2>&1; then
  echo "    OK: handshake recibido"
else
  echo "    FAIL: TCP a 127.0.0.1:3306 sigue sin entregar datos."
  echo "    Probamos via container directo (Unix socket) igual:"
fi

echo ">>> 3) Creando DB amsa_gestion si no existe"
sudo docker exec dev-mysql mysql -uroot -proot \
  -e "CREATE DATABASE IF NOT EXISTS amsa_gestion CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

echo ">>> 4) prisma db push (sincroniza schema)"
npx prisma db push

echo ">>> 5) prisma generate"
npx prisma generate

echo ">>> 6) seed principal"
npx prisma db seed

echo ">>> 7) seeds parciales"
npx ts-node prisma/seed-empresas.ts
npx ts-node prisma/seed-parametros.ts
npx ts-node prisma/seed-formatos-tel.ts
npx ts-node prisma/seed-telefonia.ts
npx ts-node prisma/seed-codigos-curados.ts

echo ">>> Listo. DB amsa_gestion poblada."
