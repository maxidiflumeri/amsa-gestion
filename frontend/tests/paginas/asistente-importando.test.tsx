// ImportWizard real: vista previa (§9.8.4), y la carga de punta a punta (simple y dividida) con eventos de un socket.io real.
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BASURA, MOTIVO_INTERRUPCION, TXT, dtoC1, dtoFaseB, iso, terminal } from '../lib/fabricas';
import { enElSpec } from '../lib/spec';
import { alertas, boton, chips, clic, esperar, limpio, pasar } from '../lib/montar';
import { CORTES_3, armarBancoC1, filasDeCortes, hastaLaVistaPreviaDividida, hastaLosCortes, type BancoC1 } from '../lib/banco-asistente';
import { VALIDAR_OK, armarBanco, enColaDe, hastaElArchivo, hastaLaVistaPrevia, instalarAdaptador, usarGuion, type Banco } from '../lib/wizard';

let b: Banco | null = null;
let c1: BancoC1 | null = null;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false; instalarAdaptador(); });
afterAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { usarGuion(null); if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; if (c1) { await c1.v.desmontar(); await c1.srv.bajar(); } c1 = null; });

async function vistaPrevia(respuesta: Record<string, unknown>, divide = false) {
    b = await armarBanco({ divide });
    b.validar = () => ({ body: { ...VALIDAR_OK, ...respuesta } });
    if (divide) {
        b.crear = () => ({ body: { remesaIds: [141, 142, 143] } });
        await hastaElArchivo(b);
        await clic(boton('Ver los cortes del archivo'), 'Ver los cortes del archivo');
        await esperar(() => !!boton(/^Crear 3 remesa/), { que: 'el diálogo de cortes' });
        await clic(boton(/^Crear 3 remesa/), 'Crear 3 remesa(s)');
        await esperar(() => !!boton('Confirmar e importar'), { que: 'la vista previa' });
        await pasar(150);
    } else {
        await hastaLaVistaPrevia(b);
    }
    const todas = alertas(document.body).filter((a) => !/Se crearon 3 remesas/.test(a.texto));
    const r = { alertas: todas, confirmarDeshabilitado: boton('Confirmar e importar')!.disabled, texto: b.texto() };
    await b.v.desmontar(); await b.srv.bajar(); b = null;
    return r;
}

