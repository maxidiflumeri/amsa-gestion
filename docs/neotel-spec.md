# Integración Neotel (Softphone WebRTC + CTI) — AMSA Gestión

**Proyecto:** AMSA Gestión (módulo de cobranzas)
**Módulos nuevos:**
- Backend: `neotel` (cliente HTTP wrapper + CTI + state cache), extensión de `realtime` (namespace `/neotel`).
- Frontend: feature `softphone` (UA WebRTC + panel del agente + dialer + indicador global).
- BullMQ: queue `neotel-events` (poller + consumer).
**Fecha:** 2026-05-13
**Estado:** Spec — pendiente de implementación
**Spec relacionadas:** `docs/NEOTEL_INTEGRATION_PLAN.md` (plan inicial), `docs/email-sender-spec.md` (patrón internal-api), `docs/timeline-spec.md` (formato), `docs/auditoria-spec.md` (auditoría)
**Documentación oficial Neotel API:** https://neotel-us.atlassian.net/wiki/spaces/NEOT/pages/6359422/Integraci+n+API — fuente de verdad para endpoints, parámetros, formato de respuesta y eventos `NeotelEvents`. Consultar antes/durante T3, T6 y T10.

---

## 0. Resumen ejecutivo

Reemplazar **completamente** el softphone **X-Lite** y la dependencia del panel supervisor externo de Neotel, embebiendo dentro de AMSA Gestión:

1. **Softphone WebRTC** (JsSIP) que registra la extensión SIP del agente contra Asterisk de Neotel por **SIP sobre WSS** y maneja el audio (RTP/SRTP) 100% en el browser.
2. **Wrapper de la API HTTP de Neotel** (`http://200.5.98.203/neoapi/webservice.asmx`) para operaciones de negocio: login/logout, asignación a campaña, estados del agente (descanso, administrativo, disponible), iniciar llamadas (Dial), transferencias, DTMF y disposición del contacto.
3. **Capa CTI** que sincroniza el estado real del agente y los eventos del marcador predictivo (incoming/answered/hangup/contact-assigned) con el frontend en tiempo real vía Socket.IO (`namespace /neotel`).

**Qué reemplaza**
- X-Lite (signaling + media + UI de llamada).
- Panel supervisor de Neotel para el agente operativo (login a campaña, cambio de estado).

**Qué queda fuera de scope (ver §7)**
- Grabaciones (start/stop sí; descarga/reproducción no en esta fase).
- Modo supervisor (escucha / susurro / irrupción).
- IVR, conferencias multipartito, screen recording.
- Modo preview/progressive del dialer (sólo predictivo + click-to-call manual saliente).

**Cómo se conecta con el resto de la plataforma**
- Reusa `realtime` (`RealtimeGateway` + JWT handshake) — se agrega el namespace `/neotel` y rooms `agente:<usuarioId>` y `supervisor:telefonia`.
- Reusa `notificaciones` para alertar al agente eventos persistidos (ej. llamada perdida).
- Auditoría: cada acción que cambia estado (login, pause, dial, hangup, transfer) emite un evento con `@Audit` para el módulo `transacciones`/auditoría existente.
- No requiere a AMSA Sender. Toda la integración es local entre Gestión y Neotel.

### 0.1 Clarificaciones para implementación (2026-05-13)

Tras revisión con el usuario, **T0 (Discovery) deja de ser bloqueante**. La integración se construye iterativamente con los datos que ya tenemos, y se escala a Neotel sólo si algún tramo se traba.

Datos confirmados por el usuario:
- **Una sola extensión SIP disponible para QA: `6001`** (mismas credenciales que usa X-Lite hoy). La concurrencia entre agentes / transferencias entre internos se valida cuando Neotel provisione una segunda extensión.
- **Campaña de prueba: `115`** (ya creada en Neotel y con el usuario 6001 asignado). Para el smoke test inicial, login + asignar a campaña 115 + realizar llamada.
- **Grabación: la gestiona Neotel a nivel campaña.** Si la campaña tiene grabación activa, todas las llamadas del agente asignado quedan grabadas automáticamente. Gestión **no controla** start/stop por llamada. Esto retira del scope cualquier botón "Grabar" en la UI (ver §7).
- **Resto de huecos del Discovery (formato exacto de `NeotelEvents`, codecs, STUN/TURN, lista de SUBTIPO_DESCANSO)**: se resuelven sobre la marcha probando contra el servidor real. Si algún parser falla, se ajusta en el momento.

---

## 1. Decisiones de diseño

### 1.1 Protocolo: **híbrido SIP/WSS + API HTTP de Neotel**

**Decisión:** WebRTC en el browser para audio/signaling SIP, **+** wrapper HTTP en backend para operaciones de negocio.

**Justificación:**
- El plan inicial ya descartó hacer SIP en el server (sección 2 del plan inicial). Confirmado: el audio (RTP) **debe** pasar peer-to-peer entre browser y Asterisk, no proxado por NestJS.
- La API ASMX de Neotel (`webservice.asmx`) es la **única fuente de verdad** para operaciones de campaña/estado/disposición. SIP solo no alcanza: los estados administrativos, asignación a campaña, y `UpdateContact` viven en la API HTTP.
- Backend hace de **proxy autenticado**: el frontend nunca habla directo con Neotel HTTP (las credenciales NEOTEL_* no salen del server).
- Eventos del dialer: **polling pull** desde backend (`NeotelEvents` cada 1.5s por sesión activa) hasta confirmar si Neotel soporta webhook push (pregunta 7 del plan). El consumer empuja por Socket.IO al agente.

**Implicancias:**
- El frontend habla dos canales distintos: **SIP/WSS directo a Asterisk** (audio) y **HTTPS al backend Gestión** (operaciones de negocio + socket de eventos CTI).
- El backend nunca recibe ni reenvía audio.

### 1.2 Librería WebRTC: **JsSIP 3.10+**

**Decisión:** **JsSIP**, no SIP.js ni sipML5.

**Justificación:**
- JsSIP está mantenida activamente, tiene los menores quirks contra Asterisk (`res_http_websocket` + `chan_pjsip`), API estable y soporte nativo de DTMF (INFO/RFC2833), HOLD, transfer (REFER), y reconexión.
- SIP.js es comparable pero su API es más prolija al precio de más boilerplate; no aporta features relevantes para este caso.
- sipML5 está abandonada (último release 2014).
- Tamaño: JsSIP `~120 KB minified`, aceptable para una app interna.
- Tipado: `@types/jssip` existe y está al día.

**Versión objetivo:** `jssip ^3.10.0` + `@types/jssip ^3.7.0`.

### 1.3 Autenticación y manejo de credenciales SIP

