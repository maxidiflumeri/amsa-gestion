// C2b: funciones puras de la tarjeta de progreso (TU-1 a TU-7, docs/imports-progreso-c2-spec.md §16.4 y §16.5).
import { describe, expect, it } from 'vitest';
import * as U from '@fe/utils/estadoCarga';
import * as H from '@fe/utils/historialImportaciones';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import { BASURA, canceladaC1, dtoC1, enColaC1, errorDeCarga, iso, itemHistorial, T0, terminalC1, type Sobre } from '../lib/fabricas';

const borrador = { fase: 'BORRADOR', enCurso: false, terminal: false, estadoProceso: 'VALIDANDO', resultado: null, progreso: 0, procesadas: 0, ok: 0, err: 0, startedAt: null, heartbeatAt: null, encoladaAt: null };

describe('TU-1 — etiquetaDeEstado: las 18 filas de §6.3 (las mismas de FU-6) y su color', () => {
    const casos: Array<[string, EstadoCargaDto, unknown, string, string, U.ColorChipEstado, string | null]> = [
        ['pendiente de encolar', dtoC1(borrador), { remesas: [] }, 'No se pudo encolar', 'warning', 'warning', 'Se confirmó y la cola de trabajos no respondió. No se cargó nada.'],
        ['borrador', dtoC1(borrador), null, 'Borrador', 'pending', 'default', 'Vista previa sin confirmar.'],
        ['cancelando', dtoC1({ cancelacionPedidaAt: iso(Date.now()) }), null, 'Cancelando…', 'warning', 'warning', null],
        ['en cola', enColaC1({ enColaDelante: 2 }), null, 'En cola', 'pending', 'default', 'Hay 2 importaciones antes que esta.'],
        ['procesando', dtoC1({ progreso: 20, procesadas: 3000, totalEsperado: 14466, etaSegundos: 240 }), null, 'Procesando 20 %', 'running', 'info', '3.000 de 14.466 · faltan ~4 min'],
        ['procesando sin espera', dtoC1({ progreso: 20, procesadas: 3000, totalEsperado: 14466 }), null, 'Procesando 20 %', 'running', 'info', '3.000 de 14.466'],
        ['post-proceso', dtoC1({ fase: 'POST_PROCESO', subfase: 'Consolidando casos: 1.500 de 8.875' }), null, 'Post-proceso', 'running', 'info', 'Consolidando casos: 1.500 de 8.875'],
        ['procesando sin total', dtoC1({ totalEsperado: 0 }), null, 'Procesando', 'running', 'info', null],
        ['cancelada', canceladaC1(), null, 'Cancelada', 'warning', 'warning', null],
        ['cancelada antes de empezar', canceladaC1({ startedAt: null, procesadas: 0, ok: 0, err: 0 }), null, 'Cancelada antes de empezar', 'warning', 'warning', null],
        ['no llegó a empezar', terminalC1('FALLIDA', { startedAt: null, error: 'x' }), null, 'No llegó a empezar', 'failed', 'error', null],
        ['fallida', terminalC1('FALLIDA', { error: 'x' }), null, 'Fallida', 'failed', 'error', null],
        ['con advertencias', terminalC1('CON_ADVERTENCIAS', { errorPostProceso: 'x' }), null, 'Con advertencias', 'warning', 'warning', null],
        ['con errores', terminalC1('CON_ERRORES', { ok: 5, err: 2, procesadas: 7 }), null, 'Finalizada con errores', 'warning', 'warning', null],
        ['sin filas cargadas', terminalC1('CON_ERRORES', { ok: 0, err: 2, procesadas: 2 }), null, 'Sin filas cargadas', 'failed', 'error', null],
        ['sin filas', terminalC1('SIN_FILAS', { descartadas: 4, procesadas: 0 }), null, 'Sin filas', 'warning', 'warning', null],
        ['finalizada', terminalC1('OK'), null, 'Finalizada', 'completed', 'success', null],
        ['cualquier otra cosa', terminalC1('OK', { resultado: null }), null, 'Finalizada', 'neutral', 'default', null],
    ];
    for (const [nombre, carga, pendiente, etiqueta, status, color, secundaria] of casos) {
        it(nombre, () => {
            const r = U.etiquetaDeEstado(carga, { pendienteDeEncolar: pendiente });
            expect(r.etiqueta).toBe(etiqueta);
            expect(r.status).toBe(status);
            expect(r.color).toBe(color);
            expect(r.secundaria).toBe(secundaria);
            expect(`${r.etiqueta} ${r.secundaria ?? ''}`).not.toMatch(BASURA);
        });
    }
    it('el mapa de colores cubre todos los status del chip', () => {
        const status = ['pending', 'running', 'completed', 'failed', 'warning', 'info', 'success', 'error', 'neutral'] as const;
        const esperado = { pending: 'default', running: 'info', completed: 'success', failed: 'error', warning: 'warning', info: 'info', success: 'success', error: 'error', neutral: 'default' };
        for (const s of status) {
            // Se alcanza el mapa por las filas que producen cada status; los que ninguna fila produce (info, success, error) no tienen fila.
            const fila = casos.find((c) => c[4] === s);
            if (fila) expect(fila[5]).toBe(esperado[s]);
        }
    });
});

