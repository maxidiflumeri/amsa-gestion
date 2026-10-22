// T360-4: nada de lo que se dibuja en el flujo de importación ni en la campanita fija un ancho numérico mayor que 280 px
// fuera de un objeto por breakpoint (`{ xs: …, sm: … }`). A 360 px una caja de 320 px más el margen de la pantalla ya desborda.
// jsdom no calcula layout: esto es un chequeo del fuente, y el desborde real queda para la prueba manual (M-1 a M-11).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAIZ_FE } from '../lib/raiz';

const TOPE = 280;
const CARPETAS = ['components/import/progreso', 'components/import/historial', 'components/asistente', 'pages/asistente'];
const ARCHIVOS = [
    'components/import/ImportProgress.tsx',
    'pages/ImportWizard.tsx',
    'components/import/ImportSummary.tsx',
    'pages/ImportDetail.tsx',
    'pages/ImportHistory.tsx',
    'components/import/ErroresDeCarga.tsx',
    'components/import/ResumenDeCarga.tsx',
    'components/layout/AppShell/NotificacionesPopover.tsx',
    'components/layout/AppShell/NotificacionesBell.tsx',
    'components/layout/AppShell/NotificacionItem.tsx',
    'components/layout/AppShell/AccionesNotificacion.tsx',
    'components/layout/AppShell/ImportEnCursoItem.tsx',
    'components/layout/AppShell/ChipImportaciones.tsx',
    // Asistente de IA, Fase A (el botón, el panel y la pantalla de consumo; el panel se mide aparte en asistente-tema.test.tsx)
    'components/layout/AppShell/AppShell.tsx',
    // El marco nuevo (CHANGELOG 2026-10-22): la barra, el menú lateral, el buscador y las migas
    'components/layout/AppShell/AppBar.tsx',
    'components/layout/AppShell/SideNav.tsx',
    'components/layout/AppShell/BuscadorGlobal.tsx',
    'components/ui/MigasDePan.tsx',
    'context/AsistenteContext.tsx',
    'pages/ayuda/Markdown.tsx',
    // Asistente de IA, Fase B: el editor de reportes con lo que sumó
    'pages/reportes/components/BuilderHeader/BuilderHeader.tsx',
    'pages/reportes/components/PropertiesPanel/PropertiesPanel.tsx',
    'pages/reportes/components/FilterBuilder/CampoFecha.tsx',
];

const EN_SRC = (rel: string) => path.join(RAIZ_FE, 'src', rel);
const delasCarpetas = CARPETAS.flatMap((c) => (fs.existsSync(EN_SRC(c)) ? fs.readdirSync(EN_SRC(c)).filter((f) => /\.tsx?$/.test(f)).map((f) => `${c}/${f}`) : []));

/** `width: 380`, `minWidth: '300px'`, `maxWidth={400}`. No toma `width: { xs: …, sm: 380 }`, ni porcentajes, ni `calc(…)`, ni `vw`. */
const ANCHO_NUMERICO = /\b(width|minWidth|maxWidth)\s*[:=]\s*\{?\s*['"]?(\d+(?:\.\d+)?)(px)?(?![\d.%a-zA-Z])/g;

export function anchosGrandes(fuente: string): string[] {
    const hallazgos: string[] = [];
    fuente.split('\n').forEach((linea, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(linea)) return;
        for (const m of linea.matchAll(ANCHO_NUMERICO)) {
            if (Number(m[2]) <= TOPE) continue;
            // Un tope que acompaña a `width: 100%` no desborda: la caja se achica con la pantalla.
            if (m[1] === 'maxWidth' && /\bwidth\s*:\s*['"]100%['"]/.test(linea)) continue;
            // `PageContainer` ya es `width: 100%` con un tope: su `maxWidth` es el ancho máximo de la página, no uno fijo.
            if (m[1] === 'maxWidth' && /<PageContainer\b/.test(linea)) continue;
            hallazgos.push(`${i + 1}: ${linea.trim()}`);
        }
    });
    return hallazgos;
}

describe('T360-4 — ningún ancho numérico mayor que 280 px fuera de un objeto por breakpoint', () => {
    it('el detector reconoce lo que tiene que reconocer', () => {
        expect(anchosGrandes('sx={{ width: 380 }}')).toHaveLength(1);
        expect(anchosGrandes("sx={{ maxWidth: '320px' }}")).toHaveLength(1);
        expect(anchosGrandes('<Box width={400} />')).toHaveLength(1);
        expect(anchosGrandes('sx={{ minWidth: 281 }}')).toHaveLength(1);
        expect(anchosGrandes('sx={{ width: { xs: "100%", sm: 380 } }}')).toEqual([]);
        expect(anchosGrandes('sx={{ minWidth: 280 }}')).toEqual([]);
        expect(anchosGrandes('sx={{ width: "100%", maxWidth: 640 }}')).toEqual([]);
        expect(anchosGrandes('sx={{ maxWidth: 640 }}')).toHaveLength(1);
        expect(anchosGrandes("sx={{ maxWidth: 'calc(100vw - 16px)' }}")).toEqual([]);
        expect(anchosGrandes('sx={{ width: "90vw", maxWidth: "100%" }}')).toEqual([]);
        expect(anchosGrandes('<PageContainer maxWidth={900}>')).toEqual([]);
        expect(anchosGrandes('<Box maxWidth={900}>')).toHaveLength(1);
        expect(anchosGrandes('// width: 999')).toEqual([]);
    });

    it('hay archivos que revisar en cada carpeta', () => {
        expect(delasCarpetas.length).toBeGreaterThan(0);
    });

    for (const rel of [...ARCHIVOS, ...delasCarpetas]) {
        it(rel, () => {
            expect(fs.existsSync(EN_SRC(rel)), `no existe ${rel}`).toBe(true);
            expect(anchosGrandes(fs.readFileSync(EN_SRC(rel), 'utf8')).map((h) => `${rel}:${h}`)).toEqual([]);
        });
    }
});
