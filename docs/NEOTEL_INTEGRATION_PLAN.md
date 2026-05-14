# Plan de Integración Neotel → AMSA Gestión (AMSA Cobranzas)

> **Objetivo:** reemplazar completamente XLite como softphone de los operadores de Ana Maya SA, integrando todas las funcionalidades de telefonía (audio, registro de estado, gestión de campañas, llamadas inbound/outbound, grabación, transferencias, etc.) dentro de la aplicación web AMSA Gestión.

> **Stack destino:** NestJS + TypeScript + Prisma + MySQL (backend) / React + Vite + MUI v5 (frontend) / BullMQ + Redis (jobs y estado) / Socket.io (push real-time) / Winston (logging — nunca `console.log`).

---

## 1. Contexto

### Estado actual
- Operadores usan **XLite** (softphone SIP de CounterPath) para:
  - Registrar extensión SIP contra el Asterisk de Neotel
  - Recibir/emitir audio (RTP)
  - Loguearse a campañas (vía botones de XLite que pegan al webservice de Neotel)
  - Cambiar estados (disponible, en pausa, descanso, etc.)
  - Atender llamadas predictivas (el dialer llama al agente y bridgea con el contacto)
- En paralelo, los operadores usan **AMSA Gestión** (CRM en migración desde FoxPro) para gestionar la información de los contactos.
- La gestión queda **partida en dos aplicaciones distintas**, con doble login, doble UX, y problemas de sincronización.

### Objetivo final
Una **sola aplicación web** (AMSA Gestión, módulo de cobranzas / AMSA Cobranzas) que:
1. Maneje el softphone embebido (WebRTC) — audio en el browser.
2. Maneje la sesión completa del agente contra Neotel — login, campañas, estados.
3. Sincronice los eventos del dialer con la UI del CRM en tiempo real.
4. Persista todo lo relevante en la base local (AMSA Cobranzas).

### Beneficios esperados
- Eliminar instalación/mantenimiento de XLite en cada PC operadora.
- UX unificada: el operador ve la ficha del contacto + el control de llamada en una sola pantalla.
- Eliminar audífonos/configs duplicadas, reducir errores de operador.
- Telemetría centralizada (cuánto tiempo en cada estado, calidad de audio, etc.).
- Habilitar trabajo remoto sin VPN si el WSS es accesible.

---

## 2. Arquitectura de la solución

El problema tiene **dos capas que XLite hoy concentra en una sola aplicación**. Hay que separarlas mentalmente porque viven en mundos distintos:

```
┌──────────────────────────────────────────────────────────────────┐
│  AMSA GESTIÓN (browser - React)                                  │
│  ┌──────────────────────────┐   ┌─────────────────────────────┐  │
│  │  CAPA AUDIO/MEDIA        │   │  CAPA UI/CRM                │  │
│  │  • JsSIP                 │   │  • Login agente             │  │
│  │  • WebRTC nativo browser │   │  • Selección de campaña     │  │
│  │  • Captura mic           │   │  • Ficha contacto activo    │  │
│  │  • Output speaker        │   │  • Botones estado           │  │
│  │  • Codecs: opus/PCMA     │   │  • Historial llamadas       │  │
│  │  • DTMF in-call          │   │  • Form de subcategorías    │  │
│  └────────────┬─────────────┘   └──────────────┬──────────────┘  │
│               │ SIP over WSS                   │ REST/WS         │
│               │ (signaling) + RTP              │                 │
└───────────────┼────────────────────────────────┼─────────────────┘
                │                                │
                │ WebSocket Secure (wss://)      │ HTTPS + Socket.io
                │ port 8089 (Asterisk default)   │
                │                                │
                ▼                                ▼
┌─────────────────────────────────┐  ┌──────────────────────────────┐
│  ASTERISK (Neotel)              │  │  BACKEND NestJS              │
│  • PJSIP / chan_sip             │  │  • NeotelModule (proxy SOAP) │
│  • res_http_websocket           │  │  • EventsModule (polling)    │
│  • RTP relay                    │  │  • AgentStateService (Redis) │
│  • Predictive dialer            │  │  • Socket.io gateway         │
└─────────────┬───────────────────┘  └──────────┬───────────────────┘
              │                                 │
              │                                 │ HTTP GET/POST
              │                                 │ x-www-form-urlencoded
              │                                 ▼
              │                       ┌──────────────────────────────┐
              │                       │ NEOTEL WEBSERVICE            │
              │                       │ http://200.5.98.203/neoapi/  │
              │                       │ webservice.asmx              │
              │                       │ (ASP.NET ASMX)               │
              │                       └──────────────────────────────┘
              │                                  ▲
              │                                  │
              └──────────────────────────────────┘
                  Asterisk emite eventos AMI/ARI internamente
                  que terminan en la tabla que sirve NeotelEvents
```

### Por qué WebRTC en el browser y NO SIP en el server

