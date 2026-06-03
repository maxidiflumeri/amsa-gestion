# Infra — AMSA Gestión (AWS, us-east-1)

Despliegue de producción calcado de amsa-sender pero gestionado con **Terraform** y con varias mejoras (RDS privada/encriptada, EBS encriptado, SGs cerrados, secretos en SSM, state remoto, CI con gates, rollback por SHA, alarmas, Graviton).

## Arquitectura

```
amsagestion.anamayasa.com ──► CloudFront (OAC, cert ACM) ──► S3  amsa-gestion-frontend-prod
api.amsagestion.anamayasa.com ──► ALB (HTTPS, cert ACM) ──► EC2 t4g.large (AL2023)
                                                              docker compose: backend(:3001) + redis
                                                              └─► RDS MySQL 8.0 (privada, solo EC2)
Deploys: GitHub Actions (OIDC) → ECR → SSM Run Command → la EC2 hace pull + db push + up
Secretos: SSM Parameter Store (SecureString) → render-env.sh → /opt/amsa-gestion/.env
```

## Requisitos

- AWS CLI v2 con un perfil con permisos de admin sobre la cuenta `592943773890`. Acá se usa el perfil **`amsa-gestion`** (todos los comandos llevan `AWS_PROFILE=amsa-gestion`).
- Terraform >= 1.6.

## Orden de despliegue

### 1. State remoto (una sola vez)

```bash
cd infra/bootstrap
AWS_PROFILE=amsa-gestion terraform init
AWS_PROFILE=amsa-gestion terraform apply      # crea bucket de state + tabla de lock
```

### 2. Secretos

```bash
cd ../terraform
cp terraform.tfvars.example terraform.tfvars
# Editar terraform.tfvars y completar:
#   neotel_sip_encryption_key  → misma key del backend/.env de gestión
#   sender_internal_api_key    → la que amsa-sender prod espera en INTERNAL_API_KEYS
#     (si todavía no la tenés, dejá REPLACE_ME y actualizá con otro apply después)
```

### 3. Infra principal

```bash
AWS_PROFILE=amsa-gestion terraform init        # usa el backend S3 creado en el paso 1
AWS_PROFILE=amsa-gestion terraform plan
AWS_PROFILE=amsa-gestion terraform apply
```

Tarda ~10-15 min (RDS + CloudFront + validación ACM son lo más lento). La validación de los certs es automática porque la zona Route53 está en la misma cuenta.

### 4. Configurar GitHub Actions

Los valores salen de los outputs (`terraform output github_actions_config`). Cargar en
**GitHub → repo amsa-gestion → Settings → Secrets and variables → Actions**:

**Secrets:** `AWS_ROLE_ARN_FRONTEND`, `AWS_ROLE_ARN_BACKEND`, `VITE_GOOGLE_CLIENT_ID`
**Variables:** `VITE_API_URL`, `VITE_HOST_SOCKET`, `S3_BUCKET`, `CF_DISTRIBUTION_ID`, `EC2_INSTANCE_ID`

O de un saque con `gh` (requiere `gh auth login`):

```bash
cd infra/terraform
J="$(AWS_PROFILE=amsa-gestion terraform output -json github_actions_config)"
gh secret set AWS_ROLE_ARN_FRONTEND -R maxidiflumeri/amsa-gestion -b "$(jq -r .secrets.AWS_ROLE_ARN_FRONTEND <<<"$J")"
gh secret set AWS_ROLE_ARN_BACKEND  -R maxidiflumeri/amsa-gestion -b "$(jq -r .secrets.AWS_ROLE_ARN_BACKEND  <<<"$J")"
gh secret set VITE_GOOGLE_CLIENT_ID -R maxidiflumeri/amsa-gestion -b "$(jq -r .secrets.VITE_GOOGLE_CLIENT_ID <<<"$J")"
gh variable set VITE_API_URL       -R maxidiflumeri/amsa-gestion -b "$(jq -r .variables.VITE_API_URL       <<<"$J")"
gh variable set VITE_HOST_SOCKET   -R maxidiflumeri/amsa-gestion -b "$(jq -r .variables.VITE_HOST_SOCKET   <<<"$J")"
gh variable set S3_BUCKET          -R maxidiflumeri/amsa-gestion -b "$(jq -r .variables.S3_BUCKET          <<<"$J")"
gh variable set CF_DISTRIBUTION_ID -R maxidiflumeri/amsa-gestion -b "$(jq -r .variables.CF_DISTRIBUTION_ID <<<"$J")"
gh variable set EC2_INSTANCE_ID    -R maxidiflumeri/amsa-gestion -b "$(jq -r .variables.EC2_INSTANCE_ID    <<<"$J")"
```

### 5. Google OAuth

En Google Cloud Console (mismo proyecto que amsa-sender), agregar a **Authorized JavaScript origins**:
`https://amsagestion.anamayasa.com`.

### 6. Primer deploy

- **Backend:** `git push` a `main` con cambios en `backend/**`, o disparar el workflow *Deploy Backend* manualmente (`workflow_dispatch`). Buildea la imagen arm64, la sube a ECR y la EC2 hace pull + `prisma db push` + `up`.
- **Frontend:** ídem con *Deploy Frontend* (`frontend/**`).

### 7. Seeds (DB arranca vacía)

Una vez que el backend está corriendo, desde la EC2 (vía SSM Session Manager):

```bash
sudo su -
cd /opt/amsa-gestion
docker compose -f docker-compose.prod.yml run --rm backend npx prisma db seed
# seeds parciales según necesidad (ver CLAUDE.md): seed-empresas, seed-parametros, etc.
```

## Operación (día 2)

| Tarea | Cómo |
|---|---|
| **Deploy backend** | push a `main` (backend/**) o *Deploy Backend* → `workflow_dispatch` |
| **Rollback backend** | re-correr *Deploy Backend* apuntando a un SHA anterior (la imagen vive en ECR taggeada por SHA) |
| **Deploy frontend** | push a `main` (frontend/**) o *Deploy Frontend* → `workflow_dispatch` |
| **Entrar a la EC2** | `aws ssm start-session --target $(terraform output -raw ec2_instance_id) --profile amsa-gestion` (sin SSH) |
| **Ver logs backend** | CloudWatch Logs grupo `/amsa-gestion/backend`, o en la box `docker compose logs -f backend` |
| **Actualizar un secreto** | editar `terraform.tfvars` → `terraform apply` → re-deploy backend (render-env.sh re-lee SSM) |
| **Conectarse a la RDS** | es privada: túnel por la EC2 (`aws ssm start-session` con port forwarding) o cliente desde la box |

## Destruir

```bash
# Quitar deletion_protection de la RDS primero (rds.tf) o pasar -target, luego:
cd infra/terraform && AWS_PROFILE=amsa-gestion terraform destroy
```

> La RDS tiene `deletion_protection = true` y `skip_final_snapshot = false` a propósito: no se borra por accidente y deja snapshot final.

## Costo estimado

≈ **US$ 50-65/mes**: EC2 t4g.large ~$48 (o apagada/Savings Plan menos) · RDS db.t4g.small ~$24 · ALB ~$18 · EBS/S3/CloudFront/ECR ~$5. Sin NAT gateway.
