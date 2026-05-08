import { PlantillaV2, ColumnaV2, FiltroV2 } from '../../../../types/reportes-v2'

export type ValidationError = {
  type: 'error' | 'warning'
  message: string
}

export const validatePlantilla = (plantilla: Partial<PlantillaV2>): ValidationError[] => {
  const errors: ValidationError[] = []

  if (!plantilla.nombre || !plantilla.nombre.trim()) {
    errors.push({ type: 'error', message: 'El nombre de la plantilla es requerido' })
  }

  if (!plantilla.definicion || plantilla.definicion.columnas.length === 0) {
    errors.push({ type: 'error', message: 'Debe agregar al menos una columna' })
  }

  if (plantilla.definicion?.columnas) {
    const labels = plantilla.definicion.columnas.map((c: ColumnaV2) => c.label)
    const duplicates = labels.filter((label: string, index: number) => labels.indexOf(label) !== index)

    if (duplicates.length > 0) {
      errors.push({
        type: 'warning',
        message: `Hay columnas con labels duplicados: ${[...new Set(duplicates)].join(', ')}`,
      })
    }
  }

  if (plantilla.definicion?.filtros) {
    plantilla.definicion.filtros.forEach((filtro: FiltroV2, index: number) => {
      if (!filtro.path) {
        errors.push({ type: 'error', message: `Filtro #${index + 1}: falta el path` })
      }

      if (!filtro.operador) {
        errors.push({ type: 'error', message: `Filtro #${index + 1}: falta el operador` })
      }

      const requiresValue = filtro.operador !== 'isNull' && filtro.operador !== 'isNotNull'

      if (!filtro.variable && requiresValue) {
        if (filtro.valor === undefined || filtro.valor === '' || (Array.isArray(filtro.valor) && filtro.valor.length === 0)) {
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

  return errors
}
