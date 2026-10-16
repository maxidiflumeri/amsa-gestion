// C3c: una carga cortada por un reinicio ordenado del servidor (docs/imports-progreso-c3-spec.md §19.4.4 y §19.5).
import { describe, expect, it } from 'vitest';
import * as U from '@fe/utils/estadoCarga';
import * as H from '@fe/utils/historialImportaciones';
import { BASURA, sin, terminalC1, canceladaC1, itemHistorial } from '../lib/fabricas';

// Salida real de `textoCancelacion` del backend (DEUDORES, ok 2.990, err 10, total 14.466, motivo REINICIO).
const TXT_REINICIO =
    'La importación se interrumpió por un reinicio del servidor cuando llevaba 3.000 de 14.466 filas.\n\n' +
    'De las 3.000 filas ya procesadas, 2.990 quedaron cargadas en esta remesa y 10 dieron error; el cierre de la carga no corrió. ' +
    'Para cargarla completa, eliminá esta importación desde el Historial y volvé a subir el archivo. Si no se puede eliminar ' +
    '(porque algún caso ya tiene gestión o porque la remesa es muy grande), avisá a soporte antes de volver a subirlo.';

const reinicio = (over: Record<string, unknown> = {}) =>
    terminalC1('FALLIDA', { cancelada: false, interrumpidaPorReinicio: true, error: TXT_REINICIO, procesadas: 3000, ok: 2990, err: 10, estadoProceso: 'FALLIDA', ...over });

describe('presentarResultado de una interrumpida por un reinicio', () => {
    it('warning, título propio y el detalle es `error` tal cual, sin el «al menos»', () => {
        const p = U.presentarResultado(reinicio());
        expect(p).toEqual({ severidad: 'warning', titulo: 'Importación interrumpida por un reinicio del servidor', detalle: TXT_REINICIO });
        expect(p.detalle).not.toMatch(/al menos/);
    });

    it('sin `error`: sin detalle', () => {
        expect(U.presentarResultado(reinicio({ error: null })).detalle).toBeNull();
    });

    it('una FALLIDA común con ok > 0 sigue con el «al menos» (no se contagia)', () => {
        const p = U.presentarResultado(terminalC1('FALLIDA', { cancelada: false, error: 'Se cayó la base.', ok: 50, err: 0 }));
        expect(p.titulo).toBe('La importación falló');
        expect(p.detalle).toMatch(/al menos 50/);
    });

    it('un backend anterior (sin el campo) la presenta como una fallida con su motivo, igual que hoy', () => {
        const p = U.presentarResultado(sin(reinicio(), 'interrumpidaPorReinicio'));
        expect(p.severidad).toBe('error');
        expect(p.titulo).toBe('La importación falló');
        expect(p.detalle).toContain('La importación se interrumpió por un reinicio del servidor');
    });

    it('si por error vinieran las dos marcas, gana la cancelación del usuario', () => {
        const p = U.presentarResultado(canceladaC1({ interrumpidaPorReinicio: true }));
        expect(p.titulo).toBe('Importación cancelada');
        expect(U.estaInterrumpidaPorReinicio(canceladaC1({ interrumpidaPorReinicio: true }))).toBe(false);
    });
});

describe('rangoGravedad / peorResultado', () => {
    it('va con la cancelada: entre FALLIDA y CON_ADVERTENCIAS', () => {
        const falla = terminalC1('FALLIDA', { remesaId: 1, cancelada: false });
        const rei = reinicio({ remesaId: 2 });
        const adv = terminalC1('CON_ADVERTENCIAS', { remesaId: 3 });
        expect(U.peorResultado([adv, rei])?.remesaId).toBe(2);
        expect(U.peorResultado([rei, falla])?.remesaId).toBe(1);
        expect(U.peorResultado([rei, canceladaC1({ remesaId: 4 })])?.remesaId).toBe(2);
    });
});

describe('rótulo del Historial', () => {
    it('«Interrumpida por un reinicio», en aviso, con el título y el motivo en el tooltip', () => {
        const e = U.etiquetaDeEstado(reinicio());
        expect(e.etiqueta).toBe('Interrumpida por un reinicio');
        expect(e.status).toBe('warning');
        expect(e.color).toBe('warning');
        expect(e.tooltip).toContain('Importación interrumpida por un reinicio del servidor');
        expect(e.tooltip).toContain('cuando llevaba 3.000 de 14.466 filas');
        expect(BASURA.test(`${e.etiqueta} ${e.tooltip}`)).toBe(false);
    });

    it('lo da igual el Historial', () => {
        const item = itemHistorial({}, { cancelada: false, interrumpidaPorReinicio: true, resultado: 'FALLIDA', estadoProceso: 'FALLIDA', terminal: true, enCurso: false, fase: 'TERMINADA', error: TXT_REINICIO });
        expect(H.estadoParaHistorial(item).etiqueta).toBe('Interrumpida por un reinicio');
    });

    it('sin el campo sigue «Fallida»; la cancelada sigue «Cancelada»', () => {
        expect(U.etiquetaDeEstado(sin(reinicio(), 'interrumpidaPorReinicio')).etiqueta).toBe('Fallida');
        expect(U.etiquetaDeEstado(canceladaC1()).etiqueta).toBe('Cancelada');
    });

    it('en la tarjeta de progreso, el último paso lleva el rótulo y queda marcado como falla', () => {
        const pasos = U.pasosDeCarga(reinicio());
        const listo = pasos?.find((p) => p.clave === 'LISTO');
        expect(listo?.etiqueta).toBe('Interrumpida por un reinicio');
        expect(listo?.error).toBe(true);
    });
});
