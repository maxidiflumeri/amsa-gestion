// C1 — cancelar (§10.8.4): desde el detalle y desde el paso «Importando». Componentes reales, backend falso.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { BASURA, T0, TXT_CANCELADA_DEUDORES, TXT_CANCELADA_SIN_ARRANCAR, canceladaC1, dtoC1, dtoFaseB, enColaC1, iso, terminal, terminalC1 } from '../lib/fabricas';
import { enElSpec10 } from '../lib/spec';
import { alertas, boton, chips, clic, dialogo, dobleClic, dosClicsEnLaMismaTarea, esperar, limpio, pasar, toasts } from '../lib/montar';
import { armarDetalle, type BancoDetalle } from '../lib/banco-detalle';

let b: BancoDetalle | null = null;
afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

const CANCELAR = /^\/import\/remesas\/\d+\/cancelar$/;
const CANCELAR_GRUPO = /^\/import\/grupos\/[^/]+\/cancelar$/;
const btnCancelar = () => boton('Cancelar importación', b!.v.contenedor);
const dlg = () => dialogo(/^Cancelar importación$/);
const cuerpoDlg = () => limpio(dlg()?.querySelector('.MuiDialogContent-root')?.textContent ?? '');
const motivo = () => { const bt = btnCancelar(); return bt ? limpio(bt.parentElement?.querySelector('.MuiTypography-caption')?.textContent ?? '') : null; };
const cerrar = async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; };
const TODOS = ['importacion.ver_historial', 'importacion.ejecutar', 'importacion.ver_progreso_otros'];

describe('quién ve el botón «Cancelar importación» (detalle)', () => {
    it('matriz de permisos, dueño y estado', async () => {
        const casos: Array<[string, any, any, boolean]> = [
            ['dueño con importacion.ejecutar', dtoC1(), {}, true],
            ['dueño SIN importacion.ejecutar', dtoC1(), { permisos: ['importacion.ver_historial'] }, false],
            ['dueño sin ejecutar pero con ver_progreso_otros', dtoC1(), { permisos: ['importacion.ver_historial', 'importacion.ver_progreso_otros'] }, false],
            ['otro usuario con ejecutar', dtoC1(), { usuarioId: 8 }, false],
            ['otro usuario con ejecutar + ver_progreso_otros', dtoC1(), { usuarioId: 8, permisos: TODOS }, true],
            ['en cola, dueño', enColaC1(), {}, true],
            ['DTO de la Fase B (sin `cancelable`)', dtoFaseB(), {}, false],
            ['`cancelable: null`', dtoC1({ cancelable: null }), {}, false],
            ['terminada OK', terminalC1('OK'), {}, false],
            ['terminada con `cancelable: true` (DTO incoherente)', terminalC1('OK', { cancelable: true }), {}, false],
            ['borrador con `cancelable: true` (DTO incoherente)', dtoC1({ fase: 'BORRADOR', enCurso: false, cancelable: true }), {}, false],
        ];
        const visto: Record<string, string> = {};
        for (const [nombre, dto, o, esperado] of casos) {
            b = await armarDetalle(dto, o);
            const bt = btnCancelar();
            visto[nombre] = bt ? (bt.disabled ? 'deshabilitado' : 'habilitado') : 'no está';
            expect(!!bt, nombre).toBe(esperado);
            expect(b.texto(), nombre).not.toMatch(BASURA);
            await cerrar();
        }
    });

    it('en curso y no cancelable: deshabilitado con el motivo', async () => {
        const casos: Array<[string, any, string]> = [
            ['post-proceso', dtoC1({ fase: 'POST_PROCESO' }), 'La importación ya procesó todas las filas y está cerrando: en este paso no se puede cancelar.'],
            ['acción masiva que arrancó', dtoC1({ tipo: 'ACCIONES' }), 'Una acción masiva que ya empezó no se cancela: esperá a que termine y usá Revertir.'],
            ['ya pedida', dtoC1({ cancelacionPedidaAt: iso(Date.now() - 5000) }), 'Ya se pidió cancelar.'],
            ['cancelable:false sin causa conocida', dtoC1({ cancelable: false }), 'No se puede cancelar en este momento.'],
        ];
        const visto: Record<string, unknown> = {};
        for (const [nombre, dto, esperado] of casos) {
            b = await armarDetalle(dto);
            const bt = btnCancelar()!;
            visto[nombre] = { deshabilitado: bt.disabled, motivo: motivo() };
            expect(bt.disabled, nombre).toBe(true);
            expect(motivo(), nombre).toBe(esperado);
            bt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await pasar(150);
            expect(dlg(), nombre).toBeNull();
            expect(b.srv.cuantos('POST', CANCELAR)).toBe(0);
            await cerrar();
        }
    });
});

