# Integración Email — AMSA Gestión ↔ AMSA Sender

**Proyecto:** AMSA Gestión + AMSA Sender
**Módulos nuevos:**
- Gestión: `email-sender` (cliente HTTP + endpoints)
- Sender: `internal-api` (foundation reusable + sub-módulo `email`)
**Fecha:** 2026-05-12
**Estado:** Diseño aprobado — arrancando Fase 1
**Spec relacionada:** `docs/auditoria-spec.md`, `amsa-integration` (Gestión como SOR)

---

## 0. Resumen ejecutivo

Habilitar el envío de emails **desde AMSA Gestión** delegando el envío real a **AMSA Sender** vía una **API interna protegida por API key**.

- 1 cuenta SMTP por empresa (asignación 1:1).
- Templates filtrados por SMTP (ya existe `TemplateEmail.cuentaSmtpId` en Sender).
- Variables del template **auto-mapeadas** a campos del deudor en Gestión, con override manual del usuario.
- Adjuntos vía multipart.
- Punto de entrada: ícono "enviar mail" al lado del ícono "copiar" en cada chip de email en contactos.
- Sin webhooks: el estado se consulta on-demand contra Sender.
- **La API interna en Sender se diseña como FOUNDATION expandible**: a futuro habrá más endpoints (no sólo email) consumidos por Gestión bajo el mismo guard y prefix.

---

## 1. Decisión arquitectónica raíz

### Decisión: **Foundation `internal-api` en Sender, no endpoint ad-hoc**

**Justificación (3 razones):**

1. **Ambos sistemas van a estar 100% integrados**. Lo confirmó el usuario. Hoy es email; mañana será reportes de envío, estado de SMTP, importación de bounces, sincronización de listas, etc. Diseñar un módulo `internal-api` con sub-features evita repetir guard/auth/prefix en cada feature nueva.
2. **Aislar el contrato S2S del contrato user-facing**. Sender ya tiene su propio JWT + permisos por usuario humano. La API consumida desde Gestión es servicio-a-servicio: tiene otro mecanismo de auth (API key), otro audit trail (acción atribuida a un *service user*) y otros límites (rate limit S2S, IP allowlist eventual). Mezclarla con la API regular contamina ambos lados.
3. **Reusar `ManualEmailService`, no reescribirlo**. El servicio actual en Sender (`enviarManual(dto, userId, archivos)`) ya hace SMTP, render de template, tracking, bounce headers, multi-destinatario, multipart. El controller `internal-api/email` es un **delgado adaptador** que valida API key, materializa un `serviceUserId` y delega.

**Lo que sí se comparte con la API regular de Sender:**
- `ManualEmailService` y sus dependencias (`SmtpService`, `TemplateService`, `TrackingService`).
- Modelos Prisma (`CuentaSMTP`, `TemplateEmail`, `ReporteEmail`).

**Lo que NO se comparte:**
- Guard (`JwtAuthGuard` vs `InternalApiKeyGuard`).
- Decorators de permisos (`@RequiredPermiso` vs nada — la API key es trust binario por ahora; en una fase futura podemos sumar *scopes* por key).
- Prefix de ruta (`/email/*` vs `/api/internal/<feature>/*`).

---

## 2. Modelo de datos

### 2.1 Sender — sin cambios de schema

Todo lo necesario ya existe:
- `CuentaSMTP` (sin concepto de empresa).
- `TemplateEmail.cuentaSmtpId` FK → cuenta SMTP que lo posee → permite listar templates por SMTP.
- `ReporteEmail` (estado por destinatario, ya consultable).

**Sí se requiere:** crear un **service user** `amsa-gestion@interno` (manual o seed) cuyo `id` se usa como `userId` al delegar al `ManualEmailService`. Esto preserva el audit trail interno de Sender (los envíos quedan atribuidos a este usuario virtual).

### 2.2 Gestión — schema additions

```prisma
model empresa {
  // ... campos existentes
  cuentaSmtpId Int?      // referencia al ID en Sender (no FK porque cross-DB)
}

model envio_email {
  id              Int       @id @default(autoincrement())
  deudorId        Int
  empresaId       Int
  usuarioId       Int       // quien lo envió desde Gestión
  smtpId          Int       // ID de CuentaSMTP en Sender
  templateId      Int       // ID de TemplateEmail en Sender
  destinatarios   String    @db.Text   // CSV de emails
  asunto          String
  variables       Json      // mapa final aplicado (auto + overrides)
  archivosNombres Json      // ["factura.pdf", "extracto.xlsx"]
  senderReporteIds Json     // [123, 124] — IDs de ReporteEmail en Sender, uno por destinatario
  estado          String    @default("ENVIADO")  // 'ENVIADO' | 'ERROR'
  error           String?   @db.Text
  creadoAt        DateTime  @default(now())

  deudor          deudor    @relation(fields: [deudorId], references: [id])
  empresa         empresa   @relation(fields: [empresaId], references: [id])
  usuario         usuario   @relation(fields: [usuarioId], references: [id])

  @@index([deudorId, creadoAt])
  @@index([empresaId, creadoAt])
  @@map("EnvioEmail")
}
```

