import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { ErrorPerfil } from './perfil-ejemplo';
import { PerfilEjemploService } from './perfil-ejemplo.service';

const dir = path.join(__dirname, '..', '__fixtures__', 'reportes');
const leer = (n: string) => fs.readFileSync(path.join(dir, n));

/** El worker corre de verdad: un hilo con ts-node (en `dist`, el mismo servicio carga el .js; ver el arranque en dist del cierre). */
describe('PerfilEjemploService (worker_thread)', () => {
    beforeEach(() => {
        delete process.env.ASISTENTE_PERFIL_EN_LINEA;
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
        jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('perfila un Excel en el hilo y devuelve lo mismo que la función pura', async () => {
        const perfil = await new PerfilEjemploService().perfilar(leer('ejemplo_cartera_toyota.xlsx'), 'ejemplo_cartera_toyota.xlsx', {});
        expect(perfil.hojas[0].columnas).toHaveLength(9);
        expect(perfil.hojas[0].conEncabezado).toBe(true);
        expect(perfil.tipo).toBe('xlsx');
    }, 30_000);

    it('los valores reconocidos viajan al hilo', async () => {
        const perfil = await new PerfilEjemploService().perfilar(leer('base_neotel.txt'), 'base_neotel.txt', { toyota: { valor: 'TOYOTA', campo: 'empresa.nombre' } });
        expect(perfil.hojas[0].columnas.find((c) => c.encabezado === 'Empresa')?.reconocidos).toEqual([{ valor: 'TOYOTA', campo: 'empresa.nombre' }]);
    }, 30_000);

    it('el error del archivo llega con su código', async () => {
        const e = await new PerfilEjemploService().perfilar(Buffer.from('%PDF-1.7 x'), 'a.pdf', {}).catch((x) => x);
        expect(e).toBeInstanceOf(ErrorPerfil);
        expect(e.codigo).toBe('TIPO_NO_SOPORTADO');
    }, 30_000);

    it('si el hilo tarda más del timeout, se lo corta: ILEGIBLE «tardó demasiado»', async () => {
        const svc = new PerfilEjemploService();
        svc.timeoutMs = 1;
        const e = await svc.perfilar(leer('ejemplo_cartera_toyota.xlsx'), 'a.xlsx', {}).catch((x) => x);
        expect(e).toBeInstanceOf(ErrorPerfil);
        expect(e.codigo).toBe('ILEGIBLE');
        expect(e.message).toContain('tardó demasiado');
    }, 30_000);

    it('ASISTENTE_PERFIL_EN_LINEA=1 lo perfila en el mismo hilo (solo tests)', async () => {
        process.env.ASISTENTE_PERFIL_EN_LINEA = '1';
        const perfil = await new PerfilEjemploService().perfilar(leer('pagos_semana.csv'), 'pagos_semana.csv', {});
        expect(perfil.texto?.separador).toBe(';');
    });

    it('el perfilado tiene cola: con los 2 cupos ocupados, el 3.º espera y si no hay lugar a tiempo da OCUPADO', async () => {
        const svc = new PerfilEjemploService();
        svc.esperaMs = 50;
        const a = await svc.semaforo.adquirir(10);
        const b = await svc.semaforo.adquirir(10);
        expect(a && b).toBeTruthy();
        const e = await svc.perfilar(leer('pagos_semana.csv'), 'a.csv', {}).catch((x) => x);
        expect(e).toBeInstanceOf(ErrorPerfil);
        expect(e.codigo).toBe('OCUPADO');
        a!();
        await expect(svc.perfilar(leer('pagos_semana.csv'), 'a.csv', {})).resolves.toBeDefined();
        b!();
    }, 30_000);

    it('ASISTENTE_PERFIL_EN_LINEA no se puede activar en producción', async () => {
        process.env.ASISTENTE_PERFIL_EN_LINEA = '1';
        const nodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const svc = new PerfilEjemploService();
            svc.timeoutMs = 1;
            const e = await svc.perfilar(leer('ejemplo_cartera_toyota.xlsx'), 'a.xlsx', {}).catch((x) => x);
            // Si se hubiera perfilado en línea, habría resuelto; con hilo y 1 ms de timeout, falla.
            expect(e).toBeInstanceOf(ErrorPerfil);
        } finally {
            process.env.NODE_ENV = nodeEnv;
        }
    }, 30_000);
});
