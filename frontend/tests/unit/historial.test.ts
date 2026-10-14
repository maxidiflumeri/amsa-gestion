// C2a: funciones puras del Historial (FU-6 a FU-10).
import { describe, expect, it } from 'vitest';
import * as h from '@fe/utils/historialImportaciones';
import type { HistorialItemDto, PendienteDeEncolarDto } from '@fe/types/importHistorial';
import { BASURA, canceladaC1, dtoC1, enColaC1, grupoHistorial, iso, itemHistorial, sin, terminalC1, type Sobre } from '../lib/fabricas';

const item = (carga: Sobre, over: Partial<HistorialItemDto> = {}) => itemHistorial(over, carga);
const PENDIENTE: PendienteDeEncolarDto = { remesas: [{ remesaId: 141, numeroRemesa: '00141', corte: null }], origen: [], yaCargadoEn: [] };
const borrador = { fase: 'BORRADOR', enCurso: false, terminal: false, estadoProceso: 'VALIDANDO', resultado: null, progreso: 0, procesadas: 0, ok: 0, err: 0, startedAt: null, heartbeatAt: null, encoladaAt: null };

describe('FU-6 — estadoParaHistorial: las 14 filas de §6.3, una por una', () => {
    const e = (it_: HistorialItemDto) => h.estadoParaHistorial(it_);
    const casos: Array<[string, HistorialItemDto, string, string, string | null]> = [
        ['1 pendiente de encolar', item(borrador, { pendienteDeEncolar: PENDIENTE }), 'No se pudo encolar', 'warning', 'Se confirmó y la cola de trabajos no respondió. No se cargó nada.'],
        ['2 borrador', item(borrador), 'Borrador', 'pending', 'Vista previa sin confirmar.'],
        ['3 cancelando', item({ cancelacionPedidaAt: iso(Date.now()) }), 'Cancelando…', 'warning', null],
        ['4 en cola', item(enColaC1({ enColaDelante: 2 })), 'En cola', 'pending', 'Hay 2 importaciones antes que esta.'],
        ['5 procesando', item({ progreso: 20, procesadas: 3000, totalEsperado: 14466, etaSegundos: 240 }), 'Procesando 20 %', 'running', '3.000 de 14.466 · faltan ~4 min'],
        ['5 procesando sin espera', item({ progreso: 20, procesadas: 3000, totalEsperado: 14466 }), 'Procesando 20 %', 'running', '3.000 de 14.466'],
        ['6 otra fase en curso', item({ fase: 'POST_PROCESO', subfase: 'Consolidando casos: 1.500 de 8.875' }), 'Post-proceso', 'running', 'Consolidando casos: 1.500 de 8.875'],
        ['6 procesando sin total', item({ totalEsperado: 0 }), 'Procesando', 'running', null],
        ['7 cancelada', item(canceladaC1()), 'Cancelada', 'warning', null],
        ['7 cancelada antes de empezar', item(canceladaC1({ startedAt: null, procesadas: 0, ok: 0, err: 0 })), 'Cancelada antes de empezar', 'warning', null],
        ['8 no llegó a empezar', item(terminalC1('FALLIDA', { startedAt: null, error: 'x' })), 'No llegó a empezar', 'failed', null],
        ['9 fallida', item(terminalC1('FALLIDA', { error: 'x' })), 'Fallida', 'failed', null],
        ['10 con advertencias', item(terminalC1('CON_ADVERTENCIAS', { errorPostProceso: 'x' })), 'Con advertencias', 'warning', null],
        ['11 con errores', item(terminalC1('CON_ERRORES', { ok: 5, err: 2, procesadas: 7 })), 'Finalizada con errores', 'warning', null],
        ['11 sin filas cargadas', item(terminalC1('CON_ERRORES', { ok: 0, err: 2, procesadas: 2 })), 'Sin filas cargadas', 'failed', null],
        ['12 sin filas', item(terminalC1('SIN_FILAS', { descartadas: 4, procesadas: 0 })), 'Sin filas', 'warning', null],
        ['13 finalizada', item(terminalC1('OK')), 'Finalizada', 'completed', null],
        ['14 cualquier otra cosa', item(terminalC1('OK', { resultado: null })), 'Finalizada', 'neutral', null],
    ];
    for (const [nombre, it_, etiqueta, status, secundaria] of casos) {
        it(nombre, () => {
            const r = e(it_);
            expect(r.etiqueta).toBe(etiqueta);
            expect(r.status).toBe(status);
            expect(r.secundaria).toBe(secundaria);
        });
    }

    it('en las terminales con algo que decir (7 a 12) el tooltip lleva el título y la primera línea del motivo', () => {
        const r = e(item(terminalC1('FALLIDA', { error: 'La plantilla no tiene estado inicial.\n\nOtro párrafo.' })));
        expect(r.tooltip).toBe('La importación falló. La plantilla no tiene estado inicial.');
        expect(e(item(terminalC1('OK'))).tooltip).toBeNull();
        expect(e(item(canceladaC1())).tooltip).toMatch(/^Importación cancelada\./);
    });

    it('una cancelada nunca es «Fallida» ni lo que dice el estado crudo; nunca «PENDIENTE» ni «VALIDANDO»', () => {
        const todos = [
            ...casos.map((c) => c[1]),
            item({ estadoProceso: 'PENDIENTE', fase: 'EN_COLA' }),
            item({ ...borrador, estadoProceso: 'PENDIENTE' }),
            item(canceladaC1({ estadoProceso: 'FALLIDA' })),
        ];
        for (const x of todos) {
            const r = e(x);
            expect(`${r.etiqueta} ${r.secundaria ?? ''}`).not.toMatch(/PENDIENTE|VALIDANDO|FALLIDA|undefined|null|NaN/);
        }
        expect(e(item(canceladaC1({ estadoProceso: 'FALLIDA' }))).etiqueta).not.toBe('Fallida');
    });

    it('un DTO de un backend viejo (sin cancelada, sin grupoId, sin corteRepetidoEn) no tira', () => {
        const viejo = sin(dtoC1({ ...borrador }), 'cancelada', 'grupoId', 'grupoOrden', 'grupoTotal', 'corteRepetidoEn', 'cancelacionPedidaAt', 'cancelable', 'retomable');
        const todos = [viejo, sin(terminalC1('FALLIDA', { error: 'x' }), 'cancelada', 'grupoId', 'corteRepetidoEn'), sin(enColaC1(), 'cancelacionPedidaAt', 'cancelada')];
        for (const c of todos) {
            const r = e({ ...item({}), carga: c });
            expect(`${r.etiqueta} ${r.secundaria ?? ''} ${r.tooltip ?? ''}`).not.toMatch(BASURA);
        }
    });
});

