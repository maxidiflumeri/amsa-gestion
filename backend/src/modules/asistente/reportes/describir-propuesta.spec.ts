import { CatalogoService } from '../../reportes/catalogo/catalogo.service';
import { Descriptor, describirOpciones } from './describir-propuesta';
import { PlantillaNormalizada } from './tipos-reportes';

let d: Descriptor;
beforeAll(async () => {
    d = new Descriptor(await new CatalogoService(null as never).getCatalogo('deudor', 3));
});

const plantilla = (extra: Partial<PlantillaNormalizada['definicion']> = {}, opciones: Record<string, unknown> = {}, formato: PlantillaNormalizada['formatoSalida'] = 'xlsx'): PlantillaNormalizada => ({
    nombre: 'x',
    descripcion: null,
    raiz: 'deudor',
    empresaId: null,
    definicion: { columnas: [], filtros: [], ordenamientos: [], cardinalidadDefault: 'concatenar', ...extra },
    formatoSalida: formato,
    opcionesFormato: { [formato]: opciones },
});

describe('"Sale de"', () => {
    it('un campo del caso, con la etiqueta del catálogo', () => {
        expect(d.saleDe('documento')).toBe('DNI / Documento');
        expect(d.saleDe('estadoSituacion.descripcion')).toBe('Situación');
    });

    it('el segundo teléfono', () => {
        expect(d.saleDe('contactos[tipo=telefono][1].valor')).toBe('Teléfono / email / dirección · 2.º teléfono');
        expect(d.saleDe('contactos[tipo=email][0].valor')).toBe('Teléfono / email / dirección · 1.º email cargado');
    });

    it('agregados', () => {
        expect(d.saleDe('pagos[last].importe')).toBe('Importe del pago · el más reciente');
        expect(d.saleDe('pagos[sum].importe')).toBe('Importe del pago · suma');
        expect(d.saleDe('pagos[count]')).toBe('Pagos · cantidad');
    });

    it('datos adicionales y columna fija', () => {
        expect(d.saleDe('camposAdicionales.PATENTE')).toBe('Dato adicional del cedente · PATENTE');
        expect(d.saleDe('')).toBe('Columna vacía');
    });

    it('un nombre dentro de una relación lleva el nombre de la relación', () => {
        expect(d.saleDe('promesas.usuario.nombre')).toBe('Tomada por · Nombre');
    });
});

describe('«Sale de» muestra la cardinalidad', () => {
    it('todos los comentarios (separados) contra el último', () => {
        expect(d.saleDe('comentarios.texto', { cardinalidad: 'concatenar' })).toBe('Texto del comentario · todos (comentarios), separados por «, »');
        expect(d.saleDe('comentarios.texto', { cardinalidad: 'concatenar', separadorConcat: ' | ' })).toBe('Texto del comentario · todos (comentarios), separados por « | »');
        expect(d.saleDe('comentarios[last].texto', { cardinalidad: 'concatenar' })).toBe('Texto del comentario · el más reciente');
    });

    it('pagos.importe en «último» (el último cargado) contra pagos[last] (el más reciente)', () => {
        expect(d.saleDe('pagos.importe', { cardinalidad: 'ultimo' })).toBe('Importe del pago · el último cargado (pagos)');
        expect(d.saleDe('pagos[last].importe', { cardinalidad: 'ultimo' })).toBe('Importe del pago · el más reciente');
        expect(d.saleDe('pagos.importe', { cardinalidad: 'primero' })).toBe('Importe del pago · el primero cargado (pagos)');
        expect(d.saleDe('pagos.importe', { cardinalidad: 'expandir' })).toBe('Importe del pago · una fila por cada uno (pagos)');
    });

    it('un campo del caso y un índice no llevan cardinalidad', () => {
        expect(d.saleDe('documento', { cardinalidad: 'concatenar' })).toBe('DNI / Documento');
        expect(d.saleDe('contactos[tipo=telefono][1].valor', { cardinalidad: 'concatenar' })).toBe('Teléfono / email / dirección · 2.º teléfono');
        expect(d.saleDe('pagos[count]', { cardinalidad: 'concatenar' })).toBe('Pagos · cantidad');
    });

    it('la tarjeta usa la cardinalidad de la columna o la por defecto', () => {
        const n = plantilla({
            columnas: [
                { id: 'a', path: 'comentarios.texto', label: 'Todos' },
                { id: 'b', path: 'comentarios.texto', label: 'Último', cardinalidad: 'ultimo' },
            ],
            cardinalidadDefault: 'concatenar',
        });
        const filas = d.mapeo({ mapeo: [] } as never, n, new Map());
        expect(filas[0].saleDe).toContain('todos (comentarios)');
        expect(filas[1].saleDe).toContain('el último cargado (comentarios)');
    });
});

