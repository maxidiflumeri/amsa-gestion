export const LABELS_CUSTOM: Record<string, string> = {
  // ── Deudor (raíz) ──
  'id': 'ID interno del caso',
  'documento': 'DNI / Documento',
  'nroCliente': 'Nro de cliente del cedente',
  'nombre': 'Nombre',
  'apellido': 'Apellido',
  'montoTotal': 'Deuda original',
  'saldo': 'Saldo actual',
  'fechaVencimiento': 'Fecha de vencimiento',
  'situacionConsolidadaEn': 'Última consolidación',
  'camposAdicionales': 'Datos adicionales del cedente',

  // ── Empresa ──
  'empresa': 'Empresa (cedente)',
  'empresa.nombre': 'Nombre de la empresa',
  'empresa.cuit': 'CUIT de la empresa',

  // ── Remesa ──
  'remesa': 'Remesa',
  'remesa.nombre': 'Nombre de la remesa',
  'remesa.numeroRemesa': 'Número de remesa',
  'remesa.categoria': 'Categoría de la remesa',
  'remesa.fechaVencimiento': 'Vencimiento de la remesa',
  'remesa.usuarioCreador': 'Cargada por',
  'remesa.politicaId': 'ID de la política',
  'remesa.politica': 'Política de gestión',
  'remesa.politica.nombre': 'Nombre de la política',
  'remesa.politica.descripcion': 'Descripción de la política',

  // ── Estados (todos apuntan a la tabla de parámetros) ──
  'estadoSituacion': 'Situación',
  'estadoSituacion.clave': 'Código de situación',
  'estadoSituacion.descripcion': 'Situación',
  'estadoGestion': 'Estado de gestión',
  'estadoGestion.clave': 'Código de gestión',
  'estadoGestion.descripcion': 'Estado de gestión',
  'estadoGestionPrevio': 'Estado de gestión previo',
  'estadoGestionPrevio.clave': 'Código de gestión previo',
  'estadoGestionPrevio.descripcion': 'Estado de gestión previo',
  'motivoNoPago': 'Motivo de no pago',
  'motivoNoPago.clave': 'Código del motivo',
  'motivoNoPago.descripcion': 'Motivo de no pago',

  // ── Contactos ──
  'contactos': 'Contactos',
  'contactos.tipo': 'Tipo de contacto',
  'contactos.valor': 'Teléfono / email / dirección',
  'contactos.prioridad': 'Prioridad',
  'contactos.validado': 'Validado',
  'contactos.subtipo': 'Tipo de línea',
  'contactos.relacion': 'De quién es el dato',
  'contactos.whatsapp': 'Tiene WhatsApp',

  // ── Facturas ──
  'facturas': 'Facturas',
  'facturas.nroFactura': 'Número de factura',
  'facturas.importe': 'Importe de la factura',
  'facturas.fechaEmision': 'Fecha de emisión',
  'facturas.vencimiento': 'Vencimiento de la factura',
  'facturas.estado': 'Estado de la factura',
  'facturas.detalle': 'Detalle de la factura',

  // ── Pagos ──
  'pagos': 'Pagos',
  'pagos.fecha': 'Fecha del pago',
  'pagos.importe': 'Importe del pago',
  'pagos.origen': 'Cómo se registró',
  'pagos.origenArchivo': 'Archivo de origen',
  'pagos.observacion': 'Observación del pago',
  'pagos.confirmadoImport': 'Confirmado por el cedente',
  'pagos.confirmadoEn': 'Fecha de confirmación',
  'pagos.usuario': 'Registrado por',

  // ── Promesas de pago ──
  'promesas': 'Promesas de pago',
  'promesas.fechaPromesa': 'Fecha prometida',
  'promesas.monto': 'Monto prometido',
  'promesas.estado': 'Estado de la promesa',
  'promesas.cambioSit020': 'Cambió la situación',
  'promesas.pagosAlCrear': 'Pagado al momento de prometer',
  'promesas.observacion': 'Observación de la promesa',
  'promesas.cerradaEn': 'Fecha de cierre',
  'promesas.usuario': 'Tomada por',
  'promesas.situacionAnterior': 'Situación antes de la promesa',

  // ── Convenios ──
  'convenios': 'Convenios',
  'convenios.tipo': 'Tipo de convenio',
  'convenios.estado': 'Estado del convenio',
  'convenios.montoTotal': 'Monto del convenio',
  'convenios.cantCuotas': 'Cantidad de cuotas',
  'convenios.montoCuota': 'Monto por cuota',
  'convenios.fechaInicio': 'Fecha de inicio',
  'convenios.observaciones': 'Observaciones del convenio',
  'convenios.usuario': 'Armado por',
  'convenios.cuotas': 'Cuotas del convenio',
  'convenios.cuotas.nroCuota': 'Número de cuota',
  'convenios.cuotas.fechaVencimiento': 'Vencimiento de la cuota',
  'convenios.cuotas.importe': 'Importe de la cuota',
  'convenios.cuotas.estado': 'Estado de la cuota',
  'convenios.cuotas.fechaPago': 'Fecha de pago de la cuota',

  // ── Comentarios ──
  'comentarios': 'Comentarios',
  'comentarios.fecha': 'Fecha del comentario',
  'comentarios.texto': 'Texto del comentario',
  'comentarios.origen': 'Origen del comentario',
  'comentarios.usuario': 'Escrito por',

  // ── Llamadas ──
  'llamadas': 'Llamadas',
  'llamadas.direccion': 'Entrante o saliente',
  'llamadas.telefono': 'Teléfono marcado',
  'llamadas.estado': 'Estado de la llamada',
  'llamadas.ringedAt': 'Empezó a sonar',
  'llamadas.answeredAt': 'Atendieron',
  'llamadas.endedAt': 'Terminó',
  'llamadas.duracionSeg': 'Duración en segundos',
  'llamadas.causaFin': 'Por qué cortó',
  'llamadas.notas': 'Notas del agente',
  'llamadas.campaña': 'Campaña',
  'llamadas.campaña.idNeotel': 'ID de campaña en Neotel',
  'llamadas.campaña.nombre': 'Nombre de la campaña',
  'llamadas.campaña.descripcion': 'Descripción de la campaña',
  'llamadas.campaña.activa': 'Campaña activa',
  'llamadas.campaña.predictiva': 'Campaña predictiva',
  'llamadas.subcategoria': 'Tipificación',
  'llamadas.subcategoria.clave': 'Código de tipificación',
  'llamadas.subcategoria.descripcion': 'Tipificación',
  'llamadas.callbackAgendado': 'Rellamado agendado',
  'llamadas.callbackAgendado.fechaAgenda': 'Fecha del rellamado',
  'llamadas.callbackAgendado.telefono': 'Teléfono del rellamado',

  // ── Envíos de email ──
  'enviosEmail': 'Emails enviados',
  'enviosEmail.destinatarios': 'Destinatarios',
  'enviosEmail.asunto': 'Asunto',
  'enviosEmail.estado': 'Estado del envío',
  'enviosEmail.error': 'Error del envío',
  'enviosEmail.creadoAt': 'Fecha del envío',
  'enviosEmail.usuario': 'Enviado por',

  // ── Auditoría ──
  'transacciones': 'Auditoría',
  'transacciones.modulo': 'Módulo',
  'transacciones.entidad': 'Entidad',
  'transacciones.tipo': 'Tipo de acción',
  'transacciones.severidad': 'Severidad',
  'transacciones.estado': 'Resultado',
  'transacciones.resumen': 'Resumen',
  'transacciones.recursoTexto': 'Recurso afectado',
  'transacciones.ip': 'IP',
  'transacciones.userAgent': 'Navegador',
  'transacciones.usuario': 'Hecho por',

  // ── Usuario (se alcanza desde varias ramas) ──
  'usuario': 'Usuario',
  'usuario.nombre': 'Nombre',
  'usuario.email': 'Email',

  // ── Transacción como raíz del reporte ──
  'createdAt': 'Fecha',
  'modulo': 'Módulo',
  'entidad': 'Entidad',
  'tipo': 'Tipo de acción',
  'severidad': 'Severidad',
  'estado': 'Resultado',
  'resumen': 'Resumen',
  'recursoTexto': 'Recurso afectado',
  'ip': 'IP',
  'userAgent': 'Navegador',
  'deudor': 'Deudor',
  'deudor.documento': 'DNI / Documento',
  'deudor.nombre': 'Nombre',
  'deudor.apellido': 'Apellido',
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

/**
 * Descripción de una línea por campo, para el que no sabe qué es mirando el nombre. Se muestra
 * abajo del campo en el explorador. Hasta unas diez palabras: si necesita más, el problema es el
 * nombre del campo, no la descripción.
 *
 * No están todos: los que se explican solos (`nombre`, `apellido`) no la necesitan y agregarles una
 * es ruido. Están los que el gestor no puede adivinar.
 */
export const DESCRIPCIONES: Record<string, string> = {
  // Deudor
  'id': 'Identificador interno del sistema, no del cedente',
  'documento': 'Puede venir vacío o autogenerado si el cedente no lo mandó',
  'nroCliente': 'La cuenta con la que el cedente identifica el caso',
  'montoTotal': 'Lo asignado al abrir el caso; no baja con los pagos',
  'saldo': 'Deuda original menos los pagos registrados',
  'fechaVencimiento': 'Vencimiento de la deuda, no de la gestión',
  'situacionConsolidadaEn': 'Cuándo se recalculó la situación por última vez',
  'camposAdicionales': 'Lo que mandó el cedente y no entra en un campo fijo',

  // Empresa y remesa
  'empresa': 'La empresa que cedió la cartera',
  'remesa': 'La carga con la que entró el caso al sistema',
  'remesa.numeroRemesa': 'El número con el que se identifica la carga',
  'remesa.categoria': 'Qué traía el archivo: deudores, facturas, pagos',
  'remesa.fechaVencimiento': 'Hasta cuándo se gestiona esta remesa',
  'remesa.politicaId': 'El número interno, para los sistemas que lo piden así',
  'remesa.politica': 'Las condiciones con las que se gestiona la remesa',

  // Estados
  'estadoSituacion': 'En qué situación está la deuda (SIT-xxx)',
  'estadoSituacion.clave': 'El código corto, tipo SIT-050',
  'estadoGestion': 'En qué anda la gestión del caso (GES-xxx)',
  'estadoGestion.clave': 'El código corto, tipo GES-001',
  'estadoGestionPrevio': 'El estado que tenía antes de desasignarse',
  'motivoNoPago': 'Por qué el deudor dice que no paga',

  // Contactos
  'contactos': 'Teléfonos, emails y direcciones del caso',
  'contactos.tipo': 'telefono, email o direccion',
  'contactos.valor': 'El dato en sí, ya normalizado',
  'contactos.prioridad': 'Menor número, primero en la ficha',
  'contactos.validado': 'Si pasó la validación de formato al importar',
  'contactos.subtipo': 'Fijo o celular; en direcciones, servicio o facturación',
  'contactos.relacion': 'Vacío es del titular; CODEUDOR es de otra persona',
  'contactos.whatsapp': 'Si se marcó que el número tiene WhatsApp',

  // Facturas y pagos
  'facturas': 'El detalle de la deuda, factura por factura',
  'facturas.estado': 'PENDIENTE o PAGADA',
  'pagos': 'Los pagos registrados del caso',
  'pagos.origen': 'MANUAL, IMPORT_PAGOS, IMPORT_ACTUALIZACION o CONVENIO',
  'pagos.origenArchivo': 'Nombre del archivo del que salió el pago',
  'pagos.confirmadoImport': 'Si el cedente lo confirmó en un archivo posterior',
  'pagos.usuario': 'Quién lo cargó, si fue manual',

  // Promesas
  'promesas': 'Compromisos de pago tomados por el gestor',
  'promesas.estado': 'VIGENTE, CUMPLIDA, INCUMPLIDA o ANULADA',
  'promesas.cambioSit020': 'Si la promesa movió la situación a SIT-020',
  'promesas.pagosAlCrear': 'Cuánto había pagado cuando se tomó la promesa',
  'promesas.cerradaEn': 'Cuándo se resolvió, cumplida o no',
  'promesas.situacionAnterior': 'Para poder volver atrás si se incumple',

  // Convenios
  'convenios': 'Planes de pago en cuotas',
  'convenios.montoTotal': 'Total del plan, no la deuda del caso',
  'convenios.cuotas': 'Una fila por cuota del plan',
  'convenios.cuotas.estado': 'PENDIENTE, PAGADA o VENCIDA',

  // Comentarios
  'comentarios': 'Las notas que deja el gestor en la ficha',
  'comentarios.origen': 'Si lo escribió una persona o lo generó el sistema',

  // Llamadas
  'llamadas': 'Llamadas por el softphone de Neotel',
  'llamadas.direccion': 'INBOUND o OUTBOUND',
  'llamadas.estado': 'Cómo terminó: atendida, no atendida, cortada',
  'llamadas.ringedAt': 'Cuándo empezó a sonar del otro lado',
  'llamadas.answeredAt': 'Vacío si nunca atendieron',
  'llamadas.duracionSeg': 'Segundos de conversación, sin contar el ring',
  'llamadas.causaFin': 'Motivo de corte que informa la central',
  'llamadas.subcategoria': 'Cómo tipificó el agente el resultado',
  'llamadas.campaña': 'La campaña de Neotel desde la que se llamó',
  'llamadas.callbackAgendado': 'Rellamado que dejó agendado el agente',

  // Emails
  'enviosEmail': 'Emails mandados al deudor desde el sistema',
  'enviosEmail.estado': 'Si salió, falló o quedó pendiente',
  'enviosEmail.error': 'El motivo, cuando el envío falló',

  // Auditoría
  'transacciones': 'Quién tocó qué del caso y cuándo',
  'transacciones.modulo': 'Parte del sistema donde pasó',
  'transacciones.tipo': 'Alta, modificación, baja, consulta',
  'transacciones.estado': 'Si la acción salió bien o falló',
  'transacciones.recursoTexto': 'Sobre qué se hizo, en texto',
};

/**
 * Orden de las ramas de primer nivel, por cómo se arma un reporte y no por cómo está el modelo:
 * primero identificar el caso, después de quién es y cuánta plata, después cómo viene la gestión y
 * cómo contactarlo, y al final el historial. Lo que no esté acá va después, alfabético.
 */
export const ORDEN_RAMAS: string[] = [
  // Quién es
  'id',
  'documento',
  'nroCliente',
  'nombre',
  'apellido',
  // De quién es
  'empresa',
  'remesa',
  // Cuánto debe
  'montoTotal',
  'saldo',
  'fechaVencimiento',
  // Cómo viene
  'estadoSituacion',
  'estadoGestion',
  'motivoNoPago',
  'estadoGestionPrevio',
  'situacionConsolidadaEn',
  // Cómo se lo contacta
  'contactos',
  // Lo que trajo el cedente
  'camposAdicionales',
  // La plata en detalle
  'facturas',
  'pagos',
  'promesas',
  'convenios',
  // El historial
  'comentarios',
  'llamadas',
  'enviosEmail',
  'transacciones',
];

/**
 * Modelos de los que **solo** interesan estos campos.
 *
 * Son tablas de catálogo o de referencia: desde un caso querés saber *qué* estado tiene o *quién*
 * cargó el comentario, no navegar toda la ficha del parámetro o del usuario. Sin esto, las cuatro
 * relaciones a `parametro` (situación, gestión, gestión previa, motivo) aportaban 8 campos
 * idénticos cada una —32 nodos que se ven todos iguales— y `usuario` repetía sus 7 campos en las
 * seis relaciones que lo alcanzan.
 *
 * Además corta las relaciones que salen de ellos: de un parámetro no se sigue a ningún lado.
 */
/**
 * Ramas que se cortan por path completo. Son duplicados de algo que ya está más arriba, o detalle
 * técnico que no le sirve a nadie armando un reporte:
 *
 * - `contactos.llamadas` y `llamadas.contacto` son el mismo par visto desde los dos lados; la rama
 *   `llamadas` de la raíz ya cubre las llamadas del caso.
 * - `remesa.empresa`, `transacciones.empresa` y `enviosEmail.empresa` son la misma empresa que ya
 *   cuelga de la raíz.
 * - `llamadas.sesion` es la sesión del agente en el softphone (device, IP, user agent): no habla
 *   del deudor.
 */
export const RELACIONES_OCULTAS = new Set<string>([
  'contactos.llamadas',
  'llamadas.contacto',
  'llamadas.sesion',
  'remesa.empresa',
  'transacciones.empresa',
  'enviosEmail.empresa',
]);

/**
 * Campos que se ocultan por **path completo**, no por nombre.
 *
 * `CAMPOS_OCULTOS` matchea el nombre en cualquier modelo, y eso no sirve para esconder el ruido de
 * una tabla puntual sin llevarse puesto el campo homónimo de otra: `estado` es ruido en la remesa y
 * es el dato principal de una factura.
 *
 * Casi todo lo de acá es plomería de importación (cuántas filas entraron, el archivo original) o de
 * la integración con Neotel (ids internos, URLs de grabación), que nadie va a poner en un reporte.
 */
export const CAMPOS_OCULTOS_POR_PATH = new Set<string>([
  // Remesa: la mecánica de la carga, no el dato de la cartera
  'remesa.archivo',
  'remesa.archivos',
  'remesa.estadoCarga',
  'remesa.estadoProceso',
  'remesa.cantidadDeudores',
  'remesa.errFilas',
  'remesa.okFilas',
  'remesa.totalFilas',
  'remesa.hoja',
  'remesa.validarDomicilios',
  'remesa.accionRevertidaEn',
  // Llamadas: internals de Neotel
  'llamadas.baseNeotel',
  'llamadas.idContactoNeotel',
  'llamadas.grabacionRequerida',
  'llamadas.grabacionEstado',
  'llamadas.recordingUrl',
  'llamadas.rawDataNeotel',
  // JSON sin claves descubiertas: en el árbol son una rama que no abre a ningún lado
  'transacciones.data',
  'enviosEmail.variables',
  'enviosEmail.archivosNombres',
  'enviosEmail.senderReporteIds',
]);

/**
 * Claves foráneas que **sí** se ofrecen, como excepción a la regla que las oculta.
 *
 * La regla general vale porque el dato está en la relación y el número interno no le dice nada a
 * nadie. Pero a veces el id **es** el dato: el sistema que consume el archivo lo pide así, con el
 * número, y no hay campo de texto que lo reemplace. Ahí se agrega el path acá.
 */
export const FKS_VISIBLES = new Set<string>([
  // La base de Neotel lleva el id de la política, no su nombre.
  'remesa.politicaId',
]);

export const CAMPOS_VISIBLES_POR_MODELO: Record<string, string[]> = {
  parametro: ['clave', 'descripcion'],
  politica: ['nombre', 'descripcion'],
  usuario: ['nombre', 'email'],
  empresa: ['nombre', 'cuit'],
};

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
