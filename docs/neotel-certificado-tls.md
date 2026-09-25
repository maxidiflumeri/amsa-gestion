# Certificado TLS de `neotel.anamayasa.com` — renovación y estrategia

> Estado al **2026-09-25**: **renovado en la notebook, falta que Neotel lo instale.** El anterior venció
> el 2026-09-24 a las 17:53 UTC. El nuevo vence el **2026-12-24 14:17 UTC**. Renovarlo antes del
> **2026-11-24**.

---

## 1. Contexto

### Para qué sirve este certificado

La **Toolbar de Neotel** corre en `https://neotel.anamayasa.com:8443/neotel/` y embebe AMSA Gestión en
un iframe (ver [neotel-toolbar-spec.md](neotel-toolbar-spec.md)). Ese puerto 8443 está en el
**servidor de Neotel**, pero el nombre de dominio es **nuestro**: `anamayasa.com` se administra en
**AWS Route 53**.

```
operador (Chrome)
   │  https://neotel.anamayasa.com:8443   ← certificado nuestro, instalado en el servidor de Neotel
   ▼
Toolbar Neotel (200.5.98.203)
   │  iframe
   ▼
https://amsagestion.anamayasa.com     ← certificado nuestro en ACM/CloudFront (se renueva solo, no es este problema)
```

Si el certificado del 8443 vence, Chrome muestra el aviso de "conexión no segura" y los operadores
no pueden trabajar en la Toolbar.

### Historia

