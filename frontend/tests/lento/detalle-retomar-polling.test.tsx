// Polling del detalle con el socket caído: espera intervalos reales de la aplicación (10 s), por eso va aparte (`npm run test:lento`).
import { afterEach, describe, expect, it } from 'vitest';
import { dtoC1, enColaC1, iso, terminalC1 } from '../lib/fabricas';
import { alertas, boton, chips, clic, dialogo, esperar, pasar } from '../lib/montar';
import { armarDetalle, type BancoDetalle } from '../lib/banco-detalle';

const PROGRESO = /^\/import\/remesas\/141\/progreso$/;
const SIN_ESTADO = 'La plantilla no tiene estado inicial configurado.\n\nNo se cargó ninguna fila. Para cargarla, usá «Retomar» en el detalle de la importación: no hace falta volver a subir el archivo.';
const fallidaRetomable = (over: Record<string, unknown> = {}) => terminalC1('FALLIDA', { rev: 8, error: SIN_ESTADO, procesadas: 0, ok: 0, err: 0, progreso: 0, retomable: true, ...over });
const dlgRetomar = () => dialogo(/^Retomar la/);

describe('detalle: después de retomar con el socket caído', () => {
    let b: BancoDetalle | null = null;
    afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

    async function retomar(bb: BancoDetalle) {
        await clic(boton('Retomar', bb.v.contenedor), 'Retomar');
        await esperar(() => !!dlgRetomar(), { que: 'la confirmación' });
        await clic(boton('Retomar', dlgRetomar()!), 'confirmar');
    }

    it('socket CAÍDO: el polling se rearma solo (una consulta cada ~10 s) y llega al final sin eventos', async () => {
        b = await armarDetalle(fallidaRetomable(), { aceptarSockets: false });
        await pasar(600);
        const antes = b.srv.cuantos('GET', PROGRESO);
        // Terminal: no tiene que estar consultando.
        await pasar(11_500);
        const enTerminal = b.srv.cuantos('GET', PROGRESO) - antes;
        b.retomar = (id) => { const c = enColaC1({ rev: 9, enColaDelante: 0 }); b!.estados[id] = c; return { status: 201, body: { message: 'ok', remesaId: id, carga: c } }; };
        await retomar(b);
        await esperar(() => chips(b!.v.contenedor).includes('En cola'), { que: 'en cola' });
        const t0 = Date.now(); const base = b.srv.cuantos('GET', PROGRESO);
        // El servidor avanza callado: procesando y después terminada. Nadie emite nada (ni hay socket).
        b.estados[141] = dtoC1({ rev: 11, procesadas: 7000, ok: 7000, err: 0, progreso: 48, startedAt: iso(Date.now()), heartbeatAt: iso(Date.now()) });
        await esperar(() => /Procesando · 48% completado/.test(b!.texto()), { ms: 14_000, que: 'procesando, visto por polling' });
        const tProcesando = Date.now() - t0;
        b.estados[141] = terminalC1('OK', { rev: 12, procesadas: 14466, ok: 14466, err: 0 });
        await esperar(() => chips(b!.v.contenedor).includes('Finalizada'), { ms: 14_000, que: 'finalizada, vista por polling' });
        const tFin = Date.now() - t0;
        const cuando = b.srv.de('GET', PROGRESO).slice(base).map((p) => p.t - t0);
        await pasar(11_500);
        const despues = b.srv.de('GET', PROGRESO).filter((p) => p.t - t0 > tFin + 200).length;
        expect(enTerminal).toBe(0);
        expect(cuando.length).toBeGreaterThanOrEqual(2);
        expect(despues).toBe(0);
        expect(alertas().some((a) => /Sin conexión en tiempo real/.test(a.texto))).toBe(false); // terminal: ya no avisa
    });
});
