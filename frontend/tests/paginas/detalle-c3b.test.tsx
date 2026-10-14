// C3b: el detalle de una acción masiva con el estado de la reversión y el botón Revertir (docs/imports-progreso-c3-spec.md §17.6).
import { afterEach, describe, expect, it } from 'vitest';
import { armarDetalle, type BancoDetalle } from '../lib/banco-detalle';
import { BASURA, canceladaC1, coberturaReversion, dtoC1, reversionAccion, reversionResumen, terminalC1 } from '../lib/fabricas';
import { boton, clic, dialogo, esperar, limpio, pasar, toasts } from '../lib/montar';

let b: BancoDetalle | null = null;
afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

const PERMISOS = ['importacion.ver_historial', 'importacion.ejecutar', 'deudores.acciones_masivas'];
const GET_REV = /^\/import\/remesas\/141\/reversion$/;
const accion = (over: Record<string, unknown> = {}) => terminalC1('OK', { remesaId: 141, tipo: 'ACCIONES', usuarioId: 3, ...over });
const btnRevertir = () => boton(/^Revertir/, b!.v.contenedor);
const estadoReversion = () => limpio(b!.v.contenedor.querySelector('[data-testid="reversion-estado"]')?.textContent ?? '');
const dlg = () => dialogo(/^Revertir acción masiva$/);