Tentación: usar `drachtio` o `node-sip` en NestJS para registrar las extensiones. **Es un antipatrón** para softphones de agentes porque:
- El audio (RTP) pasa por el server → latencia, jitter, consumo CPU/red brutal.
- Te perdés todo el procesamiento nativo de WebRTC (AEC, AGC, NS).
- Cada agente sería un cliente SIP separado del backend — escalado complejo.
- Imposible aprovechar el micrófono/parlante seleccionados del operador.

**Lo correcto:** que cada browser sea su propio softphone WebRTC. El backend se ocupa solo de la capa de negocio (la API de Neotel).

---

## 3. Preguntas críticas a confirmar con Neotel ANTES de empezar a codear

Estas preguntas son **bloqueantes**. Hay que mandar este bloque al soporte de Neotel y esperar respuesta:

1. **¿Asterisk tiene `res_http_websocket` y transport WSS habilitado?**
   - Si NO: ¿pueden habilitarlo? (es estándar en Asterisk 13+, no debería ser un problema)
   - Si NO se puede: hay que evaluar una alternativa con Kamailio/FreeSWITCH como gateway WSS→SIP.

2. **¿Cuál es el endpoint WSS público?** Típicamente `wss://<host>:8089/ws`.

3. **¿El certificado TLS del WSS es válido (CA reconocida)?** Si es self-signed, hay que distribuirlo o aceptar excepción.

4. **¿Las credenciales SIP de cada extensión son las mismas que el USUARIO del webservice?**
   - O sea: ¿`USUARIO=9001` + `CLAVE=xxxx` me sirve para registrar la extensión SIP también, o son credenciales separadas?

5. **¿Qué codecs soporta el bridge?** Para WebRTC necesitamos al menos uno de: **opus, PCMU (G.711µ), PCMA (G.711A)**. Si solo tiene G.729 estamos en problemas (licenciado, no funciona out-of-the-box en browsers).

6. **¿Hay servidor TURN/STUN provisto por Neotel?** Si no, hay que levantarlo nosotros (coturn en AWS).

7. **`NeotelEvents` ¿cómo funciona?**
   - El endpoint toma un parámetro `eventInfo: string` y devuelve `string`. Hay dos interpretaciones posibles:
     - **(a) Pull/polling:** mandamos info de sesión y nos devuelve los últimos eventos.
     - **(b) Push:** Neotel lo invoca contra nuestro CRM cuando hay eventos (clásico CRM_Adapter).
   - Pedir a Neotel: documentación del formato del `eventInfo` (input y output), frecuencia recomendada de polling, y si existe un mecanismo push (webhook desde Neotel hacia nuestro endpoint).

8. **¿Existen modos de marcación además del predictivo?** Manual, preview, progressive — porque el flujo UX cambia drásticamente.

9. **¿IP whitelist?** Confirmar que las IPs públicas del EC2 de AMSA están permitidas para llamar al webservice.

10. **¿Ana Maya tiene staff técnico propio o todo lo opera Neotel?** Esto define quién toca la configuración de Asterisk si hay que cambiarla.

---

## 4. Catálogo de endpoints Neotel (relevantes para esta integración)

**Doc:** https://neotel-us.atlassian.net/wiki/spaces/NEOT/pages/6359422/Integraci+n+API
**Base URL:** `http://200.5.98.203/neoapi/webservice.asmx`
**Modo de invocación:** `HTTP POST` con `Content-Type: application/x-www-form-urlencoded` (preferido sobre SOAP — mucho más simple, sin XML).
**Convención de retorno:** los endpoints "void" devuelven 200 vacío; los que devuelven datos retornan `<string>...</string>` o `<boolean>...</boolean>` envueltos en XML mínimo.
**⚠️ Importante:** algunos endpoints tienen variantes EN/ES (`Login_Campaign` vs `Login_Campaña`, `Dial` vs `Discar`, `Position` vs `Posicion`, `CRM_Available` vs `CRM_Disponible`). **Usar siempre las versiones en inglés sin Ñ** para evitar problemas de URL-encoding del carácter Ñ. Existe también `Login_Campaign2` que toma `CAMPANA` (sin Ñ) — esa es la más segura.

### 4.1 Autenticación y sesión
| Método | Parámetros | Retorna | Notas |
|---|---|---|---|
| `Login` | `DEVICE`, `USUARIO`, `CLAVE` | void | Login del agente. DEVICE es la extensión SIP que va a usar. |
| `Login2F` | (investigar) | void | Login con segundo factor. |
| `Logout` | `USUARIO` | void | Logout total. |
| `Validate` | `TELEFONO`, `CAMPAÑA` (int) | boolean | Valida si un número está habilitado para una campaña (no bloqueado). |

### 4.2 Gestión de campañas
| Método | Parámetros | Retorna | Notas |
|---|---|---|---|
| `Login_Campaign2` | `USUARIO`, `CAMPANA` (int) | void | Entrar a una campaña (versión sin Ñ — usar esta). |
| `Logout_Campaign` | `USUARIO`, `CAMPAÑA` | void | Salir de una campaña. |

