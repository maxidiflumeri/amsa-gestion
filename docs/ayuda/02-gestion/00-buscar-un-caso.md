<!--
seccion: Gestión de casos
resumen: Encontrar el caso que buscás, y qué hacer cuando aparecen varios de la misma persona.
revisado: 2026-08-20
rutas: /gestion
-->
# Buscar un caso

## Para qué sirve

Es el punto de entrada al trabajo diario: llamó alguien, o te pasaron un listado, y hay que encontrar
el caso.

## Dos formas de buscar

**El buscador de arriba**, en la pantalla de Gestión, busca por **documento, nombre, apellido o ID
interno**. Es el rápido.

**Búsqueda avanzada**, con el botón del encabezado, abre el formulario completo.

> Gestión **no abre vacía**: te muestra el último caso que trabajaste, o el primero de la base si es tu
> primera vez. No es que el sistema eligió ese caso.

## Los campos de la búsqueda avanzada

Se combinan con **Y**: el caso tiene que cumplir todos los que completes.

| Campo | Cuándo usarlo |
|---|---|
| **Documento** | Lo más directo cuando el deudor te da el DNI |
| **Nº Cliente** | El identificador del cedente. Es el que trae el archivo |
| **Nombre** / **Apellido** | Cuando no hay ningún número |
| **Empresa** | Un desplegable. Matchea **exacto**, a propósito: buscando "FIAT" con coincidencia parcial aparecía también "FIAT PLAN" |
| **Nº Remesa** | Para acotar a una asignación |
| **Teléfono** / **Email** | Cuando entra una llamada y no sabés de quién es |
| **ID Deudor** | El número interno del sistema |

**Buscar por teléfono es el más subestimado.** Cuando entra una llamada, es la forma de saber quién es
antes de atender.

> ### ⚠ Cómo escribir el teléfono
>
> Los números se guardan en formato internacional, sin espacios ni guiones, y **sin el 15**. La
> búsqueda compara contra eso tal cual lo escribas.
>
> - `1155551234` → **encuentra**
> - `11 5555-1234` o `11-5555-1234` → **no encuentra**
> - `1565551234` (con el 15) → **no encuentra**
>
> Escribilo pegado y sin el 15.

> **La búsqueda devuelve como máximo 50 resultados**, y no avisa cuando corta. Si buscás por un
> apellido común, acotá con la empresa.

---

## Cuando aparecen varios resultados de la misma persona

Es lo normal, no un error: **cada asignación del cedente es un caso distinto**. Una persona con tres
cuentas de agua tiene tres casos.

Para elegir el correcto, mirá **la empresa** y **el número de cliente**: son las dos columnas que trae
el resultado. La remesa no aparece ahí — se ve ya adentro de la ficha.

Una vez adentro, la solapa **Otras Cuentas** te muestra los demás casos de esa persona.

> **Las filas de Otras Cuentas no son clickeables**: para pasar a otro caso hay que volver a buscarlo.

> **Otras Cuentas agrupa por documento exacto.** Los casos **sin DNI** no se agrupan entre sí, porque
> cada uno tiene un identificador distinto.

> Si el deudor quiere pagar todo lo que debe, hay que trabajar **caso por caso**: no hay una vista que
> los cobre juntos.

---

## Cuando no aparece nada

Por orden de probabilidad:

**El documento está escrito distinto.** Con puntos, con guiones, con el CUIT en vez del DNI. La
búsqueda es parcial, así que **probá con menos dígitos** — solo el número sin el prefijo, por ejemplo.

**La cartera se cargó sin documento.** Algunos cedentes no mandan DNI confiable, y entonces la
identidad del caso es el número de cliente. Esos casos aparecen con el documento en un formato tipo
`SIN-DNI-...` seguido del número de cliente.

**Truco:** como el campo Documento busca por coincidencia parcial, **pegar ahí el número de cliente
también los encuentra**.

**Estás filtrando por la empresa equivocada.**

**El caso no está cargado.** Si el cedente lo asignó hace poco, puede que la remesa todavía no se haya
importado.

---

## Qué puede salir mal

### Busco por DNI y no aparece, pero sé que está

Esa cartera probablemente se cargó identificando por número de cliente, no por documento. Es habitual
en cedentes cuyo DNI viene con basura.

### Aparece el caso pero con otro nombre

Los cedentes mandan el nombre como lo tienen ellos, que no siempre está prolijo. El documento y el
número de cliente son más confiables que el nombre.

### Encuentro el caso pero la deuda no coincide con lo que dice el deudor

Tres posibilidades: está mirando **otra de sus cuentas** (mirá Otras Cuentas), la deuda tiene
**recargos** que él no cuenta, o hubo pagos que el cedente todavía no informó.

### No veo ningún caso de una cartera que sé que existe

No es un tema de permisos por cartera: el permiso de ver deudores da acceso a **toda** la base, o a
nada. Así que es una de dos: la cartera **todavía no se importó**, o quedó el combo de Empresa de la
búsqueda avanzada en otra.

---

## Preguntas frecuentes

**¿Puedo buscar por parte del nombre?**
Sí, no hace falta el nombre completo.

**¿Puedo exportar el resultado de una búsqueda?**
No, desde esta pantalla no se exporta. Para sacar un listado hay que armar un
[reporte](/ayuda/reportes/como-funciona).

**¿Por qué el mismo DNI aparece en varias empresas?**
Porque debe en varias carteras. Cada una es un caso independiente.

**¿Cómo sé cuál es el caso "actual" de una persona?**
No hay uno: todos los que estén asignados están vigentes. Los que el cedente retiró suelen estar en
estado desasignado.