describe('el botón Revertir del detalle', () => {
    it('una ACCIONES FINALIZADA con el permiso: lo ofrece; el diálogo dice la cobertura y confirmar pone la reversión «En cola»', async () => {
        b = await armarDetalle(accion(), {
            permisos: PERMISOS,
            antes: (x) => {
                x.reversionGet = () => ({ body: reversionAccion({ remesaId: 141, cobertura: coberturaReversion({ casos: 3, cambiosDeCaso: 3, contactos: 2, comentarios: 3 }) }) });
                x.reversionPost = () => {
                    // Después del POST el servidor ya tiene la reversión: la relectura la trae.
                    x.reversionGet = () => ({ body: reversionAccion({ remesaId: 141, reversion: reversionResumen({ remesaId: 141 }) }) });
                    return { status: 202, body: reversionAccion({ remesaId: 141, reversion: reversionResumen({ remesaId: 141 }) }) };
                };
            },
        });
        await esperar(() => btnRevertir(), { que: 'el botón Revertir' });
        expect(estadoReversion()).toBe('');
        await clic(btnRevertir(), 'Revertir');
        await esperar(() => dlg() && /Se van a deshacer/.test(limpio(dlg()!.textContent ?? '')), { que: 'la cobertura' });
        expect(limpio(dlg()!.textContent ?? '')).toContain('Se van a deshacer los cambios en 3 casos: 3 cambios de datos, 2 contactos a restaurar y 3 comentarios a borrar.');
        expect(b.srv.cuantos('POST', /reversion$/)).toBe(0);
        await clic(boton('Revertir', dlg()!), 'confirmar');
        await esperar(() => !dlg(), { que: 'el diálogo cerrado' });
        expect(toasts().map((t) => t.texto)).toContain('Reversión en curso: te avisamos al terminar');
        await esperar(() => estadoReversion().includes('En cola'), { que: '«En cola»' });
        expect(btnRevertir()).toBeNull();
    });

    it('el socket lleva la reversión a «Revirtiendo 40 %» y a «Revertida» con lo que deshizo y lo que no pudo', async () => {
        b = await armarDetalle(accion(), {
            permisos: PERMISOS,
            antes: (x) => { x.reversionGet = () => ({ body: reversionAccion({ remesaId: 141, reversion: reversionResumen({ remesaId: 141, estado: 'REVIRTIENDO', porcentaje: 10, hechos: 15 }) }) }); },
        });
        await esperar(() => estadoReversion().includes('Revirtiendo 10 %'), { que: 'la reversión en curso' });
        b.srv.emitir('accion:revertir:progreso', reversionResumen({ remesaId: 141, estado: 'REVIRTIENDO', porcentaje: 40, hechos: 60 }));
        await esperar(() => estadoReversion().includes('Revirtiendo 40 %'), { que: '40 %' });
        // El servidor dice lo mismo en el evento que en la lectura que la pantalla repite al terminar.
        const fin = reversionResumen({ remesaId: 141, estado: 'TERMINADA', porcentaje: 100, hechos: 150, deudoresRevertidos: 150, contactosRestaurados: 50, comentariosBorrados: 50, casosQueNoExistian: 2 });
        b.reversionGet = () => ({ body: reversionAccion({ remesaId: 141, accionRevertidaEn: '2026-10-14T20:00:00.000Z', reversion: fin }) });
        b.srv.emitir('accion:revertir:terminada', fin);
        await esperar(() => estadoReversion().includes('Revertida'), { que: '«Revertida»' });
        expect(estadoReversion()).toContain('Se deshicieron 150 cambios de datos, se restauraron 50 contactos y se borraron 50 comentarios.');
        expect(estadoReversion()).toContain('2 cambios no se pudieron deshacer porque su caso ya no existe.');
        expect(estadoReversion()).not.toMatch(BASURA);
        expect(btnRevertir()).toBeNull();
        // Un `progreso` que llega tarde no la reabre.
        b.srv.emitir('accion:revertir:progreso', reversionResumen({ remesaId: 141, estado: 'REVIRTIENDO', porcentaje: 90, hechos: 130 }));
        await pasar(300);
        expect(estadoReversion()).toContain('Revertida');
    });

    it('una cancelada (FALLIDA): también se ofrece', async () => {
        b = await armarDetalle(canceladaC1({ remesaId: 141, tipo: 'ACCIONES', usuarioId: 3 }), {
            permisos: PERMISOS,
            antes: (x) => { x.reversionGet = () => ({ body: reversionAccion({ remesaId: 141, cobertura: coberturaReversion({ cargaCortada: true, filasProcesadas: 3000, totalFilas: 14466 }) }) }); },
        });
        await esperar(() => btnRevertir(), { que: 'el botón Revertir' });
        await clic(btnRevertir(), 'Revertir');
        await esperar(() => dlg() && /se cortó/.test(limpio(dlg()!.textContent ?? '')), { que: 'la línea de cortada' });
        expect(limpio(dlg()!.textContent ?? '')).toContain('La acción se cortó después de procesar 3.000 de 14.466 filas');
    });

    it('una interrumpida: el chip dice cuánto hizo y el botón sigue desde ahí', async () => {
        b = await armarDetalle(accion(), {
            permisos: PERMISOS,
            antes: (x) => { x.reversionGet = () => ({ body: reversionAccion({ remesaId: 141, reversion: reversionResumen({ remesaId: 141, estado: 'INTERRUMPIDA', hechos: 40, total: 150, error: 'El servidor se reinició.' }) }) }); },
        });
        await esperar(() => estadoReversion().includes('Reversión interrumpida: 40 de 150'), { que: 'el chip de interrumpida' });
        expect(estadoReversion()).toContain('El servidor se reinició.');
        expect(btnRevertir()?.textContent).toContain('Revertir (sigue desde donde quedó)');
    });

    it('una fallida: «La reversión falló» con el error', async () => {
        b = await armarDetalle(accion(), {
            permisos: PERMISOS,
            antes: (x) => { x.reversionGet = () => ({ body: reversionAccion({ remesaId: 141, reversion: reversionResumen({ remesaId: 141, estado: 'FALLIDA', error: 'Se cayó la base.' }) }) }); },
        });
        await esperar(() => estadoReversion().includes('La reversión falló'), { que: 'el chip de fallida' });
        expect(estadoReversion()).toContain('Se cayó la base.');
    });

    it('ya revertida: el estado, sin botón', async () => {
        b = await armarDetalle(accion(), {
            permisos: PERMISOS,
            antes: (x) => { x.reversionGet = () => ({ body: reversionAccion({ remesaId: 141, accionRevertidaEn: '2026-10-14T20:00:00.000Z', reversion: reversionResumen({ remesaId: 141, estado: 'TERMINADA', porcentaje: 100 }) }) }); },
        });
        await esperar(() => estadoReversion().includes('Revertida'), { que: '«Revertida»' });
        expect(btnRevertir()).toBeNull();
    });
});

