/**
 * Saca de `rol.permisos` las claves que ya no existen en el catálogo.
 *
 * Hace falta porque `RolesService.validarPermisos` rechaza cualquier clave desconocida: un rol que
 * quedó con una clave retirada **no se puede volver a guardar** desde la pantalla de Roles hasta que
 * se la limpie. O sea que retirar un permiso sin correr esto rompe la edición de ese rol.
 *
 * Es idempotente: correrlo dos veces no cambia nada.
 *
 * Uso:
 *   npx ts-node --transpile-only prisma/scripts/limpiar-permisos-obsoletos.ts            # dry-run
 *   npx ts-node --transpile-only prisma/scripts/limpiar-permisos-obsoletos.ts --apply
 */
import { PrismaClient } from '@prisma/client';
import { TODAS_LAS_KEYS } from '../../src/auth/permisos-catalogo';

const APLICAR = process.argv.includes('--apply');

async function main() {
    const prisma = new PrismaClient();
    const validas = new Set(TODAS_LAS_KEYS);

    const roles = await prisma.rol.findMany({ select: { id: true, nombre: true, permisos: true } });
    let tocados = 0;

    for (const rol of roles) {
        const actuales: string[] = Array.isArray(rol.permisos) ? (rol.permisos as string[]) : [];
        const obsoletas = actuales.filter((p) => !validas.has(p));
        if (obsoletas.length === 0) continue;

        tocados++;
        const limpias = actuales.filter((p) => validas.has(p));
        console.log(
            `rol ${rol.id} "${rol.nombre}": ${obsoletas.length} clave(s) obsoleta(s) — ${obsoletas.join(', ')}` +
            `  (${actuales.length} → ${limpias.length})`,
        );
        if (APLICAR) {
            await prisma.rol.update({ where: { id: rol.id }, data: { permisos: limpias } });
        }
    }

    if (tocados === 0) {
        console.log(`Nada que limpiar: los ${roles.length} rol(es) tienen solo claves del catálogo.`);
    } else if (!APLICAR) {
        console.log(`\n${tocados} rol(es) para limpiar. Volvé a correrlo con --apply.`);
    } else {
        console.log(`\n${tocados} rol(es) limpiado(s).`);
    }

    await prisma.$disconnect();
    process.exit(0);
}

main();
