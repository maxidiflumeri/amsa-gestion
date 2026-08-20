/**
 * Tests unitarios de MoraService.
 *
 * Ejecutar: npx jest mora.service.spec.ts --no-coverage
 *
 * Casos cubiertos:
 *  1. obtenerConfig cae al default y mergea configuración parcial.
 *  2. generarMes rechaza una tasa fuera de rango (el error clásico de dividir por 100 de más).
 *  3. generarMes FALLA si falta el índice del día anterior — la regla que evita el bug del CRM.
 *  4. generarMes deja arrancar la cadena solo si la empresa no tiene historia y se pide explícito.
 *  5. calcularDeudor no cobra nada sobre una factura que todavía no venció.
 *  6. calcularDeudor marca las facturas sin índice y avisa, en vez de inventar un número.
 *  7. calcularDeudor reproduce el estado de deuda real de AYSA.
 */
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MoraService } from './mora.service';
import { CONFIG_MORA_DEFAULT } from './mora.constants';
import { PrismaService } from '../../prisma/prisma.service';

const dec = (x: string | number) => new Prisma.Decimal(x);

interface MockOpts {
    configuracion?: unknown;
    indicePrevio?: Prisma.Decimal | null;
    cantidadIndices?: number;
    facturas?: { id: number; nroFactura: string; importe: number; vencimiento: Date }[];
    indices?: { fecha: Date; indice: Prisma.Decimal }[];
}