describe('FU-7 — ordenarParaMostrar e inicioDeBloque', () => {
    const g = (id: number, gid: string | null, orden: number | null) => item({ remesaId: id, numeroRemesa: String(id), grupoId: gid, grupoOrden: orden, grupoTotal: gid ? 3 : null });
    const ids = (xs: HistorialItemDto[]) => xs.map((x) => x.id);
    it('un grupo entero, en orden de grupoOrden aunque venga al revés (la lista llega por id descendente)', () => {
        const orden = h.ordenarParaMostrar([g(143, 'a', 3), g(142, 'a', 2), g(141, 'a', 1)]);
        expect(ids(orden)).toEqual([141, 142, 143]);
        expect(orden.map((_, i) => h.inicioDeBloque(orden, i))).toEqual([true, false, false]);
    });
    it('dos grupos pegados', () => {
        const orden = h.ordenarParaMostrar([g(146, 'b', 3), g(145, 'b', 2), g(144, 'b', 1), g(143, 'a', 3), g(142, 'a', 2), g(141, 'a', 1)]);
        expect(ids(orden)).toEqual([144, 145, 146, 141, 142, 143]);
        expect(orden.map((_, i) => h.inicioDeBloque(orden, i))).toEqual([true, false, false, true, false, false]);
    });
    it('un grupo con una remesa suelta en el medio: dos tramos, cada uno con su encabezado', () => {
        const orden = h.ordenarParaMostrar([g(143, 'a', 3), g(142, null, null), g(141, 'a', 1)]);
        expect(ids(orden)).toEqual([143, 142, 141]);
        expect(orden.map((_, i) => h.inicioDeBloque(orden, i))).toEqual([true, false, true]);
    });
    it('un grupo cortado por el fin de la página', () => {
        const orden = h.ordenarParaMostrar([g(150, null, null), g(143, 'a', 3), g(142, 'a', 2)]);
        expect(ids(orden)).toEqual([150, 142, 143]);
        expect(orden.map((_, i) => h.inicioDeBloque(orden, i))).toEqual([false, true, false]);
        expect(h.tramoDeBloque(orden, 1).length).toBe(2);
    });
    it('las remesas sin grupo no abren bloque y una lista vacía no tira', () => {
        const orden = h.ordenarParaMostrar([g(2, null, null), g(1, null, null)]);
        expect(orden.map((_, i) => h.inicioDeBloque(orden, i))).toEqual([false, false]);
        expect(h.ordenarParaMostrar([])).toEqual([]);
    });
});