- **Credenciales del webservice ASMX** (USUARIO/CLAVE Neotel): en `.env` del backend (`NEOTEL_USER_DEFAULT`, `NEOTEL_PASS_DEFAULT`). Para multi-agente se guardan **por usuario** en tabla `AgenteTelefonia` (clave cifrada con `crypto.createCipheriv` AES-256-GCM usando `NEOTEL_ENC_KEY`). Nunca se loguean en plano; redactar en Winston.
- **Credenciales SIP** (extensión + clave SIP): también en `AgenteTelefonia`, cifradas. El backend las expone al frontend mediante un endpoint **efímero** `GET /neotel/sip-credentials` que devuelve un objeto **válido para una sesión** (incluye el host WSS + la clave SIP en claro), protegido por JWT + permiso `telefonia.usar`. Idealmente, el endpoint genera la respuesta solo después de que el usuario haya tocado "Conectar" (no en cada page-load).
- **Smoke test inicial** usa **un solo agente** (USUARIO=6001 / SIP=Externo6001). En implementación, se sembrarán los demás vía un script `seed-agentes-telefonia.ts`.

### 1.4 Dónde vive el estado del agente

**Triple capa** (cada una con un propósito):

| Capa | Qué guarda | TTL | Quién la consulta |
|---|---|---|---|
| **DB MySQL** (`SesionAgente`, `EstadoAgenteEvento`, `LlamadaNeotel`) | Histórico inmutable + métricas | Permanente | Reportes, dashboard supervisor, auditoría |
| **Redis** (`agente:<id>` hash) | Estado *actual* del agente: `estado`, `campañaActivaId`, `llamadaActivaId`, `usuarioNeotel`, `device`, `since`, `lastEventAt` | 30 min (refresh-on-write) | Socket.IO emit, dashboard supervisor en vivo |
| **Frontend Zustand** | Mirror del estado Redis para la UI del propio agente, + estado SIP local del UA (`registered`, `connecting`, `failed`) | sesión | Componentes React |

**Regla de oro:** la DB es SOR. Redis es cache derivada. Si Redis se vacía, se rehidrata desde DB + un `Position()` por agente activo.

### 1.5 Permisos nuevos

Se agregan al catálogo de permisos (`permisos catalog`):

| Permiso | Descripción |
|---|---|
| `telefonia.usar` | Habilita conectarse al softphone y operar llamadas. Es el permiso base que todo agente operativo debe tener. |
| `telefonia.click_to_call` | Permite iniciar llamadas salientes desde ficha de deudor. |
| `telefonia.supervisar` | Acceso al panel de supervisor (ver estado de todos los agentes en vivo). |
| `telefonia.admin` | Configurar credenciales SIP de otros usuarios, gestionar mapping campaña↔Gestión, gestionar motivos de pausa. |

Estos permisos se agregan al seed de permisos (idempotente). Quien hoy tenga rol "operador" → asignar `telefonia.usar` + `telefonia.click_to_call`. Quien tenga rol "supervisor" → adicionalmente `telefonia.supervisar`.

### 1.6 Eventos auditados

Cada operación que modifica estado emite un registro de auditoría (decorador `@Audit` existente). Los eventos auditados son:

- `telefonia.login` / `telefonia.logout`
- `telefonia.campaña.enter` / `telefonia.campaña.leave`
- `telefonia.estado.cambiar` (con `from`, `to`, `motivo`)
- `telefonia.llamada.iniciar` (saliente)
- `telefonia.llamada.atender` (entrante)
- `telefonia.llamada.colgar`
- `telefonia.llamada.transferir` (con destino)
- `telefonia.llamada.dtmf` (sin loguear los dígitos — sólo el evento)
- `telefonia.contacto.disposicion` (subcategoría + agenda + notas)

---

## 2. Contratos

### 2.1 Endpoints HTTP del backend Gestión

Todos bajo prefix `/neotel`. Todos protegidos con `JwtAuthGuard` + `@RequiredPermiso('telefonia.usar')` salvo donde se indique.

#### 2.1.1 Sesión

| Método | Ruta | Body / Query | Respuesta | Permiso |
|---|---|---|---|---|
| `POST` | `/sesion/login` | — | `{ sesionId: number, usuarioNeotel: string, device: string, conectado: true }` | `telefonia.usar` |
| `POST` | `/sesion/logout` | — | `{ ok: true }` | `telefonia.usar` |
| `GET` | `/sesion/actual` | — | `{ sesionId, estado, campañaActivaId, llamadaActivaId, since }` o `null` | `telefonia.usar` |
| `GET` | `/sip-credentials` | — | `{ wssUrl, sipUri, authUser, password, displayName, iceServers: [...] }` | `telefonia.usar` |

#### 2.1.2 Campañas

| Método | Ruta | Body | Respuesta | Permiso |
|---|---|---|---|---|
| `GET` | `/campañas` | — | `Campania[]` (las disponibles para el agente actual; ver §3) | `telefonia.usar` |
| `POST` | `/campañas/:id/asignar` | — | `{ ok: true, campañaActiva: {...} }` | `telefonia.usar` |
| `POST` | `/campañas/:id/desasignar` | — | `{ ok: true }` | `telefonia.usar` |

#### 2.1.3 Estado del agente

| Método | Ruta | Body | Respuesta | Permiso |
|---|---|---|---|---|
| `POST` | `/estado/disponible` | — | `{ estado: 'DISPONIBLE' }` | `telefonia.usar` |
| `POST` | `/estado/pausa` | `{ motivoId: number }` | `{ estado: 'EN_PAUSA', motivoId, motivoNombre }` | `telefonia.usar` |
| `POST` | `/estado/administrativo` | `{ activar: boolean }` | `{ estado: 'ADMINISTRATIVO' \| 'DISPONIBLE' }` | `telefonia.usar` |
| `GET` | `/estado/motivos-pausa` | — | `MotivoPausa[]` (configurados por admin, mapeados a `SUBTIPO_DESCANSO` de Neotel) | `telefonia.usar` |

#### 2.1.4 Llamada

| Método | Ruta | Body | Respuesta | Permiso |
|---|---|---|---|---|
| `POST` | `/llamada/saliente` | `{ telefono: string, deudorId?: number, contactoId?: number }` | `{ llamadaId: number }` | `telefonia.click_to_call` |
| `POST` | `/llamada/:id/colgar` | — | `{ ok: true }` | `telefonia.usar` |
| `POST` | `/llamada/:id/transferir/ciega` | `{ extension: string }` | `{ ok: true }` | `telefonia.usar` |
| `POST` | `/llamada/:id/transferir/asistida` | `{ extension: string }` | `{ ok: true, consulta: true }` | `telefonia.usar` |
| `POST` | `/llamada/:id/dtmf` | `{ digitos: string }` | `{ ok: true }` | `telefonia.usar` |
| `POST` | `/llamada/:id/grabacion/iniciar` | — | `{ ok: true }` | `telefonia.usar` |
| `POST` | `/llamada/:id/grabacion/detener` | — | `{ ok: true }` | `telefonia.usar` |
| `POST` | `/llamada/:id/disposicion` | `DisposicionDto` (subcategoría, notas, agenda opcional) | `{ ok: true }` | `telefonia.usar` |
| `GET` | `/llamada/historial` | `?deudorId&page&size` | `LlamadaNeotel[]` paginado | `deudores.ver` |

