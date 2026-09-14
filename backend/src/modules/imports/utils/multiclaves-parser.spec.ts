import * as fs from 'fs';
import * as path from 'path';
import { MulticlavesArchivoInvalidoError, parseMulticlaves } from './multiclaves-parser';
import { MULTICLAVES_ENCABEZADO } from '../plantillas/telecom-multiclaves';
import { dvModulo10_31 } from '../../multiclaves/utils/clave-pago';

const CFG = { codigosGestor: ['1008'] };
const HOY = new Date('2026-09-14T12:00:00Z');
const HEADER = MULTICLAVES_ENCABEZADO.join('|');

/** Arma un "archivo" en memoria a partir de líneas de datos (sin encabezado). */
function archivoConHeader(nombre: string, ...lineasDeDatos: string[]) {
    return { nombre, buffer: Buffer.from([HEADER, ...lineasDeDatos].join('\n'), 'latin1') };
}

function archivoSinHeader(nombre: string, ...lineasDeDatos: string[]) {
    return { nombre, buffer: Buffer.from(lineasDeDatos.join('\n'), 'latin1') };
}

/**
 * Arma una CLAVE_PAGO (22 dígitos) o un SEC_COD_BARRA (50 dígitos) estructuralmente válidos, con
 * el DV calculado por el mismo algoritmo del parser — para construir líneas de prueba sintéticas
 * sin adivinar dígitos verificadores a mano.
 */
function construirClave(convenio: string, centavos: number): string {
    const cuerpo = '00' + convenio + String(centavos).padStart(11, '0');
    return cuerpo + dvModulo10_31(cuerpo);
}

function construirCodigoBarras(convenio: string, centavos: number, vtoYYYYMMDD: string): string {
    const vtoDDMMYYYY = vtoYYYYMMDD.slice(6, 8) + vtoYYYYMMDD.slice(4, 6) + vtoYYYYMMDD.slice(0, 4);
    const cuerpo = '498' + String(centavos).padStart(10, '0') + vtoDDMMYYYY + '0'.repeat(12) + convenio + '0'.repeat(8);
    return cuerpo + dvModulo10_31(cuerpo);
}

/** Arma una línea de datos completa y auto-consistente (clave y código de barras calzan). */
function construirLinea(opts: {
    tramite: string; convenio: string; saldoCentavos: number; importeCentavos: number;
    vtoYYYYMMDD?: string; marca?: string; gestor?: string;
}): string {
    const vto = opts.vtoYYYYMMDD ?? '20261027';
    const marca = opts.marca ?? 'C';
    const gestor = opts.gestor ?? '1008';
    return [
        opts.tramite,
        opts.convenio,
        (opts.saldoCentavos / 100).toFixed(2),
        (opts.importeCentavos / 100).toFixed(2),
        construirClave(opts.convenio, opts.importeCentavos),
        vto,
        construirCodigoBarras(opts.convenio, opts.importeCentavos, vto),
        gestor,
        'Ana Maya S.A.',
        marca,
    ].join('|');
}

