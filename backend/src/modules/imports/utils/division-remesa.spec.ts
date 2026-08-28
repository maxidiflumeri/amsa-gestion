/**
 * División de una carga en una remesa por corte.
 *
 * El archivo de referencia es el CA del 27/05 de Telecom Personal: 19.538 filas con 5 nóminas y
 * 4 gestiones adentro, porque Deimos exporta filtrando solo por día. Los números de este spec son
 * los del archivo real.
 */
import { AcumuladorCortes, columnasDeDivision, divide, numeroConGestion } from './division-remesa';

const CFG = {
    porNomina: { fromIndex: 45, etiqueta: 'Nómina' },
    porGestion: { fromIndex: 2, etiqueta: 'Gestión' },
};

/** Fila cruda del CA, con solo las columnas que importan acá. */
function fila(gestion: string, nomina: string): any[] {
    const f = new Array(46).fill('');
    f[2] = gestion;
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

function acumularArchivo(cfg = CFG) {
    const acc = new AcumuladorCortes(cfg);
    for (const [gestion, nomina, filas] of ARCHIVO) {
        for (let i = 0; i < filas; i++) acc.agregar(fila(gestion, nomina));
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

describe('AcumuladorCortes', () => {
    it('encuentra los 5 cortes del archivo real con su volumen', () => {
        const cortes = acumularArchivo().cortes();

        expect(cortes).toHaveLength(5);
        expect(cortes.map((c) => [c.nomina, c.gestion, c.filas])).toEqual([
            ['3082', '3GH', 14047],
            ['3083', '1G', 1957],
            ['3085', '3G', 1524],
            ['3084', '2G', 1520],
            ['3086', '3GH', 490],
        ]);
    });

    it('ordena del corte más grande al más chico, que es lo que el operador coteja primero', () => {
        const filas = acumularArchivo().cortes().map((c) => c.filas);
        expect(filas).toEqual([...filas].sort((a, b) => b - a));
    });

    it('el filtro de cada corte aísla exactamente sus columnas', () => {
        const [principal] = acumularArchivo().cortes();

        expect(principal.filtros).toEqual([
            { fromIndex: 45, operador: 'IGUAL', valor: '3082' },
            { fromIndex: 2, operador: 'IGUAL', valor: '3GH' },
        ]);
    });

    it('las dos nóminas con la misma gestión son cortes distintos', () => {
        const conGestion3GH = acumularArchivo().cortes().filter((c) => c.gestion === '3GH');

        expect(conGestion3GH.map((c) => c.nomina)).toEqual(['3082', '3086']);
    });

    it('dividiendo solo por gestión, las dos nóminas 3GH caen en el mismo corte', () => {
        const acc = new AcumuladorCortes({ porGestion: CFG.porGestion });
        for (const [gestion, nomina, filas] of ARCHIVO) {
            for (let i = 0; i < filas; i++) acc.agregar(fila(gestion, nomina));
        }

        const cortes = acc.cortes();
        // 4 gestiones distintas: 3GH junta las nóminas 3082 y 3086, el resto va suelto.
        expect(cortes).toHaveLength(4);
        expect(cortes.find((c) => c.gestion === '3GH')!.filas).toBe(14047 + 490);
        expect(cortes.every((c) => c.nomina === null)).toBe(true);
        // Ojo con este archivo: 3G y 3GH son gestiones distintas pero comparten el dígito, así que
        // el número sugerido de las dos sale igual y hay que corregir una a mano. `createRemesa`
        // rechaza la carga con los dos números repetidos en vez de dejar pasar el choque.
        const digitos = cortes.map((c) => numeroConGestion('100', c.gestion));
        expect(new Set(digitos).size).toBe(3);
    });

    it('sin columnas declaradas no acumula nada', () => {
        const acc = new AcumuladorCortes({});
        acc.agregar(fila('3GH', '3082'));

        expect(acc.activo).toBe(false);
        expect(acc.cortes()).toEqual([]);
    });
});

describe('divide / columnasDeDivision', () => {
    it('una plantilla sin el bloque no divide: la carga es una remesa, como siempre', () => {
        expect(divide(undefined)).toBe(false);
        expect(divide({})).toBe(false);
        expect(columnasDeDivision(undefined)).toEqual([]);
    });

    it('alcanza con declarar uno de los dos criterios', () => {
        expect(divide({ porNomina: CFG.porNomina })).toBe(true);
        expect(divide({ porGestion: CFG.porGestion })).toBe(true);
    });

    it('la nómina va primero, que es como se lee el corte', () => {
        expect(columnasDeDivision(CFG).map((c) => c.etiqueta)).toEqual(['Nómina', 'Gestión']);
    });
});
