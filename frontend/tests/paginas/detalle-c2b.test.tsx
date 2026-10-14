// C2b: el detalle con la etiqueta única y la tarjeta de progreso (TD-1 a TD-4, docs/imports-progreso-c2-spec.md §16.5 y §16.6).
import { afterEach, describe, expect, it } from 'vitest';
import { armarDetalle, type BancoDetalle } from '../lib/banco-detalle';
import { BASURA, canceladaC1, dtoC1, enColaC1, errorDeCarga, terminalC1 } from '../lib/fabricas';
import { chips, esperar, pasar } from '../lib/montar';

let b: BancoDetalle | null = null;
afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });
const cerrar = async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; };

describe('TD-1 — el chip grande dice lo mismo que el Historial (D1)', () => {
    const casos: Array<[string, Parameters<typeof terminalC1>[1] | null, 'terminal' | 'cancelada' | 'cola', string]> = [
        ['una con errores y filas cargadas', { remesaId: 141, ok: 5, err: 2, procesadas: 7 }, 'terminal', 'Finalizada con errores'],
        ['una cancelada', null, 'cancelada', 'Cancelada'],
        ['una en cola', null, 'cola', 'En cola'],
    ];
    for (const [nombre, over, tipo, etiqueta] of casos) {
        it(nombre, async () => {
            const dto = tipo === 'cancelada' ? canceladaC1({ remesaId: 141 }) : tipo === 'cola' ? enColaC1({ remesaId: 141 }) : terminalC1('CON_ERRORES', over ?? {});
            b = await armarDetalle(dto);
            expect(chips(b.v.contenedor)).not.toContain('FINALIZADA');
            const chipGrande = Array.from(b.v.contenedor.querySelectorAll('.MuiChip-label')).map((c) => c.textContent);
            expect(chipGrande).toContain(etiqueta);
            expect(b.texto()).not.toMatch(BASURA);
        });
    }

    it('una remesa heredada (sin `carga`) sigue mostrando el `estadoProceso` de la remesa', async () => {
        b = await armarDetalle(terminalC1('OK', { remesaId: 141 }), { remesa: { carga: null, estadoProceso: 'FINALIZADA' }, antes: (x) => { x.progreso = () => ({ status: 404, body: { message: 'No existe' } }); } });
        await pasar(300);
        expect(chips(b.v.contenedor)).toContain('FINALIZADA');
    });
});

