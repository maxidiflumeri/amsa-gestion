// C2a: la página del Historial real contra el servidor falso (FH-1 a FH-15).
import { afterEach, describe, expect, it } from 'vitest';
import { fijarAncho } from '../lib/ancho';
import { armarHistorial, HISTORIAL, listaDibujada, type BancoHistorial } from '../lib/banco-historial';
import { BASURA, canceladaC1, dtoC1, enColaC1, iso, itemHistorial, sin, terminalC1, type Sobre } from '../lib/fabricas';
import { alertas, boton, chips, clic, escribir, esperar, limpio, pasar } from '../lib/montar';
import type { HistorialItemDto } from '@fe/types/importHistorial';

const EMP = { empresaId: 1 };
let n = 100;
const fila = (carga: Sobre, over: Partial<HistorialItemDto> = {}): HistorialItemDto => {
    const id = n++;
    return itemHistorial({ ...over }, { ...carga, remesaId: id, numeroRemesa: String(id).padStart(5, '0'), nombre: `Carga ${id}`, ...EMP });
};
const borrador = { fase: 'BORRADOR', enCurso: false, terminal: false, estadoProceso: 'VALIDANDO', resultado: null, progreso: 0, procesadas: 0, ok: 0, err: 0, startedAt: null, heartbeatAt: null, encoladaAt: null, cancelable: false };
const g = (gid: string, orden: number, total: number) => ({ grupoId: gid, grupoOrden: orden, grupoTotal: total });
const enCuerpo = (b: BancoHistorial, patron: RegExp) => patron.test(b.texto());
const ultimaConsulta = (b: BancoHistorial) => b.srv.de('GET', HISTORIAL).slice(-1)[0]?.ruta ?? '';

let b: BancoHistorial | null = null;
afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

describe('FH-1 y FH-2 — cada fila con su estado real', () => {
    it('FH-1 — una remesa de cada estado: su etiqueta, y en ninguna parte «PENDIENTE» ni «VALIDANDO»', async () => {
        const pendiente = { remesas: [{ remesaId: 0, numeroRemesa: 'x', corte: null }], origen: [], yaCargadoEn: [] };
        b = await armarHistorial({
            items: [
                fila(borrador),
                fila(borrador, { pendienteDeEncolar: pendiente }),
                fila(enColaC1({ ...EMP, enColaDelante: 1 })),
                fila({ progreso: 20, procesadas: 3000, totalEsperado: 14466 }),
                fila(canceladaC1({ ...EMP })),
                fila(canceladaC1({ ...EMP, startedAt: null, procesadas: 0, ok: 0, err: 0 })),
                fila(terminalC1('FALLIDA', { ...EMP, error: 'x' })),
                fila(terminalC1('CON_ADVERTENCIAS', { ...EMP, errorPostProceso: 'x' })),
                fila(terminalC1('CON_ERRORES', { ...EMP, ok: 5, err: 2, procesadas: 7 })),
                fila(terminalC1('SIN_FILAS', { ...EMP, descartadas: 3, procesadas: 0 })),
                fila(terminalC1('OK', EMP)),
            ],
            estricto: true,
        });
        await listaDibujada(b);
        const etiquetas = chips(b.v.contenedor);
        for (const e of ['Borrador', 'No se pudo encolar', 'En cola', 'Procesando 20 %', 'Cancelada', 'Cancelada antes de empezar', 'Fallida', 'Con advertencias', 'Finalizada con errores', 'Sin filas', 'Finalizada']) {
            expect(etiquetas, e).toContain(e);
        }
        expect(b.texto()).not.toMatch(/PENDIENTE|VALIDANDO/);
        expect(etiquetas).not.toContain('FALLIDA');
    });

    it('FH-2 — una en cola de una división y un borrador se ven distintas; la primera con su posición', async () => {
        b = await armarHistorial({ items: [fila(enColaC1({ ...EMP, ...g('g1', 2, 2), enColaDelante: 2 })), fila(borrador)] });
        await listaDibujada(b);
        expect(chips(b.v.contenedor).sort()).toEqual(['Borrador', 'En cola']);
        expect(b.texto()).toContain('Hay 2 importaciones antes que esta.');
        expect(b.texto()).toContain('Vista previa sin confirmar.');
    });
});