describe('vista previa', () => {
    const FILTRO = enElSpec('"El filtro de la plantilla descartó las {descartadasPorFiltro} filas."').slice(1, -1);
    const CORTE = enElSpec('"{fueraDeCorte} filas son de otros cortes de la división."').slice(1, -1);

    it('remesa con corte: las descartadas son descartadas − fueraDeCorte', async () => {
        const r = await vistaPrevia({ descartadas: 9700, fueraDeCorte: 9400, filtro: 'col 5 distinto de BAJA' }, true);
        expect(r.alertas).toEqual([{ severidad: 'info', texto: 'Se descartaron 300 filas que no cumplen el filtro de la plantilla (col 5 distinto de BAJA). No se importan y no cuentan como error.' }]);
        expect(r.confirmarDeshabilitado).toBe(false);
    });

    it('todo descartado por el filtro (total 0)', async () => {
        const r = await vistaPrevia({ total: 0, ok: 0, sample: [], descartadas: 9000, filtro: 'col 5 = A' });
        expect(r.alertas).toEqual([
            { severidad: 'info', texto: 'Se descartaron 9.000 filas que no cumplen el filtro de la plantilla (col 5 = A). No se importan y no cuentan como error.' },
            { severidad: 'warning', texto: 'El archivo no tiene filas para importar. ' + FILTRO.replace('{descartadasPorFiltro}', '9.000') },
        ]);
        expect(r.confirmarDeshabilitado).toBe(true);
    });

    // C2b (clasificación en FE-0): desde C1 la vista previa de una división valida todas las remesas y, si alguna no tiene filas, lo dice con UNA
    // alerta de error que nombra cada remesa (§10.8.2); la oración «El archivo no tiene filas para importar» es de la carga de una sola remesa.
    const sinFilasDe = (...porRemesa: string[]) => 'No se puede confirmar: las remesas 3081, 3082, 3083 no tienen filas para importar.' + ['3081', '3082', '3083'].map((n, i) => `Remesa ${n}: ${porRemesa[i] ?? porRemesa[0]}`).join('');

    it('todo de otros cortes (total 0): sin la alerta informativa, y la oración de los otros cortes', async () => {
        const r = await vistaPrevia({ total: 0, ok: 0, sample: [], descartadas: 9000, fueraDeCorte: 9000 }, true);
        expect(r.alertas).toEqual([{ severidad: 'error', texto: sinFilasDe(CORTE.replace('{fueraDeCorte}', '9.000')) }]);
        expect(r.confirmarDeshabilitado).toBe(true);
    });

    it('las dos cosas (total 0)', async () => {
        const r = await vistaPrevia({ total: 0, ok: 0, sample: [], descartadas: 9300, fueraDeCorte: 9000, filtro: 'col 5 = A' }, true);
        expect(r.alertas).toEqual([
            { severidad: 'error', texto: sinFilasDe(FILTRO.replace('{descartadasPorFiltro}', '300').replace(/^El/, 'el') + ' ' + CORTE.replace('{fueraDeCorte}', '9.000')) },
            { severidad: 'info', texto: 'Se descartaron 300 filas que no cumplen el filtro de la plantilla (col 5 = A). No se importan y no cuentan como error.' },
        ]);
        expect(r.confirmarDeshabilitado).toBe(true);
    });

    it('con filas y solo descartadas de otros cortes: ninguna alerta vacía', async () => {
        const r = await vistaPrevia({ descartadas: 9000, fueraDeCorte: 9000 }, true);
        expect(r.alertas).toEqual([]);
        expect(r.confirmarDeshabilitado).toBe(false);
    });

    it('sin descartadas, con fueraDeCorte null / 0 / ausente: nada, y sin «0» ni «null» sueltos', async () => {
        for (const extra of [{}, { fueraDeCorte: null }, { fueraDeCorte: 0, descartadas: 0 }, { descartadas: 0 }]) {
            const r = await vistaPrevia(extra);
            expect(r.alertas, JSON.stringify(extra)).toEqual([]);
            expect(r.texto, JSON.stringify(extra)).not.toMatch(BASURA);
        }
        const cero = await vistaPrevia({ total: 0, ok: 0, sample: [], fueraDeCorte: 0, descartadas: 0 });
        expect(cero.alertas).toEqual([{ severidad: 'warning', texto: 'El archivo no tiene filas para importar.' }]);
    });

    it('lista de archivos + descartadas solo de otros cortes: la lista sí, la oración del filtro no', async () => {
        const r = await vistaPrevia({ archivos: ['suc01.txt', 'suc02.txt'], descartadas: 500, fueraDeCorte: 500 }, true);
        expect(r.alertas.map((a) => a.texto)).toEqual(['2 archivos en una sola remesasuc01.txtsuc02.txt']);
    });

    it('respuesta de un backend de la Fase A (sin fueraDeCorte) en una división: el número total, como antes', async () => {
        const r = await vistaPrevia({ descartadas: 9700, filtro: 'col 5 distinto de BAJA Y col 3 EN 3081' }, true);
        expect(r.alertas[0].texto).toContain('Se descartaron 9.700 filas');
    });
});

