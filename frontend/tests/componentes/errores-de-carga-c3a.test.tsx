// C3a: la columna "Fila" de los errores: tooltip según `filaEsDelArchivo` (docs/imports-progreso-c3-spec.md §6.3).
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import ErroresDeCarga from '@fe/components/import/ErroresDeCarga';
import type { ErrorDeCargaDto } from '@fe/types/importHistorial';
import { ServidorFalso } from '../lib/servidor-falso';
import { esperar, iniciarSesion, limpio, montar, type Montado } from '../lib/montar';
import { errorDeCarga, terminalC1 } from '../lib/fabricas';

const TIP_ARCHIVO = 'Fila del archivo (en Excel, el número de fila de la hoja). Con varios archivos, cuál es lo dice el mensaje.';
const TIP_POSICION = 'Posición entre las filas que procesó esta carga, contando desde 1. No cuenta el encabezado ni las filas descartadas por un filtro. Para ubicar el registro, mirá la columna con el contenido de la fila.';

let srv: ServidorFalso | null = null;
let v: Montado | null = null;
afterEach(async () => { if (v) await v.desmontar(); v = null; if (srv) await srv.bajar(); srv = null; });

async function armar(data: Array<Partial<ErrorDeCargaDto>>, quitar: Array<keyof ErrorDeCargaDto> = []) {
    srv = await new ServidorFalso().levantar();
    iniciarSesion(['importacion.ver_historial'], 3);
    const lista = data.map((d, i) => {
        const e: Partial<ErrorDeCargaDto> = errorDeCarga({ id: i + 1, ...d });
        for (const q of quitar) delete e[q];
        return e;
    });
    srv.en('GET', /^\/import\/errores\/(\d+)$/, () => ({ body: { data: lista, total: lista.length, page: 1, pageSize: 25, totalPages: 1, totales: { filas: lista.length, avisos: 0 } } }));
    v = await montar(<ErroresDeCarga remesaId={141} numeroRemesa="00141" carga={terminalC1('CON_ERRORES', { err: lista.length, ok: 10, procesadas: 10 + lista.length })} esMulticlaves={false} />);
    await esperar(() => document.querySelectorAll('tbody tr').length === lista.length, { que: 'las filas' });
}
const tooltip = () => document.querySelector('thead th [aria-label]')?.getAttribute('aria-label') ?? '';
const primeraCelda = (i = 0) => limpio(document.querySelectorAll('tbody tr')[i].querySelector('td')?.textContent ?? '');

describe('columna Fila', () => {
    it('`filaEsDelArchivo: true`: la fila del archivo y el tooltip que lo aclara', async () => {
        await armar([{ rowNumber: 0, fila: 10, filaEsDelArchivo: true }]);
        expect(primeraCelda()).toBe('10');
        expect(tooltip()).toBe(TIP_ARCHIVO);
    });
    it('`filaEsDelArchivo: false` (carga anterior): la posición, con el tooltip de hoy', async () => {
        await armar([{ rowNumber: 4, fila: 5, filaEsDelArchivo: false }]);
        expect(primeraCelda()).toBe('5');
        expect(tooltip()).toBe(TIP_POSICION);
    });
    it('`filaEsDelArchivo` ausente (backend anterior a C3a): como hoy', async () => {
        await armar([{ rowNumber: 4, fila: 5 }], ['filaEsDelArchivo']);
        expect(primeraCelda()).toBe('5');
        expect(tooltip()).toBe(TIP_POSICION);
    });
});
