/**
 * importar-ud60.ts
 *
 * Migra el índice diario de recargos por mora desde el DBF del CRM viejo del cedente
 * (`UD60.DBF`, Visual FoxPro) a las tablas `indice_mora` y `tasa_mora`.
 *
 * Fase 1 de docs/mora-aysa-spec.md. Ver §3 para por qué se importa el archivo en vez de
 * regenerarlo desde las tasas: son 25 años de cadena con correcciones incrustadas a mano, que
 * es la historia con la que el cedente liquidó de verdad.
 *
 * QUÉ HACE, EN ORDEN:
 *   1. Parsea el DBF (dBase III, sin memo).
 *   2. Descarta los registros borrados y las filas con `tipo` fuera de 1/2/3 (§3).
 *   3. Audita la cadena: huecos, duplicados y rupturas. Falla si aparece una ruptura que no
 *      está en la lista de conocidas — una ruptura nueva significa que el archivo cambió y
 *      alguien tiene que mirarlo antes de importar.
 *   4. Repara el tramo del tipo 1 que el cedente tenía roto (§8.1), reconstruyendo la cadena
 *      desde el ancla sana y replicando el redondeo del campo N(15,7) de FoxPro.
 *   5. Deriva `tasa_mora` (una fila por mes) desde las tasas del tipo 1.
 *
 * SEGURIDAD:
 *   - Por defecto corre en DRY-RUN: parsea, audita y reporta, sin tocar la base ni conectarse.
 *   - Para escribir hay que pasar --apply de forma explícita.
 *   - Es idempotente: usa upsert por (empresaId, tipo, fecha) y (empresaId, periodo).
 *
 * Uso:
 *   npx ts-node --transpile-only prisma/scripts/importar-ud60.ts --archivo ~/Descargas/UD60.DBF
 *   npx ts-node --transpile-only prisma/scripts/importar-ud60.ts --archivo ... --empresa 19 --apply
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ─── Configuración ────────────────────────────────────────────────────────────

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;

function arg(nombre: string): string | undefined {
    const i = process.argv.indexOf(`--${nombre}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const ARCHIVO = arg('archivo');
const EMPRESA_ID = arg('empresa') ? parseInt(arg('empresa')!, 10) : undefined;

/** Los únicos tipos válidos. El archivo del cedente trae basura con `tipo` vacío o 't'. */
const TIPOS_VALIDOS = ['1', '2', '3'];

/**
 * Rupturas de cadena legítimas del archivo del cedente: recargas de un mes con la tasa
 * corregida. Se migran tal cual porque son la historia real de liquidación (§3).
 * Formato: `tipo|YYYYMMDD`.
 */
const RUPTURAS_CONOCIDAS = new Set([
    '1|20201101', '1|20210801', '1|20220529',
    '2|20211001', '2|20220529',
    '3|20220325', '3|20220529',
    // El tramo roto que repara este script; después de la reparación desaparecen.
    '1|20260601', '1|20260701',
]);

/**
 * Reparación del tipo 1 (docs/mora-aysa-spec.md §8.1). El 01/06/2026 el `seek` del CRM falló,
 * `inant` volvió a 1 y la cadena arrancó de cero; julio y agosto se cargaron encima.
 */
const REPARACION = {
    tipo: '1',
    anclaFecha: '20260531',
    anclaIndice: 6597.9126017,
    meses: [
        { periodo: '202606', dias: 30, tasa: 0.02169 },
        { periodo: '202607', dias: 31, tasa: 0.02138 },
        { periodo: '202608', dias: 31, tasa: 0.02169 },
    ],
    /** Control: el índice que tiene que quedar al 31/08/2026. */
    esperadoFinal: 7044.4822042,
};

// ─── Parseo del DBF ───────────────────────────────────────────────────────────

interface FilaUd60 { tipo: string; fecha: string; tasa: number; indice: number; }

/**
 * dBase III: header de 32 bytes, descriptores de campo de 32 bytes hasta el terminador 0x0D,
 * y después los registros, cada uno con un byte de borrado al frente (0x2A = borrado).
 */
