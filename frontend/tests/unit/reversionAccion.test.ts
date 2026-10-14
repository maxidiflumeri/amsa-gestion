// C3b: los textos y las reglas puras de la reversión de una acción masiva (docs/imports-progreso-c3-spec.md §17.8).
import { describe, expect, it } from 'vitest';
import * as r from '@fe/utils/reversionAccion';
import { BASURA, coberturaReversion, reversionAccion, reversionResumen } from '../lib/fabricas';

describe('RV-1 — lineasDeCobertura: los textos de §17.8', () => {
    it('exacta y carga completa: los casos, los tres números y la advertencia de siempre', () => {
        expect(r.lineasDeCobertura(coberturaReversion({ casos: 50, cambiosDeCaso: 60, contactos: 40, comentarios: 50 }))).toEqual([
            'Se van a deshacer los cambios en **50 casos**: 60 cambios de datos, 40 contactos a restaurar y 50 comentarios a borrar.',
            'Si alguien editó a mano alguno de estos casos después de la acción, esos cambios se pisan.',
        ]);
    });

    it('con un solo caso, un cambio, un contacto y un comentario: singular', () => {
        expect(r.lineasDeCobertura(coberturaReversion({ casos: 1, cambiosDeCaso: 1, contactos: 1, comentarios: 1 }))[0]).toBe(
            'Se van a deshacer los cambios en **1 caso**: 1 cambio de datos, 1 contacto a restaurar y 1 comentario a borrar.',
        );
    });

    it('exacta y cortada: agrega las filas que alcanzó a procesar, con punto de miles', () => {
        const l = r.lineasDeCobertura(coberturaReversion({ cargaCortada: true, filasProcesadas: 12_000, totalFilas: 50_000 }));
        expect(l).toHaveLength(3);
        expect(l[1]).toBe('La acción se cortó después de procesar 12.000 de 50.000 filas: Revertir deshace exactamente lo que alcanzó a hacer.');
        expect(l[2]).toBe(r.TEXTO_PISA_EDICIONES);
    });

    it('cortada sin saber cuántas filas llevaba: no inventa un número', () => {
        const l = r.lineasDeCobertura(coberturaReversion({ cargaCortada: true, filasProcesadas: null, totalFilas: null }));
        expect(l[1]).toBe('La acción se cortó antes de terminar: Revertir deshace exactamente lo que alcanzó a hacer.');
        expect(l.join(' ')).not.toMatch(BASURA);
    });

    it('con un intento anterior que ya revirtió algo: dice cuántos y que ahora se deshacen los que faltan', () => {
        const l = r.lineasDeCobertura(coberturaReversion({ yaRevertidos: 1_200 }));
        expect(l[1]).toBe('Un intento anterior ya revirtió 1.200 cambios; ahora se deshacen los que faltan.');
        expect(r.lineasDeCobertura(coberturaReversion({ yaRevertidos: 1 }))[1]).toBe('Un intento anterior ya revirtió 1 cambio; ahora se deshacen los que faltan.');
    });

    it('cortada, retomada: las tres frases, en ese orden, y la advertencia siempre al final', () => {
        const l = r.lineasDeCobertura(coberturaReversion({ cargaCortada: true, filasProcesadas: 5, totalFilas: 10, yaRevertidos: 3 }));
        expect(l.map((x) => x.slice(0, 12))).toEqual(['Se van a des', 'La acción se', 'Un intento a', 'Si alguien e']);
    });

    it('no exacta: lo dice, para no prometer de más', () => {
        const l = r.lineasDeCobertura(coberturaReversion({ exacta: false }));
        expect(l).toContain(r.TEXTO_COBERTURA_INEXACTA);
        expect(l[l.length - 1]).toBe(r.TEXTO_PISA_EDICIONES);
    });

    it('números raros del backend (NaN, null, negativos): 0, nunca basura', () => {
        const l = r.lineasDeCobertura({ ...coberturaReversion(), casos: Number.NaN, cambiosDeCaso: -3, contactos: undefined as unknown as number, comentarios: null as unknown as number });
        expect(l[0]).toBe('Se van a deshacer los cambios en **0 casos**: 0 cambios de datos, 0 contactos a restaurar y 0 comentarios a borrar.');
        expect(l.join(' ')).not.toMatch(BASURA);
    });
});

