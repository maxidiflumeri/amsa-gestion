# Reunión con Neotel — 2026-05-13 14:00

## Objetivo de la reunión

Reemplazar 100% el softphone X-Lite por un **softphone embebido en el browser**, dentro de AMSA Gestión. El agente loguea, asigna campaña, cambia estado (descanso/administrativo), recibe llamadas del predictivo, hace click-to-call y cierra disposición — **todo desde la web**, sin X-Lite ni panel supervisor externo de Neotel.

Necesitamos que Neotel habilite cosas del lado de su Asterisk + nos confirme algunos parámetros.

---

## 1. Arquitectura propuesta — explicarla en 1 minuto

**Dos canales separados:**

1. **Canal de voz (WebRTC):** el browser del agente habla SIP sobre WebSocket Secure (WSS) directamente con el Asterisk de Neotel. Audio sobre DTLS-SRTP. Para esto usamos la librería **JsSIP** (estándar de la industria, mismo enfoque que usan Bria Mobile o softphones web modernos).

2. **Canal de control (HTTP):** el backend de AMSA Gestión consume la **API HTTP de Neotel** (la que está documentada en `neotel-us.atlassian.net/.../Integracion+API`) para login del agente, asignar/desasignar campaña, cambiar estado, click-to-call y obtener eventos (`NeotelEvents` por polling).

El browser **nunca habla con la API HTTP de Neotel directamente** — siempre va por nuestro backend (más seguro, las credenciales API quedan en el server).

---

## 2. Estado actual confirmado

- ✅ **API HTTP de Neotel:** alcanzable y respondiendo. Ya hicimos un smoke test con `POST /neoapi/webservice.asmx/Login` para Externo6001 y devolvió "Position not found" (error de negocio, no de red) → API funciona.
- ✅ **SIP/UDP 5060:** funciona, es lo que usa X-Lite hoy.
- ❌ **SIP/WSS:** el puerto `8089/TCP` ya lo abrimos en nuestro Meraki hacia `90.0.0.6` pero el Asterisk **no responde ahí**. El paquete entra a la red pero el Asterisk no tiene servicio escuchando en 8089. Validado con `telnet` y `curl` (timeout sin RST → confirma que no hay listener).

---

## 3. Qué pedir explícitamente a Neotel (checklist)

### A. Habilitar WSS en el Asterisk (lo principal)

> "Necesitamos que habiliten en el Asterisk de Externo6001 el transport **WebSocket Secure (WSS)**, escuchando en `0.0.0.0:8089/TCP`, con cert TLS y aceptando WebRTC del browser."

Configuración técnica que tienen que aplicar (referencia para que sepan de qué hablamos):

```ini
; http.conf
[general]
enabled=yes
tlsenable=yes
tlsbindaddr=0.0.0.0:8089
tlscertfile=/etc/asterisk/keys/fullchain.pem
tlsprivatekey=/etc/asterisk/keys/privkey.pem

; pjsip.conf
[transport-wss]
type=transport
protocol=wss
bind=0.0.0.0

[Externo6001]
; agregar:
transport=transport-wss   ; o aceptar múltiples transports
webrtc=yes                ; activa DTLS-SRTP, ICE, rtcp-mux automáticamente
```

### B. Confirmaciones a obtener

