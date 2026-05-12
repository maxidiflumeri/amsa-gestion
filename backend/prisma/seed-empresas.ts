import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Fuente: varios/Ue1.xls (cartera histórica de AMSA).
// Se excluye "TODAS" (id 00) porque no es una empresa real sino un agregador interno legacy.
const empresas: Array<{ legacyId: string; nombre: string }> = [
  { legacyId: '13', nombre: 'AHORRISTAS PEUGEOT/CITR' },
  { legacyId: '14', nombre: 'PEUGEOT/CITROEN' },
  { legacyId: '17', nombre: 'TOYOTA' },
  { legacyId: '21', nombre: 'FIAT' },
  { legacyId: '22', nombre: 'MOVISTAR_LEGALES' },
  { legacyId: '24', nombre: 'FIAT MORA TEMPRANA' },
  { legacyId: '26', nombre: 'CLARO  PL' },
  { legacyId: '30', nombre: 'TELECOM' },
  { legacyId: '31', nombre: 'TELECOM_PERSONAL' },
  { legacyId: '32', nombre: 'TELECOM  FRAUDES' },
  { legacyId: '34', nombre: 'TOYOTA PLAN DE AHORRO' },
  { legacyId: '35', nombre: 'FULLER /TUPPERWARE' },
  { legacyId: '36', nombre: 'PLAN ROMBO S.A.' },
  { legacyId: '41', nombre: 'FIAT PLAN' },
  { legacyId: '43', nombre: 'JEEP RAM PLAN' },
  { legacyId: '44', nombre: 'TOYOTA REFINANCIACION' },
  { legacyId: '49', nombre: 'PEUGEOT CITROEN (PAR)' },
  { legacyId: '60', nombre: 'AYSA' },
  { legacyId: '73', nombre: 'UALA' },
  { legacyId: '74', nombre: 'AUSA' },
  { legacyId: '79', nombre: 'TOYOTA RELEVAMIENTO' },
  { legacyId: '85', nombre: 'TOYOTA 0800' },
  { legacyId: '87', nombre: 'TOYOTA VENTA SEGUROS' },
  { legacyId: '94', nombre: 'FIBERTEL' },
];

async function main() {
  console.log(`📥 Insertando ${empresas.length} empresas...`);

  let creadas = 0;
  let existentes = 0;
  for (const e of empresas) {
    const existing = await prisma.empresa.findUnique({ where: { nombre: e.nombre } });
    if (existing) {
      existentes++;
      console.log(`  · ${e.nombre} (ya existe, id=${existing.id})`);
      continue;
    }
    const nueva = await prisma.empresa.create({
      data: { nombre: e.nombre },
    });
    creadas++;
    console.log(`  ✓ ${e.nombre} (id=${nueva.id})`);
  }

  console.log(`\n✅ Empresas: ${creadas} creadas, ${existentes} ya existían`);
  console.log('\n💡 Recordá correr seed-codigos-curados.ts después para asociar los parámetros globales a las nuevas empresas.');
}

main()
  .catch((e) => {
    console.error('❌ Error durante el seed de empresas:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