#### 2.1.5 Supervisor (read-only en esta fase)

| Método | Ruta | Body | Respuesta | Permiso |
|---|---|---|---|---|
| `GET` | `/supervisor/agentes` | — | `EstadoAgenteVivo[]` (de Redis) | `telefonia.supervisar` |
| `GET` | `/supervisor/llamadas-activas` | — | `LlamadaNeotel[]` (en curso) | `telefonia.supervisar` |

**Errores tipados (filtro global ya existente):**
- `400` validación DTO.
- `401` sin JWT.
- `403` sin permiso o sin sesión Neotel activa cuando se requiere.
- `404` recurso no existe (campaña, llamada).
- `409` conflicto de estado (ej. intentar `dial` sin estar DISPONIBLE; intentar `disposicion` de una llamada sin terminar).
- `502` Neotel ASMX devolvió error o timeout.
- `503` Redis caído (modo degradado: respuesta con header `X-Neotel-Degraded: true`).

### 2.2 Eventos Socket.IO (`namespace /neotel`)

**Handshake:** mismo JWT que `/rt`. Reusa lógica del `RealtimeGateway`.

**Rooms:**
- `agente:<usuarioId>` — eventos personales del agente.
- `supervisor:telefonia` — broadcast de cambios de cualquier agente, solo se une si `permisos.includes('telefonia.supervisar')`.

**Eventos emitidos servidor→cliente:**

| Evento | Payload | Cuándo |
|---|---|---|
| `sesion:abierta` | `{ sesionId, usuarioNeotel, device, since }` | Al completar `POST /sesion/login` |
| `sesion:cerrada` | `{ sesionId, motivo }` | Logout normal, expulsión por admin, o pérdida de WSS irrecuperable |
| `estado:cambio` | `{ estado, motivoId?, since, campañaActivaId? }` | Cada vez que cambia el estado (emit a `agente:<id>` y a `supervisor:telefonia`) |
| `campaña:entrada` | `{ campañaId, campañaNombre }` | Al ingresar a una campaña |
| `campaña:salida` | `{ campañaId }` | Al salir |
| `llamada:ringing` | `{ llamadaId, direccion, telefono, contactoData?: { deudorId, nombre, documento, base, idContactoNeotel } }` | Llamada entrante (predictivo o manual inbound) — del polling de NeotelEvents |
| `llamada:atendida` | `{ llamadaId, answeredAt }` | UA SIP confirmó answer o NeotelEvents reportó bridged |
| `llamada:terminada` | `{ llamadaId, endedAt, duracion, causa }` | Hangup confirmado |
| `llamada:transferida` | `{ llamadaId, destino, tipo: 'ciega' \| 'asistida' }` | Confirmación de transfer |
| `llamada:grabacion` | `{ llamadaId, estado: 'iniciada' \| 'detenida' }` | |
| `contacto:asignado` | `{ llamadaId, base, idContactoNeotel, deudorId? }` | Cuando el dialer bridgea con info del contacto |
| `error` | `{ codigo, mensaje, recoverable: boolean }` | Cualquier error que la UI debe mostrar (Neotel timeout, ASMX 502, Asterisk WSS down, etc.) |

**Eventos cliente→servidor (subscribe):**
- `ping:agente` (sin payload) — usado para latencia y para refrescar TTL en Redis. Responde con `pong:agente` `{ serverTime }`.

### 2.3 Webhooks / CTI events desde Neotel

**Fase 1 (mandatorio):** polling. Backend tiene un `NeotelEventsPoller` (ver §4.2) que llama `NeotelEvents(eventInfo)` cada **1500ms** mientras haya **al menos un agente con sesión activa**. Si no hay sesiones, el poller queda dormido.

**Fase 1bis (si Neotel confirma push):** exponer `POST /neotel/webhook/event` con auth por API key (`X-Neotel-Webhook-Token`) y deshabilitar el poller. Mismo formato de evento parseado.

**Eventos esperados del dialer (a confirmar formato real con Neotel):**
- `RINGING_AGENT` — predictivo bridgea con agente. Contiene `usuario`, `base`, `idContacto`, `telefono`, opcionalmente `data`.
- `CALL_ANSWERED` — agente atendió.
- `CALL_HANGUP` — colgaron.
- `AGENT_STATE_CHANGED` — cambio externo (ej. supervisor lo pausó desde panel Neotel).
- `CAMPAIGN_CHANGED` — cambio externo de campaña.

Si el formato real es distinto, el parser (`neotel-event.parser.ts`) tiene una capa de mapeo extensible. **Bloqueante: pedir a Neotel un sample del XML/string que devuelve `NeotelEvents`** antes de implementar T6 (ver §6).

---

## 3. Schema Prisma

Convención del proyecto: nombres lowercase + `@@map("PascalCase")`, `npx prisma db push` (no migrations), `id` autoincrement, `createdAt`/`updatedAt`.

