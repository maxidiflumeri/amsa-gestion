// C3a: "los últimos cinco" lleva `reciente=true` y la tarjeta muestra los avisos que estén entre los cinco más nuevos.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUltimosErrores } from '@fe/hooks/useUltimosErrores';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import { lineaDeUltimoError } from '@fe/utils/estadoCarga';
import { dtoC1, errorDeCarga } from '../lib/fabricas';
import { ServidorFalso } from '../lib/servidor-falso';
import { esperar, iniciarSesion, montar, type Montado } from '../lib/montar';

function Sonda({ carga }: { carga: EstadoCargaDto }) {
    const u = useUltimosErrores(carga);
    return <div data-testid="u">{u === null ? 'NULL' : u.items.map((e) => { const l = lineaDeUltimoError(e); return `${l.rotulo}: ${l.texto}`; }).join('|')}</div>;
}
const mostrado = () => document.querySelector('[data-testid="u"]')?.textContent ?? '';

let srv: ServidorFalso;
let v: Montado | null = null;
beforeEach(async () => { srv = await new ServidorFalso().levantar(); iniciarSesion(); });
afterEach(async () => { if (v) await v.desmontar(); v = null; await srv.bajar(); });

describe('useUltimosErrores con `reciente`', () => {
    it('el pedido lleva reciente=true, y los avisos que el servidor mezcla entre los cinco se ven como avisos', async () => {
        const reciente = [
            errorDeCarga({ id: 9, tipo: 'AVISO', fila: null, filaEsDelArchivo: false, errorMsg: '[AVISO] El encabezado repite una columna' }),
            errorDeCarga({ id: 8, fila: 120, filaEsDelArchivo: true, errorMsg: 'DNI inválido' }),
            errorDeCarga({ id: 7, fila: 99, filaEsDelArchivo: true, errorMsg: 'Importe inválido' }),
        ];
        srv.en('GET', /^\/import\/errores\/141$/, () => ({ body: { data: reciente, total: 3, page: 1, pageSize: 5, totalPages: 1, totales: { filas: 6, avisos: 1 } } }));
        v = await montar(<Sonda carga={dtoC1({ err: 6, advertencias: 1 })} />);
        await esperar(() => /Aviso/.test(mostrado()), { que: 'la lectura' });
        expect(mostrado()).toBe('Aviso: [AVISO] El encabezado repite una columna|Fila 120: DNI inválido|Fila 99: Importe inválido');
        const pedidos = srv.de('GET', /^\/import\/errores\/141\?/);
        expect(pedidos).toHaveLength(1);
        expect(new URLSearchParams(pedidos[0].ruta.split('?')[1]).get('reciente')).toBe('true');
        expect(new URLSearchParams(pedidos[0].ruta.split('?')[1]).get('orden')).toBe('desc');
    });

    it('contra un backend anterior (ignora `reciente`): se ve lo de hoy, sin romper', async () => {
        srv.en('GET', /^\/import\/errores\/141$/, () => ({ body: { data: [errorDeCarga({ id: 3, errorMsg: 'Fila vieja' })], total: 1, page: 1, pageSize: 5, totalPages: 1, totales: { filas: 1, avisos: 0 } } }));
        v = await montar(<Sonda carga={dtoC1({ err: 1 })} />);
        await esperar(() => /Fila vieja/.test(mostrado()), { que: 'la lectura' });
        expect(mostrado()).toBe('Fila 1: Fila vieja');
    });
});
