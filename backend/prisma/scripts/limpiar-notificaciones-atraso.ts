/**
 * Limpieza única del atraso de notificaciones (docs/imports-progreso-realtime-spec.md §11.5, decisión D1).
 *
 * Qué hace, cada paso solo si se lo pide:
 *   --marcar-ajenas    marca como leídas las notificaciones de resultado de carga (IMPORTACION_FINALIZADA /
 *                      IMPORTACION_ERROR) sin leer de una carga de OTRA persona: las copias por permiso que se
 *                      acumularon antes de que las copias dejaran de molestar. Nunca toca las propias, las de
 *                      una reversión de acción masiva ni las posteriores a --hasta.
 *   --borrar-huerfanas borra las notificaciones de REMESA cuya remesa ya no existe, o es posterior a la
 *                      notificación (la remesa reusó el id después de un TRUNCATE).
 *
 * Sin ninguno de los dos pasos NO escribe nada: solo muestra el preview. `--dry-run` gana sobre los pasos.
 * `--hasta=<ISO UTC>` vale para los DOS pasos: no se toca nada creado desde ese instante. En prod, al aplicar, pasar la
 * hora del deploy de la Fase D, para no marcar copias que llegaron después (esas ya llegaron sin aviso).
 * No borra las remesas 93 y 98: solo informa su estado (se borran desde el Historial, con Eliminar).
 * No emite sockets (es otro proceso): las pestañas abiertas corrigen el globito al recargar o reconectar.
 * Es idempotente: aplicado, el preview siguiente da 0 y 0. Nunca imprime el payload.
 *
 * Uso (desde backend/):
 *   npx ts-node --transpile-only prisma/scripts/limpiar-notificaciones-atraso.ts                  # preview
 *   npx ts-node --transpile-only prisma/scripts/limpiar-notificaciones-atraso.ts --dry-run        # ídem
 *   npx ts-node --transpile-only prisma/scripts/limpiar-notificaciones-atraso.ts --marcar-ajenas --borrar-huerfanas [--hasta=2026-10-17T03:00:00Z]
 */
import { PrismaClient } from '@prisma/client';

const DIA_MS = 24 * 60 * 60 * 1000;
const PAGINA = 5000;
const TANDA_REMESAS = 1000;
const TANDA_ESCRITURA = 500;
const REMESAS_A_INFORMAR = [93, 98];
const TIPOS_RESULTADO = ['IMPORTACION_FINALIZADA', 'IMPORTACION_ERROR'];

const args = process.argv.slice(2);
const CONOCIDOS = ['--dry-run', '--marcar-ajenas', '--borrar-huerfanas'];
const desconocidos = args.filter((a) => !CONOCIDOS.includes(a) && !a.startsWith('--hasta='));
const DRY_RUN = args.includes('--dry-run');
const MARCAR = args.includes('--marcar-ajenas') && !DRY_RUN;
const BORRAR = args.includes('--borrar-huerfanas') && !DRY_RUN;
const hastaArg = args.find((a) => a.startsWith('--hasta='))?.slice('--hasta='.length);

function diasDeEnv(nombre: string, porDefecto: number): number {
    const raw = process.env[nombre];
    if (raw === undefined) return porDefecto;
    const n = raw.trim() === '' ? NaN : Number(raw);
    return Number.isInteger(n) && n >= 1 ? n : porDefecto;
}

interface Fila {
    id: number;
    usuarioId: number;
    tipo: string;
    leida: boolean;
    creadoEn: Date;
    entidadId: number | null;
    payload: unknown;
}

function esReversion(payload: unknown): boolean {
    return typeof payload === 'object' && payload !== null && !Array.isArray(payload) && 'reversion' in payload;
}

function trozos<T>(xs: T[], n: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
    return out;
}