```prisma
// ─── Configuración por agente ────────────────────────────────────

model agente_telefonia {
  id                Int      @id @default(autoincrement())
  usuarioId         Int      @unique
  usuarioNeotel     String                // ej. "6001"
  claveNeotelEnc    String   @db.Text     // AES-256-GCM ciphertext + IV + tag
  device            String                // ej. "Externo6001"
  sipAuthUser       String                // ej. "Externo6001"
  sipPasswordEnc    String   @db.Text
  sipDisplayName    String?
  habilitado        Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  usuario           usuario  @relation(fields: [usuarioId], references: [id])
  sesiones          sesion_agente_neotel[]

  @@map("AgenteTelefonia")
}

// ─── Sesión del agente (login → logout) ──────────────────────────

model sesion_agente_neotel {
  id              Int       @id @default(autoincrement())
  agenteId        Int
  usuarioNeotel   String
  device          String
  loginAt         DateTime  @default(now())
  logoutAt        DateTime?
  ipCliente       String?
  userAgent       String?   @db.Text
  causaCierre     String?   // 'logout_manual' | 'expirado' | 'expulsado' | 'error_wss'
  agente          agente_telefonia @relation(fields: [agenteId], references: [id])
  campañasSesion  campaña_sesion_neotel[]
  estadosEventos  estado_agente_evento[]
  llamadas        llamada_neotel[]

  @@index([agenteId, loginAt])
  @@index([loginAt])
  @@map("SesionAgenteNeotel")
}

// ─── Campañas ────────────────────────────────────────────────────

model campaña_neotel {
  id                Int      @id @default(autoincrement())
  idNeotel          Int      @unique         // CAMPANA en Neotel
  nombre            String
  descripcion       String?
  empresaId         Int?                     // mapping opcional a empresa de Gestión
  activa            Boolean  @default(true)
  predictiva        Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  empresa           empresa? @relation(fields: [empresaId], references: [id])
  sesiones          campaña_sesion_neotel[]
  llamadas          llamada_neotel[]

  @@index([empresaId])
  @@map("CampaniaNeotel")
}

model campaña_sesion_neotel {
  id              Int      @id @default(autoincrement())
  sesionId        Int
  campañaId       Int
  enteredAt       DateTime @default(now())
  leftAt          DateTime?
  sesion          sesion_agente_neotel @relation(fields: [sesionId], references: [id])
  campaña         campaña_neotel       @relation(fields: [campañaId], references: [id])

  @@index([sesionId])
  @@index([campañaId, enteredAt])
  @@map("CampaniaSesionNeotel")
}

// ─── Estados del agente ──────────────────────────────────────────

model motivo_pausa_neotel {
  id                Int      @id @default(autoincrement())
  subtipoNeotel     Int      @unique         // SUBTIPO_DESCANSO en Neotel.Pause
  nombre            String                   // "Almuerzo", "Baño", "Capacitación", etc.
  descripcion       String?
  contabilizaProductivo Boolean @default(false)
  orden             Int      @default(0)
  activo            Boolean  @default(true)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  eventos           estado_agente_evento[]

  @@map("MotivoPausaNeotel")
}

model estado_agente_evento {
  id              Int       @id @default(autoincrement())
  sesionId        Int
  estado          String                     // 'DISPONIBLE' | 'EN_PAUSA' | 'ADMINISTRATIVO' | 'EN_LLAMADA' | 'WRAP_UP' | 'OFFLINE'
  motivoPausaId   Int?
  startedAt       DateTime  @default(now())
  endedAt         DateTime?
  duracionSeg     Int?                       // calculado al cerrar el evento
  origen          String                     // 'manual' | 'neotel_event' | 'sistema'
  sesion          sesion_agente_neotel @relation(fields: [sesionId], references: [id])
  motivoPausa     motivo_pausa_neotel? @relation(fields: [motivoPausaId], references: [id])

  @@index([sesionId, startedAt])
  @@index([estado, startedAt])
  @@map("EstadoAgenteEvento")
}

// ─── Llamadas ────────────────────────────────────────────────────

model llamada_neotel {
  id                Int       @id @default(autoincrement())
  sesionId          Int
  campañaId         Int?
  deudorId          Int?
  contactoId        Int?                     // FK a contacto si vino de click-to-call
  baseNeotel        Int?                     // BASE de Neotel (multi-base)
  idContactoNeotel  String?                  // IDCONTACTO de Neotel (string para tolerar long)
  direccion         String                   // 'INBOUND' | 'OUTBOUND'
  telefono          String
  estado            String                   // 'INICIADA' | 'RINGING' | 'EN_CURSO' | 'TERMINADA' | 'FALLIDA' | 'PERDIDA'
  ringedAt          DateTime?
  answeredAt        DateTime?
  endedAt           DateTime?
  duracionSeg       Int?
  causaFin          String?                  // 'normal' | 'agente_corto' | 'cliente_corto' | 'fallo_red' | 'transfer'
  grabacionRequerida Boolean @default(false)
  grabacionEstado   String?                  // 'iniciada' | 'detenida' | null
  recordingUrl      String?
  subcategoriaId    Int?                     // disposición final (FK a parametro)
  notas             String?   @db.Text
  rawDataNeotel     Json?                    // DATA crudo recibido en NeotelEvents
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  sesion            sesion_agente_neotel @relation(fields: [sesionId], references: [id])
  campaña           campaña_neotel? @relation(fields: [campañaId], references: [id])
  deudor            deudor? @relation(fields: [deudorId], references: [id])
  contacto          contacto? @relation(fields: [contactoId], references: [id])
  subcategoria      parametro? @relation("LlamadaSubcategoria", fields: [subcategoriaId], references: [id])
  callbackAgendado  callback_neotel?

  @@index([sesionId, createdAt])
  @@index([deudorId, createdAt])
  @@index([estado])
  @@index([campañaId, createdAt])
  @@map("LlamadaNeotel")
}

model callback_neotel {
  id              Int       @id @default(autoincrement())
  llamadaId       Int       @unique
  fechaAgenda     DateTime
  telefono        String
  usuarioAgendaId Int?
  llamada         llamada_neotel @relation(fields: [llamadaId], references: [id])
  usuarioAgenda   usuario? @relation(fields: [usuarioAgendaId], references: [id])

  @@index([fechaAgenda])
  @@map("CallbackNeotel")
}

// ─── Log crudo de eventos Neotel (auditoría / debug) ─────────────

model neotel_evento_log {
  id              BigInt    @id @default(autoincrement())
  sesionId        Int?
  usuarioNeotel   String?
  raw             String    @db.Text
  tipoParsed      String?
  llamadaId       Int?
  procesadoAt     DateTime  @default(now())
  errorParseo     String?

  @@index([sesionId, procesadoAt])
  @@index([procesadoAt])
  @@map("NeotelEventoLog")
}
```

**Cambios en modelos existentes:**
- `usuario` → agregar relación inversa `agenteTelefonia agente_telefonia?` y `callbacksAgendados callback_neotel[]`.
- `deudor` → agregar `llamadas llamada_neotel[]`.
- `contacto` → agregar `llamadas llamada_neotel[]`.
- `empresa` → agregar `campañasNeotel campaña_neotel[]`.
- `parametro` → agregar relación nombrada `llamadas llamada_neotel[] @relation("LlamadaSubcategoria")`. Existe ya un `tipo` para subcategorías; se reusa.

**Seeds nuevos (`seed-telefonia.ts`):**
- Permisos `telefonia.*`.
- `motivo_pausa_neotel` con los SUBTIPO_DESCANSO que use Ana Maya (pedir a Neotel; placeholder: 1=Almuerzo, 2=Baño, 3=Capacitación, 4=Reunión).
- `campaña_neotel` con `idNeotel=115` para smoke test.

---

## 4. Frontend

### 4.1 Estructura

