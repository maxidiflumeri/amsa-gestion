import { Plantilla, Columna, Filtro, Agrupacion, Total } from '../../../types/reportes'

export type ValidationError = {
  type: 'error' | 'warning'
  message: string
}

export const validatePlantilla = (plantilla: Partial<Plantilla>): ValidationError[] => {
  const errors: ValidationError[] = []

  if (!plantilla.nombre || !plantilla.nombre.trim()) {
    errors.push({ type: 'error', message: 'El nombre de la plantilla es requerido' })
  }

  if (!plantilla.definicion || plantilla.definicion.columnas.length === 0) {
    errors.push({ type: 'error', message: 'Debe agregar al menos una columna' })
  }

  if (plantilla.definicion?.columnas) {
    const labels = plantilla.definicion.columnas.map((c: Columna) => c.label)
    const duplicates = labels.filter((label: string, index: number) => labels.indexOf(label) !== index)

    // Las filas del reporte se arman por nombre de columna: con dos iguales, la primera pierde su dato y
    // repite el de la segunda. El backend también lo rechaza; acá se frena antes de guardar.
    if (duplicates.length > 0) {
      const unicos = [...new Set(duplicates)] as string[]
      const nombres = unicos.map(d => `«${d}»`).join(', ')
      errors.push({
        type: 'error',
        message:
          unicos.length === 1
            ? `Hay dos columnas con el nombre ${nombres}`
            : `Hay columnas con el mismo nombre: ${nombres}`,
      })
    }
  }

  if (plantilla.definicion?.filtros) {
    plantilla.definicion.filtros.forEach((filtro: Filtro, index: number) => {
      if (!filtro.path) {
        errors.push({ type: 'error', message: `Filtro #${index + 1}: falta el path` })
      }

      if (!filtro.operador) {
        errors.push({ type: 'error', message: `Filtro #${index + 1}: falta el operador` })
      }

      const requiresValue = filtro.operador !== 'isNull' && filtro.operador !== 'isNotNull'

      if (!filtro.variable && requiresValue) {
        const vacio = (v: any) => v === undefined || v === null || v === ''
        // Entre / Fuera de con las dos puntas vacías también es "sin valor"; con una sola es un rango abierto.
        if (vacio(filtro.valor) || (Array.isArray(filtro.valor) && filtro.valor.every(vacio))) {
          errors.push({
            type: 'error',
            message: `Filtro #${index + 1} (${filtro.path}): falta el valor`,
          })
        }
      }

      if (filtro.variable && !filtro.labelVariable) {
        errors.push({
          type: 'error',
          message: `Filtro #${index + 1} (${filtro.path}): falta el label para la variable`,
        })
      }
    })
  }

  if (plantilla.definicion?.agrupaciones) {
    const columnPaths = plantilla.definicion.columnas.map((c: Columna) => c.path)

    plantilla.definicion.agrupaciones.forEach((agrupacion: Agrupacion, index: number) => {
      if (!agrupacion.path) {
        errors.push({ type: 'error', message: `Agrupación #${index + 1}: falta el path` })
      } else if (!columnPaths.includes(agrupacion.path)) {
        errors.push({
          type: 'warning',
          message: `Agrupación #${index + 1} (${agrupacion.path}): el path no existe en las columnas`,
        })
      }
    })
  }

  if (plantilla.definicion?.totales) {
    const columnPaths = plantilla.definicion.columnas.map((c: Columna) => c.path)
    const columnasNumericas = plantilla.definicion.columnas
      .filter((c: Columna) => c.tipo === 'numero' || c.tipo === 'moneda' || c.tipo === 'dias')
      .map((c: Columna) => c.path)

    plantilla.definicion.totales.forEach((total: Total, index: number) => {
      if (!total.path) {
        errors.push({ type: 'error', message: `Total #${index + 1}: falta el path` })
      } else if (!columnPaths.includes(total.path)) {
        errors.push({
          type: 'warning',
          message: `Total #${index + 1} (${total.path}): el path no existe en las columnas`,
        })
      } else if (
        total.funcion !== 'count' &&
        !columnasNumericas.includes(total.path) &&
        !total.path.includes('[sum]') &&
        !total.path.includes('[avg]')
      ) {
        errors.push({
          type: 'warning',
          message: `Total #${index + 1} (${total.path}): se aplicará ${total.funcion} sobre una columna no numérica`,
        })
      }
    })
  }

  // TXT de ancho fijo: los anchos, la alineación y el relleno van uno por columna. El backend también lo rechaza (400).
  const txt = plantilla.formatoSalida === 'txt' ? plantilla.opcionesFormato?.txt : undefined
  if (txt?.anchoFijo && plantilla.definicion?.columnas) {
    const columnas = plantilla.definicion.columnas
    const n = columnas.length
    if (txt.anchoFijo.length !== n) {
      errors.push({
        type: 'error',
        message: `El ancho fijo tiene ${txt.anchoFijo.length} ${txt.anchoFijo.length === 1 ? 'ancho' : 'anchos'} y hay ${n} ${n === 1 ? 'columna' : 'columnas'}. Quitá el ancho fijo (en «Opciones que no se editan acá») o pedile otra plantilla a amaIA`,
      })
    }
    for (const [campo, valores] of [['alineación', txt.alineacion], ['relleno', txt.relleno]] as const) {
      if (valores && valores.length !== txt.anchoFijo.length) {
        errors.push({ type: 'error', message: `La ${campo} del ancho fijo tiene ${valores.length} valores y los anchos son ${txt.anchoFijo.length}` })
      }
    }
    txt.relleno?.forEach((r, i) => {
      if (r === '0' && txt.alineacion?.[i] !== 'derecha') {
        errors.push({
          type: 'error',
          message: `En «${columnas[i]?.label ?? `la columna ${i + 1}`}» el relleno con ceros solo se puede usar con alineación a la derecha`,
        })
      }
    })
  }

  return errors
}
