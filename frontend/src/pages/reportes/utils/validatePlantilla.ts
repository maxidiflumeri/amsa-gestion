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
      .filter((c: Columna) => c.tipo === 'numero' || c.tipo === 'moneda')
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

  return errors
}
