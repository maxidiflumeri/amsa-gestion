// C1 — vista previa de todos los cortes y confirmación por grupo (§10.8.2, §10.8.3). ImportWizard real.
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BASURA, dtoC1, enColaC1, iso, terminalC1, canceladaC1, TXT_CANCELADA_SIN_ARRANCAR } from '../lib/fabricas';
import { enElSpec10 } from '../lib/spec';
import { alertas, boton, chips, clic, dobleClic, esperar, limpio, pasar, toasts } from '../lib/montar';
import { VALIDAR_OK, instalarAdaptador, usarGuion } from '../lib/wizard';
import { POSTS_QUE_ARRANCAN, armarBancoC1, filasDeCortes, hastaLaVistaPreviaDividida, hastaLosCortes, type BancoC1 } from '../lib/banco-asistente';

let b: BancoC1 | null = null;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false; instalarAdaptador(); });
afterAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { usarGuion(null); if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

const GRUPO = /^\/import\/ejecutar-grupo$/;
const SUELTA = /^\/import\/ejecutar\/\d+$/;
const okDe = (e: any, over: Record<string, unknown> = {}) => terminalC1('OK', { ...e, resultado: 'OK', fase: 'TERMINADA', estadoProceso: 'FINALIZADA', enCurso: false, terminal: true, cancelable: false, rev: 20, procesadas: 5000, ok: 5000, err: 0, progreso: 100, startedAt: iso(Date.now() - 5000), finishedAt: iso(Date.now()), ...over });
const procesandoDe = (e: any, over: Record<string, unknown> = {}) => dtoC1({ ...e, fase: 'PROCESANDO', estadoProceso: 'PROCESANDO', rev: 10, procesadas: 2000, ok: 2000, err: 0, progreso: 40, startedAt: iso(Date.now()), heartbeatAt: iso(Date.now()), servidorAhora: iso(Date.now()), enColaDelante: null, cancelable: true, ...over });
const enResultado = () => /Resultado de la importación/.test(b!.texto());
const cuerpo = (p: any) => JSON.parse(p.cuerpo.toString('utf8'));

describe('vista previa de todos los cortes', () => {
    it('valida las N, una por una y en orden, mostrando «Armando la vista previa: remesa i de N…», y arma la tabla', async () => {
        b = await armarBancoC1();
        const tramos: Array<[number, number, number]> = []; const vistos: string[] = [];
        b.validar = async (id) => {
            const t0 = Date.now();
            for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 50)); const m = /Armando la vista previa: remesa \d+ de \d+…/.exec(document.body.textContent ?? ''); if (m && !vistos.includes(m[0])) vistos.push(m[0]); }
            tramos.push([id, t0, Date.now()]);
            if (id === 141) return { body: { ...VALIDAR_OK, total: 5000, descartadas: 7300, fueraDeCorte: 7000, advertencias: ['Aviso de la primera'] } };
            if (id === 142) return { body: { ...VALIDAR_OK, total: 4000, ok: 48, err: 2, descartadas: 8300, fueraDeCorte: 8000, advertencias: ['Hay 3 importes negativos', 'Dos cuentas colapsan'] } };
            return { body: { ...VALIDAR_OK, total: 3000, descartadas: 9300, fueraDeCorte: 9000 } };
        };
        await hastaLaVistaPreviaDividida(b);
        expect(tramos.map((t) => t[0])).toEqual([141, 142, 143]);
        for (let i = 1; i < tramos.length; i++) expect(tramos[i][1], 'no se solapan').toBeGreaterThanOrEqual(tramos[i - 1][2]);
        expect(vistos).toEqual(['Armando la vista previa: remesa 1 de 3…', 'Armando la vista previa: remesa 2 de 3…', 'Armando la vista previa: remesa 3 de 3…']);
        enElSpec10('Armando la vista previa: remesa 2 de 5…');
        const tabla = Array.from(b.v.contenedor.querySelectorAll('table')).find((t) => /Corte/.test(t.textContent ?? ''))!;
        const filas = Array.from(tabla.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((c) => limpio(c.textContent ?? '')));
        expect(b.texto()).toContain(enElSpec10('Remesas que se van a cargar'));
        expect(filas.slice(1)).toEqual([
            ['3081', '3081', '5.000', '0', '300', '1'],
            ['3082', '3082', '4.000', '2', '300', '2'],
            ['3083', '3083', '3.000', '0', '300', '0'],
        ]);
        const avisos = alertas(b.v.contenedor);
        expect(avisos.some((a) => /remesa 3082/.test(a.texto) && /Hay 3 importes negativos/.test(a.texto))).toBe(true);
        expect(b.texto()).not.toMatch(/Abajo se ve el preview de la primera/);
        expect(b.texto()).not.toMatch(BASURA);
        expect(b.srv.cuantos('POST', GRUPO) + b.srv.cuantos('POST', SUELTA)).toBe(0);
        expect(boton('Confirmar e importar')!.disabled).toBe(false);
    });

    it('una remesa con total 0 (no la primera): «Confirmar e importar» deshabilitado y dice cuál; un clic no dispara nada', async () => {
        b = await armarBancoC1();
        b.validar = (id) => ({ body: id === 142 ? { total: 0, ok: 0, err: 0, sample: [], descartadas: 9000, fueraDeCorte: 9000 } : VALIDAR_OK });
        await hastaLaVistaPreviaDividida(b);
        const btn = boton('Confirmar e importar')!;
        const cartel = alertas(b.v.contenedor).filter((a) => a.severidad === 'error');
        expect(btn.disabled).toBe(true);
        // Segunda pasada (hallazgo 11): además dice por qué quedó en cero.
        expect(cartel.map((a) => a.texto)).toEqual(['No se puede confirmar: la remesa 3082 no tiene filas para importar.Remesa 3082: 9.000 filas son de otros cortes de la división.']);
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await pasar(300);
        expect(b.srv.cuantos('POST', GRUPO) + b.srv.cuantos('POST', SUELTA)).toBe(0);
    });

    it('una validación que falla (la segunda): muestra el error, no avanza y no valida la tercera', async () => {
        b = await armarBancoC1();
        b.validar = (id) => (id === 142 ? { status: 400, body: { message: 'La hoja «Nómina 2» no existe en el archivo.' } } : { body: VALIDAR_OK });
        await hastaLosCortes(b);
        await clic(boton(/^Crear 3 remesa/), 'Crear 3');
        await esperar(() => toasts().some((t) => t.variante === 'error'), { que: 'el error' });
        await pasar(400);
        expect(b.srv.de('POST', /validar/).map((p) => p.ruta)).toEqual(['/import/validar/141', '/import/validar/142']);
        expect(boton('Confirmar e importar')).toBeNull();
        expect(b.texto()).toContain('Configurar importación');
        expect(b.srv.cuantos('POST', GRUPO) + b.srv.cuantos('POST', SUELTA)).toBe(0);
    });
});

