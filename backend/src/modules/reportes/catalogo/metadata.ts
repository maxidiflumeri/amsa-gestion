export const LABELS_CUSTOM: Record<string, string> = {
  // Deudor
  'id': 'ID Deudor',
  'documento': 'DNI / Documento',
  'nombre': 'Nombre',
  'apellido': 'Apellido',
  'montoTotal': 'Monto Total',
  'fechaVencimiento': 'Fecha de Vencimiento',
  'camposAdicionales': 'Campos Adicionales',

  // Relaciones top-level (label de la rama)
  'empresa': 'Empresa',
  'remesa': 'Remesa',
  'estadoSituacion': 'Estado Situación',
  'estadoGestion': 'Estado Gestión',
  'motivoNoPago': 'Motivo No Pago',
  'contactos': 'Contactos',
  'pagos': 'Pagos',
  'facturas': 'Facturas',
  'comentarios': 'Comentarios',
  'convenios': 'Convenios',
  'convenios.cuotas': 'Cuotas de Convenio',

  // Empresa (campos)
  'empresa.nombre': 'Nombre Empresa',
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

  // Transacción (auditoría) — raíz
  'createdAt': 'Fecha',
  'modulo': 'Módulo',
  'entidad': 'Entidad',
  'tipo': 'Tipo de Acción',
  'severidad': 'Severidad',
  'estado': 'Estado',
  'resumen': 'Resumen',
  'recursoTexto': 'Recurso',
  'ip': 'IP',
  'userAgent': 'User-Agent',
  'usuario': 'Usuario',
  'usuario.nombre': 'Nombre Usuario',
  'usuario.email': 'Email Usuario',
  'deudor': 'Deudor',
  'deudor.documento': 'Documento Deudor',
  'deudor.nombre': 'Nombre Deudor',
  'deudor.apellido': 'Apellido Deudor',
};

/**
 * Modelos administrativos / técnicos que no deberían aparecer en el catálogo.
 * Se aplica al field.type (nombre del modelo destino de una relación).
 */
export const MODELOS_OCULTOS = new Set<string>([
  'empresa_parametro',
  'plantillaimport',
  'plantilla_reporte',
  'ejecucion_reporte',
  'jobimport',
  'importerror',
  'politica',
  'formato_telefono',
  'campoextra',
]);

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
  'String': ['eq', 'neq', 'contains', 'startsWith', 'endsWith', 'in', 'notIn', 'between', 'notBetween', 'isNull', 'isNotNull'],
  'Int': ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'notBetween', 'in', 'notIn', 'isNull', 'isNotNull'],
  'Float': ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'notBetween', 'in', 'notIn', 'isNull', 'isNotNull'],
  'DateTime': ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'notBetween', 'isNull', 'isNotNull'],
  'Boolean': ['eq', 'isNull', 'isNotNull'],
};
