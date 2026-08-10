/**
 * Cableado de "varios archivos del mismo formato en una remesa" en el service.
 *
 * El recorrido y la validación del lote están cubiertos aparte (`utils/recorrer-filas.spec.ts`,
 * `utils/archivos-homogeneos.spec.ts`); lo que se verifica acá es lo que los une: que el alta guarde
 * la lista, que el preview recorra todos los archivos y que las cargas de un solo archivo —o sea,
 * todo lo que ya funcionaba— sigan comportándose exactamente igual.
 *
 * No toca la base: `prisma` va mockeado y el único IO real son archivos temporales.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ImportService } from './imports.service';
import { MappingJson } from './mapping-types';

let dir: string;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'varios-archivos-'));
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

const escribir = (nombre: string, contenido: string): string => {
    const p = path.join(dir, nombre);
    fs.writeFileSync(p, Buffer.from(contenido, 'latin1'));
    return p;
};

/** Mapeo mínimo de DEUDORES: dos columnas por índice. */
const MAPPING: MappingJson = {
    entity: 'DEUDOR',
    matchKeys: ['empresaId', 'nro_cliente'],
    columns: {
        nro_cliente: { fromIndex: 0 },
        nombre: { fromIndex: 1 },
    },
};

/* ────────────────────────────────────────────────────────────────────────────
 * Alta de la remesa
 * ──────────────────────────────────────────────────────────────────────────── */

function makeServiceAlta(plantilla: any = { id: 7, mappingJson: MAPPING, tieneHeader: true }) {
    const create = jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 99, ...data }));
    const prisma: any = {
        plantillaimport: { findUnique: jest.fn().mockResolvedValue(plantilla) },
        remesa: { findMany: jest.fn().mockResolvedValue([]), create },
    };
    const saveBuffer = jest.fn().mockImplementation((f: any) =>
        Promise.resolve({ path: `/uploads/${f.originalname}`, hash: `h-${f.originalname}` }),
    );
    const service = new ImportService(
        prisma, { saveBuffer } as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { service, create, saveBuffer };
}

const dto = (categoria = 'DEUDORES') => ({
    empresaId: 5, nombre: 'AYSA 22/06', categoria, plantillaId: 7,
}) as any;

const subidos = (...nombres: string[]) =>
    nombres.map((originalname) => ({ originalname, buffer: Buffer.from('cod;nombre\n001;PEREZ\n', 'latin1') }));

