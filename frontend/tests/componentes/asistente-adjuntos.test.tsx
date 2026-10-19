// Asistente de IA, Fase B: los ejemplos que se adjuntan en el panel (docs/asistente-reportes-spec.md §6.1, §9, §16.1 y §20.2).
import { afterEach, describe, expect, it } from 'vitest';
import { boton, clic, dormir, elegirArchivos, esperar, limpio, pasar, toasts } from '../lib/montar';
import { multipart } from '../lib/servidor-falso';
import {
    PERMISOS_REPORTES_IA, PREGUNTAR, ADJUNTO, ADJUNTOS, abrirPanel, adjuntoIA, armarIA, bajarIA, botonDetener, botonEnviar, entrada,
    escribirPregunta, ev, panel, preguntarAlAsistente, respuestaSse, type BancoIA,
} from '../lib/banco-ia';

let b: BancoIA | null = null;
afterEach(async () => { await bajarIA(b); b = null; });

const archivo = (nombre = 'ejemplo.xlsx', bytes = 64) => new File([new Uint8Array(bytes)], nombre, { type: 'application/octet-stream' });
const entradaArchivos = () => document.querySelector<HTMLInputElement>('[data-testid="entrada-archivos"]');
const chips = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="adjuntos-pendientes"] [data-testid="adjunto-chip"]'));
const textoChips = () => chips().map((c) => limpio(c.textContent ?? ''));
const esperarTerminada = () => esperar(() => botonEnviar() && !botonDetener(), { que: 'la respuesta terminada' });

async function armar(over: Parameters<typeof armarIA>[0] = {}) {
    b = await armarIA({ permisos: PERMISOS_REPORTES_IA, ...over });
    await abrirPanel();
    await clic(boton('Armar un reporte'), 'Armar un reporte');
    await esperar(() => entradaArchivos(), { que: 'el selector de archivos' });
    return b;
}
const abrirMenu = async (i = 0) => {
    await clic(chips()[i].querySelector('button[aria-label^="Opciones de"]'), 'las opciones del archivo');
    await esperar(() => document.querySelector('li[role="menuitem"]'), { que: 'el menú' });
};
const itemMenu = (re: RegExp) => Array.from(document.querySelectorAll('li[role="menuitem"]')).find((x) => re.test(x.textContent ?? '')) ?? null;

