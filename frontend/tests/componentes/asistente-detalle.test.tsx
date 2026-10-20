// Asistente de IA, el detalle de cada respuesta: el desplegable, el interruptor, la medición del navegador y las respuestas viejas
// (docs/asistente-detalle-spec.md §12 y §14.2).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversacionDetalle } from '@fe/types/asistente';
import { boton, clic, esperar, limpio, pasar, toasts } from '../lib/montar';
import {
    PERMISOS_DETALLE_IA, PERMISOS_IA, TIEMPOS_MENSAJE, abrirPanel, armarIA, bajarIA, botonDetener, botonEnviar, burbujas, detalleIA, ev, fuente,
    preguntarAlAsistente, respuestaSse, type BancoIA,
} from '../lib/banco-ia';

let b: BancoIA | null = null;
afterEach(async () => {
    vi.restoreAllMocks();
    await bajarIA(b);
    b = null;
});

const esperarTerminada = () => esperar(() => botonEnviar() && !botonDetener(), { que: 'la respuesta terminada' });
const bloque = () => document.querySelector<HTMLElement>('[data-testid="detalle-respuesta"]');
const botonDelDetalle = () => bloque()?.querySelector<HTMLButtonElement>(':scope > button') ?? null;
const filas = () => Array.from(bloque()?.querySelectorAll('li') ?? []);
const etiquetas = () => filas().map((f) => f.getAttribute('aria-label'));
const menuDelPanel = () => document.querySelector('button[aria-label="Más opciones"]');
const itemDelDetalle = () => Array.from(document.querySelectorAll('li[role="menuitemcheckbox"]')).find((x) => /Mostrar el detalle de las respuestas/.test(x.textContent ?? '')) ?? null;
const conDetalle = (detalle = detalleIA(), texto = 'Listo.') => () => respuestaSse([ev.inicio(), ev.texto(texto), ev.fin(texto, { detalle })], 20);

async function preguntarYEsperar(texto = 'armame un reporte') {
    await abrirPanel();
    await preguntarAlAsistente(texto);
    await esperarTerminada();
}
async function abrirMenu() {
    await clic(menuDelPanel(), 'el menú');
    await esperar(() => document.querySelector('[role="menu"]'), { que: 'el menú abierto' });
}