### 4.3 Estados del agente
| Método | Parámetros | Retorna | Notas |
|---|---|---|---|
| `Pause` | `USUARIO`, `SUBTIPO_DESCANSO` (int) | void | Pausa con motivo (los subtipos los tiene configurados Neotel por cliente). |
| `Unpause` | `USUARIO` | void | Volver a disponible. |
| `Descanso` | (investigar) | void | Posiblemente alias de `Pause`. |
| `Tiempo_Administrativo` | `USUARIO`, `TIEMPO_ADM` (bool) | void | Marca estado administrativo (true=entrar, false=salir). |
| `CRM_Available` / `CRM_Disponible` | (investigar) | void | Marca disponible desde el CRM. Hay duplicado EN/ES. |
| `CRM_Unavailable` / `CRM_No_Disponible` | (investigar) | void | Marca no disponible. |
| `Position` / `Posicion` | `USUARIO` | string | Devuelve estado actual del agente. **Útil para polling de fallback.** |

### 4.4 Control de llamada
| Método | Parámetros | Retorna | Notas |
|---|---|---|---|
| `Dial` / `Discar` | `USUARIO`, `TELEFONO` | boolean | Marcación saliente. El PBX llama a la extensión y luego al destino. |
| `Hangup` / `Cortar` | `USUARIO` | void | Cortar llamada activa. |
| `SendDTMF` | `USUARIO`, `DIGITOS` | void | Enviar tonos durante una llamada en curso. |
| `BlindTransfer` | `USUARIO`, `EXTENSION` | void | Transferencia ciega a una extensión. |
| `BlindTransferQueue` | (investigar) | void | Transferencia ciega a cola. |
| `BlindTransferCampaign` | (investigar) | void | Transferencia ciega a campaña. |
| `AttendedTransfer` | (investigar) | void | Transferencia asistida (consulta primero). |
| `AttendedTransferQueue` | (investigar) | void | Transferencia asistida a cola. |
| `Iniciar_Grabacion` | `USUARIO` | void | Iniciar grabación de la llamada actual. |
| `Detener_Grabacion` | `USUARIO` | void | Detener grabación. |

### 4.5 Conferencia (relevancia baja en fase inicial)
- `JoinConference`, `InviteParticipant`, `CancelInvitation`, `KickAll`, `KickParticipant`, `MuteAll`, `MuteParticipant`, `UnmuteAll`, `UnmuteParticipant`, y variantes ES (`Silenciar_*`, `Expulsar_*`, `Dessilenciar_*`).

### 4.6 Eventos
| Método | Parámetros | Retorna | Notas |
|---|---|---|---|
| `NeotelEvents` | `eventInfo` (string) | string | **CRÍTICO — pedir documentación específica a Neotel.** Es el canal de eventos. |

### 4.7 Gestión de contactos (integración CRM)
| Método | Parámetros | Retorna | Notas |
|---|---|---|---|
| `CRM_ShowingContact` / `CRM_Mostrando_Contacto` | `USUARIO`, `BASE` (int), `IDCONTACTO` (long), `DATA` (string) | void | Notificar a Neotel que estamos mostrando un contacto. |
| `CRM_Mostrando_Contacto_CRM_Interno` | (investigar) | void | Variante interna. |
| `UpdateContact` | `CRM`, `USUARIO`, `BASE`, `IDCONTACTO`, `DATA`, `SUBCATEGORIA` (int), `XML_UPDATE`, `AGENDA` (bool), `FECHA_AGENDA` (datetime), `USUARIO_AGENDA`, `TEL_AGENDA` | void | Actualiza el contacto con la disposición de la llamada + agenda callback opcional. |
| `CloseContact` | `BASE` (int), `IDCONTACTO` (int) | void | Cierra el contacto (lo saca de la rotación). |
| `AddScheduleCall` | `USUARIO`, `BASE` (int), `IDCONTACTO` (int), `DATA` (string), `TELEFONO`, `FECHA_AGENDA` (datetime) | string | Agendar una llamada futura (callback). |

### 4.8 Administración (para superuser/admin, baja prioridad operativa)
- `User_Insert`, `User_Update`, `User_Delete`, `User_HasLicense`, `User_ChangePassword`
- `Device_Insert`, `Device_Update`, `Device_Delete`
- `Update_Campaign_Object`, `Update_Device_Object`, `Update_Usuario_Object`
- `AddHostExceptionTel/Web`, `AddInternetExceptionTel/Web`, `RemoveHostExceptionTel/Web`, `RemoveInternetExceptionTel/Web`
- `ReloadBlockedIncoming`, `ReloadBlockedOutgoing`

### 4.9 Utilidades misceláneas (probablemente innecesarias)
- `AES_Encrypt` / `AES_Decrypt`, `GenerateBarCodeImage`, `GetQR`, `GetIpCountryCode`, `GetTimeBasedKey`, `ConvertBase64ToFile`, `ConvertFileToBase64`, `ConvertFileToBytes`, `SaveRemoteImage`, `CheckIdioma`, `setSalBase`
- `ExecuteTask00` a `ExecuteTask20`, `ExecuteTask38` — **mistery endpoints, pedir documentación**. Probablemente son hooks de tareas customizadas por cliente.
- `Screen*` (ScreenApplicationStart/Stop, ScreenRecordStart/Stop, ScreenStreamStart/Close, ScreenPacketReceived) — grabación de pantalla del agente. Fuera de scope inicial.
- `StartMonitor` / `StopMonitor` — para supervisores que quieren escuchar llamadas.

