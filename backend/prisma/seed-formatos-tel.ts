import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const formatos = [
    { nombre: 'WhatsApp Internacional AR', descripcion: 'Para envío por WhatsApp (ej: 5491123456789)', patron: '549{numero}' },
    { nombre: 'Nacional con 0', descripcion: 'Formato local con prefijo 0 (ej: 01123456789)', patron: '0{numero}' },
    { nombre: 'Solo número', descripcion: 'Número sin prefijos (ej: 1123456789)', patron: '{numero}' },
    { nombre: 'Internacional +54', descripcion: 'Con signo más (ej: +5491123456789)', patron: '+549{numero}' },
  ];
  for (const f of formatos) {
    await prisma.formato_telefono.upsert({
      where: { nombre: f.nombre },
      update: {},
      create: f,
    });
  }
  console.log('Formatos de teléfono cargados');
}
main().finally(() => prisma.$disconnect());
