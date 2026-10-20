# Analista de cartera: Fase C del asistente de IA

> **Estado:** propuesta y definiciones, sin implementar. Se escribió el 19/10/2026 para retomar en otra sesión. La
> propuesta visual que vio el usuario está en https://claude.ai/artifact/7C9vrB1JbE1xtpVBLFdqP8.
> **20/10/2026:** la Fase 1 se partió en **1a** (métricas y tablero, ahora) y **1b** (el agente, cuando haya datos:
> condición en §12). Spec ejecutable: `docs/analista-cartera-fase1-spec.md`. Hoy la plataforma no registra ninguna
> llamada (§3.2).
> **Cómo usarlo:** cada fase se convierte en un spec ejecutable con el agente `architect`, partiendo de este
> documento, y se implementa y audita como las Fases A y B (`docs/asistente-spec.md`,
> `docs/asistente-reportes-spec.md`). Lo marcado como **[DECIDIDO]** lo definió el usuario. Lo marcado como
> **[PROPUESTA]** está a confirmar. Lo marcado como **[PENDIENTE]** depende de algo externo.

---

## 1. Qué es

Un modo nuevo del asistente, **"Analizar la cartera"**, donde se le pregunta en lenguaje natural por remesas,
cedentes y la operación, y responde con números reales, gráficos y recomendaciones. También arma **cortes de base
para el discador** por franja horaria, según cuándo atiende cada cliente.

Preguntas que tiene que poder contestar (las pidió el usuario el 19/10):
- "¿Cómo viene la remesa 30155 de TELECOM_PERSONAL?" "¿Cuándo se cargó y qué trae?"
- "¿Cuándo se la contactó más? ¿En qué horario y qué días se contacta mejor esta cartera?"
- "¿Cómo viene performando esta cartera contra las remesas anteriores del mismo cedente?"
- "¿Qué acciones me recomendás según la historia de esta empresa?"
- "¿A qué hora me conviene llamar a este cliente?"
- "Armame los cortes de base de mañana por franja horaria, según cuándo es más probable contactar a cada cliente."

### 1.1 Principios (no negociables)

1. **La base calcula y el modelo explica.** Cada número sale de una consulta determinista con su definición
   publicada (§5). El modelo elige qué consultar, lee el resultado y lo explica. Nunca hace cuentas propias sobre
   datos de la base.
2. **El modelo ve solo agregados:** porcentajes, cantidades y montos por remesa, cedente, operador, franja o día.
   Los datos de personas (nombre, documento, teléfono) no llegan al modelo. El horario por cliente lo calcula el
   backend, y las listas de casos van a archivos o a la pantalla, nunca al modelo (mismo criterio que §8 de la Fase B).
3. **Toda recomendación dice por qué:** el dato que la sostiene, cuántos casos o intentos la respaldan y el intervalo
   de confianza. Si los datos no alcanzan (§5.4), lo dice y no recomienda.
4. **El cumplimiento va afuera del modelo.** La ventana horaria, los feriados, los topes de frecuencia y las
   exclusiones son filtros duros en el backend (§9). Ninguna optimización los puede saltear.
5. **Nada se ejecuta solo.** Los cortes se proponen y una persona los aprueba antes de cargarlos en Neotel. Es el
   mismo patrón de tarjeta y confirmación de las Fases A y B.
6. **Lo nuevo se mide contra un control.** Cada regla nueva se prueba con champion/challenger (§8.5) antes de darla
   por buena.

---

## 2. Decisiones del usuario (19 y 20/10/2026)

| # | Tema | Decisión |
|---|---|---|
| U-1 | Ventana horaria de trabajo | **[DECIDIDO] De 9 a 20 h.** Falta confirmar los sábados: la ley de CABA permite hasta las 12 (§9) |
| U-2 | Tickets de todas las llamadas | **[PENDIENTE]** El usuario le está pidiendo a Neotel cómo obtener los tickets de todas las llamadas del día, probablemente por API. Va a pasar la documentación para hacer la integración |
| U-3 | Cuándo se traen | **[DECIDIDO]** Un cron **dos veces por día, a las 12:00 y a las 20:30** (hora de Argentina), más un **botón manual** para traer en cualquier momento lo trabajado hasta ese momento |
| U-4 | Duplicados | **[DECIDIDO]** Siempre validar que no se dupliquen los tickets ya traídos, se ejecute por el cron o a mano |
| U-5 | Tipificación | **[DECIDIDO]** Se usan los **códigos de gestión y de situación** que ya existen (`prisma/seed-codigos-curados.ts`). Ya están normalizados; no se inventa otra taxonomía (§4) |
| U-6 | Copiloto elegido | **[DECIDIDO]** El analista de cartera, antes que el de plantillas de importación |
| U-7 | "% CPC" del tablero (§4.3) | **[DECIDIDO, 20/10]** Se muestran los dos: "Casos contactados (titular o tercero)", que es la fórmula de hoy (SIT-011 + SIT-012) con otro nombre, y "Casos contactados con el titular" (SIT-011), que es nuevo |
| U-8 | Contacto con el titular, RPC (§4.1) | **[DECIDIDO, 20/10]** GES-002 más los resultados que implican haber hablado con el titular (GES-030 y 031, 050 a 052, 060 a 064, 070 a 073), en una gestión de canal llamada. Se usa desde la Fase 2 |
| U-9 | Actividad por operador (§7.1) | **[DECIDIDO, 20/10]** Afuera de la Fase 1: ninguna herramienta agrupa ni filtra por operador. Se retoma con el permiso de equipo de Inicio (`inicio.ver_equipo`, Fase 2 de `docs/inicio-spec.md`) |
| U-10 | Cuándo se arma el agente (§12) | **[DECIDIDO, 20/10]** La Fase 1 se parte. **1a, ahora:** el módulo único de indicadores, el tablero sobre ese módulo (U-7) y la curva de recupero en el tablero. **1b, el agente:** cuando se cumpla la condición de §12, con umbrales medidos y preguntas reales. Con pocos datos, el agente casi solo diría "no hay datos suficientes" |
| U-11 | Fuente de las llamadas (§6.1) | **[DECIDIDO, 20/10]** Los tickets de Neotel, con el sync de U-3: cron dos veces por día y botón manual para no esperar al próximo corte. Se diseña cuando Neotel diga cómo integrarse (U-2) |
| U-12 | Sin migración del sistema anterior | **[DECIDIDO, 20/10]** No se migran casos ni historia. La plataforma arranca **empresa por empresa, solo con las asignaciones nuevas**. Las dos plataformas conviven hasta que la anterior se vacía sola, cuando ya no recibe casos y terminan los últimos en gestión. Consecuencias: **(a)** no se traen llamadas hacia atrás; el backfill de §6.1 es solo para los días en que falló el sync; **(b)** la historia de cada cedente empieza con su primera remesa en la plataforma, así que las comparaciones contra las remesas anteriores tardan en tener datos, empresa por empresa; **(c)** la condición de la 1b (§12) se mira por empresa |

