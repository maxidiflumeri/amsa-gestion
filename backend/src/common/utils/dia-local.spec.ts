process.env.TZ = 'America/Argentina/Buenos_Aires';

import { diaCalendario, fechaCalendarioUtc, sumarDiasYmd, ymdLocal } from './dia-local';

describe('dia-local: fechas calendario', () => {
    describe('ymdLocal', () => {
        it('a las 23:30 locales sigue siendo el mismo día (aunque en UTC ya sea el siguiente)', () => {
            // 23:30 AR del 16/10 = 02:30Z del 17/10
            expect(ymdLocal(new Date('2026-10-17T02:30:00.000Z'))).toBe('2026-10-16');
        });
        it('a las 00:10 locales ya es el día nuevo', () => {
            // 00:10 AR del 17/10 = 03:10Z
            expect(ymdLocal(new Date('2026-10-17T03:10:00.000Z'))).toBe('2026-10-17');
        });
    });

    describe('sumarDiasYmd', () => {
        it('cruza un fin de mes', () => {
            expect(sumarDiasYmd('2026-10-30', 3)).toBe('2026-11-02');
        });
        it('cruza un fin de año', () => {
            expect(sumarDiasYmd('2026-12-30', 3)).toBe('2027-01-02');
        });
        it('acepta negativos', () => {
            expect(sumarDiasYmd('2026-03-02', -2)).toBe('2026-02-28');
            expect(sumarDiasYmd('2026-10-16', 0)).toBe('2026-10-16');
        });
        it('rechaza lo que no es una fecha', () => {
            expect(() => sumarDiasYmd('16/10/2026', 1)).toThrow(RangeError);
        });
    });

    describe('fechaCalendarioUtc / diaCalendario', () => {
        it('guarda la fecha a las 00:00Z', () => {
            expect(fechaCalendarioUtc('2026-10-16').toISOString()).toBe('2026-10-16T00:00:00.000Z');
        });
        it('la parte de fecha del ISO es el día calendario', () => {
            expect(diaCalendario(new Date('2026-10-16T00:00:00.000Z'))).toBe('2026-10-16');
        });
        it('ida y vuelta', () => {
            expect(diaCalendario(fechaCalendarioUtc('2027-01-01'))).toBe('2027-01-01');
        });
    });
});