describe('Subir un ejemplo', () => {
    it('manda el archivo en el campo «archivo» y el chip dice tipo, nombre y cantidad de columnas', async () => {
        await armar();
        await elegirArchivos(entradaArchivos(), [archivo('ejemplo_cartera_toyota.xlsx')]);
        await esperar(() => b!.srv.cuantos('POST', ADJUNTOS) === 1, { que: 'la subida' });
        const pedido = b!.srv.de('POST', ADJUNTOS)[0];
        expect(pedido.tipo).toContain('multipart/form-data');
        expect(pedido.autorizacion).toBe('Bearer token-de-prueba');
        const m = multipart(pedido);
        expect(m.archivo).toMatchObject({ campo: 'archivo', nombre: 'ejemplo_cartera_toyota.xlsx', bytes: 64 });
        await esperar(() => textoChips().some((t) => t.includes('XLSX · ejemplo_cartera_toyota.xlsx · 9 columnas')), { que: 'el chip' });
        expect(textoChips()[0]).toContain('Columnas: DNI · Cliente · Saldo');
        expect(chips()[0].getAttribute('data-estado')).toBe('listo');
    });

    it('mientras sube dice «Subiendo» y no deja mandar; al terminar sí', async () => {
        await armar();
        b!.subirAdjunto = async () => { await dormir(500); return { status: 201, body: adjuntoIA() }; };
        await elegirArchivos(entradaArchivos(), [archivo()]);
        await esperar(() => chips()[0]?.getAttribute('data-estado') === 'subiendo', { que: 'el chip subiendo' });
        expect(textoChips()[0]).toContain('Subiendo «ejemplo.xlsx»');
        await escribirPregunta('Armame esto');
        expect(botonEnviar()!.disabled).toBe(true);
        await esperar(() => chips()[0]?.getAttribute('data-estado') === 'listo', { que: 'el chip listo' });
        expect(botonEnviar()!.disabled).toBe(false);
    });

    it('un 400 muestra el mensaje del backend en rojo y el cuadro de texto sigue activo', async () => {
        await armar();
        b!.subirAdjunto = () => ({ status: 400, body: { codigo: 'TIPO_NO_SOPORTADO', mensaje: 'Los archivos .xlsm no se leen: guardalo como .xlsx.', message: 'x' } });
        await elegirArchivos(entradaArchivos(), [archivo('macro.xlsm')]);
        await esperar(() => chips()[0]?.getAttribute('data-estado') === 'error', { que: 'el chip con error' });
        expect(textoChips()[0]).toContain('Los archivos .xlsm no se leen: guardalo como .xlsx.');
        expect(chips()[0].querySelector('[role="alert"]')).not.toBeNull();
        expect(entrada()!.disabled).toBe(false);
        await escribirPregunta('sigo escribiendo');
        expect(botonEnviar()!.disabled).toBe(false);
    });

    it('un 413 también', async () => {
        await armar();
        b!.subirAdjunto = () => ({ status: 413, body: { codigo: 'DEMASIADO_GRANDE', mensaje: 'El archivo pesa más de 5 MB.', message: 'x' } });
        await elegirArchivos(entradaArchivos(), [archivo('grande.csv')]);
        await esperar(() => textoChips().some((t) => t.includes('El archivo pesa más de 5 MB.')), { que: 'el mensaje del 413' });
    });

    it('un error sin cuerpo útil dice qué archivo falló', async () => {
        await armar();
        b!.subirAdjunto = () => ({ status: 500, body: {} });
        await elegirArchivos(entradaArchivos(), [archivo('raro.csv')]);
        await esperar(() => textoChips().some((t) => t.includes('No se pudo subir «raro.csv». Probá de nuevo.')), { que: 'el mensaje genérico' });
    });

    it('un archivo de más de 5 MB ni se sube; y el cuarto de un mensaje se rechaza', async () => {
        await armar();
        const enorme = archivo('enorme.csv', 10);
        Object.defineProperty(enorme, 'size', { value: 6 * 1024 * 1024 });
        await elegirArchivos(entradaArchivos(), [enorme]);
        await esperar(() => textoChips().some((t) => t.includes('pesa más de 5 MB')), { que: 'el rechazo local' });
        expect(b!.srv.cuantos('POST', ADJUNTOS)).toBe(0);

        await elegirArchivos(entradaArchivos(), [archivo('a.csv'), archivo('b.csv'), archivo('c.csv'), archivo('d.csv')]);
        await esperar(() => b!.srv.cuantos('POST', ADJUNTOS) === 3, { que: 'las tres subidas' });
        await esperar(() => textoChips().some((t) => t.includes('hasta 3 archivos por mensaje')), { que: 'el aviso del cuarto' });
        expect(b!.srv.cuantos('POST', ADJUNTOS)).toBe(3);
    });

    it('los avisos del archivo se ven debajo del chip', async () => {
        await armar();
        b!.subirAdjunto = () => ({ status: 201, body: adjuntoIA({ avisos: ['Se leyó la hoja «Datos»; las otras 2 hojas se ignoraron.'] }) });
        await elegirArchivos(entradaArchivos(), [archivo()]);
        await esperar(() => textoChips().some((t) => t.includes('las otras 2 hojas se ignoraron')), { que: 'el aviso' });
    });
});

describe('Quitar y corregir', () => {
    it('«Quitar» saca el chip y borra el archivo del servidor', async () => {
        await armar();
        await elegirArchivos(entradaArchivos(), [archivo()]);
        await esperar(() => chips()[0]?.getAttribute('data-estado') === 'listo', { que: 'el chip listo' });
        await abrirMenu();
        await clic(itemMenu(/^Quitar$/), 'Quitar');
        await esperar(() => chips().length === 0, { que: 'el chip fuera' });
        await esperar(() => b!.srv.cuantos('DELETE', ADJUNTO) === 1, { que: 'el borrado' });
        expect(b!.srv.de('DELETE', ADJUNTO)[0].ruta).toBe('/asistente/adjuntos/501');
    });

    it('«La primera fila no es el encabezado» hace PATCH y el menú ofrece volver atrás', async () => {
        await armar();
        await elegirArchivos(entradaArchivos(), [archivo()]);
        await esperar(() => chips()[0]?.getAttribute('data-estado') === 'listo', { que: 'el chip listo' });
        await abrirMenu();
        await clic(itemMenu(/La primera fila no es el encabezado/), 'La primera fila no es el encabezado');
        await esperar(() => b!.srv.cuantos('PATCH', ADJUNTO) === 1, { que: 'el PATCH' });
        expect(b!.cuerpos('PATCH', ADJUNTO)[0]).toEqual({ primeraFilaEsEncabezado: false });
        expect(b!.srv.de('PATCH', ADJUNTO)[0].ruta).toBe('/asistente/adjuntos/501');
        await esperar(() => chips()[0]?.getAttribute('data-estado') === 'listo', { que: 'el chip de nuevo listo' });
        await abrirMenu();
        // Volver atrás no se puede (el resumen no guarda la primera fila): el menú manda a subir el archivo de nuevo.
        const aviso = itemMenu(/volvé a subir el archivo/)!;
        expect(aviso.getAttribute('aria-disabled')).toBe('true');
        expect(itemMenu(/^La primera fila no es el encabezado$/)).toBeNull();
    });

    it('un 409 al corregir avisa y deja el chip como estaba', async () => {
        await armar();
        await elegirArchivos(entradaArchivos(), [archivo()]);
        await esperar(() => chips()[0]?.getAttribute('data-estado') === 'listo', { que: 'el chip listo' });
        b!.parchearAdjunto = () => ({ status: 409, body: { codigo: 'YA_ENVIADO', mensaje: 'Ese archivo ya se mandó.', message: 'x' } });
        await abrirMenu();
        await clic(itemMenu(/La primera fila no es el encabezado/), 'La primera fila no es el encabezado');
        await esperar(() => b!.srv.cuantos('PATCH', ADJUNTO) === 1, { que: 'el PATCH' });
        await esperar(() => toasts().some((t) => t.variante === 'error'), { que: 'el aviso de error' });
        expect(chips()[0].getAttribute('data-estado')).toBe('listo');
    });
});

