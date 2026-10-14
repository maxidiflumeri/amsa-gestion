// utils/campanita.ts: el texto del chip de la barra superior y lo que la campanita ofrece en cada notificación (TC-1 a TC-3).
import { describe, expect, it } from 'vitest';
import { accionesDeNotificacion, remesaDeNotificacion, textoChipImportaciones } from '@fe/utils/campanita';
import type { NotificacionDto } from '@fe/api/notificaciones';
import { BASURA, T0, dtoC1, enColaC1, iso } from '../lib/fabricas';

const notif = (over: Partial<NotificacionDto> = {}): NotificacionDto => ({
    id: 1, tipo: 'IMPORTACION_FINALIZADA', titulo: 't', mensaje: 'm', payload: {}, rutaAccion: '/historial-importaciones/141',
    leida: false, creadoEn: iso(T0), entidadTipo: 'REMESA', entidadId: 141, ...over,
});
const conPermisos = (...permisos: string[]) => (p: string) => permisos.includes(p);
const TODOS = conPermisos('importacion.ver_historial', 'importacion.ejecutar');

describe('TC-1 — textoChipImportaciones', () => {
    it('sin cargas no hay texto', () => {
        expect(textoChipImportaciones([])).toBeNull();
    });

    it('una procesando con total: «Importando 43 %»', () => {
        expect(textoChipImportaciones([dtoC1({ progreso: 43 })])).toBe('Importando 43 %');
    });

    it('una procesando sin total (barra indeterminada): «Importando…», sin porcentaje inventado', () => {
        const t = textoChipImportaciones([dtoC1({ progreso: 0, totalEsperado: 0 })]);
        expect(t).toBe('Importando…');
    });

    it('una leyendo el archivo o en post-proceso: «Importando…»', () => {
        expect(textoChipImportaciones([dtoC1({ fase: 'LEYENDO' })])).toBe('Importando…');
        expect(textoChipImportaciones([dtoC1({ fase: 'POST_PROCESO', progreso: 99 })])).toBe('Importando…');
    });

    it('una en cola: «Importación en cola»', () => {
        expect(textoChipImportaciones([enColaC1({ enColaDelante: 2 })])).toBe('Importación en cola');
    });

    it('una con la cancelación pedida: «Cancelando importación», en cola o procesando', () => {
        expect(textoChipImportaciones([dtoC1({ cancelacionPedidaAt: iso(T0), progreso: 43 })])).toBe('Cancelando importación');
        expect(textoChipImportaciones([enColaC1({ cancelacionPedidaAt: iso(T0) })])).toBe('Cancelando importación');
    });

    it('tres: «3 importaciones» (también dos y doce), sea cual sea su estado', () => {
        expect(textoChipImportaciones([dtoC1({ remesaId: 1 }), enColaC1({ remesaId: 2 }), dtoC1({ remesaId: 3 })])).toBe('3 importaciones');
        expect(textoChipImportaciones([dtoC1({ remesaId: 1 }), dtoC1({ remesaId: 2 })])).toBe('2 importaciones');
        expect(textoChipImportaciones(Array.from({ length: 12 }, (_, i) => dtoC1({ remesaId: i + 1 })))).toBe('12 importaciones');
    });

    it('nunca devuelve NaN, undefined ni null en el texto', () => {
        const raras = [dtoC1({ progreso: Number.NaN }), dtoC1({ progreso: undefined }), dtoC1({ fase: 'UNA_FASE_NUEVA' })];
        for (const c of raras) expect(textoChipImportaciones([c]) ?? '').not.toMatch(BASURA);
    });
});

describe('TC-2 — remesaDeNotificacion', () => {
    it('toma el `entidadId` cuando la entidad es una remesa', () => {
        expect(remesaDeNotificacion(notif({ entidadId: 141, rutaAccion: '/historial-importaciones/999' }))).toBe(141);
        expect(remesaDeNotificacion(notif({ tipo: 'IMPORTACION_ERROR', entidadId: 7 }))).toBe(7);
    });

    it('sin `entidadId` (o de otra entidad) usa el número de `rutaAccion`', () => {
        expect(remesaDeNotificacion(notif({ entidadTipo: undefined, entidadId: undefined }))).toBe(141);
        expect(remesaDeNotificacion(notif({ entidadTipo: 'REMESA', entidadId: null, rutaAccion: '/historial-importaciones/55/' }))).toBe(55);
        expect(remesaDeNotificacion(notif({ entidadTipo: 'REPORTE', entidadId: 9 }))).toBe(141);
    });

    it('otro tipo de notificación: null', () => {
        expect(remesaDeNotificacion(notif({ tipo: 'REPORTE_LISTO' }))).toBeNull();
        expect(remesaDeNotificacion(notif({ tipo: 'CONVENIO_VENCIDO' }))).toBeNull();
        expect(remesaDeNotificacion(notif({ tipo: 'IMPORTACION_INICIADA' }))).toBeNull();
    });

    it('una `rutaAccion` rara o ausente, sin `entidadId`: null', () => {
        const sinEntidad = { entidadTipo: undefined, entidadId: undefined };
        for (const rutaAccion of ['/reportes/12', '/historial-importaciones/abc', '/historial-importaciones/', '/historial-importaciones/12/errores', '', null, undefined]) {
            expect(remesaDeNotificacion(notif({ ...sinEntidad, rutaAccion })), String(rutaAccion)).toBeNull();
        }
    });

    it('un `entidadId` que no es un entero positivo no sirve', () => {
        for (const entidadId of [0, -3, 1.5, Number.NaN, null]) {
            expect(remesaDeNotificacion(notif({ entidadId, rutaAccion: null })), String(entidadId)).toBeNull();
        }
    });
});

