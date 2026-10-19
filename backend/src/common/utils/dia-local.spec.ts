process.env.TZ = 'America/Argentina/Buenos_Aires';

import {
    diaCalendario, diasEntre, esFechaRelativa, fechaCalendarioUtc, resolverFechaRelativa, sumarDiasYmd, ymdLocal,
} from './dia-local';

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

describe('dia-local: fechas relativas', () => {
    describe('esFechaRelativa', () => {
        it.each(['hoy', 'hoy-1', 'hoy+1', 'hoy-90', 'hoy+7', 'hoy-3650', 'hoy+3650', ' hoy-5 '])('"%s" es relativa', (v) => {
            expect(esFechaRelativa(v)).toBe(true);
        });
        it.each(['hoy-0', 'hoy+0', 'hoy-3651', 'hoy-10000', 'hoy-', 'hoy+', 'Hoy', 'ayer', 'hoy - 3', 'hoy-1.5', '2026-10-17', '', 'hoy-90x'])(
            '"%s" no lo es',
            (v) => {
                expect(esFechaRelativa(v)).toBe(false);
            },
        );
        it('no confunde tipos que no son texto', () => {
            expect(esFechaRelativa(null)).toBe(false);
            expect(esFechaRelativa(undefined)).toBe(false);
            expect(esFechaRelativa(90)).toBe(false);
            expect(esFechaRelativa(new Date())).toBe(false);
        });
    });

    describe('resolverFechaRelativa', () => {
        it('"hoy" es el día que se pasa', () => {
            expect(resolverFechaRelativa('hoy', '2026-10-17')).toBe('2026-10-17');
        });
        it('suma y resta días', () => {
            expect(resolverFechaRelativa('hoy-90', '2026-10-17')).toBe('2026-07-19');
            expect(resolverFechaRelativa('hoy+7', '2026-10-17')).toBe('2026-10-24');
        });
        it('cruza un fin de mes y de año', () => {
            expect(resolverFechaRelativa('hoy+3', '2026-10-30')).toBe('2026-11-02');
            expect(resolverFechaRelativa('hoy-1', '2027-01-01')).toBe('2026-12-31');
        });
        it('respeta el bisiesto', () => {
            expect(resolverFechaRelativa('hoy-1', '2028-03-01')).toBe('2028-02-29');
            expect(resolverFechaRelativa('hoy-1', '2027-03-01')).toBe('2027-02-28');
            expect(resolverFechaRelativa('hoy+1', '2028-02-28')).toBe('2028-02-29');
        });
        it('el borde de N: 1 y 3650', () => {
            expect(resolverFechaRelativa('hoy-1', '2026-10-17')).toBe('2026-10-16');
            expect(resolverFechaRelativa('hoy-3650', '2026-10-17')).toBe('2016-10-19');
            expect(resolverFechaRelativa('hoy+3650', '2026-10-17')).toBe('2036-10-14');
        });
        it('N = 0 no es relativo y vuelve tal cual', () => {
            expect(resolverFechaRelativa('hoy-0', '2026-10-17')).toBe('hoy-0');
        });
        it('lo que no es relativo vuelve sin tocar (fecha fija, Date, null)', () => {
            const d = new Date('2026-01-01T00:00:00Z');
            expect(resolverFechaRelativa('2026-05-05', '2026-10-17')).toBe('2026-05-05');
            expect(resolverFechaRelativa(d, '2026-10-17')).toBe(d);
            expect(resolverFechaRelativa(null, '2026-10-17')).toBeNull();
        });
        it('a las 23:30 de Argentina "hoy" sigue siendo el día local aunque en UTC ya sea el siguiente', () => {
            const hoy = ymdLocal(new Date('2026-10-17T02:30:00.000Z')); // 23:30 AR del 16/10
            expect(resolverFechaRelativa('hoy', hoy)).toBe('2026-10-16');
            expect(resolverFechaRelativa('hoy-1', hoy)).toBe('2026-10-15');
        });
        it('a las 00:10 de Argentina ya es el día nuevo', () => {
            const hoy = ymdLocal(new Date('2026-10-17T03:10:00.000Z'));
            expect(resolverFechaRelativa('hoy', hoy)).toBe('2026-10-17');
        });
    });

    describe('diasEntre', () => {
        it('mismo día: 0', () => {
            expect(diasEntre('2026-10-17', '2026-10-17')).toBe(0);
        });
        it('positivo si la segunda es posterior, negativo si es anterior', () => {
            expect(diasEntre('2026-10-10', '2026-10-17')).toBe(7);
            expect(diasEntre('2026-10-17', '2026-10-10')).toBe(-7);
        });
        it('cruza fin de mes, de año y bisiesto', () => {
            expect(diasEntre('2026-10-30', '2026-11-02')).toBe(3);
            expect(diasEntre('2026-12-31', '2027-01-01')).toBe(1);
            expect(diasEntre('2028-02-28', '2028-03-01')).toBe(2);
            expect(diasEntre('2027-02-28', '2027-03-01')).toBe(1);
            expect(diasEntre('2026-01-01', '2027-01-01')).toBe(365);
        });
        it('es la inversa de sumarDiasYmd en los bordes de N', () => {
            expect(diasEntre(resolverFechaRelativa('hoy-3650', '2026-10-17') as string, '2026-10-17')).toBe(3650);
            expect(diasEntre('2026-10-17', resolverFechaRelativa('hoy+3650', '2026-10-17') as string)).toBe(3650);
        });
        it('rechaza lo que no es una fecha calendario', () => {
            expect(() => diasEntre('17/10/2026', '2026-10-17')).toThrow(RangeError);
            expect(() => diasEntre('2026-10-17', 'hoy')).toThrow(RangeError);
            expect(() => diasEntre('2026-02-31', '2026-10-17')).toThrow(RangeError);
            expect(() => diasEntre('2026-10-17', '2026-13-40')).toThrow(RangeError);
        });
    });
});
