// C1 — lo que la pantalla le dice al operador: cancelar desde el asistente, resumen de una división con mezcla,
// campanita, y un DTO de la Fase B (sin los ocho campos nuevos) en cada pantalla.
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import ImportSummary from '@fe/components/import/ImportSummary';
import ImportProgress from '@fe/components/import/ImportProgress';
import { BASURA, MOTIVO_CON_SALTO, TXT_CANCELADA_DEUDORES, TXT_CANCELADA_SIN_ARRANCAR, canceladaC1, dtoC1, dtoFaseA, dtoFaseB, enColaC1, iso, terminal, terminalC1 } from '../lib/fabricas';
import { ServidorFalso } from '../lib/servidor-falso';
import { alertas, boton, chips, clic, dialogo, dobleClic, esperar, iniciarSesion, limpio, montar, pasar, toasts, type Montado } from '../lib/montar';
import { instalarAdaptador, usarGuion } from '../lib/wizard';
import { armarBancoC1, filasDeCortes, hastaLaVistaPreviaDividida, hastaLosCortes, type BancoC1 } from '../lib/banco-asistente';
import { armarDetalle } from '../lib/banco-detalle';

const dlg = () => dialogo(/^Cancelar importación$/);

describe('cancelar desde el paso «Importando» del asistente', () => {
    let b: BancoC1 | null = null;
    beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false; instalarAdaptador(); });
    afterAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
    afterEach(async () => { usarGuion(null); if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });
    const enResultado = () => /Resultado de la importación/.test(b!.texto());
    const fin = () => b!.texto().replace(/^.*Resultado de la importación/, '');
    const de = (id: number) => b!.estados[id];
    const procesando = (id: number, over: Record<string, unknown> = {}) => dtoC1({ ...de(id), fase: 'PROCESANDO', estadoProceso: 'PROCESANDO', rev: de(id).rev + 1, procesadas: 3000, ok: 2990, err: 10, progreso: 60, startedAt: iso(Date.now() - 3000), heartbeatAt: iso(Date.now()), servidorAhora: iso(Date.now()), enColaDelante: null, cancelable: true, ...over });
    const cancelada = (id: number, over: Record<string, unknown> = {}) => canceladaC1({ ...de(id), resultado: 'FALLIDA', cancelada: true, canceladaPor: 'Maxi', fase: 'TERMINADA', estadoProceso: 'FALLIDA', enCurso: false, terminal: true, cancelable: false, retomable: false, rev: de(id).rev + 5, procesadas: 3000, ok: 2990, err: 10, progreso: 60, error: TXT_CANCELADA_DEUDORES, finishedAt: iso(Date.now()), ...over });
    const ok = (id: number, over: Record<string, unknown> = {}) => terminalC1('OK', { ...de(id), resultado: 'OK', fase: 'TERMINADA', estadoProceso: 'FINALIZADA', enCurso: false, terminal: true, cancelable: false, retomable: false, rev: de(id).rev + 5, procesadas: 5000, ok: 5000, err: 0, progreso: 100, error: null, startedAt: iso(Date.now() - 5000), finishedAt: iso(Date.now()), ...over });

    async function unaSola() {
        b = await armarBancoC1();
        await hastaLosCortes(b);
        await clic(filasDeCortes()[1].check, 'destildar'); await clic(filasDeCortes()[2].check, 'destildar');
        await clic(boton(/^Crear 1 remesa/), 'Crear 1');
        await esperar(() => !!boton('Confirmar e importar'), { que: 'la vista previa' });
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => /Ejecutando importación/.test(b!.texto()) && b!.srv.cuantos('POST', /ejecutar\/141/) === 1 && !!boton('Cancelar importación', b!.v.contenedor), { que: 'importando, con el botón' });
        await pasar(150);
    }
    async function pedirCancelar(etiqueta = 'Cancelar importación') {
        await clic(boton('Cancelar importación', b!.v.contenedor), 'Cancelar importación');
        await esperar(() => !!dlg() && !!boton(etiqueta, dlg()!) && !boton(etiqueta, dlg()!)!.disabled, { que: 'el diálogo listo' });
        await dobleClic(boton(etiqueta, dlg()!), etiqueta);
    }

    it('una remesa en cola: se cancela en el acto → «Resultado» dice «Importación cancelada» y ofrece Retomar; nunca «exitosa»', async () => {
        await unaSola();
        b!.cancelar = (id) => { const c = cancelada(id, { startedAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, error: TXT_CANCELADA_SIN_ARRANCAR, retomable: true }); b!.estados[id] = c; return { status: 200, body: { message: 'ok', efecto: 'CANCELADA', carga: c } }; };
        await pedirCancelar();
        await esperar(enResultado, { que: 'resultado' });
        await pasar(200);
        expect(fin().startsWith('Importación cancelada' + TXT_CANCELADA_SIN_ARRANCAR.replace(/\n\n/g, ' '))).toBe(true);
        expect(fin()).not.toMatch(/Importación exitosa|Importación finalizada|Tasa de éxito|La importación falló/);
        expect(!!boton('Retomar')).toBe(true);
        expect(b!.srv.cuantos('POST', /cancelar/)).toBe(1);
        expect(fin()).not.toMatch(BASURA);
    });

    it('una remesa procesando: queda pedida, se ve el aviso; cuando el runner corta → «Importación cancelada» con el número exacto, sin tasa de éxito y sin Retomar', async () => {
        await unaSola();
        b!.pub('import:progreso', procesando(141));
        await esperar(() => chips(b!.v.contenedor).includes('Procesadas: 3.000'), { que: 'procesando' });
        b!.cancelar = (id) => { const c = procesando(id, { cancelacionPedidaAt: iso(Date.now()), canceladaPor: 'Maxi', cancelable: false }); b!.estados[id] = c; return { status: 200, body: { message: 'ok', efecto: 'PEDIDA', carga: c } }; };
        await pedirCancelar();
        await esperar(() => alertas(b!.v.contenedor).some((a) => /Se pidió cancelar/.test(a.texto)), { que: 'el aviso' });
        await pasar(150);
        expect(enResultado()).toBe(false);
        expect(boton('Cancelar importación', b!.v.contenedor)!.disabled).toBe(true);
        b!.pub('import:finalizada', cancelada(141));
        await esperar(enResultado, { ms: 3000, que: 'resultado' });
        await pasar(200);
        expect(fin().startsWith('Importación cancelada' + TXT_CANCELADA_DEUDORES.replace(/\n\n/g, ' '))).toBe(true);
        expect(fin()).toContain('3.000Filas procesadas2.990Exitosas10Con error');
        expect(fin()).not.toMatch(/Importación exitosa|Importación finalizada|Tasa de éxito|Antes del corte se cargaron al menos/);
        expect(boton('Retomar')).toBeNull();
        expect(b!.srv.cuantos('POST', /cancelar/)).toBe(1);
    });

    it('el pedido llegó tarde y la carga terminó BIEN: qué dice «Resultado» del asistente', async () => {
        await unaSola();
        b!.pub('import:progreso', procesando(141, { procesadas: 4990, ok: 4990, err: 0, progreso: 99 }));
        await esperar(() => chips(b!.v.contenedor).includes('Procesadas: 4.990'), { que: 'procesando' });
        b!.cancelar = (id) => { const c = procesando(id, { procesadas: 4990, ok: 4990, err: 0, progreso: 99, cancelacionPedidaAt: iso(Date.now()), canceladaPor: 'Maxi', cancelable: false }); b!.estados[id] = c; return { status: 200, body: { message: 'ok', efecto: 'PEDIDA', carga: c } }; };
        await pedirCancelar();
        await esperar(() => alertas(b!.v.contenedor).some((a) => /Se pidió cancelar/.test(a.texto)), { que: 'el aviso' });
        b!.pub('import:finalizada', ok(141, { cancelacionPedidaAt: de(141).cancelacionPedidaAt, canceladaPor: 'Maxi' }));
        await esperar(enResultado, { ms: 3000, que: 'resultado' });
        await pasar(200);
        const menciona = /cancel/i.test(fin());
        // Segunda pasada (hallazgo 8): el Resultado del asistente también lo dice.
        expect(fin().startsWith('Importación exitosaSe pidió cancelar esta importación cuando ya estaba cerrando: terminó completa.')).toBe(true);
        expect(menciona).toBe(true);
    });

    it('división: «Cancelar todo lo que falta» desde «Importando» → un pedido al grupo, la lista se refresca y el resumen cuenta cada remesa', async () => {
        b = await armarBancoC1();
        await hastaLaVistaPreviaDividida(b);
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => /Carga dividida: remesa 1 de 3/.test(b!.texto()), { que: 'grupo' });
        b.pub('import:finalizada', ok(141));
        b.pub('import:progreso', procesando(142));
        await esperar(() => /Carga dividida: remesa 2 de 3/.test(b!.texto()) && chips(b!.v.contenedor).includes('Procesadas: 3.000'), { que: 'la segunda procesando' });
        const g0 = b.srv.cuantos('GET', /grupos/);
        b.cancelarGrupo = () => {
            const c142 = procesando(142, { cancelacionPedidaAt: iso(Date.now()), canceladaPor: 'Maxi', cancelable: false }); b!.estados[142] = c142;
            const c143 = cancelada(143, { startedAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, error: TXT_CANCELADA_SIN_ARRANCAR, retomable: true }); b!.estados[143] = c143;
            return { status: 200, body: { resultados: [{ remesaId: 143, numeroRemesa: '3083', efecto: 'CANCELADA', carga: c143 }, { remesaId: 142, numeroRemesa: '3082', efecto: 'PEDIDA', carga: c142 }, { remesaId: 141, numeroRemesa: '3081', efecto: 'YA_TERMINADA', carga: de(141) }] } };
        };
        await clic(boton('Cancelar importación', b.v.contenedor), 'Cancelar importación');
        await esperar(() => !!boton('Cancelar todo lo que falta', dlg() ?? undefined), { que: 'las dos opciones' });
        await dobleClic(boton('Cancelar todo lo que falta', dlg()!), 'Cancelar todo lo que falta');
        await esperar(() => !dlg() && chips(b!.v.contenedor).includes('Cancelada antes de empezar'), { ms: 4000, que: 'la lista refrescada' });
        await pasar(200);
        const lista = chips(b.v.contenedor).filter((c) => /En cola|Finalizada|Cancelada|Procesando|Cancelando/.test(c));
        expect(b.srv.cuantos('POST', /grupos\/[^/]+\/cancelar/)).toBe(1);
        expect(b.srv.cuantos('POST', /remesas\/\d+\/cancelar/)).toBe(0);
        expect(lista).toEqual(['Finalizada', 'Cancelando…', 'Cancelada antes de empezar']);
        expect(alertas(b.v.contenedor).some((a) => /Se pidió cancelar/.test(a.texto))).toBe(true);
        expect(enResultado()).toBe(false);
        b.pub('import:finalizada', cancelada(142));
        await esperar(enResultado, { ms: 3000, que: 'resultado' });
        await pasar(200);
        expect(fin()).toContain('Remesa 3082Importación cancelada3.000 procesadas · 2.990 OK · 10 con error');
        expect(fin()).toContain('Remesa 3083Importación canceladaSe puede retomar0 procesadas');
        expect(!!boton('Retomar la que no se cargó')).toBe(true);
    });
});