describe('El desplegable', () => {
    it('con el permiso, después de «fin» con detalle aparece «Ver detalle · 18,3 s · USD 0,027», debajo de 👍/👎 y cerrado', async () => {
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = conDetalle();
        await preguntarYEsperar();
        expect(limpio(botonDelDetalle()!.textContent ?? '')).toBe('Ver detalle · 18,3 s · USD 0,027');
        expect(botonDelDetalle()!.getAttribute('aria-expanded')).toBe('false');
        expect(filas()).toHaveLength(0);
        // Al final de la burbuja: después de la calificación.
        const burbuja = document.querySelector('[data-testid="burbuja-asistente"]')!;
        expect(burbuja.lastElementChild).toBe(bloque());
        expect(burbuja.querySelector('button[aria-label="No me sirvió"]')).not.toBeNull();
    });

    it('al abrir, las filas del caso dorado en orden, con la preparación cerrada y la cabecera con el modelo y cómo terminó', async () => {
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = conDetalle();
        await preguntarYEsperar();
        await clic(botonDelDetalle(), 'Ver detalle');
        await esperar(() => filas().length > 0, { que: 'las filas' });
        expect(botonDelDetalle()!.getAttribute('aria-expanded')).toBe('true');
        expect(limpio(bloque()!.textContent ?? '')).toContain('Total 18,3 s · USD 0,027 · Sonnet 5.5 · terminó bien');
        expect(etiquetas()).toEqual([
            'Preparación, 0,3 segundos',
            'Llamada 1, 6,1 segundos, USD 0,017',
            'Espera del primer token, 1,2 segundos, USD 0,010',
            'Razonamiento (412 tokens), 3,4 segundos, USD 0,0045',
            'Pide «probar_plantilla» (180 tokens), 1,5 segundos, USD 0,0020',
            'Herramienta probar_plantilla (base), 4,8 segundos',
            'Validación, menos de 0,1 segundos',
            'Espera de lugar en la base, menos de 0,1 segundos',
            'Muestra (100 casos), 3,1 segundos, en paralelo',
            'Conteo de casos, 4,7 segundos, en paralelo',
            'Llamada 2, 7,0 segundos, USD 0,0096',
            'Espera del primer token, 0,9 segundos, USD 0,0028',
            'Razonamiento (230 tokens), 3,2 segundos, USD 0,0025',
            'Respuesta (380 tokens), 2,9 segundos, USD 0,0042',
            'Guardar, 0,1 segundos',
        ]);
        // La preparación no mostró sus partes; al abrirla aparecen.
        expect(filas().some((f) => /^Topes y límite del día/.test(f.getAttribute('aria-label') ?? ''))).toBe(false);
        const abrirPreparacion = filas()[0].querySelector<HTMLButtonElement>(':scope > div > button')!;
        expect(abrirPreparacion.getAttribute('aria-expanded')).toBe('false');
        await clic(abrirPreparacion, 'Preparación');
        await esperar(() => etiquetas().includes('Armado del pedido, 0,2 segundos'), { que: 'las partes de la preparación' });
        expect(etiquetas().slice(1, 4)).toEqual(['Topes y límite del día, menos de 0,1 segundos', 'Conversación e historial, 0,1 segundos', 'Armado del pedido, 0,2 segundos']);
    });

    it('«en paralelo» solo en la muestra y el conteo; las líneas chicas dicen lo que hizo cada paso', async () => {
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = conDetalle();
        await preguntarYEsperar();
        await clic(botonDelDetalle(), 'Ver detalle');
        await esperar(() => filas().length > 0, { que: 'las filas' });
        const texto = limpio(bloque()!.textContent ?? '');
        expect(texto.match(/en paralelo/g)).toHaveLength(2);
        expect(texto).toContain('Muestra (100 casos) · en paralelo');
        expect(texto).toContain('Conteo de casos · en paralelo');
        expect(texto).toContain('Probé la plantilla: 8.412 casos, sin errores · ≈ 310 tokens a la llamada 2');
        expect(texto).toContain('lee 14.880 tokens · 76 % de caché');
        expect(texto).toContain('lee 15.172 tokens · 97 % de caché');
    });

    it('las barras de la cascada son decorativas (aria-hidden), una por fila', async () => {
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = conDetalle();
        await preguntarYEsperar();
        await clic(botonDelDetalle(), 'Ver detalle');
        await esperar(() => filas().length > 0, { que: 'las filas' });
        for (const f of filas()) expect(f.querySelector(':scope > div[aria-hidden="true"]'), f.getAttribute('aria-label') ?? '').not.toBeNull();
    });

    it('lo que salió de un reparto lleva «≈» (con «aproximado» para el lector de pantalla)', async () => {
        const detalle = detalleIA();
        const llamada = detalle.nodos[1];
        llamada.hijos = llamada.hijos!.map((h) => (h.tipo === 'razonamiento' ? { ...h, estimado: true } : h));
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = conDetalle(detalle);
        await preguntarYEsperar();
        await clic(botonDelDetalle(), 'Ver detalle');
        await esperar(() => filas().length > 0, { que: 'las filas' });
        const fila = filas().find((f) => /^Razonamiento/.test(f.getAttribute('aria-label') ?? ''))!;
        expect(fila.getAttribute('aria-label')).toBe('Razonamiento (aproximadamente 412 tokens), 3,4 segundos, aproximadamente USD 0,0045');
        expect(limpio(fila.textContent ?? '')).toContain('Razonamiento (≈ 412 tokens)');
        expect(limpio(fila.textContent ?? '')).toContain('≈ aproximado USD 0,0045');
    });

    it('un razonamiento sin tiempo propio muestra «—» y la espera dice que lo incluye', async () => {
        const detalle = detalleIA();
        detalle.nodos[1].hijos = [
            { tipo: 'espera', desdeMs: 300, ms: 4_600, tokens: 14_880, costoUsd: 0.010439, incluyeRazonamiento: true },
            { tipo: 'razonamiento', desdeMs: 4_900, ms: 0, tokens: 412, costoUsd: 0.004532, sinTiempoPropio: true },
            { tipo: 'pedido', desdeMs: 4_900, ms: 1_500, nombre: 'probar_plantilla', tokens: 180, costoUsd: 0.00198 },
        ];
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = conDetalle(detalle);
        await preguntarYEsperar();
        await clic(botonDelDetalle(), 'Ver detalle');
        await esperar(() => filas().length > 0, { que: 'las filas' });
        const texto = limpio(bloque()!.textContent ?? '');
        expect(texto).toContain('Espera del primer token (incluye el razonamiento)');
        const razonamiento = filas().find((f) => /^Razonamiento/.test(f.getAttribute('aria-label') ?? ''))!;
        expect(razonamiento.getAttribute('aria-label')).toBe('Razonamiento (412 tokens), sin tiempo propio, USD 0,0045');
        expect(limpio(razonamiento.textContent ?? '')).toContain('—');
    });

    it('«fin» sin «detalle» (la clave no viene) no dibuja nada ni rompe la pantalla', async () => {
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        await preguntarYEsperar();
        expect(bloque()).toBeNull();
        expect(burbujas()[0]).toContain('Respuesta de prueba.');
    });

    it('«error» con detalle: la cabecera dice por qué falló', async () => {
        const detalle = detalleIA({ estado: 'error', motivo: 'modelo_no_disponible', costoUsd: 0, llamadas: 1, nodos: [{ tipo: 'llamada', desdeMs: 0, ms: 3_000, numero: 1, fin: 'error', error: 'RateLimitError', hijos: [{ tipo: 'espera', desdeMs: 0, ms: 3_000 }] }], totalMs: 3_000 });
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = () => respuestaSse([ev.inicio(), ev.error({ mensajeId: 102, detalle })], 20);
        await preguntarYEsperar();
        expect(limpio(botonDelDetalle()!.textContent ?? '')).toBe('Ver detalle · 3,0 s');
        await clic(botonDelDetalle(), 'Ver detalle');
        await esperar(() => filas().length > 0, { que: 'las filas' });
        expect(limpio(bloque()!.textContent ?? '')).toContain('Total 3,0 s · Sonnet 5.5 · El modelo no estaba disponible');
        expect(etiquetas()[0]).toBe('Llamada 1 · falló (RateLimitError), 3,0 segundos');
    });

    it('una falla interna rotula «quedó abierta» a la llamada; un tope con la respuesta completa no dice «Cortada»; lo recortado muestra su texto', async () => {
        const detalle = detalleIA({ estado: 'ok', motivo: 'tope_turno', recortado: true });
        detalle.nodos = [
            { tipo: 'llamada', desdeMs: 0, ms: 1_000, numero: 1, fin: 'abortada', cortado: true },
            { tipo: 'otros', desdeMs: 1_000, ms: 0, descripcion: '7 pasos más sin mostrar' },
        ];
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = conDetalle(detalle);
        await preguntarYEsperar();
        await clic(botonDelDetalle(), 'Ver detalle');
        await esperar(() => filas().length > 0, { que: 'las filas' });
        const texto = limpio(bloque()!.textContent ?? '');
        expect(texto).toContain('terminó bien; la última llamada no se hizo por el tope de gasto de la respuesta');
        expect(texto).not.toContain('Cortada');
        expect(texto).toContain('7 pasos más sin mostrar');
        expect(texto).not.toContain('Otros (sin medir)');
        // Con la falla interna, la llamada sin cierre sigue rotulada «quedó abierta», nunca «detenida».
        await bajarIA(b);
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = conDetalle({ ...detalle, estado: 'error', motivo: 'interno' });
        await preguntarYEsperar();
        await clic(botonDelDetalle(), 'Ver detalle');
        await esperar(() => filas().length > 0, { que: 'las filas' });
        expect(etiquetas()[0]).toBe('Llamada 1 · quedó abierta, 1,0 segundos');
        expect(limpio(bloque()!.textContent ?? '')).not.toContain('detenida');
    });

    it('en un detalle parcial, el razonamiento sin tiempo propio apunta a la llamada, no a una espera que no está', async () => {
        const detalle = detalleIA({ parcial: true });
        detalle.nodos = [
            {
                tipo: 'llamada', desdeMs: 0, ms: 2_000, numero: 1, fin: 'end_turn',
                hijos: [{ tipo: 'razonamiento', desdeMs: 0, ms: 0, tokens: 300, sinTiempoPropio: true }],
            },
        ];
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = conDetalle(detalle);
        await preguntarYEsperar();
        await clic(botonDelDetalle(), 'Ver detalle');
        await esperar(() => filas().length > 0, { que: 'las filas' });
        const texto = limpio(bloque()!.textContent ?? '');
        expect(texto).toContain('Su tiempo está dentro de la llamada.');
        expect(texto).not.toContain('dentro de la espera');
    });

    it('una respuesta sin texto del modelo trae su aviso', async () => {
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = conDetalle(detalleIA({ motivo: 'respuesta_vacia' }));
        await preguntarYEsperar();
        await clic(botonDelDetalle(), 'Ver detalle');
        await esperar(() => /El modelo no devolvió texto/.test(bloque()?.textContent ?? ''), { que: 'el aviso' });
    });

    it('«recortado» e «incompleto» traen su aviso', async () => {
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = conDetalle(detalleIA({ recortado: true, incompleto: true }));
        await preguntarYEsperar();
        await clic(botonDelDetalle(), 'Ver detalle');
        await esperar(() => /El detalle es muy largo/.test(bloque()?.textContent ?? ''), { que: 'el aviso' });
        expect(limpio(bloque()!.textContent ?? '')).toContain('Falta una parte del detalle: no se pudo medir todo.');
    });

    it('una respuesta en curso no muestra el detalle', async () => {
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = () => respuestaSse([ev.inicio(), ev.texto('Escribiendo…')], 20, { cerrar: false });
        await abrirPanel();
        await preguntarAlAsistente('algo');
        await esperar(() => botonDetener(), { que: 'Detener' });
        await pasar(150);
        expect(bloque()).toBeNull();
        await clic(botonDetener(), 'Detener');
        await esperarTerminada();
    });
});