```
frontend/src/
├── features/
│   └── softphone/
│       ├── components/
│       │   ├── SoftphonePanel.tsx           // panel persistente (footer fijo o sidebar derecha)
│       │   ├── AgentStateBar.tsx            // chip de estado + selector pausa/disponible/admin
│       │   ├── CampaignSelector.tsx         // dropdown campañas activas
│       │   ├── Dialer.tsx                   // teclado numérico + input + botón llamar
│       │   ├── ActiveCallCard.tsx           // info de llamada en curso + botones colgar/transfer/DTMF
│       │   ├── IncomingCallModal.tsx        // overlay al recibir llamada
│       │   ├── DeviceSelector.tsx           // dialog para elegir mic/speaker
│       │   ├── AudioLevelMeter.tsx          // VU meter input/output
│       │   ├── ConnectionBadge.tsx          // indicador WSS verde/amarillo/rojo
│       │   └── DispositionForm.tsx          // subcategoría + notas + callback opcional al cerrar llamada
│       ├── hooks/
│       │   ├── useSoftphone.ts              // wrapper de JsSIP UA — registra, eventos, dial, hangup, dtmf
│       │   ├── useEstadoAgente.ts           // estado actual + acciones (pausa, disponible, admin)
│       │   ├── useAudioDevices.ts           // enumerateDevices + setSinkId
│       │   ├── useNeotelSocket.ts           // socket.io client del namespace /neotel
│       │   └── useCallNotificationSound.ts  // ringtone polifónico via WebAudio
│       ├── stores/
│       │   └── softphone.store.ts           // Zustand: estado global softphone
│       ├── api/
│       │   └── neotel.api.ts                // axios → backend /neotel/*
│       ├── types/
│       │   └── softphone.types.ts
│       └── utils/
│           ├── jssip-config.ts              // builder de UA config a partir de sip-credentials
│           └── audio-graph.ts               // setup de AudioContext para VU meter y ringtone
├── pages/
│   └── supervisor/
│       └── SupervisorTelefoniaPage.tsx      // panel supervisor (read-only fase 1)
└── components/
    └── deudores/
        └── BotonLlamarContacto.tsx          // ícono "teléfono" al lado de cada chip de teléfono en la ficha
```

### 4.2 Componentes principales

**`SoftphonePanel`** (montado en `AppShell` cuando el usuario tiene `telefonia.usar`):
- Footer fijo de 64px de alto (toggle a 240px expandido).
- Contiene `ConnectionBadge`, `AgentStateBar`, `CampaignSelector`, `ActiveCallCard` (si hay llamada).
- Botón "Configurar audio" abre dialog `DeviceSelector`.
- Botón "Conectar / Desconectar" — al conectar pide permisos de micrófono **una vez** y dispara `POST /neotel/sesion/login` + JsSIP UA `start()`.

**`IncomingCallModal`** (renderizado por React Portal a nivel root):
- Aparece sobre cualquier pantalla cuando socket emite `llamada:ringing`.
- Auto-answer si la campaña activa es predictiva (`campaña.predictiva === true`) **y** el setting `autoAnswerPredictivo` está activo (default true).
- Si manual: botones "Atender" / "Rechazar".
- Reproduce ringtone (`useCallNotificationSound`).
- Si trae `contactoData.deudorId`, navega automáticamente a la ficha del deudor al atender (`useNavigate`).

**`ActiveCallCard`**:
- Timer de duración (mm:ss).
- Indicador de calidad (jitter, packet loss, RTT) — calculado vía `RTCPeerConnection.getStats()` cada 2s.
- Botones: Mute, Hold, DTMF (despliega DialPad inline), Transfer (popover con campo extensión + tipo), Grabar (toggle).
- Botón rojo "Colgar".

**`DispositionForm`** (modal al terminar la llamada):
- Subcategoría (`parametro` con `tipo='subcategoriaLlamada'`).
- Notas (text area).
- Checkbox "Agendar callback" → fecha+hora + teléfono.
- Submit → `POST /neotel/llamada/:id/disposicion` (también dispara `UpdateContact` en backend).

**`BotonLlamarContacto`**:
- Aparece al lado de cada chip de teléfono en la ficha de deudor.
- Visible solo si `permisos.includes('telefonia.click_to_call')`.
- Click → `POST /neotel/llamada/saliente` con `{ telefono, deudorId, contactoId }`. La llamada saliente la maneja Neotel (Dial) que después bridgea por SIP al agente → JsSIP recibe `newRTCSession` outbound.

### 4.3 Hooks clave

**`useSoftphone()`** devuelve:
```ts
{
  ua: JsSIP.UA | null;
  status: 'idle' | 'connecting' | 'registered' | 'failed';
  activeSession: JsSIP.RTCSession | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  answer(): void;
  hangup(): void;
  sendDtmf(digits: string): void;
  mute(state: boolean): void;
  hold(state: boolean): void;
  stats: { jitter: number; packetLoss: number; rtt: number } | null;
}
```

Internamente:
- Llama `GET /neotel/sip-credentials` para obtener config.
- Construye `JsSIP.UA` con `sockets: [new JsSIP.WebSocketInterface(wssUrl)]`, `uri`, `password`, `display_name`.
- Suscribe `registered`, `unregistered`, `registrationFailed`, `newRTCSession`.
- Cada `newRTCSession` se guarda en estado y se conecta su `peerconnection.addEventListener('track')` a un `<audio>` oculto a nivel root.
- Reconexión: si `disconnected` y status fue `registered`, retry con backoff (1s, 2s, 5s, 10s, 30s max).

**`useEstadoAgente()`** — wrapper sobre la API + socket. Devuelve estado actual y `setEstado(estado, motivoId?)`.

**`useNeotelSocket()`** — singleton socket.io para `/neotel`. Reusa el JWT del context. Emite `ping:agente` cada 25s para refrescar TTL de Redis.

### 4.4 Integración con `SocketContext`

`SocketContext` ya provee la conexión a `/rt`. Se agrega un segundo socket dedicado a `/neotel` para aislar el tráfico CTI (alta frecuencia) del tráfico de notificaciones generales. El context expone ambos:
```ts
{ rt: Socket, neotel: Socket | null }   // neotel solo si user tiene telefonia.usar
```

### 4.5 Manejo de permisos de micrófono

- Al primer `connect()`, llamar `navigator.mediaDevices.getUserMedia({ audio: true })`.
- Si el usuario rechaza: mostrar `Alert` en `SoftphonePanel` con instrucciones para habilitar y botón "Reintentar".
- Si el usuario revoca después: detectar vía `navigator.permissions.query({ name: 'microphone' })` → cambiar estado del UA a `failed` y mostrar el mismo alert.

### 4.6 Dark/light mode

