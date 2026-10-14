// C3a: Revertir una acción masiva desde el Historial, con los 409 nuevos y con un pedido que no responde
// (docs/imports-progreso-c3-spec.md §4.4 y §6.3).
import { afterEach, describe, expect, it } from 'vitest';
import { armarHistorial, listaDibujada, type BancoHistorial } from '../lib/banco-historial';
import { canceladaC1, coberturaReversion, itemHistorial, reversionAccion, reversionResumen, terminalC1, type Sobre } from '../lib/fabricas';
import { boton, clic, dialogo, dobleClic, esperar, limpio, pasar, toasts } from '../lib/montar';
import type { Respuesta } from '../lib/servidor-falso';
import type { ReversionAccionDto } from '@fe/types/reversionAccion';

const fila = (id: number, carga: Sobre = {}) =>
    itemHistorial({ categoria: 'ACCIONES' }, { ...terminalC1('OK', { tipo: 'ACCIONES' }), ...carga, remesaId: id, numeroRemesa: String(id).padStart(5, '0'), nombre: `Acción ${id}`, empresaId: 1 });
const icono = (aria: string) => (document.querySelector(`button[aria-label="${aria}"]`) as HTMLButtonElement | null);

let b: BancoHistorial | null = null;
afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

async function revertir(respuesta: Respuesta) {
    b = await armarHistorial({ items: [fila(220)], antes: (bb) => { bb.srv.en('POST', /^\/import\/remesas\/(\d+)\/revertir-acciones$/, () => respuesta); } });
    await listaDibujada(b);
    const lecturasAntes = b.consultasHistorial();
    await clic(icono('Revertir'), 'revertir');
    const d = await esperar(() => dialogo(/^Revertir acción masiva$/), { que: 'el diálogo de revertir' });
    await clic(boton('Revertir', d), 'Revertir');
    return lecturasAntes;
}
const errores = () => toasts().filter((t) => t.variante === 'error').map((t) => t.texto);

describe('Revertir con errores del backend', () => {
    it('409 REVERTIR_INCOMPLETO: el toast dice el texto del backend, una sola vez, y el Historial se vuelve a leer', async () => {
        const texto = 'Los datos para revertir esta acción no se guardaron completos: Revertir desharía solo una parte. Avisá a soporte.';
        const lecturasAntes = await revertir({ status: 409, body: { statusCode: 409, code: 'REVERTIR_INCOMPLETO', message: texto } });
        await esperar(() => errores().length > 0, { que: 'el toast de error' });
        expect(errores()).toEqual([texto]);
        await esperar(() => b!.consultasHistorial() > lecturasAntes, { que: 'una lectura nueva del Historial' });
        expect(b!.srv.de('POST', /revertir-acciones/)).toHaveLength(1);
    });

    it.each([
        ['REVERTIR_NO_TERMINO', 'Esta acción masiva no terminó bien: los datos para revertirla no se guardaron. Avisá a soporte; no la vuelvas a cargar.'],
        ['REVERSION_EN_CURSO', 'Esta acción ya se está revirtiendo. Esperá a que termine y actualizá el Historial.'],
    ])('409 %s: el texto del backend', async (code, message) => {
        await revertir({ status: 409, body: { statusCode: 409, code, message } });
        await esperar(() => errores().length > 0, { que: 'el toast de error' });
        expect(errores()).toEqual([message]);
    });
});

describe('Revertir sin respuesta', () => {
    const TEXTO = 'No llegó la respuesta del servidor. La reversión puede seguir corriendo: actualizá el Historial en unos minutos antes de volver a intentar.';

    it('el servidor corta la conexión: "puede seguir corriendo", no "Sin conexión", y un solo toast', async () => {
        await revertir({ cortar: true });
        await esperar(() => errores().length > 0, { que: 'el toast de error' });
        expect(errores()).toEqual([TEXTO]);
    });

    it.each([502, 503, 504])('un %i del proxy: también "puede seguir corriendo"', async (status) => {
        await revertir({ status, body: { message: 'Bad gateway' } });
        await esperar(() => errores().length > 0, { que: 'el toast de error' });
        expect(errores()).toEqual([TEXTO]);
    });

    it('un 500 del backend: su mensaje, no el de "puede seguir corriendo"', async () => {
        await revertir({ status: 500, body: { message: 'Falló algo adentro' } });
        await esperar(() => errores().length > 0, { que: 'el toast de error' });
        expect(errores()).toEqual(['Falló algo adentro']);
    });
});

