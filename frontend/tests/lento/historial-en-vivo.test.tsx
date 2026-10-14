// C2a: la lista del Historial se mantiene al día sola, con intervalos REALES de la aplicación (FL-1 a FL-5).
// Tardan minutos: no corren con `npm test`, sino con `npm run test:lento`.
import { afterEach, describe, expect, it } from 'vitest';
import { armarHistorial, listaDibujada, type BancoHistorial } from '../lib/banco-historial';
import { dtoC1, itemHistorial, terminalC1, type Sobre } from '../lib/fabricas';
import { chips, clic, esperar, pasar } from '../lib/montar';
import type { HistorialItemDto } from '@fe/types/importHistorial';

let n = 300;
const fila = (carga: Sobre): HistorialItemDto => { const id = n++; return itemHistorial({}, { ...carga, remesaId: id, numeroRemesa: String(id).padStart(5, '0'), nombre: `Carga ${id}`, empresaId: 1 }); };

let b: BancoHistorial | null = null;
afterEach(async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    if (b) { await b.v.desmontar(); await b.srv.bajar(); }
    b = null;
});
const ocultar = (oculta: boolean) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => oculta });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (oculta ? 'hidden' : 'visible') });
};
const consultas = () => b!.consultasHistorial();

describe('Historial en vivo, sin eventos', () => {
    it('FL-1 — socket caído y una fila en curso: una consulta cada 15 s; cuando termina, se corta', async () => {
        const f = fila(dtoC1({ rev: 5 }));
        b = await armarHistorial({ items: [f], aceptarSockets: false });
        await listaDibujada(b);
        await pasar(500);
        const base = consultas();
        await pasar(16_000);
        expect(consultas()).toBe(base + 1);
        b.items = [{ ...f, carga: terminalC1('OK', { remesaId: f.id, numeroRemesa: f.numeroRemesa, empresaId: 1, rev: 9 }) }];
        await pasar(15_000);
        expect(consultas()).toBe(base + 2);
        await esperar(() => chips(b!.v.contenedor).includes('Finalizada'), { que: 'la fila terminada' });
        await pasar(15_000);
        expect(consultas()).toBe(base + 2); // ya no hay nada en curso: el ciclo de 15 s se cortó (el de un minuto todavía no llegó)
    }, 120_000);

    it('FL-2 — socket conectado y una fila en curso de la que no llegan eventos: consulta a los ~30 s y la fila se actualiza', async () => {
        const f = fila(dtoC1({ rev: 5, progreso: 20 }));
        b = await armarHistorial({ items: [f] });
        await listaDibujada(b);
        await pasar(500);
        const base = consultas();
        b.items = [{ ...f, carga: dtoC1({ remesaId: f.id, numeroRemesa: f.numeroRemesa, empresaId: 1, rev: 9, progreso: 64, procesadas: 9000, ok: 9000 }) }];
        await pasar(25_000);
        expect(consultas()).toBe(base); // 25 s de silencio: todavía no
        await esperar(() => chips(b!.v.contenedor).includes('Procesando 64 %'), { ms: 12_000, que: 'la fila actualizada por consulta' });
        expect(consultas()).toBe(base + 1);
    }, 120_000);

    it('FL-3 — nada en curso: en la página 1, una consulta por minuto', async () => {
        b = await armarHistorial({ items: [fila(terminalC1('OK', { empresaId: 1 }))] });
        await listaDibujada(b);
        await pasar(500);
        const base = consultas();
        await pasar(30_000);
        expect(consultas()).toBe(base);
        await pasar(32_000);
        expect(consultas()).toBe(base + 1);
    }, 120_000);

    it('FL-3 — nada en curso: en la página 2, ninguna', async () => {
        b = await armarHistorial({ items: Array.from({ length: 30 }, () => fila(terminalC1('OK', { empresaId: 1 }))) });
        await listaDibujada(b);
        await clic(document.querySelector('button[aria-label="Go to next page"]'), 'siguiente');
        await esperar(() => /26–30 de 30/.test(b!.texto()), { que: 'la página 2' });
        await pasar(500);
        const base = consultas();
        await pasar(62_000);
        expect(consultas()).toBe(base);
    }, 120_000);

    it('FL-4 — pestaña oculta: ninguna consulta; al volver, una', async () => {
        b = await armarHistorial({ items: [fila(dtoC1({ rev: 5 }))], aceptarSockets: false });
        await listaDibujada(b);
        await pasar(500);
        ocultar(true);
        const base = consultas();
        await pasar(31_000);
        expect(consultas()).toBe(base);
        ocultar(false);
        document.dispatchEvent(new Event('visibilitychange'));
        await esperar(() => consultas() === base + 1, { que: 'la consulta al volver' });
    }, 120_000);

    it('FL-5 — al desmontar: ninguna consulta después', async () => {
        b = await armarHistorial({ items: [fila(dtoC1({ rev: 5 }))], aceptarSockets: false });
        await listaDibujada(b);
        await pasar(500);
        await b.v.desmontar();
        const base = consultas();
        await pasar(31_000);
        expect(consultas()).toBe(base);
    }, 120_000);
});