---

## 3. Los datos

### 3.1 Lo que hay en prod (medido el 19/10/2026, solo lectura)

| Dato | Cantidad | Estado | Sirve para |
|---|---|---|---|
| Casos (`deudor`) | 388.791 | Listo | Composición y deuda asignada por remesa |
| Remesas | 80 (de 26 empresas) | Listo | La remesa como lote de asignación |
| Facturas | 215.207 | Listo | Antigüedad de la mora y tramos |
| Índice de mora diario | sí (`indice_mora`) | Listo | Deuda actualizada |
| Pagos | 2.290, todos importados (`IMPORT_PAGOS`, `IMPORT_ACTUALIZACION`, `IMPORT_MULTIARCHIVO`, `IMPORT_MULTIRREGISTRO`) | Listo | Curva de recupero por remesa |
| Teléfonos y mails | 37.446 teléfonos (casi todos validados) · 16.467 mails · 48.218 direcciones | Revisar | Contactabilidad por teléfono. **Hay unos 20 contactos con el número o el mail en el campo `tipo`**: limpiar en la Fase 0 |
| Gestiones (`comentario`) | 23 (21 de acciones masivas) | Empieza | Historia de gestiones |
| Cambios de estado (`transaccion`, entidad Deudor) | 253 de GESTION y 57 de IMPORT | Empieza | Secuencia de códigos por caso |
| Promesas | 0 | Empieza | PTP y promesas cumplidas |
| Mails enviados | 1 | Empieza | Canal digital |
| `llamada_neotel` | **no existe en prod, y ningún código la escribe** (§3.2) | Por construir | Llamadas y su resultado |

Hay remesas con números de 5 dígitos (`30155`) y de 13 dígitos (`1784036980243`), y `numeroRemesa` es texto: los
rangos comparan como texto (memoria "fechas-negocio-prod"). Las fechas de negocio conviven a 00:00Z y a 03:00Z: usar
la clasificación de `reportes/validador/fechas-negocio.ts`.

### 3.2 Lo que falta: todos los intentos del discador

**Corrección del 20/10/2026: hoy la plataforma no registra ninguna llamada.** `docs/neotel-spec.md` §5.3 diseña que
`llamada_neotel` nazca del evento `RINGING_AGENT` y que el agente tipifique en un `DispositionForm`, pero eso no está
implementado:
- ningún código del backend crea ni actualiza filas de `llamada_neotel`; solo se leen, en
  `asistente/reportes/vocabularios.service.ts` y en `imports.service.ts`;
- no hay ningún handler de `RINGING_AGENT` ni un `DispositionForm`, ni en el backend ni en el frontend.

Aunque estuviera, solo registraría las llamadas que el predictivo le pasa a un agente. Los intentos que no
atendieron, dieron ocupado, cayeron en contestador o fueron a un número inválido los resuelve Neotel solo y no llegan
a la plataforma. `neotel-http.client.ts` no tiene ningún endpoint de historial ni de reportes.

**Por eso la fuente de las llamadas van a ser los tickets de Neotel (U-11),** y no el CTI. Mientras tanto, lo único que
queda del trabajo de los operadores es:
- el cambio del **estado de gestión del caso** (`deudor.estadoGestionId`, un código GES), con su registro en la
  auditoría (`transaccion`);
- el **comentario libre** (`comentario`), que **no tiene código**: solo `texto` y `origen`.

No existe un registro de "gestión" con su código, canal, hora y operador. El código de una gestión sale de la
auditoría del cambio de estado. **[PROPUESTA]** Evaluar en la Fase 0 un registro de gestión propio: sin él, las tasas
por resultado de las gestiones de los operadores dependen de leer la auditoría.

**Sin esos intentos no hay denominador:** no se pueden medir la tasa de contacto por franja, la intensidad ni el
abandono, ni recomendar un horario por cliente. Por eso existe la **Fase 0** (§6) y por eso el usuario está gestionando
con Neotel los tickets de todas las llamadas (U-2).

---

## 4. Taxonomía de resultados (sobre los códigos existentes, U-5)

La industria usa una jerarquía por intento: **intento → conexión → contacto vivo → contacto con el titular (RPC) →
promesa → pago**. La de AMSA se arma con los códigos curados; no se crea otra.

### 4.1 Códigos de gestión (resultado de una gestión o de una llamada)

| Nivel de la jerarquía | Códigos | Notas |
|---|---|---|
| Intento sin respuesta | GES-005 Llamada sin respuesta · GES-011 No contesta, múltiples intentos | No es conexión |
| Sin contacto, línea | GES-010 Sin contacto · GES-012 Fuera de servicio · GES-013 Número inexistente | GES-012 y GES-013 marcan el **teléfono** como no llamable |
| Conexión sin persona | GES-004 Mensaje en contestador | Cuenta como conexión, no como contacto vivo |
| Contacto vivo, no titular | GES-003 Contacto con tercero | Contacto vivo, **no es RPC**. La Ley 6171 de CABA prohíbe gestionar la deuda con terceros |
| Dato incorrecto | GES-014 Teléfono equivocado · GES-020 Datos incorrectos · GES-021 Domicilio incorrecto · GES-022 Inubicable | GES-014 marca el teléfono como no llamable para ese caso |
| **Contacto con el titular (RPC)** | GES-002 Contacto con titular, más todo resultado que **implica** haber hablado con el titular: GES-030 y GES-031 (promesa), GES-050 a GES-052 (convenio), GES-060 a GES-064 (negativa), GES-070 a GES-073 (reclamo) | Definición de RPC = **[DECIDIDO, U-8]**: cualquiera de estos códigos en una gestión de canal llamada |
| Promesa (PTP) | GES-030 Promesa de pago · GES-031 Compromiso parcial, más el registro en `promesa_pago` | Lo que cuenta es la `promesa_pago`; el código es el resultado de la gestión |
| Convenio | GES-050 Acordado · GES-052 Solicitado · GES-051 Solicita refinanciación | |
| Negativa | GES-060 a GES-064 | Baja la prioridad, sin excluir |
| Reclamo o disputa | GES-070 a GES-073 | **Excluye de los cortes** hasta que se resuelva (ISO 18295-1 §4.5 f; trato digno) |
| Canal digital | GES-006 SMS · GES-007 Email · GES-008 WhatsApp | Envío, no contacto. Su resultado (leído, respondido) viene del Timeline de Sender |
| **No son resultados de una gestión** | GES-001 Sin definición · GES-032 Promesa incumplida · GES-053 Convenio incumplido · GES-040 a GES-044 (pagos) · GES-080 a GES-082 (derivación) · GES-090 a GES-094 (administrativos) | Son estados que cambia un proceso o un dato. **No cuentan** en las tasas por intento |