1. **¿URL WSS pública definitiva?** ¿`wss://200.5.98.203:8089/ws` o nos dan un FQDN tipo `wss://asterisk.neotel.com.ar:8089/ws`?
2. **Cert TLS:** ¿lo emiten ellos con CA pública (Let's Encrypt, etc.) o es self-signed? **Importante:** Chrome no acepta self-signed para WSS embebido en una página HTTPS sin que el usuario lo apruebe manualmente. **Pedir cert válido de CA pública.**
3. **Credenciales SIP para WebRTC:** ¿la extensión `Externo6001` usa la misma password SIP que para X-Lite o nos arman un endpoint nuevo tipo `Externo6001-web` con su propia password?
4. **Codecs habilitados:** confirmar **Opus** (preferido) y **G.711 alaw/ulaw** (fallback). PCMA/PCMU son los nombres internos de Asterisk.
5. **DTLS-SRTP encriptación:** ¿activada? (WebRTC la requiere obligatoriamente).
6. **STUN/TURN:** ¿proveen ustedes un TURN server o usamos los públicos de Google (stun.l.google.com:19302)?
   - **Argumentación si te dicen "usá los de Google":** está bien para STUN, pero si el agente está detrás de NAT simétrico necesitamos TURN. Si Neotel lo provee mejor para tener QoS.

### C. Confirmaciones sobre la API HTTP

1. **`NeotelEvents`** (eventos de llamada): ¿lo consumimos por **polling cada ~1 seg** o pueden habilitar **webhook push** hacia nuestro backend?
   - Push es mejor, pero polling alcanza para arrancar.
2. **Click-to-call:** ¿el endpoint es `originate` o `clickToCall`? ¿Acepta como params el `agentId` + `numeroDestino` + `campañaId`?
3. **Disposición / motivo no contacto:** ¿se setea por API después de colgar o se hace en el panel de Neotel? Idealmente queremos enviarla por API.
4. **Estados de pausa:** confirmar que los motivos que armemos del lado nuestro (almuerzo, baño, capacitación, reunión) los puedan **mapear a sus motivos internos** de Neotel para el reporting. Si tienen motivos predefinidos, pedirlos.

### D. Sobre la campaña

1. Confirmar que la **campaña 115** sigue siendo la de prueba y que `Externo6001` está asignado.
2. ¿La **grabación** está activa a nivel campaña 115? (Asumimos que sí porque lo manejan ellos a nivel campaña — Gestión NO controla start/stop de grabación.)
3. Si en el futuro hay más usuarios, ¿el alta de extensiones nuevas la hacen ustedes o nos dan acceso?

---

## 4. Preguntas que Neotel probablemente te haga — y cómo responder

### "¿Por qué no usan el softphone que ya provee Neotel?"
> "Queremos integrar la telefonía dentro del flujo de gestión: cuando salta una llamada del predictivo, el agente ve **automáticamente** la ficha del deudor, deja la disposición vinculada a la gestión, todo sin saltar entre apps. X-Lite es una caja negra que vive afuera de Gestión."

### "¿Por qué WebRTC en vez de seguir con SIP/UDP?"
> "Los browsers no soportan UDP directo por seguridad. La única forma de meter SIP en una web app es vía WebSocket (RFC 7118). Es el estándar para softphones web."

### "¿Esto no rompe lo que ya tienen funcionando con X-Lite?"
> "No, son canales independientes. X-Lite puede seguir funcionando en paralelo durante la transición. La extensión `Externo6001` puede tener múltiples transports (UDP + WSS) y registrar desde ambos. Cuando un agente esté logueado en la web, X-Lite no debería estar logueado al mismo tiempo con el mismo usuario."

### "¿Necesitan acceso al servidor Asterisk?"
> "No. Solo necesitamos que ustedes habiliten las cosas del lado Asterisk. Nosotros consumimos la API HTTP y nos conectamos al WSS. Sin shell, sin acceso a configs."

### "¿Qué pasa si el browser se cierra durante una llamada?"
> "Como en cualquier softphone: la llamada termina. La sesión SIP cae, Asterisk detecta el RTP timeout y libera el canal. Reconexión automática al volver a abrir la app."

### "¿Cuántos agentes simultáneos van a usar esto?"
> "Para empezar 1 (Externo6001 en QA). Después escalamos. La concurrencia depende de cuántas extensiones nos provean."

### "¿Quién maneja la grabación?"
> "Ustedes, a nivel campaña. Gestión NO controla start/stop. Si la campaña 115 tiene grabación activa, todas las llamadas del agente asignado quedan grabadas automáticamente."

### "¿Qué pasa con la transferencia entre agentes?"
> "Por ahora no. Queda para una segunda fase cuando provean más extensiones. Con un solo Externo6001 no se puede testear."

### "¿Y el supervisor / barge / whisper?"
> "Lo dejamos fuera del MVP. Para escuchar/intervenir llamadas necesitamos otra extensión con permisos especiales — lo charlamos cuando lleguemos a esa etapa."

### "¿Cómo manejan las credenciales SIP?"
> "Las guardamos cifradas (AES-256-GCM) en nuestra DB. Cuando el agente loguea en la web, el backend desencripta y se las pasa al browser por una API autenticada con su JWT. No quedan en localStorage ni en cookies del browser."

### "¿Necesitan que abramos algún puerto adicional en nuestro firewall?"
> "Solo `8089/TCP` para WSS. El resto (5060 UDP, RTP 10000-40000 UDP) ya está abierto para X-Lite. Si proveen TURN, el puerto de TURN también (típicamente 3478 UDP + rango)."

### "¿Hicieron pruebas con sus credenciales?"
> "Sí. La API HTTP responde correctamente — hicimos `POST /neoapi/webservice.asmx/Login` para `Externo6001` y devolvió error de negocio (Position not found, porque la extensión no estaba activa en ese momento). El transport WSS no responde — confirmamos con `telnet 8089` desde adentro de la LAN del meraki que el Asterisk no tiene servicio en ese puerto."

---

## 5. Acción concreta a pedir al cierre de la reunión

> "¿Pueden habilitar WSS en el Asterisk para `Externo6001` en las próximas X días/horas? Cuando esté listo, nos avisan y validamos desde nuestro lado con `curl -k https://<host>:8089/`. Si responde algo, ya podemos arrancar a probar con el softphone web."

**Compromiso a obtener:**
- ✅ Fecha estimada de habilitación WSS
- ✅ URL WSS definitiva
- ✅ Si la password de Externo6001 cambia o sigue siendo `Externo6001`
- ✅ Quién es el contacto técnico para ir consultando dudas durante la implementación

---

## 6. Si te tiran un "esto no se puede" o "no lo hacemos"

**Plan B:**
- Pedirles que **al menos** habiliten WSS solo para una IP whitelist (la pública nuestra: `200.5.98.203`) para testeo, sin exponerlo a internet.
- Si no quieren tocar el Asterisk en absoluto, preguntar si tienen un **gateway WebRTC** intermedio (algunos PBX cloud lo ofrecen) — un Kamailio o FreeSWITCH delante que haga la traducción WSS ↔ SIP/UDP.
- Como último recurso, podemos levantar **nosotros** un Kamailio del lado nuestro que actúe de gateway: el browser habla WSS con nuestro Kamailio, y este registra contra el Asterisk de Neotel por SIP/UDP. Pero implica que nosotros operemos un componente más de infra.

---

## 7. Glosario rápido (por si te tiran terminología)

- **WebRTC:** estándar W3C/IETF para audio/video peer-to-peer desde el browser.
- **WSS:** WebSocket Secure (WS sobre TLS).
- **JsSIP:** librería JavaScript que implementa SIP sobre WebSocket en el browser.
- **DTLS-SRTP:** cifrado del audio en WebRTC (obligatorio).
- **ICE / STUN / TURN:** protocolos para que dos peers detrás de NAT puedan encontrarse y conectarse.
- **rtcp-mux:** multiplexar RTP y RTCP en el mismo puerto UDP (WebRTC lo requiere).
- **Opus:** codec moderno de audio, ancho de banda variable, óptimo para WebRTC.
- **G.711 (alaw/ulaw / PCMA/PCMU):** codec viejo PSTN, 64kbps fijo, baseline universal.
- **chan_pjsip / chan_sip:** los dos módulos SIP de Asterisk (pjsip es el moderno).
- **NeotelEvents:** endpoint de la API de Neotel que devuelve eventos de llamada/agente.

---

**Suerte con la reu. Cualquier respuesta inesperada que te tiren, anotala y la procesamos después.**
