// utils/identidad-deudor.ts
//
// Qué identifica a un deudor DENTRO de una remesa, y el alta/actualización que se apoya en eso.
//
// Hasta acá la respuesta estaba clavada en la base: la clave única `(empresaId, documento,
// remesaId)` decía que un DNI es un caso. Para la mayoría de las carteras es cierto, pero no para
// las de telefonía: en Telecom y Telecom Personal un mismo DNI tiene varias cuentas —la madre
// termina en `0001` y las hijas en `0002`, `0003`— y cada una es un caso con su deuda, sus
// facturas y sus pagos.
//
// Con la clave única puesta, la segunda y la tercera fila de un mismo DNI no creaban nada: hacían
// `update` sobre el primer caso, así que ganaba la última del archivo. Medido sobre el CA del
// 27/05, cargado como va —una remesa por nómina—: de 19.439 cuentas se perdían 119, con TODAS sus
// facturas y pagos después fallando con "Deudor no encontrado". El archivo de cobros de Personal
// viene justamente por cuenta: su `CUST_CODE` termina en 0001, 0002, 0003.
//
// (Las filas sin DNI no entran en esa cuenta: reciben un placeholder `SIN-DNI-<nroCliente>` que ya
// es único por cuenta, así que nunca colisionaron. Ver `documento.ts`.)
//
// La decisión pasa a la plantilla (`mappingJson.identidadDeudor`) porque depende del cedente, no
// del sistema. El default es `DOCUMENTO`: ninguna plantilla ya guardada cambia de comportamiento.

import { Prisma } from '@prisma/client';
import { IdentidadDeudor } from '../mapping-types';
import { ProcessContext } from '../processors/processor.interface';

export type { IdentidadDeudor };

/** Lee la identidad de la plantilla con el default seguro. */
export function resolverIdentidad(valor: unknown): IdentidadDeudor {
    return valor === 'NRO_CLIENTE' ? 'NRO_CLIENTE' : 'DOCUMENTO';
}

/** Datos de la fila ya normalizados, listos para escribir. */
export interface DatosDeudor {
    documento: string;
    nroCliente: string | null;
    nombre: string;
    apellido: string;
    montoTotal?: number;
    fechaVencimiento?: Date;
    camposAdicionales?: any;
}

export interface ResultadoUpsert {
    id: number;
    /** `true` si el caso se creó en esta corrida (no existía en la remesa). */
    creado: boolean;
}

/**
 * Clave con la que se busca el caso dentro de la remesa.
 *
 * Con identidad `NRO_CLIENTE` pero una fila **sin** número de cliente se cae al documento: es
 * preferible agrupar por DNI a crear un caso nuevo por cada fila sin identificar.
 */
export function claveIdentidad(
    identidad: IdentidadDeudor,
    datos: Pick<DatosDeudor, 'documento' | 'nroCliente'>,
): { campo: 'documento' | 'nroCliente'; valor: string } {
    if (identidad === 'NRO_CLIENTE' && datos.nroCliente) {
        return { campo: 'nroCliente', valor: datos.nroCliente };
    }
    return { campo: 'documento', valor: datos.documento };
}

/**
 * Alta o actualización del caso dentro de la remesa, según la identidad de la plantilla.
 *
 * Es un `SELECT` y después `create`/`update` en vez de un `upsert`, porque el `upsert` de Prisma
 * necesita una clave **única** de la base y acá la clave depende de la plantilla. El import corre
 * una fila por vez dentro de un único worker, así que no hay carrera que resolver — es el mismo
 * enfoque que usan MULTIRREGISTRO y MULTIARCHIVO (`casos-cedente.processor`) desde siempre.
 */
export async function upsertDeudorPorIdentidad(
    ctx: ProcessContext,
    datos: DatosDeudor,
): Promise<ResultadoUpsert> {
    const identidad = ctx.identidadDeudor ?? 'DOCUMENTO';
    const clave = claveIdentidad(identidad, datos);

    const base = { empresaId: ctx.empresaId, remesaId: ctx.remesaId };
    const existente = await ctx.prisma.deudor.findFirst({
        where: clave.campo === 'nroCliente'
            ? { ...base, nroCliente: clave.valor }
            : { ...base, documento: clave.valor },
        select: { id: true },
        orderBy: { id: 'asc' },
    });

    if (existente) {
        await ctx.prisma.deudor.update({
            where: { id: existente.id },
            data: {
                // Con identidad por nro de cliente, el documento SÍ se actualiza: es un dato del
                // caso, no su clave, y puede llegar completo en una bajada posterior.
                documento: datos.documento || undefined,
                nroCliente: datos.nroCliente || undefined,
                nombre: datos.nombre || undefined,
                apellido: datos.apellido || undefined,
                montoTotal: datos.montoTotal ?? undefined,
                fechaVencimiento: datos.fechaVencimiento ?? undefined,
                camposAdicionales: datos.camposAdicionales ?? undefined,
            },
        });
        return { id: existente.id, creado: false };
    }

    const creado = await ctx.prisma.deudor.create({
        data: {
            empresaId: ctx.empresaId,
            remesaId: ctx.remesaId,
            documento: datos.documento,
            nroCliente: datos.nroCliente,
            nombre: datos.nombre,
            apellido: datos.apellido,
            montoTotal: datos.montoTotal ?? null,
            fechaVencimiento: datos.fechaVencimiento ?? null,
            camposAdicionales: datos.camposAdicionales ?? Prisma.JsonNull,
            estadoSituacionId: ctx.defaults.estadoSituacionId,
            estadoGestionId: ctx.defaults.estadoGestionId,
        },
        select: { id: true },
    });

    return { id: creado.id, creado: true };
}

/**
 * Cuántos casos produce un conjunto de filas según la identidad elegida. Sirve para explicarle al
 * operador la diferencia entre "personas" y "cuentas" antes de cargar.
 */
export function numeroDeCasos(
    identidad: IdentidadDeudor,
    filas: Array<Pick<DatosDeudor, 'documento' | 'nroCliente'>>,
): number {
    const claves = new Set(filas.map((f) => claveIdentidad(identidad, f).valor));
    return claves.size;
}

/**
 * Tope de pares distintos que se acumulan al medir colisiones en el preview. Por encima de eso el
 * aviso se omite: no vale la pena tener medio millón de strings en memoria para un cartel.
 */
const TOPE_COLISIONES = 500_000;

/**
 * Cuenta, mientras se recorre el archivo, cuántos casos se perderían por cargar con identidad por
 * documento un archivo que trae varias cuentas por persona.
 *
 * Es el aviso que faltaba: la pérdida era **silenciosa**. El archivo entraba "sin errores" y
 * recién se notaba días después, cuando las facturas de las cuentas que no se habían creado
 * fallaban todas con "Deudor no encontrado".
 */
export class ContadorColisiones {
    private readonly documentos = new Set<string>();
    private readonly cuentas = new Set<string>();
    private desbordado = false;

    agregar(documento: string, nroCliente: string | null): void {
        if (this.desbordado || !documento) return;
        if (this.cuentas.size >= TOPE_COLISIONES) {
            this.desbordado = true;
            return;
        }
        this.documentos.add(documento);
        this.cuentas.add(nroCliente ? `${documento}|${nroCliente}` : documento);
    }

    /** Casos que se perderían: cuentas distintas menos personas distintas. */
    get colisiones(): number {
        if (this.desbordado) return 0;
        return Math.max(0, this.cuentas.size - this.documentos.size);
    }

    get personas(): number {
        return this.documentos.size;
    }

    get cuentasDistintas(): number {
        return this.cuentas.size;
    }
}
