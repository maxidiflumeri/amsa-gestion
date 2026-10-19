import { enmascararCelda, forma } from './enmascarar';

describe('forma', () => {
    it('dígito → 9, mayúscula → X, minúscula → x, la puntuación queda', () => {
        expect(forma('Gómez, María')).toBe('Xxxxx, Xxxxx');
        expect(forma('30111222')).toBe('99999999');
        expect(forma('mlgomez@gmail.com')).toBe('xxxxxxx@xxxxx.xxx');
        expect(forma('XX-1234567')).toBe('XX-9999999');
    });

    it('acentos, Ñ y Ü cuentan como letras', () => {
        expect(forma('ÁÉÍÓÚ ÑANDÚ üñ')).toBe('XXXXX XXXXX xx');
    });

    it('recorta a 40 caracteres y dice cuántos más había', () => {
        const f = forma('a'.repeat(55));
        expect(f).toBe(`${'x'.repeat(40)}…(+15)`);
    });

    it('no copia caracteres de control ni nada que no sea letra, número, espacio o puntuación', () => {
        expect(forma('a\u0000b​c')).toBe('xxx');
    });

    it('vacíos', () => {
        expect(forma(null)).toBe('');
        expect(forma(undefined)).toBe('');
    });

    it('nunca devuelve un carácter alfanumérico del original', () => {
        const original = 'Pérez Gómez 30.111.222 mperez@x.com';
        // Solo pueden quedar X, x, 9 y puntuación: cualquier otra letra o dígito sería parte del original.
        expect(forma(original)).toMatch(/^[Xx9 .,@\-]+$/);
    });
});

describe('enmascararCelda', () => {
    it('documento: los últimos 4', () => {
        expect(enmascararCelda('documento', '30111222')).toBe('··· 1222');
        expect(enmascararCelda('nroCliente', 'AB-0004521')).toBe('··· 4521');
    });

    it('nombre y apellido: iniciales', () => {
        expect(enmascararCelda('nombre', 'María Laura Gómez')).toBe('M. L. G.');
        expect(enmascararCelda('promesas.usuario.nombre', 'Ana Pérez')).toBe('A. P.');
    });

    it('no toca nombres que no son de personas', () => {
        expect(enmascararCelda('empresa.nombre', 'TOYOTA')).toBe('TOYOTA');
        expect(enmascararCelda('remesa.nombre', 'Remesa octubre')).toBe('Remesa octubre');
    });

    it('teléfono: característica, puntos y los últimos 4', () => {
        expect(enmascararCelda('contactos[tipo=telefono][0].valor', '1155578807')).toBe('11 ···· 8807');
        expect(enmascararCelda('contactos[tipo=telefono][0].valor', '+5491155578807')).toBe('11 ···· 8807');
        expect(enmascararCelda('llamadas.telefono', '01155578807')).toBe('11 ···· 8807');
        expect(enmascararCelda('x', '1155578807', 'telefono')).toBe('11 ···· 8807');
    });

    it('mail: primera letra y dominio', () => {
        expect(enmascararCelda('contactos[tipo=email][0].valor', 'mlgomez@gmail.com')).toBe('m···@gmail.com');
    });

    it('direcciones y textos libres: solo el largo', () => {
        expect(enmascararCelda('contactos[tipo=direccion][0].valor', 'Av. Siempreviva 742')).toBe('(texto de 19 caracteres)');
        expect(enmascararCelda('comentarios[last].texto', 'Llamó y dijo que paga')).toBe('(texto de 21 caracteres)');
    });

    it('datos adicionales: la forma', () => {
        expect(enmascararCelda('camposAdicionales.PATENTE', 'AB123CD')).toBe('XX999XX');
    });

    it('contactos.valor sin filtro de tipo: decide por la forma del valor', () => {
        expect(enmascararCelda('contactos.valor', '1155578807, a@b.com')).toBe('11 ···· 8807, a···@b.com');
    });

    it('un valor concatenado se enmascara elemento por elemento', () => {
        expect(enmascararCelda('contactos[tipo=telefono].valor', '1155578807, 1144443333')).toBe('11 ···· 8807, 11 ···· 3333');
    });

    it('importes, fechas, códigos y estados salen tal cual', () => {
        expect(enmascararCelda('saldo', '248.300,00')).toBe('248.300,00');
        expect(enmascararCelda('estadoSituacion.descripcion', 'EN GESTION')).toBe('EN GESTION');
        expect(enmascararCelda('', 'fijo')).toBe('fijo');
    });

    it('vacío', () => {
        expect(enmascararCelda('documento', '')).toBe('');
        expect(enmascararCelda('documento', null)).toBe('');
    });

    describe('separador real de la columna y barrido final', () => {
        it('mails separados por « | »: los dos se enmascaran', () => {
            expect(enmascararCelda('contactos[tipo=email].valor', 'ana@x.com | beto@y.com', undefined, ' | ')).toBe('a···@x.com | b···@y.com');
            expect(enmascararCelda('contactos[tipo=email].valor', 'ana@x.com | beto@y.com')).toBe('a···@x.com | b···@y.com');
        });

        it('teléfonos separados por otro separador (« / », «;», salto de línea)', () => {
            expect(enmascararCelda('contactos[tipo=telefono].valor', '1155578807 / 1144443322', undefined, ' / ')).toBe('11 ···· 8807 / 11 ···· 3322');
            expect(enmascararCelda('contactos[tipo=telefono].valor', '1155578807;1144443322')).toBe('11 ···· 8807;11 ···· 3322');
            expect(enmascararCelda('contactos[tipo=telefono].valor', '1155578807\n1144443322')).toBe('11 ···· 8807\n11 ···· 3322');
        });

        it('cualquier mail, teléfono o número largo en cualquier lugar de una columna que no parece de datos personales', () => {
            const r = enmascararCelda('estadoSituacion.descripcion', 'llamar al 1155578807 o a ana@x.com, DNI 30111222333');
            expect(r).not.toMatch(/1155578807|ana@|30111222333/);
        });

        it('un importe o una fecha no se tocan', () => {
            expect(enmascararCelda('saldo', '1.248.300,50')).toBe('1.248.300,50');
            expect(enmascararCelda('fechaVencimiento', '19/10/2026')).toBe('19/10/2026');
            expect(enmascararCelda('saldo', '1530000')).toBe('1530000');
        });
    });
});