describe('arreglos de la revisión de C3b', () => {
    it('una ACCIONES FALLIDA sin ninguna fila procesada (la retomable): ofrece Retomar, no Revertir, y no pide el GET', async () => {
        b = await armarDetalle(terminalC1('FALLIDA', { remesaId: 141, tipo: 'ACCIONES', usuarioId: 3, procesadas: 0, ok: 0, err: 0, progreso: 0, retomable: true, error: 'La plantilla no tiene estado inicial.' }), {
            permisos: PERMISOS,
            antes: (x) => { x.reversionGet = () => ({ body: reversionAccion({ remesaId: 141 }) }); },
        });
        await esperar(() => boton('Retomar', b!.v.contenedor), { que: 'el botón Retomar' });
        await pasar(400);
        expect(btnRevertir()).toBeNull();
        expect(b.srv.cuantos('GET', GET_REV)).toBe(0);
    });

    it('sin el permiso deudores.acciones_masivas no pide el GET (daba 403 en cada detalle)', async () => {
        b = await armarDetalle(accion(), { antes: (x) => { x.reversionGet = () => ({ status: 403, body: { message: 'Forbidden' } }); } });
        await pasar(600);
        expect(b.srv.cuantos('GET', GET_REV)).toBe(0);
        expect(btnRevertir()).toBeNull();
    });

    it('si el GET dice revertible: false no ofrece Revertir y muestra el motivo', async () => {
        b = await armarDetalle(canceladaC1({ remesaId: 141, tipo: 'ACCIONES', usuarioId: 3 }), {
            permisos: PERMISOS,
            antes: (x) => {
                x.reversionGet = () => ({
                    body: reversionAccion({ remesaId: 141, revertible: false, motivo: { code: 'REVERTIR_NO_TERMINO', texto: 'Esta acción masiva no terminó bien: los datos para revertirla no se guardaron. Avisá a soporte; no la vuelvas a cargar.' } }),
                });
            },
        });
        await esperar(() => b!.v.contenedor.querySelector('[data-testid="reversion-no-revertible"]'), { que: 'el motivo' });
        expect(btnRevertir()).toBeNull();
        expect(b.v.contenedor.querySelector('[data-testid="reversion-no-revertible"]')?.textContent).toContain('no terminó bien');
    });

    it('una ACCIONES anterior a C3b ya revertida (accionRevertidaEn y reversion null) dice que ya se revirtió, sin botón', async () => {
        b = await armarDetalle(accion(), {
            permisos: PERMISOS,
            antes: (x) => { x.reversionGet = () => ({ body: reversionAccion({ remesaId: 141, revertible: false, accionRevertidaEn: '2026-10-01T20:00:00.000Z', motivo: { code: 'YA_REVERTIDA', texto: 'Esta acción masiva ya se revirtió.' } }) }); },
        });
        await esperar(() => b!.v.contenedor.querySelector('[data-testid="reversion-no-revertible"]'), { que: 'el aviso' });
        expect(b.v.contenedor.querySelector('[data-testid="reversion-no-revertible"]')?.textContent).toBe('Esta acción masiva ya se revirtió.');
        expect(btnRevertir()).toBeNull();
    });

    it('después de pedir la reversión relee el GET; un EN_COLA del 202 no pisa el REVIRTIENDO que ya llegó por socket', async () => {
        const enCola = reversionResumen({ remesaId: 141 });
        b = await armarDetalle(accion(), {
            permisos: PERMISOS,
            antes: (x) => {
                x.reversionGet = () => ({ body: reversionAccion({ remesaId: 141 }) });
                x.reversionPost = () => {
                    // El socket llega antes que la respuesta del POST.
                    const corriendo = { ...enCola, estado: 'REVIRTIENDO' as const, hechos: 60, porcentaje: 40 };
                    b!.srv.emitir('accion:revertir:progreso', corriendo);
                    x.reversionGet = () => ({ body: reversionAccion({ remesaId: 141, reversion: corriendo }) });
                    return { status: 202, body: reversionAccion({ remesaId: 141, reversion: enCola }) };
                };
            },
        });
        await esperar(() => btnRevertir(), { que: 'el botón Revertir' });
        const gets = b.srv.cuantos('GET', GET_REV);
        await clic(btnRevertir(), 'Revertir');
        await esperar(() => dlg() && /Se van a deshacer/.test(limpio(dlg()!.textContent ?? '')), { que: 'la cobertura' });
        await clic(boton('Revertir', dlg()!), 'confirmar');
        await esperar(() => !dlg(), { que: 'el diálogo cerrado' });
        await esperar(() => b!.srv.cuantos('GET', GET_REV) > gets, { que: 'la relectura posterior al POST' });
        expect(estadoReversion()).toContain('Revirtiendo 40 %');
    });

    it('vuelve a leer al recuperar la red (online) y al volver a la pestaña', async () => {
        b = await armarDetalle(accion(), {
            permisos: PERMISOS,
            antes: (x) => { x.reversionGet = () => ({ body: reversionAccion({ remesaId: 141, reversion: reversionResumen({ remesaId: 141, estado: 'REVIRTIENDO', porcentaje: 10, hechos: 15 }) }) }); },
        });
        await esperar(() => estadoReversion().includes('Revirtiendo 10 %'), { que: 'en curso' });
        const antes = b.srv.cuantos('GET', GET_REV);
        b.reversionGet = () => ({ body: reversionAccion({ remesaId: 141, reversion: reversionResumen({ remesaId: 141, estado: 'REVIRTIENDO', porcentaje: 70, hechos: 105 }) }) });
        window.dispatchEvent(new Event('online'));
        await esperar(() => estadoReversion().includes('Revirtiendo 70 %'), { que: '70 % por online' });
        b.reversionGet = () => ({ body: reversionAccion({ remesaId: 141, reversion: reversionResumen({ remesaId: 141, estado: 'REVIRTIENDO', porcentaje: 80, hechos: 120 }) }) });
        document.dispatchEvent(new Event('visibilitychange'));
        await esperar(() => estadoReversion().includes('Revirtiendo 80 %'), { que: '80 % por visibilitychange' });
        expect(b.srv.cuantos('GET', GET_REV)).toBeGreaterThanOrEqual(antes + 2);
    });
});