Todos los componentes usan `useTheme()` y referencias semánticas (`theme.palette.primary.main`, `theme.palette.error.main`, etc.). Sin colores hardcodeados. El VU meter usa gradiente derivado del tema. Los chips de estado usan colores semánticos:
- `DISPONIBLE` → `success`
- `EN_PAUSA` → `warning`
- `ADMINISTRATIVO` → `info`
- `EN_LLAMADA` → `primary`
- `WRAP_UP` → `secondary`
- `OFFLINE` → `default`

---

## 5. Smoke test plan (con credenciales reales)

> Credenciales: ver `docs/NEOTEL_INTEGRATION_PLAN.md` §10 (USUARIO=6001, SIP=Externo6001, Campaña=115, Domain=200.5.98.203 ó 190.210.25.141). En implementación se cargan en `.env` (`NEOTEL_SMOKE_USUARIO`, `NEOTEL_SMOKE_CLAVE`, `NEOTEL_SMOKE_SIP`, `NEOTEL_SMOKE_SIP_CLAVE`, `NEOTEL_WSS_HOST`) y se siembran en `agente_telefonia` para un usuario de prueba `qa-telefonia@amsa.local`.

### 5.1 PoC stand-alone WSS (T1)
**Pre:** confirmar con Neotel que `wss://200.5.98.203:8089/ws` (o `190.210.25.141`) está accesible y el cert TLS es válido (o aceptar excepción en Chrome al primer load).

1. Levantar una página HTML stand-alone (`varios/poc-neotel.html`) con JsSIP CDN.
2. Configurar UA con: URI `Externo6001@200.5.98.203`, password `Externo6001`, WSS URL `wss://200.5.98.203:8089/ws`.
3. `ua.start()` → esperar evento `registered`.
4. Desde un teléfono externo o desde el panel Neotel, llamar a la extensión `Externo6001`.
5. Confirmar audio bidireccional limpio (operador escucha y es escuchado).
6. Probar `ua.call('5491140404040', { mediaConstraints: { audio: true, video: false } })` para una llamada saliente de prueba.

**Gate:** si falla audio bidireccional, **no avanzar**. Debug:
- ¿WSS connect failed? → revisar cert TLS / firewall / puerto 8089.
- ¿Registered pero no llega RTP? → STUN/TURN faltante o NAT/firewall bloqueando puertos UDP altos.
- ¿RTP llega pero audio entrecortado? → codec mismatch; forzar Opus en SDP.

### 5.2 Login + campaña vía API (T3)
1. Backend levantado con `.env` de smoke test.
2. `POST /neotel/sesion/login` desde Bruno/Postman con JWT de `qa-telefonia@amsa.local`.
3. Verificar:
   - DB: nuevo `sesion_agente_neotel` con `usuarioNeotel=6001`.
   - Redis: hash `agente:<id>` con `estado=OFFLINE` (todavía no marcamos disponible).
   - Socket `/neotel` (cliente de prueba con `wscat`): recibe `sesion:abierta`.
4. `POST /neotel/campañas/115/asignar`.
5. Verificar en el panel web de Neotel que el agente 6001 figura logueado en campaña 115.
6. `POST /neotel/estado/disponible`.
7. Verificar evento `estado:cambio` por socket + estado en Redis.

### 5.3 Llamada predictiva entrante (T6 + T7)
1. Con la sesión del paso 5.2 abierta, además abrir el frontend con el usuario `qa-telefonia`.
2. Conectar el softphone (`SoftphonePanel.Conectar`).
3. Esperar que el dialer marque y bridgee (en horario de campaña con padrón cargado).
4. Cuando JsSIP recibe `newRTCSession` inbound:
   - Auto-answer (campaña predictiva).
   - Confirmar audio bidireccional.
5. Verificar paralelamente:
   - Backend recibe `RINGING_AGENT` vía polling, persiste `llamada_neotel` en `RINGING`.
   - Socket emite `llamada:ringing` con `contactoData`.
   - Si el contacto matchea con un `deudor` en Gestión por documento, `contactoData.deudorId` está poblado y el frontend navega a la ficha.
6. Conversar 30 segundos. Probar mute, DTMF (`1234`), hold.
7. Colgar desde el frontend (`hangup`) → backend ejecuta `Neotel.Hangup(6001)`.
8. Validar:
   - DB: `llamada_neotel` en `TERMINADA` con `duracionSeg` correcta.
   - Socket: `llamada:terminada`.
   - UI: aparece `DispositionForm`.
9. Llenar disposición → `POST /neotel/llamada/:id/disposicion` → backend ejecuta `Neotel.UpdateContact` con subcategoría + notas + agenda.
10. Verificar en panel Neotel que el contacto quedó cerrado con la subcategoría correcta.

### 5.4 Llamada saliente click-to-call
1. Desde la ficha de deudor (que tenga al menos un contacto de tipo `teléfono`), click en `BotonLlamarContacto`.
2. Backend ejecuta `Neotel.Dial(6001, '1140404040')`.
3. Neotel bridgea: JsSIP recibe `newRTCSession` outbound.
4. Conversar y colgar como en 5.3.

### 5.5 Cambio de estado y reflejo en panel Neotel
1. Click "Pausa" → seleccionar motivo "Almuerzo".
2. Backend ejecuta `Neotel.Pause(6001, 1)`.
3. Verificar en panel Neotel: agente en pausa con motivo correcto.
4. Click "Disponible" → `Neotel.Unpause(6001)` → panel Neotel: agente disponible.
5. Click "Administrativo" → `Neotel.Tiempo_Administrativo(6001, true)`.
6. Toggle off → `Neotel.Tiempo_Administrativo(6001, false)`.

### 5.6 Auditoría
1. Después de los pasos 5.2-5.5, consultar `GET /auditoria?usuario=qa-telefonia&desde=...`.
2. Verificar al menos: `telefonia.login`, `telefonia.campaña.enter`, `telefonia.estado.cambiar` (varias), `telefonia.llamada.atender`, `telefonia.llamada.colgar`, `telefonia.contacto.disposicion`.
3. Cada uno debe tener IP cliente + UA + payload sanitizado (sin CLAVE en claro).

### 5.7 Failover: caída de WSS
1. Durante una llamada activa, deshabilitar la red (devtools → throttling Offline) por 20s.
2. Verificar:
   - UA pasa a `disconnected`, intenta reconectar con backoff.
   - Socket `/neotel` emite `error` con `recoverable: true`.
   - UI muestra banner amarillo "Reconectando…".
3. Restaurar red → UA `registered` de nuevo → banner desaparece.
4. **Nota:** la llamada en curso al momento del corte se pierde (sin sustento de SIP RFC para resume cross-disconnect). El sistema marca esa `llamada_neotel` como `FALLIDA` con `causaFin=fallo_red`.

### 5.8 Logout
1. `POST /neotel/sesion/logout`.
2. Verificar: `Neotel.Logout(6001)`, `sesion_agente_neotel.logoutAt` poblado, Redis `agente:<id>` borrado, socket `sesion:cerrada`.