describe('FU-8 — accionesDeFila: permisos × dueño × estado', () => {
    const TODOS = ['importacion.ejecutar', 'importacion.eliminar', 'importacion.ver_progreso_otros', 'consolidacion.ejecutar', 'deudores.acciones_masivas'];
    const con = (...p: string[]) => (k: string) => p.includes(k);
    const a = (it_: HistorialItemDto, usuarioId: number | null, ...permisos: string[]) => h.accionesDeFila(it_, usuarioId, con(...permisos));
    const propia = { usuarioId: 3 };

    it('en curso y cancelable: Cancelar para el dueño con ejecutar; no sin ejecutar; no para otro sin ver_progreso_otros', () => {
        const x = item({ ...propia, cancelable: true });
        expect(a(x, 3, 'importacion.ejecutar').cancelar).toBe(true);
        expect(a(x, 3).cancelar).toBe(false);
        expect(a(x, 9, 'importacion.ejecutar').cancelar).toBe(false);
        expect(a(x, 9, 'importacion.ejecutar', 'importacion.ver_progreso_otros').cancelar).toBe(true);
    });
    it('un backend que no informa `cancelable` no ofrece Cancelar', () => {
        expect(a({ ...item({ ...propia }), carga: sin(dtoC1(propia), 'cancelable') }, 3, ...TODOS).cancelar).toBe(false);
    });
    it('Cancelar no se puede ahora: se ofrece y el motivo queda escrito', () => {
        const r = a(item({ ...propia, cancelable: false, fase: 'POST_PROCESO' }), 3, 'importacion.ejecutar');
        expect(r.cancelar).toBe(true);
        expect(r.motivos).toContain('La importación ya procesó todas las filas y está cerrando: en este paso no se puede cancelar.');
    });
    it('Retomar solo con `retomable` del backend y permiso; no por los contadores', () => {
        const x = item(terminalC1('FALLIDA', { ...propia, retomable: true, error: 'x' }));
        expect(a(x, 3, 'importacion.ejecutar').retomar).toBe(true);
        expect(a(x, 3).retomar).toBe(false);
        expect(a(item(terminalC1('FALLIDA', { ...propia, retomable: false, procesadas: 0, ok: 0, err: 0 })), 3, ...TODOS).retomar).toBe(false);
    });
    it('Confirmar solo en un borrador con pendienteDeEncolar y con permiso', () => {
        const x = item({ ...borrador, ...propia }, { pendienteDeEncolar: PENDIENTE });
        expect(a(x, 3, 'importacion.ejecutar').confirmar).toBe(true);
        expect(a(x, 3).confirmar).toBe(false);
        expect(a(x, 9, 'importacion.ejecutar').confirmar).toBe(false);
        expect(a(item({ ...borrador, ...propia }), 3, ...TODOS).confirmar).toBe(false);
    });
    it('Eliminar: oculto sin permiso; deshabilitado con motivo si ya arrancó o si es ajena', () => {
        expect(a(item(terminalC1('OK', propia)), 3).eliminar.visible).toBe(false);
        const ok = a(item(terminalC1('OK', propia)), 3, 'importacion.eliminar');
        expect(ok.eliminar).toEqual({ visible: true, deshabilitado: false, motivo: null });
        const procesando = a(item({ ...propia }), 3, 'importacion.eliminar');
        expect(procesando.eliminar).toEqual({ visible: true, deshabilitado: true, motivo: 'No se puede eliminar una importación en curso. Para frenarla, usá Cancelar.' });
        const ajena = a(item(terminalC1('OK', { usuarioId: 8 })), 3, 'importacion.eliminar');
        expect(ajena.eliminar.motivo).toBe('Solo podés eliminar tus importaciones.');
        expect(a(item(terminalC1('OK', { usuarioId: 8 })), 3, 'importacion.eliminar', 'importacion.ver_progreso_otros').eliminar.deshabilitado).toBe(false);
        expect(ajena.motivos).toContain('Solo podés eliminar tus importaciones.');
    });
    it('una remesa en cola SÍ se puede eliminar (con el diálogo que dice qué es)', () => {
        expect(a(item(enColaC1(propia)), 3, 'importacion.eliminar').eliminar.deshabilitado).toBe(false);
        expect(a(item({ ...borrador, ...propia }), 3, 'importacion.eliminar').eliminar.deshabilitado).toBe(false);
    });
    it('Revertir solo en una ACCIONES finalizada con el permiso; deshabilitado si ya se revirtió', () => {
        const acc = (over: Partial<HistorialItemDto> = {}) => item(terminalC1('OK', { ...propia, tipo: 'ACCIONES' }), { categoria: 'ACCIONES', ...over });
        expect(a(acc(), 3, 'deudores.acciones_masivas').revertir).toEqual({ visible: true, deshabilitado: false, motivo: null });
        expect(a(acc(), 3).revertir.visible).toBe(false);
        expect(a(item(terminalC1('OK', propia), { categoria: 'DEUDORES' }), 3, 'deudores.acciones_masivas').revertir.visible).toBe(false);
        expect(a(acc({ accionRevertidaEn: iso(0) }), 3, 'deudores.acciones_masivas').revertir).toEqual({ visible: true, deshabilitado: true, motivo: 'Acción ya revertida' });
    });
    it('Consolidar con su permiso', () => {
        expect(a(item(terminalC1('OK', propia)), 3, 'consolidacion.ejecutar').consolidar).toBe(true);
        expect(a(item(terminalC1('OK', propia)), 3).consolidar).toBe(false);
    });
});