describe('cuándo NO se ofrece', () => {
    it('sin el permiso deudores.acciones_masivas', async () => {
        b = await armarDetalle(accion(), { antes: (x) => { x.reversionGet = () => ({ body: reversionAccion({ remesaId: 141 }) }); } });
        await pasar(500);
        expect(btnRevertir()).toBeNull();
    });

    it('en otra categoría no pide ni el GET', async () => {
        b = await armarDetalle(terminalC1('OK', { remesaId: 141, tipo: 'DEUDORES', usuarioId: 3 }), { permisos: PERMISOS });
        await pasar(500);
        expect(btnRevertir()).toBeNull();
        expect(b.srv.cuantos('GET', GET_REV)).toBe(0);
    });

    it('una acción en curso no pide el GET ni ofrece Revertir', async () => {
        b = await armarDetalle(dtoC1({ remesaId: 141, tipo: 'ACCIONES' }), { permisos: PERMISOS });
        await pasar(500);
        expect(btnRevertir()).toBeNull();
        expect(b.srv.cuantos('GET', GET_REV)).toBe(0);
    });

    it('con un backend anterior (el GET da 404): el detalle queda como en C3a, sin botón ni estado, sin errores', async () => {
        b = await armarDetalle(accion(), { permisos: PERMISOS });
        await esperar(() => b!.srv.cuantos('GET', GET_REV) >= 1, { que: 'el GET' });
        await pasar(300);
        expect(btnRevertir()).toBeNull();
        expect(estadoReversion()).toBe('');
        expect(toasts()).toEqual([]);
        expect(b.texto()).not.toMatch(BASURA);
    });

    it('si el GET falla por otra causa (500) no inventa nada: sin botón y sin toast', async () => {
        b = await armarDetalle(accion(), { permisos: PERMISOS, antes: (x) => { x.reversionGet = () => ({ status: 500, body: { message: 'Se cayó' } }); } });
        await esperar(() => b!.srv.cuantos('GET', GET_REV) >= 1, { que: 'el GET' });
        await pasar(300);
        expect(btnRevertir()).toBeNull();
        expect(toasts()).toEqual([]);
    });
});