describe('carga simple de punta a punta', () => {
    it('En cola con posición → Leyendo → Procesando con ritmo → Post-proceso con subfase → Resultado con casos', async () => {
        b = await armarBanco();
        b.estados[141] = dtoFaseB({ remesaId: 141, fase: 'BORRADOR', enCurso: false, estadoProceso: 'VALIDANDO', rev: 1, procesadas: 0, ok: 0, err: 0, progreso: 0 });
        await hastaLaVistaPrevia(b);
        b.ejecutar = (id) => { b!.estados[id] = enColaDe(id, { enColaDelante: 1, totalEsperado: 14_466 }); return { status: 201, body: { message: 'ok', remesaId: id, carga: b!.estados[id] } }; };
        await clic(boton('Confirmar e importar'), 'Confirmar e importar');
        const pantallas: string[] = [];
        const ver = async (re: RegExp, que: string) => { await esperar(() => re.test(b!.texto()), { que }); await pasar(60); pantallas.push(`${que}: ${JSON.stringify(chips(b!.v.contenedor))} | ${b!.texto().replace(/^.*Ejecutando importación/, '')}`); };
        const pub = (evento: string, dto: any) => { b!.estados[141] = dto; b!.srv.emitir(evento, dto); };
        await ver(/En colaHay 1 importación antes que esta\./, 'en cola');
        // La de adelante terminó: un evento ajeno refresca la posición.
        b.estados[141] = enColaDe(141, { enColaDelante: 0, totalEsperado: 14_466 });
        b.srv.emitir('import:finalizada', terminal('OK', { remesaId: 900, rev: 77 }));
        await ver(/En colaEs la próxima: empieza en instantes\./, 'es la próxima');
        const base = { remesaId: 141, totalEsperado: 14_466, startedAt: iso(Date.now()), heartbeatAt: iso(Date.now()), servidorAhora: iso(Date.now()) };
        pub('import:iniciada', dtoFaseB({ ...base, rev: 3, procesadas: 0, ok: 0, err: 0, progreso: 0 }));
        pub('import:progreso', dtoFaseB({ ...base, rev: 4, fase: 'LEYENDO', procesadas: 0, ok: 0, err: 0, progreso: 0 }));
        await ver(/Leyendo el archivoTodavía no se procesó ninguna fila\./, 'leyendo');
        pub('import:progreso', dtoFaseB({ ...base, rev: 5, procesadas: 3000, ok: 2990, err: 10, progreso: 20, velocidad: 33.3, etaSegundos: 344, nuevos: 1200, actualizados: 1790, descartadas: 40 }));
        await ver(/≈ 33,3 filas\/s · faltan ~6 min para terminar las filasProcesando/, 'procesando');
        pub('import:progreso', dtoFaseB({ ...base, rev: 6, fase: 'POST_PROCESO', subfase: 'Consolidando casos: 1.500 de 8.875', procesadas: 14_466, ok: 14_400, err: 66, progreso: 99, nuevos: 9000, actualizados: 5400, descartadas: 120 }));
        await ver(/Post-procesoConsolidando casos: 1\.500 de 8\.875/, 'post-proceso');
        pub('import:finalizada', terminal('CON_ERRORES', { ...base, rev: 7, procesadas: 14_466, ok: 14_400, err: 66, nuevos: 9000, actualizados: 5400, descartadas: 120 }));
        await esperar(() => /Resultado de la importación/.test(b!.texto()), { que: 'el resultado' });
        await pasar(100);
        const fin = b.texto().replace(/^.*Resultado de la importación/, '');
        expect(pantallas.join('\n')).not.toMatch(BASURA);
        expect(pantallas[2]).not.toMatch(/\d+%/);
        expect(pantallas[3]).toContain('["Total: 14.466","Procesadas: 3.000","OK: 2.990","Errores: 10","Descartadas: 40","Nuevos: 1.200","Actualizados: 1.790"]');
        expect(pantallas[4]).not.toMatch(/filas\/s|99%/);
        expect(fin).toContain('Importación finalizada con filas con error66 de 14.466 filas no se cargaron.');
        expect(fin).toContain('14.466Filas procesadas14.400Exitosas66Con error120Descartadas9.000Casos nuevos5.400Casos actualizados');
        expect(fin).not.toMatch(BASURA);
        expect(b.srv.cuantos('POST', /ejecutar/)).toBe(1);
    });

    it('con total 0 el botón «Confirmar e importar» sigue deshabilitado y no dispara nada', async () => {
        b = await armarBanco();
        b.validar = () => ({ body: { total: 0, ok: 0, err: 0, sample: [], descartadas: 9000, fueraDeCorte: 9000 } });
        await hastaLaVistaPrevia(b);
        const btn = boton('Confirmar e importar')!;
        expect(btn.disabled).toBe(true);
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await pasar(300);
        expect(b.srv.cuantos('POST', /ejecutar/)).toBe(0);
        expect(b.texto()).toContain('El archivo no tiene filas para importar. 9.000 filas son de otros cortes de la división.');
    });
});