describe('alta de remesa con varios archivos', () => {
    it('guarda todos los archivos y deja la lista en la remesa', async () => {
        const { service, create, saveBuffer } = makeServiceAlta();

        await service.createRemesa(dto(), subidos('suc003.txt', 'suc006.txt', 'suc032.txt'));

        expect(saveBuffer).toHaveBeenCalledTimes(3);
        const data = create.mock.calls[0][0].data;
        expect(data.archivos).toEqual({
            lista: ['/uploads/suc003.txt', '/uploads/suc006.txt', '/uploads/suc032.txt'],
            nombres: ['suc003.txt', 'suc006.txt', 'suc032.txt'],
        });
        // `archivo` apunta al primero: lo asumen el borrado y el chequeo de duplicados.
        expect(data.archivo).toBe('/uploads/suc003.txt');
    });

    it('el hash del conjunto no depende del orden en que se arrastraron', async () => {
        const a = makeServiceAlta();
        await a.service.createRemesa(dto(), subidos('suc003.txt', 'suc006.txt', 'suc032.txt'));
        const b = makeServiceAlta();
        await b.service.createRemesa(dto(), subidos('suc032.txt', 'suc003.txt', 'suc006.txt'));

        expect(a.create.mock.calls[0][0].data.archivoHash)
            .toBe(b.create.mock.calls[0][0].data.archivoHash);
    });

    it('el hash del conjunto es distinto al de un archivo solo', async () => {
        const a = makeServiceAlta();
        await a.service.createRemesa(dto(), subidos('suc003.txt'));
        const b = makeServiceAlta();
        await b.service.createRemesa(dto(), subidos('suc003.txt', 'suc006.txt'));

        expect(a.create.mock.calls[0][0].data.archivoHash)
            .not.toBe(b.create.mock.calls[0][0].data.archivoHash);
    });

    it('rechaza con 400 el lote con un archivo de otro formato, sin guardar nada', async () => {
        const { service, create, saveBuffer } = makeServiceAlta();

        const lote = [
            { originalname: 'cuentas.txt', buffer: Buffer.from('Of. Cobro División\n900\n', 'latin1') },
            { originalname: 'partidas.txt', buffer: Buffer.from('F. Proc. Of. Cobro\n21.06\n', 'latin1') },
        ];

        await expect(service.createRemesa(dto(), lote)).rejects.toThrow(/encabezado distinto/);
        expect(saveBuffer).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
    });

    it('rechaza el archivo repetido antes de duplicar sus filas', async () => {
        const { service } = makeServiceAlta();
        await expect(service.createRemesa(dto(), subidos('suc003.txt', 'suc003.txt')))
            .rejects.toThrow(/repetidos/);
    });

    it('REGRESIÓN: con un solo archivo se guarda igual que siempre', async () => {
        const { service, create, saveBuffer } = makeServiceAlta();

        await service.createRemesa(dto(), subidos('cartera.csv'));

        expect(saveBuffer).toHaveBeenCalledTimes(1);
        const data = create.mock.calls[0][0].data;
        expect(data.archivo).toBe('/uploads/cartera.csv');
        // Hash del archivo tal cual, no del conjunto: no cambia para las remesas ya cargadas.
        expect(data.archivoHash).toBe('h-cartera.csv');
        expect(data.archivos).not.toEqual(expect.objectContaining({ lista: expect.anything() }));
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Preview
 * ──────────────────────────────────────────────────────────────────────────── */

function makeServicePreview(remesa: any) {
    const update = jest.fn().mockResolvedValue({});
    const prisma: any = { remesa: { findUnique: jest.fn().mockResolvedValue(remesa), update } };
    const service = new ImportService(
        prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { service, update };
}

const remesaCon = (paths: string[], nombres?: string[], mappingJson: MappingJson = MAPPING) => ({
    id: 1,
    empresaId: 5,
    categoria: 'DEUDORES',
    archivo: paths[0],
    archivos: paths.length > 1 ? { lista: paths, nombres } : null,
    plantilla: { mappingJson, separador: ';', tieneHeader: true },
});

describe('preview con varios archivos', () => {
    it('cuenta las filas de todos los archivos, no solo del primero', async () => {
        const a = escribir('p1.csv', 'cod;nombre\n001;PEREZ\n002;GOMEZ\n');
        const b = escribir('p2.csv', 'cod;nombre\n003;LOPEZ\n');
        const { service } = makeServicePreview(remesaCon([a, b]));

        const r: any = await service.validateRemesa(1, 50);

        expect(r.total).toBe(3);
        expect(r.ok).toBe(3);
        expect(r.err).toBe(0);
    });

    it('devuelve la lista de archivos para mostrarla en el wizard', async () => {
        const a = escribir('q1.csv', 'cod;nombre\n001;PEREZ\n');
        const b = escribir('q2.csv', 'cod;nombre\n002;GOMEZ\n');
        const { service } = makeServicePreview(
            remesaCon([a, b], ['AGAEJ0_cuentas_003.txt', 'AGAEJ0_cuentas_006.txt']),
        );

        const r: any = await service.validateRemesa(1, 50);

        expect(r.archivos).toEqual(['AGAEJ0_cuentas_003.txt', 'AGAEJ0_cuentas_006.txt']);
    });

    it('el error de una fila dice de qué archivo salió', async () => {
        const requerido: MappingJson = { ...MAPPING, validations: [{ field: 'nombre', rule: 'required' }] };
        const a = escribir('r1.csv', 'cod;nombre\n001;PEREZ\n');
        const b = escribir('r2.csv', 'cod;nombre\n002;\n');
        const { service } = makeServicePreview(remesaCon([a, b], ['cuentas_003.txt', 'cuentas_006.txt'], requerido));

        const r: any = await service.validateRemesa(1, 50);

        expect(r.err).toBe(1);
        expect(r.sample[1].error).toBe('[cuentas_006.txt:1] Campo requerido faltante: nombre');
    });

    it('persiste el total sumado para que la barra de progreso no mienta', async () => {
        const a = escribir('s1.csv', 'cod;nombre\n001;PEREZ\n');
        const b = escribir('s2.csv', 'cod;nombre\n002;GOMEZ\n');
        const { service, update } = makeServicePreview(remesaCon([a, b]));

        await service.validateRemesa(1, 50);

        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ estadoProceso: 'VALIDANDO', totalFilas: 2 }),
        }));
    });

    it('avisa cuál falta si un archivo de la lista ya no está en el disco', async () => {
        const a = escribir('t1.csv', 'cod;nombre\n001;PEREZ\n');
        const { service } = makeServicePreview(remesaCon([a, path.join(dir, 'no-existe.csv')]));

        await expect(service.validateRemesa(1)).rejects.toThrow(/No se encuentra.*no-existe\.csv/s);
    });

    it('REGRESIÓN: con un solo archivo el error no lleva prefijo de archivo', async () => {
        const requerido: MappingJson = { ...MAPPING, validations: [{ field: 'nombre', rule: 'required' }] };
        const a = escribir('u1.csv', 'cod;nombre\n001;\n');
        const { service } = makeServicePreview(remesaCon([a], undefined, requerido));

        const r: any = await service.validateRemesa(1, 50);

        expect(r.sample[0].error).toBe('Campo requerido faltante: nombre');
        expect(r.archivos).toBeUndefined();
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Filtro de filas
 * ──────────────────────────────────────────────────────────────────────────── */

describe('preview con filtro de filas', () => {
    // El caso de las novedades de AYSA: solo se importan las filas con importe cobrado.
    const conFiltro: MappingJson = {
        ...MAPPING,
        columns: { ...MAPPING.columns, importe: { fromIndex: 2 } },
        filtroFilas: [{ fromIndex: 2, operador: 'MAYOR', valor: '0' }],
    };

    it('las filas descartadas no cuentan en el total ni como error', async () => {
        const p = escribir('nov.csv', 'cod;nombre;cobrado\n001;PEREZ;315.22\n002;GOMEZ;0.00\n003;LOPEZ;62.85\n');
        const { service } = makeServicePreview(remesaCon([p], undefined, conFiltro));

        const r: any = await service.validateRemesa(1, 50);

        expect(r.total).toBe(2);
        expect(r.ok).toBe(2);
        expect(r.err).toBe(0);
        expect(r.descartadas).toBe(1);
    });

    it('informa el criterio para que el operador lo confirme antes de ejecutar', async () => {
        const p = escribir('nov2.csv', 'cod;nombre;cobrado\n001;PEREZ;0.00\n');
        const { service } = makeServicePreview(remesaCon([p], undefined, conFiltro));

        const r: any = await service.validateRemesa(1, 50);

        expect(r.filtro).toBe('col 2 MAYOR "0"');
    });

    it('el preview muestra las filas que quedan, no las descartadas', async () => {
        const p = escribir('nov3.csv', 'cod;nombre;cobrado\n001;PEREZ;0.00\n002;GOMEZ;62.85\n');
        const { service } = makeServicePreview(remesaCon([p], undefined, conFiltro));

        const r: any = await service.validateRemesa(1, 50);

        expect(r.sample).toHaveLength(1);
        expect(r.sample[0].data).toMatchObject({ nro_cliente: '002' });
    });

    it('el total persistido es el de las filas que se van a procesar', async () => {
        const p = escribir('nov4.csv', 'cod;nombre;cobrado\n001;PEREZ;0.00\n002;GOMEZ;62.85\n');
        const { service, update } = makeServicePreview(remesaCon([p], undefined, conFiltro));

        await service.validateRemesa(1, 50);

        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ totalFilas: 1 }),
        }));
    });

    it('REGRESIÓN: sin filtro no aparece nada nuevo en la respuesta', async () => {
        const p = escribir('nov5.csv', 'cod;nombre\n001;PEREZ\n');
        const { service } = makeServicePreview(remesaCon([p]));

        const r: any = await service.validateRemesa(1, 50);

        expect(r.descartadas).toBeUndefined();
        expect(r.filtro).toBeUndefined();
        expect(r.total).toBe(1);
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Ancho fijo desde la plantilla
 * ──────────────────────────────────────────────────────────────────────────── */

describe('preview de un archivo de ancho fijo', () => {
    const mappingFijo: MappingJson = {
        ...MAPPING,
        formato: 'ANCHO_FIJO',
        anchoFijo: {
            columnas: [
                { nombre: 'cod', inicio: 0, largo: 3 },
                { nombre: 'nombre', inicio: 3, largo: 10 },
            ],
        },
    };

    it('corta por posición en vez de por el separador de la plantilla', async () => {
        const p = escribir('fijo.txt', 'codnombre    \n001PEREZ     \n002GOMEZ     \n');
        const { service } = makeServicePreview(remesaCon([p], undefined, mappingFijo));

        const r: any = await service.validateRemesa(1, 50);

        expect(r.total).toBe(2);
        expect(r.sample[0].data).toMatchObject({ nro_cliente: '001', nombre: 'PEREZ' });
    });

    it('rechaza la plantilla que declara ancho fijo sin layout', async () => {
        const p = escribir('sin-layout.txt', 'codnombre\n001PEREZ\n');
        const { service } = makeServicePreview(
            remesaCon([p], undefined, { ...MAPPING, formato: 'ANCHO_FIJO' }),
        );

        await expect(service.validateRemesa(1)).rejects.toThrow(/no tiene el layout de columnas/);
    });

    it('rechaza un layout con posiciones inválidas, nombrando la columna', async () => {
        const p = escribir('layout-roto.txt', 'codnombre\n001PEREZ\n');
        const { service } = makeServicePreview(remesaCon([p], undefined, {
            ...MAPPING,
            formato: 'ANCHO_FIJO',
            anchoFijo: { columnas: [{ nombre: 'cod', inicio: 0, largo: 0 }] },
        }));

        await expect(service.validateRemesa(1)).rejects.toThrow(/"cod".*largo inválido/);
    });
});
