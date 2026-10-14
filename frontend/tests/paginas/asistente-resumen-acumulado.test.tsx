// C1, segunda pasada — punto 3: el resumen acumulado tras «Cargar las que faltan» y «Retomar», con cada mezcla.
// ImportWizard real, backend falso.
import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BASURA, TXT_CANCELADA_DEUDORES, TXT_CANCELADA_SIN_ARRANCAR, canceladaC1, dtoC1, enColaC1, iso, terminalC1 } from '../lib/fabricas';
import { alertas, boton, clic, dialogo, esperar, limpio, pasar, toasts } from '../lib/montar';
import { instalarAdaptador, usarGuion } from '../lib/wizard';
import { armarBancoC1, hastaLaVistaPreviaDividida, type BancoC1 } from '../lib/banco-asistente';

let b: BancoC1 | null = null;
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false; instalarAdaptador(); });
afterAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { usarGuion(null); if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

const enResultado = () => /Resultado de la importación/.test(b!.texto());
const fin = () => b!.texto().replace(/^.*Resultado de la importación/, '');
const filasDeRemesa = () => (fin().match(/Remesa 308\d(?=Importación|La importación|El archivo)/g) ?? []);
const de = (id: number) => b!.estados[id];
const dlgRetomar = () => dialogo(/^Retomar la/);
const ok = (id: number) => terminalC1('OK', { ...de(id), resultado: 'OK', fase: 'TERMINADA', estadoProceso: 'FINALIZADA', enCurso: false, terminal: true, cancelable: false, retomable: false, cancelada: false, rev: de(id).rev + 10, procesadas: 5000, ok: 5000, err: 0, progreso: 100, error: null, startedAt: iso(Date.now() - 5000), finishedAt: iso(Date.now()) });
const fallida = (id: number, retomable = true) => terminalC1('FALLIDA', { ...de(id), resultado: 'FALLIDA', fase: 'TERMINADA', estadoProceso: 'FALLIDA', enCurso: false, terminal: true, cancelable: false, rev: de(id).rev + 10, procesadas: 0, ok: 0, err: 0, progreso: 0, error: 'La plantilla no tiene estado inicial.', startedAt: iso(Date.now() - 100), finishedAt: iso(Date.now()), retomable });
const canceladaAMedias = (id: number) => canceladaC1({ ...de(id), resultado: 'FALLIDA', cancelada: true, fase: 'TERMINADA', estadoProceso: 'FALLIDA', enCurso: false, terminal: true, cancelable: false, retomable: false, rev: de(id).rev + 10, procesadas: 3000, ok: 2990, err: 10, progreso: 60, error: TXT_CANCELADA_DEUDORES, startedAt: iso(Date.now() - 4000), finishedAt: iso(Date.now()) });
const enCola = (id: number) => enColaC1({ ...de(id), fase: 'EN_COLA', resultado: null, cancelada: false, canceladaPor: null, cancelacionPedidaAt: null, estadoProceso: 'PENDIENTE', enCurso: true, terminal: false, error: null, retomable: false, cancelable: true, rev: de(id).rev + 1, finishedAt: null, startedAt: null, enColaDelante: 0 });

/** Confirma la división de 3 dejando `fuera` sin encolar (el residuo mixto de §10.5.1). */
async function conNoEncoladas(fuera: number[]) {
    b = await armarBancoC1();
    await hastaLaVistaPreviaDividida(b);
    const bueno = b.ejecutarGrupo; let n = 0;
    b.ejecutarGrupo = (c) => {
        const r = bueno(c) as any;
        if (n++ > 0) return r;
        const noEnc = fuera.map((id) => ({ remesaId: id, numeroRemesa: b!.estados[id].numeroRemesa }));
        for (const id of fuera) b!.estados[id] = dtoC1({ ...b!.estados[id], fase: 'BORRADOR', enCurso: false, estadoProceso: 'VALIDANDO', grupoId: null, grupoOrden: null, grupoTotal: null, encoladaAt: null, cancelable: false });
        r.body.cargas = r.body.cargas.filter((x: any) => !fuera.includes(x.remesaId));
        r.body.noEncoladas = noEnc;
        return r;
    };
    await clic(boton('Confirmar e importar'), 'Confirmar');
    await esperar(() => /Carga dividida/.test(b!.texto()), { que: 'grupo' });
    await pasar(150);
}
async function terminar(...dtos: any[]) {
    for (const d of dtos) b!.pub('import:finalizada', d);
    await esperar(enResultado, { ms: 4000, que: 'resultado' });
    await pasar(200);
}
async function cargarLasQueFaltan() {
    await clic(boton('Cargar las que faltan'), 'Cargar las que faltan');
    await esperar(() => !enResultado() && /Ejecutando importación/.test(b!.texto()), { que: 'importando las que faltaban' });
    await pasar(250);
}

describe('resumen acumulado', () => {
    it('OK + fallida retomable + no encolada: «Retomar» PRIMERO y «Cargar las que faltan» DESPUÉS → tres remesas, ninguna repetida, todo exitoso', async () => {
        await conNoEncoladas([143]);
        await terminar(ok(141), fallida(142));
        expect(filasDeRemesa()).toEqual(['Remesa 3081', 'Remesa 3082']);
        b!.retomarGrupo = () => { const c = enCola(142); b!.estados[142] = c; return { status: 201, body: { message: 'ok', grupoId: 'grupo-1', cargas: [c], omitidas: [] } }; };
        await clic(boton('Retomar la que no se cargó'), 'Retomar');
        await esperar(() => !!dlgRetomar(), { que: 'confirmación' });
        await clic(boton('Retomar', dlgRetomar()!), 'confirmar');
        await esperar(() => /Carga dividida: remesa 2 de 3/.test(b!.texto()), { que: 'importando' });
        await pasar(200);
        await terminar(ok(142));
        const r2 = fin();
        expect(filasDeRemesa()).toEqual(['Remesa 3081', 'Remesa 3082']);
        expect(r2).toContain('1 remesa no se pudo encolar y quedó sin confirmar');
        expect(r2.startsWith('La importación quedó incompletaHay remesas que no se pudieron encolar')).toBe(true);
        await cargarLasQueFaltan();
        await terminar(ok(143));
        const r3 = fin();
        expect(filasDeRemesa()).toEqual(['Remesa 3081', 'Remesa 3082', 'Remesa 3083']);
        expect(r3.startsWith('Importación exitosa')).toBe(true);
        expect(r3).toContain('15.000Filas procesadas15.000Exitosas');
        expect(r3).not.toMatch(/incompleta|no se pud|Retomar/);
        expect(b!.srv.de('POST', /ejecutar/).map((p) => p.ruta)).toEqual(['/import/ejecutar-grupo', '/import/ejecutar/143']);
        expect(r3).not.toMatch(BASURA);
    });

    it('OK + cancelada a medias + no encolada → «Cargar las que faltan»: la cancelada de la primera corrida sigue en el resumen final con sus números', async () => {
        await conNoEncoladas([143]);
        await terminar(ok(141), canceladaAMedias(142));
        await cargarLasQueFaltan();
        await terminar(ok(143));
        const r = fin();
        expect(r.startsWith('Importación cancelada')).toBe(true);
        expect(r).toContain('La importación quedó incompleta');
        expect(r).toContain('Remesa 3082Importación cancelada3.000 procesadas · 2.990 OK · 10 con error');
        expect(r).toContain('13.000Filas procesadas12.990Exitosas10Con error');
        expect(filasDeRemesa()).toEqual(['Remesa 3081', 'Remesa 3082', 'Remesa 3083']);
        expect(r).not.toMatch(/Tasa de éxito/);
        expect(boton(/^Retomar/)).toBeNull();
    });

    it('la que faltaba TAMBIÉN falla sin cargar nada: «Retomar» ofrece solo esa (no la fallida de la primera corrida) y pega a SU remesa', async () => {
        await conNoEncoladas([143]);
        await terminar(ok(141), fallida(142));
        await cargarLasQueFaltan();
        await terminar(fallida(143));
        const r = fin();
        expect(filasDeRemesa()).toEqual(['Remesa 3081', 'Remesa 3082', 'Remesa 3083']);
        expect(!!boton('Retomar la que no se cargó')).toBe(true);
        expect(boton(/^Retomar las/)).toBeNull();
        b!.retomar = (id) => { const c = enCola(id); b!.estados[id] = c; return { status: 201, body: { message: 'ok', remesaId: id, carga: c } }; };
        await clic(boton('Retomar la que no se cargó'), 'Retomar');
        await esperar(() => !!dlgRetomar(), { que: 'confirmación' });
        await clic(boton('Retomar', dlgRetomar()!), 'confirmar');
        await esperar(() => !enResultado() && /Ejecutando importación/.test(b!.texto()), { que: 'importando' });
        await pasar(250);
        expect(b!.srv.de('POST', /retomar/).map((p) => p.ruta)).toEqual(['/import/remesas/143/retomar']);
        await terminar(ok(143));
        const r2 = fin();
        expect(filasDeRemesa()).toEqual(['Remesa 3081', 'Remesa 3082', 'Remesa 3083']);
        expect(r2).toContain('Remesa 3083Importación exitosa');
        expect(r2).toContain('Remesa 3082La importación fallóSe puede retomar');
        // La 3082 (primera corrida) figura «Se puede retomar» pero el botón no la ofrece: se retoma desde su detalle.
        expect(boton(/^Retomar/)).toBeNull();
    });

    it('dos no encoladas → grupo nuevo; una de ellas falla retomable → «Retomar» pega al grupo NUEVO; el resumen final tiene las tres una sola vez', async () => {
        await conNoEncoladas([142, 143]);
        await terminar(ok(141));
        await clic(boton('Cargar las que faltan'), 'Cargar las que faltan');
        await esperar(() => /Carga dividida: remesa 1 de 2/.test(b!.texto()), { que: 'el grupo nuevo' });
        await pasar(200);
        await terminar(ok(142), fallida(143));
        expect(filasDeRemesa()).toEqual(['Remesa 3081', 'Remesa 3082', 'Remesa 3083']);
        expect(!!boton('Retomar la que no se cargó')).toBe(true);
        b!.retomarGrupo = (gid) => { const c = enCola(143); b!.estados[143] = c; return { status: 201, body: { message: 'ok', grupoId: gid, cargas: [c], omitidas: [] } }; };
        await clic(boton('Retomar la que no se cargó'), 'Retomar');
        await esperar(() => !!dlgRetomar(), { que: 'confirmación' });
        await clic(boton('Retomar', dlgRetomar()!), 'confirmar');
        await esperar(() => /Carga dividida: remesa 2 de 2/.test(b!.texto()), { que: 'importando' });
        await pasar(200);
        expect(b!.srv.de('POST', /retomar/).map((p) => p.ruta)).toEqual(['/import/grupos/grupo-2/retomar']);
        await terminar(ok(143));
        const r = fin();
        expect(filasDeRemesa()).toEqual(['Remesa 3081', 'Remesa 3082', 'Remesa 3083']);
        expect(r.startsWith('Importación exitosa')).toBe(true);
        expect(r).toContain('15.000Filas procesadas15.000Exitosas');
    });

    it('en la primera corrida se eliminó una remesa: ¿el resumen final, tras «Cargar las que faltan», lo sigue diciendo?', async () => {
        b = await armarBancoC1();
        b.cortes = () => [...['3081', '3082', '3083', '3084'].map((n) => ({ valores: { 'Nómina': n }, filas: 1000, numeroSugerido: n, filtros: [{ fromIndex: 3, operador: '=', valor: n }] }))];
        await hastaLaVistaPreviaDividida(b);
        const bueno = b.ejecutarGrupo;
        b.ejecutarGrupo = (c) => {
            const r = bueno(c) as any;
            if (c.remesaIds.length < 4) return r;
            b!.estados[144] = dtoC1({ ...b!.estados[144], fase: 'BORRADOR', enCurso: false, estadoProceso: 'VALIDANDO', grupoId: null, grupoOrden: null, grupoTotal: null, encoladaAt: null, cancelable: false });
            r.body.cargas = r.body.cargas.filter((x: any) => x.remesaId !== 144);
            r.body.noEncoladas = [{ remesaId: 144, numeroRemesa: '3084' }];
            return r;
        };
        await clic(boton('Confirmar e importar'), 'Confirmar');
        await esperar(() => /Carga dividida/.test(b!.texto()), { que: 'grupo' });
        delete b.estados[143];                         // alguien eliminó la 3083 mientras esperaba en la cola
        b.estados[141] = ok(141); b.estados[142] = ok(142);
        b.srv.emitir('import:finalizada', b.estados[141]); b.srv.emitir('import:finalizada', b.estados[142]);
        await esperar(enResultado, { ms: 45_000, cada: 250, que: 'resultado (cuando el grupo nota el borrado)' });
        await pasar(200);
        const r1 = fin();
        await cargarLasQueFaltan();
        await terminar(ok(144));
        const r2 = fin();
        expect(r1).toContain('1 remesa de esta división se eliminó.');
    });
});