---

## 5. Plan de implementación por sprints

### Sprint 0 — Discovery & PoC (3-5 días)
**Objetivo:** confirmar prerequisitos antes de invertir en código.

**Tareas:**
1. Enviar bloque de 10 preguntas (sección 3) al soporte Neotel.
2. Capturar tráfico de XLite con Wireshark en una PC operadora real durante una sesión completa (login → entrar campaña → recibir llamada → cortar → cerrar contacto → pausar → logout). Guardar el .pcap.
3. Capturar tráfico HTTP del XLite contra el webservice (probablemente XLite usa un módulo customizado o tiene una integración con un .NET sidecar — confirmar arquitectura real).
4. Documentar el flujo real de eventos que recibe XLite (saber QUÉ se sincroniza para poder reproducirlo).
5. PoC mínima: una página HTML standalone con JsSIP que se registre contra el WSS de Neotel y haga ringtest. Sin React, sin Nest, sin nada — solo confirmar que el audio WebRTC funciona end-to-end.

**Entregable:** documento con resultados + .pcap + página HTML del PoC.
**Gate:** **NO avanzar** a Sprint 1 si el PoC no logra audio bidireccional limpio.

---

### Sprint 1 — `NeotelModule` backend (5-7 días)
**Objetivo:** wrapper completo y tipado de la API Neotel en NestJS.

**Estructura de archivos:**
```
src/modules/neotel/
├── neotel.module.ts
├── neotel.service.ts          # cliente HTTP + parser de respuestas
├── neotel.controller.ts       # REST endpoints expuestos al frontend
├── dto/
│   ├── login.dto.ts
│   ├── dial.dto.ts
│   ├── update-contact.dto.ts
│   └── ... (uno por operación)
├── types/
│   ├── agent-state.enum.ts    # AVAILABLE, ON_CALL, PAUSED, ADMIN, OFFLINE, etc.
│   ├── neotel-event.types.ts
│   └── neotel-response.types.ts
├── parsers/
│   └── xml-response.parser.ts # parser para los <string>...</string> y <boolean>...</boolean>
└── neotel.errors.ts           # excepciones tipadas (NeotelTimeoutError, NeotelAuthError, etc.)
```

**Comportamiento clave del `NeotelService`:**
- Cliente HTTP basado en `fetch` nativo de Node 18+ (cero dependencias extra).
- Method privado `call<T>(endpoint, params)`:
  - Construye `URLSearchParams` con los params.
  - `POST` con `Content-Type: application/x-www-form-urlencoded`.
  - Timeout configurable (default 10s, override por op).
  - Retry automático con backoff exponencial (3 intentos para errores 5xx/network).
  - Parsea XML mínimo (`<string>`, `<boolean>`) según el tipo de retorno esperado.
  - Logging Winston: INFO al iniciar, DEBUG con request/response, WARN en retry, ERROR en fallo final.
- Métodos públicos uno por endpoint, fuertemente tipados con DTOs.
- Sanitización: validar que `USUARIO` sea string no vacío, `CAMPANA` sea int positivo, fechas en ISO 8601, etc.
- **Nunca loggear `CLAVE` en plain text** — siempre redactar.

**Endpoints REST expuestos por `neotel.controller.ts`** (prefix `/api/neotel`):
- `POST /login` { device, usuario, clave }
- `POST /logout`
- `POST /campaign/:id/enter`
- `POST /campaign/:id/leave`
- `POST /state/pause` { motivo }
- `POST /state/unpause`
- `POST /state/admin` { enable }
- `POST /call/dial` { telefono }
- `POST /call/hangup`
- `POST /call/dtmf` { digitos }
- `POST /call/transfer/blind` { extension }
- `POST /call/transfer/attended` { extension }
- `POST /call/recording/start`
- `POST /call/recording/stop`
- `POST /contact/show` { base, idContacto, data }
- `POST /contact/update` { ...full DTO }
- `POST /contact/close` { base, idContacto }
- `POST /contact/schedule` { base, idContacto, data, telefono, fechaAgenda }
- `GET /state` → trae `Position` del USUARIO actual

**Aspectos no-funcionales:**
- Todos los endpoints REST protegidos por el guard de auth de AMSA Gestión.
- El `USUARIO` Neotel del operador autenticado se resuelve del JWT/sesión, **nunca se pasa desde el frontend** (seguridad).
- Variables de entorno: `NEOTEL_BASE_URL`, `NEOTEL_TIMEOUT_MS`, `NEOTEL_RETRY_ATTEMPTS`.
- Tests unitarios con Jest mockeando `fetch` — al menos 1 happy path + 1 error path por endpoint.

