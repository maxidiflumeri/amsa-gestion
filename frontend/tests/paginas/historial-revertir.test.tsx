// C3a: Revertir una acción masiva desde el Historial, con los 409 nuevos y con un pedido que no responde
// (docs/imports-progreso-c3-spec.md §4.4 y §6.3).
import { afterEach, describe, expect, it } from 'vitest';
import { armarHistorial, listaDibujada, type BancoHistorial } from '../lib/banco-historial';
import { itemHistorial, terminalC1, type Sobre } from '../lib/fabricas';
import { boton, clic, dialogo, esperar, toasts } from '../lib/montar';
import type { Respuesta } from '../lib/servidor-falso';

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