describe('carga dividida de punta a punta', () => {
    // C2b (clasificación en FE-0): estas dos pruebas son de la Fase B y confirmaban las N remesas con N pedidos `ejecutar/:id`.
    // Desde C1 (§10.8.2) la división se confirma con un solo `ejecutar-grupo` y la pantalla sigue al grupo; se portan a ese flujo
    // con las mismas afirmaciones sobre los contadores y el resumen.
    async function dividida(resultadoDe: (id: number) => any) {
        const bc = await armarBancoC1();
        c1 = bc;
        bc.validar = () => ({ body: { ...VALIDAR_OK, descartadas: 9300, fueraDeCorte: 9000, filtro: 'col 5 = A' } });
        await hastaLaVistaPreviaDividida(bc);
        await clic(boton('Confirmar e importar'), 'Confirmar e importar');
        const enImportando: string[] = [];
        const otrosCortes: Record<number, number> = { 141: 7000, 142: 8000, 143: 9000 };
        for (const [i, id] of [141, 142, 143].entries()) {
            await esperar(() => new RegExp(`Carga dividida: remesa ${i + 1} de 3`).test(bc.texto()), { que: `la remesa ${i + 1} en curso` });
            const delGrupo = { grupoId: bc.estados[id].grupoId, grupoOrden: i + 1, grupoTotal: 3, numeroRemesa: bc.estados[id].numeroRemesa };
            const dto = dtoC1({ ...delGrupo, remesaId: id, rev: 5, totalEsperado: 5000, procesadas: 2000, ok: 2000, err: 0, progreso: 40, descartadas: 300 + otrosCortes[id], fueraDeCorte: otrosCortes[id], velocidad: 50, etaSegundos: 60, nuevos: 2000, actualizados: 0, heartbeatAt: iso(Date.now()), servidorAhora: iso(Date.now()) });
            bc.pub('import:progreso', dto);
            await esperar(() => chips(bc.v.contenedor).some((c) => c === 'Procesadas: 2.000'), { que: `la remesa ${i + 1} procesando` });
            await pasar(60);
            enImportando.push(`remesa ${i + 1}: ${JSON.stringify(chips(bc.v.contenedor).filter((c) => !/^(Finalizada|Fallida|En cola|Procesando)/.test(c)))}`);
            bc.pub('import:finalizada', { ...resultadoDe(id), ...delGrupo });
        }
        await esperar(() => /Resultado de la importación/.test(bc.texto()), { que: 'el resultado' });
        await pasar(100);
        return { enImportando, fin: bc.texto().replace(/^.*Resultado de la importación/, '') };
    }
    const ok = (id: number, otros: number) => terminal('OK', { remesaId: id, rev: 9, procesadas: 5000, ok: 5000, err: 0, descartadas: 300 + otros, fueraDeCorte: otros, nuevos: 5000, actualizados: 0 });

    it('MB-8: «Descartadas» con el mismo número en las tres remesas; en el resultado, una sola vez', async () => {
        const r = await dividida((id) => ok(id, { 141: 7000, 142: 8000, 143: 9000 }[id]!));
        for (const linea of r.enImportando) expect(linea).toContain('"Descartadas: 300"');
        expect(r.fin).toContain('15.000Filas procesadas15.000Exitosas300Descartadas15.000Casos nuevos0Casos actualizados');
        expect(r.fin).toContain('Importación exitosa');
        expect(r.fin).not.toMatch(BASURA);
        expect(c1!.srv.cuantos('POST', /validar\/14[23]/)).toBe(2);
        expect(c1!.srv.cuantos('POST', /ejecutar-grupo/)).toBe(1);
    });

    it('la segunda remesa la cierra el reaper (FALLIDA por interrupción): sigue con la tercera y el resumen lo cuenta', async () => {
        const r = await dividida((id) => id === 142
            ? terminal('FALLIDA', { remesaId: 142, rev: 9, procesadas: 2000, ok: 2000, err: 0, descartadas: 3100, fueraDeCorte: 3000, nuevos: 2000, actualizados: 0, error: MOTIVO_INTERRUPCION })
            : ok(id, id === 141 ? 7000 : 9000));
        expect(r.fin.startsWith('La importación falló' + MOTIVO_INTERRUPCION + ' ' + TXT.antesDelCorte('2.000'))).toBe(true);
        expect(r.fin).not.toMatch(/Tasa de éxito/);
        expect(r.fin).toContain('Remesa 3082La importación falló2.000 procesadas · 2.000 OK · 0 con error · 100 descartadas');
        expect(c1!.srv.cuantos('POST', /ejecutar-grupo/)).toBe(1);
        expect(c1!.srv.cuantos('POST', /ejecutar\/\d+/)).toBe(0);
        expect(r.fin).not.toMatch(BASURA);
    });
});

