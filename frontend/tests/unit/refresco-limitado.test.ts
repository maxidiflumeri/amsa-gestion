// crearRefrescoLimitado (utils/estadoCarga.ts): una acción por ventana, con flanco de bajada. Timers falsos.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearRefrescoLimitado } from '@fe/utils/estadoCarga';

const T = Date.parse('2026-10-09T12:00:00Z');
let llamadas: number[];
const nuevo = (minMs = 5000) => crearRefrescoLimitado(() => { llamadas.push(Date.now() - T); }, minMs);
beforeEach(() => { vi.useFakeTimers({ now: T }); llamadas = []; });
afterEach(() => { vi.useRealTimers(); });

describe('crearRefrescoLimitado', () => {
    it('el primer pedido sale ya; los que caen en la ventana se juntan en UNO, cuando la ventana cierra', () => {
        const r = nuevo();
        r.pedir();
        expect(llamadas).toEqual([0]);
        for (let i = 0; i < 20; i++) { vi.advanceTimersByTime(100); r.pedir(); }
        expect(llamadas).toEqual([0]);
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(2999);
        expect(llamadas).toEqual([0]);
        vi.advanceTimersByTime(1);
        expect(llamadas).toEqual([0, 5000]);
        expect(vi.getTimerCount()).toBe(0);
        // Sin más pedidos, no hay más acciones: no se auto-alimenta.
        vi.advanceTimersByTime(60_000);
        expect(llamadas).toEqual([0, 5000]);
    });

    it('un pedido justo al cerrar la ventana sale ya; uno un ms después de una acción se programa a los 5 s', () => {
        const r = nuevo();
        r.pedir();
        vi.advanceTimersByTime(5000);
        r.pedir();
        expect(llamadas).toEqual([0, 5000]);
        vi.advanceTimersByTime(1);
        r.pedir();
        vi.advanceTimersByTime(4998);
        expect(llamadas).toEqual([0, 5000]);
        vi.advanceTimersByTime(1);
        expect(llamadas).toEqual([0, 5000, 10_000]);
    });

    it('eventos continuos durante un minuto (10 por segundo): una acción cada 5 s, ni una más', () => {
        const r = nuevo();
        for (let t = 0; t <= 60_000; t += 100) { r.pedir(); vi.advanceTimersByTime(100); }
        vi.advanceTimersByTime(10_000);
        expect(llamadas).toEqual([0, 5000, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000, 40_000, 45_000, 50_000, 55_000, 60_000, 65_000]);
        for (let i = 1; i < llamadas.length; i++) expect(llamadas[i] - llamadas[i - 1]).toBeGreaterThanOrEqual(5000);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancelar apaga el programado y no deja timers; después se puede volver a pedir', () => {
        const r = nuevo();
        r.cancelar(); // sin nada programado: no rompe
        r.pedir();
        vi.advanceTimersByTime(1000);
        r.pedir();
        expect(vi.getTimerCount()).toBe(1);
        r.cancelar();
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(60_000);
        expect(llamadas).toEqual([0]);
        r.pedir();
        expect(llamadas).toEqual([0, 61_000]);
        r.cancelar(); r.cancelar();
    });

    it('si el timer se atrasó y llega otro pedido con la ventana ya cerrada, la acción corre UNA vez (no dos)', () => {
        const r = nuevo();
        r.pedir();
        vi.advanceTimersByTime(1000);
        r.pedir(); // programa para t=5000
        vi.setSystemTime(T + 7000); // el reloj avanzó pero el timer todavía no corrió (pestaña en segundo plano)
        r.pedir();
        expect(llamadas).toEqual([0, 7000]);
        vi.advanceTimersByTime(20_000);
        expect(llamadas).toEqual([0, 7000]);
    });

    it('la acción puede volver a pedir desde adentro sin recursión infinita', () => {
        let n = 0;
        const r = crearRefrescoLimitado(() => { n++; if (n < 50) r.pedir(); }, 5000);
        r.pedir();
        expect(n).toBe(1);
        vi.advanceTimersByTime(5000);
        expect(n).toBe(2);
        vi.advanceTimersByTime(30_000);
        expect(n).toBe(8);
    });

    it('dos instancias no comparten ventana (el hook y la campanita tienen cada uno la suya)', () => {
        const a = nuevo(); const b = nuevo();
        a.pedir(); b.pedir();
        expect(llamadas).toEqual([0, 0]);
    });

    it('OBSERVADO — si el reloj del sistema retrocede, el próximo pedido queda programado para cuando el reloj «alcance» al anterior', () => {
        const r = nuevo();
        r.pedir();
        vi.advanceTimersByTime(10_000);
        vi.setSystemTime(T - 3_600_000 + 10_000); // el reloj retrocede una hora (ajuste manual o salto grande de NTP)
        const antes = llamadas.length;
        r.pedir();
        let pasaron = 0;
        while (llamadas.length === antes && pasaron < 2 * 3_600_000) { vi.advanceTimersByTime(60_000); r.pedir(); pasaron += 60_000; }
        expect(llamadas.length).toBeGreaterThan(antes);
    });
});