describe('el diálogo: nada se cancela sin confirmar, y dice qué va a pasar', () => {
    it('textos por fase y categoría; «Volver» no pide nada', async () => {
        const casos: Array<[string, any]> = [
            ['en cola', enColaC1()],
            ['leyendo', dtoC1({ fase: 'LEYENDO', procesadas: 0, ok: 0, err: 0, progreso: 0 })],
            ['procesando DEUDORES', dtoC1()],
            ['procesando sin total', dtoC1({ totalEsperado: 0 })],
            ['procesando ACTUALIZACIONES', dtoC1({ tipo: 'ACTUALIZACIONES' })],
            ['procesando PAGOS', dtoC1({ tipo: 'PAGOS' })],
        ];
        const visto: Record<string, string> = {};
        for (const [nombre, dto] of casos) {
            b = await armarDetalle(dto);
            await clic(btnCancelar(), 'Cancelar importación');
            await esperar(() => !!dlg(), { que: 'el diálogo' });
            visto[nombre] = cuerpoDlg();
            expect(b.srv.cuantos('POST', CANCELAR), nombre).toBe(0);
            expect(cuerpoDlg(), nombre).not.toMatch(BASURA);
            await clic(boton('Volver', dlg()!), 'Volver');
            await esperar(() => !dlg(), { que: 'diálogo cerrado' });
            expect(b.srv.cuantos('POST', CANCELAR), nombre).toBe(0);
            await cerrar();
        }
        expect(visto['en cola']).toBe(enElSpec10('Esta importación todavía no empezó. Si la cancelás no se carga ninguna fila, y después la podés retomar desde su detalle.'));
        expect(visto['procesando DEUDORES']).toContain('Lleva 3.000 de 14.466 filas. Si la cancelás, las filas ya procesadas quedan cargadas —no se deshacen— y el cierre de la carga no corre. Se corta al terminar la fila o el lote en curso.');
        expect(visto['procesando sin total']).toContain('Lleva 3.000 filas. Si la cancelás');
        expect(visto['procesando sin total']).not.toMatch(/ de 0 /);
    });

    it('el número del diálogo es el del momento: sigue avanzando con los eventos mientras está abierto', async () => {
        b = await armarDetalle(dtoC1());
        await clic(btnCancelar(), 'Cancelar importación');
        await esperar(() => /Lleva 3\.000 de 14\.466/.test(cuerpoDlg()), { que: 'el diálogo' });
        b.pub('import:progreso', dtoC1({ rev: 9, procesadas: 9000, ok: 8990, progreso: 62, servidorAhora: iso(Date.now()), heartbeatAt: iso(Date.now()) }));
        await esperar(() => /Lleva 9\.000 de 14\.466/.test(cuerpoDlg()), { ms: 3000, que: 'el número actualizado' });
        // Y si la carga termina con el diálogo abierto, el diálogo desaparece (no se puede cancelar algo terminado).
        b.pub('import:finalizada', terminalC1('OK', { rev: 10, procesadas: 14466, ok: 14466, err: 0 }));
        await esperar(() => !dlg(), { ms: 3000, que: 'el diálogo cerrado al terminar' });
        expect(b.srv.cuantos('POST', CANCELAR)).toBe(0);
    });

    it('confirmar con doble clic: UN solo pedido (humano y en la misma tarea)', async () => {
        for (const modo of ['humano', 'misma tarea']) {
            b = await armarDetalle(dtoC1());
            b.cancelar = async (id) => { await new Promise((r) => setTimeout(r, 250)); const c = dtoC1({ rev: 6, cancelacionPedidaAt: iso(Date.now()), canceladaPor: 'Maxi' }); b!.estados[id] = c; return { status: 200, body: { message: 'ok', efecto: 'PEDIDA', carga: c } }; };
            await clic(btnCancelar(), 'Cancelar importación');
            await esperar(() => !!dlg(), { que: 'el diálogo' });
            const confirmar = boton('Cancelar importación', dlg()!);
            if (modo === 'humano') await dobleClic(confirmar, 'confirmar'); else await dosClicsEnLaMismaTarea(confirmar);
            await pasar(700);
            if (modo === 'humano') expect(b.srv.cuantos('POST', CANCELAR)).toBe(1);
            await cerrar();
        }
    });
});

