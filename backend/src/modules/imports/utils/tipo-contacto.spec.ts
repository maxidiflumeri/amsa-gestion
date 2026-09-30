import {
    canonizarTiposContactoPlantilla,
    normalizarTipoContacto,
    prepararContactoImport,
} from './contacto-import';
import { EnriquecimientoProcessor } from '../processors/enriquecimiento.processor';
import { ProcessContext } from '../processors/processor.interface';

/**
 * El tipo de contacto tipeado a mano en una plantilla.
 *
 * La plantilla 87 de Personal tenía `Teléfono` (con acento) en el tipo fijo de los campos
 * principales. El backend comparaba contra `telefono`, no matcheaba, y el contacto se guardaba con
 * tipo `teléfono`: la carga daba "exitoso" y la ficha, que filtra por telefono/email/direccion, no
 * mostraba ninguno. Mismo caso con `Mail` (30/09/2026).
 */

describe('normalizarTipoContacto', () => {
    it.each([
        ['Teléfono', 'telefono'],
        ['TELEFONO', 'telefono'],
        ['  telefono ', 'telefono'],
        ['Celular', 'telefono'],
        ['WhatsApp', 'telefono'],
        ['Mail', 'email'],
        ['E-mail', 'email'],
        ['EMAIL', 'email'],
        ['Dirección', 'direccion'],
        ['DIRECCION', 'direccion'],
        ['RED_SOCIAL', 'red_social'],
        ['OTRO', 'otro'],
    ])('%s → %s', (entrada, esperado) => {
        expect(normalizarTipoContacto(entrada)).toBe(esperado);
    });

    it('vacío es telefono, como siempre', () => {
        expect(normalizarTipoContacto(undefined)).toBe('telefono');
        expect(normalizarTipoContacto('')).toBe('telefono');
    });

    it('no reconoce basura (ej. tipo y valor invertidos, caso CERTERO)', () => {
        expect(normalizarTipoContacto('0111525019898')).toBeNull();
        expect(normalizarTipoContacto('Teléfono particular')).toBeNull();
    });
});

describe('prepararContactoImport con el tipo tipeado a mano', () => {
    it('"Teléfono" se guarda como telefono normalizado', async () => {
        const prep = await prepararContactoImport({ tipo: 'Teléfono', valor: '2612058963' });
        expect(prep).toEqual({ tipo: 'telefono', valor: '+542612058963', validado: true });
    });

    it('un tipo que no se reconoce es un error, no un contacto invisible', async () => {
        await expect(prepararContactoImport({ tipo: 'Tel. part', valor: '2612058963' })).rejects.toThrow(
            /Tipo de contacto no reconocido/,
        );
    });
});

describe('EnriquecimientoProcessor.validateRow', () => {
    const proc = new EnriquecimientoProcessor();
    const ctx = {} as ProcessContext;

    it('acepta "Teléfono"', () => {
        expect(proc.validateRow({ documento: '1', tipo: 'Teléfono', valor: '2612058963' } as any, ctx).valid).toBe(true);
    });

    it('rechaza la fila con un tipo que no se reconoce', () => {
        const r = proc.validateRow({ documento: '1', tipo: 'Tel. part', valor: '2612058963' } as any, ctx);
        expect(r.valid).toBe(false);
        expect(r.error).toMatch(/Tipo de contacto no reconocido/);
    });
});

describe('canonizarTiposContactoPlantilla', () => {
    // El mapping de la plantilla 87 tal como estaba en prod.
    const mapping87 = () => ({
        entity: 'ENRIQ_MIXTO',
        columns: {
            tipo: { fromIndex: -1, staticValue: 'Teléfono' },
            valor: { fromIndex: 7, transforms: ['trim'] },
        },
        blocks: [{ entity: 'CONTACTO', columns: { tipo: { fromIndex: -1, staticValue: 'Mail' } } }],
    });

    it('deja los tipos como los manda el desplegable', () => {
        const m = mapping87();
        expect(canonizarTiposContactoPlantilla(m, 'ENRIQUECIMIENTO')).toEqual([]);
        expect(m.columns.tipo.staticValue).toBe('TELEFONO');
        expect(m.blocks[0].columns.tipo.staticValue).toBe('EMAIL');
    });

    it('devuelve los que no reconoce', () => {
        const m = mapping87();
        m.columns.tipo.staticValue = 'Tel. part';
        expect(canonizarTiposContactoPlantilla(m, 'ENRIQUECIMIENTO')).toEqual(['Tel. part']);
    });

    it('no toca el `tipo` principal de categorías donde no es un contacto', () => {
        const m = { columns: { tipo: { fromIndex: -1, staticValue: 'CUALQUIERA' } } };
        expect(canonizarTiposContactoPlantilla(m, 'PAGOS')).toEqual([]);
        expect(m.columns.tipo.staticValue).toBe('CUALQUIERA');
    });

    it('ignora el tipo tomado de una columna', () => {
        const m = { columns: { tipo: { fromIndex: 3 } } };
        expect(canonizarTiposContactoPlantilla(m, 'CONTACTOS')).toEqual([]);
    });
});