describe('RV-2 — textoDeMotivo: uno por código', () => {
    it('el texto del backend manda; sin texto, el de respaldo del código', () => {
        expect(r.textoDeMotivo({ code: 'REVERTIR_NADA', texto: 'Otro texto del backend.' })).toBe('Otro texto del backend.');
        expect(r.textoDeMotivo({ code: 'REVERTIR_NADA', texto: '' })).toBe('Esta acción masiva no llegó a cambiar ningún caso: no hay nada que revertir.');
        expect(r.textoDeMotivo(null)).toBeNull();
    });

    it.each([
        ['REVERSION_EN_CURSO', 'Esta acción ya se está revirtiendo. Mirá el avance en el Historial.'],
        ['REVERTIR_CARGA_EN_CURSO', 'La acción masiva todavía está corriendo. Cancelala, o esperá a que termine, y después revertila.'],
        ['REVERTIR_NO_TERMINO', 'Esta acción masiva no terminó bien: los datos para revertirla no se guardaron. Avisá a soporte; no la vuelvas a cargar.'],
        ['REVERTIR_INCOMPLETO', 'Los datos para revertir esta acción no se guardaron completos: Revertir desharía solo una parte. Avisá a soporte.'],
        ['REVERTIR_NADA', 'Esta acción masiva no llegó a cambiar ningún caso: no hay nada que revertir.'],
    ] as const)('%s', (code, texto) => {
        expect(r.TEXTO_MOTIVO[code]).toBe(texto);
        expect(r.textoDeMotivo({ code, texto: '' })).toBe(texto);
    });

    it('ningún código queda sin texto', () => {
        for (const code of ['YA_REVERTIDA', 'REVERSION_EN_CURSO', 'REVERTIR_CARGA_EN_CURSO', 'REVERTIR_NO_TERMINO', 'REVERTIR_INCOMPLETO', 'REVERTIR_NADA'] as const) {
            expect(r.TEXTO_MOTIVO[code].length).toBeGreaterThan(10);
        }
        expect(reversionAccion().motivo).toBeNull();
    });
});

describe('RV-3 — etiquetaDeReversion: el chip de cada estado', () => {
    const e = (over: Parameters<typeof reversionResumen>[0]) => r.etiquetaDeReversion(reversionResumen(over));
    it('los cinco estados', () => {
        expect(e({ estado: 'EN_COLA' })).toEqual({ etiqueta: 'En cola', status: 'pending', detalle: null });
        expect(e({ estado: 'REVIRTIENDO', porcentaje: 40 })).toEqual({ etiqueta: 'Revirtiendo 40 %', status: 'running', detalle: null });
        expect(e({ estado: 'TERMINADA', porcentaje: 100 })).toEqual({ etiqueta: 'Revertida', status: 'completed', detalle: null });
        expect(e({ estado: 'INTERRUMPIDA', hechos: 4_000, total: 15_000, error: 'El servidor se reinició.' })).toEqual({
            etiqueta: 'Reversión interrumpida: 4.000 de 15.000', status: 'warning', detalle: 'El servidor se reinició.',
        });
        expect(e({ estado: 'FALLIDA', error: 'Se cayó la base.' })).toEqual({ etiqueta: 'La reversión falló', status: 'failed', detalle: 'Se cayó la base.' });
    });

    it('sin error o con un error vacío no hay detalle; un porcentaje raro se acota', () => {
        expect(e({ estado: 'FALLIDA', error: null }).detalle).toBeNull();
        expect(e({ estado: 'FALLIDA', error: '  ' }).detalle).toBeNull();
        expect(e({ estado: 'REVIRTIENDO', porcentaje: 140 }).etiqueta).toBe('Revirtiendo 100 %');
        expect(e({ estado: 'REVIRTIENDO', porcentaje: Number.NaN }).etiqueta).toBe('Revirtiendo 0 %');
    });
});

describe('RV-4 — lineasDeReversionTerminada: lo que no se pudo deshacer se ve', () => {
    it('los tres números, en singular y en plural', () => {
        expect(r.lineasDeReversionTerminada(reversionResumen({ estado: 'TERMINADA', deudoresRevertidos: 60, contactosRestaurados: 40, comentariosBorrados: 50 }))).toEqual([
            { texto: 'Se deshicieron 60 cambios de datos, se restauraron 40 contactos y se borraron 50 comentarios.', aviso: false },
        ]);
        expect(r.lineasDeReversionTerminada(reversionResumen({ estado: 'TERMINADA', deudoresRevertidos: 1, contactosRestaurados: 1, comentariosBorrados: 1 }))[0].texto)
            .toBe('Se deshicieron 1 cambio de datos, se restauró 1 contacto y se borró 1 comentario.');
    });

    it('casos que ya no existen y contactos sin caso salen como avisos', () => {
        const l = r.lineasDeReversionTerminada(reversionResumen({ estado: 'TERMINADA', casosQueNoExistian: 3, contactosSinCaso: 1 }));
        expect(l.slice(1)).toEqual([
            { texto: '3 cambios no se pudieron deshacer porque su caso ya no existe.', aviso: true },
            { texto: '1 contacto no se restauró porque su caso ya no existe.', aviso: true },
        ]);
    });
});

