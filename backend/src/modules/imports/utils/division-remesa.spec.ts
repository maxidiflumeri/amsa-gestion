/**
 * División de una carga en una remesa por corte.
 *
 * El archivo de referencia es el CA del 27/05 de Telecom Personal: 19.538 filas con 5 nóminas y
 * 4 gestiones adentro, porque Deimos exporta filtrando solo por día. Los números de este spec son
 * los del archivo real.
 */
import {
    AcumuladorCortes, columnasDeDivision, divide, normalizarDivision, numeroConGestion,
    numerosSugeridos,
} from './division-remesa';

const NOMINA = { fromIndex: 45, etiqueta: 'Nómina' };
const GESTION = { fromIndex: 2, etiqueta: 'Gestión' };
const TIPO = { fromIndex: 44, etiqueta: 'Tipo' };

const CFG = { cortes: [NOMINA], prefijo: GESTION };

/** Fila cruda del CA, con solo las columnas que importan acá. */
function fila(gestion: string, nomina: string, tipo = 'POSBAJA'): any[] {
    const f = new Array(46).fill('');
    f[2] = gestion;
    f[44] = tipo;
    f[45] = nomina;
    return f;
}

/** Las 5 nóminas del archivo real, con su gestión y su volumen. */
const ARCHIVO: Array<[string, string, number]> = [
    ['3GH', '3082', 14047],
    ['1G', '3083', 1957],
    ['3G', '3085', 1524],
    ['2G', '3084', 1520],
    ['3GH', '3086', 490],
];

function acumular(filas: Array<[string, string, number]>, cfg: any = CFG) {
    const acc = new AcumuladorCortes(cfg);
    for (const [gestion, nomina, n] of filas) {
        for (let i = 0; i < n; i++) acc.agregar(fila(gestion, nomina));
    }
    return acc;
}

describe('numeroConGestion', () => {
    it('antepone el dígito de la gestión al número base, paddeado a 4', () => {
        expect(numeroConGestion('100', '1GH')).toBe('10100');
        expect(numeroConGestion('100', '2GH')).toBe('20100');
        expect(numeroConGestion('100', '3GH')).toBe('30100');
    });

    it('3G y 3GH comparten prefijo: lo que las separa es la nómina, no la gestión', () => {
        expect(numeroConGestion('100', '3G')).toBe(numeroConGestion('100', '3GH'));
    });

    it('respeta un base que ya tiene 4 o más dígitos', () => {
        expect(numeroConGestion('0100', '1G')).toBe('10100');
        expect(numeroConGestion('12345', '2G')).toBe('212345');
    });

    it('sin dígito en la gestión devuelve el número tal cual, en vez de inventar uno', () => {
        expect(numeroConGestion('100', 'GH')).toBe('100');
        expect(numeroConGestion('100', null)).toBe('100');
    });

    it('un número base no numérico se deja intacto', () => {
        expect(numeroConGestion('REM-A', '1G')).toBe('REM-A');
    });
});

describe('numerosSugeridos — el correlativo avanza por NÓMINA, no por combinación', () => {
    it('una nómina con tres gestiones comparte el número base', () => {
        const acc = acumular([['1G', '3082', 10], ['2G', '3082', 10], ['3G', '3082', 10]]);

        // El caso que define la regla: el 100 es de la nómina, y las tres gestiones lo prefijan.
        // Si el correlativo avanzara por combinación saldría 10100 / 20101 / 30102.
        expect(numerosSugeridos(acc.cortes(), '100')).toEqual(['10100', '20100', '30100']);
    });

    it('dos nóminas de tres gestiones cada una avanzan de a un número', () => {
        const acc = acumular([
            ['1G', '3082', 30], ['2G', '3082', 20], ['3G', '3082', 10],
            ['1G', '3083', 9], ['2G', '3083', 8], ['3G', '3083', 7],
        ]);

        expect(numerosSugeridos(acc.cortes(), '100')).toEqual([
            '10100', '20100', '30100',
            '10101', '20101', '30101',
        ]);
    });

    it('sin columna de corte todos comparten el base y solo los separa el dígito', () => {
        const acc = acumular(
            [['1G', '3082', 30], ['2G', '3083', 20], ['3G', '3084', 10]],
            { prefijo: GESTION },
        );

        expect(numerosSugeridos(acc.cortes(), '100')).toEqual(['10100', '20100', '30100']);
    });

    it('sin columna de prefijo es el correlativo pelado', () => {
        const acc = acumular(
            [['1G', '3082', 30], ['2G', '3083', 20], ['3G', '3084', 10]],
            { cortes: [NOMINA] },
        );

        expect(numerosSugeridos(acc.cortes(), '100')).toEqual(['100', '101', '102']);
    });

    it('en el archivo real cada nómina tiene una sola gestión, así que salen todos distintos', () => {
        const numeros = numerosSugeridos(acumular(ARCHIVO).cortes(), '100');

        expect(numeros).toEqual(['30100', '10101', '30102', '20103', '30104']);
        expect(new Set(numeros).size).toBe(5);
    });

    it('dividiendo SOLO por gestión, 3G y 3GH chocan: el operador tiene que corregir uno', () => {
        const acc = acumular(ARCHIVO, { prefijo: GESTION });
        const numeros = numerosSugeridos(acc.cortes(), '100');

        // 4 gestiones, 3 números: es el choque que la pantalla marca y el backend rechaza.
        expect(numeros).toHaveLength(4);
        expect(new Set(numeros).size).toBe(3);
    });
});