describe('después de pedir la cancelación', () => {
    it('efecto PEDIDA: aviso informativo, botón deshabilitado «Ya se pidió cancelar.»; a los 2 minutos, advertencia; al cortar, «Importación cancelada» y el aviso se apaga', async () => {
        b = await armarDetalle(dtoC1());
        b.cancelar = (id) => { const c = dtoC1({ rev: 6, cancelacionPedidaAt: iso(Date.now()), canceladaPor: 'Maxi', servidorAhora: iso(Date.now()) }); b!.estados[id] = c; return { status: 200, body: { message: 'ok', efecto: 'PEDIDA', carga: c } }; };
        await clic(btnCancelar(), 'Cancelar importación');
        await esperar(() => !!dlg(), { que: 'el diálogo' });
        await clic(boton('Cancelar importación', dlg()!), 'confirmar');
        await esperar(() => !dlg() && alertas().some((a) => /Se pidió cancelar/.test(a.texto)), { que: 'el aviso' });
        const a1 = alertas().filter((a) => /cancelar/.test(a.texto));
        expect(a1).toEqual([{ severidad: 'info', texto: enElSpec10('Se pidió cancelar esta importación. Se corta al terminar la fila o el lote en curso; lo ya procesado queda cargado.') }]);
        expect(btnCancelar()!.disabled).toBe(true);
        expect(motivo()).toBe('Ya se pidió cancelar.');
        expect(b.srv.cuantos('POST', CANCELAR)).toBe(1);
        // Pasan 3 minutos según el servidor y la carga no cortó.
        b.pub('import:progreso', dtoC1({ rev: 7, cancelacionPedidaAt: iso(Date.now() - 185_000), canceladaPor: 'Maxi', servidorAhora: iso(Date.now()), heartbeatAt: iso(Date.now()) }));
        await esperar(() => alertas().some((a) => /todavía no cortó/.test(a.texto)), { ms: 3000, que: 'la advertencia' });
        const a2 = alertas().filter((a) => /cancelar/.test(a.texto));
        enElSpec10('Se pidió cancelar hace N min y la carga todavía no cortó: puede estar en un paso que no se puede interrumpir. Si sigue así, avisá a soporte.');
        expect(a2).toEqual([{ severidad: 'warning', texto: 'Se pidió cancelar hace 3 min y la carga todavía no cortó: puede estar en un paso que no se puede interrumpir. Si sigue así, avisá a soporte.' }]);
        // El runner corta.
        b.pub('import:finalizada', canceladaC1({ rev: 8 }));
        await esperar(() => alertas().some((a) => /^Importación cancelada/.test(a.texto)), { ms: 3000, que: 'la cancelada' });
        await pasar(200);
        const fin = alertas();
        expect(fin.filter((a) => /Se pidió cancelar/.test(a.texto))).toEqual([]);
        expect(fin).toContainEqual({ severidad: 'warning', texto: 'Importación cancelada' + TXT_CANCELADA_DEUDORES.replace(/\n\n/g, ' ') });
        expect(chips(b.v.contenedor)).toContain('Cancelada');
        expect(b.texto()).not.toMatch(/Importación exitosa|Importación finalizada|La importación falló|terminó completa/);
        expect(btnCancelar()).toBeNull();
        expect(b.texto()).not.toMatch(BASURA);
    });

    it('efecto CANCELADA (en cola): toast, chip «Cancelada antes de empezar», alerta con el motivo, y Retomar si el backend dice `retomable`', async () => {
        b = await armarDetalle(enColaC1());
        b.cancelar = (id) => { const c = canceladaC1({ rev: 3, startedAt: null, heartbeatAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, error: TXT_CANCELADA_SIN_ARRANCAR, retomable: true }); b!.estados[id] = c; return { status: 200, body: { message: 'ok', efecto: 'CANCELADA', carga: c } }; };
        await clic(btnCancelar(), 'Cancelar importación');
        await esperar(() => !!dlg(), { que: 'el diálogo' });
        await clic(boton('Cancelar importación', dlg()!), 'confirmar');
        // C2b (D1, §16.5): el chip grande dice lo mismo que el Historial; una cancelada en cola es «Cancelada antes de empezar».
        await esperar(() => chips(b!.v.contenedor).includes('Cancelada antes de empezar'), { que: 'la cancelada' });
        await pasar(250);
        expect(toasts()).toContainEqual({ variante: 'info', texto: 'Importación cancelada.' });
        expect(alertas()).toContainEqual({ severidad: 'warning', texto: 'Importación cancelada' + TXT_CANCELADA_SIN_ARRANCAR.replace(/\n\n/g, ' ') });
        expect(!!boton('Retomar')).toBe(true);
        expect(b.texto()).not.toMatch(/Importación exitosa|Importación finalizada|100%/);
        expect(b.texto()).not.toMatch(BASURA);
    });

    it('los 409 del backend: se muestra SU texto, el diálogo no se cierra y no queda ningún «Se pidió cancelar»', async () => {
        const textos = {
            a: enElSpec10('Esta importación no está en curso: no hay nada que cancelar. Si es una vista previa que no querés, eliminala.'),
            b: enElSpec10('Esta importación ya terminó: no hay nada que cancelar.'),
            c: enElSpec10('La importación ya procesó todas las filas y está cerrando: en este paso no se puede cancelar. Esperá a que termine.'),
            d: enElSpec10('Una acción masiva que ya empezó no se cancela: los datos para deshacerla se guardan recién al terminar. Esperá a que termine y usá Revertir, que la deshace completa.'),
        };
        for (const [k, texto] of Object.entries(textos)) {
            b = await armarDetalle(dtoC1());
            b.cancelar = () => ({ status: 409, body: { statusCode: 409, message: texto } });
            await clic(btnCancelar(), 'Cancelar importación');
            await esperar(() => !!dlg(), { que: 'el diálogo' });
            await clic(boton('Cancelar importación', dlg()!), 'confirmar');
            await esperar(() => toasts().length > 0, { que: 'el toast' });
            await pasar(200);
            expect(toasts(), k).toEqual([{ variante: 'error', texto }]);
            expect(alertas().some((a) => /Se pidió cancelar/.test(a.texto)), k).toBe(false);
            expect(!!dlg(), `${k}: el diálogo sigue abierto`).toBe(true);
            expect(boton('Cancelar importación', dlg()!)!.disabled, `${k}: se puede reintentar`).toBe(false);
            await cerrar();
        }
    });

    it('pedido que llegó tarde: la carga termina BIEN con el pedido escrito → «terminó completa»; termina FALLIDA (reaper) → no lo dice', async () => {
        const pedido = { cancelacionPedidaAt: iso(T0 - 4000), canceladaPor: 'Maxi' };
        const visto: Record<string, unknown> = {};
        const casos: Array<[string, any]> = [
            ['OK', terminalC1('OK', { ...pedido, procesadas: 14466, ok: 14466, err: 0 })],
            ['CON_ADVERTENCIAS', terminalC1('CON_ADVERTENCIAS', { ...pedido, procesadas: 14466, ok: 14466, err: 0, errorPostProceso: 'La base de datos no respondió a tiempo (P2028).' })],
            ['SIN_FILAS', terminalC1('SIN_FILAS', { ...pedido, procesadas: 0, ok: 0, err: 0, descartadas: 900 })],
            ['FALLIDA por interrupción', terminalC1('FALLIDA', { ...pedido, error: 'La importación se interrumpió: el servidor se reinició o dejó de responder mientras la procesaba.' })],
            ['cancelada', canceladaC1()],
        ];
        for (const [nombre, dto] of casos) {
            b = await armarDetalle(dto);
            visto[nombre] = alertas().map((a) => `${a.severidad}: ${a.texto.slice(0, 150)}`);
            await cerrar();
        }
        const TARDE = 'info: ' + enElSpec10('Se pidió cancelar esta importación cuando ya estaba cerrando: terminó completa.');
        expect(visto['OK']).toEqual([TARDE]);
        expect((visto['FALLIDA por interrupción'] as string[]).some((t) => /terminó completa|llegó tarde/.test(t))).toBe(false);
        // Segunda pasada (hallazgo 8): fuera de OK no se afirma «terminó completa».
        const TARDE_OTRA = 'info: Se pidió cancelar esta importación cuando ya estaba cerrando: el pedido llegó tarde y la carga terminó igual.';
        expect((visto['CON_ADVERTENCIAS'] as string[])[0]).toBe(TARDE_OTRA);
        expect((visto['SIN_FILAS'] as string[])[0]).toBe(TARDE_OTRA);
        expect((visto['cancelada'] as string[]).some((t) => /terminó completa/.test(t))).toBe(false);
    });
});

