/**
 * alta-sit-054.ts
 *
 * Script idempotente que da de alta el código de situación SIT-054 "Cancelado con quita"
 * (docs/multiclaves-spec.md §10.7, D14) sin correr el seed completo de `seed-codigos-curados.ts`
 * — ese seed BORRA y reasigna todo el catálogo, lo que en producción sería un riesgo enorme solo
 * para agregar un código nuevo.
 *
 * Qué hace:
 *   1. Crea (o deja como está, si ya existe) el parámetro `SIT-054` — grupo 'situacion',
 *      categoría 'CANCELADO', global.
 *   2. Asegura la fila `empresa_parametro` para TODAS las empresas — sin esto el código no
 *      aparece en los selectores de la ficha ni en Roles/Ajustes (spec §10.7).
 *
 * Correrlo dos veces no cambia nada la segunda vez (upsert + verificación de existencia antes
 * de insertar cada `empresa_parametro`).
 *
 * Uso:
 *   npx ts-node prisma/scripts/alta-sit-054.ts --dry-run
 *   npx ts-node prisma/scripts/alta-sit-054.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const CLAVE = 'SIT-054';
const DESCRIPCION = 'Cancelado con quita';
const CATEGORIA = 'CANCELADO';

async function main() {
    console.log(`alta-sit-054${DRY_RUN ? ' (--dry-run)' : ''}: verificando el código ${CLAVE}...`);

    const existente = await prisma.parametro.findUnique({ where: { clave: CLAVE } });

    if (existente) {
        console.log(
            `✔ ${CLAVE} ya existe (id=${existente.id}, categoria=${existente.categoria ?? '(sin categoría)'}).`,
        );
        if (existente.categoria !== CATEGORIA) {
            console.warn(
                `⚠ ${CLAVE} existe pero con categoria="${existente.categoria}" en vez de "${CATEGORIA}". ` +
                'Revisar a mano: este script no pisa un parámetro ya creado con otra configuración.',
            );
        }
    } else {
        console.log(`${CLAVE} no existe. Se va a crear: grupo=situacion, categoria=${CATEGORIA}, esGlobal=true.`);
        if (!DRY_RUN) {
            await prisma.parametro.create({
                data: {
                    grupo: 'situacion',
                    clave: CLAVE,
                    descripcion: DESCRIPCION,
                    categoria: CATEGORIA,
                    esGlobal: true,
                    activo: true,
                },
            });
            console.log(`✅ ${CLAVE} creado.`);
        }
    }

    const parametro = DRY_RUN && !existente
        ? null
        : (existente ?? await prisma.parametro.findUnique({ where: { clave: CLAVE } }));

    const empresas = await prisma.empresa.findMany({ select: { id: true, nombre: true } });

    if (!parametro) {
        console.log(`(dry-run) Se asociaría ${CLAVE} a las ${empresas.length} empresa(s): ${empresas.map((e) => e.nombre).join(', ')}.`);
        console.log('\nCorré sin --dry-run para aplicar.');
        return;
    }

    let asociadas = 0;
    let yaEstaban = 0;
    for (const empresa of empresas) {
        const ya = await prisma.empresa_parametro.findUnique({
            where: { empresaId_parametroId: { empresaId: empresa.id, parametroId: parametro.id } },
        });
        if (ya) {
            yaEstaban++;
            continue;
        }
        console.log(`  ${DRY_RUN ? '(dry-run) asociaría' : 'asociando'} ${CLAVE} → empresa ${empresa.nombre} (id=${empresa.id})`);
        if (!DRY_RUN) {
            await prisma.empresa_parametro.create({
                data: { empresaId: empresa.id, parametroId: parametro.id },
            });
        }
        asociadas++;
    }

    console.log(
        `\n${DRY_RUN ? '(dry-run) ' : ''}Resumen: ${asociadas} empresa(s) nuevas asociadas, ${yaEstaban} ya lo estaban ` +
        `(${empresas.length} empresas en total).`,
    );
    if (DRY_RUN) {
        console.log('\nCorré sin --dry-run para aplicar.');
    } else {
        console.log('\n✅ alta-sit-054 completo. Reiniciar el backend si estaba corriendo (cachea SIT-054 en onModuleInit).');
    }
}

main()
    .catch((e) => {
        console.error('❌ Error en alta-sit-054:', e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