describe('ImportSummary: división con mezcla de todo', () => {
    let v: Montado | null = null;
    afterEach(async () => { if (v) await v.desmontar(); v = null; });
    const g = { grupoId: 'g', grupoTotal: 7 };
    const texto = () => limpio(document.body.textContent ?? '').replace('Resultado de la importación', '');

    it('OK + interrumpida a medias + cancelada a medias + cancelada sin empezar (retomable) + no llegó a empezar (retomable) + 1 eliminada + 1 no encolada', async () => {
        const resultados = [
            terminalC1('OK', { remesaId: 1, numeroRemesa: '3081', ...g, grupoOrden: 1, procesadas: 5000, ok: 5000, err: 0 }),
            terminalC1('FALLIDA', { remesaId: 2, numeroRemesa: '3082', ...g, grupoOrden: 2, procesadas: 2000, ok: 1990, err: 10, error: MOTIVO_CON_SALTO }),
            canceladaC1({ remesaId: 3, numeroRemesa: '3083', ...g, grupoOrden: 3 }),
            canceladaC1({ remesaId: 4, numeroRemesa: '3084', ...g, grupoOrden: 4, startedAt: null, procesadas: 0, ok: 0, err: 0, error: TXT_CANCELADA_SIN_ARRANCAR, retomable: true }),
            terminalC1('FALLIDA', { remesaId: 5, numeroRemesa: '3085', ...g, grupoOrden: 5, startedAt: null, procesadas: 0, ok: 0, err: 0, error: 'La importación no llegó a empezar.\n\nNo se cargó ninguna fila. Para cargarla, usá «Retomar» en el detalle de la importación: no hace falta volver a subir el archivo.', retomable: true }),
        ];
        let retomar = 0; let faltantes = 0;
        v = await montar(<ImportSummary resultados={resultados} dividida eliminadas={1} noEncoladas={[{ remesaId: 7, numeroRemesa: '3087' }]} onRetomar={() => { retomar++; }} onCargarFaltantes={() => { faltantes++; }} onNewImport={() => {}} />);
        const t = texto();
        expect(t.startsWith('La importación falló')).toBe(true);
        expect(t).toContain('La importación quedó incompleta');
        expect(t).toContain('1 remesa de esta división se eliminó.');
        expect(t).toContain('1 remesa no se pudo encolar y quedó sin confirmar');
        expect(t).not.toMatch(/Tasa de éxito|Importación finalizada/);
        expect(t.startsWith('Importación exitosa')).toBe(false);
        expect(t).toContain('Remesa 3083Importación cancelada3.000 procesadas');
        expect(t).toContain('Remesa 3084Importación canceladaSe puede retomar0 procesadas');
        expect(t).toContain('Remesa 3085La importación fallóSe puede retomar0 procesadas');
        expect(!!boton('Retomar las 2 que no se cargaron')).toBe(true);
        expect(!!boton('Cargar las que faltan')).toBe(true);
        expect(t).not.toMatch(BASURA);
        await clic(boton('Retomar las 2 que no se cargaron')); await clic(boton('Cargar las que faltan'));
        expect({ retomar, faltantes }).toEqual({ retomar: 1, faltantes: 1 });
    });

    it('`ocupado`: los dos botones quedan deshabilitados', async () => {
        const r = [canceladaC1({ remesaId: 4, startedAt: null, retomable: true }), terminalC1('OK', { remesaId: 1 })];
        v = await montar(<ImportSummary resultados={r} dividida ocupado noEncoladas={[{ remesaId: 7, numeroRemesa: '3087' }]} onRetomar={() => {}} onCargarFaltantes={() => {}} onNewImport={() => {}} />);
        expect(boton('Retomar la que no se cargó')!.disabled).toBe(true);
        expect(boton('Cargar las que faltan')!.disabled).toBe(true);
    });

    it('división en la que solo queda UNA remesa en el resumen (las otras, no encoladas): título y cartel', async () => {
        v = await montar(<ImportSummary resultados={[terminalC1('OK', { remesaId: 1, numeroRemesa: '3081', procesadas: 5000, ok: 5000, err: 0 })]} dividida noEncoladas={[{ remesaId: 2, numeroRemesa: '3082' }, { remesaId: 3, numeroRemesa: '3083' }]} onCargarFaltantes={() => {}} onNewImport={() => {}} />);
        const t = texto();
        // Segunda pasada (hallazgo 3): con remesas sin encolar el título no es de éxito.
        expect(t.startsWith('La importación quedó incompletaHay remesas que no se pudieron encolar y quedaron sin confirmar.')).toBe(true);
        expect(!!document.querySelector('[data-testid="CheckCircleIcon"]')).toBe(false);
    });

    it('DTO de la Fase B (sin campos nuevos): ni «Retomar», ni «Se puede retomar», ni «cancelada»; aunque se pase onRetomar', async () => {
        const r = [terminal('FALLIDA', { remesaId: 1, numeroRemesa: '3081', error: 'x', startedAt: null, procesadas: 0, ok: 0, err: 0 }), terminal('OK', { remesaId: 2, numeroRemesa: '3082' }), terminal('OK', { remesaId: 3, numeroRemesa: '3083' }, dtoFaseA)];
        v = await montar(<ImportSummary resultados={r} dividida onRetomar={() => {}} onCargarFaltantes={() => {}} onNewImport={() => {}} />);
        const t = texto();
        expect(boton(/Retomar/)).toBeNull();
        expect(boton('Cargar las que faltan')).toBeNull();
        expect(t).not.toMatch(/retomar|cancelad|eliminó|encolar/i);
        expect(t).toContain('La importación quedó incompleta');
        expect(t).not.toMatch(BASURA);
    });
});