### 4.2 Códigos de situación (estado del caso)

Se usan para la **foto de la cartera** y para las exclusiones, no para las tasas por intento:
- **Contactado:** SIT-010 a SIT-013 (categoría CONTACTADO); **titular:** SIT-011.
- **Promesa:** SIT-020 vigente, que **excluye** del corte hasta su vencimiento más la tolerancia (§9.3).
- **Convenio al día:** SIT-030 y SIT-033; excluye.
- **Pagando:** SIT-040 a SIT-042; excluye o baja la prioridad según §9.3.
- **Cancelado:** SIT-050 a SIT-054; excluye siempre (la cuenta está bloqueada).
- **Negativa, baja, legal e incobrable:** SIT-060, SIT-061, SIT-070 a SIT-073 (baja **excluye**), SIT-090 a SIT-094
  (legal: excluye del discador) y SIT-100 a SIT-104.

### 4.3 Inconsistencia a resolver: el "% CPC" del tablero

`docs/dashboards-spec.md` §3.1 y `backend/src/modules/dashboards/codigos.constants.ts` definen **"% CPC (Contacto con Persona Correcta)" =
casos con situación SIT-011 o SIT-012 ÷ casos**.
- **SIT-012 es "contactado con tercero":** en la industria, el contacto con la persona correcta es solo el titular o
  un autorizado.
- **Es una foto del stock** (qué parte de los casos está hoy en esa situación), no una tasa por intento.

**[DECIDIDO, U-7]** El tablero muestra los dos:
- **"Casos contactados (titular o tercero)"**: SIT-011 + SIT-012, la fórmula de hoy con otro nombre. El número no
  cambia;
- **"Casos contactados con el titular"**: SIT-011, nuevo.

Los dos son fotos del stock. "Contacto con el titular por intento" (RPC-I, §5.2) es otra cosa: la tasa de la Fase 2.
Las dos definiciones viven en el módulo único de indicadores (§5) y las usan el tablero y el asistente.

### 4.4 Mapeo de los resultados de Neotel

**[PENDIENTE]** Cuando lleguen los tickets (U-2), cada resultado del discador (no atendió, ocupado, contestador,
inválido, abandonada, atendida por un agente) se mapea a un código GES con una tabla de configuración
(`parametro` u otra tabla nueva). La tipificación de una llamada atendida es un código GES (U-5);
`llamada_neotel.subcategoriaId` ya es una FK a `parametro`.

**[PENDIENTE] De dónde sale la tipificación del agente:** el `DispositionForm` no existe (§3.2). Puede venir del ticket,
si Neotel guarda la tipificación que el agente marca en su consola, o de la gestión que el operador carga en la ficha.
En el segundo caso hay que unir el ticket con la gestión, por caso, teléfono y hora. Se decide con la documentación
de Neotel.

---

## 5. Catálogo de indicadores

Ninguno tiene una definición normativa única: las fuentes difieren en el denominador. La plataforma fija la suya acá,
la publica en la ayuda y, donde hay dos variantes en uso, calcula las dos. **Un solo módulo de código**
(`indicadores.ts`, por ejemplo) es la fuente de las definiciones, la que usan las consultas, la pantalla, la wiki y el
asistente.

### 5.1 Resultado: todos se pueden calcular desde la Fase 1

| Id | Indicador | Fórmula | Niveles | Notas |
|---|---|---|---|---|
| REC-N | **Recupero por remesa a N días** (curva de liquidación) | $ pagos con fecha ≤ carga + N ÷ $ deuda asignada de la remesa | remesa, cedente | El indicador central para comparar una remesa contra las anteriores del mismo cedente **a la misma edad**. Experian: medir por lote de asignación, no sobre el stock total |
| REC-C | Casos con algún pago | casos con ≥ 1 pago ÷ casos de la remesa | remesa, cedente | |
| CANC | Casos cancelados | casos en SIT-050 a SIT-054 ÷ casos | remesa, cedente | |
| ROLL | Pasaje de tramo de mora | saldo en el tramo X+1 en t+1 ÷ saldo en X en t | cedente | Tramos: 0–29, 30–59, 60–89, 90–119, 120+ días. Se calcula sobre saldo |
| KEPT-C | Promesas cumplidas, por cantidad | promesas cumplidas ÷ promesas vencidas | remesa, cedente, operador | Tolerancia en días a fijar **[PROPUESTA: 3 días hábiles]**. Usa los estados de `promesa_pago` |
| KEPT-M | Promesas cumplidas, por monto | $ pagado dentro de la tolerancia ÷ $ prometido | idem | |
| MIX | Composición de la remesa | distribución por situación, gestión, tramo de mora y saldo | remesa | Lo que "trae" la remesa |
| CARGA | Datos de la carga | fecha, quién la cargó, archivo, filas, errores | remesa | De `remesa`, `jobimport`, `import_progreso` y `transaccion` |

### 5.2 Contactabilidad: Fase 2, con los tickets

