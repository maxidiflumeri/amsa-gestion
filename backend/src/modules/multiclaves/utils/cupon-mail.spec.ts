import { escapeHtml, formatearListaOr, mensajeCuponDefault, renderVariables, variablesPropiasCupon } from './cupon-mail';
import { importeEnLetras } from './importe-en-letras';

describe('renderVariables', () => {
    it('reemplaza {{variable}} por su valor', () => {
        expect(renderVariables('Tu cupón, {{nombre_cliente}}', { nombre_cliente: 'PEREZ JUAN' })).toBe('Tu cupón, PEREZ JUAN');
    });

    it('tolera espacios adentro de las llaves, igual que Sender', () => {
        expect(renderVariables('Hola {{ nombre_cliente }}', { nombre_cliente: 'Juan' })).toBe('Hola Juan');
    });

    it('una variable sin valor se reemplaza por cadena vacía', () => {
        expect(renderVariables('Hola {{nombre}}!', {})).toBe('Hola !');
    });

    it('sin variables en el texto, lo devuelve igual', () => {
        expect(renderVariables('Cupón de pago', { nombre_cliente: 'Juan' })).toBe('Cupón de pago');
    });
});

describe('escapeHtml', () => {
    it('escapa los cinco caracteres especiales de HTML', () => {
        expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
            '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;',
        );
    });

    it('tolera null/undefined sin explotar', () => {
        expect(escapeHtml(undefined as any)).toBe('');
        expect(escapeHtml(null as any)).toBe('');
    });
});

describe('formatearListaOr', () => {
    it('une con comas y "o" antes del último', () => {
        expect(formatearListaOr(['PAGO FACIL', 'RAPIPAGO', 'BAPRO PAGOS', 'COBRO EXPRESS'])).toBe(
            'PAGO FACIL, RAPIPAGO, BAPRO PAGOS o COBRO EXPRESS',
        );
    });

    it('con uno solo, ese sin conectores', () => {
        expect(formatearListaOr(['PAGO FACIL'])).toBe('PAGO FACIL');
    });

    it('con ninguno, cadena vacía', () => {
        expect(formatearListaOr([])).toBe('');
    });
});

describe('variablesPropiasCupon', () => {
    it('arma las seis variables del cupón, TOTAL', () => {
        const vars = variablesPropiasCupon({
            importeConSigno: '$ 39.760,03',
            importeCentavos: 3976003,
            vtoImpreso: '27/10/2026',
            tipo: 'TOTAL',
            nroTramite: '1841012140',
            nombreCliente: 'PEREZ JUAN',
            importeEnLetrasFn: importeEnLetras,
        });
        expect(vars).toEqual({
            importe_cupon: '$ 39.760,03',
            importe_cupon_letras: importeEnLetras(3976003),
            vencimiento_cupon: '27/10/2026',
            tipo_cupon: 'Saldo total',
            nro_tramite: '1841012140',
            nombre_cliente: 'PEREZ JUAN',
        });
    });

    it('QUITA da "Con quita 50%"', () => {
        const vars = variablesPropiasCupon({
            importeConSigno: '$ 19.880,01',
            importeCentavos: 1988001,
            vtoImpreso: '27/10/2026',
            tipo: 'QUITA',
            nroTramite: '1841012140',
            nombreCliente: 'PEREZ JUAN',
            importeEnLetrasFn: importeEnLetras,
        });
        expect(vars.tipo_cupon).toBe('Con quita 50%');
    });

    it('nunca incluye la clave de pago ni el código de barras (D6)', () => {
        const vars = variablesPropiasCupon({
            importeConSigno: '$ 1,00',
            importeCentavos: 100,
            vtoImpreso: '01/01/2026',
            tipo: 'TOTAL',
            nroTramite: '1',
            nombreCliente: 'X',
            importeEnLetrasFn: importeEnLetras,
        });
        expect(Object.keys(vars)).not.toContain('clave_pago');
        expect(Object.keys(vars)).not.toContain('codigo_barras');
    });
});

describe('mensajeCuponDefault', () => {
    it('arma asunto y HTML con los datos del cupón', () => {
        const { subject, html } = mensajeCuponDefault({
            nombreCliente: 'PEREZ JUAN',
            importeConSigno: '$ 19.880,01',
            vtoImpreso: '27/10/2026',
            mediosDePago: ['PAGO FACIL', 'RAPIPAGO', 'BAPRO PAGOS', 'COBRO EXPRESS'],
        });
        expect(subject).toBe('Cupón de pago - Personal');
        expect(html).toBe(
            '<p>Hola PEREZ JUAN:</p>' +
                '<p>Te enviamos adjunto el cupón de pago que solicitaste, por <strong>$ 19.880,01</strong>, ' +
                'con vencimiento el <strong>27/10/2026</strong>.</p>' +
                '<p>Podés abonarlo en PAGO FACIL, RAPIPAGO, BAPRO PAGOS o COBRO EXPRESS.</p>' +
                '<p>Ante cualquier consulta, respondé este correo.</p>',
        );
    });

    it('nombreComercial custom cambia el asunto', () => {
        const { subject } = mensajeCuponDefault({
            nombreCliente: 'X',
            importeConSigno: '$ 1,00',
            vtoImpreso: '01/01/2026',
            mediosDePago: ['PAGO FACIL'],
            nombreComercial: 'Telecom',
        });
        expect(subject).toBe('Cupón de pago - Telecom');
    });

    it('escapa el nombre del cliente: nunca interpola sin escapar (caso motivador del cambio)', () => {
        const { html } = mensajeCuponDefault({
            nombreCliente: '<script>alert(1)</script> O\'Connor & Cía',
            importeConSigno: '$ 1,00',
            vtoImpreso: '01/01/2026',
            mediosDePago: ['PAGO FACIL'],
        });
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; O&#39;Connor &amp; Cía');
    });

    it('con un solo medio de pago no agrega conectores de más', () => {
        const { html } = mensajeCuponDefault({
            nombreCliente: 'X',
            importeConSigno: '$ 1,00',
            vtoImpreso: '01/01/2026',
            mediosDePago: ['PAGO FACIL'],
        });
        expect(html).toContain('Podés abonarlo en PAGO FACIL.');
    });
});
