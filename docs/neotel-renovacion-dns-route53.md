# Renovación automática del certificado de neotel.anamayasa.com

**Para:** equipo técnico de Neotel
**De:** AMSA
**Fecha:** 21/10/2026

## 1. Resumen

El certificado TLS de `neotel.anamayasa.com` (la Toolbar, puerto 8443) es de Let's Encrypt y dura 90
días. Para que se renueve solo en su servidor, sin abrir el puerto 80 ni depender de nosotros, la
validación se hace por **DNS (DNS-01)**.

El DNS de `anamayasa.com` está en **AWS Route 53**. El "API token" de AWS es un par de claves
(**Access Key ID** y **Secret Access Key**) de un usuario IAM dedicado, `neotel-acme`. Ese usuario
solo puede crear y borrar un registro: el TXT de validación `_acme-challenge.neotel.anamayasa.com`.

El certificado actual vence el **24/12/2026**. Lo ideal es dejar la renovación automática
configurada antes del **24/11**.

## 2. La credencial

### Qué permite y qué no

| Acción | Permitida |
|---|---|
| Crear, actualizar y borrar el TXT `_acme-challenge.neotel.anamayasa.com` | Sí |
| Listar las zonas de la cuenta (solo nombres e IDs) | Sí, el cliente ACME lo necesita para ubicar la zona |
| Consultar el estado de propagación de un cambio | Sí |
| Leer, crear, modificar o borrar cualquier otro registro de la zona | No |
| Crear registros de otro tipo (A, CNAME, MX…) aunque sea con ese nombre | No |
| Cualquier otro servicio de AWS | No |

### Política IAM

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BuscarZonaYEsperar",
      "Effect": "Allow",
      "Action": ["route53:ListHostedZones", "route53:GetChange"],
      "Resource": "*"
    },
    {
      "Sid": "SoloDesafioAcme",
      "Effect": "Allow",
      "Action": "route53:ChangeResourceRecordSets",
      "Resource": "arn:aws:route53:::hostedzone/Z0703008GHG4KW4WNMNP",
      "Condition": {
        "ForAllValues:StringEquals": {
          "route53:ChangeResourceRecordSetsNormalizedRecordNames": ["_acme-challenge.neotel.anamayasa.com"],
          "route53:ChangeResourceRecordSetsRecordTypes": ["TXT"],
          "route53:ChangeResourceRecordSetsActions": ["UPSERT", "DELETE"]
        }
      }
    }
  ]
}
```

Los permisos son exactamente los que usa win-acme con Route 53. Si eligen otro cliente ACME (Posh-ACME,
Certify The Web, certbot), avísennos: alguno pide además `route53:ListResourceRecordSets` y lo
ajustamos.

### Entrega y cuidado

- Les enviamos las claves **por un canal separado de este documento**, a la persona que nos indiquen.
- Las claves no vencen solas. Proponemos rotarlas una vez por año, o antes si cambia el personal que
  tuvo acceso.
- Si sospechan que se filtraron, avísennos: las desactivamos en minutos. Aun filtradas, solo sirven
  para escribir ese registro de validación.
- AWS registra cada uso de la credencial, así que podemos auditar desde dónde y cuándo se usó.

## 3. Requisitos en su servidor

- **Salida a internet por HTTPS (443)** desde el servidor IIS hacia:
  - `acme-v02.api.letsencrypt.org` (Let's Encrypt)
  - `route53.amazonaws.com` (AWS Route 53)
- **No hace falta ningún puerto de entrada.** En particular, no se usa el puerto 80.
- Un usuario administrador para la instalación inicial.

## 4. Configuración con win-acme (paso a paso)

Usamos win-acme como ejemplo porque es el cliente estándar para IIS. Si prefieren otro cliente, el
esquema es el mismo: validación DNS-01, proveedor Route 53, con estas claves.

### 4.1 Descargar

Desde la página de versiones de win-acme en GitHub
(<https://github.com/win-acme/win-acme/releases/latest>, hoy la v2.2.9.1701) se necesitan **dos**
archivos:

1. `win-acme.v2.2.9.1701.x64.pluggable.zip`. Tiene que ser la versión *pluggable*: la *trimmed* no
   carga plugins.
2. `plugin.validation.dns.route53.v2.2.9.1701.zip`, el plugin de Route 53, que se distribuye aparte.

### 4.2 Instalar

1. Descomprimir los dos zip en la **misma** carpeta fija, por ejemplo `C:\Program Files\win-acme\`.
   No usar Descargas: la tarea programada queda apuntando a esa carpeta.
2. Desbloquear las DLL descargadas. Si no, .NET no las carga. En PowerShell como administrador:

   ```powershell
   Get-ChildItem 'C:\Program Files\win-acme' -Recurse | Unblock-File
   ```

3. Comprobar que el plugin carga: `wacs.exe --verbose` tiene que listar **Route53** entre los plugins de
   validación.

### 4.3 Emitir el certificado

En una consola como administrador, en la carpeta de win-acme:

```bat
wacs.exe --source iis --siteid <ID del sitio> --host neotel.anamayasa.com ^
  --validationmode dns-01 --validation route53 ^
  --route53accesskeyid <ACCESS KEY ID> --route53secretaccesskey <SECRET ACCESS KEY> ^
  --installation iis --store certificatestore ^
  --emailaddress <mail técnico de Neotel> --accepttos
