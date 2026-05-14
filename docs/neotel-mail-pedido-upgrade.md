# Mail a Neotel — Pedido de upgrade WebRTC

**Asunto:** Solicitud de upgrade Asterisk + Web Server para habilitar WebRTC en Ana Maya SA

---

Hola [Nombre del contacto Neotel],

Como conversamos hoy, les escribo formalizando el pedido para que puedan generar el ticket interno y planificar el upgrade.

## Contexto

En **Ana Maya SA** estamos desarrollando una nueva plataforma de gestión de cobranza (**AMSA Gestión**) que integra todo el flujo del agente en una única aplicación web: ficha del deudor, historial, gestiones, emails, WhatsApp y — el punto de este mail — la **telefonía**.

Hoy nuestros agentes usan **X-Lite** como softphone, conectado por SIP/UDP al Asterisk que ustedes operan para nosotros. Funciona, pero queda **fuera de la aplicación de gestión** y obliga al operador a saltar entre ventanas, sin contexto compartido entre la llamada y el caso de cobranza.

## Qué queremos hacer

Reemplazar 100% X-Lite por un **softphone embebido en el browser**, dentro de AMSA Gestión. Cuando entra una llamada del predictivo o el agente hace click-to-call, automáticamente aparece la ficha del deudor; al colgar, el agente deja la disposición vinculada a la gestión. Todo sin abrir aplicaciones externas.

Operaciones que el agente realizará desde el browser:

- Login / logout del agente
- Asignación / desasignación a campañas
- Cambio de estado (disponible, en descanso, tiempo administrativo) con motivos
- Recepción de llamadas del marcador predictivo (atención automática)
- Click-to-call sobre los teléfonos del deudor
- Atención manual de llamadas entrantes
- Configuración de dispositivos de audio (micrófono / parlante)

La **grabación** la sigue manejando el Asterisk a nivel campaña, como hoy — Gestión no controla start/stop.

## Tecnologías que estamos usando

- **Frontend:** React + TypeScript + Vite (servido por HTTPS desde `amsagestion.anamayasa.com`).
- **Backend:** NestJS + Prisma + MySQL + Redis + BullMQ.
- **Softphone WebRTC en el browser:** librería **JsSIP** (v3.13.x), que implementa **SIP sobre WSS** (WebSocket Secure) según RFC 7118.
- **Capa de control (no audio):** consumo de la **API HTTP de Neotel** (la documentada en `neotel-us.atlassian.net/.../Integracion+API`) desde nuestro backend, para login del agente, asignación a campañas, cambio de estados, click-to-call y consumo de `NeotelEvents`.
- **Persistencia local:** guardamos sesiones de agente, eventos de estado, llamadas y la traza completa de auditoría en nuestra DB.

El **browser nunca habla directo con la API HTTP de Neotel** — siempre va por nuestro backend (las credenciales API quedan server-side).

## Estado actual de la integración (lo que ya validamos)

- ✅ **API HTTP de Neotel:** alcanzable y respondiendo. Hicimos smoke tests contra `POST /neoapi/webservice.asmx/Login` con `Externo6001` y la API contesta correctamente (devolvió error de negocio porque la extensión no estaba activa al momento de la prueba, pero la conectividad y autenticación funcionan).
- ✅ **SIP/UDP 5060:** funcionando, lo usa X-Lite hoy.
- ✅ **Backend Gestión:** ya tenemos implementado el módulo de telefonía con cliente HTTP a la API de Neotel, cifrado AES-256-GCM para credenciales SIP, sesiones de agente y manejo de estados.
- ❌ **WSS (WebRTC):** pendiente del upgrade de Asterisk + Web Server que ustedes nos confirmaron que hay que hacer.

## Lo que pedimos a Neotel

1. **Upgrade de la versión del Asterisk** que opera para Ana Maya SA, a una versión con soporte completo de WebRTC (chan_pjsip + transport WSS + DTLS-SRTP).
2. **Upgrade del Web Server** asociado a ese Asterisk.
3. Habilitar **transport WSS** en el Asterisk del tenant Ana Maya SA.
4. Cuando esté listo, necesitamos que nos pasen:
   - **URL WSS completa** (host + puerto + path). Ej. `wss://webrtc.neotel.com.ar:443/ws` o el FQDN final.
   - **Credenciales SIP para el endpoint WebRTC** de la extensión `Externo6001`. Confirmar si las actuales sirven o nos provisionan un endpoint nuevo (ej. `Externo6001-web`).
   - **Servidor STUN / TURN** que recomiendan o que nos provean.
   - **Codecs habilitados** (preferimos Opus, con G.711 alaw/ulaw como fallback).
   - Si tienen algún **ejemplo de configuración JsSIP** o documentación de cliente WebRTC funcionando, también nos ayudaría.
5. Confirmación si hay **whitelist por IP de origen** del WSS o queda abierto.

## Sobre el certificado TLS

Entendimos que para habilitar WebRTC nos van a pedir un certificado de un dominio válido. Tenemos administrado en AWS Route 53 el dominio **anamayasa.com**, donde ya tenemos servido `amsasender.anamayasa.com` y vamos a tener `amsagestion.anamayasa.com`.

Proponemos generar un subdominio dedicado para el WSS — por ejemplo **`sip.anamayasa.com`** o **`webrtc.anamayasa.com`** — apuntando por DNS a la IP del Web Server / Asterisk de ustedes. Generamos el certificado SSL con Let's Encrypt (validación DNS-01 vía Route 53), y se los entregamos para que lo instalen en el Asterisk / Web Server.

**Necesitamos que nos confirmen:**

1. **IP pública** o **CNAME destino** al que tenemos que apuntar el subdominio.
2. **Nombre de subdominio** que prefieren que usemos (sugerimos `sip.anamayasa.com`).
3. ¿Aceptan **Let's Encrypt** o requieren cert de una **CA específica**?
4. ¿Aceptan **wildcard** `*.anamayasa.com` o quieren un cert específico para el subdominio?
5. **Frecuencia y mecanismo de renovación** del cert que ustedes prefieran (Let's Encrypt se renueva cada 90 días; podemos automatizarlo y subir el nuevo cert por SFTP/API si ustedes lo soportan, o entregarlo manualmente cada vez).
6. **Formato del cert** que necesitan (PEM separado: `fullchain.pem` + `privkey.pem`, o PKCS#12, etc.).

## Timeline

Como charlamos verbalmente, idealmente nos gustaría programar el upgrade para la **semana del 18 al 22 de mayo de 2026**. Una vez que tengamos URL WSS + credenciales + certificado instalado, en 1-2 días tenemos el softphone funcionando end-to-end en el ambiente de pruebas.

## Contactos del lado nuestro

- **Técnico:** Maximiliano Di Flume — maxidiflumeri@gmail.com — [teléfono]
- **Comercial / coordinación:** [nombre + contacto si aplica]

Quedamos atentos al ticket y a cualquier información adicional que necesiten.

Saludos,
Maximiliano Di Flume
Ana Maya SA
