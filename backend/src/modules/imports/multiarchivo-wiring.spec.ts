/**
 * Cableado de la categoría MULTIARCHIVO en el service (fase 3).
 *
 * El parser y el processor están cubiertos aparte; lo que se verifica acá es lo que los une y que
 * de otra forma solo se probaría a mano: que el paquete se lee del disco por rol, que la rama de
 * preview arma los casos y que los errores de archivos faltantes salen como 400 accionables.
 *
 * No toca la base: `prisma` va mockeado y el único IO real es leer los archivos del cedente.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ImportService } from './imports.service';
import { TOYOTA_TCFA_MAPPING_JSON } from './plantillas/toyota-tcfa';

const DIR_REAL = '/home/maxi/Documentos/Ana Maya SA/IO_20260529';
const ARCHIVOS = ['Deudores.txt', 'DetalleDeuda.txt', 'Bajas.txt', 'CoDeudores.txt'];
const hayPaquete = ARCHIVOS.every((f) => fs.existsSync(path.join(DIR_REAL, f)));

/** Service con solo las dependencias que toca `validateRemesa`. */
function makeService(remesa: any) {
    const update = jest.fn().mockResolvedValue({});
    const prisma: any = { remesa: { findUnique: jest.fn().mockResolvedValue(remesa), update } };
    const service = new ImportService(
        prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { service, prisma, update };
}

const remesaTcfa = (archivos: Record<string, string>) => ({
    id: 1,
    empresaId: 87,
    categoria: 'MULTIARCHIVO',
    archivo: archivos.deudores ?? null,
    archivos,
    plantilla: { mappingJson: TOYOTA_TCFA_MAPPING_JSON, separador: ';', tieneHeader: true },
});

const paquetePaths = () => Object.fromEntries(
    ARCHIVOS.map((f) => [
        { 'Deudores.txt': 'deudores', 'DetalleDeuda.txt': 'detalle', 'Bajas.txt': 'bajas', 'CoDeudores.txt': 'codeudores' }[f]!,
        path.join(DIR_REAL, f),
    ]),
);

(hayPaquete ? describe : describe.skip)('MULTIARCHIVO — preview sobre el paquete real', () => {
    it('cruza los cuatro archivos y devuelve el resumen del paquete', async () => {
        const { service } = makeService(remesaTcfa(paquetePaths()));

        const r: any = await service.validateRemesa(1, 5);

        expect(r.multiarchivo).toMatchObject({
            casos: 854, facturas: 920, bajas: 85, codeudores: 55,
            cuotasDescartadas: 61, casosSinDetalle: 66,
        });
        // 854 casos + 85 bajas: es el total que el runner usa para el % de progreso.
        expect(r.total).toBe(939);
    });

    it('persiste el total para que la barra de progreso no quede clavada en 0', async () => {
        const { service, update } = makeService(remesaTcfa(paquetePaths()));

        await service.validateRemesa(1, 5);

        expect(update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ estadoProceso: 'VALIDANDO', totalFilas: 939 }),
        }));
    });

    it('el sample muestra casos armados, no filas sueltas del archivo', async () => {
        const { service } = makeService(remesaTcfa(paquetePaths()));

        const r: any = await service.validateRemesa(1, 3);

        expect(r.sample).toHaveLength(3);
        expect(r.sample[0].data).toMatchObject({ tipo: 'CASO' });
        expect(r.sample[0].data.nroCliente).toBeTruthy();
        expect(r.sample[0].data.documento).toMatch(/^\d{11}$/);
        expect(r.sample[0].data.cuotas).toBeGreaterThan(0);
    });

    it('funciona sin los archivos opcionales del paquete', async () => {
        const { deudores, detalle } = paquetePaths() as any;
        const { service } = makeService(remesaTcfa({ deudores, detalle }));

        const r: any = await service.validateRemesa(1, 1);

        expect(r.multiarchivo.casos).toBe(854);
        expect(r.multiarchivo.bajas).toBe(0);
        expect(r.multiarchivo.codeudores).toBe(0);
    });
});

/** Service con lo que toca `createRemesa`. */
function makeServiceAlta(mappingJson: any = TOYOTA_TCFA_MAPPING_JSON) {
    const create = jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 99, ...data }));
    const prisma: any = {
        plantillaimport: { findUnique: jest.fn().mockResolvedValue({ id: 7, mappingJson }) },
        remesa: { findMany: jest.fn().mockResolvedValue([]), create },
    };
    // Cada archivo guardado devuelve un hash derivado de su nombre, para poder assertar el mapa.
    const saveBuffer = jest.fn().mockImplementation((f: any) =>
        Promise.resolve({ path: `/uploads/${f.originalname}`, hash: `h-${f.originalname}` }),
    );
    const service = new ImportService(
        prisma, { saveBuffer } as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { service, prisma, create, saveBuffer };
}

