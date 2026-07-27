import * as fs from 'fs';
import * as path from 'path';
import { parseMultirregistro } from './multirregistro-parser';
import { TOYOTA_87_MULTIRREGISTRO as CONFIG_TOYOTA_87 } from '../plantillas/toyota-87';

/** Línea de 700 caracteres como las que manda el cedente (padding con espacios). */
const pad = (s: string) => s + ' '.repeat(Math.max(0, 700 - s.length));
const armar = (...lineas: string[]) => Buffer.from(lineas.map(pad).join('\r\n'), 'latin1');

describe('multirregistro-parser — casos base', () => {
    it('arma un caso con su factura, sumando los DET del aviso', () => {
        const buf = armar(
            'CLI;346395 ;BIANCIOTTI LUCIANA;BV 25 DE MAYO;390;;;2415;PORTEÑA;04;CORDOBA;J;lv@gmail.com;03564;450132;15561795',
            'GES;100985;346395 ;2009869;5344937;170502;28/04/2026;55406.65;06/05/2026',
            'DET;170502;(E12-U10) Comisión Gestoria Multas;45790.62;0.00;0',
            'DET;170502;(E12-U15 )Cob IVA ctr fin 346395;9616.03;0.00;0',
            'DET;170502;Cargo por Pago Fuera de Termino;0.00;180.90;0',
            'DET;170502;Días de Mora;0.00;0.00;87',
        );
        const r = parseMultirregistro(buf, CONFIG_TOYOTA_87);

        expect(r.resumen.casos).toBe(1);
        expect(r.resumen.facturas).toBe(1);
        const caso = r.filas[0];
        expect(caso.nroCliente).toBe('346395');
        expect(caso.nombre).toBe('BIANCIOTTI LUCIANA');

        const facturas = caso._blocks!.filter((b) => b.entity === 'FACTURA');
        expect(facturas).toHaveLength(1);
        // 45790.62 + 9616.03 = 55406.65 → el mismo total que trae el GES en col8.
        expect(facturas[0].data.importe).toBeCloseTo(55406.65, 2);
        expect(facturas[0].data.nroFactura).toBe('170502');
        expect(facturas[0].data.contrato).toBe('2009869');
    });

    it('el desglose omite el ruido del formato y deja los días de mora al final', () => {
        const buf = armar(
            'CLI;346395 ;X;C;1;;;2415;L;04;P;J;;011;4444;',
            'GES;1;346395 ;2009869;9;170502;;;',
            'DET;170502;(E12-U10) Multa;100.00;0.00;0',
            'DET;170502;Cargo por Pago Fuera de Termino;0.00;180.90;0',
            'DET;170502;Días de Mora;0.00;0.00;87',
        );
        const d = parseMultirregistro(buf, CONFIG_TOYOTA_87).filas[0]._blocks!
            .find((b) => b.entity === 'FACTURA')!.data.detalle;

        expect(d).toBe('(E12-U10) Multa: 100.00 | Días de mora: 87');
        expect(d).not.toContain('Fuera de Termino');
    });

    it('respeta el signo de las notas de crédito (importes negativos)', () => {
        const buf = armar(
            'CLI;103966 ;X;C;1;;;2415;L;04;P;J;;011;4444;',
            'GES;1;103966 ;2001170;9;171035;;;',
            'DET;171035;(E12-U10) Cargo por Transferencia Leasin;551017.44;0.00;0',
            'DET;171035;ACR-Remanente Anticipo-271540;-447173.03;0.00;0',
        );
        const f = parseMultirregistro(buf, CONFIG_TOYOTA_87).filas[0]._blocks!
            .find((b) => b.entity === 'FACTURA')!;
        expect(f.data.importe).toBeCloseTo(103844.41, 2);
    });

    it('un cliente con varios contratos genera una factura por aviso', () => {
        const buf = armar(
            'CLI;103966 ;MALDONADO JUAN;DARWIN;1554;;;1000;CABA;01;CABA;F;a@b.c;011;47770395;38961894',
            'GES;101272;103966 ;2000853;9;170895;;;',
            'GES;101273;103966 ;2000854;9;170896;;;',
            'DET;170895;(E12-U10) Honorario Gestoria;30527.08;0.00;0',
            'DET;170896;(E12-U10) Honorario Gestoria;30527.08;0.00;0',
        );
        const r = parseMultirregistro(buf, CONFIG_TOYOTA_87);
        expect(r.resumen.casos).toBe(1);
        const fs_ = r.filas[0]._blocks!.filter((b) => b.entity === 'FACTURA');
        expect(fs_).toHaveLength(2);
        expect(fs_.map((f) => f.data.contrato).sort()).toEqual(['2000853', '2000854']);
    });

    it('arma los contactos anteponiendo el código de área a cada teléfono', () => {
        const buf = armar(
            'CLI;346395 ;X;C;1;;;2415;L;04;P;J;mail@x.com;0341;4818748;156294587',
            'GES;1;346395 ;2009869;9;170502;;;',
            'DET;170502;Multa;10.00;0.00;0',
        );
        const cs = parseMultirregistro(buf, CONFIG_TOYOTA_87).filas[0]._blocks!
            .filter((b) => b.entity === 'CONTACTO');
        expect(cs).toEqual([
            { entity: 'CONTACTO', data: { tipo: 'telefono', valor: '03414818748' } },
            { entity: 'CONTACTO', data: { tipo: 'telefono', valor: '0341156294587' } },
            { entity: 'CONTACTO', data: { tipo: 'email', valor: 'mail@x.com' } },
        ]);
    });

    it('emite las bajas como filas propias', () => {
        const buf = armar('BAJ;171412;24/07/2026;Pago de Cuota/Aviso');
        const r = parseMultirregistro(buf, CONFIG_TOYOTA_87);
        expect(r.resumen.bajas).toBe(1);
        expect(r.filas[0]).toMatchObject({ _tipo: 'BAJA', aviso: '171412', motivo: 'Pago de Cuota/Aviso' });
    });
});

