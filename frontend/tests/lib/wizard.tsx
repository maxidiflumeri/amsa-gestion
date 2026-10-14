// Manejo del ImportWizard REAL: backend falso por HTTP + socket.io, y un envoltorio del adapter de axios
// para dictar los eventos de subida (jsdom solo emite uno, al final).
import React from 'react';
import axios, { AxiosError } from 'axios';
import api from '@fe/api/axios';
import ImportWizard from '@fe/pages/ImportWizard';
import { ServidorFalso, type Respuesta } from './servidor-falso';
import type { EstadoCargaDto } from '@fe/types/importProgreso';
import { dtoFaseB, iso } from './fabricas';
import { boton, clic, dormir, elegirArchivos, elegirEnSelect, esperar, iniciarSesion, limpio, montar, pasar, type Montado } from './montar';

export const MB = 1_048_576;
type EventoSubida = { loaded: number; total?: number };
export type Guion = (subir: (e: EventoSubida) => void) => Promise<void | { falla: 'red' }>;

const adaptadorReal = axios.getAdapter(['xhr']);
let guionPendiente: Guion | null = null;
export function instalarAdaptador() {
    api.defaults.adapter = async (config) => {
        const esSubida = config.method === 'post' && /\/import\/remesas(\/division-preview)?$/.test(String(config.url));
        if (!esSubida || !guionPendiente) return adaptadorReal(config);
        const guion = guionPendiente; guionPendiente = null;
        const alSubir = config.onUploadProgress as ((e: { loaded: number; total?: number; lengthComputable: boolean; upload: boolean; bytes: number }) => void) | undefined;
        if (!alSubir) throw new Error('El wizard no pasó onUploadProgress en ' + config.url);
        // Misma forma que entrega axios 1.13 (helpers/progressEventReducer.js): total undefined si no es computable.
        const r = await guion((e) => alSubir({ loaded: e.loaded, total: e.total, lengthComputable: e.total != null, upload: true, bytes: 0 }));
        if (r && r.falla === 'red') throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config);
        return adaptadorReal({ ...config, onUploadProgress: undefined });
    };
}
export function usarGuion(g: Guion | null) { guionPendiente = g; }

export interface Banco {
    srv: ServidorFalso;
    v: Montado;
    estados: Record<number, EstadoCargaDto>;
    /** Respuestas configurables. */
    validar: (id: number) => Respuesta;
    crear: () => Respuesta;
    ejecutar: (id: number) => Respuesta;
    alValidar?: (id: number) => void | Promise<void>;
    alCrear?: () => void | Promise<void>;
    texto: () => string;
    pie: () => { barra: string | null; principal: string | null; secundario: string | null };
}

export const VALIDAR_OK = { total: 5000, ok: 5000, err: 0, sample: [{ row: 1, data: { nombre: 'ANA', documento: '20111222' }, error: null }] };

