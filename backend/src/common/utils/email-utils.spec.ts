/**
 * Filtro de emails basura.
 *
 * `esPosibleEmail` es el equivalente de `esPosibleTelefono`: separa "no validó pero podría ser real"
 * de "esto no aporta nada". Sin él, la mitad de los emails que entraban con la cartera de AYSA eran
 * el relleno `sin@mail` (5.910 de 11.702).
 */
import { esPosibleEmail } from './email-utils';

describe('esPosibleEmail — descarta lo que no puede ser un email', () => {
    it('sin punto en el dominio', () => {
        // El caso más común del archivo de AYSA, 5.910 veces.
        expect(esPosibleEmail('sin@mail')).toBe(false);
        expect(esPosibleEmail('sn@mail')).toBe(false);
        expect(esPosibleEmail('pelajeclaudia9@gmail')).toBe(false);
    });

    it('sin arroba, o con partes vacías', () => {
        expect(esPosibleEmail('juanperez')).toBe(false);
        expect(esPosibleEmail('@gmail.com')).toBe(false);
        expect(esPosibleEmail('juan@')).toBe(false);
        expect(esPosibleEmail('')).toBe(false);
    });

    it('con TLD incompleto o punto colgando', () => {
        expect(esPosibleEmail('contaduria@sanatorio.com.')).toBe(false);
        expect(esPosibleEmail('locaciones@pilar.gov.a')).toBe(false);
    });

    it('con espacios adentro', () => {
        expect(esPosibleEmail('juan perez@gmail.com')).toBe(false);
    });
});

describe('esPosibleEmail — descarta los rellenos bien formados', () => {
    it('sin@mail.com pasa cualquier validación técnica, pero es un relleno', () => {
        // Sintaxis válida y mail.com tiene servidor de correo: ningún filtro automático lo
        // distingue de un email real. Por eso hace falta la lista.
        expect(esPosibleEmail('sin@mail.com')).toBe(false);
    });

    it('las variantes habituales también', () => {
        expect(esPosibleEmail('no@tiene.com')).toBe(false);
        expect(esPosibleEmail('nn@nn.com')).toBe(false);
        expect(esPosibleEmail('sinmail@gmail.com')).toBe(false);
        expect(esPosibleEmail('NOTIENE@hotmail.com')).toBe(false);
        expect(esPosibleEmail('test@test.com')).toBe(false);
    });

    it('tolera separadores en la parte local del relleno', () => {
        expect(esPosibleEmail('sin_mail@gmail.com')).toBe(false);
        expect(esPosibleEmail('sin.mail@gmail.com')).toBe(false);
    });
});

describe('esPosibleEmail — deja pasar los emails reales', () => {
    it('los normales', () => {
        expect(esPosibleEmail('micaeladiaz2911@gmail.com')).toBe(true);
        expect(esPosibleEmail('m.rosamolina@yahoo.com.ar')).toBe(true);
        expect(esPosibleEmail('juan+etiqueta@empresa.com.ar')).toBe(true);
    });

    it('los que se repiten en la cartera pero son legítimos', () => {
        // Administradores de consorcio e inmobiliarias aparecen en varios casos: repetirse no los
        // hace basura, por eso el filtro no mira la frecuencia.
        expect(esPosibleEmail('borreroestudioinmobiliario@gmail.com')).toBe(true);
        expect(esPosibleEmail('admparana2020@gmail.com')).toBe(true);
    });

    it('uno que empieza con "sin" pero no es el relleno', () => {
        expect(esPosibleEmail('sindicato@gremio.org.ar')).toBe(true);
        expect(esPosibleEmail('sinforoso@gmail.com')).toBe(true);
    });

    it('no distingue mayúsculas', () => {
        expect(esPosibleEmail('Juan.Perez@Gmail.COM')).toBe(true);
    });
});
