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

## El buscador avanzado

Se busca por cualquiera de estos campos, y se pueden combinar:

| Campo | Cuándo usarlo |
|---|---|
| **Documento** | Lo más directo cuando el deudor te da el DNI |
| **Nº Cliente** | El identificador del cedente. Es el que trae el archivo |
| **Nombre** / **Apellido** | Cuando no hay ningún número |
| **Empresa** | Para acotar a una cartera |
| **Nº Remesa** | Para acotar a una asignación |
| **Teléfono** / **Email** | Cuando entra una llamada y no sabés de quién es |
| **ID Deudor** | El número interno del sistema |

**Buscar por teléfono es el más subestimado.** Cuando entra una llamada, es la forma de saber quién es
antes de atender.

---

## Cuando aparecen varios resultados de la misma persona

Es lo normal, no un error: **cada asignación del cedente es un caso distinto**. Una persona con tres
cuentas de agua tiene tres casos.

Para elegir el correcto, mirá:

- **La empresa**, si el deudor llama por una deuda concreta.
- **El número de cliente**, si te lo dio.
- **La remesa**: la más reciente suele ser la que está en gestión.

Y una vez adentro de una ficha, la solapa **Otras Cuentas** te muestra las demás.

> Si el deudor quiere pagar todo lo que debe, hay que trabajar **caso por caso**: no hay una vista que
> los cobre juntos.

---

## Cuando no aparece nada

Por orden de probabilidad:

**El documento está escrito distinto.** Con puntos, con guiones, con el CUIT en vez del DNI. Probá con
menos dígitos, o buscá por apellido.

**La cartera se cargó sin documento.** Algunos cedentes no mandan DNI confiable, y entonces la
identidad del caso es el número de cliente. Buscá por ahí.

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

Puede ser permisos, o que esa cartera esté en otra empresa de las que aparecen en el selector.

---

## Preguntas frecuentes

**¿Puedo buscar por parte del nombre?**
Sí, no hace falta el nombre completo.

**¿Puedo exportar el resultado de una búsqueda?**
Con el permiso de exportar. Para algo más elaborado, conviene un [reporte](/ayuda/reportes/como-funciona).

**¿Por qué el mismo DNI aparece en varias empresas?**
Porque debe en varias carteras. Cada una es un caso independiente.

**¿Cómo sé cuál es el caso "actual" de una persona?**
No hay uno: todos los que estén asignados están vigentes. Los que el cedente retiró suelen estar en
estado desasignado.
