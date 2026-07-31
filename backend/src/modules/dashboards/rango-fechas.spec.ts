import { finDelDia, inicioDelDia, resolverRango } from './rango-fechas';

/**
 * El bug que motivó este helper: con `new Date('2026-07-31')` el rango del tablero quedaba corrido
 * 3 horas hacia atrás (medianoche UTC = 21:00 del día anterior en Argentina), así que los pagos del
 * último día del rango no se contaban. Una remesa con 16 pagos del 31/07 mostraba "Pagos del período $0".
 */
describe('rango-fechas', () => {
    it('desde arranca a las 00:00 del día local, no a medianoche UTC', () => {
        const d = inicioDelDia('2026-07-01');
        expect(d.getFullYear()).toBe(2026);
        expect(d.getMonth()).toBe(6);
        expect(d.getDate()).toBe(1);
        expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0]);
    });

    it('hasta cubre el día entero hasta las 23:59:59.999', () => {
        const h = finDelDia('2026-07-31');
        expect(h.getDate()).toBe(31);
        expect([h.getHours(), h.getMinutes(), h.getSeconds(), h.getMilliseconds()]).toEqual([23, 59, 59, 999]);
    });

    it('incluye un pago registrado a las 00:00 del último día del rango', () => {
        // Es el caso exacto de producción: los pagos que genera el import quedan a medianoche local.
        const { desde, hasta } = resolverRango('2026-07-01', '2026-07-31');
        const pago = new Date(2026, 6, 31, 0, 0, 0);
        expect(pago >= desde && pago <= hasta).toBe(true);
    });

    it('incluye también el último instante del día', () => {
        const { hasta } = resolverRango('2026-07-01', '2026-07-31');
        expect(new Date(2026, 6, 31, 23, 59, 59) <= hasta).toBe(true);
    });

    it('NO se come el día anterior al inicio del rango', () => {
        // El bug viejo metía las últimas 3 horas del 30/06 dentro de julio.
        const { desde } = resolverRango('2026-07-01', '2026-07-31');
        expect(new Date(2026, 5, 30, 23, 59, 59) < desde).toBe(true);
    });

    it('deja afuera el día siguiente al fin del rango', () => {
        const { hasta } = resolverRango('2026-07-01', '2026-07-31');
        expect(new Date(2026, 7, 1, 0, 0, 0) > hasta).toBe(true);
    });

    it('un rango de un solo día cubre ese día completo', () => {
        const { desde, hasta } = resolverRango('2026-07-31', '2026-07-31');
        expect(new Date(2026, 6, 31, 0, 0, 0) >= desde).toBe(true);
        expect(new Date(2026, 6, 31, 23, 59, 59) <= hasta).toBe(true);
        expect(hasta.getTime() - desde.getTime()).toBe(86_400_000 - 1);
    });

    it('respeta el instante si la fecha viene con hora', () => {
        const d = inicioDelDia('2026-07-15T10:30:00.000Z');
        expect(d.toISOString()).toBe('2026-07-15T10:30:00.000Z');
    });

    it('rechaza fechas inválidas y rangos dados vuelta', () => {
        expect(() => resolverRango('no-es-fecha', '2026-07-31')).toThrow(/Fechas inválidas/);
        expect(() => resolverRango('2026-08-01', '2026-07-31')).toThrow(/debe ser <=/);
    });
});
