import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const empresas = await prisma.empresa.findMany();
  const parametros = await prisma.parametro.findMany();

  for (const emp of empresas) {
    for (const p of parametros) {
      if (p.clave === 'ACTIVO' || p.clave === 'PENDIENTE') {
        const existe = await prisma.empresa_parametro.findUnique({
          where: {
            empresaId_parametroId: {
              empresaId: emp.id,
              parametroId: p.id
            }
          }
        });
        if (!existe) {
          await prisma.empresa_parametro.create({
            data: {
              empresaId: emp.id,
              parametroId: p.id
            }
          });
          console.log(`Created link: Empresa ${emp.id} -> Parametro ${p.id} (${p.clave})`);
        }
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