| Id | Indicador | Fórmula | Notas |
|---|---|---|---|
| PEN | Penetración | casos con ≥ 1 intento en la ventana ÷ casos de la lista | Tope 100 % |
| INT | Intensidad | intentos ÷ casos | Sin tope (500 % = 5 intentos por caso). Clave para no hostigar |
| CON | Conexión | intentos atendidos, incluido el contestador ÷ intentos | |
| VIVO | Contacto vivo | contactos con una persona (titular o tercero) ÷ intentos | |
| **RPC-I** | **Contacto con el titular por intento** | RPC ÷ intentos | El denominador principal |
| RPC-V | Contacto con el titular por contacto vivo | RPC ÷ contactos vivos | La otra variante en uso: se muestran las dos |
| IPR | Intentos por contacto con el titular | intentos ÷ RPC | |
| PTP | Promesas por contacto con el titular | promesas ÷ RPC | |
| $H | $ cobrado por hora | $ cobrado ÷ horas logueadas | De `sesion_agente_neotel` y `estado_agente_evento` |
| $RPC | $ cobrado por contacto con el titular | $ cobrado ÷ RPC | Atribución del pago **[PROPUESTA]**: el último RPC del caso en los 30 días anteriores |
| AHT | Duración media de la gestión | (habla + espera + trabajo posterior) ÷ llamadas | |
| ABN | Abandono del predictivo | atendidas que no llegan a un agente en 2 s ÷ atendidas en vivo | **Objetivo ≤ 3 %**, referencia de EE. UU. y Reino Unido. En Argentina no hay norma: ISO 18295-1 pide minimizarlo |
| FCR | Resolución en el primer contacto | casos con promesa, pago o convenio en su primer RPC ÷ casos con RPC | |

### 5.3 Cortes y franjas

- **Franjas [PROPUESTA]:** 5, de 9–11, 11–13, 13–15, 15–17 y 17–20, dentro de la ventana U-1. La literatura (Wagner,
  2013) recomienda pocas franjas, porque con más quedan muy pocos intentos en cada una. **Días:** lunes a viernes, y
  sábado si se confirma U-1.
- **Mapa de calor:** franja × día de RPC-I, por cedente y por tipo de teléfono (móvil o fijo, por el prefijo).

### 5.4 Cuándo hay datos suficientes

- **Intervalos de Wilson** al 95 % para toda proporción que se muestre.
- **[PROPUESTA]** No se recomienda una franja si tiene menos de 100 intentos a nivel cartera.
- **[PROPUESTA]** No se compara una remesa contra el cedente si hay menos de 3 remesas anteriores del cedente a esa
  edad.
- Si no alcanza, el asistente dice "todavía no hay datos suficientes: hacen falta unos N intentos más".

---

## 6. Fase 0: los datos de contacto

### 6.1 Integración de los tickets de Neotel ([PENDIENTE] documentación de la API, U-2)

**Flujo:**
1. **Un job `SyncTicketsNeotel` en BullMQ** (cola propia) trae de la API de Neotel los tickets de **todas** las
   llamadas en una ventana de tiempo: por defecto, desde el último sync exitoso del día (o desde el comienzo del día)
   hasta ahora.
2. **Disparadores:**
   - **cron** a las **12:00 y a las 20:30**, hora de Argentina (`America/Argentina/Buenos_Aires`, U-3);
   - **botón manual** **"Traer las llamadas de hoy"** (U-3), con el estado del último sync (cuándo, cuántos nuevos,
     cuántos ya estaban) y el progreso en vivo por el socket `/rt`, como las importaciones;
   - **backfill** por rango de fechas, solo para quien administra la telefonía, para recuperar días que fallaron. No
     trae historia anterior a la plataforma (U-12).
3. **Idempotencia, sin duplicados (U-4):**
   - el **identificador del ticket de Neotel** es la clave: columna `ticketIdNeotel` única en `llamada_neotel`;
   - se inserta con `createMany({ skipDuplicates: true })` o con `upsert` por esa clave;
   - una segunda corrida en el mismo día, sea del cron o manual, solo agrega los nuevos y cuenta los repetidos como
     "ya estaban";
   - si la API no da un id estable, se usa una clave compuesta (campaña, contacto o base, teléfono, hora de inicio):
     decidirlo con la documentación.
4. **Un solo sync a la vez:** lock en Redis, como el lock de consolidación. Si se aprieta el botón mientras corre el
   cron, se responde "ya hay una sincronización en curso" con su progreso.
5. **Conciliación con las llamadas del CTI:** hoy no aplica, porque el CTI no registra llamadas (§3.2). Queda para
   cuando las registre. Entonces, una llamada atendida por un agente ya puede existir en `llamada_neotel` (creada por
   el evento `RINGING_AGENT`), sin ticket. El sync la **completa** (le pone el `ticketIdNeotel` y los
   tiempos) en vez de crear otra. El match se hace por contacto o base, teléfono y hora, con una tolerancia de
   segundos a fijar con la documentación.
6. **Resolución del caso:** por base y contacto de Neotel (`baseNeotel` + `idContactoNeotel`), igual que el CTI. Si
   no, por teléfono dentro de la remesa o la campaña. Un ticket sin caso se guarda igual, con `deudorId` null, y se
   cuenta en el registro del sync.
7. **Tipificación:**
   - la del agente es un código GES (§4.4);
   - el resultado del discador se mapea con la tabla de §4.4;
   - un resultado sin mapear queda guardado crudo (`resultadoNeotel`) y se avisa en el registro del sync, nunca se
     descarta.

**Schema [PROPUESTA], aditivo:**
- `llamada_neotel`:
  - `ticketIdNeotel String? @unique`;
  - `origen` (`'cti' | 'sync'`);
  - `resultadoNeotel String?` (crudo);
  - `gestionId Int?` (código GES mapeado, FK a `parametro`);
  - `agenteUsuarioId Int?`;
  - `syncId Int?`.

  El modelo ya tiene `estado`, `ringedAt`, `answeredAt`, `endedAt`, `duracionSeg`, `causaFin`, `subcategoriaId`,
  `campañaId`, `baseNeotel`, `idContactoNeotel`, `telefono` y `deudorId`.
- `sync_tickets_neotel`, el registro de corridas:
  - `id`, `origen` (`'cron' | 'manual' | 'backfill'`), `usuarioId`;
  - `desde`, `hasta`, `estado`;
  - `leidos`, `nuevos`, `yaEstaban`, `completadosCti`, `sinCaso`, `sinMapear`, `errores`;
  - `startedAt`, `finishedAt`, `detalleError`.
- **Activar `llamada_neotel` en prod.** La tabla está en `schema.prisma` pero no en la base de prod: averiguar por qué
  no la creó el `db push` del deploy antes de agregar nada.

**Permiso [PROPUESTA]:** `telefonia.sincronizar` (traer las llamadas a mano), o reusar `telefonia.administrar`. El
cron no necesita permiso.