describe('FH-3 a FH-6 — en vivo', () => {
    it('FH-3 — `import:progreso` cambia el porcentaje sin ninguna consulta; `import:finalizada` cambia el estado y hay UNA consulta', async () => {
        const f = fila({ rev: 5, progreso: 20, procesadas: 3000, totalEsperado: 14466 });
        b = await armarHistorial({ items: [f] });
        await listaDibujada(b);
        await pasar(300);
        const antes = b.consultasHistorial();
        b.pub('import:progreso', { ...f.carga, rev: 6, progreso: 55, procesadas: 8000, ok: 8000 });
        await esperar(() => chips(b!.v.contenedor).includes('Procesando 55 %'), { que: 'el porcentaje nuevo' });
        await pasar(600);
        expect(b.consultasHistorial()).toBe(antes);
        b.pub('import:finalizada', terminalC1('OK', { ...EMP, remesaId: f.id, numeroRemesa: f.numeroRemesa, rev: 7, procesadas: 14466, ok: 14466, err: 0 }));
        await esperar(() => chips(b!.v.contenedor).includes('Finalizada'), { que: 'finalizada' });
        await esperar(() => b!.consultasHistorial() === antes + 1, { que: 'la consulta de refresco' });
        await pasar(700);
        expect(b.consultasHistorial()).toBe(antes + 1);
    });

    it('FH-4 — un evento de una remesa que no está: en la página 1, un refresco; en la 2, ninguno', async () => {
        const todas = Array.from({ length: 30 }, () => fila(terminalC1('OK', EMP)));
        b = await armarHistorial({ items: todas });
        await listaDibujada(b);
        await pasar(300);
        const base = b.consultasHistorial();
        b.srv.emitir('import:iniciada', enColaC1({ ...EMP, remesaId: 9001, numeroRemesa: '09001', rev: 2 }));
        await esperar(() => b!.consultasHistorial() === base + 1, { que: 'el refresco' });
        await clic(document.querySelector('button[aria-label="Go to next page"]'), 'la página siguiente');
        await esperar(() => /page=2/.test(ultimaConsulta(b!)), { que: 'la página 2' });
        await pasar(300);
        const enLa2 = b.consultasHistorial();
        b.srv.emitir('import:iniciada', enColaC1({ ...EMP, remesaId: 9002, numeroRemesa: '09002', rev: 2 }));
        await pasar(900);
        expect(b.consultasHistorial()).toBe(enLa2);
    });

    it('FH-5 — un evento de otra empresa, o que no pasa `esEstadoCarga`: nada', async () => {
        const f = fila({ rev: 5 });
        b = await armarHistorial({ items: [f] });
        await listaDibujada(b);
        await pasar(300);
        const base = b.consultasHistorial();
        b.srv.emitir('import:progreso', { ...f.carga, rev: 9, empresaId: 2, progreso: 90 });
        b.srv.emitir('import:progreso', { remesaId: f.id, progreso: 90 });
        b.srv.emitir('import:progreso', 'basura');
        await pasar(900);
        expect(chips(b.v.contenedor)).toContain('Procesando 20 %');
        expect(b.consultasHistorial()).toBe(base);
    });

    it('FH-6 — una respuesta lenta con un `rev` viejo no pisa un evento más nuevo', async () => {
        const f = fila({ rev: 5 });
        b = await armarHistorial({ items: [f] });
        await listaDibujada(b);
        await pasar(300);
        let lenta = true;
        b.historial = (p) => {
            if (!lenta) return null;
            lenta = false;
            const cuerpo = JSON.parse(JSON.stringify({ data: [f], total: 1, page: 1, pageSize: 25, totalPages: 1, grupos: {}, servidorAhora: iso(Date.now()) }));
            void p;
            return { body: cuerpo, demoraMs: 700 };
        };
        window.dispatchEvent(new Event('online'));
        await pasar(150);
        b.pub('import:progreso', { ...f.carga, rev: 9, progreso: 77, procesadas: 11000, ok: 11000 });
        await esperar(() => chips(b!.v.contenedor).includes('Procesando 77 %'), { que: 'el evento' });
        await pasar(1100);
        expect(chips(b.v.contenedor)).toContain('Procesando 77 %');
    });
});

