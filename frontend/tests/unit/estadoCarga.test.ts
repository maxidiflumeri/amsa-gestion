// C2a: singulares, oraciones de «sin filas», código de error y motivo de corte repetido (FU-1 a FU-5).
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
import * as ec from '@fe/utils/estadoCarga';
import { terminal, terminalC1, dtoC1, canceladaC1 } from '../lib/fabricas';

const pr = (resultado: string, over: Record<string, unknown> = {}) => ec.presentarResultado(terminal(resultado, over));

describe('FU-1 — presentarResultado: cada oración con cantidad, con 1 y con 2', () => {
    it('CON_ERRORES con filas cargadas', () => {
        expect(pr('CON_ERRORES', { ok: 9, err: 1, procesadas: 10 }).detalle).toBe('1 de 10 filas no se cargó. Mirá el motivo de cada una en el detalle.');
        expect(pr('CON_ERRORES', { ok: 8, err: 2, procesadas: 10 }).detalle).toBe('2 de 10 filas no se cargaron. Mirá el motivo de cada una en el detalle.');
    });
    it('CON_ERRORES sin ninguna cargada', () => {
        expect(pr('CON_ERRORES', { ok: 0, err: 1, procesadas: 1 }).detalle).toBe('La única fila dio error.');
        expect(pr('CON_ERRORES', { ok: 0, err: 2, procesadas: 2 }).detalle).toBe('Las 2 filas dieron error.');
    });
    it('CON_ADVERTENCIAS', () => {
        const d = (ok: number, err: number) => pr('CON_ADVERTENCIAS', { ok, err, procesadas: ok + err, errorPostProceso: 'x' }).detalle ?? '';
        expect(d(1, 0)).toMatch(/^Se cargó 1 fila\. Pero/);
        expect(d(2, 0)).toMatch(/^Se cargaron 2 filas\. Pero/);
        expect(d(1, 1)).toMatch(/^Se cargó 1 fila y 1 dio error\. Pero/);
        expect(d(2, 2)).toMatch(/^Se cargaron 2 filas y 2 dieron error\. Pero/);
    });
    it('FALLIDA con filas cargadas antes del corte', () => {
        const d = (ok: number, err: number) => pr('FALLIDA', { ok, err, procesadas: ok + err, error: 'Se cortó.' }).detalle ?? '';
        expect(d(1, 0)).toContain('Antes del corte se cargó al menos 1 fila; el cierre de la carga no corrió.');
        expect(d(2, 0)).toContain('Antes del corte se cargaron al menos 2 filas; el cierre de la carga no corrió.');
        expect(d(1, 1)).toContain('Antes del corte se cargó al menos 1 fila y 1 dio error; el cierre de la carga no corrió.');
        expect(d(2, 3)).toContain('Antes del corte se cargaron al menos 2 filas y 3 dieron error; el cierre de la carga no corrió.');
    });
    it('SIN_FILAS', () => {
        expect(pr('SIN_FILAS', { descartadas: 1, procesadas: 0 }).detalle).toBe('El filtro de la plantilla descartó la única fila.');
        expect(pr('SIN_FILAS', { descartadas: 2, procesadas: 0 }).detalle).toBe('El filtro de la plantilla descartó las 2 filas.');
    });
    it('una cancelada no cambia: su motivo viene armado del backend', () => {
        expect(ec.presentarResultado(canceladaC1()).titulo).toBe('Importación cancelada');
    });
});

describe('FU-2 — oracionesSinFilas', () => {
    it('las cuatro combinaciones y sus singulares', () => {
        expect(ec.oracionesSinFilas(0, 0)).toEqual([]);
        expect(ec.oracionesSinFilas(1, 0)).toEqual(['El filtro de la plantilla descartó la única fila.']);
        expect(ec.oracionesSinFilas(5, 0)).toEqual(['El filtro de la plantilla descartó las 5 filas.']);
        expect(ec.oracionesSinFilas(0, 1)).toEqual(['1 fila es de otro corte de la división.']);
        expect(ec.oracionesSinFilas(0, 4)).toEqual(['4 filas son de otros cortes de la división.']);
        expect(ec.oracionesSinFilas(1, 1)).toEqual(['El filtro de la plantilla descartó la única fila.', '1 fila es de otro corte de la división.']);
        expect(ec.oracionesSinFilas(1500, 2)).toEqual(['El filtro de la plantilla descartó las 1.500 filas.', '2 filas son de otros cortes de la división.']);
    });
});