function parsearDbf(ruta: string): { vivas: FilaUd60[]; borradas: number; descartadas: number } {
    const buf = fs.readFileSync(ruta);
    const nRegistros = buf.readUInt32LE(4);
    const hdrLen = buf.readUInt16LE(8);
    const recLen = buf.readUInt16LE(10);

    const campos: { nombre: string; pos: number; largo: number }[] = [];
    let off = 32;
    let pos = 1; // el byte 0 de cada registro es la marca de borrado
    while (buf[off] !== 0x0d) {
        const nombre = buf.toString('latin1', off, off + 11).replace(/\0.*$/, '').toLowerCase();
        const largo = buf[off + 16];
        campos.push({ nombre, pos, largo });
        pos += largo;
        off += 32;
    }
    if (pos !== recLen) {
        throw new Error(`El largo de registro no cierra: campos suman ${pos}, el header dice ${recLen}`);
    }
    for (const esperado of ['tipo', 'fecha', 'tasa', 'indice']) {
        if (!campos.some((c) => c.nombre === esperado)) {
            throw new Error(`Falta el campo "${esperado}" en el DBF. Campos: ${campos.map((c) => c.nombre).join(', ')}`);
        }
    }

    const leer = (base: number, nombre: string) => {
        const c = campos.find((x) => x.nombre === nombre)!;
        return buf.toString('latin1', base + c.pos, base + c.pos + c.largo).trim();
    };

    const vivas: FilaUd60[] = [];
    let borradas = 0;
    let descartadas = 0;
    for (let r = 0; r < nRegistros; r++) {
        const base = hdrLen + r * recLen;
        if (buf[base] === 0x2a) { borradas++; continue; }
        const tipo = leer(base, 'tipo');
        const fecha = leer(base, 'fecha');
        if (!TIPOS_VALIDOS.includes(tipo) || !/^(19|20)\d{6}$/.test(fecha)) { descartadas++; continue; }
        vivas.push({ tipo, fecha, tasa: Number(leer(base, 'tasa')), indice: Number(leer(base, 'indice')) });
    }
    return { vivas, borradas, descartadas };
}

// ─── Cadena ───────────────────────────────────────────────────────────────────

/** Replica el redondeo del campo N(15,7) de FoxPro: 15 caracteres en total, punto incluido. */
function redondeoFoxpro(x: number): number {
    for (let d = 7; d >= 0; d--) {
        const s = x.toFixed(d);
        if (s.length <= 15) return Number(s);
    }
    return Number(x.toFixed(0));
}

const aFecha = (s: string) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
const aClave = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const sumarDias = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

interface Auditoria { huecos: string[]; duplicados: string[]; rupturas: string[]; }

function auditar(porTipo: Map<string, FilaUd60[]>): Auditoria {
    const huecos: string[] = [];
    const duplicados: string[] = [];
    const rupturas: string[] = [];

    for (const [tipo, filas] of porTipo) {
        const vistas = new Set<string>();
        for (const f of filas) {
            if (vistas.has(f.fecha)) duplicados.push(`${tipo}|${f.fecha}`);
            vistas.add(f.fecha);
        }
        let cur = aFecha(filas[0].fecha);
        const fin = aFecha(filas[filas.length - 1].fecha);
        while (cur <= fin) {
            if (!vistas.has(aClave(cur))) huecos.push(`${tipo}|${aClave(cur)}`);
            cur = sumarDias(cur, 1);
        }
        for (let i = 1; i < filas.length; i++) {
            const esperado = Math.pow(1 + filas[i].tasa, 1 / 30) * filas[i - 1].indice;
            const err = Math.abs(filas[i].indice - esperado) / Math.max(esperado, 1e-9);
            if (err > 1e-6) rupturas.push(`${tipo}|${filas[i].fecha}`);
        }
    }
    return { huecos, duplicados, rupturas };
}

