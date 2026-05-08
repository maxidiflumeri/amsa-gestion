type OperatorConfig = {
  operador: string
  label: string
  inputType: 'text' | 'number' | 'date' | 'select-multi' | 'select-single' | 'range' | 'none'
}

export type OperatorMatrix = {
  [tipoEscalar: string]: OperatorConfig[]
}

export const operatorMatrix: OperatorMatrix = {
  texto: [
    { operador: 'eq', label: 'Igual a', inputType: 'text' },
    { operador: 'neq', label: 'Distinto de', inputType: 'text' },
    { operador: 'contains', label: 'Contiene', inputType: 'text' },
    { operador: 'startsWith', label: 'Comienza con', inputType: 'text' },
    { operador: 'endsWith', label: 'Termina con', inputType: 'text' },
    { operador: 'in', label: 'En lista', inputType: 'select-multi' },
    { operador: 'notIn', label: 'No en lista', inputType: 'select-multi' },
    { operador: 'isNull', label: 'Vacío', inputType: 'none' },
    { operador: 'isNotNull', label: 'No vacío', inputType: 'none' },
  ],
  numero: [
    { operador: 'eq', label: 'Igual a', inputType: 'number' },
    { operador: 'neq', label: 'Distinto de', inputType: 'number' },
    { operador: 'gt', label: 'Mayor que', inputType: 'number' },
    { operador: 'gte', label: 'Mayor o igual', inputType: 'number' },
    { operador: 'lt', label: 'Menor que', inputType: 'number' },
    { operador: 'lte', label: 'Menor o igual', inputType: 'number' },
    { operador: 'between', label: 'Entre', inputType: 'range' },
    { operador: 'isNull', label: 'Vacío', inputType: 'none' },
    { operador: 'isNotNull', label: 'No vacío', inputType: 'none' },
  ],
  fecha: [
    { operador: 'eq', label: 'Igual a', inputType: 'date' },
    { operador: 'gte', label: 'Desde', inputType: 'date' },
    { operador: 'lte', label: 'Hasta', inputType: 'date' },
    { operador: 'between', label: 'Entre', inputType: 'range' },
    { operador: 'isNull', label: 'Vacío', inputType: 'none' },
    { operador: 'isNotNull', label: 'No vacío', inputType: 'none' },
  ],
  boolean: [
    { operador: 'eq', label: 'Es', inputType: 'select-single' },
    { operador: 'isNull', label: 'Vacío', inputType: 'none' },
  ],
  enum: [
    { operador: 'eq', label: 'Igual a', inputType: 'select-single' },
    { operador: 'in', label: 'En lista', inputType: 'select-multi' },
    { operador: 'notIn', label: 'No en lista', inputType: 'select-multi' },
  ],
}

export const getOperatorsForType = (tipo?: string): OperatorConfig[] => {
  if (!tipo) return operatorMatrix.texto
  return operatorMatrix[tipo] || operatorMatrix.texto
}

export const getOperatorLabel = (operador: string, tipo?: string): string => {
  const operators = getOperatorsForType(tipo)
  const found = operators.find(op => op.operador === operador)
  return found?.label || operador
}

export const getInputTypeForOperator = (operador: string, tipo?: string): string => {
  const operators = getOperatorsForType(tipo)
  const found = operators.find(op => op.operador === operador)
  return found?.inputType || 'text'
}