describe('FU-9 — textoEliminar: las siete filas de §6.4', () => {
    const t = (it_: HistorialItemDto) => h.textoEliminar(it_);
    it('borrador', () => {
        const r = t(item(borrador));
        expect(r.titulo).toBe('Eliminar vista previa');
        expect(r.parrafos).toEqual(['Es una vista previa sin confirmar: no cargó nada. Al eliminarla se libera su número de remesa. No se puede deshacer.']);
    });
    it('no se pudo encolar', () => {
        const r = t(item(borrador, { pendienteDeEncolar: PENDIENTE }));
        expect(r.titulo).toBe('Eliminar vista previa');
        expect(r.parrafos[1]).toBe('Ya se había confirmado y la cola de trabajos no respondió. Si lo que querés es cargarla, usá «Confirmar» en vez de eliminarla.');
    });
    it('en cola, sin y con división', () => {
        const sola = t(item(enColaC1()));
        expect(sola.titulo).toBe('Eliminar una importación en cola');
        expect(sola.confirmar).toBe('Eliminar igual');
        expect(sola.parrafos).toEqual([
            'Esta importación **está confirmada y espera su turno**: todavía no empezó. Si la eliminás, sale de la cola y no se carga. No se puede deshacer.',
            'Si solo querés frenarla, usá «Cancelar»: no se carga ninguna fila y después la podés retomar.',
        ]);
        const dividida = t(item(enColaC1({ grupoId: 'g', grupoOrden: 2, grupoTotal: 3 })));
        expect(dividida.parrafos[1]).toBe('Es la remesa 2 de 3 de una carga dividida: las demás siguen.');
        expect(dividida.parrafos).toHaveLength(3);
    });
    it('terminal: categorías que crean casos, el texto de hoy', () => {
        for (const categoria of ['DEUDORES', 'DEUDORES_Y_FACTURAS', 'MULTIRREGISTRO', 'MULTIARCHIVO']) {
            const r = t(item(terminalC1('OK'), { categoria }));
            expect(r.titulo).toBe('Confirmar eliminación');
            expect(r.parrafos).toEqual([h.TEXTO_ELIMINAR_BASE]);
        }
    });
    it('terminal: facturas, pagos, contactos, enriquecimiento y actualizaciones no deshacen lo que aplicaron', () => {
        for (const categoria of ['FACTURAS', 'PAGOS', 'CONTACTOS', 'ENRIQUECIMIENTO', 'ACTUALIZACIONES']) {
            const r = t(item(terminalC1('OK'), { categoria }));
            expect(r.parrafos[0]).toBe('Eliminar esta importación borra su registro y su lista de errores. **No deshace lo que aplicó**: lo que cargó sobre los casos de otras remesas queda como está. No se puede deshacer.');
        }
    });
    it('terminal: acciones masivas y claves de pago', () => {
        expect(t(item(terminalC1('OK'), { categoria: 'ACCIONES' })).parrafos[0]).toBe('**Eliminarla no revierte la acción** y deja sin efecto el botón Revertir para siempre. Si la acción salió mal, revertila primero.');
        expect(t(item(terminalC1('OK'), { categoria: 'MULTICLAVES' })).parrafos[0]).toBe('Elimina las claves de pago que cargó esta importación. Si alguna ya tiene un convenio o un cupón emitido, no se puede eliminar.');
    });
    it('una categoría desconocida o nula cae en el texto de hoy', () => {
        expect(t(item(terminalC1('OK'), { categoria: null })).parrafos).toEqual([h.TEXTO_ELIMINAR_BASE]);
    });
});