const elegirEmpresa = async (nombre: RegExp) => {
    const combo = document.querySelector('[role="combobox"]');
    await clic(combo, 'el selector de empresa');
    combo!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    const opcion = await esperar(() => Array.from(document.querySelectorAll('li[role="option"]')).find((o) => nombre.test(o.textContent ?? '')), { que: 'la empresa' });
    await clic(opcion, 'la empresa');
};

describe('FH-7 y FH-8 — paginado y búsqueda', () => {
    it('FH-7 — pasar de página pide `page=2`; cambiar de empresa vuelve a la 1', async () => {
        b = await armarHistorial({ items: Array.from({ length: 60 }, () => fila(terminalC1('OK', EMP))) });
        await listaDibujada(b);
        expect(b.v.contenedor.querySelectorAll('tbody tr')).toHaveLength(25);
        expect(ultimaConsulta(b)).toMatch(/page=1&pageSize=25/);
        await clic(document.querySelector('button[aria-label="Go to next page"]'), 'la página siguiente');
        await esperar(() => /page=2/.test(ultimaConsulta(b!)), { que: 'page=2' });
        await esperar(() => /26–50 de 60/.test(b!.texto()), { que: 'la segunda página dibujada' });
        await elegirEmpresa(/AYSA/);
        await esperar(() => /empresaId=2&page=1/.test(ultimaConsulta(b!)), { que: 'la empresa 2 en la página 1' });
    });

    it('FH-8 — la búsqueda pide con `q`, muestra «Buscando «x»» y se puede quitar', async () => {
        const a = fila(terminalC1('OK', EMP), { nombre: 'Telecom septiembre' });
        const otra = fila(terminalC1('OK', EMP), { nombre: 'Otra carga' });
        b = await armarHistorial({ items: [a, otra] });
        await listaDibujada(b);
        await escribir(document.querySelector('input[type="text"]') as HTMLInputElement, 'septiembre');
        await esperar(() => /q=septiembre/.test(ultimaConsulta(b!)), { que: 'la búsqueda' });
        await esperar(() => b!.v.contenedor.querySelectorAll('tbody tr').length === 1, { que: 'una sola fila' });
        expect(b.texto()).toContain('Buscando «septiembre»');
        await clic(boton('Quitar'), 'Quitar');
        await esperar(() => !/q=/.test(ultimaConsulta(b!)) && b!.v.contenedor.querySelectorAll('tbody tr').length === 2, { que: 'sin búsqueda' });
        expect(b.texto()).not.toContain('Buscando');
    });
});

