# Integración con la Toolbar de Neotel

> Estado: **implementado, pendiente de probar con una campaña real**. Reemplaza el enfoque de
> [NEOTEL_INTEGRATION_PLAN.md](NEOTEL_INTEGRATION_PLAN.md) §Sprint 3 (softphone WebRTC propio), que
> queda descartado — ver §6.

## 1. Qué cambió respecto al plan original

El plan era **meter un softphone WebRTC dentro de AMSA Gestión** (JsSIP sobre WSS), para sacar X-Lite
de la pantalla del operador. Eso dependía de que Neotel hiciera un upgrade de Asterisk.

Neotel resolvió por otro lado: su **Toolbar** ya tiene softphone propio, y ofrece hostear el CRM del
cliente adentro. O sea, el modelo se da vuelta:

| | Plan original | Toolbar (lo que se implementó) |
|---|---|---|
| Quién contiene a quién | AMSA Gestión embebe el softphone | La Toolbar embebe a AMSA Gestión |
| Audio de la llamada | nuestro, con JsSIP | de Neotel |
| Estado del agente, pausas, campañas | nuestro, contra la API ASMX | de Neotel, desde la Toolbar |
| Qué hacemos nosotros | todo | mostrar la ficha correcta cuando entra la llamada |

El objetivo de fondo —que el operador no salte entre ventanas— se cumple igual, con muchísimo menos
código y sin depender de un upgrade de Asterisk.

## 2. Cómo funciona

La Toolbar corre en `https://neotel.anamayasa.com:8443/neotel/` y embebe nuestra app en un iframe.
Cuando entra una llamada, arma la URL reemplazando las variables de la campaña y navega el iframe.

```
https://amsagestion.anamayasa.com/telefonia/caso?llamada=[[CLAVE]]&data=[[DATA]]
```

- **`[[CLAVE]]`** — el identificador del contacto / de la llamada **en Neotel**. **No es nuestro id**:
  se muestra como referencia de la llamada y no se usa para resolver el caso (salvo el último recurso
  de §2.2).
- **`[[DATA]]`** — campo libre, con los valores unidos por el **SEPARADOR** de la campaña. **Es acá
  donde viaja el id interno del deudor**, porque `CLAVE` la ocupa Neotel con lo suyo.

### 2.1 Parámetros a cargar en la campaña de Neotel

| Parámetro | Valor |
|---|---|
| **MODO** | Iframe |
| **URL** | `https://amsagestion.anamayasa.com/telefonia/caso?llamada=[[CLAVE]]&data=[[DATA]]` |
| **HOME** | `https://amsagestion.anamayasa.com/telefonia/home` |
| **SEPARADOR** | el que usen al cargar la base (nuestro default es `\|`; si usan otro, agregar `&sep=X` a la URL) |
| **POSTVIEW TIMEOUT** | a criterio de operaciones — es el tiempo que tiene el agente para cerrar la gestión antes de volver a estar disponible |

### 2.2 Cómo se resuelve el caso

El contenido de `DATA` lo define quien carga la base, así que
[`resolver-caso.ts`](../frontend/src/pages/telefonia/resolver-caso.ts) **no asume una posición fija**:
arma una lista de candidatos y la pantalla los prueba en orden hasta que uno exista. Un candidato
equivocado devuelve 404 y se pasa al siguiente; cuesta una request de más en un caso raro y a cambio
la carga no se rompe si mañana agregan una columna adelante.

Orden de preferencia:

1. `&deudor=` — id mandado aparte, si alguna campaña se configura así.
2. `&pos=N` — posición fijada dentro de `DATA`.
3. El resto de los valores numéricos de `DATA`, en orden.
4. **`CLAVE`, y solo si `DATA` no aportó ningún candidato.**