describe('TU-2 — estadoParaHistorial es la etiqueta única', () => {
    it('da lo mismo que etiquetaDeEstado para cada fila del Historial, con y sin pendiente de encolar', () => {
        const cargas: Sobre[] = [borrador, {}, { cancelacionPedidaAt: iso(Date.now()) }, { fase: 'POST_PROCESO' }, { terminal: true, enCurso: false, resultado: 'FALLIDA', fase: 'TERMINADA' }];
        for (const c of cargas) {
            for (const pendiente of [null, { remesas: [], origen: [], yaCargadoEn: [] }]) {
                const item = itemHistorial({ pendienteDeEncolar: pendiente }, c);
                expect(H.estadoParaHistorial(item)).toEqual(U.etiquetaDeEstado(item.carga, { pendienteDeEncolar: pendiente }));
            }
        }
    });
});

describe('TU-3 — pasosDeCarga (§16.4.1)', () => {
    const claves = (p: U.PasoDeCarga[] | null) => p?.map((x) => `${x.clave}:${x.estado}`);
    it('sin estado todavía: En cola es el actual, con «Enviando a la cola…»', () => {
        const p = U.pasosDeCarga(null)!;
        expect(claves(p)).toEqual(['EN_COLA:actual', 'PROCESANDO:pendiente', 'POST_PROCESO:pendiente', 'LISTO:pendiente']);
        expect(p[0].detalle).toBe('Enviando a la cola…');
        expect(p.map((x) => x.etiqueta)).toEqual(['En cola', 'Procesando', 'Post-proceso', 'Listo']);
    });
    it('un borrador es como no tener estado', () => {
        const p = U.pasosDeCarga(dtoC1(borrador))!;
        expect(p[0]).toMatchObject({ estado: 'actual', detalle: 'Enviando a la cola…' });
    });
    it('en cola: la posición va de detalle', () => {
        const p = U.pasosDeCarga(enColaC1({ enColaDelante: 1 }))!;
        expect(p[0]).toMatchObject({ estado: 'actual', detalle: 'Hay 1 importación antes que esta.' });
    });
    it('leyendo: Procesando con «Leyendo el archivo»', () => {
        const p = U.pasosDeCarga(dtoC1({ fase: 'LEYENDO' }))!;
        expect(claves(p)).toEqual(['EN_COLA:hecho', 'PROCESANDO:actual', 'POST_PROCESO:pendiente', 'LISTO:pendiente']);
        expect(p[1].detalle).toBe('Leyendo el archivo');
    });
    it('procesando: el porcentaje; sin total no hay «%»', () => {
        expect(U.pasosDeCarga(dtoC1({ progreso: 43 }))![1].detalle).toBe('43 %');
        expect(U.pasosDeCarga(dtoC1({ totalEsperado: 0, progreso: 0 }))![1].detalle).toBeNull();
    });
    it('post-proceso: el actual es el tercero y no lleva detalle', () => {
        const p = U.pasosDeCarga(dtoC1({ fase: 'POST_PROCESO', subfase: 'Consolidando' }))!;
        expect(claves(p)).toEqual(['EN_COLA:hecho', 'PROCESANDO:hecho', 'POST_PROCESO:actual', 'LISTO:pendiente']);
        expect(p[2].detalle).toBeNull();
    });
    it('terminal: todos hechos salvo Listo, con la etiqueta del estado; sin error si terminó bien', () => {
        const p = U.pasosDeCarga(terminalC1('CON_ERRORES', { ok: 5, err: 2 }))!;
        expect(claves(p)).toEqual(['EN_COLA:hecho', 'PROCESANDO:hecho', 'POST_PROCESO:hecho', 'LISTO:actual']);
        expect(p[3]).toMatchObject({ etiqueta: 'Finalizada con errores', error: false });
    });
    it('cancelada y fallida: Listo con error y la etiqueta que corresponde', () => {
        expect(U.pasosDeCarga(canceladaC1())![3]).toMatchObject({ etiqueta: 'Cancelada', error: true });
        expect(U.pasosDeCarga(terminalC1('FALLIDA', { error: 'x' }))![3]).toMatchObject({ etiqueta: 'Fallida', error: true });
    });
    it('una fase que el cliente no conoce: sin pasos', () => {
        expect(U.pasosDeCarga(dtoC1({ fase: 'FASE_NUEVA' }))).toBeNull();
    });
    it('una cancelación pedida no cambia los pasos', () => {
        expect(claves(U.pasosDeCarga(dtoC1({ cancelacionPedidaAt: iso(T0) })))).toEqual(claves(U.pasosDeCarga(dtoC1())));
    });
});