describe('multirregistro-parser — encoding y bordes', () => {
    it('decodifica Latin-1 (si se leyera como UTF-8 las Ñ y acentos se rompen)', () => {
        const buf = armar('CLI;1 ;ACUÑA HAEDO IVÁN;PEÑA;1;;;2415;L;04;P;F;;011;4444;', 'GES;1;1 ;C1;9;A1;;;', 'DET;A1;Multa;1.00;0.00;0');
        expect(parseMultirregistro(buf, CONFIG_TOYOTA_87).filas[0].nombre).toBe('ACUÑA HAEDO IVÁN');
        // Leído como UTF-8 el mismo buffer sale corrupto: deja constancia de por qué importa.
        expect(parseMultirregistro(buf, { ...CONFIG_TOYOTA_87, encoding: 'utf8' }).filas[0].nombre)
            .not.toBe('ACUÑA HAEDO IVÁN');
    });

    it('avisa y omite el caso si un GES no tiene su ficha CLI', () => {
        const buf = armar('GES;1;999999 ;C1;9;A1;;;', 'DET;A1;Multa;1.00;0.00;0');
        const r = parseMultirregistro(buf, CONFIG_TOYOTA_87);
        expect(r.resumen.casos).toBe(0);
        expect(r.advertencias.join()).toContain('999999');
    });

    it('avisa si un cliente vino sin ningún aviso', () => {
        const buf = armar('CLI;5 ;SOLO FICHA;C;1;;;2415;L;04;P;J;;011;1;');
        const r = parseMultirregistro(buf, CONFIG_TOYOTA_87);
        expect(r.resumen.casos).toBe(0);
        expect(r.advertencias.join()).toContain('sin ningún aviso');
    });

    it('cuenta como ignoradas las líneas con un código desconocido', () => {
        const buf = armar('XXX;basura;1;2', 'CLI;1 ;X;C;1;;;2415;L;04;P;J;;011;1;', 'GES;1;1 ;C1;9;A1;;;', 'DET;A1;M;1.00;0.00;0');
        expect(parseMultirregistro(buf, CONFIG_TOYOTA_87).resumen.ignoradas).toBe(1);
    });

    it('no crea dos veces el mismo cliente ni el mismo aviso repetido', () => {
        const buf = armar(
            'CLI;7 ;PRIMERA;C;1;;;2415;L;04;P;J;;011;1;',
            'CLI;7 ;SEGUNDA;C;1;;;2415;L;04;P;J;;011;1;',
            'GES;1;7 ;C1;9;A1;;;',
            'GES;2;7 ;C1;9;A1;;;',
            'DET;A1;M;5.00;0.00;0',
        );
        const r = parseMultirregistro(buf, CONFIG_TOYOTA_87);
        expect(r.resumen.casos).toBe(1);
        expect(r.filas[0].nombre).toBe('PRIMERA');
        expect(r.filas[0]._blocks!.filter((b) => b.entity === 'FACTURA')).toHaveLength(1);
        expect(r.advertencias.join()).toMatch(/repetid/);
    });
});