**Acceptance criteria:**
- [ ] `npm run test` pasa al 100%.
- [ ] Todos los endpoints de la sección 4.1, 4.2, 4.3, 4.4, 4.7 implementados y tipados.
- [ ] Logs Winston con structured logging (JSON en prod, pretty en dev).
- [ ] No hay un solo `console.log` ni `any` sin justificar.
- [ ] Postman collection / Bruno collection con todos los endpoints documentados para QA manual.

---

### Sprint 2 — Eventos y push real-time (4-6 días)
**Objetivo:** que la UI del agente reaccione automáticamente a eventos del dialer.

**Componentes:**
1. **`NeotelEventsPoller`** (BullMQ repeating job o `@Cron`):
   - Cada N segundos (definir con Neotel: típico 1-3s) llama a `NeotelEvents` con el `eventInfo` armado según especificación de Neotel.
   - Parsea la respuesta y la mete en una `BullMQ Queue` `neotel-events`.
2. **`NeotelEventsConsumer`** (BullMQ worker):
   - Toma eventos de la queue.
   - Identifica el agente destinatario.
   - Persiste evento en `neotel_event_log` (auditoría).
   - Emite por Socket.io al room del agente.
3. **`AgentStateService`** (con Redis):
   - Cache de estado de cada agente: `usuario`, `campañaActiva`, `estado`, `llamadaActiva`, `contactoActivo`, `timestampEstado`.
   - TTL razonable (ej. 30 min) para que sesiones zombi se limpien.
4. **Socket.io gateway**:
   - Namespace `/neotel`.
   - Rooms por `usuario` (agente).
   - Eventos emitidos: `call:ringing`, `call:answered`, `call:ended`, `contact:assigned`, `state:changed`, `recording:started`, `recording:stopped`.

**⚠️ Punto importante a confirmar:**
- Si Neotel ofrece **push (webhook)** en lugar de polling, **usar push y descartar el poller**. Reduce latencia y carga.
- Si no, el polling debe ser eficiente: si hay 50 agentes, NO levantar 50 jobs. Un solo job que pida eventos de todos los agentes a la vez si la API lo permite, sino un pool.

**Acceptance criteria:**
- [ ] Polling/push funciona con latencia ≤ 2s desde evento real en Asterisk hasta render en UI del agente.
- [ ] No hay event leak entre agentes (test con 2 sesiones simultáneas).
- [ ] Redis estado del agente se mantiene consistente con la realidad del dialer (validar contra `Position`).
- [ ] Log de eventos persistido en MySQL para auditoría.

---

### Sprint 3 — Softphone WebRTC en React (7-10 días)
**Objetivo:** el operador puede atender/hacer llamadas con audio en el browser.

**Dependencias:**
```bash
npm install jssip
npm install @types/jssip --save-dev
```

**Estructura frontend:**
```
src/features/softphone/
├── hooks/
│   ├── useJsSIP.ts            # core hook que maneja UA + sesiones
│   ├── useAudioDevices.ts     # enumera mic/speaker disponibles
│   └── useSoftphoneState.ts   # estado global softphone (Zustand o Context)
├── components/
│   ├── SoftphonePanel.tsx     # panel fijo lateral/inferior
│   ├── CallControls.tsx       # mute, hold, transfer, dtmf, hangup
│   ├── DialPad.tsx            # teclado numérico para DTMF + marcación manual
│   ├── IncomingCallModal.tsx  # modal al recibir llamada
│   ├── DeviceSelector.tsx     # selector de mic/speaker
│   └── AudioLevelMeter.tsx    # VU meter para verificar audio
├── stores/
│   └── softphone.store.ts     # Zustand store
└── types/
    └── softphone.types.ts
```

**Funcionalidades del softphone:**
1. **Registro automático** cuando el agente loguea en AMSA Gestión (extensión SIP derivada de su usuario).
2. **Atender llamada entrante** con un click o por keybind (auto-answer opcional para predictive).
3. **Cortar** llamada.
4. **Mute/Unmute** mic.
5. **Hold/Unhold** (si Neotel lo soporta vía SIP — sino vía API).
6. **DTMF** in-call (durante una llamada activa, mandar dígitos a través del INFO method o RFC2833).
7. **Selección de mic y speaker** (no todos los browsers respetan `setSinkId` para output — Chrome sí).
8. **Indicador visual de audio level** (input y output) para que el operador verifique que su mic anda.
9. **Reconexión automática** si se cae el WSS (network blip).
10. **Indicador de calidad de llamada** (jitter, packet loss vía `RTCPeerConnection.getStats()`).

**Reglas de UX:**
- El panel del softphone es **persistente** — no debe desmontarse al navegar entre pantallas (montarlo en el layout root).
- Estado de la llamada activa debe ser visible en TODA la app (badge global).
- Si una llamada ringa y el operador está en otra pestaña, **sonar tonopolifónico** y enviar notificación browser (`Notification API`).
- **Permisos de micrófono**: pedirlos UNA vez al iniciar sesión, manejar el rechazo con un fallback UI claro.