**Logging:** intención y resultado con los conteos y la duración, siguiendo la política de `CLAUDE.md`. Nunca
teléfonos completos ni datos del ticket que identifiquen a la persona.

**Fallos silenciosos a evitar:**
- **Un sync que se corta a mitad:** queda FALLIDO con lo que alcanzó a guardar, y el siguiente retoma desde el último
  ticket guardado, no desde la última corrida exitosa.
- **La API pagina:** recorrer todas las páginas y verificar el total si la API lo informa.
- **La API usa otra zona horaria:** normalizar a UTC al guardar y fijarlo con un test.
- **Tickets que aparecen tarde** (Neotel los cierra después): el sync de las 12:00 vuelve a mirar el día anterior
  completo, y esos tickets entran como nuevos o completan los que ya estaban.

### 6.2 Lo demás de la Fase 0

- **Calendario de feriados:** no existe. Hace falta una tabla `feriado` (fecha, descripción, nacional o provincial)
  que administre Ajustes, con los nacionales cargados por año. La usan la ventana de §9 y los cortes.
- **Limpieza de contactos:** los unos 20 contactos con el número o el mail en el campo `tipo`. Primero preview y
  después arreglo, con el OK del usuario. Ver también la memoria "plantillas-contacto-tipo-valor".
- **Tipo de teléfono:** móvil o fijo según el prefijo (la característica más el 15, o el 9 internacional), calculado
  una vez y guardado. Sirve para el mapa de calor.
- **Opt-out por canal:** "no me llamen", "solo por WhatsApp". Hoy no existe. **[PROPUESTA]** Un flag en `contacto`
  (`noContactar` con motivo y fecha), que excluya en §9.

---

## 7. Fase 1: el analista sobre los datos de hoy

Se puede construir ya: no depende de los tickets.

### 7.1 Arquitectura

- **Una función nueva del asistente, `cartera`**, con el mismo patrón de la Fase B:
  - el mismo panel con selector de modo (D-13 de la Fase B): Ayuda / Armar un reporte / **Analizar la cartera**;
  - el mismo SSE y la misma medición y topes (`asistente_funcion`);
  - un runner propio sobre `turno/llamada-modelo.ts`.
- **Modelo:** **[PROPUESTA]** Sonnet 5.5, porque es análisis y redacción. Haiku para preguntas simples si el set de
  evaluación muestra que alcanza.
- **`MetricasCarteraService`:** consultas deterministas, una por indicador de §5, con tests contra fixtures de
  números conocidos. Lo usan el asistente, los tableros y la wiki: **una sola implementación por indicador**.
- **Permisos [PROPUESTA]:** `asistente.cartera` (nuevo, asignable) + `dashboards.ver`.
- **[DECIDIDO, U-9] Sin actividad por operador en la Fase 1:** ninguna herramienta agrupa ni filtra por operador. Se
  retoma con `inicio.ver_equipo` (planeado para la Fase 2 de Inicio en `docs/inicio-spec.md`, todavía no existe).

### 7.2 Herramientas del modelo (todas devuelven solo agregados)

| Herramienta | Entrada | Devuelve |
|---|---|---|
| `buscar_remesa` | texto ("la 30155 de TELECOM", "la última de AYSA") | candidatos `{id, numero, empresa, fecha de carga, casos}`. Si hay más de uno, el modelo pregunta |
| `resumen_remesa` | `remesaId` | CARGA + MIX + deuda asignada + REC a la fecha + CANC + pagos (cantidad y monto) |
| `curva_recupero` | `empresaId`, `remesaIds?`, `dias` | REC-N por día desde la carga, para cada remesa y para la mediana del cedente |
| `comparar` | indicador, dos conjuntos (remesas, cedentes o períodos) | los valores con sus intervalos y la diferencia |
| `distribucion` | dimensión (situación, gestión, tramo de mora, saldo), filtro. Sin operador en la Fase 1 (U-9) | conteos y porcentajes |
| `promesas` | filtro | cantidad, montos, KEPT-C y KEPT-M |
| `explicar_indicador` | id | la definición de §5, tal cual |
| `ofrecer_ir_a` | (la de la Fase A) | tarjeta para abrir el tablero o el reporte |

**Lo que se muestra:**
- **gráficos:** curva de recupero, barras de distribución y, en la Fase 2, el mapa de calor. Los dibuja el frontend
  con Recharts a partir de los datos de la herramienta, nunca con datos que escriba el modelo;
- **tablas** chicas, y la **fuente** de cada número (la definición y el corte de datos).

**Reglas de privacidad:**
- ninguna herramienta devuelve filas de casos;
- un agregado de **menos de 5 casos** se muestra como "< 5" **[PROPUESTA]**, para que no identifique personas;
- las preguntas sobre un cliente puntual ("¿a qué hora llamo a Pérez?") no se responden en el panel: llevan a la
  ficha del caso, donde el horario sale calculado por el backend (Fase 3).

### 7.3 Recomendaciones en la Fase 1

Reglas explícitas con su evidencia, no "intuición" del modelo:
- **Remesa por debajo de la mediana del cedente a la misma edad:** se señala, y se miran los casos sin gestión (la
  penetración, cuando existan los tickets) y el tramo de mora.
- **Concentración del saldo:** si el 20 % de los casos tiene el 80 % del saldo, se sugiere priorizarlos (valor en
  riesgo, McKinsey).
- **Promesas por vencer y promesas incumplidas sin regestión.**
- **Casos sin ningún teléfono válido:** se sugiere enriquecimiento, que es una categoría de importación que ya existe.

Las reglas viven en código, con su umbral y su texto. El modelo elige cuáles aplican y las explica.

### 7.4 Set de evaluación

Como el de la Fase B: preguntas reales sobre fixtures con números conocidos. Se mide:
- que cite el número correcto;
- que no invente números (todo número de la respuesta tiene que aparecer en un resultado de herramienta);
- que pregunte cuando la remesa es ambigua;
- que diga "no hay datos suficientes" cuando corresponde;
- el costo y la latencia.

Regla dura del set: **un número en la respuesta que no salga de una herramienta es FALLA**.

---

## 8. Fases 2 a 4

### 8.1 Fase 2: contactabilidad de la cartera (con unas 4 semanas de tickets)

- Los indicadores de §5.2 en el tablero y en las herramientas del asistente:
  - `contactabilidad(filtro, agrupar_por: franja | dia | operador | tipo_telefono | remesa)`;
  - `mapa_calor(filtro)`.