describe('confirmar una división: un solo pedido', () => {
    it('`ejecutar-grupo` una vez con las N en orden, ninguna `ejecutar/:id`; doble clic = 1', async () => {
        b = await armarBancoC1();
        await hastaLaVistaPreviaDividida(b);
        await dobleClic(boton('Confirmar e importar'), 'Confirmar e importar');
        await esperar(() => /Carga dividida: remesa 1 de 3/.test(b!.texto()), { que: 'el paso Importando del grupo' });
        await pasar(300);
        const pedidos = b.srv.de('POST', GRUPO);
        expect(pedidos.length).toBe(1);
        expect(cuerpo(pedidos[0])).toEqual({ remesaIds: [141, 142, 143] });
        expect(b.srv.cuantos('POST', SUELTA)).toBe(0);
        const info = alertas(b.v.contenedor).find((a) => /Carga dividida/.test(a.texto))!;
        expect(info.texto).toBe('Carga dividida: remesa 1 de 3' + enElSpec10('Las remesas se cargan una después de la otra en el servidor. Podés cerrar esta pantalla: siguen igual, y las ves en la campanita y en el Historial.'));
    });

    it('de punta a punta por eventos: la pestaña no dispara NINGÚN POST después de confirmar; termina en Resultado con las 3', async () => {
        b = await armarBancoC1();
        await hastaLaVistaPreviaDividida(b);
        await clic(boton('Confirmar e importar'), 'Confirmar e importar');
        await esperar(() => /Carga dividida: remesa 1 de 3/.test(b!.texto()), { que: 'grupo' });
        const tConfirmado = Date.now();
        const lineas: string[] = [];
        const lista = () => Array.from(b!.v.contenedor.querySelectorAll('.MuiChip-label')).map((c) => limpio(c.textContent ?? '')).filter((c) => /En cola|Procesando|Finalizada|Falló|Cancelada|empezar|Leyendo|Post/.test(c));
        for (const [i, id] of [141, 142, 143].entries()) {
            b.pub('import:iniciada', procesandoDe(b.estados[id], { rev: 5, procesadas: 0, ok: 0, progreso: 0 }));
            b.pub('import:progreso', procesandoDe(b.estados[id], { rev: 6, progreso: 43, procesadas: 2150, ok: 2150 }));
            await esperar(() => new RegExp(`Carga dividida: remesa ${i + 1} de 3`).test(b!.texto()) && chips(b!.v.contenedor).includes('Procesadas: 2.150'), { que: `remesa ${i + 1} procesando` });
            await pasar(60);
            lineas.push(`remesa ${i + 1}: ${JSON.stringify(lista())}`);
            b.pub('import:finalizada', okDe(b.estados[id]));
        }
        await esperar(enResultado, { que: 'el resultado' });
        await pasar(150);
        const fin = b.texto().replace(/^.*Resultado de la importación/, '');
        const disparos = b.srv.pedidos.filter((p) => p.metodo === 'POST' && p.t >= tConfirmado && POSTS_QUE_ARRANCAN.test(p.ruta));
        expect(disparos.length).toBe(0);
        expect(b.srv.cuantos('POST', SUELTA)).toBe(0);
        expect(b.srv.cuantos('POST', GRUPO)).toBe(1);
        expect(lineas[0]).toContain('"Procesando 43 %","En cola","En cola"');
        expect(lineas[1]).toContain('"Finalizada","Procesando 43 %","En cola"');
        expect(fin).toContain('Importación exitosa');
        expect(fin).toContain('15.000Filas procesadas15.000Exitosas');
        expect(fin).not.toMatch(BASURA);
        expect(fin).not.toMatch(/incompleta|eliminó|no se pud/);
    });

    it('una sola remesa tildada de una división: `ejecutar/:id`, sin grupo', async () => {
        b = await armarBancoC1();
        await hastaLosCortes(b);
        await clic(filasDeCortes()[0].check, 'destildar'); await clic(filasDeCortes()[1].check, 'destildar');
        await clic(boton(/^Crear 1 remesa/), 'Crear 1');
        await esperar(() => !!boton('Confirmar e importar'), { que: 'la vista previa' });
        await pasar(100);
        expect(b.texto()).not.toContain('Remesas que se van a cargar');
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => b!.srv.cuantos('POST', SUELTA) === 1, { que: 'ejecutar/:id' });
        await pasar(300);
        expect(b.srv.cuantos('POST', GRUPO)).toBe(0);
        expect(b.srv.de('POST', SUELTA).map((p) => p.ruta)).toEqual(['/import/ejecutar/141']);
        expect(b.texto()).not.toMatch(/Carga dividida/);
    });
});