> ⚠️ El punto 4 tiene esa restricción a propósito. Es tentador probar la `CLAVE` siempre "por las
> dudas", pero el id de contacto de Neotel y el nuestro son los dos enteros correlativos: tarde o
> temprano uno coincide con un deudor que existe, y ahí la Toolbar abriría **la ficha de otra
> persona** en medio de una llamada sin que nada avise. Gestionar sobre el caso equivocado es peor
> que no abrir ninguno.
>
> Cuando sí se cae a la `CLAVE`, la pantalla **muestra una advertencia** pidiéndole al operador que
> verifique el nombre antes de registrar la gestión.

La URL acepta además `id`, `dni` y `clave` como alias de `llamada`: son los nombres que usan los
ejemplos de la documentación de Neotel, y alcanza con configurar la campaña copiando y pegando para
que no cargue nada y nadie entienda por qué.

## 3. Por qué la sesión funciona sin volver a loguearse

Los navegadores particionan `localStorage` por **sitio** (esquema + dominio registrable), no por
dirección exacta. Como la Toolbar está en `neotel.anamayasa.com` y nosotros en
`amsagestion.anamayasa.com`, los dos son `anamayasa.com`: **el mismo sitio**. El iframe ve la misma
sesión que la pestaña normal, que es donde vive nuestro JWT
([AuthContext.tsx](../frontend/src/context/AuthContext.tsx)).

Esto es lo que hace viable el modo embebido, y **depende de que la Toolbar se sirva por su dominio**.
Si se usara `http://200.5.98.203` —la IP que aparece en la documentación de Neotel— ese sería *otro*
sitio, el iframe quedaría en un almacenamiento aparte y **al operador le pediría login cada vez**.
Mismo código, mismo navegador; lo único que cambia es la dirección.

El puerto no altera nada de esto: `:8443` no cambia el sitio. **Sí** importa para autorizar el
embebido (§4), donde el origen se compara completo.

### 3.1 Si el operador todavía no inició sesión

El login es con Google Identity Services, y **GIS no funciona de forma confiable dentro de un iframe
de otro dominio**: Google renderiza su botón en un iframe propio y el flujo actual (FedCM) exige que
el contenedor declare `allow="identity-credentials-get"` — un atributo que pone Neotel al armar el
iframe, no nosotros. Mostrar el login normal ahí adentro deja al operador apretando un botón que no
hace nada, sin ningún error que lo explique.

Por eso `PrivateRoute` detecta el contexto embebido ([`embebido.ts`](../frontend/src/utils/embebido.ts))
y, en vez de redirigir a `/login`, muestra
[`SesionRequeridaEmbebido`](../frontend/src/components/auth/SesionRequeridaEmbebido.tsx): una pantalla
que abre el login **en una pestaña aparte**, que es un contexto de primer nivel donde Google anda
siempre.

El iframe se entera solo de que la sesión se abrió: la pestaña y el iframe son el mismo origen, así
que comparten `localStorage` y el navegador dispara un evento `storage` cuando se guarda el token.
Queda igual un botón "Ya inicié sesión" como salida manual, por si el evento no llega.

El flujo completo, la primera vez del día:

1. El operador entra a Neotel; el iframe abre la ficha del caso.
2. Como no hay sesión, ve **"Iniciá sesión en AMSA Gestión"** con un botón.
3. Se abre una pestaña, entra con Google, y esa pestaña queda en la app normal.
4. Vuelve a Neotel: **el iframe ya cargó la ficha solo**.

De ahí en más, todas las llamadas de la jornada abren la ficha directo.

## 4. Headers: `frame-ancestors` en lugar de `X-Frame-Options`

CloudFront servía `x-frame-options: DENY`, que bloquea cualquier iframe. No alcanzaba con pasarlo a
`SAMEORIGIN` porque la Toolbar es **otro origen** (subdominio y puerto distintos), y ese header solo
sabe decir "nadie" o "solo yo mismo".

La response headers policy `amsa-gestion-security-headers` (`f6d21d12-…`, distribución
`ERULFXM3HSIVF`) pasa a:

```
content-security-policy: frame-ancestors 'self' https://neotel.anamayasa.com:8443 https://neotel.anamayasa.com
```

Se listan las dos variantes de puerto para que un futuro pasaje del `:8443` al `:443` no rompa la
integración en silencio. Los dos headers **no conviven**: `X-Frame-Options` se removió porque varios
navegadores le dan prioridad sobre el CSP y volvería a bloquear el iframe.