- Recomendación de franja **a nivel cartera**, con su intervalo y la cantidad de intentos (§5.4).

### 8.2 Fase 3: mejor horario por teléfono

**Estimación con suavizado bayesiano Beta-Binomial jerárquico** (Wagner, 2013; Wheeler, 2018):

`p̂(teléfono, franja) = (RPC_tf + κ · p_segmento(franja)) / (intentos_tf + κ)`

- **κ ≈ 2 a 3 llamadas equivalentes.** La jerarquía del prior va de la cartera, al cedente, al segmento (tramo de
  mora y tipo de teléfono), al teléfono.
- **Se premia el RPC, no la atención:** un tercero o un contestador no cuenta.
- **Recencia:** los intentos se ponderan con decaimiento **[PROPUESTA: vida media de 60 días]**.
- **La franja de una negativa (GES-060 a GES-064) baja de probabilidad** durante un tiempo **[PROPUESTA: 14 días]**.
  Wagner encontró que volver a llamar en esa franja empeora el contacto, posiblemente por el bloqueo por identificador
  de llamada.
- **Tabla `contactabilidad_telefono`** (contactoId, franja, día, intentos, rpc, p_suavizada, intervalo,
  actualizadoEn), recalculada todas las noches por un job.
- **En la ficha del caso:** "mejor horario: martes a jueves de 17 a 20 (12 intentos)", calculado por el backend.

**Sesgo de selección:** si solo se llama a la mañana, la mañana "parece" mejor. Mitigaciones:
- registrar en cada intento **qué regla lo asignó a esa franja** y con qué probabilidad;
- reservar una **cuota de exploración del 10 al 20 %** **[PROPUESTA: 15 %]**, asignada al azar;
- más adelante, **Thompson sampling** sobre las franjas permitidas (Russo et al., 2018). En llamadas automáticas en
  India, un bandit colaborativo dio +5,8 % de atención en un ensayo de campo, y la versión con Thompson sampling
  necesitó 16 % menos llamadas.

**Qué mejora esperar:** en cobranza de tarjetas, Bollapragada y Nair (2010) reportan más de 10 % de aumento en RPC.
Lo razonable es un dígito a cerca del 20 % en RPC por intento, no un múltiplo, y en algunos subgrupos puede salir
negativo. Por eso se mide (§8.5).

### 8.3 Fase 3: cortes de base para el discador

Se pide "armame los cortes de mañana para TELECOM". El asistente propone una base por franja, con la cantidad de
casos, el saldo y el criterio de cada una, en una tarjeta. **Generar las bases** produce los archivos, después de la
aprobación.

1. **Elegibilidad, con reglas duras de §9:**
   - la ventana y los feriados;
   - los topes de frecuencia;
   - sin promesa vigente;
   - sin convenio al día;
   - no cancelados;
   - sin reclamo o disputa abiertos;
   - no en baja ni en legal;
   - teléfonos no marcados como inválidos, equivocados o de terceros;
   - sin opt-out.
2. **Prioridad por valor esperado:** P(RPC | franja) × P(PTP | RPC) × P(pago | PTP) × monto. Mientras no haya
   historia de promesas (Fase 4), se usa el saldo × la antigüedad de la mora (valor en riesgo).
3. **Asignación:** cada caso va a la base de su mejor franja. Sin historia, a la mejor franja de su cartera.
4. **Exploración:** la cuota de §8.2 va a otras franjas, al azar y registrada.
5. **Orden y topes:** por prioridad dentro de cada base, con tope diario por caso y por teléfono, y rotación entre los
   teléfonos del caso.

**Salida:**
- **El formato de la base de predictivo que ya usan:** la plantilla de reportes #1, «Neotel - base predictivo
  IPLAN», que sale en TXT.
- **Cada base es una ejecución de reporte:** la mejor franja es un campo más del motor de reportes, leído de
  `contactabilidad_telefono`, así que cada base queda auditada y descargable.
- **Si la documentación de Neotel lo permite**, la carga directa de la base por API queda para después, siempre con
  aprobación.

### 8.4 Fase 4: propensión y próxima mejor acción (con meses de historia)

- **Score de probabilidad:** de contactar, de prometer después de un contacto y de pagar después de una promesa
  (Sánchez, Maldonado y Vairetti, 2022, con datos de una financiera chilena).
- **Próxima mejor acción por segmento:** llamada, mail, WhatsApp, oferta de convenio o nada (self-cure).
  - Hay evidencia de que menos acciones "duras" pueden recuperar igual o más (Yang et al., 2023).
- **Bandits para la asignación de franjas.**

### 8.5 Champion/challenger

- **Cada regla nueva se prueba contra la actual:** el horario recomendado, la priorización o la exploración.
- **Asignación al azar a nivel caso:** registrar la semilla y el grupo en cada intento.
- **Métricas:** RPC-I, PTP, KEPT-M y $H.
- **Duración y tamaño de muestra:** se calculan antes de empezar. La regla reemplaza a la actual solo si le gana al
  control con significancia (Experian, insideARM).
- **El asistente informa el resultado:** "la regla nueva dio +8 % de contacto con el titular (intervalo de +3 a
  +13 %), con 4.200 intentos por grupo".

---

## 9. Cumplimiento

No es asesoramiento legal. **[PENDIENTE]** Validarlo con quien lleve los temas legales de AMSA y con los cedentes, que
según ISO 18295-2 también fijan reglas.

### 9.1 Normas

