export const LABELS_CUSTOM: Record<string, string> = {
  // Deudor
  'documento': 'DNI / Documento',
  'nombre': 'Nombre',
  'apellido': 'Apellido',
  'montoTotal': 'Monto Total',
  'fechaVencimiento': 'Fecha de Vencimiento',
  'camposAdicionales': 'Campos Adicionales',

  // Empresa
  'empresa.nombre': 'Empresa',
  'empresa.cuit': 'CUIT Empresa',

  // Remesa
  'remesa.nombre': 'Remesa',
  'remesa.numeroRemesa': 'Número de Remesa',
  'remesa.categoria': 'Categoría Remesa',

  // Estados (parametros)
  'estadoSituacion.descripcion': 'Estado Situación',
  'estadoGestion.descripcion': 'Estado Gestión',
  'motivoNoPago.descripcion': 'Motivo No Pago',

  // Contactos
  'contactos.tipo': 'Tipo de Contacto',
  'contactos.valor': 'Valor de Contacto',
  'contactos.prioridad': 'Prioridad',
  'contactos.validado': 'Validado',
  'contactos.whatsapp': 'WhatsApp',

  // Pagos
  'pagos.fecha': 'Fecha de Pago',
  'pagos.importe': 'Importe de Pago',
  'pagos.origenArchivo': 'Origen del Pago',
  'pagos.observacion': 'Observación del Pago',

  // Facturas
  'facturas.nroFactura': 'Número de Factura',
  'facturas.importe': 'Importe Factura',
  'facturas.fechaEmision': 'Fecha de Emisión',
  'facturas.vencimiento': 'Vencimiento Factura',
  'facturas.estado': 'Estado Factura',

  // Comentarios
  'comentarios.fecha': 'Fecha Comentario',
  'comentarios.texto': 'Texto del Comentario',
  'comentarios.origen': 'Origen del Comentario',

  // Convenios
  'convenios.tipo': 'Tipo de Convenio',
  'convenios.estado': 'Estado Convenio',
  'convenios.montoTotal': 'Monto Total Convenio',
  'convenios.cantCuotas': 'Cantidad de Cuotas',
  'convenios.montoCuota': 'Monto por Cuota',
  'convenios.fechaInicio': 'Fecha Inicio Convenio',
  'convenios.observaciones': 'Observaciones Convenio',

  // Cuotas de convenio
  'convenios.cuotas.nroCuota': 'Número de Cuota',
  'convenios.cuotas.fechaVencimiento': 'Vencimiento Cuota',
  'convenios.cuotas.importe': 'Importe Cuota',
  'convenios.cuotas.estado': 'Estado Cuota',
  'convenios.cuotas.fechaPago': 'Fecha Pago Cuota',
};

export const CAMPOS_OCULTOS = new Set<string>([
  'id',
  'createdAt',
  'updatedAt',
  'empresaId',
  'remesaId',
  'deudorId',
  'usuarioId',
  'estadoSituacionId',
  'estadoGestionId',
  'motivoNoPagoId',
  'creadoPorId',
  'plantillaId',
  'convenioId',
  'padreId',
  'googleId',
  'avatarUrl',
  'configuracion',
  'archivoHash',
]);

export const AGREGADORES_POR_TIPO: Record<string, string[]> = {
  'Int': ['sum', 'avg', 'count', 'min', 'max', 'first', 'last'],
  'Float': ['sum', 'avg', 'count', 'min', 'max', 'first', 'last'],
  'String': ['count', 'first', 'last', 'concat'],
  'DateTime': ['count', 'min', 'max', 'first', 'last'],
  'Boolean': ['count', 'first', 'last'],
};

export const OPERADORES_POR_TIPO: Record<string, string[]> = {
  'String': ['eq', 'neq', 'contains', 'startsWith', 'endsWith', 'in', 'notIn', 'isNull', 'isNotNull'],
  'Int': ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'notIn', 'isNull', 'isNotNull'],
  'Float': ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'notIn', 'isNull', 'isNotNull'],
  'DateTime': ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'isNull', 'isNotNull'],
  'Boolean': ['eq', 'isNull', 'isNotNull'],
};
