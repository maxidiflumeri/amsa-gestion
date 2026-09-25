import { PrismaService } from 'src/prisma/prisma.service';
import { elegirPorRemesaMasRecienteYId } from '../../imports/processors/pagos.processor';

/** El caso desde el que se gestionan las claves de un trámite. */
export interface CasoQueGestiona {
    deudorId: number;
    numeroRemesa: string;
    /** `true` si se eligió por tener el convenio de clave activo; `false` si por ser la remesa más nueva. */
    porConvenio: boolean;
}

/**
 * Entre los casos de un mismo trámite, el que gestiona sus claves (desde el que se saca el cupón).
 *
 * Las claves van por (empresa, trámite), no por remesa, así que si el trámite estaba en la remesa
 * de agosto y vuelve en la de septiembre, los dos casos ven las mismas claves vigentes. Sin esta
 * regla se podía sacar el cupón desde cualquiera de los dos. En orden:
 *
 *  1. el caso con un convenio ACTIVO de origen CLAVE_PAGO del trámite: ya hay un acuerdo en curso
 *     ahí, y es adonde la carga de pagos manda el pago (criterios 1 y 2 de `candidatosPorClave`).
 *     Desde ese caso se puede pasar a la otra clave con el reemplazo de siempre;
 *  2. el de la remesa más reciente entre los casos no cancelados;
 *  3. si están todos cancelados, el de la remesa más reciente (da igual: ninguno puede sacar cupón).
 *
 * "Más reciente" es el desempate de pagos (`elegirPorRemesaMasRecienteYId`: `remesa.createdAt`,
 * después `id`).
 */
export async function elegirCasoQueGestiona(
    prisma: PrismaService,
    deudorIds: number[],
    nroTramite: string,
    estaCancelado: (estadoSituacionId: number | null) => boolean,
): Promise<CasoQueGestiona | null> {
    if (deudorIds.length === 0) return null;

    const candidatos = await prisma.deudor.findMany({
        where: { id: { in: deudorIds } },
        select: { id: true, estadoSituacionId: true, remesa: { select: { createdAt: true, numeroRemesa: true } } },
    });
    if (candidatos.length === 0) return null;

    const conConvenio = await prisma.convenio.findFirst({
        where: {
            estado: 'ACTIVO',
            origen: 'CLAVE_PAGO',
            deudorId: { in: candidatos.map((c) => c.id) },
            clavePago: { nroTramite },
        },
        select: { deudorId: true },
        orderBy: { id: 'desc' },
    });

    const abiertos = candidatos.filter((c) => !estaCancelado(c.estadoSituacionId));
    const delConvenio = conConvenio ? candidatos.find((c) => c.id === conConvenio.deudorId) : undefined;
    const elegido = delConvenio ?? elegirPorRemesaMasRecienteYId(abiertos.length ? abiertos : candidatos);
    return { deudorId: elegido.id, numeroRemesa: elegido.remesa?.numeroRemesa ?? '', porConvenio: !!delConvenio };
}

/** Por qué un caso no puede sacar el cupón de su trámite, para el aviso de la ficha y el error del cupón. */
export function motivoGestionEnOtroCaso(caso: CasoQueGestiona): string {
    return caso.porConvenio
        ? `Las claves de este trámite se gestionan desde el caso de la remesa ${caso.numeroRemesa}, que tiene el cupón emitido.`
        : `Este trámite volvió en la remesa ${caso.numeroRemesa}, la más reciente con el caso abierto: las claves se gestionan desde ese caso.`;
}

/** Igual que `elegirCasoQueGestiona`, buscando antes los casos del trámite (con `TRIM`, como la ficha). */
export async function casoQueGestionaElTramite(
    prisma: PrismaService,
    empresaId: number,
    nroTramite: string,
    estaCancelado: (estadoSituacionId: number | null) => boolean,
): Promise<CasoQueGestiona | null> {
    const ids = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM deudor WHERE empresaId = ${empresaId} AND TRIM(nroCliente) = ${nroTramite}
    `;
    return elegirCasoQueGestiona(prisma, ids.map((r) => r.id), nroTramite, estaCancelado);
}