```

- `<ID del sitio>` es el ID del sitio de IIS que sirve la Toolbar. Se ve en el Administrador de IIS, o
  con `wacs.exe` → menú → lista de sitios.
- `--validationmode dns-01` es necesario: sin él, win-acme busca el plugin entre los de validación
  HTTP y no lo encuentra.
- win-acme guarda el secreto **cifrado con DPAPI** en su configuración (opción `EncryptConfig`,
  activa por defecto). No queda en texto plano ni hace falta volver a pasarlo.

También se puede hacer desde el menú interactivo (`wacs.exe` → **M**, opciones completas). Hay que
elegir el sitio de IIS y el binding `neotel.anamayasa.com`, y como validación **"Create verification
records in AWS Route 53"** con las claves.

Qué hace win-acme en cada emisión o renovación:

1. Crea el TXT `_acme-challenge.neotel.anamayasa.com` en Route 53 y espera a que se propague.
2. Let's Encrypt lo consulta y emite el certificado.
3. win-acme **borra** el TXT.
4. Instala el certificado en el almacén de Windows y actualiza el binding HTTPS de IIS.
5. Deja una tarea programada diaria que renueva cuando corresponde (por defecto a los 55 días).

### 4.4 Verificar

- `wacs.exe --list` muestra la renovación configurada y la fecha de la próxima.
- En el Programador de tareas aparece la tarea de win-acme, con ejecución diaria.
- En IIS, el binding HTTPS muestra el certificado nuevo, emitido por Let's Encrypt.
- Desde fuera de su red, `https://neotel.anamayasa.com:8443/` abre sin avisos.
- Avísennos cuando esté y lo verificamos también de nuestro lado.

### 4.5 Avisos de fallo (recomendado)

Let's Encrypt ya no envía mails antes del vencimiento. En el `settings.json` de win-acme, en la sección
de notificaciones, se configura el envío por SMTP (`SmtpServer`, `SmtpPort`, `SmtpUser`,
`SmtpPassword`, `SenderAddress`, `ReceiverAddresses`) para enterarse si una renovación falla. Pueden
sumarnos entre los destinatarios.

Además, nosotros vamos a monitorear el vencimiento desde afuera.

## 5. Otros servicios que usen el certificado

Si el mismo certificado se usa fuera de IIS (por ejemplo, el WSS del WebRTC en el puerto 8089),
avísennos. win-acme puede exportarlo en cada renovación como `.pfx` o `.pem` (`--store pfxfile` o
`pemfiles`) y ejecutar un script para recargar ese servicio (`--installation script`).

## 6. Lo que necesitamos de ustedes

1. **Contacto técnico** que recibe las claves.
2. **Cliente ACME** que van a usar, por si hay que ajustar permisos.
3. **Si este certificado está instalado en algún otro lugar además del IIS**, por ejemplo en el servidor
   de telefonía para el audio del softphone. win-acme solo renueva la copia del IIS (ver sección 5).
4. **Aviso cuando esté configurado**, para verificarlo desde afuera.

Cualquier duda, coordinamos una llamada y lo hacemos juntos.
