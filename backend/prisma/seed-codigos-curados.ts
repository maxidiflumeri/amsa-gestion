import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const codigos = [
  // ── GESTIÓN ──────────────────────────────────────────────────────────────
  // CONTACTO
  { grupo: 'gestion', clave: 'GES-001', descripcion: 'Gestión sin definición', categoria: 'CONTACTO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-002', descripcion: 'Contacto con titular', categoria: 'CONTACTO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-003', descripcion: 'Contacto con tercero', categoria: 'CONTACTO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-004', descripcion: 'Mensaje en contestador', categoria: 'CONTACTO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-005', descripcion: 'Llamada sin respuesta', categoria: 'CONTACTO', esGlobal: true },
  // SIN_CONTACTO
  { grupo: 'gestion', clave: 'GES-010', descripcion: 'Sin contacto', categoria: 'SIN_CONTACTO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-011', descripcion: 'Teléfono no contesta - múltiples intentos', categoria: 'SIN_CONTACTO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-012', descripcion: 'Teléfono fuera de servicio', categoria: 'SIN_CONTACTO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-013', descripcion: 'Número inexistente', categoria: 'SIN_CONTACTO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-014', descripcion: 'Teléfono equivocado', categoria: 'DATO_INCORRECTO', esGlobal: true },
  // DATO_INCORRECTO
  { grupo: 'gestion', clave: 'GES-020', descripcion: 'Datos de contacto incorrectos', categoria: 'DATO_INCORRECTO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-021', descripcion: 'Domicilio incorrecto o incompleto', categoria: 'DATO_INCORRECTO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-022', descripcion: 'Deudor inubicable', categoria: 'DATO_INCORRECTO', esGlobal: true },
  // PROMESA
  { grupo: 'gestion', clave: 'GES-030', descripcion: 'Promesa de pago', categoria: 'PROMESA', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-031', descripcion: 'Compromiso de pago parcial', categoria: 'PROMESA', esGlobal: true },
  // PAGO
  { grupo: 'gestion', clave: 'GES-040', descripcion: 'Pago realizado', categoria: 'PAGO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-041', descripcion: 'Pago parcial realizado', categoria: 'PAGO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-042', descripcion: 'Pago pendiente de acreditación', categoria: 'PAGO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-043', descripcion: 'Pago vía Mercado Pago', categoria: 'PAGO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-044', descripcion: 'Pago vía transferencia bancaria', categoria: 'PAGO', esGlobal: true },
  // CONVENIO
  { grupo: 'gestion', clave: 'GES-050', descripcion: 'Convenio acordado', categoria: 'CONVENIO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-051', descripcion: 'Solicita refinanciación', categoria: 'CONVENIO', esGlobal: true },
  // NEGATIVA
  { grupo: 'gestion', clave: 'GES-060', descripcion: 'Negativa de pago', categoria: 'NEGATIVA', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-061', descripcion: 'No afronta la deuda - problema financiero', categoria: 'NEGATIVA', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-062', descripcion: 'Solicita quita o descuento', categoria: 'NEGATIVA', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-063', descripcion: 'Desconoce la deuda', categoria: 'NEGATIVA', esGlobal: true },
  // RECLAMO
  { grupo: 'gestion', clave: 'GES-070', descripcion: 'Reclamo activo', categoria: 'RECLAMO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-071', descripcion: 'Disputa por el monto', categoria: 'RECLAMO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-072', descripcion: 'Posible fraude', categoria: 'RECLAMO', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-073', descripcion: 'Baja de servicio en disputa', categoria: 'RECLAMO', esGlobal: true },
  // DERIVACION
  { grupo: 'gestion', clave: 'GES-080', descripcion: 'Derivado a área legal', categoria: 'DERIVACION', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-081', descripcion: 'Derivado a servicio al cliente', categoria: 'DERIVACION', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-082', descripcion: 'Liberado sin gestión', categoria: 'DERIVACION', esGlobal: true },
  // ADMIN
  { grupo: 'gestion', clave: 'GES-090', descripcion: 'Dado de baja del sistema', categoria: 'ADMIN', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-091', descripcion: 'Cancelado en remesa anterior', categoria: 'ADMIN', esGlobal: true },
  { grupo: 'gestion', clave: 'GES-092', descripcion: 'Fallecido', categoria: 'ADMIN', esGlobal: true },

  // ── SITUACIÓN ────────────────────────────────────────────────────────────
  // SIN_CONTACTO
  { grupo: 'situacion', clave: 'SIT-001', descripcion: 'Sin contacto', categoria: 'SIN_CONTACTO', esGlobal: true },
  { grupo: 'situacion', clave: 'SIT-002', descripcion: 'Inubicable', categoria: 'SIN_CONTACTO', esGlobal: true },
  // CONTACTADO
  { grupo: 'situacion', clave: 'SIT-010', descripcion: 'Contactado sin definición', categoria: 'CONTACTADO', esGlobal: true },
  { grupo: 'situacion', clave: 'SIT-011', descripcion: 'Contactado - en negociación', categoria: 'CONTACTADO', esGlobal: true },
  // PROMESA
  { grupo: 'situacion', clave: 'SIT-020', descripcion: 'Promesa de pago vigente', categoria: 'PROMESA', esGlobal: true },
  { grupo: 'situacion', clave: 'SIT-021', descripcion: 'Promesa incumplida', categoria: 'PROMESA', esGlobal: true },
  // CONVENIO
  { grupo: 'situacion', clave: 'SIT-030', descripcion: 'Convenio activo', categoria: 'CONVENIO', esGlobal: true },
  { grupo: 'situacion', clave: 'SIT-031', descripcion: 'Convenio con pagos incompletos', categoria: 'CONVENIO', esGlobal: true },
  { grupo: 'situacion', clave: 'SIT-032', descripcion: 'Convenio incumplido', categoria: 'CONVENIO', esGlobal: true },
  { grupo: 'situacion', clave: 'SIT-033', descripcion: 'Convenio cumplido', categoria: 'CONVENIO', esGlobal: true },
  // PAGANDO
  { grupo: 'situacion', clave: 'SIT-040', descripcion: 'Pagando', categoria: 'PAGANDO', esGlobal: true },
  { grupo: 'situacion', clave: 'SIT-041', descripcion: 'Pago parcial', categoria: 'PAGANDO', esGlobal: true },
  // CANCELADO
  { grupo: 'situacion', clave: 'SIT-050', descripcion: 'Cancelado / Pagado', categoria: 'CANCELADO', esGlobal: true },
  { grupo: 'situacion', clave: 'SIT-051', descripcion: 'Cancelado antes de la gestión', categoria: 'CANCELADO', esGlobal: true },
  // NEGATIVA
  { grupo: 'situacion', clave: 'SIT-060', descripcion: 'Negativa de pago', categoria: 'NEGATIVA', esGlobal: true },
  { grupo: 'situacion', clave: 'SIT-061', descripcion: 'Desconoce la deuda', categoria: 'NEGATIVA', esGlobal: true },
  // BAJA
  { grupo: 'situacion', clave: 'SIT-070', descripcion: 'Fallecido', categoria: 'BAJA', esGlobal: true },
  { grupo: 'situacion', clave: 'SIT-071', descripcion: 'Dado de baja / Rescisión', categoria: 'BAJA', esGlobal: true },
  { grupo: 'situacion', clave: 'SIT-072', descripcion: 'Fraude confirmado', categoria: 'BAJA', esGlobal: true },

  // ── MOTIVO NO PAGO ───────────────────────────────────────────────────────
  // ECONOMICO
  { grupo: 'motivo_no_pago', clave: 'MNP-010', descripcion: 'Problema económico - falta de liquidez', categoria: 'ECONOMICO', esGlobal: true },
  { grupo: 'motivo_no_pago', clave: 'MNP-011', descripcion: 'Desempleo', categoria: 'ECONOMICO', esGlobal: true },
  // DESCONOCE
  { grupo: 'motivo_no_pago', clave: 'MNP-020', descripcion: 'Desconoce la deuda', categoria: 'DESCONOCE', esGlobal: true },
  { grupo: 'motivo_no_pago', clave: 'MNP-021', descripcion: 'No solicitó el servicio o producto', categoria: 'DESCONOCE', esGlobal: true },
  { grupo: 'motivo_no_pago', clave: 'MNP-022', descripcion: 'No reconoce el monto', categoria: 'DESCONOCE', esGlobal: true },
  // DISPUTA
  { grupo: 'motivo_no_pago', clave: 'MNP-030', descripcion: 'Reclamo activo', categoria: 'DISPUTA', esGlobal: true },
  { grupo: 'motivo_no_pago', clave: 'MNP-031', descripcion: 'Denuncia presentada', categoria: 'DISPUTA', esGlobal: true },
  // FACTURACION
  { grupo: 'motivo_no_pago', clave: 'MNP-040', descripcion: 'No recibió la factura', categoria: 'FACTURACION', esGlobal: true },
  { grupo: 'motivo_no_pago', clave: 'MNP-041', descripcion: 'Error en la facturación', categoria: 'FACTURACION', esGlobal: true },
  // MEDIO_PAGO
  { grupo: 'motivo_no_pago', clave: 'MNP-050', descripcion: 'Problemas con el medio de pago', categoria: 'MEDIO_PAGO', esGlobal: true },
  { grupo: 'motivo_no_pago', clave: 'MNP-051', descripcion: 'Sin acceso a boca de cobro', categoria: 'MEDIO_PAGO', esGlobal: true },
  // ACUERDO
  { grupo: 'motivo_no_pago', clave: 'MNP-060', descripcion: 'Solicita plan de pagos', categoria: 'ACUERDO', esGlobal: true },
  { grupo: 'motivo_no_pago', clave: 'MNP-061', descripcion: 'Acuerdo en negociación', categoria: 'ACUERDO', esGlobal: true },
  // BAJA
  { grupo: 'motivo_no_pago', clave: 'MNP-070', descripcion: 'Fallecimiento', categoria: 'BAJA', esGlobal: true },
  { grupo: 'motivo_no_pago', clave: 'MNP-071', descripcion: 'Rescisión o renuncia al servicio', categoria: 'BAJA', esGlobal: true },
];

async function main() {
  console.log('🧹 Limpiando datos existentes...');

  // 1. Limpiar empresa_parametro primero (FK con cascada)
  await prisma.empresa_parametro.deleteMany({});
  console.log('✅ empresa_parametro limpiado');

  // 2. Limpiar FKs de deudor (ponerlas en null primero)
  await prisma.deudor.updateMany({
    data: {
      estadoGestionId: null,
      estadoSituacionId: null,
      motivoNoPagoId: null
    }
  });
  console.log('✅ FKs de deudor en null');

  // 3. Borrar todos los parametros
  await prisma.parametro.deleteMany({});
  console.log('✅ parametros limpiados');

  console.log('\n📥 Insertando códigos curados...');

  // 4. Insertar códigos curados
  for (const codigo of codigos) {
    await prisma.parametro.upsert({
      where: { clave: codigo.clave },
      update: codigo,
      create: { ...codigo, activo: true },
    });
  }
  console.log(`✅ ${codigos.length} parámetros insertados`);

  console.log('\n🔗 Asociando códigos a empresas...');

  // 5. Asociar todos los globales a todas las empresas
  const empresas = await prisma.empresa.findMany({ select: { id: true, nombre: true } });
  const params = await prisma.parametro.findMany({
    where: { esGlobal: true },
    select: { id: true }
  });

  let asoc = 0;
  for (const emp of empresas) {
    for (const p of params) {
      await prisma.empresa_parametro.upsert({
        where: {
          empresaId_parametroId: {
            empresaId: emp.id,
            parametroId: p.id
          }
        },
        update: {},
        create: {
          empresaId: emp.id,
          parametroId: p.id
        },
      });
      asoc++;
    }
    console.log(`  ✓ ${emp.nombre}: ${params.length} códigos asignados`);
  }

  console.log(`\n✅ ${asoc} asociaciones empresa_parametro creadas`);
  console.log('\n🎉 Curación completa finalizada exitosamente');
}

main()
  .catch((e) => {
    console.error('❌ Error durante la curación:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