describe('RV-5 — reglas del estado', () => {
    it('reversionActiva y reversionCortada', () => {
        expect(r.reversionActiva(reversionResumen({ estado: 'EN_COLA' }))).toBe(true);
        expect(r.reversionActiva(reversionResumen({ estado: 'REVIRTIENDO' }))).toBe(true);
        for (const estado of ['TERMINADA', 'FALLIDA', 'INTERRUMPIDA'] as const) expect(r.reversionActiva(reversionResumen({ estado }))).toBe(false);
        expect(r.reversionActiva(null)).toBe(false);
        expect(r.reversionActiva(undefined)).toBe(false);
        expect(r.reversionCortada(reversionResumen({ estado: 'INTERRUMPIDA' }))).toBe(true);
        expect(r.reversionCortada(reversionResumen({ estado: 'FALLIDA' }))).toBe(true);
        expect(r.reversionCortada(reversionResumen({ estado: 'TERMINADA' }))).toBe(false);
    });

    it('esReversionResumen descarta lo que no es un resumen', () => {
        expect(r.esReversionResumen(reversionResumen())).toBe(true);
        for (const raro of [null, undefined, 3, 'x', {}, { remesaId: 1 }, { ...reversionResumen(), estado: 'OTRO' }, { ...reversionResumen(), empresaId: '1' }]) {
            expect(r.esReversionResumen(raro)).toBe(false);
        }
    });

    it('fusionarReversion: un progreso viejo no pisa lo nuevo; un nuevo intento sí', () => {
        const a = reversionResumen({ estado: 'REVIRTIENDO', hechos: 100, porcentaje: 66 });
        const viejo = reversionResumen({ estado: 'REVIRTIENDO', hechos: 40, porcentaje: 26 });
        expect(r.fusionarReversion(a, viejo)).toBe(a);
        const mas = reversionResumen({ estado: 'REVIRTIENDO', hechos: 120, porcentaje: 80 });
        expect(r.fusionarReversion(a, mas)).toBe(mas);
        // Un `progreso` que llega después de `terminada` no la reabre.
        const fin = reversionResumen({ estado: 'TERMINADA', hechos: 150, porcentaje: 100 });
        expect(r.fusionarReversion(fin, a)).toBe(fin);
        // Un nuevo intento (otra `encoladaAt`) arranca de cero y se toma aunque tenga menos hechos.
        const reintento = reversionResumen({ estado: 'REVIRTIENDO', hechos: 5, encoladaAt: '2026-10-14T20:00:00.000Z' });
        expect(r.fusionarReversion(a, reintento)).toBe(reintento);
        // Tras una interrumpida, volver a pedir (EN_COLA) se toma: el reintento trae otra `encoladaAt`.
        const cola = reversionResumen({ estado: 'EN_COLA', encoladaAt: '2026-10-14T21:00:00.000Z' });
        expect(r.fusionarReversion(reversionResumen({ estado: 'INTERRUMPIDA' }), cola)).toBe(cola);
        expect(r.fusionarReversion(null, cola)).toBe(cola);
        // El EN_COLA del 202 del mismo intento no pisa lo que ya llegó por socket.
        const corriendo = reversionResumen({ estado: 'REVIRTIENDO', hechos: 60 });
        expect(r.fusionarReversion(corriendo, reversionResumen({ estado: 'EN_COLA' }))).toBe(corriendo);
    });
});

describe('RV-6 — los textos fijos', () => {
    it('cancelar una acción masiva solo cancela; revertir es un paso aparte (D6)', () => {
        expect(r.TEXTO_CANCELAR_ACCIONES).toBe('Lo que ya se aplicó queda aplicado. Después lo podés deshacer con **Revertir** desde el Historial: deshace exactamente lo que alcanzó a hacer.');
    });

    it('los tooltips del botón y los avisos', () => {
        expect(r.MOTIVO_YA_REVERTIDA).toBe('Ya se revirtió');
        expect(r.MOTIVO_SE_ESTA_REVIRTIENDO).toBe('Se está revirtiendo');
        expect(r.AYUDA_REVERTIR_CORTADA).toBe('Revertir (sigue desde donde quedó)');
        expect(r.TEXTO_REVERSION_PEDIDA).toBe('Reversión en curso: te avisamos al terminar');
    });
});