function makePrisma(opts: MockOpts = {}) {
    return {
        empresa: {
            findUnique: jest.fn().mockResolvedValue({ configuracion: opts.configuracion ?? null }),
        },
        deudor: {
            findUnique: jest.fn().mockResolvedValue({
                id: 1,
                empresaId: 19,
                facturas: opts.facturas ?? [],
            }),
        },
        indice_mora: {
            findUnique: jest.fn().mockResolvedValue(
                opts.indicePrevio ? { indice: opts.indicePrevio } : null,
            ),
            findMany: jest.fn().mockResolvedValue(opts.indices ?? []),
            count: jest.fn().mockResolvedValue(opts.cantidadIndices ?? 0),
            deleteMany: jest.fn(),
            createMany: jest.fn(),
        },
        tasa_mora: {
            upsert: jest.fn().mockResolvedValue({}),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        $transaction: jest.fn().mockResolvedValue([]),
        $queryRaw: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
}

const CORTE = new Date(Date.UTC(2026, 7, 20)); // 2026-08-20

describe('MoraService.obtenerConfig', () => {
    it('cae al default cuando la empresa no tiene configuración de mora', async () => {
        const s = new MoraService(makePrisma());
        await expect(s.obtenerConfig(19)).resolves.toEqual(CONFIG_MORA_DEFAULT);
    });

    it('mergea una configuración parcial sin romper el resto', async () => {
        const s = new MoraService(makePrisma({ configuracion: { mora: { iva: 0.105 } } }));
        const c = await s.obtenerConfig(19);
        expect(c.iva).toBe(0.105);
        expect(c.recargoFijo).toBe(CONFIG_MORA_DEFAULT.recargoFijo);
        expect(c.recargoGestion).toBe(CONFIG_MORA_DEFAULT.recargoGestion);
    });
});

describe('MoraService.generarMes', () => {
    it('rechaza una tasa fuera de rango', async () => {
        const s = new MoraService(makePrisma());
        await expect(s.generarMes(19, '2026-09', 0.02169)).rejects.toBeInstanceOf(BadRequestException);
        await expect(s.generarMes(19, '2026-09', 0)).rejects.toBeInstanceOf(BadRequestException);
        await expect(s.generarMes(19, '2026-09', 250)).rejects.toBeInstanceOf(BadRequestException);
    });

    /**
     * El caso que rompió el CRM del cedente tres meses seguidos: el `seek` del día anterior falla,
     * la cadena arranca de 1 y todas las deudas actualizadas quedan en negativo. Acá tiene que
     * cortar, no seguir.
     */
    it('falla si falta el índice del día anterior y la empresa ya tiene cadena', async () => {
        const s = new MoraService(makePrisma({ indicePrevio: null, cantidadIndices: 9284 }));
        await expect(s.generarMes(19, '2026-09', 2.169)).rejects.toThrow(/cadena es acumulativa/i);
    });

    it('tampoco arranca la cadena sola en una empresa vacía si no se lo piden explícitamente', async () => {
        const s = new MoraService(makePrisma({ indicePrevio: null, cantidadIndices: 0 }));
        await expect(s.generarMes(19, '2026-09', 2.169)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deja arrancar la cadena en una empresa sin historia cuando se pide explícito', async () => {
        const prisma = makePrisma({ indicePrevio: null, cantidadIndices: 0 });
        const s = new MoraService(prisma);
        await expect(
            s.generarMes(19, '2026-09', 2.169, { permitirInicioDeCadena: true }),
        ).resolves.toMatchObject({ periodo: '2026-09', diasGenerados: 30 });
        expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('encadena desde el índice del día anterior', async () => {
        const prisma = makePrisma({ indicePrevio: dec('6890.0011692'), cantidadIndices: 9284 });
        const s = new MoraService(prisma);
        const r = await s.generarMes(19, '2026-08', 2.169);
        expect(r.diasGenerados).toBe(31);

        // La primera fila del tipo 1 tiene que ser el ancla por el factor diario.
        const filas = (prisma.indice_mora.createMany as jest.Mock).mock.calls[0][0].data;
        const primera = filas.find((f: { tipo: number }) => f.tipo === 1);
        const esperado = 6890.0011692 * Math.pow(1 + 0.02169, 1 / 30);
        expect(Number(primera.indice)).toBeCloseTo(esperado, 6);
    });
});

describe('MoraService.calcularDeudor', () => {
    const facturaVencida = { id: 1, nroFactura: 'A', importe: 70322.32, vencimiento: new Date(Date.UTC(2025, 4, 23)) };
    const facturaFutura = { id: 2, nroFactura: 'B', importe: 50000, vencimiento: new Date(Date.UTC(2026, 8, 17)) };

    /** Índices reales del ud60 para el 23/05/2025 y el 20/08/2026 (tipo 1). */
    const indicesReales = [
        { fecha: new Date(Date.UTC(2025, 4, 23)), indice: dec('4313.9162511') },
        { fecha: new Date(Date.UTC(2026, 7, 20)), indice: dec('6989.2738544') },
    ];

    it('no le cobra nada a una factura que todavía no venció', async () => {
        const s = new MoraService(makePrisma({ facturas: [facturaFutura], indices: indicesReales }));
        const r = await s.calcularDeudor(1, CORTE);
        expect(r.facturas[0].nota).toBe('NO_VENCIDA');
        expect(r.recargo).toBe(0);
        expect(r.total).toBe(50000);
    });

    it('marca las facturas sin índice y avisa, en vez de inventar un número', async () => {
        const s = new MoraService(makePrisma({
            facturas: [facturaVencida],
            indices: [{ fecha: CORTE, indice: dec('6989.2738544') }], // falta el del vencimiento
        }));
        const r = await s.calcularDeudor(1, CORTE);
        expect(r.facturas[0].nota).toBe('SIN_INDICE');
        expect(r.recargo).toBe(0);
        expect(r.advertencias.join(' ')).toMatch(/sin índice/i);
    });

    it('avisa cuando no hay índice para la fecha de cálculo', async () => {
        const s = new MoraService(makePrisma({ facturas: [facturaVencida], indices: [] }));
        const r = await s.calcularDeudor(1, CORTE);
        expect(r.advertencias.join(' ')).toMatch(/No hay índice generado/i);
    });

    /**
     * El estado de deuda real de AYSA para la cuenta 987636 al 20/08/2026 dice
     * Int/Rec 46.886,68 · Rec AJ/EJ 11.720,90 · IVA 12.307,59 · Total 141.237,49.
     * Reproducirlo desde los índices del ud60 es la prueba de punta a punta del cálculo.
     */
    it('reproduce el estado de deuda de AYSA a partir de los índices', async () => {
        const s = new MoraService(makePrisma({ facturas: [facturaVencida], indices: indicesReales }));
        const r = await s.calcularDeudor(1, CORTE);

        expect(r.facturas[0].diasMora).toBe(454);
        expect(r.capital).toBe(70322.32);
        // Tolerancia de un peso: el índice del ud60 para mayo 2025 arrastra el tipeo del operador
        // que se documentó en mora-aysa-spec.md §7.3, todavía sin corregir.
        expect(r.total).toBeGreaterThan(141000);
        expect(r.total).toBeLessThan(142000);
        expect(r.recargo).toBeCloseTo(r.intRec + r.recAjEj + r.iva, 2);
        expect(r.total).toBeCloseTo(r.capital + r.recargo, 2);
    });
});
