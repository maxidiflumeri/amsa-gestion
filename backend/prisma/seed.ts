import { PrismaClient } from '@prisma/client';

// Inline de TODAS_LAS_KEYS para no depender de compilación de módulos NestJS
const TODAS_LAS_KEYS: string[] = [
    'deudores.ver',
    'deudores.editar_estado',
    'deudores.exportar',
    'comentarios.ver',
    'comentarios.crear',
    'comentarios.eliminar',
    'convenios.ver',
    'convenios.crear',
    'convenios.cancelar',
    'convenios.registrar_pago',
    'pagos.ver',
    'pagos.crear',
    'pagos.eliminar',
    'promesas.ver',
    'promesas.crear',
    'promesas.cancelar',
    'promesas.procesar_vencidas',
    'importacion.ejecutar',
    'importacion.ver_historial',
    'importacion.ver_progreso_otros',
    'importacion.eliminar',
    'consolidacion.ejecutar',
    'plantillas_import.ver',
    'plantillas_import.crear',
    'plantillas_import.editar',
    'plantillas_import.eliminar',
    'reportes.ver',
    'reportes.crear',
    'reportes.editar',
    'reportes.eliminar',
    'reportes.ejecutar',
    'reportes.ver_ejecuciones',
    'reportes.gestionar_formatos',
    'empresas.ver',
    'empresas.crear',
    'empresas.editar',
    'empresas.eliminar',
    'parametros.ver',
    'parametros.crear',
    'parametros.editar',
    'parametros.eliminar',
    'politicas.ver',
    'politicas.crear',
    'politicas.editar',
    'politicas.eliminar',
    'admin.gestionar_roles',
    'admin.gestionar_usuarios',
];

const PERMISOS_OPERADOR: string[] = [
    'deudores.ver',
    'comentarios.ver',
    'comentarios.crear',
    'convenios.ver',
    'importacion.ver_historial',
    'plantillas_import.ver',
    'reportes.ver',
    'reportes.ejecutar',
    'empresas.ver',
    'parametros.ver',
    'politicas.ver',
];

const prisma = new PrismaClient();

async function main() {
    // 1. Crear rol ADMIN
    const rolAdmin = await prisma.rol.upsert({
        where: { nombre: 'ADMIN' },
        update: { permisos: TODAS_LAS_KEYS },
        create: {
            nombre: 'ADMIN',
            permisos: TODAS_LAS_KEYS,
        },
    });
    console.log(`Rol ADMIN: id=${rolAdmin.id} (${TODAS_LAS_KEYS.length} permisos)`);

    // 2. Crear rol OPERADOR (mínimo, para testing)
    const rolOperador = await prisma.rol.upsert({
        where: { nombre: 'OPERADOR' },
        update: { permisos: PERMISOS_OPERADOR },
        create: {
            nombre: 'OPERADOR',
            permisos: PERMISOS_OPERADOR,
        },
    });
    console.log(`Rol OPERADOR: id=${rolOperador.id} (${PERMISOS_OPERADOR.length} permisos)`);

    // 3. Upsert usuario maxidiflumeri@gmail.com como ADMIN
    const usuarioAdmin = await prisma.usuario.upsert({
        where: { email: 'maxidiflumeri@gmail.com' },
        update: {
            nombre: 'Maxi Di Flume',
            rolId: rolAdmin.id,
            activo: true,
            updatedAt: new Date(),
        },
        create: {
            nombre: 'Maxi Di Flume',
            email: 'maxidiflumeri@gmail.com',
            rolId: rolAdmin.id,
            activo: true,
            updatedAt: new Date(),
        },
    });
    console.log(`Usuario ADMIN: ${usuarioAdmin.email} (id=${usuarioAdmin.id}, rolId=${usuarioAdmin.rolId})`);

    // 4. Mantener usuario system para FK legacy (sin id fijo, por email)
    const existeSystem = await prisma.usuario.findUnique({ where: { email: 'system@local' } });
    let usuarioSystem: { id: number; email: string };
    if (!existeSystem) {
        usuarioSystem = await prisma.usuario.create({
            data: {
                googleId: 'system',
                nombre: 'System',
                email: 'system@local',
                activo: false,
                updatedAt: new Date(),
            },
        });
    } else {
        usuarioSystem = existeSystem;
    }
    console.log(`Usuario System: ${usuarioSystem.email} (id=${usuarioSystem.id})`);

    // 5. Empresa "Personal"
    const empresa = await prisma.empresa.upsert({
        where: { nombre: 'Personal' },
        update: {},
        create: {
            nombre: 'Personal',
            cuit: '30-12345678-9',
            configuracion: {},
        },
    });
    console.log(`Empresa: ${empresa.nombre} (id=${empresa.id})`);

    // 6. Plantillas de importación
    const pDeudores = await ensurePlantillaDeudores(empresa.id);
    console.log(`Plantilla: ${pDeudores.nombre}`);

    const pFacturas = await ensurePlantillaFacturas(empresa.id);
    console.log(`Plantilla: ${pFacturas.nombre}`);

    console.log('Seed completado correctamente');
}

main()
    .then(async () => await prisma.$disconnect())
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });

async function ensurePlantillaDeudores(personalId: number) {
    const nombre = 'Personal - Deudores (CA)';
    const version = 1;

    const existente = await prisma.plantillaimport.findFirst({
        where: { empresaId: personalId, nombre, version },
    });

    const dataBase = {
        empresaId: personalId,
        nombre,
        categoria: 'DEUDORES' as any,
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
            data: { ...dataBase, updatedAt: new Date() },
        });
    }

    return prisma.plantillaimport.create({
        data: { ...dataBase, updatedAt: new Date() },
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
        categoria: 'FACTURAS' as any,
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
            data: { ...dataBase, updatedAt: new Date() },
        });
    }

    return prisma.plantillaimport.create({
        data: { ...dataBase, updatedAt: new Date() },
    });
}