/**
 * Verificación contra el archivo real del cedente. Es la prueba que importa: valida el parser
 * contra el formato de verdad, no contra el que creemos que es. Si el archivo no está presente
 * (otra máquina, CI) el bloque se saltea en vez de fallar.
 */
const ARCHIVO_REAL = '/home/maxi/Descargas/deuda_agencia_20260724_203044.txt';
const hayArchivo = fs.existsSync(ARCHIVO_REAL);
(hayArchivo ? describe : describe.skip)('multirregistro-parser — archivo real de Toyota (2026-07-24)', () => {
    let r: ReturnType<typeof parseMultirregistro>;
    beforeAll(() => { r = parseMultirregistro(fs.readFileSync(ARCHIVO_REAL), CONFIG_TOYOTA_87); });

    it('reconoce los cuatro tipos de línea sin dejar nada afuera', () => {
        expect(r.resumen.lineas).toBe(1720);
        expect(r.resumen.porTipo).toMatchObject({ GES: 271, CLI: 162, DET: 1277, BAJ: 10 });
        expect(r.resumen.ignoradas).toBe(0);
    });

    it('arma 162 casos, 271 facturas y 10 bajas', () => {
        expect(r.resumen.casos).toBe(162);
        expect(r.resumen.facturas).toBe(271);
        expect(r.resumen.bajas).toBe(10);
    });

    it('el importe calculado de cada factura coincide con el total que trae el GES', () => {
        // Totales por aviso leídos directamente del archivo (col8 del GES).
        const esperado = new Map<string, number>();
        for (const linea of fs.readFileSync(ARCHIVO_REAL, 'latin1').split(/\r?\n/)) {
            const c = linea.split(';');
            if ((c[0] ?? '').trim() === 'GES') esperado.set(c[5].trim(), Number(c[7]));
        }
        let comparadas = 0;
        for (const fila of r.filas.filter((f) => f._tipo === 'CASO')) {
            for (const b of fila._blocks!.filter((x) => x.entity === 'FACTURA')) {
                expect(b.data.importe).toBeCloseTo(esperado.get(b.data.nroFactura)!, 2);
                comparadas++;
            }
        }
        expect(comparadas).toBe(271);
    });

    it('no genera advertencias sobre el archivo real', () => {
        expect(r.advertencias).toEqual([]);
    });

    it('respeta los acentos y las Ñ de los nombres', () => {
        const nombres = r.filas.filter((f) => f._tipo === 'CASO').map((f) => f.nombre as string);
        expect(nombres).toContain('ACUÑA HAEDO IVÁN');
        expect(nombres.join()).not.toContain('�');
    });
});
