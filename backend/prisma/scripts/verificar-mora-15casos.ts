/**
 * verificar-mora-15casos.ts
 *
 * Prueba de aceptación de la fase 1 de docs/mora-aysa-spec.md.
 *
 * Calcula la deuda actualizada de los 15 casos que mandó el cedente **en SQL, con un JOIN contra
 * `indice_mora`** —que es como lo va a hacer el `MoraService`— y la compara contra el `deuact` real.
 * Verifica de una sola pasada tres cosas: que el índice se migró bien, que el schema sirve para el
 * cálculo, y que la fórmula de §1 es la correcta.
 *
 * Las facturas van embebidas a propósito: son el dato que mandó el cedente junto con su `deuact`, y
 * así la prueba corre contra cualquier base que tenga el índice importado, tenga o no esa cartera
 * cargada.
 *
 * Uso:
 *   npx ts-node --transpile-only prisma/scripts/verificar-mora-15casos.ts [--empresa 19] [--fecha 2026-08-20]
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const prisma = new PrismaClient();

function arg(n: string, def: string): string {
    const i = process.argv.indexOf(`--${n}`);
    return i >= 0 ? process.argv[i + 1] : def;
}
const EMPRESA_ID = parseInt(arg('empresa', '19'), 10);
const FECHA = arg('fecha', '2026-08-20');

interface Caso { nombre: string; deuact: number; facturas: [number, string][] }

/** Los 15 casos: importe y vencimiento de cada partida, más el `deuact` que informó el cedente. */
const CASOS: Caso[] = [
    { nombre: 'BURGOS', deuact: 178168.37, facturas: [[21323.69, '2025-09-01'], [21709.37, '2025-10-01'], [21745.11, '2025-11-03'], [25961.29, '2026-05-04'], [28114.80, '2026-07-01']] },
    { nombre: 'GOMEZ', deuact: 137776.18, facturas: [[15387.03, '2025-03-21'], [15307.24, '2025-04-21'], [16548.11, '2025-12-19'], [17135.77, '2026-02-20'], [17821.20, '2026-03-20']] },
    { nombre: 'CASARES', deuact: 33931.16, facturas: [[7466.80, '2026-01-09'], [8616.57, '2026-04-17'], [9299.71, '2026-06-12']] },
    { nombre: 'RUEDA', deuact: 249093.26, facturas: [[3087.58, '2024-06-10'], [12717.81, '2024-07-10'], [14877.83, '2024-08-12'], [15046.09, '2024-09-09'], [14936.87, '2024-10-08'], [16865.55, '2024-12-09'], [17179.85, '2025-01-09']] },
    { nombre: 'SIMON', deuact: 173536.03, facturas: [[20349.94, '2025-05-08'], [23870.34, '2025-06-12'], [26431.54, '2025-10-09'], [26953.83, '2025-12-12']] },
    { nombre: 'GALEFFI', deuact: 52977.20, facturas: [[35263.67, '2025-12-17']] },
    { nombre: 'PALOMO', deuact: 107123.31, facturas: [[3398.93, '2024-05-06'], [10502.71, '2024-06-03'], [10502.71, '2024-07-01'], [11539.35, '2024-08-06']] },
    { nombre: 'FORMIGLIETTI', deuact: 141558.48, facturas: [[70322.32, '2025-05-23']] },
    { nombre: 'CAAMAÑO', deuact: 181980.30, facturas: [[3138.72, '2024-02-16'], [3138.72, '2024-04-19'], [9698.63, '2024-05-17'], [11826.94, '2024-08-16'], [13549.98, '2024-11-14'], [13543.06, '2024-12-13'], [14008.82, '2025-05-09']] },
    { nombre: 'GUIDI', deuact: 158084.39, facturas: [[17475.99, '2025-12-24'], [17644.90, '2026-01-21'], [19527.94, '2026-03-26'], [20616.93, '2026-04-29'], [20918.31, '2026-05-28'], [21660.26, '2026-06-24']] },
    { nombre: 'GOGMAN', deuact: 36801.30, facturas: [[24273.87, '2025-12-09']] },
    { nombre: 'MORONTA', deuact: 171201.10, facturas: [[14955.15, '2024-11-07'], [16087.90, '2025-01-08'], [16375.67, '2025-04-30'], [16455.63, '2025-06-06'], [16844.11, '2025-09-05']] },
    { nombre: 'BRITOS', deuact: 253316.37, facturas: [[3692.61, '2024-02-08'], [3692.61, '2024-03-08'], [3692.61, '2024-04-12'], [11410.16, '2024-05-10'], [11410.16, '2024-06-07'], [12780.72, '2024-08-09'], [13994.96, '2024-09-06'], [15707.18, '2024-12-06'], [17177.02, '2025-11-07']] },
    { nombre: 'PAZ', deuact: 234073.94, facturas: [[15655.12, '2025-05-29'], [16484.97, '2025-06-26'], [16644.33, '2025-07-24'], [16805.20, '2025-08-28'], [16973.24, '2025-09-26'], [11794.63, '2025-12-26'], [11794.63, '2026-01-22'], [11794.63, '2026-03-27'], [11794.63, '2026-04-30'], [11794.63, '2026-06-25']] },
    { nombre: 'RIZZO', deuact: 35840.20, facturas: [[4032.70, '2025-10-09'], [23176.91, '2026-06-11']] },
];