| Norma | Estado | Qué implica |
|---|---|---|
| Ley 24.240, art. 8 bis (trato digno), incorporado por la Ley 26.361 | Vigente | Nada intimidatorio ni con apariencia judicial. La multa civil del art. 52 bis alcanza **solidariamente** a quien gestiona en nombre del cedente |
| CCyC, arts. 1097 y 1098 | Vigente | Trato digno, equitativo y no discriminatorio |
| **CABA, Ley 6171, modificada por la Ley 6271** | Vigente (texto consolidado al 29/02/2024) | Para deudores con domicilio en CABA: **sin contacto de lunes a viernes de 20 a 8**, sábados antes de las 8 y después de las 12, ni domingos o feriados. Prohíbe reiterar comunicaciones que hostiguen, el contacto en el ámbito laboral y el contacto con terceros. En el primer contacto exige identificarse, identificar al acreedor e informar el origen, el desglose y la fecha de mora. No fija un número máximo de contactos |
| BCRA, "Protección de los usuarios de servicios financieros" (texto ordenado, última comunicación "A" 8433) | Vigente para cedentes financieros | Los deudores de créditos cedidos son usuarios (1.1.1). El gestor y el cedente responden juntos (1.1.2). Trato digno no discriminatorio (2.6). No fija horarios |
| Ley 26.951, Registro No Llame, y Decreto 2501/2014 | Vigente | Cubre publicidad, oferta y venta. La cobranza de una deuda del titular **quedaría afuera**, siempre que no se ofrezca otro producto en la llamada (interpretación, no confirmada por la AAIP). El decreto define el horario razonable como lunes a viernes de 9 a 21 y sábados de 9 a 13 |
| Res. SCI 1033/2021 | **Derogada** por la Res. SC 51/2024 | Pedía días hábiles de 9 a 20, sin sábados. Sirve solo como referencia de criterio |
| Regulation F de EE. UU. (CFPB), §1006.6 y §1006.14 | No vigente acá | Referencia: de 8 a 21 h; presunción de hostigamiento con más de 7 llamadas en 7 días por deuda o con una llamada en los 7 días siguientes a una conversación |
| ISO 18295-1:2017, §4.5 (llamadas salientes) | Norma voluntaria | Respetar el no contactar, minimizar el abandono, verificar a la persona correcta, decir el propósito, no volver a contactar a quien no quiere y llamar dentro de los horarios aceptados |

### 9.2 Ventana

- **[DECIDIDO, U-1] De 9 a 20 h.** Cae dentro de lo que permite CABA y de la ex Res. 1033.
- **[PENDIENTE] Sábados:** la ley de CABA permite hasta las 12. Si se trabaja el sábado, de 9 a 12.
- **Sin domingos ni feriados** (calendario de §6.2).
- La ventana se aplica en **hora de Argentina** a todos los casos. Hoy todos los deudores están en el país.

### 9.3 Topes y exclusiones [PROPUESTA, a confirmar]

| Regla | Propuesta |
|---|---|
| Conversaciones con el titular por caso | como máximo 1 por día; después de una, no más llamadas ese día |
| Intentos por caso | como máximo 3 por día y 7 por semana (inspirado en la Regulation F) |
| Intentos por teléfono | como máximo 2 por día |
| Promesa vigente | sin llamados hasta el vencimiento de la promesa más la tolerancia (3 días hábiles) |
| Convenio al día | sin llamados de cobranza |
| Reclamo o disputa abiertos | sin llamados hasta que se resuelvan |
| Tercero (GES-003) | ese teléfono no se usa para ese caso hasta confirmar al titular |
| Teléfono equivocado, fuera de servicio o inexistente | ese teléfono sale del caso |
| Opt-out | por canal, hasta que la persona lo revoque |
| Abandono del predictivo | objetivo ≤ 3 % por campaña y por día; se muestra en el tablero |

Los topes van en la configuración (Ajustes), no en el código. Se aplican **antes** de cualquier optimización.

### 9.4 Gobernanza del uso de IA

- **La IA recomienda y una persona aprueba** los cortes y las acciones.
- **Cada recomendación y cada corte quedan registrados en la auditoría** (`transaccion`), con la regla, los datos y
  quién aprobó.
- **Variables prohibidas** para decidir la intensidad o la calidad del trato: los motivos del punto 2.6 del BCRA y del
  art. 1098 del CCyC (raza, religión, nacionalidad, ideología, sexo, edad, condición social o caracteres físicos) y
  sus proxies obvios.
- **Monitoreo de disparidades:** intensidad de contacto por segmento, para detectar que el optimizador no se ensañe
  con un grupo.
- **Minimización de datos:** el modelo ve agregados (§1.1).
- **Referencias:**
  - COPC R8 (2026) pide ética de la IA y retirar la tecnología que se equivoca seguido;
  - la AAIP publicó una guía preliminar de uso responsable (2024);
  - el CFPB advirtió sobre chatbots que dejan a la gente sin acceso a una persona.

---

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| El modelo dice un número que no salió de la base | Toda cifra de la respuesta tiene que estar en un resultado de herramienta. El set de evaluación lo mide como FALLA. El texto de la respuesta se cruza con los resultados antes de mostrarlo (red determinista, como las de la Fase B) |
| Definiciones distintas entre el tablero y el asistente | Una sola implementación por indicador (§5). Resolver el "% CPC" (§4.3) |
| Recomendar una franja con pocos datos | Umbrales de §5.4 e intervalos de Wilson |
| Sesgo de selección en el horario | Exploración registrada y evaluación con control (§8.2, §8.5) |
| El optimizador hostiga | Topes duros antes de optimizar (§9.3) y monitoreo de la intensidad |
| Tickets duplicados o perdidos | Clave única por ticket, registro de corridas, retomar desde el último guardado y revisar el día anterior a las 12:00 (§6.1) |
| Datos personales al modelo | Solo agregados y agrupaciones de 5 o más casos (§7.2) |
| La tabla `llamada_neotel` no está en prod y nada la escribe | Averiguar por qué no está antes de la Fase 0. La fuente de las llamadas va a ser el sync de tickets (§3.2, §6.1) |
| Una empresa arranca con discador antes de que exista el sync, y esos días quedan sin llamadas | Tener el sync antes de esa primera empresa, o cubrir esos días con el backfill si Neotel guarda algunas semanas (§6.1). No es historia del sistema anterior: esa no se trae (U-12) |
| Las gestiones y promesas no quedan registradas | Que cada gestión cambie el estado de gestión del caso (código GES) y que cada promesa se cargue en `promesa_pago`, desde el primer día de cada empresa |

---

## 11. Preguntas abiertas

1. **Neotel (U-2):**
   - endpoint y autenticación;
   - si hay un id estable de ticket;
   - paginación y zona horaria;
   - qué resultados del discador existen;
   - si incluye las llamadas no atendidas y las abandonadas;
   - si se puede cargar una base por API.