describe('TU-4 — resumenDeGrupo', () => {
    it('cuenta las terminadas sobre el total de la división, aunque alguna se haya eliminado', () => {
        const remesas = [terminalC1('OK', { remesaId: 1 }), dtoC1({ remesaId: 2 })];
        expect(U.resumenDeGrupo(remesas, 3)).toEqual({ terminadas: 1, total: 3, porcentaje: 33 });
    });
    it('total 0: 0 %, sin dividir por cero', () => {
        expect(U.resumenDeGrupo([], 0)).toEqual({ terminadas: 0, total: 0, porcentaje: 0 });
    });
    it('todas terminadas: 100 %', () => {
        expect(U.resumenDeGrupo([terminalC1('OK', { remesaId: 1 }), canceladaC1({ remesaId: 2 })], 2).porcentaje).toBe(100);
    });
});

describe('TU-5 — barraDeRemesa: las cuatro ramas', () => {
    it('terminal: determinada 100', () => expect(U.barraDeRemesa(terminalC1('FALLIDA', { error: 'x' }))).toEqual({ variante: 'determinate', valor: 100 }));
    it('en cola y borrador: determinada 0', () => {
        expect(U.barraDeRemesa(enColaC1())).toEqual({ variante: 'determinate', valor: 0 });
        expect(U.barraDeRemesa(dtoC1(borrador))).toEqual({ variante: 'determinate', valor: 0 });
    });
    it('procesando con total: el porcentaje', () => expect(U.barraDeRemesa(dtoC1({ progreso: 43 }))).toEqual({ variante: 'determinate', valor: 43 }));
    it('en curso sin porcentaje honesto: indeterminada', () => {
        expect(U.barraDeRemesa(dtoC1({ fase: 'POST_PROCESO' })).variante).toBe('indeterminate');
        expect(U.barraDeRemesa(dtoC1({ totalEsperado: 0 })).variante).toBe('indeterminate');
    });
});

describe('TU-6 — lineaDeUltimoError', () => {
    it('una fila con punto de miles', () => {
        expect(U.lineaDeUltimoError(errorDeCarga({ tipo: 'FILA', fila: 1234, errorMsg: 'DNI inválido' }))).toEqual({ rotulo: 'Fila 1.234', texto: 'DNI inválido' });
    });
    it('un aviso', () => {
        expect(U.lineaDeUltimoError(errorDeCarga({ tipo: 'AVISO', fila: null, errorMsg: '[aviso] Columna sin mapear' }))).toEqual({ rotulo: 'Aviso', texto: '[aviso] Columna sin mapear' });
    });
    it('una fila sin número: «Fila»', () => {
        expect(U.lineaDeUltimoError(errorDeCarga({ tipo: 'FILA', fila: null })).rotulo).toBe('Fila');
    });
    it('un mensaje con saltos: la primera línea no vacía', () => {
        expect(U.lineaDeUltimoError(errorDeCarga({ errorMsg: '\n  \nPrimera línea\nSegunda' })).texto).toBe('Primera línea');
    });
    it('un mensaje de 500 caracteres se recorta a 160 con «…»', () => {
        const r = U.lineaDeUltimoError(errorDeCarga({ errorMsg: 'x'.repeat(500) }));
        expect(r.texto.length).toBe(160);
        expect(r.texto.endsWith('…')).toBe(true);
    });
    it('un mensaje vacío no inventa texto', () => {
        expect(U.lineaDeUltimoError(errorDeCarga({ errorMsg: '' })).texto).toBe('');
    });
});

describe('TU-7 — ninguna devuelve «NaN», «undefined» ni «null» en un texto', () => {
    it('con un DTO de la Fase A y de la Fase B', () => {
        const dtos = [dtoC1(), enColaC1(), dtoC1({ fase: 'LEYENDO' }), terminalC1('OK'), canceladaC1()];
        for (const d of dtos) {
            const textos = [U.etiquetaDeEstado(d).etiqueta, U.etiquetaDeEstado(d).secundaria ?? '', ...(U.pasosDeCarga(d) ?? []).flatMap((p) => [p.etiqueta, p.detalle ?? ''])];
            for (const t of textos) expect(t).not.toMatch(BASURA);
        }
        expect(U.pasosDeCarga(null)!.map((p) => `${p.etiqueta}${p.detalle ?? ''}`).join(' ')).not.toMatch(BASURA);
        expect(`${U.lineaDeUltimoError(errorDeCarga()).rotulo} ${U.lineaDeUltimoError(errorDeCarga()).texto}`).not.toMatch(BASURA);
    });
});