describe('Mandar con ejemplos', () => {
    it('el pedido lleva funcion y adjuntos; el mensaje de la persona muestra el ejemplo y el compositor queda limpio', async () => {
        await armar();
        b!.preguntar = () => respuestaSse([ev.inicio(), ev.texto('Listo.'), ev.fin('Listo.')], 20);
        await elegirArchivos(entradaArchivos(), [archivo('a.xlsx'), archivo('b.csv')]);
        await esperar(() => chips().length === 2 && chips().every((c) => c.getAttribute('data-estado') === 'listo'), { que: 'los dos listos' });
        await preguntarAlAsistente('Igual a este, de Toyota');
        await esperarTerminada();
        expect(b!.cuerpos('POST', PREGUNTAR)[0]).toEqual({ pregunta: 'Igual a este, de Toyota', ruta: '/gestion', funcion: 'reportes', adjuntos: [501, 502] });
        expect(chips().length).toBe(0);
        const enviados = document.querySelector('[data-testid="adjuntos-enviados"]')!;
        expect(limpio(enviados.textContent ?? '')).toContain('XLSX · a.xlsx · 9 columnas');
        expect(limpio(enviados.textContent ?? '')).toContain('XLSX · b.csv · 9 columnas');
    });

    it('sin ejemplos el pedido de reportes no lleva la clave adjuntos', async () => {
        await armar();
        await preguntarAlAsistente('Un listado');
        await esperarTerminada();
        expect(b!.cuerpos('POST', PREGUNTAR)[0]).toEqual({ pregunta: 'Un listado', ruta: '/gestion', funcion: 'reportes' });
    });

    it('si el servidor no acepta el mensaje (límite diario), el texto y los ejemplos vuelven al compositor', async () => {
        await armar();
        b!.preguntar = () => ({ status: 429, body: { codigo: 'LIMITE_DIARIO', mensaje: 'Llegaste al límite de 40 pedidos de reportes de hoy. Mañana se renueva.', message: 'x', usadas: 40, limite: 40, funcion: 'reportes' } });
        await elegirArchivos(entradaArchivos(), [archivo()]);
        await esperar(() => chips()[0]?.getAttribute('data-estado') === 'listo', { que: 'el chip listo' });
        await preguntarAlAsistente('Igual a este');
        await esperar(() => entrada()!.value === 'Igual a este', { que: 'el texto devuelto' });
        await esperar(() => chips().length === 1, { que: 'el ejemplo devuelto' });
        expect(document.querySelectorAll('[data-testid="burbuja-asistente"]').length).toBe(0);
    });

    it('cambiar de modo descarta los ejemplos pendientes (y los borra en el servidor)', async () => {
        await armar();
        await elegirArchivos(entradaArchivos(), [archivo()]);
        await esperar(() => chips()[0]?.getAttribute('data-estado') === 'listo', { que: 'el chip listo' });
        await clic(boton('Ayuda'), 'Ayuda');
        await esperar(() => document.querySelector('[data-testid="adjuntos-pendientes"]') === null, { que: 'sin chips' });
        await esperar(() => b!.srv.cuantos('DELETE', ADJUNTO) === 1, { que: 'el borrado en el servidor' });
        expect(limpio(panel()!.textContent ?? '')).not.toContain('ejemplo.xlsx');
    });
});