export async function armarBanco(opciones: { divide?: boolean } = {}): Promise<Banco> {
    const srv = await new ServidorFalso().levantar();
    iniciarSesion();
    const b = {
        srv, estados: {},
        validar: () => ({ body: VALIDAR_OK }),
        crear: () => ({ body: { remesaId: 141 } }),
        ejecutar: (id: number) => ({ status: 201, body: { message: 'Importación encolada', remesaId: id, carga: b.estados[id] } }),
    } as unknown as Banco;
    srv.en('GET', /^\/import\/empresas$/, () => ({ body: [{ id: 1, nombre: 'Telecom' }] }));
    srv.en('GET', /^\/import\/plantillas\/1\/DEUDORES$/, () => ({ body: [{
        id: 7, nombre: 'Telecom deudores', version: 3,
        mappingJson: opciones.divide ? { divisionRemesa: { porNomina: { etiqueta: 'Nómina' } } } : {},
    }] }));
    srv.en('POST', /^\/import\/remesas\/division-preview$/, () => ({ body: { cortes: [
        { valores: { 'Nómina': '3081' }, filas: 5000, numeroSugerido: '3081', filtros: [{ c: 3, v: '3081' }] },
        { valores: { 'Nómina': '3082' }, filas: 4000, numeroSugerido: '3082', filtros: [{ c: 3, v: '3082' }] },
        { valores: { 'Nómina': '3083' }, filas: 3000, numeroSugerido: '3083', filtros: [{ c: 3, v: '3083' }] },
    ] } }));
    srv.en('POST', /^\/import\/remesas$/, async () => { await b.alCrear?.(); return b.crear(); });
    srv.en('POST', /^\/import\/validar\/(\d+)$/, async (m) => { await b.alValidar?.(Number(m[1])); return b.validar(Number(m[1])); });
    srv.en('POST', /^\/import\/ejecutar\/(\d+)$/, (m) => b.ejecutar(Number(m[1])));
    srv.en('GET', /^\/import\/remesas\/(\d+)\/progreso$/, (m) => {
        const e = b.estados[Number(m[1])];
        return e ? { body: { ...e, servidorAhora: iso(Date.now()) } } : { status: 404, body: { message: 'No existe' } };
    });
    b.v = await montar(<ImportWizard />, { conSocket: true });
    b.texto = () => limpio(b.v.contenedor.textContent ?? '');
    b.pie = () => {
        // El bloque de la subida es la caja que contiene la última barra del wizard, con su texto principal y secundario.
        const barras = Array.from(b.v.contenedor.querySelectorAll('.MuiLinearProgress-root')) as HTMLElement[];
        const barra = barras[barras.length - 1];
        const caja = barra?.parentElement ?? null;
        const hijo = (clase: string) => {
            const el = caja ? Array.from(caja.children).find((c) => c.classList.contains(clase)) : undefined;
            return el ? limpio(el.textContent ?? '') : null;
        };
        return {
            barra: barra ? (/indeterminate/.test(barra.className) ? 'indeterminada' : `determinada ${barra.getAttribute('aria-valuenow')}`) : null,
            principal: hijo('MuiTypography-body2'), secundario: hijo('MuiTypography-caption'),
        };
    };
    return b;
}

/** Pasos 1 y 2 hasta tener plantilla y archivo elegidos. */
export async function hastaElArchivo(b: Pick<Banco, 'texto' | 'srv'>, archivo = new File(['a;b\n1;2\n'], 'cartera.csv', { type: 'text/csv' })) {
    await esperar(() => /Qué tipo de datos/.test(b.texto()), { que: 'el paso Categoría' });
    const area = Array.from(document.querySelectorAll('.MuiCardActionArea-root')).find((el) => el.querySelector('.MuiTypography-subtitle1')?.textContent === 'Deudores');
    await clic(area ?? null, 'la categoría Deudores');
    await clic(boton('Siguiente'), 'Siguiente');
    await esperar(() => /Configurar importación/.test(b.texto()) && b.srv.cuantos('GET', /plantillas/) >= 1, { que: 'el paso Plantilla y archivo' });
    await pasar(100);
    await elegirEnSelect('plantilla-label', /Telecom deudores/);
    await elegirArchivos(document.getElementById('import-file-input') as HTMLInputElement, [archivo]);
    await esperar(() => new RegExp(archivo.name.replace('.', '\\.')).test(b.texto()), { que: 'el archivo elegido' });
}

export async function crearYValidar(b: Banco) {
    await clic(boton('Crear remesa y validar'), 'Crear remesa y validar');
}

export async function hastaLaVistaPrevia(b: Banco) {
    await hastaElArchivo(b);
    await crearYValidar(b);
    await esperar(() => !!boton('Confirmar e importar'), { que: 'la vista previa' });
    await pasar(100);
}

export const enColaDe = (id: number, over: Record<string, unknown> = {}) =>
    dtoFaseB({ remesaId: id, numeroRemesa: String(2940 + id), fase: 'EN_COLA', rev: 2, startedAt: null, heartbeatAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, totalEsperado: 5000, enColaDelante: 0, encoladaAt: iso(Date.now()), servidorAhora: iso(Date.now()), ...over });

export { dormir };
