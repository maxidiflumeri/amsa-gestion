/**
 * Cableado de MULTICLAVES en `imports.service.ts`: el número de remesa (D5), la exención de
 * estados por defecto, la carga real vía `processImportJob` y el borrado (§5.8).
 *
 * No toca la base: todo `prisma` va mockeado, igual que `varios-archivos-wiring.spec.ts`. El
 * parseo y la clasificación de claves están cubiertos aparte en `utils/multiclaves-parser.spec.ts`
 * y `processors/multiclaves.processor.spec.ts`; acá se verifica lo que los une.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Prisma } from '@prisma/client';
import { ImportService } from './imports.service';
import { MappingJson } from './mapping-types';

/** Simula el error que tira Prisma cuando choca una unique constraint (P2002). */
function errorDuplicado(): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
    });
}

let dir: string;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'multiclaves-wiring-'));
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

const MAPPING: MappingJson = {
    entity: 'MIXTO',
    matchKeys: [],
    columns: {},
    multiclaves: { codigosGestor: ['1008'] },
};

/* ────────────────────────────────────────────────────────────────────────────
 * Alta de la remesa — número MC-… (D5)
 * ──────────────────────────────────────────────────────────────────────────── */

function makeServiceAlta() {
    const create = jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 99, ...data }));
    const prisma: any = {
        plantillaimport: { findUnique: jest.fn().mockResolvedValue({ id: 7, mappingJson: MAPPING, tieneHeader: true }) },
        remesa: { findMany: jest.fn().mockResolvedValue([{ numeroRemesa: '00608' }]), create },
    };
    const saveBuffer = jest.fn().mockImplementation((f: any) =>
        Promise.resolve({ path: `/uploads/${f.originalname}`, hash: `h-${f.originalname}` }),
    );
    const service = new ImportService(
        prisma, { saveBuffer } as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { service, create, saveBuffer, prisma };
}

const dto = (over: Record<string, unknown> = {}) => ({
    empresaId: 5, nombre: 'Claves Telecom 31/08', categoria: 'MULTICLAVES', plantillaId: 7, ...over,
}) as any;

const archivo = () => [{ originalname: 'multi.csv', buffer: Buffer.from('NRO_TRAMITE|...\n1|2|3|4|5|6|7|8|9|C\n', 'latin1') }];

