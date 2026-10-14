// C2b — el vigía de `ejecutar-grupo` (§16.6), contra el asistente real. Espera los 15 s reales del vigía: el intervalo no se acorta
// para las pruebas. La lógica del hook, con tiempo simulado, está en componentes/vigia-grupo-hook.test.tsx.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { dtoC1, iso, terminalC1 } from '../lib/fabricas';
import { alertas, boton, clic, esperar, pasar, toasts } from '../lib/montar';
import { instalarAdaptador, usarGuion } from '../lib/wizard';
import { armarBancoC1, hastaLaVistaPreviaDividida, type BancoC1 } from '../lib/banco-asistente';
import type { EstadoCargaDto } from '@fe/types/importProgreso';

let b: BancoC1 | null = null;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false; instalarAdaptador(); });
afterAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { usarGuion(null); if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

const procesandoDe = (e: EstadoCargaDto, over: Record<string, unknown> = {}) => dtoC1({ ...e, fase: 'PROCESANDO', estadoProceso: 'PROCESANDO', rev: 10, procesadas: 2000, ok: 2000, err: 0, progreso: 40, startedAt: iso(Date.now()), heartbeatAt: iso(Date.now()), servidorAhora: iso(Date.now()), enColaDelante: null, cancelable: true, ...over });
const CONSULTAS = /progreso|grupos/;
const dormir = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
/** `ejecutar-grupo` que el servidor procesa enseguida pero cuya respuesta tarda `ms`. */
const conRespuestaLenta = (banco: BancoC1, ms: number, alResponder?: (r: ReturnType<BancoC1['ejecutarGrupo']>) => void) => {
    const bueno = banco.ejecutarGrupo;
    banco.ejecutarGrupo = async (c) => { const r = await bueno(c); await dormir(ms); alResponder?.(r as never); return r; };
};
const confirmar = async (banco: BancoC1) => {
    await hastaLaVistaPreviaDividida(banco);
    const t0 = Date.now();
    await clic(boton('Confirmar e importar'), 'Confirmar');
    await pasar(500);
    return t0;
};

describe('el pedido `ejecutar-grupo` que no vuelve', () => {
    it('TV-1 — el servidor ya tiene el grupo y el POST cuelga: a los ≤ 21 s la pantalla sigue al grupo, y no consultó antes de los 15 s', async () => {
        b = await armarBancoC1();
        conRespuestaLenta(b, 22_000);
        const t0 = await confirmar(b);
        b.pub('import:iniciada', procesandoDe(b.estados[141], { rev: 5 }));
        await esperar(() => /Carga dividida: remesa 1 de 3/.test(b!.texto()), { ms: 21_000, que: 'la división seguida por el vigía' });
        expect(b.srv.pedidos.filter((p) => p.metodo === 'GET' && CONSULTAS.test(p.ruta) && p.t < t0 + 15_000)).toHaveLength(0);
        expect(Date.now() - t0).toBeLessThanOrEqual(21_000);
        await pasar(Math.max(0, 23_500 - (Date.now() - t0)));
    });

    it('TV-2 — el POST vuelve a los 25 s con `noEncoladas`: aparece la alerta y la pantalla no se remonta', async () => {
        b = await armarBancoC1();
        const bueno = b.ejecutarGrupo;
        b.ejecutarGrupo = async (c) => {
            const r = (await bueno(c)) as { body: { cargas: Array<{ remesaId: number }>; noEncoladas?: unknown } };
            const fuera = [{ remesaId: 143, numeroRemesa: b!.estados[143].numeroRemesa }];
            b!.estados[143] = dtoC1({ ...b!.estados[143], fase: 'BORRADOR', enCurso: false, estadoProceso: 'VALIDANDO', grupoId: null, grupoOrden: null, grupoTotal: null, encoladaAt: null, cancelable: false });
            r.body.cargas = r.body.cargas.filter((x) => x.remesaId !== 143);
            r.body.noEncoladas = fuera;
            await dormir(25_000);
            return r as never;
        };
        const t0 = await confirmar(b);
        await esperar(() => /Carga dividida/.test(b!.texto()), { ms: 21_000, que: 'la división seguida por el vigía' });
        expect(alertas(b.v.contenedor).some((a) => /no se pudo encolar/.test(a.texto))).toBe(false);
        const marca = Array.from(b.v.contenedor.querySelectorAll('.MuiAlert-root')).find((a) => /Carga dividida/.test(a.textContent ?? ''));
        expect(marca).toBeTruthy();
        await esperar(() => alertas(b!.v.contenedor).some((a) => /1 remesa no se pudo encolar y quedó sin confirmar/.test(a.texto) && /3083/.test(a.texto)), { ms: Math.max(1000, 28_000 - (Date.now() - t0)), que: 'la alerta del 201 tardío' });
        expect(marca!.isConnected).toBe(true);
        expect(b.texto()).toContain('Carga dividida: remesa');
    });

    it('TV-3 — el POST vuelve 504 después de adoptar el grupo y la consulta del estado también falla: no vuelve a la vista previa', async () => {
        b = await armarBancoC1();
        const bueno = b.ejecutarGrupo;
        let adoptado = false;
        b.ejecutarGrupo = async (c) => { await bueno(c); await dormir(26_000); return { status: 504, body: { message: 'Gateway Time-out' } }; };
        const t0 = await confirmar(b);
        await esperar(() => /Carga dividida/.test(b!.texto()), { ms: 21_000, que: 'la división seguida por el vigía' });
        adoptado = true;
        // A partir de acá, consultar la primera remesa falla: el `catch` del POST no puede confirmar nada.
        b.srv.en('GET', /^\/import\/remesas\/141\/progreso$/, () => (adoptado ? { status: 500, body: { message: 'caído' } } : { status: 404, body: {} }));
        await pasar(Math.max(0, 29_000 - (Date.now() - t0)));
        expect(b.texto()).toContain('Carga dividida');
        expect(boton('Confirmar e importar')).toBeNull();
        expect(toasts().some((t) => t.variante === 'error')).toBe(false);
    });

    it('TV-4 — el POST responde a los 3 s: ninguna consulta del vigía', async () => {
        b = await armarBancoC1();
        conRespuestaLenta(b, 3_000);
        const t0 = await confirmar(b);
        await esperar(() => /Carga dividida/.test(b!.texto()), { ms: 8000, que: 'la división' });
        await pasar(Math.max(0, 18_500 - (Date.now() - t0)));
        expect(b.srv.cuantos('GET', /remesas\/\d+\/progreso/)).toBe(0);
    });

    it('TV-5 — la primera remesa sigue en borrador: sigue en «Enviando a la cola…» con el aviso de «tardando» y no adopta nada', async () => {
        b = await armarBancoC1();
        b.ejecutarGrupo = async () => { await dormir(24_000); return { status: 503, body: { message: 'sin cola' } }; };
        const t0 = await confirmar(b);
        await pasar(Math.max(0, 17_500 - (Date.now() - t0)));
        expect(b.texto()).toContain('Enviando a la cola…');
        expect(b.texto()).toContain('El servidor está tardando en responder. Si la carga ya empezó, aparece acá en unos segundos; no vuelvas a confirmar.');
        expect(b.texto()).not.toContain('Carga dividida');
        expect(b.srv.cuantos('GET', /^\/import\/remesas\/141\/progreso$/)).toBeGreaterThanOrEqual(1);
    });

    it('TV-6 — desmontar el asistente corta el vigía', async () => {
        b = await armarBancoC1();
        conRespuestaLenta(b, 30_000);
        const t0 = await confirmar(b);
        const montado = b.v;
        await montado.desmontar();
        b.v = { ...montado, desmontar: async () => {} };
        await pasar(Math.max(0, 22_000 - (Date.now() - t0)));
        expect(b.srv.cuantos('GET', CONSULTAS)).toBe(0);
    });

    it('TV-7 — «Nueva importación» con el POST todavía colgado: el vigía no vuelve a mirar y la respuesta tardía no toca la carga nueva (auditoría de C2b)', async () => {
        b = await armarBancoC1();
        conRespuestaLenta(b, 45_000);
        const t0 = await confirmar(b);
        b.pub('import:iniciada', procesandoDe(b.estados[141], { rev: 5 }));
        await esperar(() => /Carga dividida/.test(b!.texto()), { ms: 21_000, que: 'la división seguida por el vigía' });
        for (const id of [141, 142, 143]) {
            const e = b.estados[id];
            b.pub('import:finalizada', terminalC1('OK', { remesaId: id, numeroRemesa: e.numeroRemesa, grupoId: e.grupoId, grupoOrden: e.grupoOrden, grupoTotal: e.grupoTotal, usuarioId: e.usuarioId, rev: 30 }));
        }
        await esperar(() => boton('Nueva importación') !== null, { ms: 10_000, que: 'el resultado de la división' });
        await clic(boton('Nueva importación'), 'Nueva importación');
        const tNueva = Date.now();
        await pasar(Math.max(18_000, 47_000 - (Date.now() - t0)));
        // Ni el vigía rearmado (que volvería a adoptar la división vieja) ni la respuesta tardía del POST.
        expect(b.srv.pedidos.filter((p) => p.metodo === 'GET' && CONSULTAS.test(p.ruta) && p.t > tNueva)).toHaveLength(0);
        expect(b.texto()).not.toContain('Carga dividida');
        expect(boton('Nueva importación')).toBeNull();
        expect(toasts().some((t) => t.variante === 'error')).toBe(false);
    });
});