// ─── C2b: el paso «Importando» con la tarjeta única (TW-1 a TW-8, docs/imports-progreso-c2-spec.md §16.9) ───
describe('C2b — la tarjeta en el paso «Importando»', () => {
    const procesando = (id: number, over: Record<string, unknown> = {}) => dtoC1({ ...c1!.estados[id], fase: 'PROCESANDO', estadoProceso: 'PROCESANDO', rev: 10, procesadas: 2000, ok: 2000, err: 0, progreso: 40, startedAt: iso(Date.now()), heartbeatAt: iso(Date.now()), servidorAhora: iso(Date.now()), enColaDelante: null, cancelable: true, ...over });
    const unaSola = async () => {
        c1 = await armarBancoC1();
        await hastaLosCortes(c1);
        await clic(filasDeCortes()[1].check, 'destildar'); await clic(filasDeCortes()[2].check, 'destildar');
        await clic(boton(/^Crear 1 remesa/), 'Crear 1');
        await esperar(() => !!boton('Confirmar e importar'), { que: 'la vista previa' });
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => /Ejecutando importación/.test(c1!.texto()) && c1!.srv.cuantos('POST', /ejecutar\/141/) === 1, { que: 'importando' });
        await pasar(150);
    };
    const division = async () => {
        c1 = await armarBancoC1();
        await hastaLaVistaPreviaDividida(c1);
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => /Carga dividida: remesa 1 de 3/.test(c1!.texto()), { que: 'la división' });
        await pasar(150);
    };
    /** Una carga terminada de esa remesa, con lo que el servidor ya tenía (el grupo) y el estado terminal AL FINAL: lo que se pasa pisa los valores por defecto de `terminal`. */
    const fin = (id: number, resultado: string, over: Record<string, unknown> = {}) =>
        terminal(resultado, { ...c1!.estados[id], fase: 'TERMINADA', enCurso: false, terminal: true, resultado, estadoProceso: resultado === 'FALLIDA' ? 'FALLIDA' : 'FINALIZADA', cancelable: false, rev: 20, progreso: 100, ...over });
    const resultados = () => (c1!.texto().match(/Resultado de la importación/g) ?? []).length;

    it('TW-1 — carga simple: tres `import:finalizada` repetidos llevan a «Resultado» una sola vez', async () => {
        await unaSola();
        const final = fin(141, 'OK', { procesadas: 5000, ok: 5000, err: 0 });
        c1!.pub('import:finalizada', final); c1!.pub('import:finalizada', final); c1!.pub('import:finalizada', final);
        await esperar(() => /Resultado de la importación/.test(c1!.texto()), { que: 'resultado' });
        await pasar(400);
        expect(resultados()).toBe(1);
        expect((c1!.texto().match(/Filas procesadas/g) ?? []).length).toBe(1);
    });

    it('TW-2 — la `carga` del POST de ejecutar siembra el estado: se ve la cola sin esperar un evento', async () => {
        await unaSola();
        expect(c1!.texto()).toContain('Ejecutando importación');
        expect(c1!.texto()).toMatch(/En cola/);
        expect(c1!.texto()).not.toContain('Enviando a la cola…');
    });

    it('TW-3 — la remesa se borró: la alerta de «no se pudo seguir» sale una vez y la tarjeta no se dibuja', async () => {
        c1 = await armarBancoC1();
        const ejecutarBueno = c1.ejecutar;
        c1.ejecutar = async (id, cuerpo) => { const r = await ejecutarBueno(id, cuerpo); delete c1!.estados[id]; return r; };
        await hastaLosCortes(c1);
        await clic(filasDeCortes()[1].check, 'destildar'); await clic(filasDeCortes()[2].check, 'destildar');
        await clic(boton(/^Crear 1 remesa/), 'Crear 1');
        await esperar(() => !!boton('Confirmar e importar'), { que: 'la vista previa' });
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => alertas(c1!.v.contenedor).some((a) => /No se pudo seguir la importación/.test(a.texto)), { ms: 8000, que: 'la alerta' });
        await pasar(300);
        expect(alertas(c1.v.contenedor).filter((a) => /No se pudo seguir la importación/.test(a.texto))).toHaveLength(1);
        expect(c1.v.contenedor.querySelector('.MuiLinearProgress-root')).toBeNull();
        expect(c1.texto()).not.toContain('Enviando a la cola…');
    });

    it('TW-5 — división: un `import:progreso` de la remesa actual mueve la barra y el porcentaje', async () => {
        await division();
        c1!.pub('import:progreso', procesando(141, { rev: 10, progreso: 43, procesadas: 2150, ok: 2150 }));
        await esperar(() => /Procesadas: 2\.150/.test(c1!.texto()), { ms: 3000, que: 'el contador' });
        expect(c1!.texto()).toContain('43%');
        const filas = Array.from(c1!.v.contenedor.querySelectorAll('[aria-label="Remesa 3081"]')) as HTMLElement[];
        expect(filas[0].getAttribute('aria-valuenow')).toBe('43');
        expect(c1!.texto()).toContain('Remesas terminadas: 0 de 3');
    });

    it('TW-6 — la lista de la división dice «Fallida» (no «Falló») y «Finalizada con errores»', async () => {
        await division();
        c1!.pub('import:finalizada', fin(141, 'FALLIDA', { startedAt: iso(Date.now()), error: 'La plantilla no tiene estado inicial.', procesadas: 1000, ok: 1000, err: 0 }));
        c1!.pub('import:finalizada', fin(142, 'CON_ERRORES', { procesadas: 4000, ok: 3990, err: 10 }));
        await esperar(() => /Remesas terminadas: 2 de 3/.test(c1!.texto()), { ms: 3000, que: 'dos terminadas' });
        const etiquetas = chips(c1!.v.contenedor);
        expect(etiquetas).toContain('Fallida');
        expect(etiquetas).toContain('Finalizada con errores');
        expect(c1!.texto()).not.toContain('Falló');
    });

    it('TW-8 — cosméticos: «muestra de 1 fila de 5.000», «Se detectó 1 fila con errores»', async () => {
        b = await armarBanco();
        b.validar = () => ({ body: { ...VALIDAR_OK, err: 1 } });
        await hastaLaVistaPrevia(b);
        expect(b.texto()).toContain('Vista previa (muestra de 1 fila de 5.000)');
        expect(b.texto()).toContain('Se detectó 1 fila con errores. Podés continuar con la importación — la fila con error será omitida y quedará registrada para su revisión.');
        expect(b.texto()).not.toMatch(/1 filas/);
    });

    it('TW-8 — cosméticos: con más de una, el plural y el punto de miles', async () => {
        b = await armarBanco();
        b.validar = () => ({ body: { ...VALIDAR_OK, err: 1204, sample: [VALIDAR_OK.sample[0], VALIDAR_OK.sample[0]] } });
        await hastaLaVistaPrevia(b);
        expect(b.texto()).toContain('Vista previa (muestra de 2 filas de 5.000)');
        expect(b.texto()).toContain('Se detectaron 1.204 filas con errores. Podés continuar con la importación — las filas con error serán omitidas y quedarán registradas para su revisión.');
    });

    it('TW-8 — cosméticos: «(1 caso)» en la vista de cortes y las oraciones singulares de un corte sin filas', async () => {
        c1 = await armarBancoC1();
        c1.cortes = () => {
            const c = CORTES_3() as Array<Record<string, unknown>>;
            c[1].yaCargado = { remesaId: 900, numeroRemesa: '2902', situacion: 'CARGADA', casos: 1, retomable: false };
            return c;
        };
        await hastaLosCortes(c1);
        const dialogoCortes = limpio(document.body.textContent ?? '');
        expect(dialogoCortes).toContain('Ya está cargado en la remesa 2902 (1 caso)');
        expect(dialogoCortes).not.toContain('(1 casos)');
    });

    it('TW-8 — cosméticos: un corte sin filas con 1 descartada y 1 de otro corte', async () => {
        c1 = await armarBancoC1();
        c1.validar = () => ({ body: { ...VALIDAR_OK, total: 0, ok: 0, sample: [], descartadas: 2, fueraDeCorte: 1 } });
        await hastaLaVistaPreviaDividida(c1);
        const texto = c1.texto();
        expect(texto).toContain('Remesa 3081: el filtro de la plantilla descartó la única fila. 1 fila es de otro corte de la división.');
        // (La alerta «Se descartaron 1 filas…» de la vista previa no figura en §16.7: queda como deuda.)
        expect(texto).not.toMatch(/las 1 filas|Remesa 3081:[^.]*\b1 filas son/);
    });
});