// ─── C3b: Revertir como proceso en segundo plano (docs/imports-progreso-c3-spec.md §17.6) ─────────────────────────
/** Una fila de un backend de C3b: trae la clave `reversion` (null = nunca se pidió). */
const filaC3b = (id: number, carga: Sobre = {}, over: Record<string, unknown> = {}) =>
    itemHistorial({ categoria: 'ACCIONES', reversion: null, ...over }, { ...terminalC1('OK', { tipo: 'ACCIONES' }), ...carga, remesaId: id, numeroRemesa: String(id).padStart(5, '0'), nombre: `Acción ${id}`, empresaId: 1 });
const textoDialogo = () => limpio(dialogo(/^Revertir acción masiva$/)?.textContent ?? '');
const celda = () => limpio(document.querySelector('tbody tr')?.textContent ?? '');

async function abrirDialogo(o: { fila?: ReturnType<typeof filaC3b>; get?: ReversionAccionDto | Respuesta; post?: (id: number) => Respuesta | Promise<Respuesta> } = {}) {
    const fila3 = o.fila ?? filaC3b(220);
    const get: Respuesta = o.get && 'body' in o.get || (o.get && 'status' in o.get) ? (o.get as Respuesta) : { body: o.get ?? reversionAccion() };
    b = await armarHistorial({
        items: [fila3],
        antes: (bb) => {
            bb.reversionGet = () => get;
            bb.reversionPost = o.post ?? ((id) => {
                const r = reversionResumen({ remesaId: id });
                bb.items = bb.items.map((i) => (i.id === id ? { ...i, reversion: r } : i));
                return { status: 202, body: reversionAccion({ remesaId: id, reversion: r }) };
            });
        },
    });
    await listaDibujada(b);
    await clic(icono('Revertir'), 'revertir');
    await esperar(() => dialogo(/^Revertir acción masiva$/), { que: 'el diálogo de revertir' });
}
const confirmar = async () => {
    await esperar(() => !boton('Revertir', dialogo(/^Revertir acción masiva$/)!)?.disabled, { que: 'Revertir habilitado' });
    await clic(boton('Revertir', dialogo(/^Revertir acción masiva$/)!), 'Revertir');
};