describe('FU-10 — texto del encabezado de división', () => {
    it('singular y plural, «(2 de las 5 están en esta página)», «(1 se eliminó)»', () => {
        const g = grupoHistorial({ total: 5, existentes: 5, finalizadas: 3, enCurso: 1, noCargadas: 1 });
        expect(h.textoEncabezadoDivision(g, 5)).toEqual({ titulo: 'Carga dividida · 5 remesas', resumen: '3 finalizadas · 1 en curso · 1 fallida o cancelada', nota: null, eliminadas: null });
        expect(h.textoEncabezadoDivision(g, 2).nota).toBe('(2 de las 5 están en esta página)');
        expect(h.textoEncabezadoDivision(grupoHistorial({ total: 5, existentes: 4 }), 4).eliminadas).toBe('(1 se eliminó)');
        expect(h.textoEncabezadoDivision(grupoHistorial({ total: 5, existentes: 3 }), 3).eliminadas).toBe('(2 se eliminaron)');
        expect(h.textoEncabezadoDivision(grupoHistorial({ total: 1, existentes: 1, finalizadas: 0, noCargadas: 2, enCurso: 0 }), 1).titulo).toBe('Carga dividida · 1 remesa');
        expect(h.textoEncabezadoDivision(grupoHistorial({ finalizadas: 1, noCargadas: 2 }), 3).resumen).toBe('1 finalizada · 2 fallidas o canceladas');
        expect(h.textoRetomarDivision(2)).toBe('Retomar las 2 que no se cargaron');
    });
});
