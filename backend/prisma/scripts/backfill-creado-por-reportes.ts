/**
 * Backfill de plantilla_reporte.creadoPorId desde la auditoría.
 *
 * Hasta el 2026-10-19 el controller no le pasaba el usuario al servicio al crear una plantilla, así
 * que `creadoPorId` quedó en NULL en todas. La auditoría sí guardó quién fue: la transacción de
 * creación (`entidad = 'PlantillaReporte'`, `tipo = 'CREATE'`, `entidadId` = id de la plantilla).
 *
 * Idempotente: solo toca plantillas con creadoPorId NULL que tengan una auditoría de creación con
 * usuario, y no pisa nada que ya esté cargado. Si hay más de una creación para la misma plantilla
 * (la duplicación también audita como CREATE sobre la copia, con otro id), usa la más antigua.
 *
 * Por defecto NO escribe: muestra qué haría. Para aplicar hay que pasar --aplicar.
 *
 * Uso:
 *   npx ts-node --transpile-only prisma/scripts/backfill-creado-por-reportes.ts             # dry-run
 *   npx ts-node --transpile-only prisma/scripts/backfill-creado-por-reportes.ts --aplicar
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const aplicar = process.argv.includes('--aplicar');
    console.log(aplicar ? 'Modo: APLICAR (escribe)' : 'Modo: dry-run (no escribe). Para aplicar: --aplicar');

    const pendientes = await prisma.plantilla_reporte.findMany({
        where: { creadoPorId: null },
        select: { id: true, nombre: true },
        orderBy: { id: 'asc' },
    });
    console.log(`Plantillas con creadoPorId NULL: ${pendientes.length}`);

    let completadas = 0;
    let sinAuditoria = 0;

    for (const plantilla of pendientes) {
        const creacion = await prisma.transaccion.findFirst({
            where: {
                entidad: 'PlantillaReporte',
                tipo: 'CREATE',
                entidadId: String(plantilla.id),
                usuarioId: { not: null },
            },
            orderBy: { createdAt: 'asc' },
            select: { usuarioId: true, createdAt: true },
        });

        if (!creacion?.usuarioId) {
            sinAuditoria++;
            console.log(`  #${plantilla.id} "${plantilla.nombre}": sin auditoría de creación con usuario, se deja en NULL`);
            continue;
        }

        console.log(
            `  #${plantilla.id} "${plantilla.nombre}": creadoPorId <- ${creacion.usuarioId} ` +
            `(auditoría del ${creacion.createdAt.toISOString()})`,
        );

        if (aplicar) {
            // El `creadoPorId: null` en el where evita pisar un valor cargado entre la lectura y la escritura.
            const r = await prisma.plantilla_reporte.updateMany({
                where: { id: plantilla.id, creadoPorId: null },
                data: { creadoPorId: creacion.usuarioId },
            });
            completadas += r.count;
        } else {
            completadas++;
        }
    }

    console.log(
        `${aplicar ? 'Actualizadas' : 'Se actualizarían'}: ${completadas} · sin auditoría: ${sinAuditoria}`,
    );
    if (!aplicar && completadas > 0) console.log('Dry-run: no se escribió nada.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