describe('MULTICLAVES — número de remesa (D5)', () => {
    it('sin número propuesto, genera MC-AAAAMMDD-HHmmss', async () => {
        const { service, create } = makeServiceAlta();

        await service.createRemesa(dto(), archivo());

        const numero = create.mock.calls[0][0].data.numeroRemesa;
        expect(numero).toMatch(/^MC-\d{8}-\d{6}$/);
    });

    it('un número puramente numérico se rechaza con 400', async () => {
        const { service, create } = makeServiceAlta();

        await expect(service.createRemesa(dto({ numeroRemesa: '00609' }), archivo()))
            .rejects.toThrow(/no usan el número correlativo/);
        expect(create).not.toHaveBeenCalled();
    });

    it('un número con letras se respeta tal cual', async () => {
        const { service, create } = makeServiceAlta();

        await service.createRemesa(dto({ numeroRemesa: 'MC-ESPECIAL' }), archivo());

        expect(create.mock.calls[0][0].data.numeroRemesa).toBe('MC-ESPECIAL');
    });

    it('con divisiones → 400 (no se divide una carga de claves)', async () => {
        const { service, create } = makeServiceAlta();

        await expect(
            service.createRemesa(dto({ divisiones: [{ valores: { x: '1' }, numeroRemesa: 'A' }] }), archivo()),
        ).rejects.toThrow(/no se puede dividir/i);
        expect(create).not.toHaveBeenCalled();
    });

    it('no consulta el correlativo de remesas de la empresa (no lo necesita)', async () => {
        const { service, prisma } = makeServiceAlta();

        await service.createRemesa(dto(), archivo());

        expect(prisma.remesa.findMany).not.toHaveBeenCalled();
    });

    it('choque de número generado (dos cargas en el mismo segundo) reintenta con sufijo, nunca 500', async () => {
        const { service, prisma } = makeServiceAlta();
        // La primera vez que se intenta crear, el número ya existe (alguien lo tomó en el mismo
        // segundo); la segunda vez, con el sufijo "-2", entra.
        prisma.remesa.create = jest.fn()
            .mockRejectedValueOnce(errorDuplicado())
            .mockImplementationOnce(({ data }: any) => Promise.resolve({ id: 99, ...data }));

        const r = await service.createRemesa(dto(), archivo());

        expect(prisma.remesa.create).toHaveBeenCalledTimes(2);
        const segundoIntento = prisma.remesa.create.mock.calls[1][0].data.numeroRemesa;
        expect(segundoIntento).toMatch(/^MC-\d{8}-\d{6}-2$/);
        expect(r.remesaId).toBe(99);
    });

    it('choque de número TIPEADO por el operador da 400, nunca cambia el nombre en silencio ni 500', async () => {
        const { service, prisma } = makeServiceAlta();
        prisma.remesa.create = jest.fn().mockRejectedValue(errorDuplicado());

        await expect(service.createRemesa(dto({ numeroRemesa: 'MC-ESPECIAL' }), archivo()))
            .rejects.toThrow(/ya existe una remesa/i);
        expect(prisma.remesa.create).toHaveBeenCalledTimes(1); // no reintenta con otro nombre
    });

    it('si el choque persiste en los 5 intentos, da un error claro (no 500 opaco)', async () => {
        const { service, prisma } = makeServiceAlta();
        prisma.remesa.create = jest.fn().mockRejectedValue(errorDuplicado());

        await expect(service.createRemesa(dto(), archivo())).rejects.toThrow(/único/i);
        expect(prisma.remesa.create).toHaveBeenCalledTimes(5);
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * validateRemesa — vista previa: soloTotal distingue los trámites de una sola clave (fase 1.1)
 * ──────────────────────────────────────────────────────────────────────────── */

describe('MULTICLAVES — vista previa (validateRemesa), soloTotal', () => {
    it('cuenta los trámites SOLO_TOTAL aparte de los válidos con par, y no los mezcla con los rechazados', async () => {
        const archivoPath = path.join(dir, 'multi-preview.csv');
        // 1841012140: par TOTAL+QUITA de siempre. 2577727090: una sola línea (línea real del
        // archivo MULTI_41647, tomada con grep) → SOLO_TOTAL, no rechazado.
        const contenido = [
            'NRO_TRAMITE|NRO_CONVENIO|SALDO_TRAMITE|IMPORTE_TOTAL_CLAVE|CLAVE_PAGO|FECHA_VENCIMIENTO|SEC_COD_BARRA|CODIGO_GESTOR|APELLIDO_NOMBRE_RAZON_SOCIAL',
            '1841012140|96311343|39760.03|39760.03|0096311343000039760032|20261027|49800039760032710202600000000000096311343000000009|1008|Ana Maya S.A.|C',
            '1841012140|96332206|39760.03|19880.01|0096332206000019880014|20261027|49800019880012710202600000000000096332206000000007|1008|Ana Maya S.A.|C',
            '2577727090|96259966|272350.9|272350.9|0096259966000272350908|20261027|49800272350902710202600000000000096259966000000007|1008|Ana Maya S.A.|C',
        ].join('\n');
        fs.writeFileSync(archivoPath, Buffer.from(contenido, 'latin1'));

        const prisma: any = {
            remesa: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 42,
                    empresaId: 1,
                    categoria: 'MULTICLAVES',
                    archivo: archivoPath,
                    archivos: null,
                    plantilla: { mappingJson: MAPPING, separador: '|', tieneHeader: true },
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            deudor: { findMany: jest.fn().mockResolvedValue([]) },
            clave_pago: { findMany: jest.fn().mockResolvedValue([]) },
            empresa: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const service = new ImportService(
            prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        );

        const r = await service.validateRemesa(42);

        expect(r.multiclaves).toMatchObject({
            tramites: 2,
            validos: 2,
            rechazados: 0,
            soloTotal: 1,
            claves: 3, // 2 del par + 1 de la solo-total
        });
        expect(r.advertencias).toEqual(
            expect.arrayContaining([expect.stringContaining('1 trámite(s) llegaron con una sola clave')]),
        );
    });

    it('ajuste de auditoría: "ya cargadas" cuenta también un trámite SOLO_TOTAL recargado, no solo pares (antes comparaba contra un 2 fijo)', async () => {
        const archivoPath = path.join(dir, 'multi-preview-yacargadas.csv');
        const contenido = [
            'NRO_TRAMITE|NRO_CONVENIO|SALDO_TRAMITE|IMPORTE_TOTAL_CLAVE|CLAVE_PAGO|FECHA_VENCIMIENTO|SEC_COD_BARRA|CODIGO_GESTOR|APELLIDO_NOMBRE_RAZON_SOCIAL',
            '1841012140|96311343|39760.03|39760.03|0096311343000039760032|20261027|49800039760032710202600000000000096311343000000009|1008|Ana Maya S.A.|C',
            '1841012140|96332206|39760.03|19880.01|0096332206000019880014|20261027|49800019880012710202600000000000096332206000000007|1008|Ana Maya S.A.|C',
            '2577727090|96259966|272350.9|272350.9|0096259966000272350908|20261027|49800272350902710202600000000000096259966000000007|1008|Ana Maya S.A.|C',
        ].join('\n');
        fs.writeFileSync(archivoPath, Buffer.from(contenido, 'latin1'));

        // Simula que las 3 claves (el par de 1841012140 y la única de 2577727090) ya están cargadas
        // en esta misma empresa/trámite — como si se estuviera recargando el mismo archivo.
        const YA_CARGADAS: Record<string, string> = {
            '96311343': '1841012140', '96332206': '1841012140', '96259966': '2577727090',
        };
        const prisma: any = {
            remesa: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 42, empresaId: 1, categoria: 'MULTICLAVES', archivo: archivoPath, archivos: null,
                    plantilla: { mappingJson: MAPPING, separador: '|', tieneHeader: true },
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            deudor: { findMany: jest.fn().mockResolvedValue([]) },
            clave_pago: {
                findMany: jest.fn().mockImplementation(({ where }: any) => {
                    const convenios: string[] = where?.nroConvenio?.in ?? [];
                    return Promise.resolve(
                        convenios
                            .filter((c) => YA_CARGADAS[c])
                            .map((c) => ({ nroConvenio: c, empresaId: 1, nroTramite: YA_CARGADAS[c] })),
                    );
                }),
            },
            empresa: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const service = new ImportService(
            prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        );

        const r = await service.validateRemesa(42);

        // Los dos trámites (el par Y el SOLO_TOTAL) tienen que contar como "ya cargados": antes del
        // fix, `ex.length === 2` dejaba afuera al SOLO_TOTAL (que solo tiene 1 convenio existente).
        expect(r.multiclaves).toMatchObject({ tramites: 2, yaCargadas: 2, reemisiones: 0, conflictos: 0 });
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Fase 1.1, verificación con el archivo real completo: recargar MULTI_41647 (skip si no está)
 * ──────────────────────────────────────────────────────────────────────────── */
describe('MULTICLAVES — vista previa con el archivo real completo (skip si no está)', () => {
    const RUTA = '/home/maxi/Documentos/Ana Maya SA/teco perso/multiclaves/MULTI_41647_RA_1008_2026-08-31_10.31.09.csv';
    const existe = fs.existsSync(RUTA);

    (existe ? it : it.skip)('recargar MULTI_41647 completo (los 9.810 trámites válidos ya cargados) da yaCargadas 9.810, incluido el SOLO_TOTAL', async () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { parseMulticlaves } = require('./utils/multiclaves-parser');
        const buffer = fs.readFileSync(RUTA);
        const nombre = path.basename(RUTA);
        const parseado = parseMulticlaves([{ nombre, buffer }], { codigosGestor: ['1008'] }, new Date('2026-09-01'));
        const EMPRESA_ID = 10;

        // Mapa convenio → nroTramite de TODOS los trámites válidos, como si ya estuvieran cargados
        // en esta misma empresa (recarga idempotente completa).
        const existentePorConvenio = new Map<string, string>();
        for (const t of parseado.tramites) {
            if (t.rechazo) continue;
            for (const c of t.claves!) existentePorConvenio.set(c.nroConvenio, t.nroTramite);
        }

        const archivoPath = path.join(dir, nombre);
        fs.copyFileSync(RUTA, archivoPath);

        const prisma: any = {
            remesa: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 42, empresaId: EMPRESA_ID, categoria: 'MULTICLAVES', archivo: archivoPath, archivos: null,
                    plantilla: { mappingJson: MAPPING, separador: '|', tieneHeader: true },
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            deudor: { findMany: jest.fn().mockResolvedValue([]) },
            clave_pago: {
                findMany: jest.fn().mockImplementation(({ where }: any) => {
                    const convenios: string[] = where?.nroConvenio?.in ?? [];
                    return Promise.resolve(
                        convenios
                            .filter((c) => existentePorConvenio.has(c))
                            .map((c) => ({ nroConvenio: c, empresaId: EMPRESA_ID, nroTramite: existentePorConvenio.get(c) })),
                    );
                }),
            },
            empresa: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const service = new ImportService(
            prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
        );

        const r = await service.validateRemesa(42);

        expect(r.multiclaves).toMatchObject({
            tramites: 9810, validos: 9810, rechazados: 0, soloTotal: 1,
            yaCargadas: 9810, reemisiones: 0, conflictos: 0,
        });
    }, 30_000);
});

/* ────────────────────────────────────────────────────────────────────────────
 * processImportJob — sin estados por defecto no lanza, y carga las claves
 * ──────────────────────────────────────────────────────────────────────────── */

describe('MULTICLAVES — processImportJob sin estados por defecto', () => {
    it('no exige defaultEstadoSituacionId/defaultEstadoGestionId y carga el trámite', async () => {
        const archivoPath = path.join(dir, 'multi.csv');
        const contenido = [
            'NRO_TRAMITE|NRO_CONVENIO|SALDO_TRAMITE|IMPORTE_TOTAL_CLAVE|CLAVE_PAGO|FECHA_VENCIMIENTO|SEC_COD_BARRA|CODIGO_GESTOR|APELLIDO_NOMBRE_RAZON_SOCIAL',
            '1841012140|96311343|39760.03|39760.03|0096311343000039760032|20261027|49800039760032710202600000000000096311343000000009|1008|Ana Maya S.A.|C',
            '1841012140|96332206|39760.03|19880.01|0096332206000019880014|20261027|49800019880012710202600000000000096332206000000007|1008|Ana Maya S.A.|C',
        ].join('\n');
        fs.writeFileSync(archivoPath, Buffer.from(contenido, 'latin1'));

        const clavesRows: any[] = [];
        const remesaUpdates: any[] = [];
        const prisma: any = {
            remesa: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 42,
                    empresaId: 1,
                    categoria: 'MULTICLAVES',
                    archivo: archivoPath,
                    archivos: null,
                    totalFilas: 0,
                    plantillaId: 7,
                    usuarioCreadorId: 1,
                    validarDomicilios: false,
                    hoja: null,
                    plantilla: {
                        // Sin defaults de situación/gestión — es justo lo que se está probando.
                        defaultEstadoSituacionId: null,
                        defaultEstadoGestionId: null,
                        mappingJson: MAPPING,
                        separador: '|',
                        tieneHeader: true,
                    },
                    usuarioCreador: { id: 1, nombre: 'Tester' },
                }),
                update: jest.fn().mockImplementation(({ data }: any) => { remesaUpdates.push(data); return Promise.resolve({}); }),
            },
            importerror: { deleteMany: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({}) },
            clave_pago: {
                // Antes de cargar nada (processBatch busca convenios/vigentes) no hay nada en la base.
                // Después (afterAll busca los trámites de ESTA remesa) sí hay que verlos.
                findMany: jest.fn().mockImplementation(({ where, distinct }: any) => {
                    if (distinct) {
                        const vistos = new Set<string>();
                        return Promise.resolve(
                            clavesRows
                                .filter((r) => r.remesaId === where?.remesaId)
                                .filter((r) => {
                                    const k = distinct.map((d: string) => r[d]).join('|');
                                    if (vistos.has(k)) return false;
                                    vistos.add(k);
                                    return true;
                                }),
                        );
                    }
                    return Promise.resolve([]);
                }),
                createMany: jest.fn().mockImplementation(({ data }: any) => { clavesRows.push(...data); return Promise.resolve({ count: data.length }); }),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
                count: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(clavesRows.filter((r) =>
                    (where?.remesaId == null || r.remesaId === where.remesaId) &&
                    (where?.reemplazadaPorRemesaId == null || r.reemplazadaPorRemesaId === where.reemplazadaPorRemesaId),
                ).length)),
            },
            deudor: { findMany: jest.fn().mockResolvedValue([]) },
            $transaction: jest.fn().mockImplementation((fn: any) =>
                typeof fn === 'function'
                    ? fn({ clave_pago: prisma.clave_pago, deudor: prisma.deudor })
                    : Promise.all(fn),
            ),
        };

        const realtimeService = { emitImportIniciada: jest.fn(), emitImportProgreso: jest.fn(), emitImportFinalizada: jest.fn() };
        const notificacionesService = { crear: jest.fn().mockResolvedValue({}) };

        const service = new ImportService(
            prisma, {} as any, {} as any, realtimeService as any, notificacionesService as any,
            {} as any, {} as any, {} as any, {} as any,
        );

        const job = { data: { usuarioId: 1 }, updateProgress: jest.fn() } as any;

        await expect(service.processImportJob(job, 42)).resolves.toMatchObject({ total: 1, ok: 1, err: 0 });

        expect(clavesRows).toHaveLength(2);
        expect(clavesRows.map((r) => r.tipo).sort()).toEqual(['QUITA', 'TOTAL']);
        // Terminó FINALIZADA, no FALLIDA: la exención de estados por defecto funcionó.
        expect(remesaUpdates.some((d) => d.estadoProceso === 'FINALIZADA')).toBe(true);
        expect(remesaUpdates.some((d) => d.estadoProceso === 'FALLIDA')).toBe(false);
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Borrado (§5.8)
 * ──────────────────────────────────────────────────────────────────────────── */

/** Matcher genérico de `where` (soporta `in`/`not` como el resto de los tests de multiclaves). */
function coincide(c: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
    return Object.entries(where ?? {}).every(([k, v]) => {
        if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
            const cond = v as Record<string, unknown>;
            if ('in' in cond) return (cond.in as unknown[]).includes(c[k]);
            if ('not' in cond) return c[k] !== cond.not;
        }
        return c[k] === v;
    });
}

function makeServiceBorrado(seedClaves: any[] = [], seedConvenios = 0) {
    let claves = [...seedClaves];
    const tx = {
        clave_pago: {
            findMany: jest.fn().mockImplementation(({ where, distinct }: any) => {
                let r = claves.filter((c) => coincide(c, where));
                if (distinct) {
                    const vistos = new Set<string>();
                    r = r.filter((c) => {
                        const k = distinct.map((d: string) => c[d]).join('|');
                        if (vistos.has(k)) return false;
                        vistos.add(k);
                        return true;
                    });
                }
                return Promise.resolve(r);
            }),
            count: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(claves.filter((c) => coincide(c, where)).length)),
            updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
                let n = 0;
                for (const c of claves) if (coincide(c, where)) { Object.assign(c, data); n++; }
                return Promise.resolve({ count: n });
            }),
            deleteMany: jest.fn().mockImplementation(({ where }: any) => {
                const antes = claves.length;
                claves = claves.filter((c) => !coincide(c, where));
                return Promise.resolve({ count: antes - claves.length });
            }),
        },
        jobimport: { deleteMany: jest.fn().mockResolvedValue({}) },
        importerror: { deleteMany: jest.fn().mockResolvedValue({}) },
        remesa: { delete: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
        remesa: { findUnique: jest.fn().mockResolvedValue({ id: 55, categoria: 'MULTICLAVES', estadoProceso: 'FINALIZADA', usuarioCreadorId: 1 }) },
        convenio: { count: jest.fn().mockResolvedValue(seedConvenios) },
        $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    };
    const service = new ImportService(
        prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { service, prisma, tx, claves: () => claves };
}

describe('MULTICLAVES — borrado de la carga (§5.8)', () => {
    const user = { sub: 1, permisos: ['importacion.eliminar', 'importacion.ver_progreso_otros'] };

    it('con claves que ya tienen convenio → 400, no borra nada', async () => {
        const { service, tx } = makeServiceBorrado([], 3);

        await expect(service.deleteRemesa(55, user)).rejects.toThrow(/3 clave\(s\)/);
        expect(tx.clave_pago.deleteMany).not.toHaveBeenCalled();
    });

    it('sin convenios: borra las claves de la remesa y restaura las que había reemplazado', async () => {
        const { service, claves } = makeServiceBorrado([
            { id: 1, empresaId: 1, remesaId: 100, nroTramite: 'T1', estado: 'REEMPLAZADA', reemplazadaPorRemesaId: 55, fechaVencimiento: new Date('2026-10-27'), createdAt: new Date('2026-08-01') },
            { id: 2, empresaId: 1, remesaId: 55, nroTramite: 'T1', estado: 'VIGENTE', reemplazadaPorRemesaId: null, fechaVencimiento: new Date('2026-11-27'), createdAt: new Date('2026-09-01') },
        ], 0);

        const r = await service.deleteRemesa(55, user);

        expect(r).toMatchObject({ deleted: true, clavesEliminadas: 1, clavesRestauradas: 1 });
        const restante = claves().find((c) => c.id === 1);
        expect(restante.estado).toBe('VIGENTE');
        expect(restante.reemplazadaPorRemesaId).toBeNull();
        expect(claves().find((c) => c.id === 2)).toBeUndefined(); // borrada
    });

    // El caso completo (cadena A→B→C con el processor real, y la tanda "anterior" que no debe
    // reactivarse) queda cubierto a fondo en multiclaves-borrado-reemision.spec.ts — ahí se prueban
    // las dos secuencias del hallazgo del auditor más el invariante de 0/2 vigentes.
    it('cadena A→B→C: al borrar B, A repunta a C (que sigue vigente), sin dejar nada colgado', async () => {
        const { service, claves } = makeServiceBorrado([
            { id: 1, empresaId: 1, remesaId: 100, nroTramite: 'T1', estado: 'REEMPLAZADA', reemplazadaPorRemesaId: 200, fechaVencimiento: new Date('2026-10-27'), createdAt: new Date('2026-08-01') }, // A, reemplazada por B(200)
            { id: 2, empresaId: 1, remesaId: 200, nroTramite: 'T1', estado: 'REEMPLAZADA', reemplazadaPorRemesaId: null, fechaVencimiento: new Date('2026-11-27'), createdAt: new Date('2026-09-01') }, // B, será borrada
            { id: 3, empresaId: 1, remesaId: 300, nroTramite: 'T1', estado: 'VIGENTE', reemplazadaPorRemesaId: null, fechaVencimiento: new Date('2026-12-27'), createdAt: new Date('2026-10-01') }, // C, vigente actual
        ], 0);

        const r = await service.deleteRemesa(200, user);

        expect(r).toMatchObject({ deleted: true, clavesEliminadas: 1 });
        const a = claves().find((c) => c.id === 1);
        const c = claves().find((c) => c.id === 3);
        expect(c.estado).toBe('VIGENTE'); // C sigue siendo la ganadora real
        expect(a.estado).toBe('REEMPLAZADA');
        expect(a.reemplazadaPorRemesaId).toBe(300); // repuntada a C, no a B (que ya no existe)
    });
});