**Acceptance criteria:**
- [ ] Audio bidireccional sin glitches durante 30 min de llamada continua.
- [ ] Reconexión WSS automática después de cortar wifi/cable por 30s.
- [ ] Calidad de audio comparable o superior a XLite (medir MOS si es posible).
- [ ] Funciona en Chrome (target principal), Edge y Firefox (target secundario). Safari es opcional.
- [ ] El operador puede cambiar de auriculares en caliente sin reload.

---

### Sprint 4 — Flujo completo del agente (5-7 días)
**Objetivo:** integrar Sprint 1 + 2 + 3 en un journey end-to-end.

**Journey objetivo (happy path):**
1. Operador abre AMSA Gestión y se loguea (auth interna). El backend resuelve sus credenciales Neotel (almacenadas encriptadas en `agent_credentials`).
2. Frontend monta SoftphonePanel y hace 2 cosas en paralelo:
   - Backend: `POST /api/neotel/login` → Neotel `Login(DEVICE, USUARIO, CLAVE)`.
   - JsSIP: registra contra `wss://...` con la extensión SIP.
3. Operador selecciona campaña → `POST /api/neotel/campaign/:id/enter` → `Login_Campaign2`.
4. Operador click "Disponible" → `Unpause` (o `CRM_Available`).
5. Dialer empieza a marcar. Cuando bridgea con el agente:
   - JsSIP recibe `newRTCSession` (incoming).
   - Auto-answer (modo predictivo).
   - Backend recibe evento por NeotelEvents con info del contacto (idContacto, base).
   - Socket.io empuja `contact:assigned` al frontend.
   - UI carga la ficha del contacto y llama `CRM_ShowingContact`.
6. Operador conversa. Puede:
   - Pulsar dígitos (DTMF).
   - Transferir.
   - Iniciar/parar grabación.
7. Operador cuelga → JsSIP termina sesión + `POST /api/neotel/call/hangup`.
8. UI muestra el form de disposición. Operador selecciona subcategoría + notas + opcional agenda → `POST /api/neotel/contact/update` con todos los datos.
9. Sistema cierra contacto: `CloseContact`.
10. Volver al paso 5 (siguiente llamada del dialer).

**Persistencia en MySQL (Prisma — extender schema de AMSA Cobranzas):**
```prisma
model AgentSession {
  id            Int       @id @default(autoincrement())
  usuario       String
  loginAt       DateTime
  logoutAt      DateTime?
  device        String
  ipAddress     String?
  userAgent     String?
  campaigns     CampaignSession[]
}

model CampaignSession {
  id              Int       @id @default(autoincrement())
  agentSessionId  Int
  campañaId       Int
  enteredAt       DateTime
  leftAt          DateTime?
  agentSession    AgentSession @relation(fields: [agentSessionId], references: [id])
}

model AgentStateEvent {
  id              Int       @id @default(autoincrement())
  usuario         String
  state           String    // 'AVAILABLE' | 'PAUSED' | 'ADMIN' | 'ON_CALL' | etc.
  motivo          String?
  startedAt       DateTime
  endedAt         DateTime?
}

model CallLog {
  id              Int       @id @default(autoincrement())
  usuario         String
  campañaId       Int?
  idContacto      Int?
  base            Int?
  telefono        String
  direction       String    // 'INBOUND' | 'OUTBOUND'
  ringedAt        DateTime?
  answeredAt      DateTime?
  endedAt         DateTime?
  duration        Int?      // seconds
  subcategoria    Int?
  notas           String?   @db.Text
  recordingUrl    String?
  scheduledCall   ScheduledCall?
}

model ScheduledCall {
  id              Int       @id @default(autoincrement())
  callLogId       Int       @unique
  fechaAgenda     DateTime
  telefono        String
  usuarioAgenda   String?
  callLog         CallLog @relation(fields: [callLogId], references: [id])
}

model NeotelEventLog {
  id              BigInt    @id @default(autoincrement())
  usuario         String
  rawEventInfo    String    @db.Text
  parsedType      String?
  receivedAt      DateTime  @default(now())
}
```

**Acceptance criteria:**
- [ ] Un operador puede completar el journey completo sin tocar XLite ni otra herramienta externa.
- [ ] Métricas básicas registradas: tiempo en cada estado, duración llamadas, llamadas/hora.
- [ ] Reportes mínimos en UI: dashboard del supervisor con agentes online + estado actual.

---

### Sprint 5 — Hardening y QA con operadores reales (5 días)
**Objetivo:** que sea estable bajo uso real.

**Tareas:**
1. Test paralelo: 3 operadores con AMSA Gestión + 3 operadores con XLite durante 1 día. Comparar:
   - Calidad de audio percibida.
   - Tiempo promedio de gestión por llamada.
   - Errores / cuelgues / re-llamadas.
2. Fix de bugs encontrados.
3. Failovers:
   - Si JsSIP falla, ¿qué pasa? ¿Mostrar warning?
   - Si NestJS pierde conexión a Neotel API, ¿reintenta? ¿Notifica al agente?
   - Si Redis cae, ¿los eventos se pierden?