// Líneas reales de MULTI_41645_RA_1008_2026-08-31_10.29.22.csv, copiadas del archivo de muestra.
const L2 = '1841012140|96311343|39760.03|39760.03|0096311343000039760032|20261027|49800039760032710202600000000000096311343000000009|1008|Ana Maya S.A.|C';
const L3 = '1841012140|96332206|39760.03|19880.01|0096332206000019880014|20261027|49800019880012710202600000000000096332206000000007|1008|Ana Maya S.A.|C';
const L14 = '1843717636|96326464|94972.8|94972.8|0096326464000094972803|20261027|49800094972802710202600000000000096326464000000008|1008|Ana Maya S.A.|C';
const L15 = '1843717636|96331461|94972.8|47486.4|0096331461000047486408|20261027|49800047486402710202600000000000096331461000000007|1008|Ana Maya S.A.|C';
const L16 = '1843742390|96350137|121143.49|121143.49|0096350137000121143491|20261027|49800121143492710202600000000000096350137000000002|1008|Ana Maya S.A.|C';
const L17 = '1843742390|96353768|121143.49|60571.75|0096353768000060571756|20261027|49800060571752710202600000000000096353768000000005|1008|Ana Maya S.A.|C';
const L20 = '1844590902|96340897|62709|62709|0096340897000062709004|20261027|49800062709002710202600000000000096340897000000005|1008|Ana Maya S.A.|C';
const L21 = '1844590902|96362965|62709|31354.5|0096362965000031354503|20261027|49800031354502710202600000000000096362965000000000|1008|Ana Maya S.A.|C';
const L12294 = '2598157072|96315830|16414.17|16414.17|0096315830000016414179|20261027|49800016414172710202600000000000096315830000000008|1008|Ana Maya S.A.|C';
const L12295 = '2598157072|96319178|32828.35|32828.35|0096319178000032828351|20261027|49800032828352710202600000000000096319178000000004|1008|Ana Maya S.A.|C';
const L12850 = '2598290522|96308508|13738.79|13738.79|0096308508000013738793|20261027|49800013738792710202600000000000096308508000000004|1008|Ana Maya S.A.|C';
const L12851 = '2598290522|96327144|27477.59|27477.59|0096327144000027477593|20261027|49800027477592710202600000000000096327144000000002|1008|Ana Maya S.A.|C';