describe('C3b — el diálogo dice cuánto cubre antes de confirmar', () => {
    it('pide el GET y muestra la cobertura; el POST no sale hasta confirmar', async () => {
        await abrirDialogo({ get: reversionAccion({ cobertura: coberturaReversion({ casos: 50, cambiosDeCaso: 50, contactos: 40, comentarios: 50 }) }) });
        await esperar(() => /Se van a deshacer/.test(textoDialogo()), { que: 'la cobertura' });
        expect(b!.srv.cuantos('GET', /^\/import\/remesas\/220\/reversion$/)).toBe(1);
        expect(textoDialogo()).toContain('Se van a deshacer los cambios en 50 casos: 50 cambios de datos, 40 contactos a restaurar y 50 comentarios a borrar.');
        expect(textoDialogo()).toContain('Si alguien editó a mano alguno de estos casos después de la acción, esos cambios se pisan.');
        expect(textoDialogo()).not.toContain('se cortó');
        expect(b!.srv.cuantos('POST', /reversion$/)).toBe(0);
        expect(b!.srv.cuantos('POST', /revertir-acciones$/)).toBe(0);
    });

    it('una acción cancelada: agrega la línea de cortada con las filas que alcanzó a procesar', async () => {
        await abrirDialogo({
            fila: filaC3b(220, canceladaC1({ tipo: 'ACCIONES', usuarioId: 3 })),
            get: reversionAccion({ cobertura: coberturaReversion({ cargaCortada: true, filasProcesadas: 12_000, totalFilas: 50_000 }) }),
        });
        await esperar(() => /Se van a deshacer/.test(textoDialogo()), { que: 'la cobertura' });
        expect(textoDialogo()).toContain('La acción se cortó después de procesar 12.000 de 50.000 filas: Revertir deshace exactamente lo que alcanzó a hacer.');
    });

    it('retomar una interrumpida: dice cuántos cambios ya se revirtieron y por qué se cortó el intento anterior', async () => {
        await abrirDialogo({
            fila: filaC3b(220, {}, { reversion: reversionResumen({ estado: 'INTERRUMPIDA', hechos: 40, total: 150, error: 'El servidor se reinició.' }) }),
            get: reversionAccion({ cobertura: coberturaReversion({ yaRevertidos: 40 }), reversion: reversionResumen({ estado: 'INTERRUMPIDA', hechos: 40, total: 150, error: 'El servidor se reinició.' }) }),
        });
        await esperar(() => /Se van a deshacer/.test(textoDialogo()), { que: 'la cobertura' });
        expect(textoDialogo()).toContain('Un intento anterior ya revirtió 40 cambios; ahora se deshacen los que faltan.');
        expect(textoDialogo()).toContain('La reversión anterior no terminó: El servidor se reinició.');
    });

    it('si no se puede revertir, el diálogo dice el motivo del backend y no deja confirmar', async () => {
        const texto = 'Esta acción masiva no llegó a cambiar ningún caso: no hay nada que revertir.';
        await abrirDialogo({ get: reversionAccion({ revertible: false, motivo: { code: 'REVERTIR_NADA', texto } }) });
        await esperar(() => textoDialogo().includes(texto), { que: 'el motivo' });
        expect(boton('Revertir', dialogo(/^Revertir acción masiva$/)!)!.disabled).toBe(true);
        expect(textoDialogo()).not.toContain('Se van a deshacer');
    });

    it('si el GET falla, lo dice, deja reintentar y no deja confirmar', async () => {
        await abrirDialogo({ get: { status: 500, body: { message: 'Se cayó la base' } } });
        await esperar(() => textoDialogo().includes('Se cayó la base'), { que: 'el error de lectura' });
        expect(boton('Revertir', dialogo(/^Revertir acción masiva$/)!)!.disabled).toBe(true);
        expect(boton('Reintentar', dialogo(/^Revertir acción masiva$/)!)).not.toBeNull();
    });
});

