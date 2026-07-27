import { MultirregistroConfig } from '../mapping-types';

/**
 * Layout del archivo diario de Toyota cuenta 87 (`deuda_agencia_YYYYMMDD_HHMMSS.txt`).
 *
 * Es el `mappingJson.multirregistro` de la plantilla. Vive en código como **referencia** para poder
 * crear la plantilla y testear contra el archivo real, pero lo que manda en producción es lo que
 * quede guardado en la plantilla: si el cedente mueve una columna se corrige ahí, sin deploy.
 *
 * Índices **1-based** sobre la línea separada por `;` (la columna 1 es el código de tipo).
 * Verificado sobre el archivo del 2026-07-24 (1.720 líneas). Ver el análisis completo en
 * `docs/imports-actualizacion-diaria-y-multirregistro-spec.md` §B.1.
 *
 *   CLI;<nroCliente>;<nombre>;<calle>;<nro>;<piso>;<depto>;<cp>;<localidad>;<codProv>;<prov>;<J|F>;<email>;<codArea>;<tel1>;<tel2>
 *   GES;<ignorar>;<nroCliente>;<contrato>;<ignorar>;<aviso>;<fecha>;<importe>;<vto>
 *   DET;<aviso>;<concepto>;<importe>;<importe2>;<dias>
 *   BAJ;<aviso>;<fecha>;<motivo>
 */
export const TOYOTA_87_MULTIRREGISTRO: MultirregistroConfig = {
    discriminadorIndex: 0,
    // El cedente manda Latin-1: leído como UTF-8 se rompen las Ñ y los acentos de los nombres.
    encoding: 'latin1',
    cli: {
        codigo: 'CLI',
        nroCliente: 2,
        nombre: 3,
        domicilio: [4, 5, 6, 7],
        email: 13,
        codArea: 14,
        telefonos: [15, 16],
        adicionales: { cp: 8, localidad: 9, provincia: 11, tipo_persona: 12 },
    },
    // col2 (un id secuencial que el cedente no supo explicar) y col5 (nro de cuenta del PDF) no se
    // cargan; el importe de col8 tampoco: se calcula sumando los DET del aviso.
    ges: { codigo: 'GES', nroCliente: 3, contrato: 4, aviso: 6 },
    det: {
        codigo: 'DET',
        aviso: 2,
        concepto: 3,
        importe: 4,
        dias: 6,
        // Trae los días de mora del aviso en la columna de días, con importe 0.
        conceptoDiasMora: 'Días de Mora',
        // Viene en los 271 avisos con importe 0 y un valor fijo de 180.90 en la columna secundaria:
        // es ruido del formato, no un cargo.
        conceptosIgnorados: ['Cargo por Pago Fuera de Termino'],
    },
    baj: { codigo: 'BAJ', aviso: 2, fecha: 3, motivo: 4 },
};

/**
 * `mappingJson` completo de la plantilla. Las categorías multirregistro no usan `columns`/`blocks`
 * (el parser arma las filas), pero el campo es obligatorio en el tipo.
 */
export const TOYOTA_87_MAPPING_JSON = {
    entity: 'MIXTO' as const,
    matchKeys: ['empresaId', 'nroCliente'],
    columns: {},
    multirregistro: TOYOTA_87_MULTIRREGISTRO,
};