describe('confirmar una división: cuando el pedido sale mal', () => {
    it('503 (todas vuelven a borrador): vuelve a la vista previa con el error y se puede confirmar de nuevo; total, 2 pedidos y 1 solo grupo', async () => {
        b = await armarBancoC1();
        await hastaLaVistaPreviaDividida(b);
        const bueno = b.ejecutarGrupo; let n = 0;
        b.ejecutarGrupo = (c) => (n++ === 0 ? { status: 503, body: { statusCode: 503, message: 'No se pudo encolar la importación: la cola no responde. Probá de nuevo en unos minutos.' } } : bueno(c));
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => toasts().some((t) => t.variante === 'error') && !!boton('Confirmar e importar'), { que: 'vuelta a la vista previa' });
        await pasar(200);
        expect(boton('Confirmar e importar')!.disabled).toBe(false);
        expect(b.texto()).toContain('Remesas que se van a cargar');
        await clic(boton('Confirmar e importar'), 'Confirmar (2)');
        await esperar(() => /Carga dividida: remesa 1 de 3/.test(b!.texto()), { que: 'grupo' });
        expect(b.srv.cuantos('POST', GRUPO)).toBe(2);
        expect(b.srv.cuantos('POST', SUELTA)).toBe(0);
    });

    it('respuesta perdida (el lote entró y la respuesta no llegó): mira la primera remesa, sigue al grupo y NO vuelve a pedir', async () => {
        b = await armarBancoC1();
        await hastaLaVistaPreviaDividida(b);
        const bueno = b.ejecutarGrupo;
        b.ejecutarGrupo = (c) => { bueno(c); return { status: 504, body: { message: 'Gateway Time-out' } }; };
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => /Carga dividida: remesa 1 de 3/.test(b!.texto()), { que: 'grupo' });
        await pasar(300);
        expect(b.srv.cuantos('POST', GRUPO)).toBe(1);
        expect(boton('Confirmar e importar')).toBeNull();
        expect(toasts().filter((t) => t.variante === 'error')).toEqual([]);
    });

    it('respuesta perdida Y la consulta del estado también falla: vuelve a la vista previa; al reintentar, el 409 «ya fue confirmada» lleva al grupo (nunca dos grupos)', async () => {
        b = await armarBancoC1();
        await hastaLaVistaPreviaDividida(b);
        const bueno = b.ejecutarGrupo; let n = 0; let progresoRoto = true;
        b.ejecutarGrupo = (c) => { if (n++ === 0) { bueno(c); return { status: 504, body: { message: 'Gateway Time-out' } }; } return { status: 409, body: { statusCode: 409, message: 'La remesa 3081 ya fue confirmada.' } }; };
        b.srv.en('GET', /^\/import\/remesas\/141\/progreso$/, () => (progresoRoto ? { status: 502, body: { message: 'Bad Gateway' } } : { body: { ...b!.estados[141], servidorAhora: iso(Date.now()) } }));
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => !!boton('Confirmar e importar') && toasts().some((t) => t.variante === 'error'), { que: 'vuelta a la vista previa' });
        progresoRoto = false;
        await clic(boton('Confirmar e importar'), 'Confirmar (2)');
        await esperar(() => /Carga dividida: remesa 1 de 3/.test(b!.texto()), { que: 'grupo' });
        expect(b.srv.cuantos('POST', GRUPO)).toBe(2);
        expect(Object.keys(b.totales)).toEqual(['grupo-1']);
        expect(b.srv.cuantos('POST', SUELTA)).toBe(0);
    });

    it('409 «ya tenés una importación en curso»: vuelve a la vista previa', async () => {
        b = await armarBancoC1();
        await hastaLaVistaPreviaDividida(b);
        b.ejecutarGrupo = () => ({ status: 409, body: { statusCode: 409, message: 'Ya tenés una importación en curso. Esperá a que termine.' } });
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => !!boton('Confirmar e importar') && toasts().some((t) => t.variante === 'error'), { que: 'vuelta a la vista previa' });
        expect(toasts().map((t) => t.texto)).toContain('Ya tenés una importación en curso. Esperá a que termine.');
        expect(boton('Confirmar e importar')!.disabled).toBe(false);
    });
});