describe('FU-3 — con todos los contadores en 1, ningún texto dice «1 filas», «las 1 », «1 dieron» ni «1 son »', () => {
    const MALOS = /1 filas|las 1 |1 dieron|1 son /;
    it('todos los resultados', () => {
        const textos: string[] = [];
        for (const resultado of ['OK', 'CON_ERRORES', 'CON_ADVERTENCIAS', 'SIN_FILAS', 'FALLIDA']) {
            for (const ok of [0, 1]) {
                const r = ec.presentarResultado(terminal(resultado, { ok, err: 1, procesadas: ok + 1, descartadas: 1, descartadasPorFiltro: 1, fueraDeCorte: 1, error: 'Se cortó', errorPostProceso: 'No terminó' }));
                textos.push(`${r.titulo} ${r.detalle ?? ''}`);
            }
        }
        textos.push(...ec.oracionesSinFilas(1, 1));
        for (const t of textos) expect(t).not.toMatch(MALOS);
    });
});

describe('FU-4 — codigoDeError', () => {
    const errorHttp = (data: unknown) => new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, { status: 409, statusText: 'Conflict', data, headers: {}, config: { headers: new AxiosHeaders() } });
    it('con un código conocido', () => {
        expect(ec.codigoDeError(errorHttp({ statusCode: 409, message: 'm', code: 'CORTE_YA_CARGADO' }))).toBe('CORTE_YA_CARGADO');
        expect(ec.codigoDeError(errorHttp({ code: 'NINGUNA_RETOMABLE' }))).toBe('NINGUNA_RETOMABLE');
    });
    it('sin código, con un código que no se conoce o con un cuerpo que no es un objeto', () => {
        expect(ec.codigoDeError(errorHttp({ statusCode: 409, message: 'm' }))).toBeNull();
        expect(ec.codigoDeError(errorHttp({ code: 'OTRO' }))).toBeNull();
        expect(ec.codigoDeError(errorHttp({ code: 5 }))).toBeNull();
        expect(ec.codigoDeError(errorHttp('texto'))).toBeNull();
        expect(ec.codigoDeError(errorHttp(null))).toBeNull();
    });
    it('un error que no es de axios', () => {
        expect(ec.codigoDeError(new Error('x'))).toBeNull();
        expect(ec.codigoDeError(null)).toBeNull();
        expect(ec.codigoDeError(undefined)).toBeNull();
        expect(ec.codigoDeError({ response: { data: { code: 'CORTE_YA_CARGADO' } } })).toBeNull();
    });
});

describe('FU-5 — motivoNoRetomablePorCorte', () => {
    it('con una remesa, con dos, sin ninguna y sin el campo', () => {
        expect(ec.motivoNoRetomablePorCorte(dtoC1({ corteRepetidoEn: ['00160'] }))).toBe('El corte de esta remesa ya figura en la remesa 00160: no se puede retomar. Si esta ya no hace falta, eliminala.');
        expect(ec.motivoNoRetomablePorCorte(dtoC1({ corteRepetidoEn: ['00160', '00161'] }))).toBe('El corte de esta remesa ya figura en la remesa 00160, 00161: no se puede retomar. Si esta ya no hace falta, eliminala.');
        expect(ec.motivoNoRetomablePorCorte(dtoC1({ corteRepetidoEn: [] }))).toBeNull();
        expect(ec.motivoNoRetomablePorCorte(dtoC1({ corteRepetidoEn: null }))).toBeNull();
        expect(ec.motivoNoRetomablePorCorte({})).toBeNull();
    });
});

describe('textos de retomar', () => {
    it('una y varias', () => {
        expect(ec.TEXTO_RETOMAR_UNA.title).toBe('Retomar la remesa');
        expect(ec.TEXTO_RETOMAR_UNA.description).toBe('Se vuelve a encolar la misma remesa, con el mismo archivo. No se cargó ninguna fila la vez anterior.');
        expect(ec.TEXTO_RETOMAR_VARIAS.description).toBe('Se vuelven a encolar las mismas remesas, con el mismo archivo. No se cargó ninguna fila la vez anterior.');
        expect(terminalC1('OK').retomable).toBe(false);
    });
});
