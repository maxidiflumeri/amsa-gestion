// C2b: la lógica de useVigiaGrupo con tiempo simulado (TV-4 y TV-6 en `npm test`). Los 15 s y los 5 s del hook NO se acortan: el reloj es
// el que avanza. Contra el asistente real y con tiempo real van las de tests/lento/vigia-grupo.test.tsx.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import { VIGIA_CADA_MS, VIGIA_ESPERA_MS, useVigiaGrupo } from '@fe/hooks/useVigiaGrupo';
import { dtoC1 } from '../lib/fabricas';

const { obtenerEstadoCarga } = vi.hoisted(() => ({ obtenerEstadoCarga: vi.fn<(id: number) => Promise<EstadoCargaDto>>() }));
vi.mock('@fe/api/imports', () => ({ obtenerEstadoCarga }));

let root: Root | null = null;
let contenedor: HTMLElement | null = null;
const adoptados: string[] = [];
let tardando = false;

function Sonda({ id }: { id: number | null }) {
    const r = useVigiaGrupo(id, (g) => adoptados.push(g));
    tardando = r.tardando;
    return null;
}
const montar = async (id: number | null) => {
    contenedor = document.createElement('div');
    root = createRoot(contenedor);
    await act(async () => { root!.render(<Sonda id={id} />); });
};
const avanzar = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const enGrupo = (over: Record<string, unknown> = {}) => dtoC1({ remesaId: 141, grupoId: 'g1', grupoOrden: 1, grupoTotal: 3, ...over });

beforeEach(() => {
    vi.useFakeTimers();
    obtenerEstadoCarga.mockReset();
    obtenerEstadoCarga.mockResolvedValue(enGrupo({ fase: 'BORRADOR', enCurso: false }));
    adoptados.length = 0;
    tardando = false;
});
afterEach(async () => {
    if (root) await act(async () => { root!.unmount(); });
    root = null; contenedor = null;
    vi.useRealTimers();
});

describe('useVigiaGrupo', () => {
    it('constantes del diseño: 15 s de espera y una mirada cada 5 s', () => {
        expect(VIGIA_ESPERA_MS).toBe(15_000);
        expect(VIGIA_CADA_MS).toBe(5_000);
    });

    it('sin remesa que vigilar no hace nada', async () => {
        await montar(null);
        await avanzar(60_000);
        expect(obtenerEstadoCarga).not.toHaveBeenCalled();
        expect(tardando).toBe(false);
    });

    it('TV-4 — antes de los 15 s no consulta nada (un POST que vuelve a los 3 s no deja rastro)', async () => {
        await montar(141);
        await avanzar(14_900);
        expect(obtenerEstadoCarga).not.toHaveBeenCalled();
        expect(tardando).toBe(false);
    });

    it('a los 15 s consulta la primera remesa, y después cada 5 s; `tardando` pasa a verdadero', async () => {
        await montar(141);
        await avanzar(15_000);
        expect(obtenerEstadoCarga).toHaveBeenCalledTimes(1);
        expect(obtenerEstadoCarga).toHaveBeenCalledWith(141);
        expect(tardando).toBe(true);
        await avanzar(5_000);
        expect(obtenerEstadoCarga).toHaveBeenCalledTimes(2);
        await avanzar(10_000);
        expect(obtenerEstadoCarga).toHaveBeenCalledTimes(4);
        expect(adoptados).toEqual([]);
    });

    it('la primera vez que la ve en curso y con grupo adopta el grupo y se apaga', async () => {
        obtenerEstadoCarga.mockResolvedValueOnce(enGrupo({ fase: 'BORRADOR', enCurso: false })).mockResolvedValue(enGrupo());
        await montar(141);
        await avanzar(15_000);
        expect(adoptados).toEqual([]);
        await avanzar(5_000);
        expect(adoptados).toEqual(['g1']);
        await avanzar(30_000);
        expect(obtenerEstadoCarga).toHaveBeenCalledTimes(2);
        expect(adoptados).toEqual(['g1']);
    });

    it('una terminada con grupo también se adopta', async () => {
        obtenerEstadoCarga.mockResolvedValue(enGrupo({ enCurso: false, terminal: true, fase: 'TERMINADA', resultado: 'OK' }));
        await montar(141);
        await avanzar(15_000);
        expect(adoptados).toEqual(['g1']);
    });

    it('TV-5 — una remesa en borrador, sin grupo, o un error de red no adoptan nada y siguen mirando', async () => {
        obtenerEstadoCarga
            .mockRejectedValueOnce(new Error('404'))
            .mockResolvedValueOnce(enGrupo({ fase: 'BORRADOR', enCurso: false }))
            .mockResolvedValueOnce(enGrupo({ grupoId: null }))
            .mockResolvedValue(enGrupo({ fase: 'BORRADOR', enCurso: false }));
        await montar(141);
        await avanzar(15_000 + 15_000);
        expect(obtenerEstadoCarga).toHaveBeenCalledTimes(4);
        expect(adoptados).toEqual([]);
        expect(tardando).toBe(true);
    });

    it('TV-6 — desmontar corta el vigía, antes y después de los 15 s', async () => {
        await montar(141);
        await avanzar(10_000);
        await act(async () => { root!.unmount(); });
        root = null;
        await avanzar(60_000);
        expect(obtenerEstadoCarga).not.toHaveBeenCalled();

        await montar(141);
        await avanzar(20_000);
        const antes = obtenerEstadoCarga.mock.calls.length;
        await act(async () => { root!.unmount(); });
        root = null;
        await avanzar(60_000);
        expect(obtenerEstadoCarga).toHaveBeenCalledTimes(antes);
    });

    it('una respuesta que llega después de desmontar no adopta nada', async () => {
        let resolver: (e: EstadoCargaDto) => void = () => {};
        obtenerEstadoCarga.mockReturnValue(new Promise<EstadoCargaDto>((ok) => { resolver = ok; }));
        await montar(141);
        await avanzar(15_000);
        await act(async () => { root!.unmount(); });
        root = null;
        await act(async () => { resolver(enGrupo()); await Promise.resolve(); });
        expect(adoptados).toEqual([]);
    });

    it('cuando el POST responde (la remesa a vigilar pasa a null) se apaga y `tardando` vuelve a falso', async () => {
        await montar(141);
        await avanzar(16_000);
        expect(tardando).toBe(true);
        await act(async () => { root!.render(<Sonda id={null} />); });
        expect(tardando).toBe(false);
        const antes = obtenerEstadoCarga.mock.calls.length;
        await avanzar(30_000);
        expect(obtenerEstadoCarga).toHaveBeenCalledTimes(antes);
    });
});