| Fecha | Qué pasó |
|---|---|
| mayo 2026 | Para el softphone WebRTC propio le propusimos a Neotel ([neotel-mail-pedido-upgrade.md](neotel-mail-pedido-upgrade.md)) un subdominio nuestro apuntando a su IP, con un certificado de **Let's Encrypt validado por DNS en Route 53** que nosotros generamos y ellos instalan. El nombre propuesto era `sip.anamayasa.com`. |
| 2026-06-26 | Se emite el certificado actual de `neotel.anamayasa.com` (Let's Encrypt, 90 días). |
| 2026-08-10 | Se abandona el softphone propio y se pasa a la Toolbar (CHANGELOG). Se descarta `sip.anamayasa.com`; el de `neotel.anamayasa.com` **sigue en uso** y queda anotado que vence el 2026-09-24. |
| 2026-09-24 | Vence sin renovar. |

### Estado verificado el 2026-09-24

```
$ openssl s_client -connect neotel.anamayasa.com:8443 -servername neotel.anamayasa.com | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
subject   = CN = neotel.anamayasa.com
issuer    = C = US, O = Let's Encrypt, CN = YE1
notBefore = Jun 26 17:53:46 2026 GMT
notAfter  = Sep 24 17:53:45 2026 GMT
SAN       = DNS:neotel.anamayasa.com

$ dig +short neotel.anamayasa.com
200.5.98.203          ← IP de Neotel (sip.anamayasa.com también apunta ahí, sin uso)
```

### Cómo se generó (resuelto el 2026-09-25, desde la notebook)

- **Herramienta:** `certbot` + plugin `certbot-dns-route53`, instalado en un venv de Python. Validación
  **DNS-01 automática** contra la zona Route 53 `anamayasa.com` (`Z0703008GHG4KW4WNMNP`), con las
  credenciales del perfil AWS `amsa-gestion`. Clave ECDSA P-256 (el default de certbot).
- **Archivos:** en la notebook, `~/certs-neotel/`: `neotel.anamayasa.com.crt`, `.key`, `-chain.crt`,
  `-fullchain.crt`, `.pfx` y un `.zip` con todo. La contraseña del `.pfx` está en `PFX_PASSWORD.txt`
  del mismo directorio (es la misma de junio). Los vencidos quedaron en `vencidos-2026-09-24/`.
- **Config de certbot:** en junio vivía en un directorio temporal y se perdió. Desde el 2026-09-25 está
  en `~/certs-neotel/letsencrypt/` (cuenta ACME, `renewal/`, `live/`), así que alcanza con
  `certbot renew`.
- **Qué sirve el 8443:** **IIS 10** (`Server: Microsoft-IIS/10.0`) en WEB1 (`90.0.0.8`). El Meraki
  reenvía `8443` público → `90.0.0.8:443`, y el **puerto 80 público ya llega al mismo IIS**
  (`http://neotel.anamayasa.com/.well-known/acme-challenge/x` responde un 404 de IIS). Verificado el
  2026-09-25.
- **Todavía sin confirmar:** cómo se entregó en junio y quién lo instaló del lado de Neotel.

---

## 2. Renovación manual (la receta que funciona)

El dominio apunta a la IP de Neotel, así que **no se puede validar por HTTP desde nuestro lado**: se
valida por DNS (DNS-01) y certbot crea y borra solo el TXT `_acme-challenge.neotel.anamayasa.com` en
Route 53. Desde la notebook:

```bash
# 1. certbot (una vez; el venv puede estar en cualquier lado)
python3 -m venv ~/certbot-venv && ~/certbot-venv/bin/pip install certbot certbot-dns-route53

# 2. credenciales de AWS del perfil amsa-gestion
eval "$(aws configure export-credentials --profile amsa-gestion --format env)"

# 3. renovar (usa la config guardada en ~/certs-neotel/letsencrypt)
D=~/certs-neotel/letsencrypt
~/certbot-venv/bin/certbot renew --config-dir $D/config --work-dir $D/work --logs-dir $D/logs
#    si ese directorio se perdió, emitir de cero:
#    certbot certonly --dns-route53 -d neotel.anamayasa.com -m maxidiflumeri@gmail.com \
#      --agree-tos -n --config-dir $D/config --work-dir $D/work --logs-dir $D/logs

# 4. exportar en los formatos que se le entregan a Neotel
cd ~/certs-neotel && L=letsencrypt/config/live/neotel.anamayasa.com && N=neotel.anamayasa.com
cp -L $L/cert.pem $N.crt; cp -L $L/chain.pem $N-chain.crt; cp -L $L/fullchain.pem $N-fullchain.crt
install -m 600 "$(readlink -f $L/privkey.pem)" $N.key
openssl pkcs12 -export -in $N.crt -certfile $N-chain.crt -inkey $N.key -name $N \
  -out $N.pfx -passout file:PFX_PASSWORD.txt
```

### Resultado y entrega

Se entregan `.crt`, `.key`, `-chain.crt`, `-fullchain.crt` y `.pfx`, los mismos que en junio.

- **La clave privada no va por mail común.** Usar un canal cifrado, o un `.zip`/`.pfx` con contraseña
  y la contraseña por otro medio.
- Neotel tiene que **reiniciar o recargar** el servicio del 8443.
- Verificar con el `openssl s_client` de la sección 1: `notAfter` tiene que ser ~90 días adelante.
- **Anotar el próximo vencimiento** (≈ 90 días después de la emisión) en este documento y en el
  CHANGELOG hasta que exista la alarma de la sección 4.

---

## 3. Estrategia para que no vuelva a pasar

### 3.1 ¿Certificados de mayor duración? No es la solución

- **Let's Encrypt**: 90 días, y ya anunció una baja a 45 días.
- **Certificados pagos (DigiCert, Sectigo, etc.)**: el CA/Browser Forum aprobó bajar la vida máxima de
  **todos** los certificados públicos: ~200 días desde marzo 2026, ~100 días desde marzo 2027 y
  **47 días hacia 2029**. Pagar compra unos meses este año y después volvemos al mismo problema, cada
  vez más seguido.
- **ACM exportable** (certificados públicos de AWS que se pueden exportar, pagos): se renuevan solos en
  AWS, pero **hay que exportarlos e instalarlos en Neotel igual**. Resuelve la emisión, no la
  instalación, que es la parte manual.

**Conclusión:** la industria va a certificados cada vez más cortos. Lo único sostenible es
**automatizar la renovación y la instalación**, y **monitorear el vencimiento** por si la
automatización falla.

### 3.2 La causa real

El servidor es **de Neotel**, pero el certificado lo emitimos **nosotros a mano**, porque el dominio es
nuestro. Eso junta en una persona tres pasos manuales (emitir, enviar, instalar) cada 90 días. La
solución de fondo es que **quien sirve el certificado lo renueve solo**.

### 3.3 Opciones

#### Opción 1 — Neotel renueva solo, validación por HTTP en su servidor ⭐ la más simple

> **Actualización 2026-09-25:** es viable **sin tocar nada de red**. El servidor es IIS 10 y el puerto
> 80 público ya le llega. En Windows/IIS el cliente estándar es **[win-acme](https://www.win-acme.com/)**
> (`wacs.exe`): valida por HTTP-01 contra el sitio de IIS, instala el certificado, actualiza el binding
> del 443 y crea una tarea programada que lo renueva sola. Es un solo trabajo de instalación de su
> lado, unos 15 minutos.

`neotel.anamayasa.com` ya apunta a su IP. Si abren el **puerto 80** hacia ese servidor, corren `certbot`
(o el cliente ACME que soporte su stack) con validación HTTP-01, y se renueva solo cada ~60 días con
el timer de certbot + un hook que recarga el servicio del 8443.

- **Nosotros:** nada, salvo no mover el registro A.
- **Ellos:** instalar certbot, abrir el 80, configurar el hook de recarga (y la conversión a PKCS#12 si
  el servidor la necesita).
- **Riesgo:** si cambian de IP y no nos avisan, falla. La alarma de la sección 4 lo detecta.

#### Opción 2 — Neotel renueva solo, validación DNS delegada (CNAME)

Si no pueden abrir el 80. Creamos en Route 53 **un solo registro**:

```
_acme-challenge.neotel.anamayasa.com  CNAME  <id>.auth.<su-acme-dns>.   (o una zona de ellos)
```

Let's Encrypt sigue el CNAME, así que ellos validan escribiendo en **su** DNS (con
[acme-dns](https://github.com/joohoi/acme-dns) o una zona propia), sin tocar el nuestro. certbot,
acme.sh y lego soportan este esquema.

- **Nosotros:** crear el CNAME una sola vez (se puede meter en Terraform, `dns-acm.tf`).
- **Ellos:** acme-dns o una zona propia + cliente ACME con hook de recarga.
- **Ventaja:** no les damos ninguna credencial nuestra.

#### Opción 3 — Neotel renueva solo con credencial de AWS acotada

Un usuario IAM cuya política **solo** permite modificar el TXT de `_acme-challenge.neotel.anamayasa.com`
en nuestra zona. Route 53 lo soporta con la condición
`route53:ChangeResourceRecordSetsNormalizedRecordNames` (más `route53:ChangeResourceRecordSetsRecordTypes = TXT`).
Ellos usan `certbot --dns-route53` con esa credencial.

- **Ventaja:** no necesitan montar nada de DNS.
- **Contra:** entregamos una credencial de larga duración a un tercero, aunque sea mínima. Hay que
  rotarla y auditarla.

#### Opción 4 — Nosotros emitimos automático y se lo empujamos

Un proceso nuestro (Lambda + EventBridge, o un cron en la EC2) renueva con `--dns-route53` cada ~60
días y **sube** los archivos a Neotel (SFTP, API, bucket compartido) + dispara la recarga.

- **Contra:** depende de que Neotel exponga un canal de subida y de que su lado recargue solo. Son dos
  sistemas y dos equipos, así que es lo más frágil. Solo si las opciones 1–3 no son viables.

#### Opción 5 — Poner algo nuestro adelante (proxy)

Que el operador entre a un host nuestro (ALB/CloudFront con certificado ACM que se renueva solo) que
reenvía a `200.5.98.203:8443`. Resuelve el certificado de raíz, pero **cambia la arquitectura** de la
Toolbar: WebSockets, audio, `frame-ancestors`, latencia, y un punto de falla nuestro en el camino de
las llamadas. **No recomendado** salvo que aparezcan otras razones para hacerlo.

### 3.4 Comparación

| | Trabajo nuestro | Trabajo de Neotel | Credenciales cedidas | Fragilidad |
|---|---|---|---|---|
| 1. HTTP-01 en su servidor | ninguno | medio | no | baja |
| 2. DNS delegado por CNAME | 1 registro | medio-alto | no | baja |
| 3. IAM acotado | usuario IAM | bajo | sí (mínima) | baja |
| 4. Push desde nosotros | alto | medio | depende | alta |
| 5. Proxy nuestro | alto | bajo | no | media (cambia arquitectura) |

**Recomendación preliminar:** proponerle a Neotel la **1**, con la **2** como alternativa si no pueden
abrir el 80. La **3** si quieren lo más fácil y aceptamos ceder la credencial. Cualquiera de ellas
**más** el monitoreo de la sección 4.

---

## 4. Monitoreo del vencimiento (se hace sí o sí)

Hoy nadie se enteró hasta que venció. Cualquiera sea la opción elegida, conviene un aviso con
anticipación: la automatización también falla (cambian IP, se rompe el hook, vence la credencial).

### Propuesta: Lambda + EventBridge + CloudWatch, en Terraform

Ya existe en [infra/terraform/monitoring.tf](../infra/terraform/monitoring.tf) el tema SNS
`aws_sns_topic.alerts` con suscripción por email (`var.alarm_email`). Se suma:

1. **Lambda** chica (Python o Node): abre TLS contra una lista de `host:puerto`, lee `notAfter` y
   publica la métrica `DiasParaVencer` en CloudWatch (dimensión `Host`).
   - Lista inicial: `neotel.anamayasa.com:8443`. Se pueden sumar otros hosts que no estén en ACM.
   - Si no puede conectarse, publica `0` (o una métrica de error aparte) para que también alarme.
2. **Regla de EventBridge** diaria que la dispara.
3. **Alarma de CloudWatch** `DiasParaVencer < 21` → `aws_sns_topic.alerts`. Opcional: una segunda en
   `< 7` como alerta crítica.
4. `treat_missing_data = "breaching"`: si la Lambda deja de correr, también avisa.

Costo: prácticamente cero. Queda versionado junto al resto de la infraestructura.

**Nota:** los health checks de Route 53 **no** miran el vencimiento del certificado, por eso la Lambda.

### Alternativa sin código

Un monitor externo de SSL (UptimeRobot, Better Stack, etc.) que avisa por mail N días antes. Sirve
como parche rápido, pero queda fuera de nuestra infraestructura y de Terraform.

### Complemento dentro de la app (opcional)

Un job repetible de BullMQ en el backend que haga el mismo chequeo y cree una **notificación in-app**
para los administradores (`modules/notificaciones/`). Le llega a quien usa el sistema y no solo al
mail de alarmas. Es secundario a lo de CloudWatch.

---

## 5. Mail a Neotel (borrador)

> **Asunto:** Renovación automática del certificado de neotel.anamayasa.com
>
> Hola, ¿cómo están?
>
> El certificado TLS de `neotel.anamayasa.com` (el que usa la Toolbar en el puerto 8443) es de
> Let's Encrypt y dura 90 días; hasta ahora lo generábamos nosotros y se los enviábamos para instalar.
> Venció el 24/09 y queremos que no vuelva a pasar, así que les proponemos que se renueve
> automáticamente en su servidor:
>
> 1. **Opción preferida:** instalar [win-acme](https://www.win-acme.com/) en el servidor IIS que sirve
>    `neotel.anamayasa.com` y emitir el certificado con validación HTTP. El dominio ya apunta a su IP
>    (200.5.98.203) y el puerto 80 ya llega a ese IIS, así que no hay que cambiar nada de red. win-acme
>    instala el certificado en el binding HTTPS y deja una tarea programada que lo renueva sola.
> 2. **Si no pueden abrir el 80:** validación DNS delegada. Creamos en nuestro DNS un CNAME de
>    `_acme-challenge.neotel.anamayasa.com` hacia un DNS de ustedes (por ejemplo, acme-dns), y renuevan
>    sin depender de nosotros.
> 3. **Alternativa:** les damos una credencial de AWS limitada exclusivamente a ese registro de
>    validación, para que usen `certbot --dns-route53`.
>
> Para avanzar nos ayudaría saber:
> - Cuál de las tres opciones les resulta más viable.
> - Quién de su lado sería el contacto técnico.
>
> Mientras tanto les enviamos un certificado renovado manualmente por [canal seguro].
>
> Saludos.

---

## 6. Plan de acción

- [x] **Notebook:** averiguar cómo se generó el certificado anterior (sección 1).
- [x] Renovar a mano (sección 2). Emitido el 2026-09-25, vence el **2026-12-24**.
- [ ] Entregárselo a Neotel por canal seguro y verificar con `openssl s_client` que el 8443 lo sirve.
- [ ] Revisar y afinar el borrador del mail (sección 5) con lo que se sepa de la notebook, y enviarlo.
- [ ] Implementar la alarma de vencimiento (sección 4) en `infra/terraform/`.
- [ ] Cuando Neotel responda: implementar la opción elegida (y, si es la 2 o la 3, el registro/usuario
      IAM en Terraform).
- [ ] Verificar la primera renovación automática real (~60 días después de configurarla) y cerrar.
- [ ] Opcional: borrar el registro `sip.anamayasa.com`, que quedó sin uso desde el cambio a la Toolbar.
- [ ] Actualizar CHANGELOG y [neotel-toolbar-spec.md](neotel-toolbar-spec.md) §6–7 al cerrar.