describe('cancelar en una carga dividida (detalle de una remesa del grupo)', () => {
    const g = { grupoId: 'g-7', grupoTotal: 4 };
    const hermanas = () => [
        terminalC1('OK', { remesaId: 140, numeroRemesa: '3080', ...g, grupoOrden: 1 }),
        enColaC1({ remesaId: 142, numeroRemesa: '3082', ...g, grupoOrden: 3, enColaDelante: 1 }),
        enColaC1({ remesaId: 143, numeroRemesa: '3083', ...g, grupoOrden: 4, enColaDelante: 2 }),
    ];
    const propia = () => dtoC1({ remesaId: 141, numeroRemesa: '3081', ...g, grupoOrden: 2 });

    it('las dos opciones, con las remesas que faltan nombradas; «solo esta» pega a la remesa y «todo lo que falta» al grupo, una vez', async () => {
        b = await armarDetalle(propia(), { otras: hermanas() });
        expect(b.texto()).toContain(enElSpec10('Remesa {grupoOrden} de {grupoTotal} de una carga dividida').replace('{grupoOrden}', '2').replace('{grupoTotal}', '4'));
        await clic(btnCancelar(), 'Cancelar importación');
        await esperar(() => !!boton('Cancelar todo lo que falta', dlg() ?? undefined), { que: 'las dos opciones' });
        // §10.16: si la en curso sí se corta, el cartel la nombra entre lo que se cancela (el test portado afirmaba el cartel anterior).
        expect(cuerpoDlg()).toContain('«Cancelar todo lo que falta» cancela la remesa en curso (3081) y las 2 que no empezaron (3082 y 3083).');
        expect(!!boton(enElSpec10('Cancelar solo esta remesa'), dlg()!)).toBe(true);
        expect(b.srv.cuantos('POST', CANCELAR) + b.srv.cuantos('POST', CANCELAR_GRUPO)).toBe(0);
        // Todo lo que falta: la que corre queda pedida, las dos en cola canceladas, y una RECHAZADA de mentira para ver el aviso.
        b.cancelarGrupo = () => {
            const c141 = dtoC1({ ...propia(), rev: 6, cancelacionPedidaAt: iso(Date.now()), canceladaPor: 'Maxi', cancelable: false }); b!.estados[141] = c141;
            const c143 = canceladaC1({ remesaId: 143, numeroRemesa: '3083', ...g, grupoOrden: 4, rev: 3, startedAt: null, procesadas: 0, ok: 0, err: 0, error: TXT_CANCELADA_SIN_ARRANCAR, retomable: true }); b!.estados[143] = c143;
            return { status: 200, body: { resultados: [
                { remesaId: 143, numeroRemesa: '3083', efecto: 'CANCELADA', carga: c143 },
                { remesaId: 142, numeroRemesa: '3082', efecto: 'RECHAZADA', motivo: 'La importación ya procesó todas las filas y está cerrando: en este paso no se puede cancelar. Esperá a que termine.', carga: b!.estados[142] },
                { remesaId: 141, numeroRemesa: '3081', efecto: 'PEDIDA', carga: c141 },
                { remesaId: 140, numeroRemesa: '3080', efecto: 'YA_TERMINADA', carga: b!.estados[140] },
            ] } };
        };
        await dobleClic(boton('Cancelar todo lo que falta', dlg()!), 'Cancelar todo lo que falta');
        await esperar(() => !dlg() && alertas().some((a) => /Se pidió cancelar/.test(a.texto)), { que: 'el pedido aplicado' });
        await pasar(300);
        expect(chips(b.v.contenedor)).toContain('#3081 · Cancelando…');
        expect(b.srv.cuantos('POST', CANCELAR_GRUPO)).toBe(1);
        expect(b.srv.cuantos('POST', CANCELAR)).toBe(0);
        expect(toasts()).toContainEqual({ variante: 'warning', texto: 'Remesa 3082: La importación ya procesó todas las filas y está cerrando: en este paso no se puede cancelar. Esperá a que termine.' });
        expect(chips(b.v.contenedor)).toContain('#3083 · Cancelada antes de empezar');
    });

    it('«Cancelar solo esta remesa» no toca a las demás', async () => {
        b = await armarDetalle(propia(), { otras: hermanas() });
        b.cancelar = (id) => { const c = dtoC1({ ...propia(), rev: 6, cancelacionPedidaAt: iso(Date.now()), cancelable: false }); b!.estados[id] = c; return { status: 200, body: { message: 'ok', efecto: 'PEDIDA', carga: c } }; };
        await clic(btnCancelar(), 'Cancelar importación');
        await esperar(() => !!boton('Cancelar solo esta remesa', dlg() ?? undefined), { que: 'las dos opciones' });
        await clic(boton('Cancelar solo esta remesa', dlg()!), 'solo esta');
        await esperar(() => !dlg(), { que: 'cerrado' });
        expect(b.srv.de('POST', CANCELAR).map((p) => p.ruta)).toEqual(['/import/remesas/141/cancelar']);
        expect(b.srv.cuantos('POST', CANCELAR_GRUPO)).toBe(0);
    });

    // Los casos «la división no se puede leer» y «la foto de la lista» están en tests/20-c1-cancelar-division.test.tsx.
});

