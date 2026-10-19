import { REEMPLAZO_NUMERO, numerosDeLaPersona, sinNumerosDeLaPersona, textosDeUsuario } from './no-repetir';

describe('no repetir los números de la persona (R16 del set de evaluación)', () => {
    const numeros = numerosDeLaPersona(['Armame el reporte del DNI 30111222 con todos sus pagos']);

    it('reemplaza el número de la persona, con o sin puntos, y deja los otros', () => {
        expect(sinNumerosDeLaPersona('Con el filtro `documento = 30111222` trae 8.412 casos.', numeros)).toBe(
            `Con el filtro \`documento = ${REEMPLAZO_NUMERO}\` trae 8.412 casos.`,
        );
        expect(sinNumerosDeLaPersona('El 30.111.222 tiene 3 pagos.', numeros)).toBe(`El ${REEMPLAZO_NUMERO} tiene 3 pagos.`);
        // Un número largo que no escribió la persona queda.
        expect(sinNumerosDeLaPersona('La remesa 1784036980243 y hace 90 días.', numeros)).toBe('La remesa 1784036980243 y hace 90 días.');
    });

    it('solo cuenta números de 7 dígitos o más en lo que escribió la persona', () => {
        expect([...numerosDeLaPersona(['de los últimos 90 días, saldo mayor a 10000, CUIT 20-30111222-9'])]).toEqual(['20301112229']);
        expect(sinNumerosDeLaPersona('Ningún número de la persona.', new Set())).toBe('Ningún número de la persona.');
    });

    it('lee también las preguntas anteriores de la conversación', () => {
        const previos = [
            { role: 'user' as const, content: [{ type: 'text' as const, text: 'El teléfono 1145678900' }] },
            { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'ok 9999999' }] },
        ];
        expect(textosDeUsuario(previos)).toEqual(['El teléfono 1145678900']);
    });
});