`prisma db push` cuando se implemente la Fase 2.

---

## 3. Foundation `internal-api` en Sender

### 3.1 Estructura

```
amsa-sender/backend/src/modules/internal-api/
├── internal-api.module.ts
├── guards/
│   └── internal-api-key.guard.ts
├── decorators/
│   └── internal-actor.decorator.ts          // @InternalActor() → { serviceUserId, keyId }
├── config/
│   └── internal-api.config.ts               // lee env, parsea keys con metadata
└── features/
    ├── email/
    │   ├── email.controller.ts              // /api/internal/email/*
    │   └── email.module.ts
    └── (futuro) reportes/ smtp/ listas/ ...
```

**Cómo "expandir":** agregar una carpeta nueva en `features/<nombre>/` con su controller + module, importarla en `InternalApiModule`. El guard y el prefix se heredan.

### 3.2 `InternalApiKeyGuard`

- Lee header `X-Internal-Api-Key`.
- Valida contra una lista en config (no una única clave — esto permite rotación y revocación granular).
- Cada key tiene metadata: `{ id, label, serviceUserId, scopes?: string[] }`. Por ahora `scopes` queda definido pero no enforced; arranca trust binario.
- Inyecta `request.internalActor = { keyId, serviceUserId, scopes }`.
- Loggea cada llamada con `keyId` (NO con la key cruda).

### 3.3 Config

Env:
```
INTERNAL_API_KEYS='[{"id":"gestion-prod","key":"REDACTED","label":"AMSA Gestion","serviceUserId":42,"scopes":["email:*"]}]'
```

Parseado al boot. Si está vacío o malformado, el módulo registra un warning y el guard rechaza todo.

### 3.4 Prefix global

Controller decorator: `@Controller('api/internal/email')`, etc.

Todo bajo `/api/internal/*` queda detrás del guard mediante:

```ts
// internal-api.module.ts
{
  provide: APP_GUARD,
  useClass: InternalApiKeyGuard,
}
```

…o (más limpio) aplicando `@UseGuards(InternalApiKeyGuard)` a nivel controller para no afectar el resto de la app.

**Decisión:** aplicar a nivel controller. Mantiene la API regular intacta.

### 3.5 Endpoints Fase 1 — sub-feature `email`

| Método | Ruta | Body / Query | Devuelve |
|---|---|---|---|
| `GET` | `/api/internal/email/smtps` | — | `[{ id, nombre, fromAddress, activo }]` |
| `GET` | `/api/internal/email/smtps/:id/templates` | — | `[{ id, nombre, asunto, variables: string[] }]` |
| `GET` | `/api/internal/email/templates/:id` | — | `{ id, nombre, asunto, bodyHtml, variables: string[] }` |
| `POST` | `/api/internal/email/manual/send` | multipart (ver §5) | `{ reportes: [{ destinatario, reporteId }] }` |
| `GET` | `/api/internal/email/reportes/:id` | — | `{ id, destinatario, estado, abierto, bounceTipo?, … }` |

El controller `manual/send` recibe los archivos con `FilesInterceptor`, arma el DTO, y delega a `manualEmailService.enviarManual(dto, internalActor.serviceUserId, archivos)`.

---

## 4. Gestión — módulo `email-sender`

### 4.1 Estructura

```
amsa-gestion/backend/src/modules/email-sender/
├── email-sender.module.ts
├── email-sender.controller.ts
├── email-sender.service.ts
├── sender-http.client.ts                 // axios + INTERNAL_API_KEY + base URL
├── variables-mapper.ts                   // template vars → deudor fields
└── dto/
    ├── preview-vars.dto.ts
    └── enviar-email.dto.ts
```

### 4.2 Config

```
SENDER_BASE_URL=http://localhost:3001
SENDER_INTERNAL_API_KEY=...   # la misma que Sender espera
```

`SenderHttpClient` setea `X-Internal-Api-Key` en cada request, maneja errores y timeouts.

### 4.3 Endpoints Gestión