describe('parseMulticlaves — casos reales del archivo de muestra', () => {
    it('líneas 2-3 (1841012140): QUITA 19880.01 (mitad truncada), TOTAL 39760.03', () => {
        const r = parseMulticlaves([archivoConHeader('a.csv', L2, L3)], CFG, HOY);
        expect(r.resumen.rechazados).toBe(0);
        const t = r.tramites.find((x) => x.nroTramite === '1841012140')!;
        expect(t.rechazo).toBeUndefined();
        expect(t.saldoTramiteCentavos).toBe(3976003);
        const total = t.claves!.find((c) => c.tipo === 'TOTAL')!;
        const quita = t.claves!.find((c) => c.tipo === 'QUITA')!;
        expect(total.importeCentavos).toBe(3976003);
        expect(quita.importeCentavos).toBe(1988001);
        expect(quita.nroConvenio).toBe('96332206');
    });

    it('líneas 16-17 (1843742390): QUITA 60571.75 (mitad redondeada hacia arriba)', () => {
        const r = parseMulticlaves([archivoConHeader('a.csv', L16, L17)], CFG, HOY);
        const t = r.tramites.find((x) => x.nroTramite === '1843742390')!;
        expect(t.rechazo).toBeUndefined();
        const quita = t.claves!.find((c) => c.tipo === 'QUITA')!;
        expect(quita.importeCentavos).toBe(6057175);
        expect(r.resumen.porAviso['QUITA_NO_ES_MITAD'] ?? 0).toBe(0);
    });

    it('líneas 14-15 (1843717636): importes con 1 decimal (94972.8 / 47486.4)', () => {
        const r = parseMulticlaves([archivoConHeader('a.csv', L14, L15)], CFG, HOY);
        const t = r.tramites.find((x) => x.nroTramite === '1843717636')!;
        expect(t.rechazo).toBeUndefined();
        const total = t.claves!.find((c) => c.tipo === 'TOTAL')!;
        const quita = t.claves!.find((c) => c.tipo === 'QUITA')!;
        expect(total.importeCentavos).toBe(9497280);
        expect(quita.importeCentavos).toBe(4748640);
    });

    it('líneas 20-21 (1844590902): importe sin decimales (62709) y quita con 1 decimal (31354.5)', () => {
        const r = parseMulticlaves([archivoConHeader('a.csv', L20, L21)], CFG, HOY);
        const t = r.tramites.find((x) => x.nroTramite === '1844590902')!;
        expect(t.rechazo).toBeUndefined();
        const total = t.claves!.find((c) => c.tipo === 'TOTAL')!;
        const quita = t.claves!.find((c) => c.tipo === 'QUITA')!;
        expect(total.importeCentavos).toBe(6270900);
        expect(quita.importeCentavos).toBe(3135450);
    });

    it('líneas 12294-12295 (2598157072): QUITA primero en el archivo, TOTAL segundo, aviso SALDO_DISTINTO_ENTRE_FILAS', () => {
        const r = parseMulticlaves([archivoConHeader('a.csv', L12294, L12295)], CFG, HOY);
        const t = r.tramites.find((x) => x.nroTramite === '2598157072')!;
        expect(t.rechazo).toBeUndefined();
        const total = t.claves!.find((c) => c.tipo === 'TOTAL')!;
        const quita = t.claves!.find((c) => c.tipo === 'QUITA')!;
        expect(quita.importeCentavos).toBe(1641417); // 16414.17
        expect(total.importeCentavos).toBe(3282835); // 32828.35
        // El saldoTramite guardado es el de la fila TOTAL (32828.35), no el de la QUITA.
        expect(t.saldoTramiteCentavos).toBe(3282835);
        expect(r.resumen.porAviso['SALDO_DISTINTO_ENTRE_FILAS']).toBe(1);
    });

    it('líneas 12850-12851 (2598290522): mismo patrón, QUITA 13738.79 / TOTAL 27477.59', () => {
        const r = parseMulticlaves([archivoConHeader('a.csv', L12850, L12851)], CFG, HOY);
        const t = r.tramites.find((x) => x.nroTramite === '2598290522')!;
        const total = t.claves!.find((c) => c.tipo === 'TOTAL')!;
        const quita = t.claves!.find((c) => c.tipo === 'QUITA')!;
        expect(quita.importeCentavos).toBe(1373879);
        expect(total.importeCentavos).toBe(2747759);
        expect(r.resumen.porAviso['SALDO_DISTINTO_ENTRE_FILAS']).toBe(1);
    });

    it('la clasificación TOTAL/QUITA no depende del orden en el archivo', () => {
        // 1841012140: TOTAL primero. 2598157072: QUITA primero. Las dos clasifican por importe.
        const r = parseMulticlaves(
            [archivoConHeader('a.csv', L2, L3, L12294, L12295)],
            CFG,
            HOY,
        );
        for (const nro of ['1841012140', '2598157072']) {
            const t = r.tramites.find((x) => x.nroTramite === nro)!;
            const total = t.claves!.find((c) => c.tipo === 'TOTAL')!;
            const quita = t.claves!.find((c) => c.tipo === 'QUITA')!;
            expect(total.importeCentavos).toBeGreaterThan(quita.importeCentavos);
        }
    });

    it('un trámite partido (filas no contiguas) se agrupa igual', () => {
        // L2 y L3 son del mismo trámite; se intercala una fila de otro trámite en el medio.
        const r = parseMulticlaves(
            [archivoConHeader('a.csv', L2, L16, L3, L17)],
            CFG,
            HOY,
        );
        const t1 = r.tramites.find((x) => x.nroTramite === '1841012140')!;
        expect(t1.rechazo).toBeUndefined();
        expect(t1.claves).toHaveLength(2);
    });
});