async function main() {
    // El cálculo tal cual va a vivir en el MoraService: un JOIN al índice por el vencimiento de la
    // factura y otro por la fecha de cálculo. Cada concepto se redondea a 2 decimales POR FACTURA,
    // que es como lo hace AYSA (docs/mora-aysa-spec.md §1).
    const filas: { caso: string; cap: number; vto: string }[] = [];
    for (const c of CASOS) for (const [imp, vto] of c.facturas) filas.push({ caso: c.nombre, cap: imp, vto });

    const valores = filas.map(() => '(?,?,?)').join(',');
    const params: unknown[] = [];
    for (const f of filas) params.push(f.caso, f.cap, f.vto);

    const res = await prisma.$queryRawUnsafe<{ caso: string; facturas: bigint; total: number }[]>(
        `
        WITH partidas (caso, cap, vto) AS ( VALUES ${valores.replace(/\(\?,\?,\?\)/g, 'ROW(?,?,?)')} ),
        base AS (
            SELECT p.caso, p.cap,
                   ROUND(CAST(p.cap AS DECIMAL(20, 2)) * (ih.indice / iv.indice - 1 + 0.05), 2) AS intrec
            FROM partidas p
            JOIN indice_mora iv ON iv.empresaId = ? AND iv.tipo = 1 AND iv.fecha = p.vto
            JOIN indice_mora ih ON ih.empresaId = ? AND ih.tipo = 1 AND ih.fecha = ?
        ),
        conceptos AS (
            SELECT caso, cap, intrec, ROUND(0.10 * (cap + intrec), 2) AS recajej FROM base
        )
        SELECT caso,
               COUNT(*) AS facturas,
               ROUND(SUM(cap + intrec + recajej + ROUND(0.21 * (intrec + recajej), 2)), 2) AS total
        FROM conceptos
        GROUP BY caso
        `,
        ...params, EMPRESA_ID, EMPRESA_ID, FECHA,
    );

    console.log('──────────────────────────────────────────────────────────────────────');
    console.log(`Deuda actualizada al ${FECHA} — calculada en SQL contra indice_mora (empresa ${EMPRESA_ID})`);
    console.log('──────────────────────────────────────────────────────────────────────');
    console.log('caso            fact       calculado           deuact        dif');

    const porCaso = new Map(res.map((r) => [r.caso, r]));
    let exactos = 0, peor = 0;
    for (const c of CASOS) {
        const r = porCaso.get(c.nombre);
        if (!r) { console.log(`${c.nombre.padEnd(14)}  — sin índice para alguno de sus vencimientos`); continue; }
        const calc = Number(r.total);
        const dif = Math.round((calc - c.deuact) * 100) / 100;
        if (Math.abs(dif) <= 0.05) exactos++;
        peor = Math.max(peor, Math.abs(dif));
        console.log(
            `${c.nombre.padEnd(14)}  ${String(Number(r.facturas)).padStart(3)}  ${calc.toFixed(2).padStart(14)}  ` +
            `${c.deuact.toFixed(2).padStart(14)}  ${dif.toFixed(2).padStart(8)}  ${Math.abs(dif) <= 0.05 ? '✓' : '✗'}`,
        );
    }
    console.log('──────────────────────────────────────────────────────────────────────');
    console.log(`${exactos}/${CASOS.length} exactos al centavo. Peor diferencia: $${peor.toFixed(2)}`);
    if (exactos !== CASOS.length) process.exitCode = 1;
}

main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
