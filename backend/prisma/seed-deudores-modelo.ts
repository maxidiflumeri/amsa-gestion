/**
 * Seed de 3 deudores modelo para presentaciones / screenshots.
 * Idempotente: si ya existen (mismo empresaId+documento+remesaId), los actualiza.
 *
 * Empresa: TELECOM (id=9)
 * Remesa: "DEMO - Modelo presentación"
 *
 * Correr: npx ts-node --transpile-only prisma/seed-deudores-modelo.ts
 */
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

const EMPRESA_ID = 9; // TELECOM
const REMESA_NOMBRE = 'DEMO - Modelo presentación';
const REMESA_NUMERO = 'DEMO-001';

const dias = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

async function main() {
  const empresa = await p.empresa.findUnique({ where: { id: EMPRESA_ID } });
  if (!empresa) throw new Error(`Empresa ${EMPRESA_ID} no existe`);

  let remesa = await p.remesa.findFirst({
    where: { empresaId: EMPRESA_ID, nombre: REMESA_NOMBRE },
  });
  if (!remesa) {
    remesa = await p.remesa.create({
      data: {
        empresaId: EMPRESA_ID,
        nombre: REMESA_NOMBRE,
        numeroRemesa: REMESA_NUMERO,
        estadoCarga: 'FINALIZADA',
        estadoProceso: 'FINALIZADA',
        totalFilas: 3,
        okFilas: 3,
        errFilas: 0,
        cantidadDeudores: 3,
      },
    });
    console.log(`Remesa creada id=${remesa.id}`);
  } else {
    console.log(`Remesa ya existe id=${remesa.id}`);
  }

  const deudores = [
    {
      documento: '28456789',
      nombre: 'María Soledad',
      apellido: 'Gómez',
      montoTotal: 145320.5,
      fechaVencimiento: dias(-30),
      sitClave: 'SIT-020', // Promesa de pago vigente
      gesClave: 'GES-002', // Contacto con titular
      mnpClave: 'MNP-014', // Priorizó pago de otros servicios
      camposAdicionales: {
        plan: 'Personal Black',
        antiguedad_cliente: '4 años',
        ultima_factura: '2026-04-15',
      } as any,
      contactos: [
        { tipo: 'telefono', valor: '+5491133456789', prioridad: 1, validado: true, whatsapp: true },
        { tipo: 'telefono', valor: '+5491145678901', prioridad: null, validado: true, whatsapp: false },
        { tipo: 'email', valor: 'msgomez@gmail.com', prioridad: 1, validado: true, whatsapp: false },
        { tipo: 'direccion', valor: 'MUÑIZ 683, Comuna 5, Ciudad Autónoma de Buenos Aires (CP 1182)', prioridad: 1, validado: true, whatsapp: false },
      ],
      comentarios: [
        'Cliente atiende llamadas, manifiesta intención de regularizar.',
        'Promete pago para el 30/05. Quedó en avisar por WhatsApp el comprobante.',
      ],
    },
    {
      documento: '32145678',
      nombre: 'Juan Carlos',
      apellido: 'Pérez',
      montoTotal: 387900.0,
      fechaVencimiento: dias(-60),
      sitClave: 'SIT-001', // Sin contacto
      gesClave: 'GES-005', // Llamada sin respuesta
      mnpClave: null,
      camposAdicionales: {
        plan: 'Personal Flex 30GB',
        antiguedad_cliente: '7 años',
        ultima_factura: '2026-03-20',
      } as any,
      contactos: [
        { tipo: 'telefono', valor: '+5491156781234', prioridad: 1, validado: false, whatsapp: false },
        { tipo: 'email', valor: 'jcperez1980@hotmail.com', prioridad: 1, validado: false, whatsapp: false },
        { tipo: 'direccion', valor: 'AV. RIVADAVIA 5432, Caballito, Ciudad Autónoma de Buenos Aires (CP 1424)', prioridad: 1, validado: true, whatsapp: false },
      ],
      comentarios: [
        'Tres intentos de llamada sin respuesta. Casilla de voz llena.',
        'Se enviará SMS de aviso de mora.',
      ],
    },
    {
      documento: '40987654',
      nombre: 'Carla Verónica',
      apellido: 'Rodríguez',
      montoTotal: 62400.0,
      fechaVencimiento: dias(15),
      sitClave: 'SIT-030', // Convenio activo
      gesClave: 'GES-052', // Convenio solicitado
      mnpClave: 'MNP-060', // Solicita plan de pagos
      camposAdicionales: {
        plan: 'Personal Family 50GB',
        antiguedad_cliente: '2 años',
        ultima_factura: '2026-05-01',
      } as any,
      contactos: [
        { tipo: 'telefono', valor: '+5491167890123', prioridad: 1, validado: true, whatsapp: true },
        { tipo: 'email', valor: 'carla.rodriguez@outlook.com', prioridad: 1, validado: true, whatsapp: false },
        { tipo: 'direccion', valor: 'CALLE 13 NRO 1450, La Plata, Buenos Aires (CP 1900)', prioridad: 1, validado: true, whatsapp: false },
      ],
      comentarios: [
        'Acordó convenio en 3 cuotas. Primera cuota al día.',
        'Cliente colaborativo. Prefiere contacto por WhatsApp.',
      ],
    },
  ];

  // Resolver IDs de parámetros por CLAVE (robusto: los IDs son autoincrementales y varían por DB).
  const clavesNec = [
    ...new Set(deudores.flatMap((d) => [d.sitClave, d.gesClave, d.mnpClave].filter(Boolean))),
  ] as string[];
  const params = await p.parametro.findMany({
    where: { clave: { in: clavesNec } },
    select: { id: true, clave: true },
  });
  const idPorClave = new Map(params.map((x) => [x.clave, x.id]));
  const faltan = clavesNec.filter((c) => !idPorClave.has(c));
  if (faltan.length) {
    throw new Error('Faltan parámetros (corré seed-codigos-curados primero): ' + faltan.join(', '));
  }

  for (const d of deudores) {
    // El upsert por `(empresaId, documento, remesaId)` ya no existe como clave única: un mismo DNI
    // puede tener varias cuentas dentro de la misma remesa (ver `utils/identidad-deudor.ts`).
    // El seed busca por documento —que acá sí es único, son casos inventados— y decide.
    const datos = {
      nombre: d.nombre,
      apellido: d.apellido,
      montoTotal: d.montoTotal,
      fechaVencimiento: d.fechaVencimiento,
      estadoSituacionId: idPorClave.get(d.sitClave)!,
      estadoGestionId: idPorClave.get(d.gesClave)!,
      motivoNoPagoId: d.mnpClave ? idPorClave.get(d.mnpClave)! : null,
      camposAdicionales: d.camposAdicionales,
    };

    const yaEsta = await p.deudor.findFirst({
      where: { empresaId: EMPRESA_ID, remesaId: remesa.id, documento: d.documento },
      select: { id: true },
    });

    const deudor = yaEsta
      ? await p.deudor.update({ where: { id: yaEsta.id }, data: datos })
      : await p.deudor.create({
          data: {
            empresaId: EMPRESA_ID,
            remesaId: remesa.id,
            documento: d.documento,
            ...datos,
          },
        });

    for (const c of d.contactos) {
      await p.contacto.upsert({
        where: {
          deudorId_tipo_valor: {
            deudorId: deudor.id,
            tipo: c.tipo,
            valor: c.valor,
          },
        },
        create: { ...c, deudorId: deudor.id },
        update: { prioridad: c.prioridad, validado: c.validado, whatsapp: c.whatsapp },
      });
    }

    const yaTiene = await p.comentario.count({ where: { deudorId: deudor.id } });
    if (yaTiene === 0) {
      for (const texto of d.comentarios) {
        await p.comentario.create({
          data: { deudorId: deudor.id, texto },
        });
      }
    }

    console.log(`✓ Deudor ${d.apellido}, ${d.nombre} (id=${deudor.id})`);
  }

  console.log('\nListo. Ver en /deudores filtrando por empresa TELECOM.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