describe('TD-2 — los chips de las hermanas con la etiqueta única', () => {
    it('«#3082 · Fallida», «#3083 · Finalizada con errores»; nunca «Falló»', async () => {
        const g = { grupoId: 'g1', grupoTotal: 3 };
        const propia = dtoC1({ remesaId: 141, numeroRemesa: '3081', grupoOrden: 1, ...g, progreso: 43 });
        const otras = [
            terminalC1('FALLIDA', { remesaId: 142, numeroRemesa: '3082', grupoOrden: 2, ...g, error: 'x' }),
            terminalC1('CON_ERRORES', { remesaId: 143, numeroRemesa: '3083', grupoOrden: 3, ...g, ok: 5, err: 2, procesadas: 7 }),
        ];
        b = await armarDetalle(propia, { otras });
        await esperar(() => /#3082/.test(b!.texto()), { que: 'los chips de las hermanas' });
        const t = b.texto();
        expect(t).toContain('#3082 · Fallida');
        expect(t).toContain('#3083 · Finalizada con errores');
        expect(t).not.toContain('Falló');
    });
});

describe('TD-3 — en curso: la tarjeta de detalle', () => {
    it('con pasos, la barra, los últimos 5 errores; la tabla de errores de abajo sigue igual', async () => {
        const items = [5, 4, 3, 2, 1].map((n) => errorDeCarga({ id: n, fila: n * 100, errorMsg: `Falla ${n}` }));
        b = await armarDetalle(dtoC1({ progreso: 43, err: 12, advertencias: 1 }), {
            antes: (x) => {
                x.srv.en('GET', /^\/import\/errores\/(\d+)$/, (_m, p) => ({
                    body: { data: /orden=desc/.test(p.ruta) ? items : [errorDeCarga({ id: 9, errorMsg: 'De la tabla' })], total: 12, page: 1, pageSize: 5, totalPages: 3, totales: { filas: 12, avisos: 1 } },
                }));
            },
        });
        await esperar(() => /Últimos errores y avisos/.test(b!.texto()), { que: 'los últimos errores' });
        const t = b.texto();
        expect(b.v.contenedor.querySelectorAll('.MuiStepper-root .MuiStep-root')).toHaveLength(4);
        expect(t).toContain('Procesando · 43% completado');
        for (const n of [5, 4, 3, 2, 1]) expect(t).toContain(`Fila ${n * 100} · Falla ${n}`);
        expect(t).toContain('En total: 12 errores de fila y 1 aviso');
        await esperar(() => /De la tabla/.test(b!.texto()), { que: 'la tabla de errores de siempre' });
        const asc = b.srv.de('GET', /^\/import\/errores\/141\?/).filter((p) => /orden=asc/.test(p.ruta));
        const desc = b.srv.de('GET', /^\/import\/errores\/141\?/).filter((p) => /orden=desc&page=1&pageSize=5/.test(p.ruta));
        expect(asc.length).toBeGreaterThanOrEqual(1);
        expect(desc.length).toBeGreaterThanOrEqual(1);
    });

    it('en una división, la barra del grupo (y no una fila por remesa)', async () => {
        const g = { grupoId: 'g1', grupoTotal: 3 };
        const propia = dtoC1({ remesaId: 141, numeroRemesa: '3081', grupoOrden: 1, ...g });
        const otras = [terminalC1('OK', { remesaId: 142, numeroRemesa: '3082', grupoOrden: 2, ...g }), enColaC1({ remesaId: 143, numeroRemesa: '3083', grupoOrden: 3, ...g })];
        b = await armarDetalle(propia, { otras });
        await esperar(() => /Remesas terminadas: 1 de 3/.test(b!.texto()), { que: 'la barra del grupo' });
        expect(b.v.contenedor.querySelector('[aria-label="Remesa 3082"]')).toBeNull();
    });

    it('terminada: no hay tarjeta de progreso', async () => {
        b = await armarDetalle(terminalC1('OK', { remesaId: 141 }));
        expect(b.v.contenedor.querySelector('.MuiStepper-root')).toBeNull();
    });
});

describe('TD-4 — los avisos de una terminada reiniciada siguen apareciendo', () => {
    it('con `intentos > 1` y terminada: «Esta carga se reinició (intento 2).»', async () => {
        b = await armarDetalle(terminalC1('OK', { remesaId: 141, intentos: 2 }));
        expect(b.texto()).toContain('Esta carga se reinició (intento 2).');
        await cerrar();
        b = await armarDetalle(terminalC1('OK', { remesaId: 141, intentos: 1 }));
        expect(b.texto()).not.toContain('Esta carga se reinició');
    });
});

describe('TD-5 — mientras esta remesa corre, la división se sigue en vivo (auditoría de C2b)', () => {
    it('terminan las dos de adelante: la barra dice «2 de 3» y los chips se ponen al día sin recargar', async () => {
        const g = { grupoId: 'g1', grupoTotal: 3 };
        const r1 = dtoC1({ remesaId: 141, numeroRemesa: '3081', grupoOrden: 1, ...g, progreso: 43, rev: 5 });
        const r2 = enColaC1({ remesaId: 142, numeroRemesa: '3082', grupoOrden: 2, ...g, rev: 1 });
        const propia = enColaC1({ remesaId: 143, numeroRemesa: '3083', grupoOrden: 3, ...g, rev: 1 });
        b = await armarDetalle(propia, { otras: [r1, r2] });
        await esperar(() => /Remesas terminadas: 0 de 3/.test(b!.texto()), { que: 'la barra al abrir' });
        b.pub('import:finalizada', terminalC1('OK', { remesaId: 141, numeroRemesa: '3081', grupoOrden: 1, ...g, rev: 9 }));
        b.pub('import:finalizada', terminalC1('OK', { remesaId: 142, numeroRemesa: '3082', grupoOrden: 2, ...g, rev: 9 }));
        b.pub('import:progreso', dtoC1({ remesaId: 143, numeroRemesa: '3083', grupoOrden: 3, ...g, progreso: 10, rev: 3 }));
        await esperar(() => /Remesas terminadas: 2 de 3/.test(b!.texto()), { que: 'la barra al día' });
        expect(b.texto()).not.toContain('#3082 · En cola');
        expect(b.texto()).not.toContain('#3081 · Procesando');
    });
});