4. Documentación operativa: manual de uso para operadores + manual de troubleshooting para soporte.
5. Plan de rollout gradual: 10% → 25% → 50% → 100% de operadores en una semana.

**Acceptance criteria:**
- [ ] Sesiones de 4h sin reconexiones inesperadas.
- [ ] Tiempo de gestión por llamada igual o menor que con XLite.
- [ ] Cero llamadas perdidas por culpa del softphone web (medido contra logs Neotel).

---

### Sprint 6 — Features avanzadas (opcional, después del rollout)
- Transferencias asistidas con UI completa.
- Modo supervisor: escuchar llamadas en vivo (`StartMonitor`).
- Whisper coaching (susurrar al agente sin que escuche el contacto).
- Grabación de pantalla (`Screen*` endpoints) — solo si lo pide compliance.
- WebRTC stats en tiempo real para QA de calidad.
- Modo predictivo vs preview vs manual configurable por campaña.

---

## 6. Estructura final del repo (after sprints)

```
amsa-cobranzas/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma           # extendido con tablas del sprint 4
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── neotel/             # sprint 1 + sprint 2
│   │   │   ├── agent-state/        # sprint 2
│   │   │   ├── calls/              # sprint 4
│   │   │   ├── contacts/           # ya existente / extender
│   │   │   └── events/             # sprint 2 socket.io gateway
│   │   ├── workers/                # BullMQ workers
│   │   │   └── neotel-events.worker.ts
│   │   └── common/
│   │       ├── logger/             # Winston config
│   │       └── filters/
└── frontend/
    └── src/
        ├── features/
        │   ├── softphone/          # sprint 3
        │   ├── campaigns/
        │   ├── contacts/
        │   └── supervisor/         # sprint 6 (opcional)
        └── shared/
            ├── api/                # axios client + endpoints tipados
            └── socket/             # socket.io client
```

---

## 7. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Asterisk de Neotel no tiene WSS y se niegan a habilitarlo | Media | **Crítico** | Sprint 0 lo confirma. Si pasa, evaluar Kamailio gateway o Electron desktop app. |
| Calidad de audio WebRTC inferior a XLite | Baja | Alto | Sprint 0 PoC lo valida. Si pasa, profundizar en codecs (opus en vez de PCMA) o servidor TURN dedicado. |
| `NeotelEvents` no provee la info necesaria | Media | Alto | Confirmar en Sprint 0. Plan B: complementar con polling de `Position` cada 1s + estado SIP local del JsSIP. |
| Latencia del polling > tolerable | Media | Medio | Push webhook si Neotel lo soporta. Sino, reducir intervalo y batchear. |
| Operadores resisten el cambio de UX | Alta | Medio | Rollout gradual + training + dejar XLite como fallback temporal. |
| Caída de internet del operador | Alta | Alto | Reconexión automática + persistencia local de eventos pendientes. |
| Caída de la API Neotel | Baja | **Crítico** | Es SPOF para todos. Diseñar UI con "modo degradado" claro. |

---

## 8. Instrucciones para Claude Code

### Convenciones obligatorias del proyecto (recordatorio):
- **Logging:** Winston con structured logging (JSON en prod, pretty en dev). **PROHIBIDO** `console.log` en código de producción.
- **Tipado:** TypeScript estricto. `any` solo justificado con comentario.
- **Validación:** `class-validator` + `class-transformer` en todos los DTOs.
- **Errores:** excepciones tipadas, manejadas por filtro global. Nunca `throw 'string'`.
- **Tests:** Jest, mínimo happy path + 1 error path por método público.
- **Estilo:** ESLint + Prettier según config existente.

### Agentes recomendados:
- **Architect (Opus):** revisar este plan, refinar decisiones de arquitectura, generar diseño de los DTOs y types antes de codear.
- **Implementer (Sonnet):** ejecutar sprint por sprint siguiendo este plan, validando contra acceptance criteria.

### Orden sugerido de tickets:
1. `NEOTEL-001` Sprint 0: discovery doc + PoC HTML JsSIP
2. `NEOTEL-002` Sprint 1: NeotelService + tests
3. `NEOTEL-003` Sprint 1: NeotelController + REST endpoints + Postman/Bruno
4. `NEOTEL-004` Sprint 2: AgentStateService + Redis + Socket.io gateway
5. `NEOTEL-005` Sprint 2: NeotelEventsPoller + worker BullMQ
6. `NEOTEL-006` Sprint 3: useJsSIP hook + SoftphonePanel base
7. `NEOTEL-007` Sprint 3: DialPad + DeviceSelector + IncomingCallModal
8. `NEOTEL-008` Sprint 3: reconnect logic + audio quality monitoring
9. `NEOTEL-009` Sprint 4: schema Prisma extendido + migraciones
10. `NEOTEL-010` Sprint 4: integración end-to-end + dashboard supervisor mínimo
11. `NEOTEL-011` Sprint 5: hardening + QA paralelo
12. `NEOTEL-012+` Sprint 6: features avanzadas