const dto = (categoria = 'MULTIARCHIVO') => ({
    empresaId: 87, nombre: 'TCFA 29/05', categoria, plantillaId: 7,
}) as any;

const subidos = (...nombres: string[]) => nombres.map((originalname) => ({ originalname, buffer: Buffer.from('x') }));

describe('MULTIARCHIVO — alta de la remesa con el paquete', () => {
    it('guarda los cuatro archivos y deja el mapa de roles en la remesa', async () => {
        const { service, create, saveBuffer } = makeServiceAlta();

        await service.createRemesa(
            dto(), subidos('CoDeudores.txt', 'Bajas.txt', 'DetalleDeuda.txt', 'Deudores.txt'),
        );

        expect(saveBuffer).toHaveBeenCalledTimes(4);
        const data = create.mock.calls[0][0].data;
        expect(data.archivos).toEqual({
            deudores: '/uploads/Deudores.txt',
            detalle: '/uploads/DetalleDeuda.txt',
            bajas: '/uploads/Bajas.txt',
            codeudores: '/uploads/CoDeudores.txt',
        });
        // `archivo` apunta al principal para no romper el resto del código que lo asume.
        expect(data.archivo).toBe('/uploads/Deudores.txt');
    });

    it('el hash del paquete no depende del orden en que se subieron', async () => {
        const a = makeServiceAlta();
        await a.service.createRemesa(dto(), subidos('Deudores.txt', 'DetalleDeuda.txt', 'Bajas.txt'));
        const b = makeServiceAlta();
        await b.service.createRemesa(dto(), subidos('Bajas.txt', 'DetalleDeuda.txt', 'Deudores.txt'));

        expect(a.create.mock.calls[0][0].data.archivoHash)
            .toBe(b.create.mock.calls[0][0].data.archivoHash);
    });

    it('rechaza el paquete incompleto con un mensaje que nombra lo que falta', async () => {
        const { service, create } = makeServiceAlta();

        await expect(service.createRemesa(dto(), subidos('Deudores.txt', 'Bajas.txt')))
            .rejects.toThrow(/Falta el archivo de detalle de deuda/);
        expect(create).not.toHaveBeenCalled();
    });

    it('rechaza un archivo que no se puede clasificar en vez de cargar a medias', async () => {
        const { service } = makeServiceAlta();
        await expect(service.createRemesa(dto(), subidos('Deudores.txt', 'DetalleDeuda.txt', 'Pagos.txt')))
            .rejects.toThrow(/"Pagos.txt"/);
    });

    it('rechaza si la plantilla no tiene el layout del paquete', async () => {
        const { service } = makeServiceAlta({ entity: 'MIXTO', matchKeys: [], columns: {} });
        await expect(service.createRemesa(dto(), subidos('Deudores.txt', 'DetalleDeuda.txt')))
            .rejects.toThrow(/no tiene el layout del paquete configurado/);
    });

    it('REGRESIÓN: las categorías de un solo archivo siguen guardando igual', async () => {
        const { service, create, saveBuffer } = makeServiceAlta();

        await service.createRemesa(dto('DEUDORES'), subidos('cartera.csv'));

        expect(saveBuffer).toHaveBeenCalledTimes(1);
        const data = create.mock.calls[0][0].data;
        expect(data.archivo).toBe('/uploads/cartera.csv');
        expect(data.archivoHash).toBe('h-cartera.csv');
        // Sin paquete, la columna queda en JSON null (no en un objeto vacío).
        expect(data.archivos).toBeDefined();
        expect(data.archivos).not.toEqual(expect.objectContaining({ deudores: expect.anything() }));
    });
});

describe('MULTIARCHIVO — errores del paquete', () => {
    it('avisa qué falta si la remesa no tiene el paquete completo', async () => {
        const { service } = makeService(remesaTcfa({ deudores: '/tmp/x.txt' } as any));
        await expect(service.validateRemesa(1)).rejects.toThrow(/paquete de archivos completo/);
    });

    it('avisa si un archivo del paquete ya no está en el disco', async () => {
        const { service } = makeService(remesaTcfa({
            deudores: '/tmp/no-existe-deudores.txt', detalle: '/tmp/no-existe-detalle.txt',
        }));
        await expect(service.validateRemesa(1)).rejects.toThrow(/No se encuentra en el disco/);
    });

    it('avisa si la plantilla no tiene el layout configurado', async () => {
        const remesa = remesaTcfa({ deudores: '/tmp/a.txt', detalle: '/tmp/b.txt' });
        remesa.plantilla.mappingJson = { entity: 'MIXTO', matchKeys: [], columns: {} } as any;
        const { service } = makeService(remesa);
        await expect(service.validateRemesa(1)).rejects.toThrow(/no tiene el layout del paquete configurado/);
    });
});
