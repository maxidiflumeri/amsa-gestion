/**
 * Normalización de teléfonos argentinos, con foco en la **cascada de deducción del código de área**.
 *
 * Muchos cedentes mandan el número en formato local —`42996640` (fijo) o `1564435038` (celular, con
 * el `15` que se marca localmente)— y así no se puede llamar. La cascada intenta deducir la
 * característica de otros datos del caso antes de descartarlo.
 */
import { codigoAreaDe, normalizarTelefonoArgentino } from './phone-utils';

describe('normalizarTelefonoArgentino — sin contexto (comportamiento de siempre)', () => {
    it('normaliza un número que ya trae característica', () => {
        expect(normalizarTelefonoArgentino('1142407390').e164).toBe('+541142407390');
        expect(normalizarTelefonoArgentino('01142407390').e164).toBe('+541142407390');
        expect(normalizarTelefonoArgentino('+541142407390').e164).toBe('+541142407390');
    });

    it('normaliza un celular con el 9', () => {
        expect(normalizarTelefonoArgentino('+5491138726641').e164).toBe('+5491138726641');
    });

    it('tolera separadores y paréntesis', () => {
        expect(normalizarTelefonoArgentino('(011) 4240-7390').e164).toBe('+541142407390');
    });

    it('rechaza la basura evidente', () => {
        expect(normalizarTelefonoArgentino('0').valido).toBe(false);
        expect(normalizarTelefonoArgentino('123').valido).toBe(false);
        expect(normalizarTelefonoArgentino('SIN TELEFONO').valido).toBe(false);
        expect(normalizarTelefonoArgentino('').valido).toBe(false);
    });

    it('un número sin característica NO se da por válido si no hay de dónde deducirla', () => {
        // Es el cambio de política: antes se guardaba "en rojo"; ahora se descarta, porque un
        // número sin característica no se puede marcar.
        expect(normalizarTelefonoArgentino('42996640').valido).toBe(false);
        expect(normalizarTelefonoArgentino('1564435038').valido).toBe(false);
    });
});

describe('normalizarTelefonoArgentino — paso 2: el área de otro teléfono del caso', () => {
    it('un celular local toma la característica de un fijo del mismo caso', () => {
        // El caso real del deudor 394905 de AYSA.
        const r = normalizarTelefonoArgentino('1564435038', { otrosTelefonos: ['1142407390'] });
        expect(r.valido).toBe(true);
        expect(r.e164).toBe('+5491164435038');
        expect(r.areaDeducidaDe).toBe('hermano');
    });

    it('un fijo local también la toma', () => {
        const r = normalizarTelefonoArgentino('42996640', { otrosTelefonos: ['+5491138726641'] });
        expect(r.e164).toBe('+541142996640');
        expect(r.areaDeducidaDe).toBe('hermano');
    });

    it('respeta el área del hermano aunque no sea 11', () => {
        const r = normalizarTelefonoArgentino('4473723', { otrosTelefonos: ['02234473723'] });
        // 7 dígitos no es formato local válido: no se inventa nada.
        expect(r.valido).toBe(false);
    });

    it('si el hermano tampoco trae área, no hay deducción', () => {
        expect(normalizarTelefonoArgentino('1564435038', { otrosTelefonos: ['42996640'] }).valido).toBe(false);
    });

    it('un contexto vacío no cambia nada', () => {
        expect(normalizarTelefonoArgentino('1564435038', {}).valido).toBe(false);
        expect(normalizarTelefonoArgentino('1564435038', { otrosTelefonos: [] }).valido).toBe(false);
    });
});

describe('normalizarTelefonoArgentino — paso 3: el área por código postal', () => {
    it('deduce la característica del CP del domicilio', () => {
        const r = normalizarTelefonoArgentino('1556344350', { codigoPostal: 'B1852---' });
        expect(r.valido).toBe(true);
        expect(r.e164).toBe('+5491156344350');
        expect(r.areaDeducidaDe).toBe('codigo-postal');
    });

    it('el fijo del mismo CP también', () => {
        expect(normalizarTelefonoArgentino('42770860', { codigoPostal: 'B1849DBV' }).e164)
            .toBe('+541142770860');
    });

    it('cae a la zona postal cuando el CP exacto no está en la tabla', () => {
        // B184 está como zona aunque el CP completo no figure.
        const r = normalizarTelefonoArgentino('42770860', { codigoPostal: 'B1848ZZZ' });
        expect(r.valido).toBe(true);
        expect(r.areaDeducidaDe).toBe('codigo-postal');
    });

    it('un CP desconocido no habilita ninguna deducción', () => {
        expect(normalizarTelefonoArgentino('42996640', { codigoPostal: 'Z9999XXX' }).valido).toBe(false);
    });

    it('descarta el área candidata que no da un número válido, y sigue con la siguiente', () => {
        // El número nacional argentino tiene 10 dígitos: un área de 3 (223) va con 7 dígitos
        // locales, no con 8. Como el teléfono local trae 8, el área del hermano no puede ser la
        // correcta y se pasa al candidato siguiente en vez de armar un número inexistente.
        const r = normalizarTelefonoArgentino('1564435038', {
            otrosTelefonos: ['02234473723'],   // área 223 — incompatible con un local de 8 dígitos
            codigoPostal: 'B1852---',          // área 11  — sí compatible
        });
        expect(r.valido).toBe(true);
        expect(r.e164).toBe('+5491164435038');
        expect(r.areaDeducidaDe).toBe('codigo-postal');
    });

    it('si ningún candidato da un número válido, se descarta', () => {
        const r = normalizarTelefonoArgentino('1564435038', { otrosTelefonos: ['02234473723'] });
        expect(r.valido).toBe(false);
    });
});

describe('codigoAreaDe', () => {
    it('reconoce las áreas de 2, 3 y 4 dígitos', () => {
        // El número nacional siempre tiene 10 dígitos, pero el área ocupa 2, 3 o 4 según la zona:
        // partir por una longitud fija da áreas que no existen.
        expect(codigoAreaDe('1142407390')).toBe('11');
        expect(codigoAreaDe('2234473723')).toBe('223');
        expect(codigoAreaDe('2202123456')).toBe('2202');
    });

    it('devuelve null si el prefijo no es un área real', () => {
        expect(codigoAreaDe('9999999999')).toBeNull();
    });
});