| Método | Ruta | Auth / Permiso | Propósito |
|---|---|---|---|
| `GET` | `/email/empresa/:id/smtp` | `email.enviar` | Devuelve la SMTP asignada a la empresa |
| `GET` | `/email/empresa/:id/templates` | `email.enviar` | Lista templates de la SMTP de esa empresa |
| `GET` | `/email/templates/:id/preview` | `email.enviar` | Devuelve template completo (body + variables detectadas) |
| `POST` | `/email/deudores/:id/preview-vars` | `email.enviar` | Body: `{ templateId }` → `{ variables: { nombre, mapping } }` (auto-mapping) |
| `POST` | `/email/deudores/:id/enviar` | `email.enviar` | multipart, ver §5 |
| `GET` | `/email/deudores/:id/envios` | `email.enviar` | Listado de envíos del deudor |
| `GET` | `/email/envios/:id/estado` | `email.enviar` | Consulta Sender on-demand y refresca estado |
| `PUT` | `/empresas/:id/smtp` | `email.administrar` | Asigna SMTP a empresa |

### 4.4 Permisos

Agregar al catálogo (`auth/permisos-catalogo.ts` + `frontend/utils/permisosCatalogo.ts`):

- `email.enviar` — usuarios operativos pueden enviar.
- `email.administrar` — supervisores pueden asignar SMTP a empresa.

### 4.5 Auditoría

Nuevo `AuditModulo.EMAIL` y `AuditTipo.EMAIL_ENVIADO`. Anotar `POST /email/deudores/:id/enviar` con `@Audit`:
```ts
@Audit({
  modulo: AuditModulo.EMAIL,
  entidad: 'deudor',
  tipo: AuditTipo.EMAIL_ENVIADO,
  empresaId: (req) => /* derivar de deudor */,
  resumen: (req, res) => `Email enviado a ${dto.destinatarios.length} destinatarios usando template ${dto.templateId}`,
})
```

---

## 5. Contrato multipart de envío

`POST /api/internal/email/manual/send` (Sender) y `POST /email/deudores/:id/enviar` (Gestión) comparten formato:

**Campos form-data:**
- `smtpId` (number)
- `templateId` (number)
- `destinatarios` (string CSV o JSON array)
- `asunto` (string, opcional — default = asunto del template)
- `variables` (JSON string, `{ "nombre": "Juan", "monto_total": "$10.500" }`)
- `archivos` (file[], hasta 10, 10MB c/u)

Sender ya soporta esto vía `FilesInterceptor('archivos', 10, { limits: { fileSize: 10*1024*1024 } })`.

---

## 6. Variables — auto-mapping

### 6.1 Catálogo en Gestión

`backend/src/modules/email-sender/variables-mapper.ts`:

```ts
export const VARIABLE_CATALOG = {
  nombre: { synonyms: ['nombre', 'first_name', 'nombres'], resolve: (d) => d.nombre },
  apellido: { synonyms: ['apellido', 'last_name'], resolve: (d) => d.apellido },
  nombre_completo: { synonyms: ['nombre_completo', 'full_name'], resolve: (d) => `${d.nombre} ${d.apellido}`.trim() },
  documento: { synonyms: ['documento', 'dni', 'cuit'], resolve: (d) => d.documento },
  empresa: { synonyms: ['empresa', 'cliente'], resolve: (d) => d.empresa?.nombre },
  remesa: { synonyms: ['remesa'], resolve: (d) => d.remesa?.nombre },
  monto_total: { synonyms: ['monto_total', 'deuda_total', 'total'], resolve: (d) => fmtMoney(d.montoTotal) },
  deuda: { synonyms: ['deuda', 'saldo'], resolve: (d) => fmtMoney(d.deuda) },
  fecha_vencimiento: { synonyms: ['fecha_vencimiento', 'vto', 'vencimiento'], resolve: (d) => fmtDate(d.fechaVencimiento) },
  dias_mora: { synonyms: ['dias_mora', 'mora'], resolve: (d) => diasMora(d.fechaVencimiento) },
  estado_situacion: { synonyms: ['estado_situacion', 'situacion'], resolve: (d) => d.situacion?.descripcion },
  estado_gestion: { synonyms: ['estado_gestion', 'gestion'], resolve: (d) => d.ultimaGestion?.descripcion },
  motivo_no_pago: { synonyms: ['motivo_no_pago', 'motivo'], resolve: (d) => d.ultimoMotivo?.descripcion },
};
```

### 6.2 Fallback en `camposAdicionales`

Si una variable no matchea el catálogo, se busca por nombre normalizado en `deudor.camposAdicionales` (JSON). Si tampoco está, queda en `null` y el usuario lo completa manualmente.

### 6.3 Resolver

