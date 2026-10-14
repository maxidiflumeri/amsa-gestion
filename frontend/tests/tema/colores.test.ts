// FX-1: los archivos de `frontend/src` que C2a crea o reescribe no tienen colores escritos a mano; todo sale de `theme.palette`.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAIZ_FE } from '../lib/raiz';

const ARCHIVOS = [
    'pages/ImportHistory.tsx',
    'components/import/ErroresDeCarga.tsx',
    'components/import/historial/AccionesHistorial.tsx',
    'components/import/historial/CeldasHistorial.tsx',
    'components/import/historial/EncabezadoDivision.tsx',
    'hooks/useHistorialImportaciones.ts',
    'utils/historialImportaciones.ts',
    'utils/descargas.ts',
    'types/importHistorial.ts',
];
const COLOR_A_MANO = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

describe('FX-1 — sin colores escritos a mano', () => {
    for (const rel of ARCHIVOS) {
        it(rel, () => {
            const ruta = path.join(RAIZ_FE, 'src', rel);
            expect(fs.existsSync(ruta), `no existe ${rel}`).toBe(true);
            const lineas = fs.readFileSync(ruta, 'utf8').split('\n');
            const malas = lineas.map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => !/^\s*(\/\/|\*|\/\*)/.test(l) && COLOR_A_MANO.test(l));
            expect(malas.map((m) => `${rel}:${m.n} ${m.l.trim()}`)).toEqual([]);
        });
    }

    it('lo nuevo de ImportProgress (BotonCancelarCarga) y DataTableResponsive tampoco trae ninguno', () => {
        for (const rel of ['components/import/ImportProgress.tsx', 'components/ui/DataTableResponsive.tsx']) {
            const texto = fs.readFileSync(path.join(RAIZ_FE, 'src', rel), 'utf8');
            expect(texto.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && COLOR_A_MANO.test(l))).toEqual([]);
        }
    });
});