### Comando para arrancar mañana:
```
# Una vez confirmadas las preguntas de la sección 3 con Neotel:
claude-code "Implementá el Sprint 1 según NEOTEL_INTEGRATION_PLAN.md.
Empezá por el module + service + types + un solo endpoint (Login) con sus tests.
Antes de codear, mostrame el plan de archivos que vas a crear/modificar."
```

---

## 9. Apéndice: ejemplo concreto de implementación inicial

```typescript
// src/modules/neotel/neotel.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { setTimeout } from 'node:timers/promises';
import {
  NeotelTimeoutError,
  NeotelHttpError,
  NeotelInvalidResponseError,
} from './neotel.errors';

interface CallOptions {
  timeoutMs?: number;
  retries?: number;
  expects?: 'void' | 'string' | 'boolean';
}

@Injectable()
export class NeotelService {
  private readonly logger = new Logger(NeotelService.name);
  private readonly baseUrl: string;
  private readonly defaultTimeout: number;
  private readonly defaultRetries: number;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('NEOTEL_BASE_URL');
    this.defaultTimeout = config.get<number>('NEOTEL_TIMEOUT_MS', 10000);
    this.defaultRetries = config.get<number>('NEOTEL_RETRY_ATTEMPTS', 3);
  }

  private async call<T = void>(
    endpoint: string,
    params: Record<string, string | number | boolean>,
    options: CallOptions = {},
  ): Promise<T> {
    const { timeoutMs = this.defaultTimeout, retries = this.defaultRetries, expects = 'void' } = options;
    const url = `${this.baseUrl}/${endpoint}`;
    const body = new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    ).toString();

    const safeParams = this.redactSensitive(params);
    this.logger.debug({ endpoint, params: safeParams }, 'Neotel call start');

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(timeoutMs).then(() => controller.abort());
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: controller.signal,
        });
        timer.then(() => {}, () => {});

        if (!res.ok) {
          throw new NeotelHttpError(endpoint, res.status, await res.text());
        }
        const text = await res.text();
        return this.parseResponse<T>(text, expects);
      } catch (err) {
        lastError = err as Error;
        this.logger.warn({ endpoint, attempt, error: lastError.message }, 'Neotel call retry');
        if (attempt < retries) {
          await setTimeout(2 ** attempt * 100);
        }
      }
    }
    this.logger.error({ endpoint, error: lastError?.message }, 'Neotel call failed');
    throw lastError ?? new NeotelTimeoutError(endpoint);
  }

  private parseResponse<T>(xml: string, expects: 'void' | 'string' | 'boolean'): T {
    if (expects === 'void') return undefined as T;
    const stringMatch = xml.match(/<string[^>]*>([\s\S]*?)<\/string>/);
    const booleanMatch = xml.match(/<boolean[^>]*>(true|false)<\/boolean>/);
    if (expects === 'string' && stringMatch) return stringMatch[1] as T;
    if (expects === 'boolean' && booleanMatch) return (booleanMatch[1] === 'true') as T;
    throw new NeotelInvalidResponseError(xml);
  }

  private redactSensitive(params: Record<string, unknown>) {
    const redacted = { ...params };
    if ('CLAVE' in redacted) redacted.CLAVE = '***';
    return redacted;
  }

  // ──── API pública ────

  async login(device: string, usuario: string, clave: string): Promise<void> {
    await this.call('Login', { DEVICE: device, USUARIO: usuario, CLAVE: clave });
  }

  async logout(usuario: string): Promise<void> {
    await this.call('Logout', { USUARIO: usuario });
  }

  async loginCampaign(usuario: string, campana: number): Promise<void> {
    await this.call('Login_Campaign2', { USUARIO: usuario, CAMPANA: campana });
  }

  async pause(usuario: string, subtipoDescanso: number): Promise<void> {
    await this.call('Pause', { USUARIO: usuario, SUBTIPO_DESCANSO: subtipoDescanso });
  }

  async unpause(usuario: string): Promise<void> {
    await this.call('Unpause', { USUARIO: usuario });
  }

  async dial(usuario: string, telefono: string): Promise<boolean> {
    return this.call<boolean>('Dial', { USUARIO: usuario, TELEFONO: telefono }, { expects: 'boolean' });
  }

  async hangup(usuario: string): Promise<void> {
    await this.call('Hangup', { USUARIO: usuario });
  }

  async sendDtmf(usuario: string, digitos: string): Promise<void> {
    await this.call('SendDTMF', { USUARIO: usuario, DIGITOS: digitos });
  }

  async position(usuario: string): Promise<string> {
    return this.call<string>('Position', { USUARIO: usuario }, { expects: 'string' });
  }

  // ... (resto de los métodos de la sección 4)
}
```

## 10. Datos de conexion con neotel SIP y usuario

Usuario:	 6001 
Clave:		 10066001
SIP: 		 Externo6001
Clave SIP: 	 Externo6001
Domain:		 200.5.98.203  ó 190.210.25.141 
Campaña:	 115

---

**Fin del plan.** Cualquier ambigüedad de Neotel queda como `// TODO: confirmar con Neotel` en el código, nunca como suposición silenciosa.
