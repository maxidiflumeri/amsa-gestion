/**
 * Backfill de deudor.nroCliente desde camposAdicionales.nro_cliente.
 *
 * Migra el número de cliente que históricamente vivía como dato adicional
 * (JSON camposAdicionales) a la nueva columna principal `nroCliente`.
 *
 * Idempotente: solo toca deudores con nroCliente NULL que tengan la clave
 * 'nro_cliente' en camposAdicionales. Re-correrlo no genera cambios extra.
 *
 * Uso:
 *   npx ts-node --transpile-only prisma/scripts/backfill-nro-cliente.ts [--dry-run]
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const dryRun = process.argv.includes('--dry-run');

    const pendientes = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
        `SELECT COUNT(*) AS c FROM deudor
         WHERE nroCliente IS NULL
           AND JSON_EXTRACT(camposAdicionales, '$.nro_cliente') IS NOT NULL`,
    );
    const total = Number(pendientes[0]?.c ?? 0);
    console.log(`Deudores a migrar (nroCliente <- camposAdicionales.nro_cliente): ${total}`);

    if (dryRun) {
        console.log('--dry-run: no se aplica ningún cambio.');
        return;
    }
    if (total === 0) {
        console.log('Nada para migrar.');
        return;
    }

    const filas = await prisma.$executeRawUnsafe(
        `UPDATE deudor
         SET nroCliente = JSON_UNQUOTE(JSON_EXTRACT(camposAdicionales, '$.nro_cliente'))
         WHERE nroCliente IS NULL
           AND JSON_EXTRACT(camposAdicionales, '$.nro_cliente') IS NOT NULL`,
    );
    console.log(`Filas actualizadas: ${filas}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