describe('C3b — cancelar una acción masiva en curso: cancelar solo cancela y Revertir es un paso aparte', () => {
    it('con el backend nuevo (`cancelable: true`) el botón está habilitado y el diálogo lo dice; confirmar pide la cancelación', async () => {
        b = await armarDetalle(dtoC1({ tipo: 'ACCIONES', cancelable: true }));
        expect(btnCancelar()!.disabled).toBe(false);
        b.cancelar = (id) => { const c = dtoC1({ tipo: 'ACCIONES', cancelable: true, rev: 6, cancelacionPedidaAt: iso(Date.now()), canceladaPor: 'Maxi' }); b!.estados[id] = c; return { status: 200, body: { message: 'ok', efecto: 'PEDIDA', carga: c } }; };
        await clic(btnCancelar(), 'Cancelar importación');
        await esperar(() => !!dlg(), { que: 'el diálogo' });
        const t = cuerpoDlg();
        expect(t).toContain('Lleva 3.000 de 14.466 filas. Si la cancelás');
        expect(t).toContain('Lo que ya se aplicó queda aplicado. Después lo podés deshacer con Revertir desde el Historial: deshace exactamente lo que alcanzó a hacer.');
        // La línea genérica ("avisá a soporte") contradice a Revertir: no sale.
        expect(t).not.toContain('Antes de volver a cargar el archivo, avisá a soporte.');
        expect(t).not.toMatch(BASURA);
        // «Revertir» va en negrita, como el resto de los textos con énfasis.
        expect(Array.from(dlg()!.querySelectorAll('strong')).map((e) => e.textContent)).toContain('Revertir');
        expect(b.srv.cuantos('POST', CANCELAR)).toBe(0);
        await clic(boton('Cancelar importación', dlg()!), 'confirmar');
        await esperar(() => b!.srv.cuantos('POST', CANCELAR) === 1, { que: 'el POST de cancelar' });
        // Solo cancela: no pide revertir nada.
        expect(b.srv.cuantos('POST', /reversion$|revertir-acciones$/)).toBe(0);
    });

    it('las otras categorías conservan su línea', async () => {
        b = await armarDetalle(dtoC1({ tipo: 'PAGOS' }));
        await clic(btnCancelar(), 'Cancelar importación');
        await esperar(() => !!dlg(), { que: 'el diálogo' });
        expect(cuerpoDlg()).toContain('Antes de volver a cargar el archivo, avisá a soporte.');
        expect(cuerpoDlg()).not.toContain('Lo que ya se aplicó queda aplicado');
    });
});
