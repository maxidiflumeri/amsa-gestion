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
https://amsagestion.anamayasa.com/telefonia/caso?id=[[CLAVE]]&data=[[DATA]]
```

- **`[[CLAVE]]`** — el **id interno del deudor**. Es lo que se carga en la base de Neotel al armar la
  campaña. Elegirlo así evita resolver por documento (que en varias carteras no es único ni viene) o
  por teléfono (que puede estar en más de un caso).
- **`[[DATA]]`** — campo libre con información adicional, con los valores unidos por el **SEPARADOR**
  que se configura en la campaña. Se muestra como contexto arriba de la ficha.

### Parámetros a cargar en la campaña de Neotel

| Parámetro | Valor |
|---|---|
| **MODO** | Iframe |
| **URL** | `https://amsagestion.anamayasa.com/telefonia/caso?id=[[CLAVE]]&data=[[DATA]]` |
| **HOME** | `https://amsagestion.anamayasa.com/telefonia/home` |
| **SEPARADOR** | el que usen al cargar la base (nuestro default es `\|`; si usan otro, agregar `&sep=X` a la URL) |
| **POSTVIEW TIMEOUT** | a criterio de operaciones — es el tiempo que tiene el agente para cerrar la gestión antes de volver a estar disponible |

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
| Pantalla del agente sin llamada | [TelefoniaHome.tsx](../frontend/src/pages/telefonia/TelefoniaHome.tsx) |
| Rutas `/telefonia/*` | [AppRoutes.tsx](../frontend/src/routes/AppRoutes.tsx) |

Decisiones que valen la pena mencionar:

- **La ficha es la de siempre.** El operador ve exactamente lo que ya conoce; lo único que se saca es
  el menú lateral y la barra superior, que dentro del iframe solo comen el alto útil.
- **Si el caso no existe, la pantalla no queda en blanco.** Muestra la clave que mandó la central, los
  datos del `DATA` y un buscador, así el operador puede atender igual mientras se corrige la base. Una
  pantalla vacía en medio de una llamada es peor que un error explicado.
- **`TelefoniaCaso` acepta `id`, `dni` o `clave`** como nombre del parámetro. El propio es `id`, pero
  los ejemplos de la documentación de Neotel usan `dni` y alcanza con que alguien configure la campaña
  copiando y pegando para que la carga falle sin motivo aparente.
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
