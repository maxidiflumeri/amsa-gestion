#!/usr/bin/env bash
# Renderiza /opt/amsa-gestion/.env desde SSM Parameter Store (/amsa-gestion/*),
# preservando BACKEND_IMAGE. Excluye los params internos (_compose, _deploy_sh, _render_env_sh).
set -euo pipefail
REGION="${AWS_REGION:-us-east-1}"
APP_DIR=/opt/amsa-gestion
cd "$APP_DIR"

TMP="$(mktemp)"

# Preservar BACKEND_IMAGE si ya estaba seteado
if [[ -f .env ]] && grep -q '^BACKEND_IMAGE=' .env; then
  grep '^BACKEND_IMAGE=' .env >> "$TMP"
fi

aws ssm get-parameters-by-path \
  --path /amsa-gestion/ \
  --with-decryption \
  --region "$REGION" \
  --query "Parameters[?!starts_with(Name, '/amsa-gestion/_')].[Name,Value]" \
  --output text \
  | while IFS=$'\t' read -r name value; do
      printf '%s=%s\n' "${name##*/}" "$value"
    done >> "$TMP"

install -m 600 "$TMP" .env
rm -f "$TMP"
echo "render-env: .env actualizado ($(grep -c '=' .env) variables)"