describe('AcumuladorCortes', () => {
    it('encuentra los 5 cortes del archivo real con su volumen', () => {
        const cortes = acumular(ARCHIVO).cortes();

        expect(cortes).toHaveLength(5);
        expect(cortes.map((c) => [c.valores['Nómina'], c.valores['Gestión'], c.filas])).toEqual([
            ['3082', '3GH', 14047],
            ['3083', '1G', 1957],
            ['3085', '3G', 1524],
            ['3084', '2G', 1520],
            ['3086', '3GH', 490],
        ]);
    });

    it('ordena del corte más grande al más chico, que es lo que el operador coteja primero', () => {
        const filas = acumular(ARCHIVO).cortes().map((c) => c.filas);
        expect(filas).toEqual([...filas].sort((a, b) => b - a));
    });

    it('el filtro de cada corte aísla exactamente sus columnas', () => {
        const [principal] = acumular(ARCHIVO).cortes();

        expect(principal.filtros).toEqual([
            { fromIndex: 45, operador: 'IGUAL', valor: '3082' },
            { fromIndex: 2, operador: 'IGUAL', valor: '3GH' },
        ]);
    });

    it('las dos nóminas con la misma gestión son cortes distintos', () => {
        const conGestion3GH = acumular(ARCHIVO).cortes().filter((c) => c.valores['Gestión'] === '3GH');

        expect(conGestion3GH.map((c) => c.valores['Nómina'])).toEqual(['3082', '3086']);
    });

    it('dividiendo solo por gestión, las dos nóminas 3GH caen en el mismo corte', () => {
        const cortes = acumular(ARCHIVO, { prefijo: GESTION }).cortes();

        expect(cortes).toHaveLength(4);
        expect(cortes.find((c) => c.prefijo === '3GH')!.filas).toBe(14047 + 490);
    });

    it('sin columnas declaradas no acumula nada', () => {
        const acc = new AcumuladorCortes({});
        acc.agregar(fila('3GH', '3082'));

        expect(acc.activo).toBe(false);
        expect(acc.cortes()).toEqual([]);
    });
});

describe('prebaja y posbaja en el mismo CA', () => {
    /**
     * Un mismo archivo puede traer nóminas de las dos carteras, que son empresas distintas. Con la
     * columna declarada como corte, el operador ve de cuál es cada nómina y tilda solo las suyas:
     * sube el archivo una vez por empresa.
     */
    const CFG_TIPO = { cortes: [NOMINA, TIPO], prefijo: GESTION };

    function acumularMixto() {
        const acc = new AcumuladorCortes(CFG_TIPO);
        const filas: Array<[string, string, string, number]> = [
            ['3GH', '3082', 'POSBAJA', 14047],
            ['1G', '3083', 'POSBAJA', 1957],
            ['1G', '2988', 'PREBAJA', 800],
            ['2G', '3180', 'PREBAJA', 300],
        ];
        for (const [g, n, t, veces] of filas) {
            for (let i = 0; i < veces; i++) acc.agregar(fila(g, n, t));
        }
        return acc;
    }

    it('cada nómina se ve con su tipo, así el operador sabe cuáles son de cada empresa', () => {
        const cortes = acumularMixto().cortes();

        expect(cortes.map((c) => [c.valores['Nómina'], c.valores['Tipo']])).toEqual([
            ['3082', 'POSBAJA'],
            ['3083', 'POSBAJA'],
            ['2988', 'PREBAJA'],
            ['3180', 'PREBAJA'],
        ]);
    });

    it('el filtro incluye el tipo, así una remesa no se lleva filas de la otra cartera', () => {
        const prebaja = acumularMixto().cortes().find((c) => c.valores['Tipo'] === 'PREBAJA')!;

        expect(prebaja.filtros).toEqual([
            { fromIndex: 45, operador: 'IGUAL', valor: '2988' },
            { fromIndex: 44, operador: 'IGUAL', valor: 'PREBAJA' },
            { fromIndex: 2, operador: 'IGUAL', valor: '1G' },
        ]);
    });

    it('los números no chocan entre carteras aunque compartan gestión', () => {
        const numeros = numerosSugeridos(acumularMixto().cortes(), '100');

        expect(numeros).toEqual(['30100', '10101', '10102', '20103']);
        expect(new Set(numeros).size).toBe(4);
    });
});

describe('divide / columnasDeDivision / normalizarDivision', () => {
    it('una plantilla sin el bloque no divide: la carga es una remesa, como siempre', () => {
        expect(divide(undefined)).toBe(false);
        expect(divide({})).toBe(false);
        expect(columnasDeDivision(undefined)).toEqual([]);
    });

    it('alcanza con declarar uno de los dos roles', () => {
        expect(divide({ cortes: [NOMINA] })).toBe(true);
        expect(divide({ prefijo: GESTION })).toBe(true);
    });

    it('los cortes van primero y el prefijo al final, que es como se lee', () => {
        expect(columnasDeDivision({ cortes: [NOMINA, TIPO], prefijo: GESTION }).map((c) => c.etiqueta))
            .toEqual(['Nómina', 'Tipo', 'Gestión']);
    });

    it('sigue leyendo la forma vieja porNomina/porGestion', () => {
        const n = normalizarDivision({ porNomina: NOMINA, porGestion: GESTION });

        expect(n.cortes).toEqual([NOMINA]);
        expect(n.prefijo).toEqual(GESTION);
    });

    it('la forma vieja y la nueva producen los mismos cortes', () => {
        const vieja = acumular(ARCHIVO, { porNomina: NOMINA, porGestion: GESTION }).cortes();
        const nueva = acumular(ARCHIVO, CFG).cortes();

        expect(vieja).toEqual(nueva);
    });
});