describe('parseMulticlaves — rechazos', () => {
    it('una línea con el DV de la clave alterado da CLAVE_DV y rechaza el trámite entero', () => {
        const l3 = construirLinea({ tramite: '1841012140', convenio: '96332206', saldoCentavos: 3976003, importeCentavos: 1988001 });
        // Se altera el último dígito de la CLAVE_PAGO (el DV) sin tocar nada más.
        const claveRota = l3.split('|');
        const dvOriginal = claveRota[4].slice(-1);
        const dvAlterado = String((Number(dvOriginal) + 1) % 10);
        claveRota[4] = claveRota[4].slice(0, -1) + dvAlterado;
        const l3Corrupta = claveRota.join('|');

        const r = parseMulticlaves([archivoConHeader('a.csv', L2, l3Corrupta)], CFG, HOY);
        const t = r.tramites.find((x) => x.nroTramite === '1841012140')!;
        expect(t.rechazo?.motivo).toBe('TRAMITE_INCOMPLETO');
        expect(t.rechazo?.detalle).toContain('CLAVE_DV');
    });

    it('3 claves para un mismo trámite → TRAMITE_INCOMPLETO', () => {
        const tercera = construirLinea({ tramite: '1841012140', convenio: '96399999', saldoCentavos: 3976003, importeCentavos: 500000 });
        const r = parseMulticlaves([archivoConHeader('a.csv', L2, L3, tercera)], CFG, HOY);
        const t = r.tramites.find((x) => x.nroTramite === '1841012140')!;
        expect(t.rechazo?.motivo).toBe('TRAMITE_INCOMPLETO');
        expect(t.rechazo?.detalle).toContain('3 línea(s)');
        // Las líneas crudas quedan guardadas (van a `importerror.rawRow` para reclamarle al cedente).
        expect(t.lineasCrudas).toEqual([L2, L3, tercera]);
    });

    it('un trámite con 2 líneas válidas MÁS una tercera con el DV roto rechaza el trámite entero (no la descarta en silencio)', () => {
        const tercera = construirLinea({ tramite: '1841012140', convenio: '96399999', saldoCentavos: 3976003, importeCentavos: 500000 });
        const campos = tercera.split('|');
        const dvOriginal = campos[4].slice(-1);
        campos[4] = campos[4].slice(0, -1) + String((Number(dvOriginal) + 1) % 10);
        const terceraDvRoto = campos.join('|');

        const r = parseMulticlaves([archivoConHeader('a.csv', L2, L3, terceraDvRoto)], CFG, HOY);
        const t = r.tramites.find((x) => x.nroTramite === '1841012140')!;
        expect(t.rechazo?.motivo).toBe('TRAMITE_INCOMPLETO');
        expect(t.rechazo?.detalle).toContain('3 línea(s)');
        expect(t.rechazo?.detalle).toContain('CLAVE_DV'); // la tercera línea no desaparece sin dejar rastro
        expect(t.claves).toBeUndefined(); // no se cargan ni L2 ni L3, aunque las dos fueran válidas
    });

    it('un trámite con 2 líneas válidas MÁS una tercera con gestor ajeno también rechaza el trámite entero', () => {
        const tercera = construirLinea({ tramite: '1841012140', convenio: '96399999', saldoCentavos: 3976003, importeCentavos: 500000, gestor: '9999' });
        const r = parseMulticlaves([archivoConHeader('a.csv', L2, L3, tercera)], CFG, HOY);
        const t = r.tramites.find((x) => x.nroTramite === '1841012140')!;
        expect(t.rechazo?.motivo).toBe('TRAMITE_INCOMPLETO');
        expect(t.rechazo?.detalle).toContain('3 línea(s)');
        expect(t.rechazo?.detalle).toContain('GESTOR_AJENO');
        expect(t.claves).toBeUndefined();
    });

    it('importes iguales entre las dos claves → IMPORTES_IGUALES', () => {
        const a = construirLinea({ tramite: '1841012140', convenio: '96311343', saldoCentavos: 3976003, importeCentavos: 3976003 });
        const b = construirLinea({ tramite: '1841012140', convenio: '96332206', saldoCentavos: 3976003, importeCentavos: 3976003 });
        const r = parseMulticlaves([archivoConHeader('a.csv', a, b)], CFG, HOY);
        const t = r.tramites.find((x) => x.nroTramite === '1841012140')!;
        expect(t.rechazo?.motivo).toBe('IMPORTES_IGUALES');
        // Las dos líneas son individualmente válidas (DV, formato) pero el trámite se rechaza
        // igual: no tienen que sumar a `resumen.claves` (esas claves no se cargan).
        expect(r.resumen.claves).toBe(0);
        expect(r.resumen.clavesRechazadas).toBe(2);
    });

    it('resumen.claves cuenta solo las de trámites aceptados; resumen.clavesRechazadas, las que quedaron afuera', () => {
        // Un trámite bueno (2 claves que se cargan) + uno con importes iguales (2 líneas válidas
        // que no se cargan).
        const bueno = [L2, L3];
        const igualesA = construirLinea({ tramite: '9999999999', convenio: '96399991', saldoCentavos: 100000, importeCentavos: 100000 });
        const igualesB = construirLinea({ tramite: '9999999999', convenio: '96399992', saldoCentavos: 100000, importeCentavos: 100000 });
        const r = parseMulticlaves([archivoConHeader('a.csv', ...bueno, igualesA, igualesB)], CFG, HOY);

        expect(r.resumen.claves).toBe(2); // solo las del trámite bueno
        expect(r.resumen.clavesRechazadas).toBe(2); // las del trámite con importes iguales
    });

    it('código de barras con otro vencimiento que la columna FECHA_VENCIMIENTO → BARRA_NO_COINCIDE', () => {
        const total = construirLinea({ tramite: '1841012140', convenio: '96311343', saldoCentavos: 3976003, importeCentavos: 3976003 });
        // La QUITA se arma con el código de barras calculado para OTRA fecha (28/10 en vez de 27/10),
        // pero la columna FECHA_VENCIMIENTO sigue diciendo 20261027: no coinciden.
        const quitaConvenio = '96332206';
        const quitaCentavos = 1988001;
        const cbOtraFecha = construirCodigoBarras(quitaConvenio, quitaCentavos, '20261028');
        const quita = [
            '1841012140', quitaConvenio, '39760.03', '19880.01',
            construirClave(quitaConvenio, quitaCentavos), '20261027', cbOtraFecha, '1008', 'Ana Maya S.A.', 'C',
        ].join('|');

        const r = parseMulticlaves([archivoConHeader('a.csv', total, quita)], CFG, HOY);
        const t = r.tramites.find((x) => x.nroTramite === '1841012140')!;
        expect(t.rechazo?.motivo).toBe('TRAMITE_INCOMPLETO');
        expect(t.rechazo?.detalle).toContain('BARRA_NO_COINCIDE');
    });

    it('SALDO_TRAMITE en 0 → SALDO_INVALIDO (se rechaza, no se carga con saldo vacío)', () => {
        const l3SaldoCero = construirLinea({ tramite: '1841012140', convenio: '96332206', saldoCentavos: 0, importeCentavos: 1988001 });
        const r = parseMulticlaves([archivoConHeader('a.csv', L2, l3SaldoCero)], CFG, HOY);
        const t = r.tramites.find((x) => x.nroTramite === '1841012140')!;
        expect(t.rechazo?.detalle).toContain('SALDO_INVALIDO');
    });

    it('CODIGO_GESTOR ajeno → GESTOR_AJENO', () => {
        const l3OtroGestor = construirLinea({ tramite: '1841012140', convenio: '96332206', saldoCentavos: 3976003, importeCentavos: 1988001, gestor: '9999' });
        const r = parseMulticlaves([archivoConHeader('a.csv', L2, l3OtroGestor)], CFG, HOY);
        const t = r.tramites.find((x) => x.nroTramite === '1841012140')!;
        expect(t.rechazo?.detalle).toContain('GESTOR_AJENO');
    });

    it('NRO_CONVENIO repetido en el archivo → CONVENIO_REPETIDO_EN_ARCHIVO', () => {
        // Repite L2 completa bajo otro trámite, mismo convenio (96311343).
        const l2OtroTramite = '9999999999' + L2.slice(L2.indexOf('|'));
        const r = parseMulticlaves([archivoConHeader('a.csv', L2, l2OtroTramite)], CFG, HOY);
        const duplicado = r.tramites.find((x) => x.nroTramite === '9999999999')!;
        expect(duplicado.rechazo?.detalle).toContain('CONVENIO_REPETIDO_EN_ARCHIVO');
    });

    it('sin la 10ª columna (marca) → aviso MARCA_DESCONOCIDA, carga igual', () => {
        const sinMarca = (l: string) => l.slice(0, l.lastIndexOf('|'));
        const r = parseMulticlaves([archivoConHeader('a.csv', sinMarca(L2), sinMarca(L3))], CFG, HOY);
        const t = r.tramites.find((x) => x.nroTramite === '1841012140')!;
        expect(t.rechazo).toBeUndefined();
        expect(r.resumen.porAviso['MARCA_DESCONOCIDA']).toBe(1);
    });

    it('con la 10ª columna distinta de C → aviso MARCA_DESCONOCIDA, carga igual', () => {
        const conX = (l: string) => l.slice(0, l.lastIndexOf('|') + 1) + 'X';
        const r = parseMulticlaves([archivoConHeader('a.csv', conX(L2), conX(L3))], CFG, HOY);
        const t = r.tramites.find((x) => x.nroTramite === '1841012140')!;
        expect(t.rechazo).toBeUndefined();
        expect(r.resumen.porAviso['MARCA_DESCONOCIDA']).toBe(1);
    });
});