describe('DTO de la Fase B en el paso «Importando» y en el detalle', () => {
    it('ImportProgress con un DTO de la Fase B en cada fase: sin botón de cancelar, sin avisos nuevos, sin basura', async () => {
        const srv = await new ServidorFalso().levantar();
        let actual: any; srv.en('GET', /^\/import\/remesas\/141\/progreso$/, () => ({ body: actual }));
        iniciarSesion(['importacion.ver_historial', 'importacion.ejecutar', 'importacion.ver_progreso_otros']);
        const visto: Record<string, string> = {};
        for (const fase of ['EN_COLA', 'LEYENDO', 'PROCESANDO', 'POST_PROCESO']) {
            actual = dtoFaseB({ fase });
            const v = await montar(<ImportProgress remesaId={141} />, { conSocket: true });
            await esperar(() => srv.sockets.size === 1 && chips().length > 0, { que: 'dibujado' });
            await pasar(150);
            visto[fase] = `botones: ${Array.from(document.querySelectorAll('button')).map((x) => limpio(x.textContent ?? '')).join('/') || '(ninguno)'} | alertas: ${JSON.stringify(alertas())}`;
            expect(boton('Cancelar importación'), fase).toBeNull();
            expect(v.texto(), fase).not.toMatch(BASURA);
            expect(v.texto(), fase).not.toMatch(/cancel|retom/i);
            await v.desmontar();
            await esperar(() => srv.sockets.size === 0, { que: 'socket cerrado' });
        }
        await srv.bajar();
    });

    it('detalle con DTO de la Fase B (en curso, fallida en cero, OK): sin línea de grupo, sin Cancelar, sin Retomar, sin «Cancelada»', async () => {
        const casos: Array<[string, any]> = [
            ['en curso', dtoFaseB()], ['en cola', dtoFaseB({ fase: 'EN_COLA', startedAt: null, heartbeatAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, enColaDelante: 0 })],
            ['fallida sin arrancar', terminal('FALLIDA', { error: 'La importación no llegó a empezar.', startedAt: null, procesadas: 0, ok: 0, err: 0 })],
            ['OK', terminal('OK')], ['Fase A en curso', dtoFaseA()],
        ];
        const visto: Record<string, string> = {};
        for (const [nombre, dto] of casos) {
            const bb = await armarDetalle(dto, { permisos: ['importacion.ver_historial', 'importacion.ejecutar', 'importacion.ver_progreso_otros'] });
            const t = bb.texto();
            visto[nombre] = `botones: ${Array.from(bb.v.contenedor.querySelectorAll('button')).map((x) => limpio(x.textContent ?? '')).filter(Boolean).join('/')} | GET grupos: ${bb.srv.cuantos('GET', /grupos/)}`;
            expect(t, nombre).not.toMatch(BASURA);
            expect(t, nombre).not.toMatch(/carga dividida|Cancelada|Retomar|Cancelar importación|terminó completa/);
            expect(bb.srv.cuantos('GET', /grupos/), nombre).toBe(0);
            await bb.v.desmontar(); await bb.srv.bajar();
        }
    });
});
