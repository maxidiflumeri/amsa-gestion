/**
 * Ids de los parámetros de situación de categoría CANCELADO (SIT-050 a SIT-05N, cualquiera que sea
 * N — hoy SIT-050/051/052/053, y desde la fase 4a de multiclaves también SIT-054).
 *
 * Antes de esto, cinco lugares del sistema comparaban contra la CLAVE `SIT-050` en vez de contra la
 * categoría (docs/multiclaves-spec.md §10.7): un código de cancelación nuevo (SIT-054, "Cancelado
 * con quita") quedaba invisible para acciones masivas, el combo de remesas, la re-asignación de
 * ausentes y `revertirSinPagos`, aunque ya bloqueara la cuenta (`deudor-bloqueo.ts` sí resuelve por
 * categoría desde antes).
 *
 * Este helper es la fuente única para esos cinco lugares. A diferencia de `DeudorBloqueoService`
 * (un servicio de Nest con `onModuleInit`), los `ICategoryProcessor` de imports NO son inyectados
 * por Nest —son instancias planas del registry (`processor-registry.ts`)— así que acá el cache es
 * una variable de módulo, no un campo de instancia: sobrevive entre corridas del mismo proceso y se
 * comparte entre todos los que importan este archivo.
 *
 * Modo degradado: sin ningún código de categoría CANCELADO seedeado, devuelve `[]` (nunca lanza).
 * Igual que `DeudorBloqueoService`, esto permite levantar el sistema antes de correr
 * `seed-codigos-curados.ts`; el llamador decide qué hacer con una lista vacía (normalmente, no
 * filtrar nada — mostrar de más es preferible a esconder lo que el operador necesita).
 */
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

const logger = new Logger('SituacionesCerradas');

let cache: number[] | null = null;

/** Ids de los parámetros de situación de categoría CANCELADO. Cacheado por proceso. */
export async function idsSituacionCancelada(prisma: PrismaService): Promise<number[]> {
    if (cache !== null) return cache;

    const codigos = await prisma.parametro.findMany({
        where: { grupo: 'situacion', categoria: 'CANCELADO' },
        select: { id: true, clave: true },
    });

    cache = codigos.map((c) => c.id);

    if (cache.length === 0) {
        logger.warn(
            'No hay códigos de situación con categoría CANCELADO. Los lugares que resuelven "cancelado" ' +
            'por esta vía operan en modo degradado (sin filtrar). Correr seed-codigos-curados.ts.',
        );
    } else {
        logger.log(`Situaciones cerradas cacheadas: ${codigos.map((c) => c.clave).join(', ')}`);
    }

    return cache;
}

/** Solo para tests: fuerza a que la próxima llamada vuelva a consultar la base. */
export function _resetCacheSituacionesCerradas(): void {
    cache = null;
}
