import { Prisma } from '@prisma/client';
import { finDelDia, inicioDelDia } from '../../../common/utils/dia-local';

/**
 * Qué es cada columna `DateTime` del modelo, para saber cómo se compara contra un día.
 *
 * Conviven **dos** formas de guardar una fecha:
 *
 * - **Fecha calendario**: un día sin hora (vencimiento, emisión, fecha de pago, fecha prometida). Los
 *   imports y los services la escriben a las 00:00Z del día **o** a las 03:00Z (medianoche argentina),
 *   según quién la cargó. En prod, medido: `deudor.fechaVencimiento` 25.242 a las 00:00Z y 269 a las
 *   03:00Z; `factura.vencimiento` 56.423 a las 00:00Z, 156.777 a las 03:00Z y 56 a las 02:00Z.
 *   Para esas el día D es de **D 00:00:00.000Z a D 23:59:59.999Z**, que toma las dos convenciones.
 * - **Instante**: un timestamp real (`createdAt`, `comentario.fecha`). El día D es el día **local**
 *   (hora del servidor, Argentina): de D 00:00 a D 23:59:59.999 locales.
 *
 * Con la ventana local, un filtro "vence el 15/03" perdía todo lo guardado a las 00:00Z (el 99 % de
 * `deudor.fechaVencimiento`): caía en el día anterior.
 *
 * **Toda columna `DateTime` del schema tiene que estar en una de las dos listas**: hay un test que
 * falla si aparece una sin clasificar, así nadie queda con el criterio equivocado por omisión.
 */
export const FECHAS_CALENDARIO: Record<string, string[]> = {
  deudor: ['fechaVencimiento'],
  factura: ['fechaEmision', 'vencimiento'],
  pago: ['fecha'],
  promesa_pago: ['fechaPromesa'],
  remesa: ['fechaVencimiento'],
  cuota_convenio: ['fechaVencimiento', 'fechaPago'],
  // El alta del convenio la toma de un <input type="date"> y la guarda con new Date('YYYY-MM-DD'): 00:00Z.
  convenio: ['fechaInicio'],
  clave_pago: ['fechaVencimiento'],
  // @db.Date: la base solo guarda el día.
  indice_mora: ['fecha'],
};

export const FECHAS_INSTANTE: Record<string, string[]> = {
  comentario: ['fecha'],
  deudor: ['situacionConsolidadaEn', 'moraCalculadaEn', 'createdAt', 'updatedAt'],
  empresa: ['createdAt', 'updatedAt'],
  importerror: ['createdAt'],
  jobimport: ['createdAt', 'finishedAt'],
  import_progreso: ['cancelSolicitadaAt', 'encoladaAt', 'startedAt', 'heartbeatAt', 'finishedAt'],
  pago: ['confirmadoEn'],
  promesa_pago: ['createdAt', 'cerradaEn'],
  plantillaimport: ['createdAt', 'updatedAt'],
  remesa: ['createdAt', 'updatedAt', 'accionRevertidaEn'],
  transaccion: ['createdAt'],
  rol: ['creadoAt'],
  usuario: ['createdAt', 'updatedAt'],
  accion_masiva_snapshot: ['createdAt', 'revertidoEn'],
  reversion_accion: ['encoladaAt', 'startedAt', 'heartbeatAt', 'finishedAt'],
  politica: ['createdAt', 'updatedAt'],
  convenio: ['createdAt', 'updatedAt'],
  clave_pago: ['reemplazadaEn', 'createdAt'],
  plantilla_reporte: ['createdAt', 'updatedAt'],
  ejecucion_reporte: ['createdAt', 'iniciadoEn', 'finishedAt'],
  Notificacion: ['leidaEn', 'creadoEn', 'actualizadoEn'],
  envio_email: ['creadoAt'],
  email_template_variable_mapeo: ['creadoAt', 'actualizadoAt'],
  agente_telefonia: ['createdAt', 'updatedAt'],
  sesion_agente_neotel: ['loginAt', 'logoutAt'],
  "campaña_neotel": ['createdAt', 'updatedAt'],
  "campaña_sesion_neotel": ['enteredAt', 'leftAt'],
  motivo_pausa_neotel: ['createdAt', 'updatedAt'],
  estado_agente_evento: ['startedAt', 'endedAt'],
  llamada_neotel: ['ringedAt', 'answeredAt', 'endedAt', 'createdAt', 'updatedAt'],
  callback_neotel: ['fechaAgenda'],
  neotel_evento_log: ['procesadoAt'],
  tasa_mora: ['createdAt', 'updatedAt'],
  indice_mora: ['createdAt'],
  asistente_config: ['updatedAt'],
  asistente_funcion: ['updatedAt'],
  asistente_conversacion: ['createdAt', 'updatedAt'],
  asistente_mensaje: ['createdAt'],
  asistente_llamada: ['createdAt'],
  asistente_adjunto: ['createdAt', 'updatedAt'],
  asistente_propuesta: ['createdAt', 'updatedAt'],
};

export type TipoFecha = 'calendario' | 'instante';

/** Cómo se guarda `modelo.campo`, o `undefined` si no está clasificado (o no es una fecha del schema). */
export function clasificarFecha(modelo: string, campo: string): TipoFecha | undefined {
  if (FECHAS_CALENDARIO[modelo]?.includes(campo)) return 'calendario';
  if (FECHAS_INSTANTE[modelo]?.includes(campo)) return 'instante';
  return undefined;
}

/** Todas las columnas `DateTime` del schema que no están en ninguna de las dos listas. */
export function fechasSinClasificar(): string[] {
  const faltan: string[] = [];
  for (const modelo of Prisma.dmmf.datamodel.models) {
    for (const campo of modelo.fields) {
      if (campo.type === 'DateTime' && !clasificarFecha(modelo.name, campo.name)) {
        faltan.push(`${modelo.name}.${campo.name}`);
      }
    }
  }
  return faltan;
}

/**
 * El día `ymd` (`YYYY-MM-DD`) como ventana `[desde, hasta]` según cómo se guarda la fecha.
 * Una columna sin clasificar se trata como instante, que es lo que ya hacía el motor.
 */
export function ventanaDelDia(ymd: string, tipo: TipoFecha = 'instante'): { desde: Date; hasta: Date } {
  const dia = ymd.trim();
  if (tipo === 'calendario') {
    return { desde: new Date(`${dia}T00:00:00.000Z`), hasta: new Date(`${dia}T23:59:59.999Z`) };
  }
  return { desde: inicioDelDia(dia), hasta: finDelDia(dia) };
}