> Es más restrictivo que antes para todo el resto de la web: solo esos dos orígenes pueden embebernos.

## 5. Qué se implementó

| Pieza | Archivo |
|---|---|
| Layout sin menú ni barra superior | [EmbeddedShell.tsx](../frontend/src/components/layout/EmbeddedShell.tsx) |
| Ficha que abre la llamada | [TelefoniaCaso.tsx](../frontend/src/pages/telefonia/TelefoniaCaso.tsx) |
| Resolución del caso desde `CLAVE`/`DATA` | [resolver-caso.ts](../frontend/src/pages/telefonia/resolver-caso.ts) |
| Pantalla del agente sin llamada | [TelefoniaHome.tsx](../frontend/src/pages/telefonia/TelefoniaHome.tsx) |
| Sesión requerida dentro del iframe | [SesionRequeridaEmbebido.tsx](../frontend/src/components/auth/SesionRequeridaEmbebido.tsx) |
| Detección de contexto embebido | [embebido.ts](../frontend/src/utils/embebido.ts) |
| Rutas `/telefonia/*` | [AppRoutes.tsx](../frontend/src/routes/AppRoutes.tsx) |

Decisiones que valen la pena mencionar:

- **La ficha es la de siempre.** El operador ve exactamente lo que ya conoce; lo único que se saca es
  el menú lateral y la barra superior, que dentro del iframe solo comen el alto útil.
- **Si el caso no existe, la pantalla no queda en blanco.** Muestra la clave que mandó la central, los
  datos del `DATA` y un buscador, así el operador puede atender igual mientras se corrige la base. Una
  pantalla vacía en medio de una llamada es peor que un error explicado.
- **El id del deudor se busca en `DATA`, no en `CLAVE`** (§2.2), y la `CLAVE` solo se usa como último
  recurso, avisando en pantalla — para no abrir la ficha de otra persona por una coincidencia de
  números.
- **El login vuelve a la ruta original.** `Login` hacía `navigate('/')` fijo, así que si al operador le
  tocaba loguearse justo cuando entraba una llamada, terminaba en la home con menú en vez de en la
  ficha. Ahora respeta el `state.from` que deja `PrivateRoute`.

## 6. Qué queda descartado del plan viejo

No se borró nada, pero **no hay que retomarlo**:

- **Softphone WebRTC con JsSIP** (`NEOTEL_INTEGRATION_PLAN.md` §Sprint 3). El audio es de la Toolbar.
- **Upgrade de Asterisk a chan_pjsip + transport WSS**, que era el pedido de
  [neotel-mail-pedido-upgrade.md](neotel-mail-pedido-upgrade.md).
- **Certificado de `sip.anamayasa.com`** — era para el WSS. El de `neotel.anamayasa.com` **sí** está en
  uso: es el que sirve la Toolbar en el 8443 (vence el **2026-09-24**, hay que renovarlo).

La capa de **sesión / estado / pausas / campañas** contra la API ASMX
(`backend/src/modules/neotel/`) queda **en stand-by**: el agente maneja todo eso desde la Toolbar. No
se elimina —funciona y está testeada— pero mientras la Toolbar sea la que manda, mostrar nuestro
propio panel de estado llevaría a que la UI diga una cosa y la central otra.

## 7. Pendientes

- **Probar con una campaña real.** Es lo único que falta; requiere que Neotel cargue los parámetros de
  §2 en una campaña de prueba.
- **`postMessage` entre la Toolbar y el iframe.** Sin esto la integración es de una sola vía: Neotel
  nos abre la ficha, pero nosotros no nos enteramos de cuándo se cortó la llamada ni podemos disparar
  acciones desde nuestra pantalla. No bloquea nada, pero define si más adelante se puede dejar la
  disposición desde la ficha en vez de desde la Toolbar. **A preguntarle a Neotel.**
- **Renovar el certificado de `neotel.anamayasa.com`** antes del 2026-09-24.