describe('Quién lo ve', () => {
    it('sin el permiso no hay desplegable ni interruptor, aunque el servidor mandara el detalle', async () => {
        b = await armarIA({ permisos: PERMISOS_IA });
        b.preguntar = conDetalle();
        await preguntarYEsperar();
        expect(bloque()).toBeNull();
        expect(boton(/Ver detalle/)).toBeNull();
        await abrirMenu();
        expect(itemDelDetalle()).toBeNull();
        expect(limpio(document.body.textContent ?? '')).not.toContain('Mostrar el detalle de las respuestas');
    });

    it('con el permiso, el menú trae el interruptor encendido', async () => {
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        await abrirPanel();
        await abrirMenu();
        expect(itemDelDetalle()!.getAttribute('aria-checked')).toBe('true');
    });
});

describe('El interruptor', () => {
    it('apagado no hay desplegable, se recuerda en el navegador y al remontar sigue apagado', async () => {
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = conDetalle();
        await preguntarYEsperar();
        expect(bloque()).not.toBeNull();
        await abrirMenu();
        await clic(itemDelDetalle(), 'el interruptor');
        await esperar(() => bloque() === null, { que: 'el desplegable apagado' });
        expect(localStorage.getItem('amsa_asistente_detalle')).toBe('0');
        expect(itemDelDetalle()!.getAttribute('aria-checked')).toBe('false');

        // Volver a encenderlo lo trae de nuevo.
        await clic(itemDelDetalle(), 'el interruptor');
        await esperar(() => bloque() !== null, { que: 'el desplegable encendido' });
        expect(localStorage.getItem('amsa_asistente_detalle')).toBe('1');
        await clic(itemDelDetalle(), 'el interruptor');
        await esperar(() => bloque() === null, { que: 'el desplegable apagado otra vez' });

        // Remontar (otra pestaña, otra sesión): sigue apagado.
        await bajarIA(b);
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = conDetalle();
        await preguntarYEsperar();
        expect(bloque()).toBeNull();
        await abrirMenu();
        expect(itemDelDetalle()!.getAttribute('aria-checked')).toBe('false');
    });

    it('con localStorage que tira error al leer y al escribir, arranca encendido y el interruptor anda en memoria', async () => {
        const getItem = Storage.prototype.getItem;
        const setItem = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, k: string) {
            if (k === 'amsa_asistente_detalle') throw new Error('SecurityError');
            return getItem.call(this, k);
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
            if (k === 'amsa_asistente_detalle') throw new Error('QuotaExceededError');
            return setItem.call(this, k, v);
        });
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = conDetalle();
        await preguntarYEsperar();
        expect(bloque()).not.toBeNull();
        await abrirMenu();
        await clic(itemDelDetalle(), 'el interruptor');
        await esperar(() => bloque() === null, { que: 'el desplegable apagado aunque no se pueda guardar' });
    });
});

