/**
 * seed-telefonia.ts
 *
 * Siembra datos iniciales para el módulo de telefonía Neotel:
 *   - Permisos telefonia.*
 *   - Asignación de permisos a roles OPERADOR y SUPERVISOR
 *   - Motivos de pausa placeholder (confirmar SUBTIPO_DESCANSO reales con Neotel)
 *   - Campaña 115 (smoke test)
 *   - Agente de prueba: usuario admin → extensión 6001
 *
 * Convención: idempotente — safe para correr más de una vez.
 * Ejecutar: npx ts-node --transpile-only prisma/seed-telefonia.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Permisos nuevos de telefonía
const PERMISOS_TELEFONIA = [
    'telefonia.usar',
    'telefonia.click_to_call',
    'telefonia.supervisar',
    'telefonia.admin',
];

// Permisos que se suman al rol OPERADOR
const PERMISOS_OPERADOR_TELEFONIA = ['telefonia.usar', 'telefonia.click_to_call'];

// Permisos que se suman al rol SUPERVISOR
const PERMISOS_SUPERVISOR_TELEFONIA = ['telefonia.supervisar'];

// Motivos de pausa placeholder (subtipoNeotel = SUBTIPO_DESCANSO de Neotel.Pause)
// TODO: confirmar valores reales de SUBTIPO_DESCANSO con Neotel antes de go-live
const MOTIVOS_PAUSA = [
    { subtipoNeotel: 1, nombre: 'Almuerzo',     descripcion: 'Pausa por almuerzo',                contabilizaProductivo: false, orden: 1 },
    { subtipoNeotel: 2, nombre: 'Baño',         descripcion: 'Pausa fisiológica',                 contabilizaProductivo: false, orden: 2 },
    { subtipoNeotel: 3, nombre: 'Capacitación', descripcion: 'Capacitación o entrenamiento',       contabilizaProductivo: true,  orden: 3 },
    { subtipoNeotel: 4, nombre: 'Reunión',      descripcion: 'Reunión de equipo o supervisión',   contabilizaProductivo: true,  orden: 4 },
];

async function main() {
    // ── 1 + 2. Permisos (viven como JSON array en rol.permisos — no hay tabla standalone) ──
    //
    // La arquitectura de este repo almacena los permisos como JSON array en `rol`.
    // No hay tabla `permiso` separada. El seed principal lo confirma.

    console.log('Actualizando permisos del rol OPERADOR…');
    const rolOperador = await prisma.rol.findUnique({ where: { nombre: 'OPERADOR' } });
    if (rolOperador) {
        const permisosActuales: string[] = Array.isArray(rolOperador.permisos)
            ? (rolOperador.permisos as string[])
            : [];
        const permisosNuevos = [...new Set([...permisosActuales, ...PERMISOS_OPERADOR_TELEFONIA])];
        await prisma.rol.update({
            where: { id: rolOperador.id },
            data: { permisos: permisosNuevos },
        });
        console.log(`  OPERADOR: ${permisosActuales.length} → ${permisosNuevos.length} permisos`);
    } else {
        console.warn('  Rol OPERADOR no encontrado — ejecutar seed principal primero');
    }

    console.log('Actualizando permisos del rol SUPERVISOR…');
    const rolSupervisor = await prisma.rol.findUnique({ where: { nombre: 'SUPERVISOR' } });
    if (rolSupervisor) {
        const permisosActuales: string[] = Array.isArray(rolSupervisor.permisos)
            ? (rolSupervisor.permisos as string[])
            : [];
        const permisosNuevos = [...new Set([...permisosActuales, ...PERMISOS_SUPERVISOR_TELEFONIA])];
        await prisma.rol.update({
            where: { id: rolSupervisor.id },
            data: { permisos: permisosNuevos },
        });
        console.log(`  SUPERVISOR: ${permisosActuales.length} → ${permisosNuevos.length} permisos`);
    } else {
        // TODO: crear rol SUPERVISOR cuando se decida el conjunto base de permisos
        console.warn('  Rol SUPERVISOR no encontrado — skip (crear con seed-roles.ts cuando corresponda)');
    }

    console.log('Actualizando permisos del rol ADMIN…');
    const rolAdmin = await prisma.rol.findUnique({ where: { nombre: 'ADMIN' } });
    if (rolAdmin) {
        const permisosActuales: string[] = Array.isArray(rolAdmin.permisos)
            ? (rolAdmin.permisos as string[])
            : [];
        const permisosNuevos = [...new Set([...permisosActuales, ...PERMISOS_TELEFONIA])];
        await prisma.rol.update({
            where: { id: rolAdmin.id },
            data: { permisos: permisosNuevos },
        });
        console.log(`  ADMIN: ${permisosActuales.length} → ${permisosNuevos.length} permisos`);
    }

    // ── 3. Motivos de pausa ────────────────────────────────────────────────────

    console.log('Insertando motivos de pausa placeholder…');
    for (const motivo of MOTIVOS_PAUSA) {
        await prisma.motivo_pausa_neotel.upsert({
            where:  { subtipoNeotel: motivo.subtipoNeotel },
            update: { nombre: motivo.nombre, descripcion: motivo.descripcion, orden: motivo.orden },
            create: motivo,
        });
        console.log(`  Motivo ${motivo.subtipoNeotel}: ${motivo.nombre}`);
    }

    // ── 4. Campaña 115 ────────────────────────────────────────────────────────

    console.log('Insertando campaña de prueba 115…');
    const campaña115 = await prisma.campaña_neotel.upsert({
        where:  { idNeotel: 115 },
        update: { nombre: 'Campaña 115 (QA Neotel)', activa: true, predictiva: true },
        create: {
            idNeotel:   115,
            nombre:     'Campaña 115 (QA Neotel)',
            descripcion: 'Campaña de smoke test para validación de integración Neotel. Campaña real de Ana Maya.',
            activa:     true,
            predictiva: true,
        },
    });
    console.log(`  Campaña: id=${campaña115.id} idNeotel=${campaña115.idNeotel}`);

    // ── 5. Agente de prueba (extensión 6001) ──────────────────────────────────
    //
    // Credenciales en PLANO durante el smoke test inicial.
    // TODO: antes del go-live, cifrar con AES-256-GCM usando NEOTEL_ENC_KEY del .env
    // y reemplazar estos valores por el ciphertext + IV + authTag concatenados.
    //
    // Formato esperado una vez cifrado:
    //   `${iv_hex}:${authTag_hex}:${ciphertext_hex}`
    //
    // Usuario objetivo: maxidiflumeri@gmail.com (único usuario admin disponible).
    // Si se quiere un usuario dedicado qa-telefonia@amsa.local, crearlo primero.

    console.log('Buscando usuario admin para agente de prueba…');
    const usuarioAdmin = await prisma.usuario.findUnique({
        where: { email: 'maxidiflumeri@gmail.com' },
    });

    if (!usuarioAdmin) {
        console.warn('  Usuario maxidiflumeri@gmail.com no encontrado — agente de prueba no creado');
        console.warn('  Ejecutar seed principal primero: npx ts-node --transpile-only prisma/seed.ts');
    } else {
        const CLAVE_NEOTEL_PLANO = '10066001';  // TODO: cifrar con NEOTEL_ENC_KEY antes de go-live
        const CLAVE_SIP_PLANO    = 'Externo6001'; // TODO: idem

        await prisma.agente_telefonia.upsert({
            where:  { usuarioId: usuarioAdmin.id },
            update: {
                usuarioNeotel:  '6001',
                claveNeotelEnc: CLAVE_NEOTEL_PLANO,
                device:         'Externo6001',
                sipAuthUser:    'Externo6001',
                sipPasswordEnc: CLAVE_SIP_PLANO,
                sipDisplayName: 'Agente 6001 (QA)',
                habilitado:     true,
            },
            create: {
                usuarioId:      usuarioAdmin.id,
                usuarioNeotel:  '6001',
                claveNeotelEnc: CLAVE_NEOTEL_PLANO,
                device:         'Externo6001',
                sipAuthUser:    'Externo6001',
                sipPasswordEnc: CLAVE_SIP_PLANO,
                sipDisplayName: 'Agente 6001 (QA)',
                habilitado:     true,
            },
        });
        console.log(`  Agente creado: usuarioId=${usuarioAdmin.id} extensión=6001 device=Externo6001`);
    }

    // ── 6. Resumen ────────────────────────────────────────────────────────────

    const countMotivos  = await prisma.motivo_pausa_neotel.count();
    const countCampañas = await prisma.campaña_neotel.count();
    const countAgentes  = await prisma.agente_telefonia.count();

    console.log('\n──────────────────────────────────────');
    console.log('Seed telefonía completado:');
    console.log(`  motivo_pausa_neotel : ${countMotivos} filas`);
    console.log(`  campaña_neotel      : ${countCampañas} filas`);
    console.log(`  agente_telefonia    : ${countAgentes} filas`);
    console.log('──────────────────────────────────────\n');
}

main()
    .then(async () => await prisma.$disconnect())
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });
