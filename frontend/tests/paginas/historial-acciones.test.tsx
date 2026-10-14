// C2a: las acciones de una fila del Historial (FA-1 a FA-12).
import { afterEach, describe, expect, it } from 'vitest';
import { armarHistorial, listaDibujada, PERMISOS_COMPLETOS, type BancoHistorial } from '../lib/banco-historial';
import { TXT_CANCELADA_SIN_ARRANCAR, canceladaC1, dtoC1, enColaC1, iso, itemHistorial, terminalC1, type Sobre } from '../lib/fabricas';
import { boton, chips, clic, dialogo, dobleClic, esperar, limpio, pasar, toasts } from '../lib/montar';
import type { HistorialItemDto, PendienteDeEncolarDto } from '@fe/types/importHistorial';

const EMP = { empresaId: 1 };
const fila = (id: number, carga: Sobre, over: Partial<HistorialItemDto> = {}): HistorialItemDto =>
    itemHistorial({ ...over }, { ...carga, remesaId: id, numeroRemesa: String(id).padStart(5, '0'), nombre: `Carga ${id}`, ...EMP });
const g = (gid: string, orden: number, total: number) => ({ grupoId: gid, grupoOrden: orden, grupoTotal: total });
const borrador = { fase: 'BORRADOR', enCurso: false, terminal: false, estadoProceso: 'VALIDANDO', resultado: null, progreso: 0, procesadas: 0, ok: 0, err: 0, startedAt: null, heartbeatAt: null, encoladaAt: null, cancelable: false };
const fallidaRetomable = (over: Sobre = {}) => terminalC1('FALLIDA', { ...EMP, error: 'x', retomable: true, procesadas: 0, ok: 0, err: 0, startedAt: null, ...over });
const canceladaEnCola = (e: ReturnType<typeof dtoC1>) => canceladaC1({ ...e, cancelada: true, fase: 'TERMINADA', estadoProceso: 'FALLIDA', enCurso: false, terminal: true, cancelable: false, retomable: true, rev: e.rev + 1, startedAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, error: TXT_CANCELADA_SIN_ARRANCAR, finishedAt: iso(Date.now()), enColaDelante: null });
const icono = (aria: string, i = 0) => (document.querySelectorAll(`button[aria-label="${aria}"]`)[i] as HTMLButtonElement | undefined) ?? null;
const botonesEn = (d: HTMLElement | null) => Array.from(d?.querySelectorAll('button') ?? []).map((x) => limpio(x.textContent ?? ''));
const dlgCancelar = () => dialogo(/^Cancelar (importación|todo lo que falta)$/);
const post = (bb: BancoHistorial, patron: RegExp) => bb.srv.de('POST', patron);

let b: BancoHistorial | null = null;
afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

describe('FA-1 y FA-2 — cancelar desde la fila', () => {
    it('FA-1 — una en cola: el diálogo de C1, un POST, y la fila pasa a «Cancelada antes de empezar» con la respuesta', async () => {
        const f = fila(150, enColaC1({ ...EMP, enColaDelante: 0 }));
        b = await armarHistorial({ items: [f] });
        await listaDibujada(b);
        b.cancelar = (id) => { const c = canceladaEnCola(b!.items.find((i) => i.id === id)!.carga); b!.items = b!.items.map((i) => (i.id === id ? { ...i, carga: c } : i)); return { body: { message: 'ok', efecto: 'CANCELADA', carga: c } }; };
        await clic(icono('Cancelar importación'), 'el ícono de cancelar');
        await esperar(() => !!dlgCancelar(), { que: 'el diálogo' });
        expect(limpio(dlgCancelar()!.textContent ?? '')).toContain('Esta importación todavía no empezó. Si la cancelás no se carga ninguna fila, y después la podés retomar desde su detalle.');
        expect(post(b, /cancelar/)).toHaveLength(0);
        await clic(boton('Cancelar importación', dlgCancelar()!), 'confirmar');
        await esperar(() => chips(b!.v.contenedor).includes('Cancelada antes de empezar'), { que: 'la fila cancelada' });
        expect(post(b, /cancelar/).map((p) => p.ruta)).toEqual(['/import/remesas/150/cancelar']);
        expect(toasts().some((t) => t.texto === 'Importación cancelada.')).toBe(true);
    });

    it('FA-2 — una fila de una división: «Cancelar todo lo que falta» es un POST al grupo', async () => {
        const items = [fila(151, dtoC1({ ...EMP, ...g('g1', 1, 3) })), fila(152, enColaC1({ ...EMP, ...g('g1', 2, 3), enColaDelante: 1 })), fila(153, enColaC1({ ...EMP, ...g('g1', 3, 3), enColaDelante: 2 }))];
        b = await armarHistorial({ items });
        await listaDibujada(b);
        b.cancelarGrupo = () => {
            const c153 = canceladaEnCola(items[2].carga);
            const c152 = canceladaEnCola(items[1].carga);
            const c151 = { ...items[0].carga, rev: 9, cancelacionPedidaAt: iso(Date.now()), cancelable: false };
            const nuevas = new Map([[151, c151], [152, c152], [153, c153]]);
            b!.items = b!.items.map((i) => ({ ...i, carga: nuevas.get(i.id) ?? i.carga }));
            return { body: { resultados: [{ remesaId: 153, numeroRemesa: '00153', efecto: 'CANCELADA', carga: c153 }, { remesaId: 152, numeroRemesa: '00152', efecto: 'CANCELADA', carga: c152 }, { remesaId: 151, numeroRemesa: '00151', efecto: 'PEDIDA', carga: c151 }] } };
        };
        await clic(icono('Cancelar importación', 0), 'el ícono de la remesa en curso');
        await esperar(() => !!dlgCancelar() && /Cancelar todo lo que falta/.test(dlgCancelar()!.textContent ?? ''), { que: 'las dos opciones' });
        expect(botonesEn(dlgCancelar())).toEqual(['Volver', 'Cancelar solo esta remesa', 'Cancelar todo lo que falta']);
        await clic(boton('Cancelar todo lo que falta', dlgCancelar()!), 'todo lo que falta');
        await esperar(() => !dlgCancelar() && chips(b!.v.contenedor).includes('Cancelando…'), { que: 'la fila en cancelación' });
        expect(post(b, /cancelar/).map((p) => p.ruta)).toEqual(['/import/grupos/g1/cancelar']);
        expect(chips(b.v.contenedor).filter((c) => c === 'Cancelada antes de empezar')).toHaveLength(2);
    });
});

describe('FA-3 a FA-5 — retomar', () => {
    it('FA-3 — la confirmación con su texto, un POST, la fila pasa a «En cola»; dos clics seguidos, un POST', async () => {
        const f = fila(160, fallidaRetomable());
        b = await armarHistorial({ items: [f] });
        await listaDibujada(b);
        b.retomar = (id) => { const c = enColaC1({ ...EMP, remesaId: id, numeroRemesa: '00160', enColaDelante: 0, rev: 20 }); b!.items = b!.items.map((i) => (i.id === id ? { ...i, carga: c } : i)); return { status: 201, body: { message: 'ok', remesaId: id, carga: c } }; };
        await dobleClic(icono('Retomar'), 'el ícono de retomar');
        const d = await esperar(() => dialogo(/^Retomar la remesa$/), { que: 'la confirmación' });
        expect(limpio(d.textContent ?? '')).toContain('Se vuelve a encolar la misma remesa, con el mismo archivo. No se cargó ninguna fila la vez anterior.');
        expect(post(b, /retomar/)).toHaveLength(0);
        await clic(boton('Retomar', d), 'confirmar');
        await esperar(() => chips(b!.v.contenedor).includes('En cola'), { que: 'la fila en cola' });
        expect(post(b, /retomar/).map((p) => p.ruta)).toEqual(['/import/remesas/160/retomar']);
        expect(icono('Retomar')).toBeNull();
    });

    it('FA-3 — si se cancela la confirmación no sale ningún pedido', async () => {
        b = await armarHistorial({ items: [fila(161, fallidaRetomable())] });
        await listaDibujada(b);
        await clic(icono('Retomar'), 'retomar');
        const d = await esperar(() => dialogo(/^Retomar la remesa$/), { que: 'la confirmación' });
        await clic(boton('Cancelar', d), 'cancelar la confirmación');
        await pasar(400);
        expect(post(b, /retomar/)).toHaveLength(0);
        expect(icono('Retomar')!.disabled).toBe(false);
    });

    it('FA-4 — un 409: toast con el mensaje, refresco, y el botón ya no está', async () => {
        const f = fila(162, fallidaRetomable());
        b = await armarHistorial({ items: [f] });
        await listaDibujada(b);
        const MSG = 'El corte de esta remesa ya figura en la remesa 00170: no se puede retomar. Si esta ya no hace falta, eliminala desde el Historial.';
        b.retomar = (id) => {
            b!.items = b!.items.map((i) => (i.id === id ? { ...i, carga: { ...i.carga, retomable: false, corteRepetidoEn: ['00170'] } } : i));
            return { status: 409, body: { statusCode: 409, message: MSG, code: 'CORTE_YA_CONFIRMADO' } };
        };
        const antes = b.consultasHistorial();
        await clic(icono('Retomar'), 'retomar');
        const d = await esperar(() => dialogo(/^Retomar la remesa$/), { que: 'la confirmación' });
        await clic(boton('Retomar', d), 'confirmar');
        await esperar(() => toasts().some((t) => t.variante === 'error' && t.texto === MSG), { que: 'el toast' });
        await esperar(() => b!.consultasHistorial() > antes && icono('Retomar') === null, { que: 'el refresco' });
        expect(b.texto()).toContain('El corte de esta remesa ya figura en la remesa 00170: no se puede retomar. Si esta ya no hace falta, eliminala.');
    });

    it('FA-5 — «Retomar las 2 que no se cargaron» del encabezado: un POST al grupo; con 409 NINGUNA_RETOMABLE se listan los motivos', async () => {
        const items = [fila(170, fallidaRetomable(g('g5', 1, 3))), fila(171, fallidaRetomable(g('g5', 2, 3))), fila(172, terminalC1('OK', { ...EMP, ...g('g5', 3, 3) }))];
        b = await armarHistorial({ items });
        await listaDibujada(b);
        b.retomarGrupo = () => ({ status: 409, body: { statusCode: 409, message: 'Ninguna de las remesas se puede retomar.', code: 'NINGUNA_RETOMABLE', omitidas: [{ remesaId: 170, numeroRemesa: '00170', motivo: 'El corte ya figura en la remesa 00180.' }, { remesaId: 171, numeroRemesa: '00171', motivo: 'El archivo ya no está en el servidor.' }] } });
        await clic(boton('Retomar las 2 que no se cargaron'), 'el botón del encabezado');
        const d = await esperar(() => dialogo(/^Retomar las remesas$/), { que: 'la confirmación' });
        expect(limpio(d.textContent ?? '')).toContain('Se vuelven a encolar las mismas remesas, con el mismo archivo.');
        await clic(boton('Retomar', d), 'confirmar');
        await esperar(() => toasts().some((t) => t.texto === 'Remesa 00171: El archivo ya no está en el servidor.'), { que: 'los motivos' });
        expect(toasts().map((t) => t.texto)).toEqual(expect.arrayContaining(['Remesa 00170: El corte ya figura en la remesa 00180.', 'Ninguna de las remesas se puede retomar.']));
        expect(post(b, /retomar/).map((p) => p.ruta)).toEqual(['/import/grupos/g5/retomar']);
    });

    it('FA-5 — el encabezado no ofrece retomar con una sola retomable', async () => {
        const items = [fila(173, fallidaRetomable(g('g6', 1, 2))), fila(174, terminalC1('OK', { ...EMP, ...g('g6', 2, 2) }))];
        b = await armarHistorial({ items });
        await listaDibujada(b);
        expect(boton(/^Retomar las/)).toBeNull();
        expect(icono('Retomar')).not.toBeNull();
    });
});

describe('FA-6 a FA-8 — confirmar las que no se pudieron encolar', () => {
    const pendiente = (ids: number[], extra: Partial<PendienteDeEncolarDto> = {}): PendienteDeEncolarDto => ({
        remesas: ids.map((id, i) => ({ remesaId: id, numeroRemesa: String(id).padStart(5, '0'), corte: `Nómina ${3082 + i * 8}` })),
        origen: [{ remesaId: 90, numeroRemesa: '00140', nombre: 'Telecom septiembre' }],
        yaCargadoEn: [],
        ...extra,
    });
    const par = (extra: Partial<PendienteDeEncolarDto> = {}, corte: string | null = 'Nómina 3082') => {
        const p = pendiente([180, 181], extra);
        return [fila(180, borrador, { pendienteDeEncolar: p, corte }), fila(181, borrador, { pendienteDeEncolar: p, corte: corte ? 'Nómina 3090' : null })];
    };
    const abrir = async () => {
        await clic(icono('Confirmar', 0), 'confirmar');
        return esperar(() => dialogo(/^Confirmar las 2 importaciones$/), { que: 'el diálogo de confirmar' });
    };

    it('FA-6 — el diálogo lista remesas, cortes y origen; el POST lleva los ids; las filas pasan a «En cola»', async () => {
        b = await armarHistorial({ items: par() });
        await listaDibujada(b);
        b.confirmarPendientes = (ids) => {
            const cargas = ids.map((id, i) => enColaC1({ ...EMP, remesaId: id, numeroRemesa: String(id).padStart(5, '0'), ...g('gp', i + 1, ids.length), enColaDelante: i, rev: 30 }));
            b!.items = b!.items.map((it_) => { const c = cargas.find((x) => x.remesaId === it_.id); return c ? { ...it_, carga: c, pendienteDeEncolar: null } : it_; });
            return { status: 201, body: { message: 'ok', grupoId: 'gp', cargas } };
        };
        const d = await abrir();
        const txt = limpio(d.textContent ?? '');
        expect(txt).toContain('Estas 2 importaciones se confirmaron y la cola de trabajos no respondió: no se cargó nada. Al confirmar se mandan a la cola tal como se habían confirmado; la vista previa no se vuelve a mostrar.');
        expect(txt).toContain('Remesa 00180 — Nómina 3082');
        expect(txt).toContain('Remesa 00181 — Nómina 3090');
        expect(txt).toContain('Remesa de origen: 00140 (Telecom septiembre).');
        expect(botonesEn(d)).toEqual(['Volver', 'Confirmar']);
        await clic(boton('Confirmar', d), 'Confirmar');
        await esperar(() => chips(b!.v.contenedor).filter((c) => c === 'En cola').length === 2, { que: 'las dos en cola' });
        expect(JSON.parse(post(b, /confirmar-pendientes/)[0].cuerpo.toString('utf8'))).toEqual({ remesaIds: [180, 181] });
        expect(toasts().some((t) => t.variante === 'success' && t.texto === 'Importación encolada')).toBe(true);
    });

    it('FA-6 — una sola: título y texto en singular', async () => {
        const p = pendiente([182], { origen: [] });
        b = await armarHistorial({ items: [fila(182, borrador, { pendienteDeEncolar: p })] });
        await listaDibujada(b);
        await clic(icono('Confirmar'), 'confirmar');
        const d = await esperar(() => dialogo(/^Confirmar la importación$/), { que: 'el diálogo' });
        expect(limpio(d.textContent ?? '')).toContain('Esta importación se confirmó y la cola de trabajos no respondió');
        expect(limpio(d.textContent ?? '')).not.toContain('Remesa de origen');
    });

    it('FA-7 — con la remesa de origen eliminada: botón deshabilitado, con el motivo', async () => {
        b = await armarHistorial({ items: par({ origen: [{ remesaId: 90, numeroRemesa: null, nombre: null }] }) });
        await listaDibujada(b);
        const d = await abrir();
        expect(limpio(d.textContent ?? '')).toContain('Remesa de origen: una remesa que ya no existe.');
        expect(boton('Confirmar', d)!.disabled).toBe(true);
    });

    it('FA-7 — con `yaCargadoEn`: la advertencia nombra la remesa; con corte, deshabilitado', async () => {
        b = await armarHistorial({ items: par({ yaCargadoEn: [{ remesaId: 200, numeroRemesa: '00160' }] }) });
        await listaDibujada(b);
        const d = await abrir();
        expect(limpio(d.textContent ?? '')).toContain('Este archivo ya figura en la remesa 00160, que se confirmó después. Si confirmás estas, se carga otra vez.');
        expect(boton('Confirmar', d)!.disabled).toBe(true);
    });

    it('FA-7 — sin corte: el botón dice «Confirmar igual» y manda el pedido', async () => {
        const p = pendiente([183], { yaCargadoEn: [{ remesaId: 200, numeroRemesa: '00160' }] });
        b = await armarHistorial({ items: [fila(183, borrador, { pendienteDeEncolar: p, corte: null })] });
        await listaDibujada(b);
        b.confirmarPendientes = (ids) => ({ status: 201, body: { message: 'ok', grupoId: null, cargas: ids.map((id) => enColaC1({ ...EMP, remesaId: id, numeroRemesa: '00183' })) } });
        await clic(icono('Confirmar'), 'confirmar');
        const d = await esperar(() => dialogo(/^Confirmar la importación$/), { que: 'el diálogo' });
        expect(limpio(d.textContent ?? '')).toContain('Este archivo ya figura en la remesa 00160, que se confirmó después. Si confirmás esta, se carga otra vez.');
        expect(boton('Confirmar igual', d)!.disabled).toBe(false);
        await clic(boton('Confirmar igual', d), 'Confirmar igual');
        await esperar(() => post(b!, /confirmar-pendientes/).length === 1, { que: 'el pedido' });
    });

    it('FA-8 — un 503: toast con el mensaje; siguen «No se pudo encolar»', async () => {
        b = await armarHistorial({ items: par() });
        await listaDibujada(b);
        b.confirmarPendientes = () => ({ status: 503, body: { statusCode: 503, message: 'No se pudo encolar la importación: la cola no responde.' } });
        const d = await abrir();
        await clic(boton('Confirmar', d), 'Confirmar');
        await esperar(() => toasts().some((t) => t.texto === 'No se pudo encolar la importación: la cola no responde.'), { que: 'el toast' });
        await esperar(() => chips(b!.v.contenedor).filter((c) => c === 'No se pudo encolar').length === 2, { que: 'siguen pendientes' });
    });

    it('FA-8 — con `noEncoladas` en la respuesta: un aviso que las nombra', async () => {
        b = await armarHistorial({ items: par() });
        await listaDibujada(b);
        b.confirmarPendientes = () => ({ status: 201, body: { message: 'ok', grupoId: 'gp', cargas: [enColaC1({ ...EMP, remesaId: 180, numeroRemesa: '00180', rev: 40 })], noEncoladas: [{ remesaId: 181, numeroRemesa: '00181' }] } });
        const d = await abrir();
        await clic(boton('Confirmar', d), 'Confirmar');
        await esperar(() => toasts().some((t) => t.variante === 'warning' && /00181/.test(t.texto)), { que: 'el aviso' });
    });
});

describe('FA-9 y FA-10 — eliminar', () => {
    const abrirEliminar = async (i = 0) => {
        await clic(icono('Eliminar', i), 'eliminar');
        return esperar(() => dialogo(/^(Eliminar|Confirmar eliminación)/), { que: 'el diálogo de eliminar' });
    };
    const cerrar = async (d: HTMLElement) => { await clic(boton('Cancelar', d), 'cancelar'); await esperar(() => !dialogo(/^(Eliminar|Confirmar eliminación)/), { que: 'diálogo cerrado' }); };

    it('FA-9 — el diálogo de cada estado con su texto', async () => {
        b = await armarHistorial({
            items: [
                fila(190, borrador),
                fila(191, enColaC1({ ...EMP, enColaDelante: 1 })),
                fila(192, enColaC1({ ...EMP, ...g('g8', 2, 3), enColaDelante: 1 })),
                fila(193, terminalC1('OK', { ...EMP, tipo: 'PAGOS' }), { categoria: 'PAGOS' }),
                fila(194, terminalC1('OK', { ...EMP, tipo: 'ACCIONES' }), { categoria: 'ACCIONES' }),
                fila(195, terminalC1('OK', EMP), { categoria: 'DEUDORES' }),
            ],
        });
        await listaDibujada(b);
        // La lista llega por id descendente: 195, 194, …, 190.
        const textos: Record<string, string> = {};
        for (const [i, id] of [195, 194, 193, 192, 191, 190].entries()) {
            const d = await abrirEliminar(i);
            textos[String(id)] = limpio(d.textContent ?? '');
            await cerrar(d);
        }
        expect(textos['195']).toContain('Confirmar eliminación');
        expect(textos['195']).toContain('Esta acción eliminará la importación junto con sus casos (deudores)');
        expect(textos['194']).toContain('Eliminarla no revierte la acción y deja sin efecto el botón Revertir para siempre. Si la acción salió mal, revertila primero.');
        expect(textos['193']).toContain('No deshace lo que aplicó: lo que cargó sobre los casos de otras remesas queda como está.');
        expect(textos['192']).toContain('Eliminar una importación en cola');
        expect(textos['192']).toContain('está confirmada y espera su turno');
        expect(textos['192']).toContain('Es la remesa 2 de 3 de una carga dividida: las demás siguen.');
        expect(textos['192']).toContain('Eliminar igual');
        expect(textos['191']).not.toContain('de una carga dividida');
        expect(textos['191']).toContain('Si solo querés frenarla, usá «Cancelar»: no se carga ninguna fila y después la podés retomar.');
        expect(textos['190']).toContain('Eliminar vista previa');
        expect(textos['190']).toContain('Es una vista previa sin confirmar: no cargó nada. Al eliminarla se libera su número de remesa. No se puede deshacer.');
        expect(new Set(Object.values(textos)).size).toBe(6);
    });

    it('FA-9 — una que está procesando: deshabilitado, con el motivo', async () => {
        b = await armarHistorial({ items: [fila(196, dtoC1(EMP))] });
        await listaDibujada(b);
        expect(icono('Eliminar')!.disabled).toBe(true);
        expect(document.querySelector('[aria-label="No se puede eliminar una importación en curso. Para frenarla, usá Cancelar."]')).not.toBeNull();
    });

    it('FA-9 — eliminar de verdad: un DELETE, la fila sale y el toast lo dice', async () => {
        b = await armarHistorial({ items: [fila(197, terminalC1('OK', EMP)), fila(198, terminalC1('OK', EMP))] });
        await listaDibujada(b);
        const d = await abrirEliminar(0);
        await clic(boton('Eliminar', d), 'Eliminar');
        await esperar(() => b!.v.contenedor.querySelectorAll('tbody tr').length === 1, { que: 'la fila eliminada' });
        // Con el `rev` de la carga que mostraba la fila: si cambió, el servidor responde 409 en vez de borrar otra cosa.
        expect(b.srv.de('DELETE', /./).map((p) => p.ruta)).toEqual(['/import/remesas/198?rev=5']);
        expect(toasts().some((t) => t.texto === 'Importación eliminada correctamente')).toBe(true);
    });

    it('FA-10 — un 400, 403 o 404: toast con el mensaje del backend y refresco', async () => {
        for (const [status, message] of [[400, 'No se puede eliminar una importación en curso'], [403, 'No tenés permiso para eliminar esta importación'], [404, 'Remesa 199 no encontrada']] as Array<[number, string]>) {
            b = await armarHistorial({ items: [fila(199, terminalC1('OK', EMP))] });
            await listaDibujada(b);
            b.eliminar = () => ({ status, body: { statusCode: status, message } });
            const antes = b.consultasHistorial();
            const d = await abrirEliminar();
            await clic(boton('Eliminar', d), 'Eliminar');
            await esperar(() => toasts().some((t) => t.variante === 'error' && t.texto === message), { que: `el toast del ${status}` });
            await esperar(() => b!.consultasHistorial() > antes, { que: `el refresco tras el ${status}` });
            await b.v.desmontar(); await b.srv.bajar(); b = null;
        }
    });
});

describe('FA-11 y FA-12 — permisos y lo que ya había', () => {
    it('FA-11 — sin `importacion.ejecutar`: ni cancelar, ni retomar, ni confirmar', async () => {
        const p: PendienteDeEncolarDto = { remesas: [{ remesaId: 212, numeroRemesa: '00212', corte: null }], origen: [], yaCargadoEn: [] };
        b = await armarHistorial({
            permisos: ['importacion.ver_historial', 'importacion.eliminar'],
            items: [fila(210, enColaC1(EMP)), fila(211, fallidaRetomable()), fila(212, borrador, { pendienteDeEncolar: p })],
        });
        await listaDibujada(b);
        expect(icono('Cancelar importación')).toBeNull();
        expect(icono('Retomar')).toBeNull();
        expect(icono('Confirmar')).toBeNull();
        expect(document.querySelectorAll('button[aria-label="Eliminar"]').length).toBe(3);
    });

    it('FA-11 — sin `importacion.eliminar`, sin el botón', async () => {
        b = await armarHistorial({ permisos: ['importacion.ver_historial', 'importacion.ejecutar'], items: [fila(213, terminalC1('OK', EMP))] });
        await listaDibujada(b);
        expect(icono('Eliminar')).toBeNull();
    });

    it('FA-11 — otro usuario sin `ver_progreso_otros`: nada sobre cargas ajenas', async () => {
        b = await armarHistorial({
            permisos: ['importacion.ver_historial', 'importacion.ejecutar', 'importacion.eliminar'],
            items: [fila(214, enColaC1({ ...EMP, usuarioId: 8 })), fila(215, fallidaRetomable({ usuarioId: 8 })), fila(216, terminalC1('OK', { ...EMP, usuarioId: 8 }))],
        });
        await listaDibujada(b);
        expect(icono('Cancelar importación')).toBeNull();
        expect(icono('Retomar')).toBeNull();
        const eliminar = Array.from(document.querySelectorAll('button[aria-label="Eliminar"]')) as HTMLButtonElement[];
        expect(eliminar).toHaveLength(3);
        expect(eliminar.every((x) => x.disabled)).toBe(true);
        expect(document.querySelectorAll('[aria-label="Solo podés eliminar tus importaciones."]').length).toBe(3);
    });

    it('FA-11 — con `ver_progreso_otros` sí se puede sobre las ajenas', async () => {
        b = await armarHistorial({ permisos: PERMISOS_COMPLETOS, items: [fila(217, enColaC1({ ...EMP, usuarioId: 8 }))] });
        await listaDibujada(b);
        expect(icono('Cancelar importación')).not.toBeNull();
        expect(icono('Eliminar')!.disabled).toBe(false);
    });

    it('FA-12 — la política, revertir y consolidar siguen andando', async () => {
        b = await armarHistorial({ items: [fila(220, terminalC1('OK', { ...EMP, tipo: 'ACCIONES' }), { categoria: 'ACCIONES' })] });
        await listaDibujada(b);
        // Política
        const combo = document.querySelectorAll('[role="combobox"]')[1];
        combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        const opcion = await esperar(() => Array.from(document.querySelectorAll('li[role="option"]')).find((o) => /Política A/.test(o.textContent ?? '')), { que: 'la política' });
        await clic(opcion, 'la política');
        await esperar(() => b!.srv.de('PUT', /politica/).length === 1, { que: 'el PUT' });
        expect(JSON.parse(b.srv.de('PUT', /politica/)[0].cuerpo.toString('utf8'))).toEqual({ politicaId: 5 });
        // Revertir
        await clic(icono('Revertir'), 'revertir');
        const d = await esperar(() => dialogo(/^Revertir acción masiva$/), { que: 'el diálogo de revertir' });
        await clic(boton('Revertir', d), 'Revertir');
        await esperar(() => toasts().some((t) => /Acción revertida \(4 deudores, 1 contactos restaurados, 2 comentarios borrados\)/.test(t.texto)), { que: 'el toast de revertir' });
        expect(b.srv.de('POST', /revertir-acciones/)).toHaveLength(1);
        // Consolidar
        await clic(icono('Consolidar'), 'consolidar');
        await esperar(() => dialogos().length > 0, { que: 'el modal de consolidar' });
    });
});