describe('parseMulticlaves — forma del archivo', () => {
    it('un BOM UTF-8 al principio del archivo no rompe la detección del encabezado', () => {
        const bomLatin1 = Buffer.from([0xef, 0xbb, 0xbf]); // BOM UTF-8, tal cual llega si se lee como latin1
        const buffer = Buffer.concat([bomLatin1, Buffer.from([HEADER, L2, L3].join('\n'), 'latin1')]);
        const r = parseMulticlaves([{ nombre: 'con-bom.csv', buffer }], CFG, HOY);
        const t = r.tramites.find((x) => x.nroTramite === '1841012140')!;
        expect(t.rechazo).toBeUndefined();
        expect(r.resumen.porAviso['SIN_ENCABEZADO']).toBeUndefined(); // se reconoció como encabezado, no como dato
    });

    it('encabezado con solo el primer nombre distinto (el resto coincide) da error de archivo, no lo trata como dato', () => {
        const encabezadoPrimeraColumnaRota = ['NUMERO_TRAMITE', ...MULTICLAVES_ENCABEZADO.slice(1)].join('|');
        const archivo = { nombre: 'raro.csv', buffer: Buffer.from([encabezadoPrimeraColumnaRota, L2].join('\n'), 'latin1') };
        expect(() => parseMulticlaves([archivo], CFG, HOY)).toThrow(MulticlavesArchivoInvalidoError);
    });

    it('encabezado con solo 3 de los 9 nombres coincidiendo ya se trata como encabezado ajeno, no como dato', () => {
        // Coinciden exactamente las primeras 3 columnas (NRO_TRAMITE, NRO_CONVENIO, SALDO_TRAMITE);
        // el resto es cualquier cosa. Antes hacía falta la MAYORÍA (5+) para no colarse como dato.
        const encabezadoConTresCoincidencias = [...MULTICLAVES_ENCABEZADO.slice(0, 3), 'X', 'Y', 'Z', 'W', 'Q', 'R'].join('|');
        const archivo = { nombre: 'raro2.csv', buffer: Buffer.from([encabezadoConTresCoincidencias, L2].join('\n'), 'latin1') };
        expect(() => parseMulticlaves([archivo], CFG, HOY)).toThrow(MulticlavesArchivoInvalidoError);
    });

    it('CRLF y línea vacía final dan el mismo resultado que LF', () => {
        const conLf = parseMulticlaves([archivoConHeader('a.csv', L2, L3)], CFG, HOY);
        const contenidoCrlf = [HEADER, L2, L3].join('\r\n') + '\r\n';
        const conCrlf = parseMulticlaves(
            [{ nombre: 'a.csv', buffer: Buffer.from(contenidoCrlf, 'latin1') }],
            CFG,
            HOY,
        );
        expect(conCrlf.resumen).toEqual(conLf.resumen);
        expect(conCrlf.tramites).toEqual(conLf.tramites);
    });

    it('encabezado con otro nombre de columna → error del archivo entero', () => {
        // El primer campo sigue siendo NRO_TRAMITE (dispara la detección de encabezado); se cambia
        // el nombre de otra columna para que la comparación de los 9 nombres falle.
        const encabezadoAjeno = MULTICLAVES_ENCABEZADO
            .map((n, i) => (i === 1 ? 'NUMERO_CONVENIO' : n))
            .join('|');
        const archivo = { nombre: 'raro.csv', buffer: Buffer.from([encabezadoAjeno, L2].join('\n'), 'latin1') };
        expect(() => parseMulticlaves([archivo], CFG, HOY)).toThrow(MulticlavesArchivoInvalidoError);
    });

    it('sin encabezado pero con datos válidos → aviso SIN_ENCABEZADO, se procesa igual', () => {
        const r = parseMulticlaves([archivoSinHeader('sin-header.csv', L2, L3)], CFG, HOY);
        expect(r.resumen.porAviso['SIN_ENCABEZADO']).toBe(1);
        const t = r.tramites.find((x) => x.nroTramite === '1841012140')!;
        expect(t.rechazo).toBeUndefined();
    });

    it('una clave ya vencida al cargar da aviso YA_VENCIDA_AL_CARGAR', () => {
        const hoyFuturo = new Date('2027-01-01T00:00:00Z'); // el archivo vence 2026-10-27
        const r = parseMulticlaves([archivoConHeader('a.csv', L2, L3)], CFG, hoyFuturo);
        expect(r.resumen.porAviso['YA_VENCIDA_AL_CARGAR']).toBe(1);
    });

    it('YA_VENCIDA_AL_CARGAR compara contra el día de Argentina, no el día UTC', () => {
        // 28/10 01:30 UTC = 27/10 22:30 en Argentina (UTC-3): el vencimiento (27/10) todavía NO pasó
        // en Argentina, aunque en UTC ya es 28/10. Con el día UTC esto daba el aviso de más.
        const hoyBorde = new Date('2026-10-28T01:30:00.000Z');
        const r = parseMulticlaves([archivoConHeader('a.csv', L2, L3)], CFG, hoyBorde);
        expect(r.resumen.porAviso['YA_VENCIDA_AL_CARGAR'] ?? 0).toBe(0);
    });

    it('lo mismo un instante después, cuando en Argentina ya es el día siguiente al vencimiento', () => {
        // 28/10 03:30 UTC = 28/10 00:30 en Argentina: ahí sí ya pasó el 27/10 en los dos lados.
        const hoyVencido = new Date('2026-10-28T03:30:00.000Z');
        const r = parseMulticlaves([archivoConHeader('a.csv', L2, L3)], CFG, hoyVencido);
        expect(r.resumen.porAviso['YA_VENCIDA_AL_CARGAR']).toBe(1);
    });
});

describe('parseMulticlaves — archivo completo de muestra (skip si no está)', () => {
    const RUTA = '/home/maxi/Documentos/Ana Maya SA/teco perso/multiclaves/MULTI_41645_RA_1008_2026-08-31_10.29.22.csv';
    const existe = fs.existsSync(RUTA);
    (existe ? it : it.skip)('14.956 claves, 7.478 trámites, 0 rechazados, SALDO_DISTINTO_ENTRE_FILAS=2', () => {
        const buffer = fs.readFileSync(RUTA);
        const r = parseMulticlaves([{ nombre: path.basename(RUTA), buffer }], CFG, new Date('2026-09-01'));
        expect(r.resumen.lineas).toBe(14956);
        expect(r.resumen.claves).toBe(14956);
        expect(r.resumen.tramites).toBe(7478);
        expect(r.resumen.rechazados).toBe(0);
        expect(r.resumen.porAviso['SALDO_DISTINTO_ENTRE_FILAS']).toBe(2);
        expect(r.resumen.porAviso['QUITA_NO_ES_MITAD'] ?? 0).toBe(0);
    });
});