2. **Sábados:** ¿se trabaja? Si sí, de 9 a 12 por la ley de CABA.
3. **Topes de §9.3:** ¿se aceptan los propuestos?
4. ~~**"% CPC" del tablero (§4.3):** ¿renombrar o redefinir?~~ Resuelta: U-7, se muestran los dos.
5. ~~**RPC (§4.1):** ¿cuentan como contacto con el titular los resultados que lo implican?~~ Resuelta: U-8, sí.
6. **Atribución de pagos a contactos para $RPC (§5.2):** ¿30 días?
7. ~~**Permisos (§7.1):** ¿quién ve la actividad por operador?~~ Resuelta: U-9, queda afuera de la Fase 1.
8. **Cortes:** ¿solo archivo con aprobación, o también carga directa en Neotel cuando la API lo permita?

---

## 12. Plan para retomar

1. **Fase 1a, ahora (U-10):** el módulo único de indicadores, el tablero sobre ese módulo con U-7 y la curva de recupero
   por remesa en el tablero. Spec ejecutable: `docs/analista-cartera-fase1-spec.md`. Las preguntas 4, 5 y 7 ya están
   resueltas (U-7 a U-9).
   - **Mientras tanto, del lado de la operación:** que cada gestión cambie el estado de gestión del caso (código GES) y cada promesa se cargue en
     `promesa_pago`, no solo en un comentario. Sin eso no hay indicadores de promesas.
   - **Juntar preguntas reales** para el set de evaluación de la 1b: las que ya le hacen al asistente de ayuda sobre la
     cartera y las que anote quien supervisa.
2. **Fase 1b, el agente (función `cartera`, herramientas de §7.2, gráficos en el panel, set de evaluación),** cuando se
   cumpla esta condición **[PROPUESTA]**, mirada **por empresa** desde que arranca en la plataforma (U-12):
   - las empresas principales tienen 3 remesas o más en la plataforma, con 60 días o más de antigüedad y pagos;
   - hay de 4 a 6 semanas de gestiones tipificadas (cambios del estado de gestión hechos por operadores, en
     `transaccion`), o los tickets de Neotel ya están entrando.

   Entonces se corren las mediciones de prod del spec ejecutable, se fijan los umbrales con las distribuciones reales y
   el set de evaluación se arma con las preguntas reales.
2. **Fase 0 cuando llegue la documentación de Neotel:**
   - el spec de la integración de tickets (§6.1): sync con cron a las 12:00 y 20:30, botón manual, backfill,
     idempotencia y conciliación con el CTI;
   - activar `llamada_neotel` en prod;
   - feriados, limpieza de contactos y opt-out.
3. **Fase 2:** con unas 4 semanas de tickets.
4. **Fases 3 y 4:** después, con champion/challenger desde el primer cambio.

---

## 13. Fuentes

La investigación completa se hizo el 19/10/2026. Las principales fuentes:

**KPIs y benchmarks**
- [vcc.live](https://vcc.live/?p=29667) y [MaxContact Benchmarking Report 2024](https://www.callcentrehelper.com/images/resources/2024/maxcontact-benchmarking-insights-report-240703.pdf): cobranza, Reino Unido, datos autodeclarados de proveedores.
- [TrueAccord](https://blog.trueaccord.com/2023/09/top-kpis-for-your-recovery-operations/) y [Genesys, penetración y saturación](https://help.genesys.com/pureconnect/mergedprojects/wh_dlr/mergedProjects/dialer_manager_help2/desktop/penetration_rate_view.htm).
- Experian: [recupero por lote de asignación](https://www.experian.com/blogs/insights/best-practices-for-improving-agency-performance/) · [champion/challenger](https://www.experian.com/blogs/insights/championchallenger-collections-strategy-testing/).

**Normas**
- [ISO 18295-1:2017](https://www.iso.org/standard/64739.html) (centros de contacto) · [COPC CX Standard R8](https://www.copc.com/copc-standards/r8-whats-new/).

**Mejor horario**
- Bollapragada y Nair (2010), *Production and Operations Management* 19(6), DOI 10.1111/j.1937-5956.2010.01156.x: RPC +10 %.
- Wagner (2013), *Survey Research Methods* 7(1): [PDF](https://ojs.ub.uni-konstanz.de/srm/article/view/5037/4993).
- Durrant, D'Arrigo y Steele (2011), *JRSS-A* 174(4): [LSE](https://researchonline.lse.ac.uk/id/eprint/52201).
- Sánchez, Maldonado y Vairetti (2022), *Decision Support Systems* 159: [UAndes](https://repositorio.uandes.cl/items/44a394f3-50bb-4dd2-abee-42a7836a76cc/full).
- Patentes [US5621790](https://patents.google.com/patent/US5621790A/en) (ASPI, 1995) y [US12477066B2](https://patents.google.com/patent/US12477066B2/en) (Ojo, 2025).
- Bandits: [Russo et al. 2018](https://arxiv.org/pdf/1707.02038) · Kilkari [arXiv 2507.16356](https://arxiv.org/html/2507.16356v2) y [arXiv 2410.21405](https://arxiv.org/pdf/2410.21405).
- Shrinkage: [Wheeler 2018](https://andrewpwheeler.com/2018/07/23/sorting-rates-using-empirical-bayes/).

**Regulación**
- [Ley 24.240 (InfoLEG)](https://servicios.infoleg.gob.ar/infolegInternet/anexos/0-4999/638/texact.htm) · [CABA, Ley 6171 (BOCBA)](https://boletinoficial.buenosaires.gob.ar/normativaba/norma/477004).
- [BCRA, Protección de usuarios](https://www.bcra.gob.ar/Pdfs/Texord/t-pusf.pdf) · [Ley 26.951](https://www.argentina.gob.ar/normativa/nacional/norma-233066/texto) y [Decreto 2501/2014](https://www.argentina.gob.ar/normativa/nacional/240407/texto) · [Res. 425/2022](https://www.argentina.gob.ar/normativa/nacional/norma-364134/texto).
- [Regulation F §1006.14 (CFPB)](https://www.consumerfinance.gov/rules-policy/regulations/1006/14/) · [47 CFR 64.1200 (FCC, abandono)](https://www.law.cornell.edu/cfr/text/47/64.1200).

**IA en cobranzas**
- [Yang et al. 2023 (SSRN)](https://papers.ssrn.com/abstract=4488673) · [Abe et al. 2010 (IBM)](https://research.ibm.com/publications/optimizing-debt-collections-using-constrained-reinforcement-learning) · McKinsey (artículos de analytics en cobranza: cifras de consultora, leídas solo en extractos) · [AAIP, guía de IA responsable](https://www.argentina.gob.ar/noticias/guia-de-la-aaip-para-usar-la-inteligencia-artificial-de-manera-responsable).