describe('C3b — pedir la reversión y verla avanzar', () => {
    it('202: cierra, avisa, la fila pasa a «En cola», el socket la lleva a «Revirtiendo 40 %» y «Revertida», con un refetch', async () => {
        await abrirDialogo();
        await esperar(() => /Se van a deshacer/.test(textoDialogo()), { que: 'la cobertura' });
        await confirmar();
        await esperar(() => !dialogo(/^Revertir acción masiva$/), { que: 'el diálogo cerrado' });
        expect(toasts().map((t) => t.texto)).toContain('Reversión en curso: te avisamos al terminar');
        expect(b!.srv.cuantos('POST', /^\/import\/remesas\/220\/reversion$/)).toBe(1);
        expect(b!.srv.cuantos('POST', /revertir-acciones$/)).toBe(0);
        await esperar(() => /En cola/.test(celda()), { que: '«En cola» en la fila' });
        expect(icono('Revertir')!.disabled).toBe(true);
        const lecturas = b!.consultasHistorial();
        b!.pubReversion('accion:revertir:progreso', reversionResumen({ estado: 'REVIRTIENDO', hechos: 60, porcentaje: 40 }));
        await esperar(() => /Revirtiendo 40 %/.test(celda()), { que: '«Revirtiendo 40 %»' });
        expect(b!.consultasHistorial()).toBe(lecturas);
        b!.pubReversion('accion:revertir:terminada', reversionResumen({ estado: 'TERMINADA', hechos: 150, porcentaje: 100, finishedAt: '2026-10-14T20:00:00.000Z' }));
        await esperar(() => /Revertida/.test(celda()), { que: '«Revertida»' });
        await esperar(() => b!.consultasHistorial() > lecturas, { que: 'un refetch al terminar' });
        expect(icono('Revertir')!.disabled).toBe(true);
    });

    it('un evento de otra empresa o de una remesa que no está en la página no toca la fila', async () => {
        await abrirDialogo();
        await clic(boton('Cancelar', dialogo(/^Revertir acción masiva$/)!), 'cancelar');
        b!.srv.emitir('accion:revertir:progreso', reversionResumen({ empresaId: 2, estado: 'REVIRTIENDO', porcentaje: 70 }));
        b!.srv.emitir('accion:revertir:progreso', reversionResumen({ remesaId: 999, estado: 'REVIRTIENDO', porcentaje: 70 }));
        b!.srv.emitir('accion:revertir:progreso', { remesaId: 220, empresaId: 1, estado: 'NO_ES_UN_ESTADO' });
        await pasar(300);
        expect(celda()).not.toMatch(/Revirtiendo|En cola|Revertida/);
    });

    it('una reversión que se interrumpe: «Reversión interrumpida: H de T» y Revertir queda habilitado para seguir', async () => {
        await abrirDialogo();
        await clic(boton('Cancelar', dialogo(/^Revertir acción masiva$/)!), 'cancelar');
        b!.pubReversion('accion:revertir:terminada', reversionResumen({ estado: 'INTERRUMPIDA', hechos: 4_000, total: 15_000, error: 'El servidor se reinició.' }));
        await esperar(() => /Reversión interrumpida: 4\.000 de 15\.000/.test(celda()), { que: 'la fila interrumpida' });
        expect(celda()).toContain('El servidor se reinició.');
        expect(icono('Revertir')!.disabled).toBe(false);
    });

    it('doble clic en Revertir: UN solo pedido', async () => {
        await abrirDialogo({ post: async (id) => { await new Promise((r) => setTimeout(r, 200)); return { status: 202, body: reversionAccion({ remesaId: id, reversion: reversionResumen({ remesaId: id }) }) }; } });
        await esperar(() => /Se van a deshacer/.test(textoDialogo()), { que: 'la cobertura' });
        await esperar(() => !boton('Revertir', dialogo(/^Revertir acción masiva$/)!)?.disabled, { que: 'Revertir habilitado' });
        await dobleClic(boton('Revertir', dialogo(/^Revertir acción masiva$/)!), 'Revertir');
        await pasar(500);
        expect(b!.srv.cuantos('POST', /^\/import\/remesas\/220\/reversion$/)).toBe(1);
    });

    it('200 con TERMINADA (ya estaba revertida): lo dice, sin «reversión en curso»', async () => {
        await abrirDialogo({ post: (id) => ({ status: 200, body: reversionAccion({ remesaId: id, reversion: reversionResumen({ remesaId: id, estado: 'TERMINADA', porcentaje: 100 }), accionRevertidaEn: '2026-10-14T20:00:00.000Z' }) }) });
        await esperar(() => /Se van a deshacer/.test(textoDialogo()), { que: 'la cobertura' });
        await confirmar();
        await esperar(() => toasts().length > 0, { que: 'el aviso' });
        expect(toasts().map((t) => t.texto)).toEqual(['La acción ya estaba revertida']);
    });
});

