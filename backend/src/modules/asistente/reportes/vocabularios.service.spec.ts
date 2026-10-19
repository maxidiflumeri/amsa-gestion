import { Logger } from '@nestjs/common';
import { VocabulariosService } from './vocabularios.service';

function armar() {
    const prisma: any = {
        empresa: { findMany: jest.fn().mockResolvedValue([{ id: 1, nombre: 'TELECOM' }, { id: 2, nombre: 'TOYOTA' }, { id: 3, nombre: 'TOYOTA PLAN DE AHORRO' }]) },
        deudor: { groupBy: jest.fn().mockResolvedValue([{ empresaId: 2, _count: { _all: 342000 } }, { empresaId: 1, _count: { _all: 19400 } }]) },
        parametro: {
            findMany: jest.fn().mockResolvedValue([
                { grupo: 'situacion', clave: 'SIT-041', descripcion: 'PAGO PARCIAL' },
                { grupo: 'situacion', clave: 'SIT-050', descripcion: 'CANCELADO / PAGADO' },
                { grupo: 'gestion', clave: 'GES-001', descripcion: 'SIN GESTION' },
                { grupo: 'motivo_no_pago', clave: 'MNP-001', descripcion: 'DESEMPLEO' },
            ]),
        },
        formato_telefono: { findMany: jest.fn().mockResolvedValue([{ id: 1, nombre: 'WhatsApp AR', patron: '549{numero}' }, { id: 2, nombre: 'Con cero', patron: '0{numero}' }]) },
        plantilla_reporte: { findMany: jest.fn().mockResolvedValue([{ nombre: ' Cartera Toyota ' }]) },
        contacto: { findMany: jest.fn().mockResolvedValue([{ subtipo: 'celular' }, { subtipo: 'fijo' }, { subtipo: 'celular' }]) },
        llamada_neotel: { findMany: jest.fn().mockResolvedValue([{ direccion: 'OUT', estado: 'ANSWERED' }]) },
    };
    return { svc: new VocabulariosService(prisma), prisma };
}

describe('VocabulariosService', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it('carga una sola vez por TTL aunque se pida en paralelo (cache de 10 minutos)', async () => {
        const { svc, prisma } = armar();
        await Promise.all([svc.preparar(), svc.preparar(), svc.preparar()]);
        await svc.preparar();
        expect(prisma.empresa.findMany).toHaveBeenCalledTimes(1);
    });

    it('empresas con sus casos, formatos activos y nombres de plantillas (en minúscula, sin espacios)', async () => {
        const { svc } = armar();
        await svc.preparar();
        expect(svc.empresas()).toEqual([
            { id: 1, nombre: 'TELECOM', casos: 19400 },
            { id: 2, nombre: 'TOYOTA', casos: 342000 },
            { id: 3, nombre: 'TOYOTA PLAN DE AHORRO', casos: 0 },
        ]);
        expect([...svc.formatosTelefono().entries()]).toEqual([[1, 'WhatsApp AR'], [2, 'Con cero']]);
        expect(svc.nombresPlantillas().has('cartera toyota')).toBe(true);
    });

    it('vocabulario(): empresa, parámetros por grupo (clave y descripción), enums; el texto libre es null', async () => {
        const { svc } = armar();
        await svc.preparar();
        expect(svc.vocabulario('empresa.nombre')).toEqual({ valores: ['TELECOM', 'TOYOTA', 'TOYOTA PLAN DE AHORRO'], cerrado: true });
        expect(svc.vocabulario('estadoSituacion.clave')?.valores).toEqual(['SIT-041', 'SIT-050']);
        expect(svc.vocabulario('promesas.situacionAnterior.descripcion')?.valores).toEqual(['PAGO PARCIAL', 'CANCELADO / PAGADO']);
        expect(svc.vocabulario('estadoGestionPrevio.clave')?.valores).toEqual(['GES-001']);
        expect(svc.vocabulario('motivoNoPago.clave')?.valores).toEqual(['MNP-001']);
        expect(svc.vocabulario('promesas.estado')?.valores).toEqual(['VIGENTE', 'CUMPLIDA', 'INCUMPLIDA', 'ANULADA']);
        expect(svc.vocabulario('contactos.tipo')?.valores).toEqual(['telefono', 'email', 'direccion']);
        expect(svc.vocabulario('remesa.categoria')?.valores).toContain('DEUDORES');
        expect(svc.vocabulario('convenios.estado')?.cerrado).toBe(false);
        expect(svc.vocabulario('nombre')).toBeNull();
        expect(svc.vocabulario('contactos.subtipo')).toBeNull();
    });

    describe('valores_de_campo', () => {
        it('empresas: nombre exacto y casos', async () => {
            const r = await armar().svc.valores('empresa.nombre');
            expect(r.ok && r.texto).toContain('TOYOTA (342.000 casos)');
            expect(r.ok && r.texto).toContain('usá el nombre exacto');
        });

        it('buscar acota sin acentos ni mayúsculas', async () => {
            const r = await armar().svc.valores('empresa.nombre', 'toyóta');
            expect(r.ok && r.texto.split('\n').slice(1)).toEqual(['TOYOTA (342.000 casos)', 'TOYOTA PLAN DE AHORRO (0 casos)']);
        });

        it('parámetros: código — descripción', async () => {
            const r = await armar().svc.valores('estadoSituacion.clave');
            expect(r.ok && r.texto).toContain('SIT-050 — CANCELADO / PAGADO');
        });

        it('formatos de teléfono con su id y patrón', async () => {
            const r = await armar().svc.valores('formatos_telefono');
            expect(r.ok && r.texto).toContain('1: WhatsApp AR (549{numero})');
        });

        it('valores dinámicos (subtipo de contactos): distintos, de la base', async () => {
            const r = await armar().svc.valores('contactos.subtipo');
            expect(r.ok && r.texto.split('\n').slice(1)).toEqual(['celular', 'fijo']);
        });

        it('texto libre: error', async () => {
            const r = await armar().svc.valores('nombre');
            expect(r).toEqual({ ok: false, error: '«nombre» es texto libre: no tiene una lista de valores.' });
        });

        it('hasta 40 valores y dice cuántos más hay', async () => {
            const { svc, prisma } = armar();
            prisma.parametro.findMany.mockResolvedValue(Array.from({ length: 55 }, (_, i) => ({ grupo: 'situacion', clave: `SIT-${i}`, descripcion: `D${i}` })));
            const r = await svc.valores('estadoSituacion.clave');
            expect(r.ok && r.texto.split('\n')).toHaveLength(1 + 40 + 1);
            expect(r.ok && r.texto).toContain('…y 15 más');
        });

        it('sin coincidencias lo dice', async () => {
            const r = await armar().svc.valores('empresa.nombre', 'zzz');
            expect(r.ok && r.texto).toContain('ninguno coincide');
        });
    });

    it('reconocibles(): solo nombres de empresa, parámetros y enums del sistema (con campo), normalizados', async () => {
        const { svc } = armar();
        await svc.preparar();
        const m = svc.reconocibles();
        expect(m['toyota']).toEqual({ valor: 'TOYOTA', campo: 'empresa.nombre' });
        expect(m['cancelado / pagado']).toEqual({ valor: 'CANCELADO / PAGADO', campo: 'estadoSituacion.descripcion' });
        expect(m['vigente']).toEqual({ valor: 'VIGENTE', campo: 'promesas.estado' });
        expect(m['gomez']).toBeUndefined();
        // Lo corto o con paréntesis (el "(vacío = titular)") no se manda.
        expect(Object.keys(m).some((k) => k.startsWith('('))).toBe(false);
    });
});
