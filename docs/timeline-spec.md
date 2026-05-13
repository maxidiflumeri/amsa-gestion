# Timeline de Deudor — AMSA Gestión ↔ AMSA Sender

**Proyecto:** AMSA Gestión + AMSA Sender
**Módulos:**
- Gestión: `timeline` (cliente del internal-api + endpoint propio)
- Sender: `internal-api/timeline` (sub-feature del foundation internal-api)
**Fecha:** 2026-05-12
**Estado:** Implementado
**Spec relacionada:** `docs/email-sender-spec.md`, foundation `internal-api`

---

## 0. Resumen ejecutivo

Mostrar en la ficha de deudor de Gestión un tab **Timeline / Historia** que unifica, en orden cronológico, todas las acciones salientes hacia el deudor que ocurren en AMSA Sender (emails, WhatsApp Web, WhatsApp Meta/WAPI) junto con su estado (entregado, leído, abierto, click, fallido, rebote).

- Match deudor Gestión ↔ Sender por **documento** (NO por id — los sistemas conviven en producción sin relación 1:1).
- Solo se muestran **acciones salientes y sus resultados**. Conversaciones WAPI quedan fuera de scope.
- Permisos: usa `deudores.ver` (mismo permiso que el resto de la ficha).
- Sin almacenamiento local: cada apertura del tab consulta el internal-api de Sender.

---

## 1. Decisiones de diseño

### 1.1 Match por documento, no por id

Los deudores del sistema viejo (en Sender) y los nuevos (en Gestión) son entidades separadas. No hay backfill ni reconciliación. El único campo confiable común es `documento` (CUIL/DNI). Gestión envía el documento normalizado (trim) a Sender; Sender resuelve el `Deudor` por `documento` (índice ya existente en `Deudor.documento`).

- Si el deudor en Gestión no tiene documento → se devuelve respuesta vacía sin llamar a Sender.
- Si Sender no encuentra match → se devuelve `deudor: null` con `data: []`. El frontend muestra "No se encontró historial".

### 1.2 Permiso y autenticación

- Frontend → backend Gestión: permiso `deudores.ver` (es el mismo que protege la ficha).
- Backend Gestión → Sender: API key `X-Internal-Api-Key` con scope `timeline:read`. La key existente para email (`gestion-dev`) se actualizó para tener `["email:*", "timeline:read"]`.

### 1.3 Reuso del servicio existente en Sender

El método `DeudoresService.obtenerTimeline(deudorId, query)` en Sender ya construye un UNION ALL sobre 4 fuentes (WhatsApp legacy, Email envíos, Email eventos OPEN/CLICK, WAPI) con paginación y filtros. El nuevo controller `internal/timeline/por-documento/:documento` es un adaptador delgado: resuelve documento → deudorId y delega.

---

## 2. Contratos

### 2.1 Sender — `GET /api/internal/timeline/por-documento/:documento`

**Headers:** `X-Internal-Api-Key: gst_...`
**Scope requerido:** `timeline:read`

**Query params:**
- `page` (int ≥ 0, default 0)
- `size` (int 1..100, default 30)
- `canal` (`whatsapp` | `email` | `wapi`, opcional)
- `desde` (ISO8601, opcional)
- `hasta` (ISO8601, opcional)

**Response 200:**
```jsonc
{
  "deudor": {           // null si no hay match por documento
    "id": 12345,
    "idDeudor": 9876,
    "nombre": "Juan Pérez",
    "documento": "20-30000000-1",
    "empresa": "PEUGEOT",
    "nroEmpresa": "001"
  },
  "data": [
    {
      "id": "email-envio-42",
      "canal": "email",
      "tipo": "envio",
      "fecha": "2026-05-10T15:30:00.000Z",
      "detalle": {
        "asunto": "Recordatorio cuota",
        "templateNombre": "recordatorio-v3",
        "estado": "delivered"
      },
      "campaniaId": null,
      "campaniaNombre": null,
      "contactoId": 7
    },
    // ...
  ],
  "total": 47,
  "page": 0,
  "size": 30,
  "totalPages": 2
}
```

### 2.2 Gestión — `GET /timeline/deudores/:id`

**Permiso:** `deudores.ver`

Recibe los mismos query params y devuelve la misma forma. Internamente:
1. Carga deudor por id (`DeudoresService.findOne`).
2. Si no existe → 404.
3. Si existe pero no tiene `documento` → devuelve `{ deudor: null, data: [], total: 0, ... }` sin llamar a Sender.
4. Si tiene documento → reenvía a Sender.

---

## 3. Frontend

### 3.1 Estructura

- `frontend/src/types/timeline.ts` — tipos (`TimelineEntry`, `TimelineResponse`, `TimelineQuery`, `TimelineCanal`).
- `frontend/src/api/timeline.ts` — `timelineApi.porDeudor(deudorId, query)`.
- `frontend/src/components/deudores/TimelineDeudorTab.tsx` — UI.

### 3.2 UI

- Tab "Timeline" como **tab top-level** en `TabsPanel` (junto a "Datos del deudor", "Lista de deudores", "Política"), índice 3.
- El antiguo tab "Emails" interno de la ficha se eliminó: los envíos de Gestión van por Sender y aparecen unificados en este Timeline.
- Filtros: canal (select), desde (date), hasta (date).
- Lista de cards con borde izquierdo coloreado por canal (paleta replicada del timeline de Sender):
  - WhatsApp Web → `#7B1FA2` (PhonelinkIcon)
  - Email envío → `info.main` (EmailIcon)
  - Email open → `info.main` (MarkEmailReadIcon)
  - Email click → `#ff9800` (AdsClickIcon)
  - WAPI → `#25D366` (WhatsAppIcon)
- Cada card muestra: canal+tipo, chip de estado, fecha, asunto/mensaje/template/URL/error/campaña según corresponda.
- Paginación inferior (20 por página).
- Estados vacíos:
  - Sin documento en Gestión → alerta info "Este deudor no tiene documento cargado".
  - Documento presente pero sin match en Sender → alerta "No se encontró historial. Es posible que el deudor exista solo en Gestión".
  - Match OK pero sin resultados con los filtros → "Sin gestiones registradas con los filtros aplicados".

### 3.3 Lazy fetch

El componente se monta solo cuando `selectedTab === 3` (no necesita guard `active` porque el padre desmonta al cambiar de tab).

---

## 4. Cambios estructurales

### Sender
- `internal-api/features/timeline/` — nueva sub-feature (DTO + controller + module).
- `internal-api.module.ts` — importa `InternalTimelineModule`.
- `.env` — `INTERNAL_API_KEYS` ahora incluye scope `timeline:read`.

### Gestión
- `modules/timeline/` — nuevo módulo (DTO + controller).
- `email-sender/sender-http.client.ts` — método `timelinePorDocumento` + tipos `SenderTimelineEntry`/`Response`/`Query`.
- `email-sender/email-sender.module.ts` — ahora exporta `SenderHttpClient`.
- `app.module.ts` — registra `TimelineModule`.
- Frontend: tipos, api client, componente, integración en `FichaDeudor`.

---

## 5. Out of scope (deferred)

- Conversaciones WAPI entrantes (chats con el deudor).
- Llamadas telefónicas (Neotel) — siguiente fase.
- Push de eventos en tiempo real (hoy es pull on-demand).
- Match por id Sender↔Gestión (mientras los sistemas convivan, no aplica).