describe('formato de cada columna', () => {
    it('fecha, días, decimales, teléfono', () => {
        const f = (c: Record<string, unknown>) => d.formatoColumna(c, new Map([[2, '0{numero}']]));
        expect(f({ path: 'fechaVencimiento', tipo: 'fecha', formato: 'YYYYMMDD' })).toBe('YYYYMMDD');
        expect(f({ path: 'fechaVencimiento', tipo: 'dias' })).toBe('Días desde: fecha de vencimiento');
        expect(f({ path: 'saldo', tipo: 'numero', decimales: 2, separadorDecimal: ',', separadorMiles: '.' })).toBe('2 decimales, coma decimal, punto de miles');
        expect(f({ path: 'saldo', tipo: 'numero' })).toBeNull();
        expect(f({ path: 'x', tipo: 'telefono', formatoTelefonoId: 2 })).toBe('Teléfono: 0{numero}');
    });
});

describe('filtros en castellano', () => {
    const hoy = '2026-10-19';
    it('empresa y fecha relativa con el día de hoy', () => {
        const n = plantilla({
            filtros: [
                { id: '1', path: 'empresa.nombre', operador: 'eq', valor: 'TOYOTA' },
                { id: '2', path: 'fechaVencimiento', operador: 'lte', valor: 'hoy-90' },
            ],
        });
        expect(d.filtros(n, hoy)).toEqual(['Nombre de la empresa: TOYOTA', 'Fecha de vencimiento: hasta hace 90 días (hoy, 19/10/2026)']);
    });

    it('fecha fija, rango relativo, lista y cantidad', () => {
        const n = plantilla({
            filtros: [
                { id: '1', path: 'fechaVencimiento', operador: 'lte', valor: '2026-07-31' },
                { id: '2', path: 'pagos.fecha', operador: 'between', valor: ['hoy-7', 'hoy'] },
                { id: '3', path: 'estadoSituacion.clave', operador: 'in', valor: ['SIT-050', 'SIT-041'] },
                { id: '4', path: 'contactos[tipo=telefono][count]', operador: 'eq', valor: 0 },
            ],
        });
        expect(d.filtros(n, hoy)).toEqual([
            'Fecha de vencimiento: hasta 31/07/2026',
            'Fecha del pago: entre hace 7 días y hoy (hoy, 19/10/2026)',
            'Código de situación: SIT-050, SIT-041',
            'Contactos · cantidad · teléfono: = 0',
        ]);
    });

    it('variable', () => {
        const n = plantilla({ filtros: [{ id: '1', path: 'pagos.fecha', operador: 'between', variable: true, labelVariable: 'Período', obligatorio: true }] });
        expect(d.filtros(n, hoy)).toEqual(['Fecha del pago: se pide al ejecutar (Período, obligatorio)']);
    });

    it('sin filtros: lista vacía (la tarjeta lo dice)', () => {
        expect(d.filtros(plantilla(), hoy)).toEqual([]);
    });
});

describe('orden y opciones', () => {
    it('orden', () => {
        expect(d.orden(plantilla({ ordenamientos: [{ path: 'saldo', direccion: 'desc' }] }))).toEqual(['Saldo actual (mayor a menor)']);
    });

    it('opciones', () => {
        expect(describirOpciones(plantilla({}, { separador: ';', bom: false, encoding: 'latin1', incluirHeader: false }, 'csv'))).toEqual(['Separador ;', 'Sin BOM', 'Sin fila de encabezado', 'latin1']);
        expect(describirOpciones(plantilla({}, { anchoFijo: [10, 10], alineacion: ['izquierda', 'derecha'], relleno: [' ', '0'], encoding: 'latin1' }, 'txt'))).toEqual([
            'Ancho fijo: 2 columnas',
            'Algunas columnas alineadas a la derecha',
            'Relleno con ceros',
            'latin1',
        ]);
        expect(describirOpciones(plantilla())).toEqual([]);
    });
});
