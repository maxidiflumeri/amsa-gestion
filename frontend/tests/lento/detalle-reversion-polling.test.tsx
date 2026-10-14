// C3b: el detalle sigue la reversión sin socket consultando cada ~10 s (intervalo real: va aparte, `npm run test:lento`).
import { afterEach, describe, expect, it } from 'vitest';
import { armarDetalle, type BancoDetalle } from '../lib/banco-detalle';
import { reversionAccion, reversionResumen, terminalC1 } from '../lib/fabricas';
import { esperar, limpio } from '../lib/montar';

let b: BancoDetalle | null = null;
afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

const estadoReversion = () => limpio(b!.v.contenedor.querySelector('[data-testid="reversion-estado"]')?.textContent ?? '');

describe('detalle de una acción masiva reviertiéndose, con el socket caído', () => {
    it('consulta sola mientras está REVIRTIENDO y llega a «Revertida» sin eventos', async () => {
        b = await armarDetalle(terminalC1('OK', { remesaId: 141, tipo: 'ACCIONES', usuarioId: 3 }), {
            permisos: ['importacion.ver_historial', 'importacion.ejecutar', 'deudores.acciones_masivas'],
            aceptarSockets: false,
            antes: (x) => { x.reversionGet = () => ({ body: reversionAccion({ remesaId: 141, reversion: reversionResumen({ remesaId: 141, estado: 'REVIRTIENDO', porcentaje: 10, hechos: 15 }) }) }); },
        });
        await esperar(() => estadoReversion().includes('Revirtiendo 10 %'), { que: 'en curso' });
        const fin = reversionResumen({ remesaId: 141, estado: 'TERMINADA', porcentaje: 100, hechos: 150 });
        b.reversionGet = () => ({ body: reversionAccion({ remesaId: 141, accionRevertidaEn: '2026-10-14T20:00:00.000Z', reversion: fin }) });
        await esperar(() => estadoReversion().includes('Revertida'), { ms: 14_000, que: '«Revertida» vista por consulta periódica' });
        expect(estadoReversion()).toContain('Revertida');
        // Terminada: no sigue consultando.
        const n = b.srv.cuantos('GET', /^\/import\/remesas\/141\/reversion$/);
        await new Promise((r) => setTimeout(r, 11_500));
        expect(b.srv.cuantos('GET', /^\/import\/remesas\/141\/reversion$/)).toBe(n);
    }, 40_000);
});