describe('FH-9 y FH-10 — división y lo que la página no muestra', () => {
    it('FH-9 — el encabezado con los números de `grupos`, las filas en orden 1..N, y «(2 de las 5…)» cuando el tramo no las trae todas', async () => {
        const a = fila(terminalC1('OK', { ...EMP, ...g('g1', 4, 5) }), { corte: 'Nómina 3084' });
        const c = fila(terminalC1('OK', { ...EMP, ...g('g1', 5, 5) }), { corte: 'Nómina 3085' });
        b = await armarHistorial({
            items: [a, c],
            antes: (bb) => {
                bb.historial = () => ({
                    body: {
                        data: [c, a], total: 2, page: 1, pageSize: 25, totalPages: 1, servidorAhora: iso(Date.now()),
                        grupos: { g1: { grupoId: 'g1', total: 5, existentes: 5, enCurso: 1, cancelables: 1, retomables: 0, finalizadas: 3, noCargadas: 1, usuarioId: 3 } },
                    },
                });
            },
        });
        await listaDibujada(b);
        const enc = document.querySelector('[data-testid="encabezado-division"]');
        expect(limpio(enc!.textContent ?? '')).toBe('Carga dividida · 5 remesas — 3 finalizadas · 1 en curso · 1 fallida o cancelada(2 de las 5 están en esta página)');
        const filas = Array.from(b.v.contenedor.querySelectorAll('tbody tr')).map((tr) => limpio(tr.textContent ?? ''));
        expect(filas[1]).toContain('Remesa 4 de 5 de una carga dividida');
        expect(filas[2]).toContain('Remesa 5 de 5 de una carga dividida');
        expect(filas[1]).toContain('Nómina 3084');
    });

    it('FH-9 — un grupo completo en la página: sin la nota, con «Retomar las 2 que no se cargaron» si hay dos retomables', async () => {
        const f1 = fila(terminalC1('FALLIDA', { ...EMP, ...g('g2', 1, 3), error: 'x', retomable: true, procesadas: 0, ok: 0, err: 0 }));
        const f2 = fila(terminalC1('FALLIDA', { ...EMP, ...g('g2', 2, 3), error: 'x', retomable: true, procesadas: 0, ok: 0, err: 0 }));
        const f3 = fila(terminalC1('OK', { ...EMP, ...g('g2', 3, 3) }));
        b = await armarHistorial({ items: [f3, f2, f1] });
        await listaDibujada(b);
        const enc = limpio(document.querySelector('[data-testid="encabezado-division"]')!.textContent ?? '');
        expect(enc).toContain('Carga dividida · 3 remesas — 1 finalizada · 2 fallidas o canceladas');
        expect(enc).not.toContain('están en esta página');
        expect(enc).toContain('Retomar las 2 que no se cargaron');
        const numeros = Array.from(b.v.contenedor.querySelectorAll('tbody tr')).map((tr) => /Remesa (\d) de 3/.exec(tr.textContent ?? '')?.[1]).filter(Boolean);
        expect(numeros).toEqual(['1', '2', '3']);
    });

    it('FH-10 — «Hay N importaciones en curso que no están en esta página»', async () => {
        const fuera = dtoC1({ ...EMP, remesaId: 777, numeroRemesa: '00777' });
        const fuera2 = dtoC1({ ...EMP, remesaId: 778, numeroRemesa: '00778' });
        b = await armarHistorial({ items: [fila(terminalC1('OK', EMP))], enCurso: [fuera, fuera2] });
        await esperar(() => /en curso que no están en esta página/.test(b!.texto()), { que: 'el aviso' });
        expect(alertas().map((a) => a.texto).some((t) => t.startsWith('Hay 2 importaciones en curso que no están en esta página: #00777, #00778.'))).toBe(true);
        expect(boton('Ir al principio')).not.toBeNull();
        await b.v.desmontar();
        await b.srv.bajar();
        b = await armarHistorial({ items: [fila(terminalC1('OK', EMP))], enCurso: [fuera] });
        await esperar(() => /en curso que no está en esta página/.test(b!.texto()), { que: 'el aviso en singular' });
        expect(b.texto()).toContain('Hay 1 importación en curso que no está en esta página: #00777.');
    });
});

describe('FH-11 a FH-13 — fallos y respuestas raras', () => {
    it('FH-11 — el primer pedido falla (500): Alert con «Reintentar», no una tabla vacía; reintentar funciona', async () => {
        b = await armarHistorial({ items: [fila(terminalC1('OK', EMP))], antes: (bb) => { bb.historial = () => ({ status: 500, body: { message: 'boom' } }); } });
        await esperar(() => alertas().some((a) => /No se pudo cargar el historial/.test(a.texto)), { que: 'el Alert' });
        expect(boton('Reintentar')).not.toBeNull();
        expect(b.texto()).not.toContain('Sin importaciones');
        expect(b.v.contenedor.querySelector('table')).toBeNull();
        b.historial = null;
        await clic(boton('Reintentar'), 'Reintentar');
        await esperar(() => b!.v.contenedor.querySelectorAll('tbody tr').length === 1, { que: 'la lista' });
        expect(alertas().some((a) => /No se pudo cargar el historial/.test(a.texto))).toBe(false);
    });

    it('FH-11 — sin red (la conexión se corta): el mismo estado de error', async () => {
        b = await armarHistorial({
            items: [fila(terminalC1('OK', EMP))],
            antes: (bb) => { bb.historial = () => ({ cortar: true }); },
        });
        await esperar(() => alertas().some((a) => /No se pudo cargar el historial/.test(a.texto)), { que: 'el Alert' });
        expect(boton('Reintentar')).not.toBeNull();
    });

    it('FH-12 — el backend no tiene la ruta (404): el mismo estado de error', async () => {
        b = await armarHistorial({ items: [], antes: (bb) => { bb.historial = () => ({ status: 404, body: { message: 'Cannot GET /api/import/historial' } }); } });
        await esperar(() => alertas().some((a) => /No se pudo cargar el historial/.test(a.texto)), { que: 'el Alert' });
        expect(boton('Reintentar')).not.toBeNull();
        expect(b.texto()).not.toContain('Sin importaciones');
    });

    it('FH-13 — con DTOs de un backend viejo no se ve `NaN`, `undefined`, `null` ni `[object`', async () => {
        const viejo = (carga: Sobre) => {
            const it_ = fila(carga);
            const c = sin(it_.carga, 'cancelada', 'grupoId', 'grupoOrden', 'grupoTotal', 'corteRepetidoEn', 'cancelacionPedidaAt', 'cancelable', 'retomable', 'canceladaPor', 'fueraDeCorte', 'enColaDelante', 'velocidad', 'etaSegundos', 'nuevos', 'actualizados', 'descartadasPorFiltro');
            const sinCampos: Partial<HistorialItemDto> = { ...it_, carga: c };
            delete sinCampos.archivos; delete sinCampos.corte; delete sinCampos.pendienteDeEncolar; delete sinCampos.plantilla; delete sinCampos.politicaId;
            return sinCampos as HistorialItemDto;
        };
        b = await armarHistorial({ items: [viejo(borrador), viejo(enColaC1(EMP)), viejo({}), viejo(terminalC1('OK', EMP)), viejo(terminalC1('FALLIDA', { ...EMP, error: 'x' }))] });
        await listaDibujada(b);
        await pasar(300);
        expect(b.v.contenedor.querySelectorAll('tbody tr')).toHaveLength(5);
        expect(b.texto()).not.toMatch(BASURA);
    });
});