describe('Al reabrir una conversación', () => {
    // Como el servidor real de antes del Fase B: sin `pasos`, `propuestas` ni `adjuntos` (el panel los completa).
    const conversacion = (detalle: ReturnType<typeof detalleIA> | undefined): ConversacionDetalle => ({
        id: 41, titulo: 'Armame un reporte', turnos: 1, updatedAt: '2026-10-14T15:00:00.000Z', funcion: 'ayuda' as const,
        mensajes: [
            { id: 1, rol: 'usuario' as const, texto: 'Armame un reporte', ruta: '/gestion', fuentes: [], acciones: [], estado: 'ok' as const, calificacion: null, createdAt: '2026-10-14T15:00:00.000Z' },
            {
                id: 2, rol: 'asistente' as const, texto: 'Listo, ahí lo tenés.', ruta: null, fuentes: [fuente()], acciones: [], estado: 'ok' as const, calificacion: null,
                createdAt: '2026-10-14T15:00:01.000Z', ...(detalle ? { detalle } : {}),
            },
        ],
    } as unknown as ConversacionDetalle);
    async function reabrir() {
        await abrirPanel();
        await clic(menuDelPanel(), 'el menú');
        const item = await esperar(() => Array.from(document.querySelectorAll('li[role="menuitem"]')).find((x) => /Armame/.test(x.textContent ?? '')), { que: 'la conversación' });
        await clic(item, 'la conversación');
        await esperar(() => burbujas().length === 1, { que: 'la conversación abierta' });
    }
    const lista = [{ id: 41, titulo: 'Armame un reporte', turnos: 1, updatedAt: '2026-10-14T15:00:00.000Z', funcion: 'ayuda' as const }];

    it('muestra el detalle que trae «GET conversaciones/:id», con la línea del navegador que ya estaba guardada', async () => {
        const detalle = detalleIA({ navegador: { primeraSenalMs: 900, primerTextoMs: 18_500, totalMs: 18_600 } });
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA, conversaciones: lista, detalles: [conversacion(detalle)] });
        await reabrir();
        expect(limpio(botonDelDetalle()!.textContent ?? '')).toBe('Ver detalle · 18,3 s · USD 0,027');
        await clic(botonDelDetalle(), 'Ver detalle');
        await esperar(() => filas().length > 0, { que: 'las filas' });
        expect(limpio(bloque()!.textContent ?? '')).toContain('En tu navegador: primer texto a los 18,5 s · completa a los 18,6 s');
    });

    it('un detalle «parcial» lo dice en el botón y en un aviso', async () => {
        const parcial = detalleIA({
            parcial: true, nodos: [
                { tipo: 'llamada', desdeMs: 0, ms: 6_100, numero: 1, costoUsd: 0.016951 },
                { tipo: 'sin_detalle', desdeMs: 6_100, ms: 5_000 },
                { tipo: 'llamada', desdeMs: 11_100, ms: 7_000, numero: 2, costoUsd: 0.009559 },
            ],
        });
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA, conversaciones: lista, detalles: [conversacion(parcial)] });
        await reabrir();
        expect(limpio(botonDelDetalle()!.textContent ?? '')).toBe('Ver detalle (parcial) · 18,3 s · USD 0,027');
        await clic(botonDelDetalle(), 'Ver detalle');
        await esperar(() => filas().length > 0, { que: 'las filas' });
        expect(limpio(bloque()!.textContent ?? '')).toContain('Detalle parcial: solo las llamadas al modelo.');
        expect(etiquetas()).toContain('Herramientas y otros (sin detalle), 5,0 segundos');
    });

    it('un mensaje sin la clave «detalle» (sin el permiso, o en curso) no dibuja nada', async () => {
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA, conversaciones: lista, detalles: [conversacion(undefined)] });
        await reabrir();
        expect(bloque()).toBeNull();
        expect(burbujas()[0]).toContain('Listo, ahí lo tenés.');
    });

    it('con el detalle en el JSON pero sin el permiso, no se ve', async () => {
        b = await armarIA({ permisos: PERMISOS_IA, conversaciones: lista, detalles: [conversacion(detalleIA())] });
        await reabrir();
        expect(bloque()).toBeNull();
    });
});

