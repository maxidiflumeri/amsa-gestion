import * as fs from 'fs';
import * as path from 'path';
import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import { AdjuntosService, MAX_BYTES_DEFAULT, leerMaxBytes } from './adjuntos.service';
import { ErrorPerfil, perfilarArchivo } from './perfil-ejemplo';

const dir = path.join(__dirname, '..', '__fixtures__', 'reportes');
const leer = (n: string) => fs.readFileSync(path.join(dir, n));
const archivo = (n: string) => {
    const buffer = leer(n);
    return { buffer, originalname: n, size: buffer.length };
};
const cuerpo = (e: HttpException) => e.getResponse() as Record<string, unknown>;

function armar(opts: { hoy?: number; igual?: object | null } = {}) {
    const creadas: any[] = [];
    const prisma: any = {
        asistente_adjunto: {
            count: jest.fn().mockResolvedValue(opts.hoy ?? 0),
            findFirst: jest.fn().mockResolvedValue(opts.igual ?? null),
            create: jest.fn(async ({ data }: any) => {
                const f = { id: 31, conversacionId: null, mensajeId: null, createdAt: new Date(), ...data };
                creadas.push(f);
                return f;
            }),
            update: jest.fn(async ({ data, where }: any) => ({ ...(creadas[0] ?? {}), id: where.id, ...data })),
            delete: jest.fn().mockResolvedValue({}),
            findMany: jest.fn().mockResolvedValue([]),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        asistente_mensaje: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const perfiles: any = { perfilar: jest.fn(async (b: Buffer, n: string, r: any) => perfilarArchivo(b, n, r)) };
    const vocabularios: any = { preparar: jest.fn().mockResolvedValue(undefined), reconocibles: jest.fn().mockReturnValue({}) };
    return { svc: new AdjuntosService(prisma, perfiles, vocabularios), prisma, perfiles, creadas };
}

describe('AdjuntosService', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
        delete process.env.ASISTENTE_ADJUNTO_MAX_BYTES;
    });
    afterEach(() => jest.restoreAllMocks());

    describe('subir', () => {
        it('guarda el perfil (sin el archivo ni los valores) y devuelve el resumen del chip', async () => {
            const { svc, prisma, creadas } = armar();
            const r = await svc.subir(7, archivo('ejemplo_cartera_toyota.xlsx'));
            expect(r).toMatchObject({ id: 31, nombre: 'ejemplo_cartera_toyota.xlsx', tipo: 'xlsx' });
            expect(r.resumen).toMatchObject({ columnas: 9, filasDatos: 3, conEncabezado: true, anchoFijo: false });
            expect(r.resumen.encabezados).toEqual(['DNI', 'Cliente', 'Nro Cliente']);
            const data = prisma.asistente_adjunto.create.mock.calls[0][0].data;
            expect(data.sha256).toMatch(/^[0-9a-f]{64}$/);
            expect(data.usuarioId).toBe(7);
            expect(JSON.stringify(creadas[0])).not.toMatch(/30111222|mlgomez|Gómez/);
            expect(Object.keys(data)).not.toContain('buffer');
        });

        it('no escribe nada al filesystem', async () => {
            const real = jest.requireActual<typeof import('fs')>('fs');
            const espias = [jest.spyOn(real.promises, 'writeFile'), jest.spyOn(real.promises, 'mkdir'), jest.spyOn(real, 'createWriteStream'), jest.spyOn(real, 'writeFile')];
            const { svc } = armar();
            await svc.subir(7, archivo('pagos_semana.csv'));
            for (const e of espias) expect(e).not.toHaveBeenCalled();
        });

        it('más de 5 MB: 413 DEMASIADO_GRANDE, sin leer el archivo', async () => {
            const { svc, perfiles } = armar();
            const e = await svc.subir(7, { buffer: Buffer.alloc(10), originalname: 'a.xlsx', size: MAX_BYTES_DEFAULT + 1 }).catch((x) => x);
            expect(e).toBeInstanceOf(HttpException);
            expect(e.getStatus()).toBe(413);
            expect(cuerpo(e).codigo).toBe('DEMASIADO_GRANDE');
            expect(perfiles.perfilar).not.toHaveBeenCalled();
        });

        it('ASISTENTE_ADJUNTO_MAX_BYTES cambia el máximo; un valor inválido vuelve al default', () => {
            process.env.ASISTENTE_ADJUNTO_MAX_BYTES = '1048576';
            expect(leerMaxBytes()).toBe(1048576);
            process.env.ASISTENTE_ADJUNTO_MAX_BYTES = 'mucho';
            expect(leerMaxBytes()).toBe(MAX_BYTES_DEFAULT);
        });

        it('la 31.ª subida del día: 429 LIMITE_ADJUNTOS', async () => {
            const { svc, perfiles } = armar({ hoy: 30 });
            const e = await svc.subir(7, archivo('pagos_semana.csv')).catch((x) => x);
            expect(e.getStatus()).toBe(429);
            expect(cuerpo(e).codigo).toBe('LIMITE_ADJUNTOS');
            expect(perfiles.perfilar).not.toHaveBeenCalled();
        });

        it.each([
            ['un PDF', Buffer.from('%PDF-1.7 hola'), 'a.pdf', 'TIPO_NO_SOPORTADO'],
            ['un .xlsm', leer('ejemplo_cartera_toyota.xlsx'), 'a.xlsm', 'TIPO_NO_SOPORTADO'],
            ['un .xlsx renombrado .csv', leer('ejemplo_cartera_toyota.xlsx'), 'a.csv', 'NO_COINCIDE_EXTENSION'],
            ['un archivo vacío', Buffer.alloc(0), 'a.csv', 'VACIO'],
        ])('%s: 400 %s, sin guardar nada', async (_n, buffer, nombre, codigo) => {
            const { svc, prisma } = armar();
            const e = await svc.subir(7, { buffer, originalname: nombre, size: buffer.length }).catch((x) => x);
            expect(e.getStatus()).toBe(400);
            expect(cuerpo(e).codigo).toBe(codigo);
            expect(prisma.asistente_adjunto.create).not.toHaveBeenCalled();
        });

        it('un error del worker (timeout) llega como 400 ILEGIBLE', async () => {
            const { svc, perfiles } = armar();
            perfiles.perfilar.mockRejectedValue(new ErrorPerfil('ILEGIBLE', 'El archivo tardó demasiado en leerse.'));
            const e = await svc.subir(7, archivo('pagos_semana.csv')).catch((x) => x);
            expect(e.getStatus()).toBe(400);
            expect(cuerpo(e)).toMatchObject({ codigo: 'ILEGIBLE', mensaje: 'El archivo tardó demasiado en leerse.' });
        });

        it('sin archivo: 400 VACIO', async () => {
            const e = await armar().svc.subir(7, undefined).catch((x) => x);
            expect(cuerpo(e).codigo).toBe('VACIO');
        });

        it('el mismo archivo (mismo contenido y nombre) subido dos veces sin mandar reusa el perfil pero con OTRO id', async () => {
            const primera = armar();
            const subido = await primera.svc.subir(7, archivo('pagos_semana.csv'));
            const { svc, perfiles, prisma, creadas } = armar({ igual: primera.creadas[0] });
            let proximo = 90;
            prisma.asistente_adjunto.create.mockImplementation(async ({ data }: any) => {
                const f = { id: ++proximo, conversacionId: null, mensajeId: null, createdAt: new Date(), ...data };
                creadas.push(f);
                return f;
            });
            const otra = await svc.subir(7, archivo('pagos_semana.csv'));
            expect(otra.id).not.toBe(subido.id);
            expect(otra.resumen).toEqual(subido.resumen);
            expect(perfiles.perfilar).not.toHaveBeenCalled();
            expect(prisma.asistente_adjunto.findFirst.mock.calls[0][0].where).toMatchObject({ sha256: expect.any(String), nombre: 'pagos_semana.csv' });
        });

        it('el dedupe corre DESPUÉS de validar el tipo: el mismo contenido como .xlsm o renombrado .csv no devuelve el adjunto viejo', async () => {
            const previo = armar();
            await previo.svc.subir(7, archivo('ejemplo_cartera_toyota.xlsx'));
            const { svc, prisma } = armar({ igual: previo.creadas[0] });
            const buf = leer('ejemplo_cartera_toyota.xlsx');
            const xlsm = await svc.subir(7, { buffer: buf, originalname: 'macro.xlsm', size: buf.length }).catch((x) => x);
            expect(cuerpo(xlsm).codigo).toBe('TIPO_NO_SOPORTADO');
            const csv = await svc.subir(7, { buffer: buf, originalname: 'renombrado.csv', size: buf.length }).catch((x) => x);
            expect(cuerpo(csv).codigo).toBe('NO_COINCIDE_EXTENSION');
            expect(prisma.asistente_adjunto.findFirst).not.toHaveBeenCalled();
        });

        it('un .xls con extensión .xlsx da NO_COINCIDE_EXTENSION', async () => {
            const buf = leer('reporte_promesas.xls');
            const e = await armar().svc.subir(7, { buffer: buf, originalname: 'promesas.xlsx', size: buf.length }).catch((x) => x);
            expect(cuerpo(e).codigo).toBe('NO_COINCIDE_EXTENSION');
        });

        it('el límite de 30 por día es atómico: dos subidas simultáneas con 29 hechas dejan pasar solo una', async () => {
            const a = armar({ hoy: 29 });
            let hechas = 29;
            a.prisma.asistente_adjunto.count.mockImplementation(async () => hechas);
            a.prisma.asistente_adjunto.create.mockImplementation(async ({ data }: any) => {
                hechas++;
                return { id: hechas, conversacionId: null, mensajeId: null, createdAt: new Date(), ...data };
            });
            const r = await Promise.allSettled([a.svc.subir(7, archivo('pagos_semana.csv')), a.svc.subir(7, archivo('base_neotel.txt'))]);
            expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
            const rechazada = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
            expect(cuerpo(rechazada.reason).codigo).toBe('LIMITE_ADJUNTOS');
            expect(hechas).toBe(30);
        });

        it('los avisos de la lectura quedan en el chip y el nombre se limpia de rutas', async () => {
            const { svc, prisma } = armar();
            await svc.subir(7, { ...archivo('pagos_semana.csv'), originalname: '..\\..\\etc/pagos_semana.csv' });
            expect(prisma.asistente_adjunto.create.mock.calls[0][0].data.nombre).not.toMatch(/[\\/]/);
        });
    });

    describe('actualizar y borrar', () => {
        async function conAdjunto(extra: object = {}) {
            const a = armar();
            await a.svc.subir(7, archivo('ejemplo_cartera_toyota.xlsx'));
            a.prisma.asistente_adjunto.findFirst.mockResolvedValue({ ...a.creadas[0], ...extra });
            return a;
        }

        it('«La primera fila no es el encabezado»: pasa a las estadísticas sin encabezado y borra los literales', async () => {
            const { svc, prisma } = await conAdjunto();
            const r = await svc.actualizar(7, 31, false);
            expect(r.resumen.conEncabezado).toBe(false);
            expect(r.resumen.encabezados).toEqual([]);
            const guardado = JSON.stringify(prisma.asistente_adjunto.update.mock.calls[0][0].data.perfil);
            expect(guardado).not.toContain('Nro Cliente');
        });

        it('volver a usar la primera fila como encabezado pide subir de nuevo (no se guardan literales)', async () => {
            const { svc } = await conAdjunto();
            const sin = await svc.actualizar(7, 31, false);
            expect(sin.resumen.conEncabezado).toBe(false);
            const { svc: otro, prisma } = await conAdjunto();
            const perfil = (prisma.asistente_adjunto.findFirst.mock.results[0] as unknown);
            void perfil;
            const sinEnc = (await prisma.asistente_adjunto.findFirst()).perfil;
            prisma.asistente_adjunto.findFirst.mockResolvedValue({ ...(await prisma.asistente_adjunto.findFirst()), perfil: { ...sinEnc, hojas: sinEnc.hojas.map((h: any) => ({ ...h, conEncabezado: false })) } });
            const e = await otro.actualizar(7, 31, true).catch((x) => x);
            expect(cuerpo(e).codigo).toBe('NO_SE_PUEDE');
        });

        it('uno ya enviado: 409 YA_ENVIADO (PATCH y DELETE)', async () => {
            const { svc } = await conAdjunto({ conversacionId: 4, mensajeId: 9 });
            expect(cuerpo(await svc.actualizar(7, 31, false).catch((x) => x))).toMatchObject({ codigo: 'YA_ENVIADO' });
            expect(cuerpo(await svc.borrar(7, 31).catch((x) => x))).toMatchObject({ codigo: 'YA_ENVIADO' });
        });

        it('ajeno o inexistente: 404', async () => {
            const { svc, prisma } = armar();
            prisma.asistente_adjunto.findFirst.mockResolvedValue(null);
            await expect(svc.borrar(7, 31)).rejects.toBeInstanceOf(NotFoundException);
            await expect(svc.actualizar(7, 31, false)).rejects.toBeInstanceOf(NotFoundException);
        });

        it('borra el propio sin mandar', async () => {
            const { svc, prisma } = await conAdjunto();
            await svc.borrar(7, 31);
            expect(prisma.asistente_adjunto.delete).toHaveBeenCalledWith({ where: { id: 31 } });
        });
    });

    describe('vincular (dentro de la transacción de crearTurno)', () => {
        const base = { usuarioId: 7, conversacionId: 12, mensajeId: 40 };
        const hace = (h: number) => new Date(Date.now() - h * 3600_000);

        it('vincula los nuevos a la conversación y al mensaje, y devuelve cuáles son nuevos', async () => {
            const { svc } = armar();
            const tx: any = { asistente_adjunto: { findMany: jest.fn().mockResolvedValue([{ id: 4, conversacionId: null, createdAt: hace(1) }]), count: jest.fn().mockResolvedValue(0), updateMany: jest.fn() } };
            await expect(svc.vincular(tx, { ...base, ids: [4] })).resolves.toEqual([4]);
            expect(tx.asistente_adjunto.updateMany).toHaveBeenCalledWith({ where: { id: { in: [4] } }, data: { conversacionId: 12, mensajeId: 40 } });
            expect(tx.asistente_adjunto.findMany.mock.calls[0][0].where).toMatchObject({ usuarioId: 7 });
        });

        it.each([
            ['ajeno o inexistente', []],
            ['de otra conversación', [{ id: 4, conversacionId: 99, createdAt: hace(1) }]],
            ['de más de 24 h sin mandar', [{ id: 4, conversacionId: null, createdAt: hace(25) }]],
        ])('%s: 400 ADJUNTO_INVALIDO', async (_n, filas) => {
            const { svc } = armar();
            const tx: any = { asistente_adjunto: { findMany: jest.fn().mockResolvedValue(filas), count: jest.fn().mockResolvedValue(0), updateMany: jest.fn() } };
            const e = await svc.vincular(tx, { ...base, ids: [4] }).catch((x) => x);
            expect(e.getStatus()).toBe(400);
            expect(cuerpo(e).codigo).toBe('ADJUNTO_INVALIDO');
            expect(tx.asistente_adjunto.updateMany).not.toHaveBeenCalled();
        });

        it('uno ya vinculado a ESTA conversación se acepta de nuevo y no se vuelve a vincular', async () => {
            const { svc } = armar();
            const tx: any = { asistente_adjunto: { findMany: jest.fn().mockResolvedValue([{ id: 4, conversacionId: 12, createdAt: hace(30) }]), count: jest.fn().mockResolvedValue(1), updateMany: jest.fn() } };
            await expect(svc.vincular(tx, { ...base, ids: [4] })).resolves.toEqual([]);
            expect(tx.asistente_adjunto.updateMany).not.toHaveBeenCalled();
        });

        it('más de 6 por conversación: 400', async () => {
            const { svc } = armar();
            const tx: any = { asistente_adjunto: { findMany: jest.fn().mockResolvedValue([{ id: 4, conversacionId: null, createdAt: hace(1) }]), count: jest.fn().mockResolvedValue(6), updateMany: jest.fn() } };
            const e = await svc.vincular(tx, { ...base, ids: [4] }).catch((x) => x);
            expect(cuerpo(e).codigo).toBe('ADJUNTO_INVALIDO');
        });

        it('sin ids no toca la base', async () => {
            const { svc } = armar();
            const tx: any = { asistente_adjunto: { findMany: jest.fn() } };
            await expect(svc.vincular(tx, { ...base, ids: [] })).resolves.toEqual([]);
            expect(tx.asistente_adjunto.findMany).not.toHaveBeenCalled();
        });
    });

    describe('paraTurno', () => {
        it('el perfil se reenvía si el turno que lo mandó no terminó bien (no entró al historial)', async () => {
            const { svc, prisma, creadas } = armar();
            await svc.subir(7, archivo('pagos_semana.csv'));
            const base = creadas[0];
            prisma.asistente_adjunto.findMany.mockResolvedValue([{ ...base, id: 4, conversacionId: 12, mensajeId: 10 }, { ...base, id: 5, conversacionId: 12, mensajeId: 20 }]);
            prisma.asistente_mensaje.findMany.mockResolvedValue([
                { id: 10, rol: 'usuario', estado: 'ok' },
                { id: 11, rol: 'asistente', estado: 'ok' },
                { id: 20, rol: 'usuario', estado: 'ok' },
                { id: 21, rol: 'asistente', estado: 'error' },
                { id: 30, rol: 'usuario', estado: 'ok' },
                { id: 31, rol: 'asistente', estado: 'en_curso' },
            ]);
            const r = await svc.paraTurno(12, 30);
            expect(r.ejemplos.map((e) => e.id)).toEqual([4, 5]);
            expect(r.nuevos.map((e) => e.id)).toEqual([5]);
            // El principal es el primero de la conversación: un adjunto posterior no lo reemplaza.
            expect(r.principalId).toBe(4);
        });
    });
});