---

## 6. Fases de implementación

> Convención: **T1, T2…** son tareas independientes (cuando se indica). Pueden ser asignadas al implementer una por una. `→` indica dependencia bloqueante.

### Bloque A — Discovery (iterativo, NO bloqueante — ver §0.1)
**T0 — Discovery iterativo** *(deferido al momento de cada tramo)*
- Decisión del usuario (2026-05-13): no esperamos respuesta formal de Neotel para empezar. Cada tramo (T6 parser, T10 WSS, T11 codecs) descubre y ajusta contra el servidor real.
- Si algún tramo se traba (ej: formato de `NeotelEvents` no se puede inferir, WSS rechaza handshake, codec no soportado), recién ahí se escala a Neotel.
- **Output diferido:** `docs/neotel-discovery.md` se va llenando con hallazgos durante T1, T6 y T10. No es prerrequisito.

### Bloque B — Cimientos backend (paralelizable en orden parcial)

**T1 — PoC JsSIP stand-alone** (independiente)
- HTML en `varios/poc-neotel.html`.
- Confirma audio bidireccional con la extensión 6001.
- **Gate del proyecto.** Si falla, escalar a Neotel.

**T2 — Schema Prisma + seeds** (independiente, puede ir en paralelo con T1)
- Agregar modelos del §3 a `schema.prisma`.
- `npx prisma db push`.
- `seed-telefonia.ts` con permisos, motivos de pausa placeholder, campaña 115.
- Asignar permisos `telefonia.usar` + `telefonia.click_to_call` a roles existentes (operador) y `telefonia.supervisar` a rol supervisor.

**T3 — Módulo `neotel` backend: cliente HTTP** (depende de T2)
- Estructura `src/modules/neotel/{neotel.module.ts, services/neotel-http.client.ts, parsers/, dtos/, errors/}`.
- `NeotelHttpClient` con `call<T>()`, retry, redacción de logs, parser XML.
- Métodos públicos para todos los endpoints de §4.1-4.4 + 4.7 del plan inicial.
- Tests unitarios con `nock` o mocks de `fetch`: happy + error por método.

**T4 — Servicio de credenciales cifradas** (depende de T2)
- `AgenteTelefoniaService` con `getCredencialesParaUsuario(userId)` → descifra AES-256-GCM.
- Endpoint `GET /neotel/sip-credentials` que devuelve config para JsSIP.
- CRUD admin: `POST /neotel/admin/agentes` (permiso `telefonia.admin`).

**T5 — Sesión + estado del agente** (depende de T3, T4)
- `SesionAgenteService` con `iniciar(userId)`, `cerrar(sesionId)`, `getActiva(userId)`.
- `EstadoAgenteService` con `cambiarEstado(sesionId, nuevoEstado, motivoId?, origen)`.
- Redis client: `RedisAgenteCache` (usa BullMQ Redis connection existente).
- Endpoints `/neotel/sesion/*`, `/neotel/estado/*`, `/neotel/campañas/*`.
- Auditoría con `@Audit('telefonia.*')`.

### Bloque C — Eventos en tiempo real

**T6 — NeotelEvents poller + parser** (depende de T3, T5 — el formato de `NeotelEvents` se descubre acá probando contra Neotel real)
- BullMQ repeating job `neotel-events-poll` (intervalo 1500ms).
- Para cada `sesion_agente_neotel` con `logoutAt = null`, ejecutar `NeotelEvents(eventInfo)`.
- Parser extensible en `src/modules/neotel/parsers/neotel-event.parser.ts` que mapea raw → `NeotelEventoParsed` con `tipo`, `sesionId`, `payload`.
- Persistencia en `neotel_evento_log` (raw + parsed + error si falla).
- Encolar a queue `neotel-events-process`.

**T7 — Consumer de eventos + emit socket** (depende de T6)
- Worker BullMQ `NeotelEventsProcessor`.
- Por cada evento:
  - Resolver sesión + agente.
  - Si es `RINGING_AGENT`: crear `llamada_neotel` en estado `RINGING`, resolver `deudorId` si BASE/IDCONTACTO matchean, emit `llamada:ringing`.
  - Si es `CALL_ANSWERED`: actualizar llamada, emit `llamada:atendida`.
  - Si es `CALL_HANGUP`: cerrar llamada (`endedAt`, `duracionSeg`, `causaFin`), emit `llamada:terminada`.
  - Si es `AGENT_STATE_CHANGED`: cerrar evento actual en `estado_agente_evento`, abrir uno nuevo, emit `estado:cambio`.
- Idempotencia: si el evento ya fue procesado (dedup key = `usuario + tipo + timestamp` o ID provisto por Neotel), skip.

**T8 — Gateway Socket.IO `/neotel`** (depende de T5)
- Extensión de `realtime.module.ts` con un segundo gateway (`NeotelGateway`) reusando la misma lógica de JWT.
- Rooms `agente:<usuarioId>` y `supervisor:telefonia` según permisos.
- Handler `ping:agente` → `pong:agente` + refresh TTL Redis.

### Bloque D — Frontend (puede empezar en paralelo a Bloque C cuando T5 esté)

**T9 — Esqueleto feature `softphone` + tipos + store** (depende de T5)
- Estructura de carpetas §4.1.
- Tipos `softphone.types.ts`, `softphone.store.ts` (Zustand).
- API client `neotel.api.ts`.

**T10 — `useSoftphone` + `SoftphonePanel` mínimo** (depende de T9, T1, T4)
- Hook con JsSIP, fetch de credenciales, connect/disconnect.
- Panel con `ConnectionBadge`, botón Conectar, audio element oculto para inbound.

**T11 — Selector de dispositivos + VU meter** (depende de T10)
- `DeviceSelector`, `AudioLevelMeter`, `useAudioDevices`.

**T12 — Estado del agente + campañas en UI** (depende de T10, T5)
- `AgentStateBar`, `CampaignSelector`.

**T13 — Llamada entrante + auto-answer** (depende de T10, T7, T8)
- `IncomingCallModal`, `useNeotelSocket`, `useCallNotificationSound`.
- Auto-answer en campañas predictivas.

**T14 — Llamada en curso + controles** (depende de T13)
- `ActiveCallCard` con Mute, Hold, DTMF, Transfer, Grabar.
- Stats RTC.

**T15 — Click-to-call desde ficha** (depende de T14)
- `BotonLlamarContacto` integrado en chips de teléfono.
- Endpoint `POST /neotel/llamada/saliente`.

**T16 — Disposición de llamada** (depende de T14)
- `DispositionForm`, `POST /neotel/llamada/:id/disposicion`.
- Carga de subcategorías desde `parametro`.