const dialogos = () => Array.from(document.querySelectorAll('.MuiDialog-root'));

describe('eliminar mientras la fila cambia (hallazgo bloqueante de la auditoría de C2a)', () => {
    it('una vista previa que se confirma con el diálogo abierto: el diálogo pasa a decir «en cola», avisa del cambio, y el DELETE lleva el rev nuevo', async () => {
        b = await armarHistorial({ items: [fila(300, { ...borrador, rev: 3 })] });
        await listaDibujada(b);
        await clic(icono('Eliminar', 0), 'eliminar');
        const abierto = await esperar(() => dialogo(/^(Eliminar|Confirmar eliminación)/), { que: 'el diálogo de eliminar' });
        expect(limpio(abierto.textContent ?? '')).toContain('Eliminar vista previa');

        b.pub('import:progreso', { ...b.items[0].carga, ...enColaC1({ ...EMP, enColaDelante: 0 }), remesaId: 300, numeroRemesa: '00300', nombre: 'Carga 300', rev: 4 });
        const d = await esperar(() => {
            const x = dialogo(/^(Eliminar|Confirmar eliminación)/);
            return x && /cambió mientras tenías abierto este diálogo/.test(x.textContent ?? '') ? x : null;
        }, { que: 'el aviso de cambio en el diálogo' });
        expect(limpio(d.textContent ?? '')).toContain('Eliminar una importación en cola');
        expect(limpio(d.textContent ?? '')).not.toContain('Eliminar vista previa');

        await clic(boton('Eliminar igual', d), 'Eliminar igual');
        await esperar(() => b!.srv.de('DELETE', /./).length === 1, { que: 'el DELETE' });
        expect(b.srv.de('DELETE', /./)[0].ruta).toBe('/import/remesas/300?rev=4');
    });
});
