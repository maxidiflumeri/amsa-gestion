import { esPosibleTelefono } from './phone-utils';

describe('phone-utils — esPosibleTelefono (filtro de basura para teléfonos no validados)', () => {
    describe('descarta basura evidente (pocos dígitos)', () => {
        it.each(['0', '1', '123', '45678', '1234567', '123456789', '', '   ', '-', 'N/A'])(
            'descarta %j',
            (v) => expect(esPosibleTelefono(v)).toBe(false),
        );
    });

    describe('descarta rellenos con corridas largas del mismo dígito', () => {
        // Ejemplos reales reportados por el usuario: característica válida (02941) pero abonado repetido.
        it.each([
            '(02941) 1111-1111',
            '(02941) 11111111',
            '0000000000',
            '1111111111',
            '02941 000000',
        ])('descarta %j', (v) => expect(esPosibleTelefono(v)).toBe(false));
    });

    describe('mantiene números con forma real aunque no validen (se cargan en rojo)', () => {
        it.each([
            '15-(02941) 64-3701', // celular real con prefijo 15, formato no estándar → 13 dígitos, dígitos variados
            '02941 164-3701',
            '1155775452',
            '(011) 4567-1234',
        ])('mantiene %j', (v) => expect(esPosibleTelefono(v)).toBe(true));
    });

    it('descarta números demasiado largos (> 15 dígitos)', () => {
        expect(esPosibleTelefono('1234567890123456')).toBe(false);
    });

    it('ignora separadores al contar dígitos', () => {
        // 10 dígitos con separadores → válido por forma
        expect(esPosibleTelefono('11-5577-5452')).toBe(true);
    });
});