async function main() {
    if (desconocidos.length > 0) {
        console.error(`Argumentos desconocidos: ${desconocidos.join(' ')}`);
        process.exit(1);
    }
    const ahora = new Date();
    let hasta = ahora;
    if (hastaArg !== undefined) {
        hasta = new Date(hastaArg);
        if (Number.isNaN(hasta.getTime())) {
            console.error(`--hasta="${hastaArg}" no es una fecha válida (ej. 2026-10-17T03:00:00Z)`);
            process.exit(1);
        }
    }
    const prisma = new PrismaClient();

    try {
        const modo = DRY_RUN ? 'dry-run' : MARCAR || BORRAR ? 'APLICAR' : 'preview';
        console.log(`Limpieza del atraso de notificaciones — modo: ${modo}; hasta: ${hasta.toISOString()}`);

        // 1. Todas las notificaciones de REMESA, paginadas por id.
        const filas: Fila[] = [];
        let cursor = 0;
        for (;;) {
            const pagina = await prisma.notificacion.findMany({
                where: { entidadTipo: 'REMESA', id: { gt: cursor } },
                orderBy: { id: 'asc' },
                take: PAGINA,
                select: { id: true, usuarioId: true, tipo: true, leida: true, creadoEn: true, entidadId: true, payload: true },
            });
            if (pagina.length === 0) break;
            filas.push(...pagina);
            cursor = pagina[pagina.length - 1].id;
            if (pagina.length < PAGINA) break;
        }

        // 2. Las remesas a las que apuntan.
        const idsRemesa = [...new Set(filas.map((f) => f.entidadId).filter((x): x is number => x !== null))];
        const remesas = new Map<number, { usuarioCreadorId: number | null; createdAt: Date }>();
        for (const t of trozos(idsRemesa, TANDA_REMESAS)) {
            const rs = await prisma.remesa.findMany({
                where: { id: { in: t } },
                select: { id: true, usuarioCreadorId: true, createdAt: true },
            });
            for (const r of rs) remesas.set(r.id, { usuarioCreadorId: r.usuarioCreadorId, createdAt: r.createdAt });
        }

        // 3. Clasificación.
        const huerfanas: Fila[] = [];
        let huerfanasPorIdReusado = 0;
        const ajenas: Fila[] = [];
        let duenoDesconocido = 0;
        for (const f of filas) {
            if (f.creadoEn.getTime() >= hasta.getTime()) continue;
            const r = f.entidadId === null ? undefined : remesas.get(f.entidadId);
            if (!r) {
                huerfanas.push(f);
                continue;
            }
            if (f.creadoEn.getTime() < r.createdAt.getTime()) {
                huerfanas.push(f);
                huerfanasPorIdReusado++;
                continue;
            }
            if (f.leida || !TIPOS_RESULTADO.includes(f.tipo) || esReversion(f.payload)) continue;
            if (r.usuarioCreadorId === null) {
                duenoDesconocido++;
                continue;
            }
            if (r.usuarioCreadorId !== f.usuarioId) ajenas.push(f);
        }

        // 4. Sin leer de TODOS los usuarios (cualquier entidad) y lo que borraría el cron, como si ya se hubiera aplicado.
        const sinLeerHoy = new Map<number, number>();
        for (const g of await prisma.notificacion.groupBy({ by: ['usuarioId'], where: { leida: false }, _count: { _all: true } })) {
            sinLeerHoy.set(g.usuarioId, g._count._all);
        }
        const totalFilas = await prisma.notificacion.count();

        const limiteLeidas = new Date(ahora.getTime() - diasDeEnv('NOTIFICACIONES_RETENCION_LEIDAS_DIAS', 30) * DIA_MS);
        const limiteNoLeidas = new Date(ahora.getTime() - diasDeEnv('NOTIFICACIONES_RETENCION_NO_LEIDAS_DIAS', 180) * DIA_MS);
        const diasL = diasDeEnv('NOTIFICACIONES_RETENCION_LEIDAS_DIAS', 30);
        const diasN = diasDeEnv('NOTIFICACIONES_RETENCION_NO_LEIDAS_DIAS', 180);
        const marcadas = new Set(ajenas.map((f) => f.id));
        const borradas = new Set(huerfanas.map((f) => f.id));
        let cronLeidas = 0;
        let cronNoLeidas = 0;
        cursor = 0;
        for (;;) {
            const pagina = await prisma.notificacion.findMany({
                where: {
                    id: { gt: cursor },
                    OR: [
                        { leida: true, leidaEn: { lt: limiteLeidas } },
                        { leida: true, leidaEn: null, creadoEn: { lt: limiteLeidas } },
                        { leida: false, creadoEn: { lt: limiteNoLeidas } },
                    ],
                },
                orderBy: { id: 'asc' },
                take: PAGINA,
                select: { id: true, leida: true },
            });
            if (pagina.length === 0) break;
            for (const n of pagina) {
                if (borradas.has(n.id) || marcadas.has(n.id)) continue; // ya no sería suya (borrada, o marcada hoy)
                if (n.leida) cronLeidas++;
                else cronNoLeidas++;
            }
            cursor = pagina[pagina.length - 1].id;
            if (pagina.length < PAGINA) break;
        }

        // 5. Preview por usuario.
        const ajenasPorUsuario = new Map<number, number>();
        for (const f of ajenas) ajenasPorUsuario.set(f.usuarioId, (ajenasPorUsuario.get(f.usuarioId) ?? 0) + 1);
        const huerfanasPorUsuario = new Map<number, { total: number; sinLeer: number }>();
        for (const f of huerfanas) {
            const h = huerfanasPorUsuario.get(f.usuarioId) ?? { total: 0, sinLeer: 0 };
            h.total++;
            if (!f.leida) h.sinLeer++;
            huerfanasPorUsuario.set(f.usuarioId, h);
        }
        const idsUsuario = [...new Set([...sinLeerHoy.keys(), ...ajenasPorUsuario.keys(), ...huerfanasPorUsuario.keys()])].sort((a, b) => a - b);
        const usuarios = await prisma.usuario.findMany({ where: { id: { in: idsUsuario } }, select: { id: true, nombre: true } });
        const nombre = new Map(usuarios.map((u) => [u.id, u.nombre]));

        console.log('\nPor usuario:');
        console.log('usuario'.padEnd(34) + 'sin leer hoy'.padStart(13) + 'ajenas a marcar'.padStart(17) + 'huérfanas a borrar'.padStart(20) + '(sin leer)'.padStart(11) + 'sin leer después'.padStart(18));
        let tSin = 0, tAj = 0, tHu = 0, tHuSin = 0, tDesp = 0;
        for (const id of idsUsuario) {
            const hoy = sinLeerHoy.get(id) ?? 0;
            const aj = ajenasPorUsuario.get(id) ?? 0;
            const hu = huerfanasPorUsuario.get(id) ?? { total: 0, sinLeer: 0 };
            const despues = hoy - aj - hu.sinLeer;
            tSin += hoy; tAj += aj; tHu += hu.total; tHuSin += hu.sinLeer; tDesp += despues;
            console.log(
                `${id} ${nombre.get(id) ?? '(sin nombre)'}`.slice(0, 33).padEnd(34) +
                    String(hoy).padStart(13) + String(aj).padStart(17) + String(hu.total).padStart(20) +
                    String(hu.sinLeer).padStart(11) + String(despues).padStart(18),
            );
        }
        console.log(
            'TOTAL'.padEnd(34) + String(tSin).padStart(13) + String(tAj).padStart(17) + String(tHu).padStart(20) +
                String(tHuSin).padStart(11) + String(tDesp).padStart(18),
        );
        console.log(`\nFilas de notificacion en total: ${totalFilas} (de REMESA: ${filas.length})`);
        console.log(`Huérfanas: ${huerfanas.length} (de ellas ${huerfanasPorIdReusado} apuntan a una remesa que reusó el id)`);
        console.log(`Sin dueño conocido (remesa sin usuarioCreadorId), solo informadas: ${duenoDesconocido}`);
        console.log(
            `La primera limpieza nocturna borraría: ${cronLeidas} leídas de más de ${diasL} días y ${cronNoLeidas} sin leer de más de ${diasN}` +
                ' (calculado como si ya se hubiera aplicado el paso de marcar)',
        );

        console.log('\nRemesas a borrar desde el Historial (este script no las borra):');
        for (const id of REMESAS_A_INFORMAR) {
            const r = await prisma.remesa.findUnique({
                where: { id },
                select: { id: true, estadoProceso: true, progreso: { select: { remesaId: true } } },
            });
            if (!r) {
                console.log(`  remesa ${id}: no existe`);
                continue;
            }
            const casos = await prisma.deudor.count({ where: { remesaId: id } });
            const notifs = await prisma.notificacion.count({ where: { entidadTipo: 'REMESA', entidadId: id } });
            console.log(`  remesa ${id}: estadoProceso=${r.estadoProceso}, ${r.progreso ? 'con' : 'sin'} fila de progreso, ${casos} casos, ${notifs} notificaciones`);
        }

        // 6. Escritura.
        if (!MARCAR && !BORRAR) {
            console.log(
                DRY_RUN
                    ? '\n--dry-run: no se escribió nada.'
                    : '\nPreview: no se escribió nada. Para aplicar: --marcar-ajenas y/o --borrar-huerfanas.',
            );
            return;
        }
        let marcadasN = 0;
        let borradasN = 0;
        if (MARCAR) {
            for (const t of trozos(ajenas, TANDA_ESCRITURA)) {
                const r = await prisma.notificacion.updateMany({
                    where: { id: { in: t.map((f) => f.id) }, leida: false },
                    data: { leida: true, leidaEn: new Date() },
                });
                marcadasN += r.count;
            }
        }
        if (BORRAR) {
            for (const t of trozos(huerfanas, TANDA_ESCRITURA)) {
                const r = await prisma.notificacion.deleteMany({
                    where: { id: { in: t.map((f) => f.id) }, entidadTipo: 'REMESA' },
                });
                borradasN += r.count;
            }
        }
        console.log(`\nAplicado: ${marcadasN} ajenas marcadas como leídas, ${borradasN} huérfanas borradas.`);
        console.log('Las pestañas abiertas corrigen el globito al recargar. Volvé a correr el preview: tiene que dar 0 y 0.');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