describe('TC-3 — accionesDeNotificacion', () => {
    it('cancelada sin procesar nada: ofrece retomar (y no descargar si no hubo errores)', () => {
        const a = accionesDeNotificacion(notif({ tipo: 'IMPORTACION_ERROR', payload: { resultado: 'FALLIDA', cancelada: true, procesadas: 0, ok: 0, err: 0 } }), TODOS);
        expect(a).toEqual({ descargar: false, retomar: true });
    });

    it('fallida sin procesar nada (se interrumpió al arrancar): ofrece retomar', () => {
        expect(accionesDeNotificacion(notif({ payload: { resultado: 'FALLIDA', procesadas: 0 } }), TODOS).retomar).toBe(true);
    });

    it('fallida con filas procesadas: no ofrece retomar (hay que eliminar y volver a cargar)', () => {
        expect(accionesDeNotificacion(notif({ payload: { resultado: 'FALLIDA', procesadas: 3000, err: 10 } }), TODOS)).toEqual({ descargar: true, retomar: false });
        expect(accionesDeNotificacion(notif({ payload: { cancelada: true, resultado: 'FALLIDA', procesadas: 1 } }), TODOS).retomar).toBe(false);
    });

    it('terminada bien o con errores: no ofrece retomar', () => {
        expect(accionesDeNotificacion(notif({ payload: { resultado: 'OK', procesadas: 0 } }), TODOS).retomar).toBe(false);
        expect(accionesDeNotificacion(notif({ payload: { resultado: 'CON_ERRORES', procesadas: 10, err: 3 } }), TODOS).retomar).toBe(false);
    });

    it('OK con errores o avisos: ofrece descargar; sin ninguno, nada', () => {
        expect(accionesDeNotificacion(notif({ payload: { resultado: 'CON_ERRORES', err: 12, procesadas: 100 } }), TODOS)).toEqual({ descargar: true, retomar: false });
        expect(accionesDeNotificacion(notif({ payload: { resultado: 'CON_ADVERTENCIAS', err: 0, advertencias: 2, procesadas: 100 } }), TODOS).descargar).toBe(true);
        expect(accionesDeNotificacion(notif({ payload: { resultado: 'OK', err: 0, advertencias: 0, procesadas: 100 } }), TODOS)).toEqual({ descargar: false, retomar: false });
    });

    it('sin el permiso de ver el historial no ofrece nada; sin el de ejecutar, solo descargar', () => {
        const payload = { resultado: 'FALLIDA', cancelada: true, procesadas: 0, err: 5 };
        expect(accionesDeNotificacion(notif({ payload }), conPermisos())).toEqual({ descargar: false, retomar: false });
        expect(accionesDeNotificacion(notif({ payload }), conPermisos('importacion.ejecutar'))).toEqual({ descargar: false, retomar: false });
        expect(accionesDeNotificacion(notif({ payload }), conPermisos('importacion.ver_historial'))).toEqual({ descargar: true, retomar: false });
        expect(accionesDeNotificacion(notif({ payload }), TODOS)).toEqual({ descargar: true, retomar: true });
    });

    it('un payload viejo (`errFilas` en vez de `err`) ofrece descargar', () => {
        expect(accionesDeNotificacion(notif({ payload: { resultado: 'CON_ERRORES', errFilas: 4 } }), TODOS).descargar).toBe(true);
    });

    it('payload ausente, nulo o con campos que no son números: nada', () => {
        const vacio = { descargar: false, retomar: false };
        expect(accionesDeNotificacion(notif({ payload: undefined }), TODOS)).toEqual(vacio);
        expect(accionesDeNotificacion(notif({ payload: null }), TODOS)).toEqual(vacio);
        expect(accionesDeNotificacion(notif({ payload: {} }), TODOS)).toEqual(vacio);
        expect(accionesDeNotificacion(notif({ payload: { err: '12', advertencias: 'x', procesadas: '0', cancelada: 'true', resultado: 'FALLIDA' } }), TODOS)).toEqual(vacio);
        expect(accionesDeNotificacion(notif({ payload: { err: null, errFilas: Number.NaN } }), TODOS)).toEqual(vacio);
    });

    it('otro tipo de notificación o sin remesa: nada', () => {
        const payload = { resultado: 'FALLIDA', cancelada: true, procesadas: 0, err: 5 };
        expect(accionesDeNotificacion(notif({ tipo: 'REPORTE_LISTO', payload }), TODOS)).toEqual({ descargar: false, retomar: false });
        expect(accionesDeNotificacion(notif({ payload, entidadTipo: undefined, entidadId: undefined, rutaAccion: '/otra' }), TODOS)).toEqual({ descargar: false, retomar: false });
    });
});