**T17 — Panel supervisor read-only** (depende de T8)
- `pages/supervisor/SupervisorTelefoniaPage.tsx`.
- Lista de agentes en vivo + sus estados, suscrito a `supervisor:telefonia`.

### Bloque E — Hardening (al final)

**T18 — Reconexión WSS robusta + modo degradado** (depende de T10)
- Backoff exponencial, banner UI, marcado de llamadas `FALLIDA` por `fallo_red`.

**T19 — Métricas de calidad RTC** (depende de T14)
- `getStats()` cada 2s → store → UI + log periódico.

**T20 — Webhook push (si Neotel lo confirma)** (depende de T7)
- `POST /neotel/webhook/event` con guard de token.
- Feature flag `NEOTEL_USE_PUSH` para alternar poller↔webhook.

### Dependencias resumidas

```
T0 ──┐
     ├─→ T6 → T7 ─┐
T1 ──┘            ├─→ T13 → T14 → T15, T16
T2 → T3 → T5 → T8┘                    │
        T4 ──────→ T10 → T11, T12 ────┘
                        ↓
                   T17 (depende de T8)
                        ↓
                   T18, T19, T20 (hardening)
```

**Pueden ir en paralelo:**
- T1 ↔ T2 ↔ T0.
- T3 ↔ T4 una vez T2 terminado.
- T9 mientras se hace T5.
- T11 ↔ T12 ↔ T13 después de T10.

**Orden estricto obligatorio:**
- T0 antes que T6.
- T1 antes que T10.
- T5 antes que T6, T7, T8.
- T7 + T8 antes que T13.

---

## 7. Out of scope / deferred

| Feature | Razón | Cuándo |
|---|---|---|
| Grabación: descarga/reproducción en UI | API ASMX expone `Iniciar_Grabacion`/`Detener_Grabacion` pero no URL pública confiable. Pedir a Neotel mecanismo de delivery (S3, link firmado, etc.). | Fase 2 |
| Supervisor escucha-susurro-irrupción | Requiere `StartMonitor` + manejo de un segundo canal SIP de monitoreo. Complejidad alta para fase 1. | Fase 2 |
| Conferencias multipartito | Endpoints `JoinConference`, `InviteParticipant`, etc. No es flujo cotidiano de cobranzas. | Fase 3+ |
| IVR / Auto-attendant | No es responsabilidad de Gestión; lo configura Neotel. | Nunca |
| Grabación de pantalla del agente (`Screen*`) | Compliance, no requerido hoy. | Fase 3+ si compliance lo pide |
| Modo preview / progressive del dialer | Hoy es 100% predictivo. UX cambia drásticamente. | Cuando Ana Maya lo pida |
| Multi-base (`BASE` parameter) | Asumimos `BASE=1` único. Si Neotel usa múltiples bases por campaña, agregar columna `baseNeotel` ya está, falta UI de mapping. | Cuando aparezca |
| Métricas agregadas (dashboard productividad) | Reusa módulo `dashboards`/`reportes-dynamic` — fuera de scope de telefonía. | Cuando esté la data poblada |
| Reconexión "in-call" con re-INVITE | SIP RFC permite re-INVITE pero JsSIP no lo expone trivialmente; con NAT pierde de todas formas. | Si métrica de pérdida >2% |

---

## 8. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Asterisk de Neotel sin `res_http_websocket` habilitado | Media | **Crítico** | T0 lo confirma antes de codear. Si no es viable: Kamailio gateway propio en EC2 que termine WSS y lo reenvíe como SIP a Neotel. |
| Cert TLS del WSS self-signed | Media | Alto | Pedir cert válido CA a Neotel. Fallback: distribuir cert por GPO en estaciones, o aceptar excepción en Chrome (UX pésima). |
| Límite de canales SIP simultáneos en la cuenta de Neotel | Alta | Alto | Conocer límite contratado. Liberar sesiones zombi (cleanup job: cualquier `sesion_agente_neotel` sin actividad >30 min → `cerrar`). |
| NAT/STUN/TURN — audio entrecortado o sin RTP | Alta | Alto | Pedir STUN/TURN a Neotel. Si no provee: levantar `coturn` propio en EC2 + configurar en JsSIP `iceServers`. |
| Codec mismatch (Neotel solo G.729) | Baja | **Crítico** | T1 lo descubre. Pedir habilitar Opus o PCMA en el peer config de la cuenta. |
| Formato real de `NeotelEvents` distinto al asumido | Alta | Alto | T0 obtiene sample. Parser modular permite mapping pluggable. Plan B: complementar con polling de `Position` cada 1s + estado SIP local del UA. |
| Compatibilidad de navegadores | Baja (Chrome target) | Medio | Target oficial: Chrome ≥ 110 y Edge ≥ 110. Firefox best-effort (sin `setSinkId` en algunos casos). Safari NO soportado en fase 1. |
| Pérdida de WSS durante llamada predictiva | Alta | Alto | Marcar llamada como `FALLIDA`, banner UI, reconexión con backoff. Métrica de calidad. Si tasa >1% → STUN/TURN dedicado. |
| CORS al llamar a la API ASMX desde el frontend | N/A | N/A | No aplica: el frontend nunca llama directo a Neotel HTTP. Sí hay CORS para WSS (mismo origen no aplica a WebSocket, pero verificar `Origin` aceptado por Asterisk). |
| Credenciales SIP filtradas en logs | Media | Crítico | Redacción explícita en `NeotelHttpClient.redactSensitive()` + lint rule `no-restricted-syntax` para detectar `console.log` (ya prohibido por convención del repo). |
| Race condition: agente en estado inconsistente entre Redis, DB y Neotel | Media | Medio | DB es SOR; cualquier cambio se persiste antes de Redis y antes del emit. Job de reconciliación cada 5 min: `Position()` por agente activo y comparar contra cache. |
| Auto-answer dispara llamada antes de que el agente esté listo | Baja | Medio | Auto-answer solo si `estado === DISPONIBLE` Y `softphone.status === registered`. Si no, rechazar `newRTCSession` y emit error. |
| Migración paralela con X-Lite (operadores con ambos abiertos) | Alta | Alto | En piloto: regla manual "uno u otro". Backend detecta doble login: si la extensión ya está registrada (otro UA con misma URI), rechazar nueva sesión Gestión con error claro. |
| Dependencia de un solo proveedor (Neotel) | Permanente | Permanente | No mitigable a nivel software. Diseñar abstracción `TelefoniaProvider` interface para que cambiar a otro PBX requiera reimplementar solo el adaptador. |

---

**Fin del spec.** Cualquier ambigüedad pendiente queda como `// TODO: confirmar con Neotel` en el código durante implementación; nunca como suposición silenciosa.