/** Reconstruye el tramo roto del tipo 1 desde el ancla sana. Devuelve las filas corregidas. */
function repararTipo1(porTipo: Map<string, FilaUd60[]>): { filas: FilaUd60[]; final: number } {
    const filas = porTipo.get(REPARACION.tipo);
    if (!filas) throw new Error('No hay filas del tipo 1 para reparar');
    const ancla = filas.find((f) => f.fecha === REPARACION.anclaFecha);
    if (!ancla) throw new Error(`No está el ancla ${REPARACION.anclaFecha} en el archivo`);
    if (Math.abs(ancla.indice - REPARACION.anclaIndice) > 1e-6) {
        throw new Error(
            `El ancla del ${REPARACION.anclaFecha} vale ${ancla.indice} y se esperaba ` +
            `${REPARACION.anclaIndice}. La cadena está rota más atrás de lo previsto: NO importar.`,
        );
    }

    const corregidas: FilaUd60[] = [];
    let inant = ancla.indice;
    for (const mes of REPARACION.meses) {
        for (let d = 1; d <= mes.dias; d++) {
            inant = redondeoFoxpro(Math.pow(1 + mes.tasa, 1 / 30) * inant);
            corregidas.push({
                tipo: REPARACION.tipo,
                fecha: `${mes.periodo}${String(d).padStart(2, '0')}`,
                tasa: mes.tasa,
                indice: inant,
            });
        }
    }
    if (Math.abs(inant - REPARACION.esperadoFinal) > 1e-4) {
        throw new Error(`La reparación dio ${inant} y se esperaba ${REPARACION.esperadoFinal}`);
    }
    return { filas: corregidas, final: inant };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    if (!ARCHIVO) {
        console.error('Falta --archivo <ruta al UD60.DBF>');
        process.exit(1);
    }
    const ruta = ARCHIVO.replace(/^~/, process.env.HOME ?? '~');
    if (!fs.existsSync(ruta)) {
        console.error(`No existe el archivo: ${ruta}`);
        process.exit(1);
    }

    console.log('──────────────────────────────────────────────────────────────');
    console.log(`Importación de ud60 ${DRY_RUN ? '(DRY-RUN — no toca la base)' : '(APLICANDO)'}`);
    console.log(`Archivo: ${ruta}`);
    console.log('──────────────────────────────────────────────────────────────\n');

    // 1-2. Parseo y limpieza
    const { vivas, borradas, descartadas } = parsearDbf(ruta);
    console.log('Parseo:');
    console.log(`  filas útiles       : ${vivas.length}`);
    console.log(`  registros borrados : ${borradas} (descartados)`);
    console.log(`  filas con tipo o fecha inválidos: ${descartadas} (descartadas)`);

    const porTipo = new Map<string, FilaUd60[]>();
    for (const f of vivas) {
        if (!porTipo.has(f.tipo)) porTipo.set(f.tipo, []);
        porTipo.get(f.tipo)!.push(f);
    }
    for (const filas of porTipo.values()) filas.sort((a, b) => a.fecha.localeCompare(b.fecha));

    console.log('\nCobertura:');
    for (const tipo of TIPOS_VALIDOS) {
        const f = porTipo.get(tipo);
        if (!f) { console.log(`  tipo ${tipo}: SIN DATOS`); continue; }
        console.log(`  tipo ${tipo}: ${f.length} días, ${f[0].fecha} → ${f[f.length - 1].fecha}`);
    }

    // 3. Auditoría
    const aud = auditar(porTipo);
    console.log('\nAuditoría de la cadena:');
    console.log(`  huecos     : ${aud.huecos.length}`);
    console.log(`  duplicados : ${aud.duplicados.length}`);
    console.log(`  rupturas   : ${aud.rupturas.length}`);
    const inesperadas = aud.rupturas.filter((r) => !RUPTURAS_CONOCIDAS.has(r));
    if (aud.huecos.length || aud.duplicados.length || inesperadas.length) {
        console.error('\nEl archivo no pasa la auditoría:');
        if (aud.huecos.length) console.error(`  huecos: ${aud.huecos.slice(0, 10).join(', ')}${aud.huecos.length > 10 ? ' …' : ''}`);
        if (aud.duplicados.length) console.error(`  duplicados: ${aud.duplicados.slice(0, 10).join(', ')}`);
        if (inesperadas.length) console.error(`  rupturas NO conocidas: ${inesperadas.join(', ')}`);
        console.error('\nUna ruptura nueva significa que el archivo cambió. Revisar antes de importar.');
        process.exit(1);
    }
    console.log('  todas las rupturas son conocidas y documentadas ✓');

    // 4. Reparación del tipo 1
    const rep = repararTipo1(porTipo);
    const mapaCorreccion = new Map(rep.filas.map((f) => [f.fecha, f]));
    let reemplazadas = 0;
    const filasTipo1 = porTipo.get('1')!;
    for (let i = 0; i < filasTipo1.length; i++) {
        const c = mapaCorreccion.get(filasTipo1[i].fecha);
        if (c) { filasTipo1[i] = c; reemplazadas++; }
    }
    console.log(`\nReparación del tipo 1 (§8.1): ${reemplazadas} días reescritos`);
    console.log(`  ancla 31/05/2026 = ${REPARACION.anclaIndice}`);
    console.log(`  índice al 31/08/2026 = ${rep.final} (esperado ${REPARACION.esperadoFinal}) ✓`);

    // 5. Tasas mensuales, derivadas del tipo 1
    const tasas = new Map<string, number>();
    const mesesAmbiguos: string[] = [];
    for (const f of filasTipo1) {
        const periodo = f.fecha.slice(0, 6);
        const previa = tasas.get(periodo);
        if (previa != null && Math.abs(previa - f.tasa) > 1e-12 && !mesesAmbiguos.includes(periodo)) {
            mesesAmbiguos.push(periodo);
        }
        tasas.set(periodo, f.tasa); // gana el último día del mes, que es el que gobierna
    }
    console.log(`\nTasas mensuales derivadas: ${tasas.size} meses`);
    if (mesesAmbiguos.length) {
        console.log(`  ${mesesAmbiguos.length} meses con más de una tasa (recarga a mitad de mes): ${mesesAmbiguos.join(', ')}`);
        console.log('  se toma la del último día, que es la que gobierna el cierre del mes');
    }

    const totalIndices = [...porTipo.values()].reduce((a, f) => a + f.length, 0);
    console.log('\n──────────────────────────────────────────────────────────────');
    console.log(`A escribir: ${totalIndices} filas en indice_mora, ${tasas.size} en tasa_mora`);
    console.log('──────────────────────────────────────────────────────────────');

    if (DRY_RUN) {
        console.log('\nDRY-RUN: no se escribió nada.');
        console.log('Para aplicar:');
        console.log(`  npx ts-node --transpile-only prisma/scripts/importar-ud60.ts --archivo ${ARCHIVO} --empresa <id> --apply`);
        return;
    }

    if (!EMPRESA_ID) {
        console.error('\nFalta --empresa <id> para aplicar.');
        process.exit(1);
    }

    // Prisma se carga recién acá: el dry-run no necesita base y así corre offline.
    const { PrismaClient, Prisma } = await import('@prisma/client');
    const prisma = new PrismaClient();
    try {
        const empresa = await prisma.empresa.findUnique({ where: { id: EMPRESA_ID } });
        if (!empresa) throw new Error(`No existe la empresa ${EMPRESA_ID}`);
        console.log(`\nEmpresa: ${empresa.nombre} (id ${empresa.id})`);

        const t0 = Date.now();
        let escritas = 0;
        const LOTE = 1000;
        const todas = [...porTipo.entries()].flatMap(([tipo, filas]) =>
            filas.map((f) => ({
                empresaId: EMPRESA_ID,
                tipo: parseInt(tipo, 10),
                fecha: aFecha(f.fecha),
                tasa: new Prisma.Decimal(f.tasa.toFixed(8)),
                indice: new Prisma.Decimal(f.indice.toFixed(12)),
                origen: 'UD60',
            })),
        );
        for (let i = 0; i < todas.length; i += LOTE) {
            const lote = todas.slice(i, i + LOTE);
            await prisma.indice_mora.createMany({ data: lote, skipDuplicates: true });
            escritas += lote.length;
            if (i % (LOTE * 5) === 0) console.log(`  indice_mora: ${escritas}/${todas.length}`);
        }
        console.log(`  indice_mora: ${escritas}/${todas.length} ✓`);

        for (const [periodo, tasa] of tasas) {
            const clave = `${periodo.slice(0, 4)}-${periodo.slice(4, 6)}`;
            await prisma.tasa_mora.upsert({
                where: { empresaId_periodo: { empresaId: EMPRESA_ID, periodo: clave } },
                create: {
                    empresaId: EMPRESA_ID,
                    periodo: clave,
                    tasaBase: new Prisma.Decimal((tasa * 100).toFixed(6)),
                    fuente: 'MIGRACION_UD60',
                },
                update: {},   // no pisar una tasa ya corregida a mano
            });
        }
        console.log(`  tasa_mora: ${tasas.size} meses ✓`);
        console.log(`\nListo en ${Date.now() - t0}ms.`);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error('\nERROR:', e.message);
    process.exit(1);
});