```ts
function autoMapearVariables(template: TemplatePreview, deudor: DeudorConRelaciones) {
  return template.variables.map(varName => {
    const entry = findInCatalog(varName) ?? findInCamposAdicionales(varName, deudor.camposAdicionales);
    return { variable: varName, valor: entry?.resolve(deudor) ?? null, origen: entry ? 'auto' : 'manual' };
  });
}
```

El frontend muestra cada variable con su valor sugerido, un toggle "auto / manual" y un input para sobrescribir.

---

## 7. Frontend (resumen)

- **Catálogo de permisos**: agregar sección "Email" con `email.enviar` y `email.administrar` en `frontend/src/utils/permisosCatalogo.ts`.
- **ABM Empresa**: nuevo selector "Cuenta SMTP" (carga `GET /email/smtp/all` desde Gestión que proxea al endpoint correspondiente de Sender). Gated por `email.administrar`.
- **Chip de email en contactos del deudor**: agregar ícono "Enviar email" (`<EmailOutlinedIcon>`) al lado del ícono de copiar. Click abre `<EnviarEmailDialog>`.
- **EnviarEmailDialog**:
  1. Step 1: selector de template (lista filtrada por la SMTP de la empresa del deudor; muestra preview del body al hover).
  2. Step 2: tabla de variables con auto-mapping editable.
  3. Step 3: destinatarios (checkboxes con todos los mails del deudor; por defecto el que se clickeó queda marcado), asunto (pre-llenado del template), adjuntos (drag&drop hasta 10).
  4. Botón "Enviar" → `POST /email/deudores/:id/enviar`. Toast de éxito/error.
- **Tab "Emails enviados" en ficha del deudor**: tabla de `envio_email` con columnas (fecha, asunto, destinatarios, estado). Botón "Refrescar estado" por fila → `GET /email/envios/:id/estado` (consulta Sender on-demand).

---

## 8. Plan por fases

### Fase 1 — Sender: foundation `internal-api` + sub-feature email
1. Crear módulo `internal-api` con guard, decorator, config.
2. Sub-feature `email` con los 5 endpoints (§3.5).
3. Crear service user `amsa-gestion@interno` (manualmente o seed idempotente).
4. Variable de entorno `INTERNAL_API_KEYS` documentada en `.env.example`.
5. Smoke test con curl + API key dummy.

### Fase 2 — Gestión backend
1. Schema: `empresa.cuentaSmtpId` + modelo `envio_email`. `prisma db push`.
2. Catálogo permisos + Audit tipo/modulo.
3. `email-sender.module` con `SenderHttpClient`, `VariablesMapper`, controller, service.
4. Endpoints (§4.3).
5. Tests E2E mínimos: preview-vars, enviar (mock Sender), listado.

### Fase 3 — Frontend
1. Permisos en catálogo.
2. Selector SMTP en ABM empresa.
3. Ícono en chip de email + `EnviarEmailDialog`.
4. Tab "Emails enviados" en ficha de deudor.
5. Smoke manual end-to-end con empresa real.

---

## 9. Decisiones cerradas (2026-05-12)

1. ✅ 1 SMTP por empresa (campo `cuentaSmtpId` en `empresa`).
2. ✅ Templates filtrados por SMTP (ya existe la relación en Sender).
3. ✅ Auto-mapping de variables con override manual.
4. ✅ Punto de entrada: ícono en chip de email.
5. ✅ Sin webhook — estado consultado on-demand.
6. ✅ Service user `amsa-gestion@interno` en Sender.
7. ✅ Permisos `email.enviar` + `email.administrar`.
8. ✅ Catálogo de variables fijo en Gestión + fallback a `camposAdicionales`.
9. ✅ **Foundation expandible**: módulo `internal-api` con sub-features, no endpoint ad-hoc. Guard, decorator y config preparados para crecer.

---

## 10. Cosas para no olvidar

- **Multipart pasa por dos saltos** (frontend → Gestión → Sender). Confirmar que `FilesInterceptor` + re-emisión con `form-data` no pierde nombre original ni mime.
- **Rate limit S2S**: hoy no, pero dejar el hook por config en el guard.
- **IP allowlist**: ídem. Variable opcional `INTERNAL_API_ALLOWED_IPS`.
- **Rotación de keys**: la config acepta múltiples keys con label/id justo para esto.
- **CORS**: la API interna NO debe estar expuesta al browser. Solo backend-to-backend. Asegurarse de no incluir `/api/internal/*` en la CORS allowlist de Sender.
- **Logging de keys**: NUNCA loggear la key cruda; sí el `keyId`.
- **Tests**: tests del guard con key válida, key inválida, key ausente, key con scope insuficiente (preparación).
