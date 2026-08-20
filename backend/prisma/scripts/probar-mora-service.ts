/**
 * probar-mora-service.ts
 *
 * Ejercita el MoraService contra la base real: cálculo por deudor, recálculo masivo y
 * generación de un mes nuevo. No es un test unitario (para eso está mora.service.spec.ts):
 * es la corrida de humo sobre la cartera completa, para ver números y tiempos de verdad.
 *
 * Por defecto NO escribe: el recálculo masivo corre en dry-run salvo que se pase --apply, igual que
 * el resto de los scripts de esta carpeta.
 *
 * Uso:
 *   npx ts-node --transpile-only prisma/scripts/probar-mora-service.ts --empresa 40
 *   npx ts-node --transpile-only prisma/scripts/probar-mora-service.ts --empresa 40 --apply
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { MoraService } from '../../src/modules/mora/mora.service';
import { PrismaService } from '../../src/prisma/prisma.service';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function arg(n: string, def: string): string {
    const i = process.argv.indexOf(`--${n}`);
    return i >= 0 ? process.argv[i + 1] : def;
}
const EMPRESA_ID = parseInt(arg('empresa', '40'), 10);
const APPLY = process.argv.includes('--apply');
const FECHA = new Date(`${arg('fecha', '2026-08-20')}T00:00:00.000Z`);

async function main() {
    const prisma = new PrismaService();
    await prisma.$connect();
    const mora = new MoraService(prisma as unknown as PrismaService);

    console.log('=== 1. Configuración del régimen ===');
    console.log('  ', JSON.stringify(await mora.obtenerConfig(EMPRESA_ID)));

    console.log('\n=== 2. Estado de tasas (últimos 6 meses) ===');
    for (const e of await mora.estadoTasas(EMPRESA_ID, 6)) {
        console.log(`   ${e.periodo}  tasa=${e.tasaBase}  fuente=${e.fuente}  dias=${e.diasIndice}  ${e.completo ? 'completo' : 'INCOMPLETO'}`);
    }

    console.log('\n=== 3. Meses faltantes ===');
    const faltantes = await mora.mesesFaltantes(EMPRESA_ID);
    console.log(`   ${faltantes.length} faltantes${faltantes.length ? ': ' + faltantes.slice(0, 12).join(', ') : ''}`);

    console.log('\n=== 4. Cálculo por deudor (3 casos con facturas) ===');
    const casos = await prisma.deudor.findMany({
        where: { empresaId: EMPRESA_ID, facturas: { some: {} } },
        select: { id: true, nroCliente: true, nombre: true, montoTotal: true },
        take: 3,
        orderBy: { id: 'asc' },
    });
    for (const c of casos) {
        const r = await mora.calcularDeudor(c.id, FECHA);
        console.log(`   ${c.nroCliente} ${String(c.nombre).slice(0, 20).padEnd(20)} ${r.facturas.length} fact`);
        console.log(`     capital=${r.capital.toFixed(2)}  intRec=${r.intRec.toFixed(2)}  recAjEj=${r.recAjEj.toFixed(2)}  iva=${r.iva.toFixed(2)}`);
        console.log(`     recargo=${r.recargo.toFixed(2)}  TOTAL=${r.total.toFixed(2)}  (montoTotal=${c.montoTotal})`);
        if (r.advertencias.length) console.log(`     advertencias: ${r.advertencias.join(' | ')}`);
        const f = r.facturas[0];
        console.log(`     primera factura: vto=${f.vencimiento} ${f.diasMora}d coef=${f.coeficiente.toFixed(6)} total=${f.total.toFixed(2)}${f.nota ? ' [' + f.nota + ']' : ''}`);
    }

    console.log('\n=== 5. Recálculo masivo (dry-run) ===');
    console.log('  ', JSON.stringify(await mora.recalcularCartera(EMPRESA_ID, { fecha: FECHA, dryRun: true })));

    if (!APPLY) {
        console.log('\n=== 6. Recálculo masivo: OMITIDO (falta --apply) ===');
        console.log('   Los pasos 7 y 8 necesitan que el recargo esté persistido.');
        await prisma.$disconnect();
        return;
    }
    console.log('\n=== 6. Recálculo masivo (aplicando) ===');
    const res = await mora.recalcularCartera(EMPRESA_ID, { fecha: FECHA });
    console.log('  ', JSON.stringify(res));

    console.log('\n=== 7. Control: el SQL masivo y el cálculo al vuelo tienen que dar IGUAL ===');
    const muestra = await prisma.deudor.findMany({
        where: { empresaId: EMPRESA_ID, facturas: { some: {} } },
        select: { id: true, nroCliente: true, recargoMora: true },
        take: 300,
        orderBy: { id: 'asc' },
    });
    let iguales = 0;
    const desvios: string[] = [];
    for (const d of muestra) {
        const r = await mora.calcularDeudor(d.id, FECHA);
        const dif = Math.round(((d.recargoMora ?? 0) - r.recargo) * 100) / 100;
        if (dif === 0) iguales++;
        else desvios.push(`${d.nroCliente} persistido=${d.recargoMora?.toFixed(2)} al vuelo=${r.recargo.toFixed(2)} dif=${dif.toFixed(2)}`);
    }
    console.log(`   ${iguales}/${muestra.length} idénticos al centavo`);
    if (desvios.length) desvios.slice(0, 8).forEach((x) => console.log(`   DESVÍO ${x}`));

    console.log('\n=== 8. Totales de la cartera ===');
    const agg = await prisma.deudor.aggregate({
        where: { empresaId: EMPRESA_ID },
        _sum: { montoTotal: true, recargoMora: true },
        _count: true,
    });
    const cap = agg._sum.montoTotal ?? 0;
    const rec = agg._sum.recargoMora ?? 0;
    console.log(`   ${agg._count} casos · capital ${cap.toFixed(2)} · recargo ${rec.toFixed(2)} · actualizada ${(cap + rec).toFixed(2)} (x${(1 + rec / cap).toFixed(4)})`);

    await prisma.$disconnect();
}

main().catch(async (e) => {
    console.error('ERROR:', e.message);
    await new PrismaClient().$disconnect();
    process.exit(1);
});