describe('FH-14 y FH-15 — celular y tema', () => {
    const items = () => {
        const pendiente = { remesas: [{ remesaId: 0, numeroRemesa: 'x', corte: null }], origen: [], yaCargadoEn: [] };
        return [
            fila(terminalC1('OK', { ...EMP, ...g('g9', 2, 2) })),
            fila(terminalC1('OK', { ...EMP, ...g('g9', 1, 2), usuarioId: 8 })),
            fila(borrador, { pendienteDeEncolar: pendiente }),
            fila({ progreso: 20, procesadas: 3000, totalEsperado: 14466 }),
        ];
    };

    it('FH-14 — ancho de celular: tarjetas con su estado, sus acciones y el motivo escrito de las deshabilitadas; el encabezado de división está', async () => {
        b = await armarHistorial({ items: items(), ancho: 360, permisos: ['importacion.ver_historial', 'importacion.ejecutar', 'importacion.eliminar'] });
        await esperar(() => b!.v.contenedor.querySelectorAll('.MuiStack-root > .MuiCard-root').length === 4, { que: 'cuatro tarjetas' });
        expect(b.v.contenedor.querySelector('table')).toBeNull();
        expect(document.querySelector('[data-testid="encabezado-division"]')).not.toBeNull();
        expect(chips(b.v.contenedor).sort()).toEqual(['Finalizada', 'Finalizada', 'No se pudo encolar', 'Procesando 20 %']);
        const motivos = Array.from(document.querySelectorAll('[data-testid="motivos-acciones"]')).map((e) => limpio(e.textContent ?? ''));
        expect(motivos.some((m) => m.includes('No se puede eliminar una importación en curso. Para frenarla, usá Cancelar.'))).toBe(true);
        expect(motivos.some((m) => m.includes('Solo podés eliminar tus importaciones.'))).toBe(true);
        expect(b.v.contenedor.querySelectorAll('button[aria-label="Eliminar"]').length).toBeGreaterThanOrEqual(3);
    });

    it('FH-14 — ancho de escritorio: una tabla', async () => {
        b = await armarHistorial({ items: items(), ancho: 1280 });
        await listaDibujada(b);
        expect(b.v.contenedor.querySelector('table')).not.toBeNull();
        expect(b.v.contenedor.querySelectorAll('.MuiStack-root > .MuiCard-root')).toHaveLength(0);
        fijarAncho(1280);
    });

    it('FH-15 — tema oscuro: monta y muestra lo mismo', async () => {
        b = await armarHistorial({ items: items(), modo: 'dark', estricto: true });
        await listaDibujada(b);
        expect(chips(b.v.contenedor).sort()).toEqual(['Finalizada', 'Finalizada', 'No se pudo encolar', 'Procesando 20 %']);
        expect(enCuerpo(b, /Carga dividida · 2 remesas/)).toBe(true);
    });
});