describe('C3b — los 409 del pedido muestran su texto', () => {
    it.each([
        ['REVERSION_EN_CURSO', 'Esta acción ya se está revirtiendo. Mirá el avance en el Historial.'],
        ['REVERTIR_CARGA_EN_CURSO', 'La acción masiva todavía está corriendo. Cancelala, o esperá a que termine, y después revertila.'],
        ['REVERTIR_NADA', 'Esta acción masiva no llegó a cambiar ningún caso: no hay nada que revertir.'],
        ['REVERTIR_NO_TERMINO', 'Esta acción masiva no terminó bien: los datos para revertirla no se guardaron. Avisá a soporte; no la vuelvas a cargar.'],
        ['REVERTIR_INCOMPLETO', 'Los datos para revertir esta acción no se guardaron completos: Revertir desharía solo una parte. Avisá a soporte.'],
    ])('409 %s: el texto, una sola vez, y el Historial se vuelve a leer', async (code, message) => {
        await abrirDialogo({ post: () => ({ status: 409, body: { statusCode: 409, code, message } }) });
        await esperar(() => /Se van a deshacer/.test(textoDialogo()), { que: 'la cobertura' });
        const lecturas = b!.consultasHistorial();
        await confirmar();
        await esperar(() => errores().length > 0, { que: 'el toast de error' });
        expect(errores()).toEqual([message]);
        await esperar(() => b!.consultasHistorial() > lecturas, { que: 'una lectura nueva del Historial' });
        await esperar(() => !dialogo(/^Revertir acción masiva$/), { que: 'el diálogo cerrado' });
    });

    it('503 REVERSION_NO_ENCOLADA: el texto del backend, no «no llegó la respuesta»', async () => {
        const message = 'No se pudo poner la reversión en la cola. Probá de nuevo en unos minutos; si se repite, avisá a soporte.';
        await abrirDialogo({ post: () => ({ status: 503, body: { statusCode: 503, code: 'REVERSION_NO_ENCOLADA', message } }) });
        await esperar(() => /Se van a deshacer/.test(textoDialogo()), { que: 'la cobertura' });
        await confirmar();
        await esperar(() => errores().length > 0, { que: 'el toast de error' });
        expect(errores()).toEqual([message]);
    });

    it('sin respuesta (corte, o un 502/503/504 sin código): el texto de C3a, "puede seguir corriendo"', async () => {
        const TEXTO = 'No llegó la respuesta del servidor. La reversión puede seguir corriendo: actualizá el Historial en unos minutos antes de volver a intentar.';
        for (const resp of [{ cortar: true }, { status: 504, body: { message: 'Gateway Timeout' } }] as Respuesta[]) {
            await abrirDialogo({ post: () => resp });
            await esperar(() => /Se van a deshacer/.test(textoDialogo()), { que: 'la cobertura' });
            await confirmar();
            await esperar(() => errores().length > 0, { que: 'el toast de error' });
            expect(errores()).toEqual([TEXTO]);
            await b!.v.desmontar(); await b!.srv.bajar(); b = null;
        }
    });
});

describe('C3b — con un backend anterior (la fila no trae `reversion`) queda el camino de C3a', () => {
    it('Revertir usa el endpoint viejo, con su diálogo y su mensaje; no pide el GET nuevo', async () => {
        b = await armarHistorial({ items: [fila(220)], antes: (bb) => { bb.srv.en('POST', /^\/import\/remesas\/(\d+)\/revertir-acciones$/, () => ({ body: { deudoresRevertidos: 4, contactosRestaurados: 1, comentariosBorrados: 2 } })); } });
        await listaDibujada(b);
        await clic(icono('Revertir'), 'revertir');
        const d = await esperar(() => dialogo(/^Revertir acción masiva$/), { que: 'el diálogo de revertir' });
        expect(limpio(d.textContent ?? '')).toContain('Se deshacen los cambios de esta acción masiva volviendo a los valores previos');
        expect(b.srv.cuantos('GET', /reversion$/)).toBe(0);
        await clic(boton('Revertir', d), 'Revertir');
        await esperar(() => toasts().length > 0, { que: 'el aviso' });
        expect(toasts().map((t) => t.texto)).toEqual(['Acción revertida (4 deudores, 1 contactos restaurados, 2 comentarios borrados)']);
        expect(b.srv.cuantos('POST', /revertir-acciones$/)).toBe(1);
        expect(b.srv.cuantos('POST', /\/reversion$/)).toBe(0);
    });

    it('una FALLIDA de un backend anterior no ofrece Revertir', async () => {
        b = await armarHistorial({ items: [fila(220, canceladaC1({ tipo: 'ACCIONES', usuarioId: 3 }))] });
        await listaDibujada(b);
        expect(icono('Revertir')).toBeNull();
    });
});
