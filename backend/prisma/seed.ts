import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Usuario "system" id=1 (placeholder hasta que se implemente JWT auth real).
    // Necesario porque ejecucion_reporte_v2.usuarioId tiene FK a usuario.
    const usuarioSystem = await prisma.usuario.upsert({
        where: { id: 1 },
        update: {},
        create: {
            id: 1,
            googleId: 'system',
            nombre: 'System',
            email: 'system@local',
            rol: 'admin',
            updatedAt: new Date(),
        },
    });
    console.log(`✅ Usuario: ${usuarioSystem.email} (id=${usuarioSystem.id})`);

    // Empresa "Personal" (ya te funcionó – lo dejo igual)
    const empresa = await prisma.empresa.upsert({
        where: { nombre: 'Personal' },
        update: {},
        create: {
            nombre: 'Personal',
            cuit: '30-12345678-9',
            configuracion: {},
            // no hace falta updatedAt si en schema tiene @updatedAt
        },
    });

    console.log(`✅ Empresa: ${empresa.nombre} (id=${empresa.id})`);

    const pDeudores = await ensurePlantillaDeudores(empresa.id);
    console.log(`✅ Plantilla creada/actualizada: ${pDeudores.nombre}`);

    const pFacturas = await ensurePlantillaFacturas(empresa.id);
    console.log(`✅ Plantilla creada/actualizada: ${pFacturas.nombre}`);

    console.log('🎉 Seed OK');
}

main()
    .then(async () => await prisma.$disconnect())
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });


// Helpers
async function ensurePlantillaDeudores(personalId: number) {
    const nombre = 'Personal - Deudores (CA)';
    const version = 1;

    const existente = await prisma.plantillaimport.findFirst({
        where: { empresaId: personalId, nombre, version },
    });

    const dataBase = {
        empresaId: personalId,
        nombre,
        categoria: 'DEUDORES' as any, // enum
        version,
        separador: '|',
        tieneHeader: false,
        mappingJson: {
            entity: 'DEUDOR',
            matchKeys: ['empresaId', 'documento'],
            columns: {
                documento: { fromIndex: 7, transforms: ['trim'] },
                apellido: { fromIndex: 10, transforms: ['trim', 'title'] },
                nombre: { fromIndex: 11, transforms: ['trim', 'title'] },
                montoTotal: { fromIndex: 20, transforms: ['toNumber:es-AR'] },
                fechaVencimiento: { fromIndex: 31, transforms: ['toDate:auto'] },
            },
            defaults: {},
            validations: [
                { field: 'documento', rule: 'required' },
                { field: 'montoTotal', rule: '>=0' },
            ],
        },
    };

    if (existente) {
        return prisma.plantillaimport.update({
            where: { id: existente.id },
            data: {
                ...dataBase,
                updatedAt: new Date(), // satisface el tipo actual
            },
        });
    }

    return prisma.plantillaimport.create({
        data: {
            ...dataBase,
            // por si tu modelo lo exige en create:
            updatedAt: new Date(),
        },
    });
}

async function ensurePlantillaFacturas(personalId: number) {
    const nombre = 'Personal - Facturas (MA)';
    const version = 1;

    const existente = await prisma.plantillaimport.findFirst({
        where: { empresaId: personalId, nombre, version },
    });

    const dataBase = {
        empresaId: personalId,
        nombre,
        categoria: 'FACTURAS' as any, // enum
        version,
        separador: '|',
        tieneHeader: false,
        mappingJson: {
            entity: 'FACTURA',
            matchKeys: ['empresaId', 'documento', 'nroFactura'],
            columns: {
                documento: { fromIndex: 5, transforms: ['trim'] },
                nroFactura: { fromIndex: 8, transforms: ['trim'] },
                importe: { fromIndex: 20, transforms: ['toNumber:es-AR'] },
                fechaEmision: { fromIndex: 4, transforms: ['toDate:auto'] },
                vencimiento: { fromIndex: 24, transforms: ['toDate:auto'] },
            },
            defaults: {},
        },
    };

    if (existente) {
        return prisma.plantillaimport.update({
            where: { id: existente.id },
            data: {
                ...dataBase,
                updatedAt: new Date(),
            },
        });
    }

    return prisma.plantillaimport.create({
        data: {
            ...dataBase,
            updatedAt: new Date(),
        },
    });
}