describe('El tiempo percibido en el navegador', () => {
    const cuerpoTiempos = () => b!.cuerpos('POST', TIEMPOS_MENSAJE)[0] as { primeraSenalMs: number | null; primerTextoMs: number | null; totalMs: number };

    it('después de «fin» manda «POST …/tiempos» con números enteros y coherentes', async () => {
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = () => respuestaSse([ev.inicio(), ev.herramienta('reportes/armar-un-reporte', 'Armar un reporte'), ev.texto('Listo.'), ev.fin('Listo.', { detalle: detalleIA() })], 60);
        await preguntarYEsperar();
        await esperar(() => b!.srv.cuantos('POST', TIEMPOS_MENSAJE) === 1, { que: 'el aviso de tiempos' });
        expect(b.srv.de('POST', TIEMPOS_MENSAJE)[0].ruta).toBe('/asistente/mensajes/102/tiempos');
        const t = cuerpoTiempos();
        for (const n of [t.primeraSenalMs, t.primerTextoMs, t.totalMs]) expect(Number.isInteger(n)).toBe(true);
        expect(t.primeraSenalMs!).toBeGreaterThanOrEqual(0);
        // La primera señal fue la herramienta; el texto vino después; el final, al último.
        expect(t.primerTextoMs!).toBeGreaterThanOrEqual(t.primeraSenalMs!);
        expect(t.totalMs).toBeGreaterThanOrEqual(t.primerTextoMs!);
        expect(t.totalMs).toBeLessThanOrEqual(900_000);
    });

    it('también lo manda quien NO tiene el permiso (la tabla de Consumo representa a toda la gente)', async () => {
        b = await armarIA({ permisos: PERMISOS_IA });
        await preguntarYEsperar();
        await esperar(() => b!.srv.cuantos('POST', TIEMPOS_MENSAJE) === 1, { que: 'el aviso de tiempos' });
        const t = cuerpoTiempos();
        expect(t.primerTextoMs!).toBeLessThanOrEqual(t.totalMs);
        expect(t.primeraSenalMs!).toBeLessThanOrEqual(t.primerTextoMs!);
    });

    it('una respuesta sin texto manda el primer texto en null', async () => {
        b = await armarIA({ permisos: PERMISOS_IA });
        b.preguntar = () => respuestaSse([ev.inicio(), ev.fin('Listo.')], 20);
        await preguntarYEsperar();
        await esperar(() => b!.srv.cuantos('POST', TIEMPOS_MENSAJE) === 1, { que: 'el aviso de tiempos' });
        expect(cuerpoTiempos().primerTextoMs).toBeNull();
        expect(cuerpoTiempos().primeraSenalMs).toBeNull();
    });

    it('un «error» con mensajeId también lo manda; sin mensajeId, no', async () => {
        b = await armarIA({ permisos: PERMISOS_IA });
        b.preguntar = () => respuestaSse([ev.inicio(), ev.error({ mensajeId: 102 })], 20);
        await preguntarYEsperar();
        await esperar(() => b!.srv.cuantos('POST', TIEMPOS_MENSAJE) === 1, { que: 'el aviso de tiempos' });
        await bajarIA(b);

        b = await armarIA({ permisos: PERMISOS_IA });
        b.preguntar = () => respuestaSse([ev.inicio(), ev.error()], 20);
        await preguntarYEsperar();
        await pasar(300);
        expect(b.srv.cuantos('POST', TIEMPOS_MENSAJE)).toBe(0);
    });

    it('con «Detener» no se manda: ese total no es lo que tardó la respuesta', async () => {
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = () => respuestaSse([ev.inicio(), ev.texto('Escribiendo…')], 20, { cerrar: false });
        await abrirPanel();
        await preguntarAlAsistente('algo');
        await esperar(() => botonDetener(), { que: 'Detener' });
        await clic(botonDetener(), 'Detener');
        await esperarTerminada();
        await pasar(300);
        expect(b.srv.cuantos('POST', TIEMPOS_MENSAJE)).toBe(0);
    });

    it('si el servidor rechaza el aviso de tiempos, la respuesta queda igual y no hay toast', async () => {
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = conDetalle();
        b.tiempos = () => ({ status: 500, body: { message: 'Internal server error' } });
        await preguntarYEsperar();
        await esperar(() => b!.srv.cuantos('POST', TIEMPOS_MENSAJE) === 1, { que: 'el aviso de tiempos' });
        await pasar(200);
        expect(bloque()).not.toBeNull();
        expect(toasts()).toEqual([]);
    });

    it('la línea «En tu navegador» aparece en vivo, cuando termina la respuesta', async () => {
        b = await armarIA({ permisos: PERMISOS_DETALLE_IA });
        b.preguntar = conDetalle();
        await preguntarYEsperar();
        await clic(botonDelDetalle(), 'Ver detalle');
        await esperar(() => /En tu navegador: primer texto a los .+ · completa a los .+/.test(bloque()?.textContent ?? ''), { que: 'la línea del navegador' });
    });
});