describe('201 con `noEncoladas` (§10.8.3)', () => {
    async function conNoEncoladas(cuales: number[]) {
        b = await armarBancoC1();
        await hastaLaVistaPreviaDividida(b);
        const bueno = b.ejecutarGrupo; let n = 0;
        b.ejecutarGrupo = (c) => {
            const r = bueno(c) as any;
            if (n++ > 0) return r;
            // El residuo mixto: las compensadas vuelven a borrador, sin grupo.
            const fuera = cuales.map((id) => ({ remesaId: id, numeroRemesa: b!.estados[id].numeroRemesa }));
            for (const id of cuales) b!.estados[id] = dtoC1({ ...b!.estados[id], fase: 'BORRADOR', enCurso: false, estadoProceso: 'VALIDANDO', grupoId: null, grupoOrden: null, grupoTotal: null, encoladaAt: null, cancelable: false });
            r.body.cargas = r.body.cargas.filter((x: any) => !cuales.includes(x.remesaId));
            r.body.noEncoladas = fuera;
            return r;
        };
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => /Carga dividida/.test(b!.texto()), { que: 'grupo' });
        await pasar(200);
    }

    it('una no encolada: alerta fija con el número; no se informa como «eliminada»; en Resultado, «Cargar las que faltan» usa `ejecutar/:id`', async () => {
        await conNoEncoladas([143]);
        const enImportando = alertas(b!.v.contenedor);
        expect(enImportando.some((a) => a.severidad === 'error' && /1 remesa no se pudo encolar y quedó sin confirmar/.test(a.texto) && /3083/.test(a.texto))).toBe(true);
        expect(b!.texto()).not.toMatch(/se eliminó|se eliminaron/);
        b!.pub('import:finalizada', okDe(b!.estados[141]));
        b!.pub('import:finalizada', terminalC1('FALLIDA', { ...b!.estados[142], resultado: 'FALLIDA', fase: 'TERMINADA', estadoProceso: 'FALLIDA', enCurso: false, terminal: true, rev: 20, startedAt: iso(Date.now()), finishedAt: iso(Date.now()), error: 'La plantilla no tiene estado inicial.', retomable: true, cancelable: false, procesadas: 0, ok: 0, err: 0 }));
        await esperar(enResultado, { que: 'resultado' });
        await pasar(150);
        const r1 = b!.texto().replace(/^.*Resultado de la importación/, '');
        expect(r1).toContain('La importación falló');
        expect(r1).toContain('1 remesa no se pudo encolar y quedó sin confirmar');
        expect(r1).not.toMatch(/se eliminó|se eliminaron/);
        expect(!!boton('Cargar las que faltan')).toBe(true);
        expect(!!boton('Retomar la que no se cargó')).toBe(true);
        await dobleClic(boton('Cargar las que faltan'), 'Cargar las que faltan');
        await esperar(() => b!.srv.cuantos('POST', SUELTA) >= 1 && /Ejecutando importación/.test(b!.texto()), { que: 'la que faltaba en curso' });
        await pasar(300);
        expect(b!.srv.de('POST', SUELTA).map((p) => p.ruta)).toEqual(['/import/ejecutar/143']);
        expect(b!.srv.cuantos('POST', GRUPO)).toBe(1);
        b!.pub('import:finalizada', okDe(b!.estados[143]));
        await esperar(enResultado, { que: 'resultado final' });
        await pasar(150);
        const r2 = b!.texto().replace(/^.*Resultado de la importación/, '');
        // Segunda pasada (hallazgo 3): el resumen final acumula la primera corrida.
        expect(r2.startsWith('La importación falló')).toBe(true);
        expect(r2).toContain('La importación quedó incompleta');
        expect(r2).toContain('10.000Filas procesadas10.000Exitosas');
        expect(r2).toContain('Remesa 3081Importación exitosa5.000 procesadas');
        expect(r2).toContain('Remesa 3082La importación fallóSe puede retomar0 procesadas');
        expect(r2).toContain('Remesa 3083Importación exitosa5.000 procesadas');
        expect(r2).not.toMatch(/Tasa de éxito|no se pud/);
        expect((r2.match(/Remesa 308\d/g) ?? []).length).toBe(3);
    });

    it('dos no encoladas: «Cargar las que faltan» usa `ejecutar-grupo` con esas dos (grupo NUEVO) y sigue ese grupo', async () => {
        await conNoEncoladas([142, 143]);
        b!.pub('import:finalizada', okDe(b!.estados[141]));
        await esperar(enResultado, { que: 'resultado' });
        await pasar(150);
        const r1 = b!.texto().replace(/^.*Resultado de la importación/, '');
        expect(r1).toContain('2 remesas no se pudieron encolar y quedaron sin confirmar');
        expect(r1).not.toMatch(/se eliminó|se eliminaron/);
        expect(r1.startsWith('La importación quedó incompletaHay remesas que no se pudieron encolar y quedaron sin confirmar.')).toBe(true);
        expect(r1.startsWith('Importación exitosa')).toBe(false);
        await clic(boton('Cargar las que faltan'), 'Cargar las que faltan');
        await esperar(() => b!.srv.cuantos('POST', GRUPO) === 2 && /Carga dividida: remesa 1 de 2/.test(b!.texto()), { que: 'el grupo nuevo' });
        expect(JSON.parse(b!.srv.de('POST', GRUPO)[1].cuerpo.toString('utf8'))).toEqual({ remesaIds: [142, 143] });
        expect(b!.srv.cuantos('POST', SUELTA)).toBe(0);
        expect(b!.texto()).not.toMatch(/no se pud/);
    });
});
