# Inicio — Fase 1 "Tu día"

> Estado: **implementada y auditada el 16/10/2026, sin desplegar.** Diseño sobre HEAD `7caab24`. Lo que cambió al
> auditar está en [§12](#12-lo-que-cambió-después-de-la-auditoría-16102026), que manda sobre el resto. El backfill D2 se
> descartó (§4.2).
> Maqueta de referencia (aprobada por el usuario como primera versión): https://claude.ai/artifact/52JRi7yDnHqqnqySTTmjWs
> La Fase 2 ("La operación": cobrado, equipo, carteras, permiso `inicio.ver_equipo`) **no entra ahora**. Esta fase solo le
> deja el lugar (§6.1).

Convención de este documento:
- **[V]**: verificado contra el código en `7caab24`, con `archivo:línea`.
- **[S]**: suposición. Tiene que confirmarse donde se indica.

---

## 0. Decisiones para el usuario

Si el usuario no responde, se sigue con la recomendada. Todas están incluidas en el plan tal como se recomiendan.

| # | Decisión | Recomendación |
|---|---|---|
| **D1** | **Las fechas de promesas y de cuotas se comparan por día calendario.** Hoy una promesa "para el 17/10" se cierra como INCUMPLIDA a las 2 AM **del mismo 17/10**, y no se puede cargar una promesa para hoy (§2.1). Sin este arreglo, "Vencen hoy" da siempre 0 en prod | **Arreglarlo en esta fase** (3 comparaciones, sin tocar datos guardados) |
| **D2** (descartada: en prod no hay convenios sin autor) | **`convenio.usuarioId` de los convenios ya cargados está en NULL** (el alta no lo completa). Se puede recuperar de la auditoría (`transaccion` CREATE de `Convenio`) | **Script de backfill con `--dry-run`**, que corre el usuario después del deploy |
| **D3** | **En la agenda, una promesa cerrada por un pago dice "Cumplida", no "Pagó"**. El sistema la cierra con **cualquier** pago, de cualquier origen y monto (§2.2) | **"Cumplida"**, con la fecha del cierre. Sin monto pagado |
| **D4** | **"Gestiones hoy" se compara con tu promedio a la misma hora**, no con el promedio de días completos. A las 10 de la mañana, el promedio de días completos daría siempre ▼ | **A la misma hora**, sobre los últimos 7 días con al menos una gestión |
| **D5** | **Ctrl+K abre el buscador solo en Inicio**, no en toda la app | **Solo en Inicio**. Global es la Fase 2 o después. **Actualizado 22/10/2026:** pasó a ser global (el buscador de la barra superior, `BuscadorGlobal`) e Inicio ya no escucha el atajo; ver CHANGELOG 2026-10-22 |
| **D6** | **"Gestión" = comentario con `origen = 'manual'`** del usuario. No cuentan los de acción masiva (`ACCION_MASIVA`) ni los del cupón (`CUPON_CLAVE`), aunque lleven su `usuarioId` | **Solo `manual`** |

---

## 1. Qué ve cada rol, bloque por bloque

Roles de prod leídos el 16/10 (dato del pedido, no reverificado): **ADMIN** (4 usuarios, todos los permisos) y
**OPERADOR** (8 usuarios, 13 permisos: `deudores.ver`, `comentarios.ver`, `comentarios.crear`, `convenios.ver`,
`empresas.ver`, `importacion.ver_historial`, `plantillas_import.ver`, `parametros.ver`, `politicas.ver`, `reportes.ver`,
`reportes.ejecutar`, `telefonia.usar` y `telefonia.click_to_call`).

Cada bloque decide solo por permisos, no por el nombre del rol. Un rol a medida ve la combinación que le toque.

| # | Bloque | Permiso que lo condiciona | OPERADOR | ADMIN |
|---|---|---|---|---|
| B1 | **Saludo** ("Buen día, Carolina", fecha larga y una línea de estado) | ninguno | Sí. La línea dice "Llevás N gestiones hoy" o "Todavía no registraste gestiones hoy" | Sí. Si tiene promesas que vencen hoy: "· N promesas tuyas vencen hoy" |
| B2 | **Buscador de casos** (botón con aspecto de campo + Ctrl+K, abre `BuscadorAvanzadoModal`) | `deudores.ver` | Sí | Sí |
| B3 | **Accesos rápidos** (hasta 4, en este orden de prioridad): Gestión (`deudores.ver`), Nueva importación (`importacion.ejecutar`), Historial de importaciones (`importacion.ver_historial`, **solo si no tiene** `importacion.ejecutar`), Reportes (`reportes.ver`), Tableros (`dashboards.ver`) | el de cada acceso | Gestión, Historial, Reportes | Gestión, Nueva importación, Reportes, Tableros |
| B4 | **"Tu día": 4 indicadores** | `comentarios.ver` o `comentarios.crear` | Gestiones hoy · Casos trabajados hoy · Gestiones de la semana · Casos de la semana | Gestiones hoy · Casos trabajados hoy · **Promesas tomadas** · **Vencen hoy** (los dos últimos, con `promesas.ver`) |
| B5 | **"Tus gestiones, últimos 14 días"** (barras chicas + total de la semana en el encabezado) | igual que B4 | Sí | Sí |
| B6 | **"Retomá donde quedaste"**: los últimos 8 casos con una gestión manual tuya en los últimos 30 días | `comentarios.ver` **y** `deudores.ver` | Sí | Sí |
| B7 | **"Tu agenda"**: promesas que tomaste y cuotas de convenios que armaste. Pestañas Hoy · Próximos 7 días · Sin cumplir | `promesas.ver` o `convenios.crear`. Dentro, las promesas con `promesas.ver` y las cuotas con `convenios.ver` | **No** (no tiene ninguno de los dos, y no crea promesas ni convenios) | Sí |
| B8 | **Importaciones**: las tuyas en curso (socket) y las tuyas terminadas hoy | `importacion.ver_historial`, y **solo si hay alguna** | En la práctica no: el operador no importa (sin `importacion.ejecutar`), así que nunca tiene una suya | Sí, cuando hay |
| B9 | **Actividad reciente** (6 eventos de Gestión de la auditoría) | `auditoria.ver`. Con `auditoria.ver_todos` el título es "Actividad reciente" y muestra la de todos; sin él, "Tu actividad reciente" | No | Sí, de todos |
| B10 | **"Tus reportes"**: tus últimas 5 ejecuciones de los últimos 7 días | `reportes.ver` | Sí | Sí |
| — | **Fase 2 "La operación"** | `inicio.ver_equipo` (Fase 2) | — | — (no se dibuja nada en la Fase 1) |

### 1.1 La página del operador, completa

De arriba hacia abajo, en escritorio:
1. Saludo + accesos (Gestión, Historial, Reportes) y el buscador a todo el ancho.
2. Fila de 4 indicadores: Gestiones hoy (con sparkline de 7 días y la comparación "a esta hora"), Casos trabajados hoy
   (contra ayer a esta hora), Gestiones de la semana, Casos de la semana.
3. Columna principal (8/12): **Retomá donde quedaste** (8 filas).
4. Columna lateral (4/12): **Tus gestiones, últimos 14 días** y **Tus reportes**.

No queda ningún hueco: la regla de columnas de §6.2 ubica los bloques según los que existan.

---

## 2. Hallazgos que cambian el diseño

### 2.1 Las promesas y las cuotas se cierran un día antes [V]

- El frontend manda la fecha de la promesa como `YYYY-MM-DD` (input date, `NuevoPagoModal.tsx:87`). El backend hace
  `new Date(dto.fechaPromesa)` (`promesas.service.ts:113`), que es **00:00 UTC** = las 21:00 del día anterior en
  Argentina.
- El contenedor corre con `TZ=America/Argentina/Buenos_Aires` (`Dockerfile.backend:6`). `hoy0.setHours(0,0,0,0)` da las
  **03:00 UTC** de hoy.
- **Consecuencias:**
  - **Alta** (`promesas.service.ts:116-120`): una promesa para hoy (`hoy 00:00Z`) es `< hoy0 (03:00Z)` → 400 "no puede
    ser anterior a hoy". **No se puede cargar una promesa para hoy.**
  - **Cron de las 2 AM** (`promesas.service.ts:283-289`, `fechaPromesa < hoy0`): la promesa del día D (`D 00:00Z`) ya es
    menor que `D 03:00Z` → **se evalúa la madrugada de su propio día** y, sin pago, queda INCUMPLIDA (y el caso pasa a
    SIT-021) antes de que el deudor tenga el día para pagar.
  - **Cron de cuotas de las 3 AM** (`convenios.service.ts:240-252`, `fechaVencimiento < now`): la cuota del día D
    (`D 00:00Z`) pasa a VENCIDA la madrugada de su propio día. Las cuotas AUTOMATICO (`:64-69`) y LIBRE (`:134`) se
    guardan igual, a las 00:00Z.
- **La convención del repo** para fechas sin hora es "día calendario guardado a las 00:00 UTC, que se lee por la parte de
  fecha del ISO": `fechaDelCedente` (`frontend/src/utils/fechas.ts:18-28`). El arreglo (D1) **no toca los datos**: cambia
  las tres comparaciones para que comparen días calendario (§5.6).
- **Verificar en prod antes del deploy** (lo corre el usuario, solo lectura, receta en la memoria "Prod DB query vía SSM"):
  ```sql
  SELECT TIME(fechaPromesa) h, COUNT(*) FROM promesa_pago GROUP BY h;                -- se espera 00:00:00
  SELECT COUNT(*) FROM promesa_pago
   WHERE estado='INCUMPLIDA' AND DATE(cerradaEn) = DATE(fechaPromesa);              -- cerradas el mismo día
  SELECT TIME(fechaVencimiento) h, COUNT(*) FROM cuota_convenio GROUP BY h;
  ```
  Las promesas ya cerradas de más no se reabren (fuera de alcance; se informa el número).
- **Efecto colateral conocido, fuera de alcance:** la ficha muestra la fecha de la cuota con
  `new Date(...).toLocaleDateString('es-AR')` (`FichaConveniosTab.tsx:190`) y la de la promesa al anularla
  (`FichaDeudor.tsx:425`), así que hoy las muestra **un día antes**. ~~Se anota como deuda~~ **Arreglado después de la
  auditoría** (§12): esas dos y `FichaPagosTab.tsx:101` usan `fechaDelCedente`.

### 2.2 Qué pagos cierran una promesa hoy [V]

- `cerrarCumplidas` (`promesas.service.ts:263-284`) y `procesarVencidas` (`:286-325`) suman **todos** los pagos del caso
  (`sumPagosPorDeudor`, `:67-76`, sin filtro por `origen`) y la cierran CUMPLIDA si la suma supera `pagosAlCrear + EPS`.
- Cuenta cualquier origen: `MANUAL` (`pagos.service.ts:58`), `IMPORT_PAGOS` (`pagos.processor.ts:671`),
  `IMPORT_ACTUALIZACION` (`actualizaciones.processor.ts:1035,1154`), los del CA (`casos-cedente.processor.ts:931`),
  `CONVENIO` y `CLAVE_PAGO`. Cualquier monto: un pago de $1 cierra una promesa de $50.000.
- **Regla de la Fase 1 (D3):** Inicio **no recalcula** nada. Muestra `promesa_pago.estado` tal como lo dejó el sistema, y
  dice "Cumplida", no "Pagó".
- Esto **no** es "Cobrado". El de la Fase 2 suma solo bajadas del sistema (`IMPORT_PAGOS`, `IMPORT_ACTUALIZACION`, CA y
  `CLAVE_PAGO`, a definir en esa fase). Ningún número de la Fase 1 suma importes de `pago`.

### 2.3 `convenio.usuarioId` nunca se completa [V]

- `ConveniosController.create` (`convenios.controller.ts:28-30`) pasa el DTO tal cual. El DTO acepta un `usuarioId`
  opcional (`create-convenio.dto.ts:20-22`), que el modal no manda (`NuevoConvenioModal.tsx:102-112`).
- `createAutomatico`/`createLibre` lo copian (`convenios.service.ts:82,123`), así que queda NULL. Los convenios del cupón
  sí lo tienen (`cupon.service.ts:531`).
- Sin el arreglo, la agenda de cuotas de un admin está siempre vacía. Con el arreglo y sin el backfill (D2), solo aparecen
  los convenios nuevos.

### 2.4 Los días se agrupan en Node, no en SQL [V]

- `comentario.fecha` es `DATETIME` y Prisma escribe en UTC. `SET time_zone = "-03:00"` (`prisma.service.ts:12`) corre en
  una sola conexión del pool y no afecta a columnas `DATETIME`.
- `DATE_FORMAT(c.fecha, '%Y-%m-%d')` (lo que usa el tablero, `dashboards.service.ts:479`) agrupa por día **UTC**: una
  gestión de las 22:00 cae al día siguiente.
- Inicio trae las filas (solo `fecha` y `deudorId`) y agrupa en Node, que corre en hora de Argentina. Son pocas filas
  (§5.2). El bug del tablero se anota, pero no se toca.

### 2.5 Otros datos verificados

- **Endpoints sin `@Permisos`:** `JwtAuthGuard` y `PermisosGuard` son `APP_GUARD` (`auth.module.ts:27-32`). Sin el
  decorador, el endpoint lo usa cualquier usuario con sesión (`permisos.guard.ts:29`). Los permisos del usuario llegan en
  `req.usuario.permisos` y se leen con `@UsuarioActual()` (`decorators.ts:9-14`).
- **Gestiones manuales:** solo las crea `ComentariosService.create` con `origen: dto.origen ?? 'manual'`
  (`comentarios.service.ts:20`). El panel manda `origen: 'manual'` (`ComentariosPanel.tsx:103`). Los otros dos orígenes
  son `ACCION_MASIVA` (`acciones.processor.ts:338`) y `CUPON_CLAVE` (`cupon.service.ts:795`). El campo existe desde el
  primer commit del módulo (`0ef5637`), con 'manual' por defecto.
  - **[S]** No hay filas con `origen` NULL escritas por personas. Se verifica en prod con
    `SELECT origen, COUNT(*) FROM comentario GROUP BY origen`. Si aparecen NULL con `usuarioId`, se decide si se suman.
- **Índices:**
  - `comentario` tiene `[usuarioId]`, `[fecha]` y `[deudorId, fecha]` (`schema.prisma:31-34`), pero ninguno compuesto por
    usuario y fecha;
  - `promesa_pago` tiene `[estado, fechaPromesa]`;
  - `convenio` tiene `[usuarioId]`;
  - `cuota_convenio` solo tiene `[convenioId]`;
  - `import_progreso` tiene `[finishedAt]`;
  - `ejecucion_reporte` tiene `[usuarioId, createdAt]`.
- **`GET /reportes/ejecuciones`** con `reportes.ver_ejecuciones` devuelve las de **todos** (`reportes.controller.ts:300-307`).
  No sirve para "Tus reportes" de un admin: Inicio trae las propias en su endpoint.
- **`GET /transacciones`** (`auditoria.ver`) acota a las propias sin `auditoria.ver_todos` (`transacciones.controller.ts:18`).
  Se reusa tal cual desde el frontend.
- **`/gestion`** abre el último caso de `localStorage.last_deudor_id` (`DeudoresPage.tsx:13-23`). El cupón ya hace el
  rodeo de guardar el id y recargar (`GenerarCuponDialog.tsx:351-355`).
- **El DrillDown** abre `/deudores/:id`, que no existe en `AppRoutes.tsx` (`DrillDownDialog.tsx:89-91`).
- **Importaciones en curso:** `useImportacionesEnCurso()` lee `importsEnCurso` del `NotificacionesContext`, que se
  alimenta por socket. `EstadoCargaDto` trae `usuarioId` (`types/importProgreso.ts:54`). `TarjetaProgreso variante="compacta"` se reusa
  como en `ImportEnCursoItem.tsx:32`.
- **Reportes en vivo:** `useReportesSocket(handlers)` abre el namespace `/reportes`, con los eventos
  `ejecucion:progreso`, `:completado` y `:fallido` (`pages/reportes/hooks/useReportesSocket.ts:48-68`).
- **Wiki:** `01-primer-dia.md` declara `rutas: /` y `rutaPrincipal: /`. `verificar-ayuda.mjs:80-95` exige exactamente una
  página principal por ruta.

---

## 3. Impacto y riesgos

| Afectado | Qué cambia | Si sale mal |
|---|---|---|
| Inicio (`/`) | Página nueva, la primera que ve todo usuario al entrar | Una excepción del endpoint deja la página sin datos. Cada bloque maneja su error por separado (§6.4); el saludo y el buscador nunca dependen del backend |
| `GET /api/inicio/mi-dia` | Endpoint nuevo, sin auditoría, que se llama cada 5 minutos por pestaña (§6.3) | Con 12 usuarios activos son ~150 pedidos por hora. Cada uno hace ≤10 queries indexadas |
| `comentario` | Índice nuevo `[usuarioId, origen, fecha]` (aditivo) | El `db push` crea el índice en línea (InnoDB). **[S]** Con una tabla grande puede tardar unos segundos y no requiere `--accept-data-loss` |
| Promesas (alta + cron 2 AM) | Comparación por día calendario (D1) | Si queda mal, se cierran de más (como hoy) o **de menos**: una promesa vencida que nunca se cierra. Lo cubren los tests de §9.1 |
| Cuotas (cron 3 AM) | Comparación por día calendario (D1) | Igual que las promesas |
| Alta de convenios | `usuarioId` sale del JWT | Ninguno: el campo no lo leía nadie |
| `/gestion` | Acepta `?deudor=ID` | Un id inválido o inexistente: ver §6.5 |
| DrillDown de tableros | Abre `/gestion?deudor=ID` en otra pestaña | La pestaña nueva pisa `last_deudor_id`, que es compartido entre pestañas. Es aceptable: es el caso que el usuario pidió abrir |

**Datos ya cargados que quedan inconsistentes:**
- las promesas cerradas un día antes antes del deploy (§2.1). No se reabren y se informa el número;
- los convenios sin `usuarioId` que el backfill no pueda resolver (sin registro de auditoría). El script los cuenta.

---

## 4. Datos

### 4.1 Schema (una línea, aditiva)

En `model comentario` (`backend/prisma/schema.prisma:20-35`), debajo de los índices existentes, se agrega:

```prisma
  @@index([usuarioId, origen, fecha], map: "Comentario_usuarioId_origen_fecha_idx")
```

- **Por qué:** todas las consultas de B4, B5 y B6 son `usuarioId = ? AND origen = 'manual' AND fecha >= ?`: igualdad,
  igualdad y rango. Con el índice actual `[usuarioId]` recorre también las miles de `ACCION_MASIVA` de un admin.
- **No se toca** `@@index([usuarioId], map: "Comentario_usuarioId_fkey")`. Lo usa la FK, y sacarlo es un cambio
  destructivo para el `db push` del deploy.
- **Sin backfill.** `db push` sin `--accept-data-loss` alcanza (es un `CREATE INDEX`).
- **Verificación local:** `npx prisma db push` y después
  `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma`, que
  tiene que salir vacío.

Ningún otro modelo cambia. `promesa_pago` y `convenio` son tablas chicas (solo cargan admins) y sus índices alcanzan
(§5).

### 4.2 Backfill de `convenio.usuarioId` (D2)

> **Descartado el 16/10/2026:** medido en prod (solo lectura), hay 1 convenio en total y ya tiene `usuarioId`; 0 promesas cargadas. No se escribió el script. Lo que sigue de esta sección queda como registro.

`backend/prisma/scripts/backfill-convenio-usuario.ts`, idempotente, con `--dry-run` por defecto y `--aplicar` para
escribir. Se toma el patrón de `limpiar-notificaciones-atraso.ts`:

1. `convenios = convenio.findMany({ where: { usuarioId: null }, select: { id, createdAt } })`.
2. `auditorias = transaccion.findMany({ where: { entidad: 'Convenio', tipo: 'CREATE', estado: 'OK', entidadId: { in: ids.map(String) } }, select: { entidadId, usuarioId, createdAt } })`.
   `entidadId` sale de la respuesta con `String(result.id)` (`audit.interceptor.ts:127-128`) [V].
3. Por convenio: si hay exactamente una auditoría con `usuarioId` no nulo y una diferencia `|createdAt|` menor a 60 s,
   ese es el candidato. Con 0 auditorías → `sinAuditoria`; con más de una o fuera de ventana → `ambiguos`.
4. Imprime los totales (`candidatos`, `sinAuditoria`, `ambiguos`) y los primeros 20 ids de cada grupo. Con `--aplicar`,
   hace `updateMany({ where: { id, usuarioId: null }, data: { usuarioId } })` por convenio. El `usuarioId: null` del
   `where` es lo que lo hace idempotente.
5. Logger, sin `console.log` de datos personales: solo ids.

Lo corre **el usuario** contra prod después del deploy, primero en `--dry-run`. Se deja anotado en el CHANGELOG.

---

## 5. Backend

### 5.1 Módulo

```
backend/src/modules/inicio/
  inicio.module.ts         # controllers: [InicioController], providers: [InicioService]. PrismaModule es global
  inicio.controller.ts     # GET /inicio/mi-dia — SIN @Permisos, SIN @Audit
  inicio.service.ts        # arma el DTO bloque por bloque según permisos
  inicio-calculos.ts       # funciones puras: buckets por día, "a esta hora", semana, recortes (testeables sin Prisma)
  dto/mi-dia.dto.ts        # interfaces del contrato (§5.3), exportadas
  inicio.service.spec.ts
  inicio-calculos.spec.ts
```

Se registra en `backend/src/app.module.ts`, en el arreglo `imports`, junto a `TimelineModule`.

### 5.2 Endpoint

`GET /api/inicio/mi-dia`

- **Permiso:** ninguno a nivel endpoint (cualquier usuario con sesión). Cada bloque se calcula **solo** si el usuario
  tiene su permiso (§1). Si no lo tiene, va `null`, y no se ejecuta su query.
- **Entrada:** nada. Sin query params en la Fase 1. El usuario sale de `@UsuarioActual()` (`sub`, `permisos`).
- **Errores:**
  - sin sesión → 401 (guard global);
  - si un bloque falla, **no** tumba la respuesta: ese bloque va `null`, su nombre va en `errores[]` y se loguea `error`
    con el stack (§5.5);
  - solo un fallo antes de empezar (sin usuario) devuelve 500.
- **Respuesta:** `MiDiaDto` (§5.3).
- **No se audita.** Es una lectura que se repite sola cada 5 minutos. El `LoggingInterceptor` global ya deja el request.

### 5.3 Contrato (el frontend copia este bloque tal cual a `frontend/src/api/inicio.ts`)

```ts
/** GET /api/inicio/mi-dia. Fechas `dia`: 'YYYY-MM-DD' en hora de Argentina. Instantes: ISO 8601 UTC. */
export interface MiDiaDto {
    generadoEn: string;                 // ISO del momento del cálculo
    hoy: string;                        // 'YYYY-MM-DD' local
    /** Bloques que el backend intentó calcular y fallaron. El frontend muestra el aviso en ese bloque. */
    errores: Array<'gestiones' | 'retomar' | 'agenda' | 'promesas' | 'importacionesHoy' | 'reportes'>;
    gestiones: GestionesDto | null;              // comentarios.ver || comentarios.crear
    retomar: RetomarItemDto[] | null;            // comentarios.ver && deudores.ver
    agenda: AgendaDto | null;                    // promesas.ver || convenios.crear
    promesas: IndicadoresPromesasDto | null;     // promesas.ver
    importacionesHoy: ImportacionTerminadaDto[] | null; // importacion.ver_historial
    reportes: EjecucionResumenDto[] | null;      // reportes.ver
}

export interface GestionesDto {
    hoy: number;                        // comentarios manuales míos con fecha >= hoy 00:00 local
    casosHoy: number;                   // deudorId distintos de esos
    ayerALaMismaHora: { gestiones: number; casos: number };
    /** Promedio de gestiones hasta esta misma hora del día, en los últimos ≤7 días con al menos una gestión
     *  (buscados entre los 13 días anteriores a hoy). null si no hay ninguno. */
    promedioALaMismaHora: number | null;
    diasBase: number;                   // cuántos días entraron en ese promedio (0..7)
    semana: { desde: string; gestiones: number; casos: number; diasConGestion: number }; // desde = lunes 'YYYY-MM-DD'
    /** 14 entradas sin huecos, de hace 13 días a hoy (incluido), en orden. */
    serie: Array<{ dia: string; gestiones: number; casos: number }>;
    /** true si se alcanzó el tope de filas leídas (§5.4 G1). Los números son un piso. */
    truncado: boolean;
}

export interface RetomarItemDto {
    deudorId: number;
    nombre: string;                     // `${nombre} ${apellido}` recortado
    documento: string;                  // completo: el usuario tiene deudores.ver
    empresa: string;                    // empresa.nombre
    ultimaGestion: string;              // ISO de mi último comentario manual en el caso
    ultimoTexto: string;                // ese texto, máx. 120 caracteres + '…'
    gestionesMias30d: number;
    estadoGestion: string | null;       // parametro.descripcion del estado de gestión actual del caso
    estadoSituacion: string | null;     // parametro.descripcion del estado de situación actual
}

export type AgendaTipo = 'PROMESA' | 'CUOTA';
export interface AgendaItemDto {
    tipo: AgendaTipo;
    id: number;                         // promesa_pago.id o cuota_convenio.id
    deudorId: number;
    nombre: string;
    documento: string;
    empresa: string;
    dia: string;                        // fecha calendario de la promesa o del vencimiento de la cuota
    monto: number | null;               // promesa.monto (puede ser null) o cuota.importe
    /** PROMESA: VIGENTE | CUMPLIDA | INCUMPLIDA. CUOTA: PENDIENTE | PAGADA | VENCIDA. */
    estado: string;
    cerradaEn: string | null;           // PROMESA: cerradaEn. CUOTA: fechaPago
    nroCuota: number | null;            // solo CUOTA
    cantCuotas: number | null;          // solo CUOTA
    observacion: string | null;         // PROMESA: observacion recortada a 80
}
export interface AgendaDto {
    hoy: AgendaItemDto[];               // dia = hoy (cualquier estado salvo ANULADA)
    proximos: AgendaItemDto[];          // hoy < dia <= hoy+7, PROMESA VIGENTE / CUOTA PENDIENTE
    sinCumplir: AgendaItemDto[];        // hoy-7 <= dia < hoy, PROMESA INCUMPLIDA / CUOTA VENCIDA
    totales: { hoy: number; proximos: number; sinCumplir: number }; // antes del recorte
    limite: number;                     // 50: tope por lista
    incluye: { promesas: boolean; cuotas: boolean };                // qué tipos entraron según permisos
}

export interface IndicadoresPromesasDto {
    tomadas7d: number;                  // mías con createdAt >= hoy-6 00:00 local
    /** Mías con dia en [hoy-30, hoy) ya cerradas como CUMPLIDA o INCUMPLIDA (las ANULADA no cuentan). */
    vencidas30d: { total: number; cumplidas: number };
    vencenHoy: { cantidad: number; monto: number }; // mías VIGENTE con dia = hoy; monto suma los no nulos
}

export interface ImportacionTerminadaDto {
    remesaId: number;
    empresa: string;
    nombre: string;                     // remesa.nombre
    numeroRemesa: string;
    resultado: string | null;           // import_progreso.resultado: OK | CON_ERRORES | CON_ADVERTENCIAS | SIN_FILAS | FALLIDA | CANCELADA
    terminadaEn: string;                // import_progreso.finishedAt
    ok: number;
    err: number;
}

export interface EjecucionResumenDto {
    id: number;
    plantilla: string;                  // plantilla_reporte.nombre
    estado: 'PENDIENTE' | 'EJECUTANDO' | 'FINALIZADA' | 'FALLIDA' | 'CANCELADA';
    progreso: number;                   // 0..100
    formato: string | null;
    totalFilas: number | null;
    creadaEn: string;
    terminadaEn: string | null;
    descargable: boolean;               // estado FINALIZADA && archivoPath != null
}
```

### 5.4 Consultas (todas con `usuarioId = yo`)

Fechas, con los helpers de §5.6. `hoy0` = hoy a las 00:00 local, y `ymd(d)` = el día local `YYYY-MM-DD` de un instante.

| # | Bloque | Consulta | Índice | Volumen esperado [S] |
|---|---|---|---|---|
| G1 | gestiones | `comentario.findMany({ where: { usuarioId, origen: 'manual', fecha: { gte: hoy0 - 13 días } }, select: { fecha, deudorId }, orderBy: { fecha: 'asc' }, take: 20_000 })`. Si devuelve 20.000, `truncado = true` + `warn` | nuevo `[usuarioId, origen, fecha]` | Un operador: ~50-300 por día → ≤4.200 filas |
| G2 | retomar | `comentario.groupBy({ by: ['deudorId'], where: { usuarioId, origen: 'manual', fecha: { gte: hoy0 - 30 días } }, _max: { fecha: true }, _count: { _all: true }, orderBy: { _max: { fecha: 'desc' } }, take: 8 })` | el mismo | Group sobre ≤9.000 filas |
| G3 | retomar | Por cada uno de los ≤8: `comentario.findFirst({ where: { deudorId, usuarioId, origen: 'manual' }, orderBy: { fecha: 'desc' }, select: { texto, fecha } })`, en `Promise.all` | `[deudorId, fecha]` | 8 lecturas puntuales |
| G4 | retomar / agenda | `deudor.findMany({ where: { id: { in } }, select: { id, nombre, apellido, documento, empresa: { select: { nombre } }, estadoGestion: { select: { descripcion } }, estadoSituacion: { select: { descripcion } } } })`. **Una sola** con los ids de retomar y de agenda juntos | PK | ≤158 |
| A1 | agenda (promesas.ver) | `promesa_pago.findMany({ where: { usuarioId, estado: { in: ['VIGENTE','CUMPLIDA','INCUMPLIDA'] }, fechaPromesa: { gte: utc(hoy-7), lt: utc(hoy+8) } } })` | `[estado, fechaPromesa]` | Tabla chica: solo los admins cargan promesas |
| A2 | agenda (convenios.ver) | `convenio.findMany({ where: { usuarioId, estado: 'ACTIVO' }, select: { id, deudorId, cantCuotas } })`, y después `cuota_convenio.findMany({ where: { convenioId: { in }, estado: { in: ['PENDIENTE','PAGADA','VENCIDA'] }, fechaVencimiento: { gte: utc(hoy-7), lt: utc(hoy+8) } } })` | `convenio.[usuarioId]` + `cuota.[convenioId]` | Cientos de convenios como mucho. **Sin índice nuevo en `cuota_convenio`**: se entra por `convenioId` |
| P1 | promesas | `promesa_pago.count({ where: { usuarioId, createdAt: { gte: hoy0 - 6 días } } })` | FK implícita de `usuarioId` [S] | Tabla chica |
| P2 | promesas | `promesa_pago.groupBy({ by: ['estado'], where: { usuarioId, estado: { in: ['CUMPLIDA','INCUMPLIDA'] }, fechaPromesa: { gte: utc(hoy-30), lt: utc(hoy) } }, _count: true })` | `[estado, fechaPromesa]` | Tabla chica |
| P3 | promesas | `vencenHoy` sale de A1 si ya se ejecutó. Si no (con `promesas.ver` A1 siempre se ejecuta), `findMany` VIGENTE con `dia = hoy` | — | — |
| I1 | importacionesHoy | `import_progreso.findMany({ where: { finishedAt: { gte: hoy0 }, remesa: { usuarioCreadorId: usuarioId } }, include: { remesa: { select: { nombre, numeroRemesa, empresa: { select: { nombre } } } } }, orderBy: { finishedAt: 'desc' }, take: 10 })` | `[finishedAt]` | Las terminadas hoy, de todos: decenas |
| R1 | reportes | `ejecucion_reporte.findMany({ where: { usuarioId, createdAt: { gte: hoy0 - 6 días } }, include: { plantilla: { select: { nombre } } }, orderBy: { createdAt: 'desc' }, take: 5 })` | `[usuarioId, createdAt]` | 5 filas |

- Los bloques se calculan en paralelo (`Promise.allSettled` sobre G, A, P, I y R), cada uno con su try/catch (§5.5).
- G4 se ejecuta después, con los ids juntos.
- **Promesas y cuotas con `utc(dia)`:** las fechas calendario se guardan a las 00:00Z (§2.1), así que el rango de "hoy"
  es `[utc(hoy), utc(hoy+1))`. El `dia` de cada ítem es `fecha.toISOString().slice(0, 10)`, **no** `ymd(fecha)`.

### 5.5 Lógica crítica (en `inicio-calculos.ts`, funciones puras con `ahora: Date` inyectable)

**Gestiones (desde las filas de G1):**
1. `dias = 14 claves` `ymd(hoy0 - 13) … ymd(hoy0)`, cada una con `{ gestiones: 0, casos: Set }`. Cada fila suma en
   `ymd(fila.fecha)`.
2. `hoy` y `casosHoy` salen de la última clave.
3. **"A esta hora":** `minutoAhora = ahora.getHours()*60 + ahora.getMinutes()`. Para cada día anterior, cuento las filas
   con `minutoDelDia(fecha) <= minutoAhora`.
   - `ayerALaMismaHora` = el día de ayer (gestiones y casos distintos);
   - `promedioALaMismaHora` = promedio de ese conteo sobre los **últimos ≤7 días anteriores con al menos una gestión en el
     día completo**, recorriendo de ayer hacia atrás los 13 días;
   - `diasBase` = cuántos entraron. Si son 0, `null`. Se redondea a 1 decimal.
4. **Semana:** `desde` = el lunes de esta semana (`getDay()`: domingo = 0 → 6 días atrás). Si cae antes de `hoy0 - 13`, no
   puede: el lunes está a 6 días como mucho. Suma gestiones, casos distintos (Set) y días con gestión desde `desde`.
5. `serie` = las 14 claves en orden, con `casos = set.size`.

**Retomar:** G2 → G3 → arma los ítems en el orden de G2. `ultimoTexto` se recorta a 120 caracteres en un límite de
palabra, más `…`. Los saltos de línea pasan a espacio.

**Agenda:**
1. Mapea A1 y A2 a `AgendaItemDto`. El `dia` es la parte de fecha del ISO.
2. **Hoy:** `dia === hoy` (cualquier estado de los traídos). **Próximos:** `hoy < dia <= hoy+7` y estado VIGENTE o
   PENDIENTE. **Sin cumplir:** `hoy-7 <= dia < hoy` y estado INCUMPLIDA o VENCIDA.
   - Una promesa CUMPLIDA de días anteriores, o una cuota PAGADA, no entra en ninguna lista.
   - **Un VIGENTE o PENDIENTE con `dia < hoy`** (el cron todavía no corrió, o falló) **va a "Sin cumplir"** con su estado
     real. Si no, se perdería en silencio.
3. **Orden:** Hoy → primero VIGENTE/PENDIENTE, después el resto, y por monto descendente. Próximos → `dia` ascendente y
   monto descendente. Sin cumplir → `dia` descendente.
4. `totales` antes de recortar a `limite = 50`.

**Indicadores de promesas:** P1 y P2. `vencenHoy` = las VIGENTE de `agenda.hoy` de tipo PROMESA, con
`monto = Σ monto ?? 0`.

**Logging (CLAUDE.md):**
- `log` intent: `mi-dia usuario=${sub} bloques=[gestiones,retomar,…]`. `log` done:
  `mi-dia usuario=${sub} gestionesHoy=${n} retomar=${k} agenda=${h}/${p}/${s} en ${ms}ms`.
- Si tarda más de 500 ms: `warn` con el tiempo de cada bloque.
- Un bloque que falla: `error` con `e.stack`, el nombre del bloque y `usuario=${sub}`. El bloque va `null` y su nombre a
  `errores`.
- G1 truncado: `warn`.
- **Nunca** se loguean documentos, nombres ni textos de comentarios: solo ids y conteos.

**Concurrencia e idempotencia:** es solo lectura y no tiene estado. Dos pestañas que piden a la vez no se afectan.

### 5.6 Fechas calendario (D1): `backend/src/common/utils/dia-local.ts`

Se agregan, sin tocar las existentes:

```ts
/** 'YYYY-MM-DD' del día local (TZ del proceso: America/Argentina/Buenos_Aires en el contenedor). */
export function ymdLocal(d: Date = new Date()): string
/** Suma n días calendario a un 'YYYY-MM-DD' (n puede ser negativo). Sin horas de por medio. */
export function sumarDiasYmd(ymd: string, n: number): string
/** El instante con que se guarda una fecha calendario: 'YYYY-MM-DD' → 00:00:00.000Z de ese día. */
export function fechaCalendarioUtc(ymd: string): Date
/** El día calendario de una fecha guardada a las 00:00Z: su parte de fecha ISO. */
export function diaCalendario(d: Date): string
```

Y se cambian tres comparaciones:

| Dónde | Hoy | Queda |
|---|---|---|
| `promesas.service.ts:116-120` (alta) | `fechaPromesa < hoy0` | `diaCalendario(fechaPromesa) < ymdLocal()` → 400 (mismo mensaje) |
| `promesas.service.ts:122-127` (tope) | `fechaPromesa > limite` (fin del día local + maxDias) | `diaCalendario(fechaPromesa) > sumarDiasYmd(ymdLocal(), maxDias)` → 400 (mismo mensaje) |
| `promesas.service.ts:289` (cron) | `fechaPromesa: { lt: hoy0 }` | `fechaPromesa: { lt: fechaCalendarioUtc(ymdLocal()) }` |
| `convenios.service.ts:243-249` (cron de cuotas) | `fechaVencimiento: { lt: now }` | `fechaVencimiento: { lt: fechaCalendarioUtc(ymdLocal()) }` |

- **Si la promesa llega con hora** (`@IsDateString` admite un ISO completo): `diaCalendario` toma la parte de fecha UTC.
  Hoy el único cliente manda `YYYY-MM-DD`. Se documenta en el JSDoc.
- **Efecto en el primer cron después del deploy:** las promesas y cuotas de **hoy** dejan de cerrarse esa madrugada. Las de
  ayer se cierran igual que antes.

### 5.7 `convenio.usuarioId` desde el JWT

En `convenios.controller.ts:28-30`:

```ts
create(@Body() dto: CreateConvenioDto, @UsuarioActual() usuario: { sub: number }) {
    dto.usuarioId = usuario?.sub ?? undefined;   // pisa lo que mande el cliente, como comentarios.controller.ts:33-34
    return this.conveniosService.create(dto);
}
```

El `@Audit` no cambia.

---

## 6. Frontend

### 6.1 Archivos

```
frontend/src/api/inicio.ts                    # contrato de §5.3 (copiado tal cual) + inicioApi.miDia()
frontend/src/utils/linkCaso.ts                # linkCaso(id) → '/gestion?deudor=ID'; leerDeudorDeUrl(search) → number | null
frontend/src/pages/Inicio.tsx                 # REESCRIBE: compone los bloques (sigue siendo el default export que importa AppRoutes)
frontend/src/pages/inicio/
  useMiDia.ts                                 # fetch + refresco (§6.3)
  formato.ts                                  # saludo(hora), fechaLarga(hoy), haceCuanto(iso, ahora), diaCorto(ymd), variacion(a, b)
  reglasBloques.ts                            # qué bloques van y en qué columna (§6.2), puro y testeable
  components/
    SaludoBuscador.tsx                        # B1 + B2 + B3, con BuscadorAvanzadoModal y Ctrl+K
    TuDiaKpis.tsx                             # B4: 4 KpiTile
    KpiTile.tsx                               # tarjeta de indicador: valor, delta, leyenda y sparkline opcional
    Sparkline.tsx                             # Recharts LineChart sin ejes, color de theme.palette
    GestionesSerieCard.tsx                    # B5: BarChart de 14 días
    RetomarCard.tsx                           # B6
    AgendaCard.tsx                            # B7: Tabs Hoy · Próximos 7 días · Sin cumplir
    ImportacionesCard.tsx                     # B8
    ActividadCard.tsx                         # B9: usa auditoriaApi.listar
    ReportesCard.tsx                          # B10: usa reportesApi.descargarEjecucion y useReportesSocket
    FilaCaso.tsx                              # fila común: iniciales, nombre, chip de empresa, línea meta, lado derecho
    BloqueEstado.tsx                          # carga (Skeleton), error ("No se pudo cargar. Reintentar") y vacío
frontend/src/pages/DeudoresPage.tsx           # acepta ?deudor=ID (§6.5)
frontend/src/pages/dashboards/components/DrillDownDialog.tsx  # línea 90 → window.open(linkCaso(id), '_blank', 'noopener')
```

**El lugar de la Fase 2:** en `Inicio.tsx`, entre B4 y las columnas, va un comentario
`{/* Fase 2 — "La operación" (inicio.ver_equipo). Ver docs/inicio-spec.md §1. */}`. No se agrega ningún componente vacío.

### 6.2 Layout y reglas de columnas (`reglasBloques.ts`)

- `PageContainer`, **sin** `PageHeader` visible: el saludo hace de encabezado.
  - El título de la pestaña lo fija `usePageTitle('Inicio')` (`hooks/usePageTitle.ts:4`, firma `(title: string)`) [V].
    `PageHeader` lo hacía con `document.title` (`PageHeader.tsx:28`).
- **Fila 1:** `SaludoBuscador` (12/12).
- **Fila 2:** `TuDiaKpis`, un CSS grid `repeat(auto-fit, minmax(200px, 1fr))`, siempre 4 tiles.
- **Fila 3:** `Grid` con `principal` (`lg=8`) y `lateral` (`lg=4`). En menos de `lg`, una sola columna: principal y
  después lateral.
  - `principal = [B7 si visible, B6 si visible]`;
  - `lateral = [B5 si visible, B8 si visible, B9 si visible, B10 si visible]`.
  - **Si `principal` queda vacía**, todo `lateral` pasa a una grilla de 2 columnas (`md=6`) a todo el ancho.
  - **Si `lateral` queda vacía**, `principal` ocupa 12/12.
- **Ningún bloque sin permiso se dibuja.** Un bloque con permiso y sin datos muestra su vacío (§6.4). B8 es la única
  excepción: sin datos no se dibuja (§1).

**Los 4 tiles de B4:**

| Tile | Valor | Delta / leyenda |
|---|---|---|
| Gestiones hoy | `gestiones.hoy` | Delta % contra `promedioALaMismaHora` ("▲ 12 % contra tu promedio a esta hora"). Con `null`: "Sin días anteriores para comparar". Sparkline con los últimos 7 de `serie` |
| Casos trabajados hoy | `casosHoy` | "Ayer a esta hora: N" |
| *(con `promesas`)* Promesas tomadas | `tomadas7d` "en 7 días" | "X % cumplidas · N de M que vencieron en 30 días". Con M = 0: "Todavía no venció ninguna" |
| *(con `promesas`)* Vencen hoy | `vencenHoy.cantidad` | `fmtMoney(monto)` + botón "Ver" que lleva a la pestaña Hoy de la agenda (scroll + `setTab`) |
| *(sin `promesas`)* Gestiones de la semana | `semana.gestiones` | "desde el lunes · N días con gestión" |
| *(sin `promesas`)* Casos de la semana | `semana.casos` | "casos distintos desde el lunes" |

- Delta: verde con ▲ si es ≥ +5 %, rojo con ▼ si es ≤ −5 %, gris con "=" en el medio. Los colores, de
  `theme.palette.success` / `error` / `text.secondary`.
- Si `gestiones` es `null` (sin permiso), B4 no se dibuja. Si viene en `errores`, se ven los 4 tiles con
  `BloqueEstado error`.

**B5:** `BarChart` de Recharts.
- 14 barras con `dia` en el eje X (`diaCorto`: "3/10"), el fin de semana con opacidad menor y hoy resaltado con
  `primary.main`.
- Tooltip "N gestiones · M casos".
- Encabezado: "Esta semana: N gestiones · M casos".
- Alto 160 px. Formateadores de `pages/dashboards/utils.ts` (`fmtNumber`, `fmtMoney`).

**B6 y B7 (filas):** `FilaCaso`, toda clickeable (`component={RouterLink} to={linkCaso(deudorId)}`).
- Lado derecho de B6: chip con `estadoGestion ?? estadoSituacion` y "hace X".
- Lado derecho de B7: `fmtMoney(monto)` (o "Sin monto") y un chip de estado:

| Estado | Chip |
|---|---|
| VIGENTE / PENDIENTE, con `dia` = hoy | "Vence hoy" (warning) |
| VIGENTE / PENDIENTE, con `dia` futuro | el día ("Lunes 19") |
| CUMPLIDA | "Cumplida" (success) |
| PAGADA | "Pagada" (success) |
| INCUMPLIDA | "Incumplida" (error) |
| VENCIDA | "Vencida" (error) |
| VIGENTE / PENDIENTE con `dia` pasado | "Sin cerrar" (error) |

  - Línea meta: `documento · Promesa` (+ observación) o `documento · Cuota N de M del convenio`.
- Pestañas de B7 con su conteo: `Hoy · totales.hoy`. Si `totales.x > limite`, al pie: "Se muestran 50 de N".

**B8:**
- **En curso:** `useImportacionesEnCurso().filter(c => c.usuarioId === usuario.id)`, cada una con
  `TarjetaProgreso variante="compacta" conectado={…}` y el link "Ver detalle" a `/historial-importaciones/:remesaId`, como
  en `ImportEnCursoItem.tsx:32-46`, **sin** el botón de cancelar.
  - `conectado` sale de `SocketContext` (`conectado: boolean`, `SocketContext.tsx:21`) [V].
- **Terminadas hoy:** `importacionesHoy`. Cada una con empresa · nombre, un chip con el resultado y la hora:

| `resultado` | Etiqueta |
|---|---|
| OK | Finalizada |
| CON_ERRORES | Con errores |
| CON_ADVERTENCIAS | Con advertencias |
| SIN_FILAS | Sin filas |
| FALLIDA | Fallida |
| CANCELADA | Cancelada |
| otro | el valor tal cual |

- Link "Historial" en el encabezado.

**B9:** `auditoriaApi.listar({ limit: 6, orderDir: 'desc', modulo: 'GESTION' })`.
- Cada fila: avatar con inicial, `usuario.nombre ?? 'Sistema'`, `resumen` y "hace X". Clic → `/auditoria`.
- Se refresca con el mismo pulso que `mi-dia` (§6.3).

**B10:** `mi-dia.reportes`.
- Fila: plantilla · formato · filas · "hace X" y a la derecha:
  - FINALIZADA con `descargable` → botón "Descargar" (`reportesApi.descargarEjecucion(id)` + el patrón de blob que use
    `ReportesEjecuciones.tsx`);
  - EJECUTANDO/PENDIENTE → `LinearProgress` con el %;
  - FALLIDA/CANCELADA → chip.
- **Solo si hay alguna EJECUTANDO/PENDIENTE**, el bloque monta un hijo que llama a `useReportesSocket`: con `progreso`
  actualiza el % local y con `completado`/`fallido` llama a `recargar()`. Así no se abre un socket `/reportes` en cada
  Inicio.
- Link "Reportes" a `/reportes/ejecuciones`.

### 6.3 Refresco (`useMiDia`)

- Carga al montar.
- Refresca **cada 5 minutos solo con la pestaña visible** (`document.visibilityState === 'visible'`), y **al volver a la
  pestaña** si pasaron más de 60 s desde el último dato (`visibilitychange`).
- No hay refresco en paralelo: si hay un pedido en vuelo, no se dispara otro.
- Un fallo de red no borra el último dato bueno. Muestra un aviso discreto ("No se pudo actualizar · Reintentar") y
  conserva lo anterior.
- `recargar()` queda expuesto para B10 y para el botón Reintentar.
- B9 usa el mismo pulso: `ActividadCard` recibe `pulso` (un contador que `useMiDia` incrementa en cada refresco) y
  vuelve a pedir cuando cambia.
- **Nada de polling más rápido que 5 minutos**, salvo los eventos de socket de B8 y B10, que ya existen.

### 6.4 Estados

| Estado | Qué se ve |
|---|---|
| Cargando (primera vez) | Skeleton con la forma de cada bloque visible (tiles, lista de 4 filas, gráfico de 160 px). El saludo y el buscador se ven enseguida, porque no dependen del backend |
| Error de un bloque (`errores` incluye su nombre) | `BloqueEstado` error: "No se pudo cargar este bloque." + Reintentar. Los otros bloques se ven normales |
| Error del pedido entero | Todos los bloques de `mi-dia` con el error. B9 y B10 tienen sus propios pedidos y se ven si cargan |
| B4 en 0 | "0", con la leyenda "Todavía no registraste gestiones hoy" |
| B5 sin gestiones en 14 días | `EmptyState` "Sin gestiones en las últimas dos semanas" |
| B6 vacío | `EmptyState` "Cuando registres gestiones, tus últimos casos van a aparecer acá" + botón "Buscar un caso" (abre el buscador) si tiene `deudores.ver` |
| B7 por pestaña | Hoy "No tenés promesas ni cuotas que venzan hoy". Próximos "Nada en los próximos 7 días". Sin cumplir "Nada sin cumplir en la última semana" |
| B9 vacío | "Sin actividad reciente" |
| B10 vacío | "No ejecutaste reportes en los últimos 7 días" + "Ir a Reportes" |

- **Responsive:** a 360 px todo va en una columna. Los tiles quedan de a 2 (`minmax(150px, 1fr)` en `xs`, vía
  `theme.breakpoints`). En `FilaCaso`, el lado derecho baja debajo del nombre. Sin scroll horizontal.
- **Tema:** solo `theme.palette` y `alpha()`, sin hex. Recharts toma los colores del theme (`primary.main`,
  `text.secondary`, `divider`).

### 6.5 `/gestion?deudor=ID`

En `DeudoresPage.tsx`:
- `const [searchParams, setSearchParams] = useSearchParams()`;
- el estado inicial de `selectedDeudorId` es `leerDeudorDeUrl(location.search) ?? last_deudor_id`;
- un efecto sobre `searchParams`: si `leerDeudorDeUrl` da un número, `setSelectedDeudorId(n)` y después
  `setSearchParams(sin 'deudor', { replace: true })`. El id se consume y se borra de la URL, para que elegir otro caso y
  recargar no vuelva al del link. El efecto existente lo persiste en `last_deudor_id`.

`leerDeudorDeUrl` acepta solo enteros positivos (`/^\d+$/`, `> 0`). Cualquier otra cosa da `null` y se usa el
comportamiento de siempre.

**[S]** Para un id que no existe, se comporta igual que un `last_deudor_id` viejo. El FE verifica qué muestra hoy
`TabsPanel` con un id inexistente, y si queda en blanco lo informa como hallazgo (no lo arregla en esta fase).

### 6.6 Buscador y Ctrl+K

> **Actualizado 22/10/2026:** el botón sigue abriendo `BuscadorAvanzadoModal`, pero ya no muestra la tecla ni escucha
> Ctrl+K: el atajo es del buscador de la barra superior, en todas las pantallas (CHANGELOG 2026-10-22). Lo que sigue
> describe la Fase 1.

- `SaludoBuscador` dibuja un `ButtonBase` a todo el ancho con aspecto de campo: icono de lupa, "Buscar un caso por DNI,
  nombre, número de cliente o teléfono" y la tecla "Ctrl K" (con `kbd` estilizado).
- Click → `BuscadorAvanzadoModal open`. `onSelectDeudor={(id) => navigate(linkCaso(id))}`.
- Listener `keydown` en `window`, solo mientras Inicio está montado y el usuario tiene `deudores.ver`:
  `(e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'` → `preventDefault()` + abrir. Si el modal ya está abierto,
  no hace nada. Se quita al desmontar.

---

## 7. Fallos silenciosos

| # | Qué se puede perder o mentir en silencio | Cómo se nota / qué lo evita |
|---|---|---|
| F1 | **Promesas que se cierran un día antes** (§2.1): "Vencen hoy" daría siempre 0 y nadie sabría por qué | D1 + test de cron (§9.1). Después del deploy, el control de prod §9.4 |
| F2 | **Agenda de cuotas vacía** porque `convenio.usuarioId` es NULL | §5.7 + backfill D2 con conteo de `sinAuditoria`/`ambiguos` en el dry-run |
| F3 | **Una promesa o cuota vencida que el cron no cerró** (cron caído) desaparecería de la agenda | Va a "Sin cumplir" con el chip "Sin cerrar" (§5.5) |
| F4 | **Lista recortada sin aviso** (agenda con más de 50) | `totales` + "Se muestran 50 de N" |
| F5 | **Gestiones de un día mal atribuidas** por agrupar en UTC (las de las 21-24 h, al día siguiente) | Se agrupa en Node con TZ de Argentina (§2.4) y hay un test con una gestión a las 22:30 local |
| F6 | **Conteo truncado** por el tope de 20.000 filas | `truncado: true` → el tile muestra "20.000+" y el log da `warn` |
| F7 | **Un bloque que falla parece vacío** ("0 gestiones") | `errores[]` + `BloqueEstado error`. El vacío y el error tienen textos distintos |
| F8 | **Permiso invisible:** ninguno nuevo en la Fase 1 | `inicio.ver_equipo` es de la Fase 2. Cuando llegue, va al catálogo (`permisos-catalogo.ts`) |
| F9 | **"Tus reportes" de un admin mostrando los de otros** (`/reportes/ejecuciones` con `ver_ejecuciones`) | Se lee de `mi-dia`, filtrado por `usuarioId` (R1) |
| F10 | **Importaciones de otros** en B8 para quien tiene `ver_progreso_otros` | Filtro `usuarioId === usuario.id` en el frontend (en curso) y `usuarioCreadorId` en el backend (terminadas) |
| F11 | **Promesa "Cumplida" por un pago mínimo** que el gestor lee como "pagó lo prometido" | D3: dice "Cumplida", sin monto pagado. La wiki lo explica (§10) |
| F12 | **Comparación engañosa a la mañana** | D4: a la misma hora, y `null` → "Sin días anteriores para comparar" en vez de un −100 % |
| F13 | **Ningún archivo al filesystem** | El endpoint no escribe nada. Las descargas de B10 usan el endpoint existente |

---

## 8. Contratos de terceros que se reusan (sin cambios)

| Qué | Endpoint / hook | Permiso | Archivo |
|---|---|---|---|
| Buscador | `BuscadorAvanzadoModal` (`open`, `onClose`, `onSelectDeudor`) | `deudores.ver` | `components/deudores/BuscadorAvanzadoModal.tsx:29-33` |
| Auditoría | `GET /api/transacciones?limit&orderDir&modulo` | `auditoria.ver` | `api/auditoria.ts:5-7` |
| Descargar reporte | `GET /api/reportes/ejecuciones/:id/descargar` | `reportes.ver` | `api/reportes.ts:118` |
| Progreso de reportes | socket `/reportes`: `ejecucion:progreso`, `:completado`, `:fallido` | sesión | `pages/reportes/hooks/useReportesSocket.ts` |
| Importaciones en curso | `useImportacionesEnCurso()` (socket `/rt`) | `importacion.ver_historial` | `hooks/useImportacionesEnCurso.ts` |

No hay eventos de socket nuevos.

---

## 9. Plan de pruebas

### 9.1 Backend (jest + `npm run build`)

> Jest corre con `isolatedModules` y **no chequea tipos**: `npm run build` es obligatorio antes de dar el paquete por
> cerrado. **No** correr `npm run lint` global, que reformatea ~167 archivos: solo `npx eslint <archivos tocados>` sin
> `--fix`, si hace falta.

- **`src/common/utils/dia-local.spec.ts`** (nuevo):
  - `ymdLocal` a las 23:30 y a las 00:10 locales;
  - `sumarDiasYmd` cruzando un fin de mes y un fin de año, y con un número negativo;
  - `fechaCalendarioUtc('2026-10-16').toISOString() === '2026-10-16T00:00:00.000Z'`;
  - `diaCalendario` de `2026-10-16T00:00:00Z` → `'2026-10-16'`.
- **`src/modules/inicio/inicio-calculos.spec.ts`** (nuevo), con `ahora` fijo en el viernes 16/10/2026 a las 10:30 local:
  - una gestión a las **22:30 local** del 15/10 cae en el día 15, no en el 16 (F5);
  - la serie tiene 14 días sin huecos, del 03/10 al 16/10;
  - "a esta hora": ayer con 5 antes de las 10:30 y 7 después → `ayerALaMismaHora.gestiones = 5`;
  - el promedio ignora los días con 0 (sábado y domingo) y toma como mucho 7 días;
  - sin días anteriores → `null` y `diasBase = 0`;
  - `semana.desde = '2026-10-12'` (lunes). Con `ahora` un domingo → el lunes de 6 días antes;
  - `casos` cuenta deudores distintos;
  - agenda: VIGENTE de ayer → `sinCumplir` (F3);
  - agenda: CUMPLIDA de hoy → `hoy` con estado CUMPLIDA;
  - agenda: CUMPLIDA de ayer → ninguna lista;
  - agenda: el `dia` de una promesa guardada a las `2026-10-16T00:00:00Z` es `'2026-10-16'`;
  - agenda: 60 ítems → 50 en la lista y `totales` = 60;
  - el recorte de `ultimoTexto` es de 120 caracteres + `…` y los saltos de línea pasan a espacio.
- **`src/modules/inicio/inicio.service.spec.ts`** (nuevo), con un mock de Prisma como en `convenios.service.spec.ts`:
  - **los permisos del OPERADOR** (los 13) → `agenda` y `promesas` van `null`, y **no se llama** `promesa_pago.*` ni
    `convenio.*` (se verifica con `expect(...).not.toHaveBeenCalled()`). `importacionesHoy` va `[]`, **no** `null`,
    porque tiene `importacion.ver_historial`;
  - los permisos del ADMIN → todos los bloques no nulos;
  - sin `comentarios.*` → `gestiones` y `retomar` van `null`, y no se llama `comentario.*`;
  - `promesas.ver` sin `convenios.ver` → `agenda.incluye = { promesas: true, cuotas: false }` y no se llama `convenio.*`;
  - si `promesa_pago.findMany` tira → `agenda` va `null`, `errores` incluye `'agenda'` y el resto de los bloques sale bien;
  - todas las queries de comentario filtran `usuarioId` **y** `origen: 'manual'` (se inspeccionan los args del mock);
  - R1 filtra por `usuarioId` aunque el usuario tenga `reportes.ver_ejecuciones` (F9).
- **`src/modules/promesas/promesas.service.spec.ts`** (nuevo), con `jest.useFakeTimers().setSystemTime(...)` y TZ de
  Argentina (`process.env.TZ` lo fija el script de jest; si no, se fija en el spec antes de importar):
  - **el borde que motiva D1:** el 17/10 a las 02:00 local, una VIGENTE con `fechaPromesa = 2026-10-17T00:00:00Z`
    **no** entra en `procesarVencidas` (el `where.fechaPromesa.lt` es `2026-10-17T00:00:00Z`);
  - una del 16/10 sí entra;
  - alta con `fechaPromesa: '2026-10-16'` el 16/10 a las 10:00 → **no** tira;
  - alta con `'2026-10-15'` → 400;
  - alta con `hoy + maxDias` → ok, y con `hoy + maxDias + 1` → 400.
- **`src/modules/convenios/convenios.service.spec.ts`** (se amplía):
  - `updateEstadosCuotas` el 17/10 a las 03:00 → `where.fechaVencimiento.lt = 2026-10-17T00:00:00Z`.
- **`src/modules/convenios/convenios.controller.spec.ts`** (nuevo, chico):
  - `create` pisa `dto.usuarioId` con `usuario.sub` aunque el cliente mande otro.

`process.env.TZ`: el `jest` del backend **no** fija la zona (`package.json:16`, `"test": "jest"`) [V]. Los specs que
dependen de la hora la fijan con `process.env.TZ = 'America/Argentina/Buenos_Aires'` en la primera línea, antes de crear
cualquier `Date`.

### 9.2 Frontend (vitest con el arnés + `tsc`)

- **`frontend/tests/lib/banco-inicio.tsx`** (nuevo), con el patrón de `banco-historial.tsx` / `banco-campanita.tsx`:
  - `ServidorFalso` con `GET /api/inicio/mi-dia` (un cuerpo configurable y contador de pedidos), `GET /api/transacciones`,
    `GET /api/reportes/ejecuciones/:id/descargar` y las rutas que pide `NotificacionesProvider` al montar (se copian de
    `banco-campanita.tsx`);
  - `montar(<Inicio/>, { conSocket: true, conNotificaciones: true, ruta: '/', patron: '/' })` con
    `iniciarSesion(permisos, id)`;
  - fábricas `miDiaOperador()` y `miDiaAdmin()` en el mismo archivo.
- **`frontend/tests/paginas/inicio.test.tsx`** (nuevo):
  1. **OPERADOR** (los 13 permisos):
     - se ven "Tu día", "Gestiones de la semana", "Casos de la semana", "Tus gestiones, últimos 14 días", "Retomá donde
       quedaste" y "Tus reportes";
     - **no** se ven "Tu agenda", "Promesas tomadas", "Vencen hoy", "Actividad reciente" ni "Importaciones";
     - **no** se pidió `/api/transacciones`.
  2. **ADMIN:** se ven agenda, promesas y actividad. La pestaña "Hoy · 4" muestra 4 filas, y "Cumplida" en la cumplida.
  3. **Fila de Retomá:** el `href` es `/gestion?deudor=<id>`.
  4. **Ctrl+K** abre el buscador (`dialogo(/búsqueda/i)`). Sin `deudores.ver`, no hay buscador y Ctrl+K no hace nada.
  5. **Comparación con `promedioALaMismaHora: null`:** se lee "Sin días anteriores para comparar" y **ningún** `NaN`,
     `Infinity` ni `undefined` (`BASURA` de `fabricas.ts`).
  6. **`errores: ['agenda']`:** el bloque de agenda muestra "No se pudo cargar" y Reintentar, y Retomá se ve normal.
  7. **Vacíos:** B6 y B7 con sus textos de §6.4.
  8. **Refresco:** con `visibilitychange` a `hidden` y avanzando 6 minutos no hay pedido nuevo. Al volver a `visible`, hay
     exactamente 1 pedido nuevo.
  9. **Agenda con `totales.hoy = 60`:** se lee "Se muestran 50 de 60".
  10. **B8:** con una carga en curso de otro usuario, el bloque no aparece. Con una propia, aparece con "Ver detalle".
  11. **360 px** (`fijarAncho(360)`): sin desborde horizontal (`scrollWidth <= clientWidth` del contenedor).
  12. **Modo oscuro** (`modo: 'dark'`): monta sin errores.
- **`frontend/tests/unit/link-caso.test.ts`** (nuevo):
  - `linkCaso(5)`;
  - `leerDeudorDeUrl('?deudor=12') === 12`;
  - `'?deudor=abc'`, `'?deudor=0'`, `'?deudor=-3'`, `'?deudor=1.5'` y `''` → `null`.
- **`frontend/tests/paginas/gestion-link.test.tsx`** (nuevo):
  - `vi.mock('@fe/components/deudores/TabsPanel', …)` con un doble que imprime `selectedDeudorId`;
  - con `localStorage.last_deudor_id = 7` y ruta `/gestion?deudor=12` → muestra 12, `last_deudor_id` pasa a `'12'` y la
    URL queda sin `deudor`;
  - con `?deudor=abc` → muestra 7.
- **`tsc`:** `cd frontend && npx tsc --noEmit -p tsconfig.json`, sin errores nuevos (`vite build` no chequea tipos).
- `npm test` completo (~5 min). Si corre junto con otra suite: `FE_TEST_PUERTO=47841 npm test`.

### 9.3 Prueba manual (local, la usa el auditor)

1. Correr `npx prisma db push` y verificar `SHOW INDEX FROM comentario` → aparece `Comentario_usuarioId_origen_fecha_idx`.
2. Entrar como el admin local:
   - cargar 3 comentarios en dos casos distintos → en Inicio, "Gestiones hoy" = 3, "Casos trabajados hoy" = 2, y Retomá
     muestra los dos casos con el último texto;
   - clic en uno → abre `/gestion` con **ese** caso, y la URL queda en `/gestion`.
3. Cargar una promesa **para hoy** desde la ficha → antes del arreglo daba 400; ahora entra. En Inicio, "Vencen hoy" = 1
   y la agenda "Hoy · 1" la muestra con "Vence hoy".
4. Correr `POST /api/promesas/procesar-vencidas` (el endpoint manual, `promesas.controller.ts:45` [V]) → la promesa de
   hoy **sigue** VIGENTE.
5. Crear un convenio de 3 cuotas con inicio hoy → `SELECT usuarioId FROM convenio ORDER BY id DESC LIMIT 1` es el id del
   admin. En la agenda aparece "Cuota 1 de 3 del convenio" en Hoy, y las otras en Próximos si caen dentro de los 7 días.
6. Crear un usuario con el rol OPERADOR, entrar con él y ver la página de §1.1 completa, sin agenda, sin actividad y sin
   huecos.
7. Ctrl+K en Inicio → se abre el buscador. Buscar por DNI, elegir → abre la ficha.
8. Tableros → un drill-down → clic en un caso → se abre una pestaña nueva en `/gestion` con ese caso (antes daba la
   pantalla en blanco de `/deudores/:id`).
9. Cambiar a tema claro y a oscuro, y achicar a 360 px: todo legible, sin scroll horizontal.
10. Dejar la pestaña en segundo plano 6 minutos (DevTools → Network): sin pedidos a `mi-dia`. Al volver, uno solo.
11. ~~Backfill~~ (descartado, §4.2): `npx ts-node --transpile-only prisma/scripts/backfill-convenio-usuario.ts` (dry-run) → imprime candidatos,
    sin auditoría y ambiguos. Con `--aplicar` los escribe. Una segunda corrida da 0 candidatos.

### 9.4 Después del deploy (prod, lo hace el usuario, solo lectura salvo el backfill)

1. **CloudWatch:** el arranque sin ERROR. El primer `GET /api/inicio/mi-dia` loguea "mi-dia … en Nms", con N < 500.
2. **Índice:** `SHOW INDEX FROM comentario WHERE Key_name='Comentario_usuarioId_origen_fecha_idx'` → 3 filas. Si el
   deploy falló a medias, verificar con `migrate diff` (memoria "db push en el deploy").
3. **`EXPLAIN`** de la consulta G1 con un usuario operador → `key = Comentario_usuarioId_origen_fecha_idx`.
4. **Cron de la noche siguiente:**
   ```sql
   SELECT COUNT(*) FROM promesa_pago
    WHERE estado='INCUMPLIDA' AND DATE(cerradaEn) = DATE(fechaPromesa) AND cerradaEn > '<deploy>';
   ```
   Tiene que dar **0**. Lo mismo para las cuotas que pasaron a VENCIDA el día de su vencimiento.
5. ~~**Backfill D2:**~~ (descartado, §4.2) `--dry-run` y revisar los números. Después `--aplicar`, y una segunda corrida en dry-run da 0
   candidatos.
6. **Un operador real** abre Inicio. Ve sus gestiones del día y coinciden con
   `SELECT COUNT(*) FROM comentario WHERE usuarioId=? AND origen='manual' AND fecha >= '<hoy 03:00 UTC>'`.

---

## 10. Documentación

- **`docs/ayuda/01-primeros-pasos/03-inicio.md`** (nueva), con metadatos `seccion: Primeros pasos`, `resumen`,
  `revisado: 2026-10-16`, `rutas: /` y `rutaPrincipal: /`. Contenido:
  - qué es cada bloque y quién lo ve;
  - de dónde sale cada número ("una gestión es un comentario que escribiste vos en la ficha; las acciones masivas no
    cuentan");
  - qué quiere decir "a esta hora";
  - por qué una promesa dice "Cumplida" con cualquier pago (D3);
  - Ctrl+K;
  - cada cuánto se actualiza;
  - "Qué puede salir mal" (no veo mi agenda → no tenés el permiso o no cargaste promesas; un convenio viejo no aparece →
    se armó antes del 16/10 y no tiene autor).
- **`docs/ayuda/01-primeros-pasos/01-primer-dia.md`**: se saca `rutaPrincipal: /` y se deja `rutas: /`. En "El recorrido
  básico" va una línea: "Al entrar caés en **Inicio**: tu día, tus últimos casos y, si cargás promesas, tu agenda (ver
  [Inicio](03-inicio))". El formato del enlace se copia de los que ya hay en la página.
- **`docs/ayuda/02-gestion/00-buscar-un-caso.md`**: en "Dos formas de buscar" va "Desde Inicio, con Ctrl+K", y una nota:
  un enlace `/gestion?deudor=N` abre ese caso directamente (lo usan Inicio y el detalle de los tableros).
- **`docs/ayuda/07-tableros/01-como-leer-el-tablero.md:137`**: ya dice que el detalle abre el caso en una pestaña nueva.
  Hasta ahora era falso y ahora es cierto. Se revisa la frase y se actualiza `revisado`.
- **`docs/pagos-promesas-spec.md`**: en la regla 8 y en §5.4 va que la comparación es por **día calendario** (D1), con la
  explicación de §2.1.
- **Verificar:** `cd frontend && npm run verificar-ayuda` sin errores (una sola principal para `/`).
- **CHANGELOG.md y el estado de este spec:** los escribe quien integra los dos paquetes, **no** los implementers (es el
  único archivo que tocarían los dos).

---

## 11. Criterios de aceptación (lo que el auditor intenta romper)

1. Con los 13 permisos del OPERADOR, `GET /api/inicio/mi-dia` devuelve `agenda: null`, `promesas: null`,
   `gestiones`/`retomar`/`reportes` no nulos e `importacionesHoy` como arreglo. **No ejecuta ninguna query** sobre
   `promesa_pago`, `convenio` ni `cuota_convenio` (test).
2. Con todos los permisos, ningún bloque es `null` y `errores` es `[]`.
3. Un usuario sin ningún permiso recibe 200 con todos los bloques `null`. La página muestra el saludo y nada más, sin
   errores en consola.
4. Las gestiones cuentan solo `origen = 'manual'` del usuario. 5 comentarios manuales + 1.000 de una acción masiva del
   mismo usuario → `hoy = 5`.
5. Una gestión a las 22:30 local del día anterior no suma en "hoy" y sí en el día anterior de `serie`.
6. `serie` tiene siempre 14 elementos consecutivos, el último igual a `hoy`.
7. Con `promedioALaMismaHora = null`, ninguna parte de la página muestra `NaN`, `Infinity`, `undefined` ni "−100 %".
8. Una promesa cargada hoy **para hoy** se acepta (antes: 400), y el cron de esa madrugada y el disparo manual **no** la
   cierran. El cron del día siguiente sí.
9. Una cuota que vence hoy sigue PENDIENTE después del cron de las 3 AM de hoy y pasa a VENCIDA en el de mañana.
10. Un convenio creado por el usuario 3 queda con `usuarioId = 3` aunque el body mande `usuarioId: 99`.
11. ~~El backfill en dry-run no escribe.~~ (descartado, §4.2) Con `--aplicar` escribe solo convenios con `usuarioId` NULL y un único candidato.
    La segunda corrida da 0 candidatos.
12. `/gestion?deudor=12` abre el caso 12, deja `last_deudor_id = '12'` y la URL queda en `/gestion`. Con
    `/gestion?deudor=abc` se comporta como antes.
13. El drill-down de Tableros abre `/gestion?deudor=ID` en otra pestaña.
14. La página del OPERADOR no tiene columnas vacías: con su combinación de bloques, el lateral tiene B5 y B10, y el
    principal tiene B6.
15. Con la pestaña oculta no hay pedidos a `mi-dia`. Al volver después de más de 60 s, hay exactamente uno.
16. Un admin con `reportes.ver_ejecuciones` ve en "Tus reportes" **solo** sus ejecuciones.
17. B8 no muestra cargas de otros usuarios, ni en curso ni terminadas.
18. A 360 px no hay scroll horizontal. En claro y en oscuro no hay colores fijos (`grep -n "#[0-9a-fA-F]\{3,6\}"` sobre
    `pages/inicio/` sin resultados).
19. `npm run build` (backend), `npx jest` (backend), `npx tsc --noEmit` (frontend), `npm test` (frontend) y
    `npm run verificar-ayuda` pasan.
20. `db push` local aplica solo el índice nuevo, sin pedir `--accept-data-loss`, y `migrate diff` queda vacío después.

---

## 12. Lo que cambió después de la auditoría (16/10/2026)

Hubo dos auditorías en paralelo, las dos con resultado PASA CON OBSERVACIONES y sin bloqueantes.

**Backend, con la app real** (MySQL y Redis locales, `TZ=America/Argentina/Buenos_Aires`):
- **El operador**, con sus 13 permisos, no dispara ninguna consulta a `promesa_pago`, `convenio` ni `cuota_convenio`
  (lo muestra el log general de MySQL). Nunca aparecen datos de otro usuario.
- **Los bordes de medianoche**, "a la misma hora", la semana, la serie y la agenda dieron lo esperado.
- **Con 200.000 comentarios** responde en 28 a 48 ms, y el `EXPLAIN` usa el índice nuevo.
- **D1**: el alta acepta hoy y rechaza ayer, también a las 23:30 y a las 00:10. El cron del D a las 02:00 evalúa solo el
  D−1 (el código viejo habría evaluado 4), y las cuotas del D siguen PENDIENTE a las 03:00.

**Frontend y wiki contra el código:** el contrato es idéntico. El operador no ve ningún enlace a algo que no puede
usar.

**Arreglos de quien orquesta, cada uno con su test:**
1. **"Inicio" en el menú lateral, como primer ítem y sin permiso.** Estaba en la maqueta aprobada y la wiki lo daba
   por hecho, pero el código no lo tenía: para volver había que tocar el logo.
2. **Agenda: las cuotas piden `convenios.crear` y `convenios.ver`, en el backend y en el frontend.** Antes el bloque
   salía con `convenios.crear` y las cuotas con `convenios.ver`, y quien tenía solo el primero veía una agenda
   siempre vacía. El operador de prod tiene "Ver convenios" pero no "Crear convenios", así que no la ve.
3. **El alta de convenio devolvía y auditaba la fila entera del usuario**, con `googleId`, `email`, `dni` y `legajo`.
   El problema se hizo visible con §5.7. Ahora `usuario: { select: { id, nombre } }` va en los cuatro `include` del
   service. Nadie del frontend usaba esos campos.
4. **Los tests de fechas pasaban solo si la máquina estaba en −03.** El `process.env.TZ` adentro de un spec llega
   tarde, así que la zona ahora va en un `globalSetup` de jest (`backend/test/tz-global-setup.js`). Con `TZ=UTC npx jest`
   fallaban 4 tests y ahora pasan todos.
5. **El calendario de "Nueva promesa" calculaba hoy y el máximo con el día UTC.** De 21:00 a 23:59, hoy no se podía
   elegir y el máximo daba 400 con D1. Ahora usa `diaLocalIso`.
6. **La ficha mostraba un día antes** la fecha de la promesa, la de la cuota y la del aviso de anulación. Ahora usa
   `fechaDelCedente`.
7. **Gestiones: si se llega al tope de filas, se pierden las más viejas** (`orderBy desc`), no las de hoy.
8. **"Promesas tomadas" no cuenta las ANULADA.**
9. **Una importación propia que termina** vuelve a pedir `mi-dia`. Mientras tanto el bloque se mantiene; antes
   desaparecía hasta el próximo refresco.
10. **Refresco:**
    - un pedido forzado (terminó un reporte o una carga) con otro en vuelo pide de nuevo al terminar;
    - el reloj de 5 minutos no repite un pedido si al volver a la pestaña ya se refrescó;
    - "Actividad reciente" se pide una vez al abrir, no dos.
11. **Filas de la agenda:** sin `deudores.ver` no enlazan a Gestión.
12. **La grilla de solo columna lateral:** con una cantidad impar de bloques, el último va a ancho completo.
13. **Responsive y accesibilidad:**
    - a 360 px, el pie de los indicadores pasa a dos renglones en vez de cortar el chip;
    - `aria-keyshortcuts`, y "⌘ K" en Mac;
    - las pestañas de la agenda con su `tabpanel`.
14. **Wiki `03-inicio`:**
    - un ancla que no funcionaba;
    - "13 días anteriores";
    - el ejemplo "120+";
    - "si lo que ves tiene más de un minuto";
    - las causas reales de una cuota que no aparece, en lugar de "convenios sin autor", que en prod no existen;
    - el permiso de la agenda.

**Deuda, sin arreglar:**
- `/gestion?deudor=<id inexistente>` queda guardado como último caso. Ya pasaba con un `last_deudor_id` viejo; lo
  nuevo es que una URL lo puede sembrar.
- "0+" con el saludo "Todavía no registraste": solo con más de 20.000 gestiones en dos semanas.
- **El socket `/reportes`**, anterior a este trabajo, se propone aparte:
  - no verifica JWT: le cree al cliente el `usuarioId`;
  - su CORS no incluye el dominio de prod;
  - el frontend lee `localStorage['usuario']` en vez de `amsa_usuario`, así que nunca conecta.

  Por eso "Tus reportes" no tiene el porcentaje en vivo: se actualiza con el refresco.
- Nada se vio en un navegador. El guion manual está en el CHANGELOG.

---

## PLAN PARA IMPLEMENTER — Inicio Fase 1

Dos paquetes **disjuntos**. Ningún archivo aparece en los dos. `CHANGELOG.md` y `docs/inicio-spec.md` no los toca ninguno
(los escribe quien integra).

**Interfaz entre los dos:** el contrato de §5.3. El FE lo copia tal cual a `frontend/src/api/inicio.ts` y trabaja contra
el servidor falso. No necesita el backend levantado.

### Paquete BE (backend)

**Orden de implementación:**
1. **Helpers de fecha** en `dia-local.ts` + `dia-local.spec.ts`. Van primero porque los usan D1 y el módulo.
2. **D1:** las 3 comparaciones en `promesas.service.ts` y `convenios.service.ts` + `promesas.service.spec.ts` + el caso
   nuevo en `convenios.service.spec.ts`. Es el borde que motiva el cambio y el de más riesgo.
3. **§5.7** `convenios.controller.ts` + `convenios.controller.spec.ts`.
4. **Schema:** el índice + `npx prisma db push` + `npx prisma generate` local + `migrate diff` vacío.
5. **Módulo `inicio`:** primero `dto/mi-dia.dto.ts`, después `inicio-calculos.ts` + su spec, después `inicio.service.ts`
   + su spec, después el controller, el module y el registro en `app.module.ts`.
6. ~~**Script de backfill** (§4.2)~~ (descartado), probado local en `--dry-run` y `--aplicar`.
7. `docs/pagos-promesas-spec.md`. `npx jest` + `npm run build`.

**Archivos a crear:**
- `backend/src/modules/inicio/inicio.module.ts`
- `backend/src/modules/inicio/inicio.controller.ts`
- `backend/src/modules/inicio/inicio.service.ts`
- `backend/src/modules/inicio/inicio-calculos.ts`
- `backend/src/modules/inicio/dto/mi-dia.dto.ts`
- `backend/src/modules/inicio/inicio.service.spec.ts`
- `backend/src/modules/inicio/inicio-calculos.spec.ts`
- `backend/src/common/utils/dia-local.spec.ts`
- `backend/src/modules/promesas/promesas.service.spec.ts`
- `backend/src/modules/convenios/convenios.controller.spec.ts`
- ~~`backend/prisma/scripts/backfill-convenio-usuario.ts`~~ (descartado)

**Archivos a modificar:**
- `backend/prisma/schema.prisma`: `@@index([usuarioId, origen, fecha], map: "Comentario_usuarioId_origen_fecha_idx")` en
  `comentario`.
- `backend/src/common/utils/dia-local.ts`: `ymdLocal`, `sumarDiasYmd`, `fechaCalendarioUtc` y `diaCalendario`.
- `backend/src/modules/promesas/promesas.service.ts`: el alta (`:116-127`) y `procesarVencidas` (`:289`), por día
  calendario.
- `backend/src/modules/convenios/convenios.service.ts`: `updateEstadosCuotas` (`:243-249`), por día calendario.
- `backend/src/modules/convenios/convenios.controller.ts`: `create` toma `usuarioId` de `@UsuarioActual()`.
- `backend/src/modules/convenios/convenios.service.spec.ts`: un caso de `updateEstadosCuotas`.
- `backend/src/app.module.ts`: importa y registra `InicioModule`.
- `docs/pagos-promesas-spec.md`: regla 8 y §5.4, con la comparación por día calendario.

**Cambios de schema:** un índice compuesto aditivo en `comentario`. Sin backfill de schema. El backfill de datos de
`convenio.usuarioId` (D2) se descartó: en prod no hay convenios sin autor.

**Tests a escribir:** los de §9.1.

**Páginas de la wiki a tocar:** ninguna (son del paquete FE).

**Skills a consultar:** `nestjs-module`, `prisma-migration` y `amsa-general`.

**Riesgos durante la implementación:**
- La TZ en jest: fijarla en el spec antes de crear fechas (jest no la fija).
- **No** sacar el índice `[usuarioId]` de `comentario`.
- `groupBy` de Prisma con `orderBy: { _max: { fecha: 'desc' } }` y `take`: verificarlo con la versión instalada.
- Que una excepción de un bloque no tumbe a los demás (`allSettled`).
- No loguear documentos ni textos.
- No correr `npm run lint` global.
- `npm run build` antes de dar por cerrado.

### Paquete FE (frontend)

**Orden de implementación:**
1. `utils/linkCaso.ts` + `tests/unit/link-caso.test.ts`.
2. `DeudoresPage.tsx` (`?deudor=`) + `tests/paginas/gestion-link.test.tsx`.
3. `DrillDownDialog.tsx:90`.
4. `api/inicio.ts` (el contrato copiado), `pages/inicio/formato.ts`, `reglasBloques.ts` y `useMiDia.ts`.
5. Componentes en este orden: `BloqueEstado`, `FilaCaso`, `KpiTile`, `Sparkline`, `SaludoBuscador`, `TuDiaKpis`,
   `GestionesSerieCard`, `RetomarCard`, `AgendaCard`, `ImportacionesCard`, `ActividadCard` y `ReportesCard`.
6. `Inicio.tsx`, que los compone.
7. `tests/lib/banco-inicio.tsx` + `tests/paginas/inicio.test.tsx`.
8. La wiki + `npm run verificar-ayuda`, `npx tsc --noEmit -p tsconfig.json` y `npm test`.

**Archivos a crear:**
- `frontend/src/api/inicio.ts`
- `frontend/src/utils/linkCaso.ts`
- `frontend/src/pages/inicio/useMiDia.ts`
- `frontend/src/pages/inicio/formato.ts`
- `frontend/src/pages/inicio/reglasBloques.ts`
- `frontend/src/pages/inicio/components/SaludoBuscador.tsx`
- `frontend/src/pages/inicio/components/TuDiaKpis.tsx`
- `frontend/src/pages/inicio/components/KpiTile.tsx`
- `frontend/src/pages/inicio/components/Sparkline.tsx`
- `frontend/src/pages/inicio/components/GestionesSerieCard.tsx`
- `frontend/src/pages/inicio/components/RetomarCard.tsx`
- `frontend/src/pages/inicio/components/AgendaCard.tsx`
- `frontend/src/pages/inicio/components/ImportacionesCard.tsx`
- `frontend/src/pages/inicio/components/ActividadCard.tsx`
- `frontend/src/pages/inicio/components/ReportesCard.tsx`
- `frontend/src/pages/inicio/components/FilaCaso.tsx`
- `frontend/src/pages/inicio/components/BloqueEstado.tsx`
- `frontend/tests/lib/banco-inicio.tsx`
- `frontend/tests/paginas/inicio.test.tsx`
- `frontend/tests/paginas/gestion-link.test.tsx`
- `frontend/tests/unit/link-caso.test.ts`
- `docs/ayuda/01-primeros-pasos/03-inicio.md`

**Archivos a modificar:**
- `frontend/src/pages/Inicio.tsx`: se reescribe y compone los bloques con las reglas de §6.2.
- `frontend/src/pages/DeudoresPage.tsx`: `?deudor=ID`, que se consume y se borra de la URL (§6.5).
- `frontend/src/pages/dashboards/components/DrillDownDialog.tsx`: la línea 90 pasa a `window.open(linkCaso(id), '_blank', 'noopener')`.
- `docs/ayuda/01-primeros-pasos/01-primer-dia.md`: se saca `rutaPrincipal: /` y se agrega la línea de Inicio.
- `docs/ayuda/02-gestion/00-buscar-un-caso.md`: Ctrl+K desde Inicio y el enlace `/gestion?deudor=N`.
- `docs/ayuda/07-tableros/01-como-leer-el-tablero.md`: se revisa la frase de la línea 137 y se actualiza `revisado`.

**Cambios de schema:** ninguno.

**Tests a escribir:** los de §9.2.

**Páginas de la wiki a tocar:** `01-primeros-pasos/03-inicio.md` (nueva), `01-primer-dia.md`, `02-gestion/00-buscar-un-caso.md` y
`07-tableros/01-como-leer-el-tablero.md`.

**Skills a consultar:** `react-component` y `dataviz` (B5 y la sparkline).

**Riesgos durante la implementación:**
- Recharts en jsdom: `tests/setup.ts:8-10` ya simula `ResizeObserver` [V]. Igual conviene darle al gráfico un alto
  fijo.
- Que el listener de Ctrl+K quede vivo al desmontar.
- No abrir el socket `/reportes` si no hay reportes en curso.
- `useSearchParams` con `replace: true` para no ensuciar el historial del navegador.
- Sin colores hex.
- `vite build` no chequea tipos: `tsc` obligatorio.

**Criterios de aceptación (para el auditor):** los 20 de §11.
