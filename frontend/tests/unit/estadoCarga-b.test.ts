// Funciones puras de utils/estadoCarga.ts: textos de §9.8.2, formato y campos ausentes.
import { describe, expect, it } from 'vitest';
import * as ec from '@fe/utils/estadoCarga';
import { BASURA, sin, T0, dtoFaseA, dtoFaseB, iso, terminal } from '../lib/fabricas';
import { enElSpec } from '../lib/spec';

const AUSENTES: Array<[string, unknown]> = [['undefined', undefined], ['null', null]];

describe('etiquetaFase — tabla de §9.8.2', () => {
    it('textos, carácter por carácter', () => {
        const e = ec.etiquetaFase;
        expect(e(null, 'wizard')).toEqual({ principal: enElSpec('Enviando a la cola…'), secundario: null });
        expect(e({ fase: 'BORRADOR' }, 'wizard')).toEqual({ principal: 'Enviando a la cola…', secundario: null });
        expect(e({ fase: 'BORRADOR' }, 'detalle')).toEqual({
            principal: 'Borrador', secundario: enElSpec('Vista previa sin confirmar. No se cargó nada.'),
        });
        expect(e({ fase: 'EN_COLA' })).toEqual({ principal: enElSpec('En cola'), secundario: enElSpec('Esperando que termine otra importación.') });
        expect(e({ fase: 'EN_COLA', enColaDelante: null })).toEqual({ principal: 'En cola', secundario: 'Esperando que termine otra importación.' });
        expect(e({ fase: 'EN_COLA', enColaDelante: 0 })).toEqual({ principal: 'En cola', secundario: enElSpec('Es la próxima: empieza en instantes.') });
        expect(e({ fase: 'EN_COLA', enColaDelante: 1 })).toEqual({ principal: 'En cola', secundario: enElSpec('Hay 1 importación antes que esta.') });
        enElSpec('Hay n importaciones antes que esta.');
        expect(e({ fase: 'EN_COLA', enColaDelante: 2 })).toEqual({ principal: 'En cola', secundario: 'Hay 2 importaciones antes que esta.' });
        expect(e({ fase: 'EN_COLA', enColaDelante: 12 })).toEqual({ principal: 'En cola', secundario: 'Hay 12 importaciones antes que esta.' });
        expect(e({ fase: 'LEYENDO' })).toEqual({ principal: enElSpec('Leyendo el archivo'), secundario: enElSpec('Todavía no se procesó ninguna fila.') });
        expect(e({ fase: 'PROCESANDO' })).toEqual({ principal: 'Procesando', secundario: null });
        expect(e({ fase: 'POST_PROCESO' })).toEqual({
            principal: 'Post-proceso', secundario: enElSpec('Consolidando y cerrando la carga. Puede tardar varios minutos.'),
        });
        expect(e({ fase: 'POST_PROCESO', subfase: null }).secundario).toBe('Consolidando y cerrando la carga. Puede tardar varios minutos.');
        expect(e({ fase: 'POST_PROCESO', subfase: 'Consolidando casos: 1.500 de 8.875' })).toEqual({
            principal: 'Post-proceso', secundario: 'Consolidando casos: 1.500 de 8.875',
        });
        expect(e({ fase: 'FINALIZANDO' })).toEqual({ principal: 'FINALIZANDO', secundario: null });
    });

    it('la subfase solo se muestra en POST_PROCESO; la posición solo en EN_COLA', () => {
        for (const fase of ['BORRADOR', 'EN_COLA', 'LEYENDO', 'PROCESANDO', 'TERMINADA', 'OTRA']) {
            const r = ec.etiquetaFase({ fase, subfase: 'SUBFASE-X', enColaDelante: fase === 'EN_COLA' ? null : 7 });
            expect(`${r.principal} ${r.secundario}`).not.toContain('SUBFASE-X');
            expect(`${r.principal} ${r.secundario}`).not.toMatch(/Hay 7|próxima/);
        }
    });

    it('EN_COLA con valores raros de enColaDelante: nada de NaN/undefined/null en el texto', () => {
        const filas: unknown[] = [];
        const malos: string[] = [];
        for (const v of [undefined, null, 0, 1, 2, 1234, -1, -0, 1.5, 0.4, NaN, Infinity, '3' as unknown, '0' as unknown, '' as unknown, true as unknown]) {
            const r = ec.etiquetaFase({ fase: 'EN_COLA', enColaDelante: v as number });
            filas.push({ enColaDelante: String(v), tipo: typeof v, secundario: r.secundario });
            const llegaPorJson = v == null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
            if (llegaPorJson && BASURA.test(String(r.secundario))) malos.push(`${String(v)} -> ${r.secundario}`);
        }
        expect(malos, 'textos con basura').toEqual([]);
    });

    it('POST_PROCESO con subfases raras', () => {
        const larga = 'Consolidando la remesa de origen: ' + 'x'.repeat(126);
        const filas = [undefined, null, '', '   ', larga, 0 as unknown, 123 as unknown].map((s) => ({
            subfase: s === larga ? '(160 caracteres)' : JSON.stringify(s),
            secundario: ec.etiquetaFase({ fase: 'POST_PROCESO', subfase: s as string }).secundario,
        }));
        expect(ec.etiquetaFase({ fase: 'POST_PROCESO', subfase: larga }).secundario).toBe(larga);
        expect(ec.etiquetaFase({ fase: 'POST_PROCESO', subfase: '' }).secundario).toMatch(/^Consolidando y cerrando/);
    });
});

describe('formato', () => {
    it('formatearEspera: «menos de 1 min» · «~N min» · «~H h M min»', () => {
        enElSpec('"menos de 1 min" · "~N min" · "~H h M min"');
        const casos: Array<[number, string]> = [
            [0, 'menos de 1 min'], [1, 'menos de 1 min'], [59, 'menos de 1 min'], [59.9, 'menos de 1 min'],
            [60, '~1 min'], [89, '~1 min'], [90, '~2 min'], [240, '~4 min'], [344, '~6 min'],
            [3540, '~59 min'], [3600, '~1 h 0 min'], [5400, '~1 h 30 min'], [86_400, '~24 h 0 min'], [172_800, '~48 h 0 min'],
            [-1, 'menos de 1 min'], [-3600, 'menos de 1 min'],
        ];
        const filas = casos.map(([s, esperado]) => ({ segundos: s, da: ec.formatearEspera(s), esperado }));
        // El borde: 59 min 30 s redondea a 60 minutos.
        for (const s of [3569, 3570, 3599, 7169, 7170, 1e9, NaN, Infinity, -Infinity]) filas.push({ segundos: s as number, da: ec.formatearEspera(s), esperado: '(observado)' });
        for (const [s, esperado] of casos) expect(ec.formatearEspera(s), `formatearEspera(${s})`).toBe(esperado);
    });

    it('formatearEspera con NaN/Infinity (llamada directa): observado. Los dos que la llaman filtran antes con esNumero', () => {
        const malos = [NaN, Infinity, -Infinity].map((s) => `${s} -> ${ec.formatearEspera(s)}`).filter((t) => BASURA.test(t.split('->')[1]));
        // Lo que sí se exige: por los dos caminos que usa la pantalla no sale nunca.
        for (const s of [NaN, Infinity, -Infinity]) {
            expect(ec.lineaDeRitmo({ velocidad: 10, etaSegundos: s })).toBe('≈ 10 filas/s');
            expect(ec.esperaAbreviada({ etaSegundos: s })).toBeNull();
        }
    });

    it('formatearNumero: separador de miles', () => {
        const filas = [0, 7, 999, 1000, 1234, 14466, 342792, 1234567, -1234, 1234.5, 0.5, 1e21, NaN, Infinity].map((n) => ({ n: String(n), da: ec.formatearNumero(n) }));
        expect(ec.formatearNumero(1234)).toBe('1.234');
        expect(ec.formatearNumero(14466)).toBe('14.466');
        expect(ec.formatearNumero(1234567)).toBe('1.234.567');
        expect(ec.formatearNumero(999)).toBe('999');
        expect(ec.formatearNumero(0)).toBe('0');
    });

    it('lineaDeRitmo: null si velocidad no es un número; sin ETA, solo la primera parte', () => {
        enElSpec('"≈ {velocidad} filas/s · faltan {espera} para terminar las filas"');
        expect(ec.lineaDeRitmo({ velocidad: 34, etaSegundos: 240 })).toBe('≈ 34 filas/s · faltan ~4 min para terminar las filas');
        expect(ec.lineaDeRitmo({ velocidad: 33.3, etaSegundos: 344 })).toBe('≈ 33,3 filas/s · faltan ~6 min para terminar las filas');
        expect(ec.lineaDeRitmo({ velocidad: 34, etaSegundos: null })).toBe('≈ 34 filas/s');
        expect(ec.lineaDeRitmo({ velocidad: 34 })).toBe('≈ 34 filas/s');
        const filas: unknown[] = [];
        const malos: string[] = [];
        const vels = [undefined, null, NaN, Infinity, -Infinity, '34' as unknown, 0, 0.1, 0.04, 33.3, 33.35, 1234.5, 1e9, -5];
        const etas = [undefined, null, NaN, Infinity, '60' as unknown, 0, -10, 30, 60, 3570, 172_800, 1e12, 12.7];
        for (const v of vels) {
            const r = ec.lineaDeRitmo({ velocidad: v as number, etaSegundos: 240 });
            filas.push({ velocidad: String(v), tipo: typeof v, eta: 240, da: r });
            if (r !== null && BASURA.test(r)) malos.push(`vel ${String(v)} -> ${r}`);
        }
        for (const eta of etas) {
            const r = ec.lineaDeRitmo({ velocidad: 34, etaSegundos: eta as number });
            filas.push({ velocidad: 34, eta: String(eta), tipo: typeof eta, da: r });
            if (r !== null && BASURA.test(r)) malos.push(`eta ${String(eta)} -> ${r}`);
        }
        expect(malos).toEqual([]);
        for (const v of [undefined, null, NaN, Infinity, '34']) expect(ec.lineaDeRitmo({ velocidad: v as number, etaSegundos: 240 }), `velocidad ${String(v)}`).toBeNull();
        expect(ec.esperaAbreviada({ etaSegundos: 240 })).toBe('faltan ~4 min');
        for (const v of [undefined, null, NaN, Infinity]) expect(ec.esperaAbreviada({ etaSegundos: v as number })).toBeNull();
    });

    it('subida: textos y unidades (KB por debajo de 0,1 MB, MB desde ahí)', () => {
        enElSpec('Subiendo archivos… N %');
        const MB = 1_048_576;
        // OJO: el spec (§9.8.2) y la wiki dicen «X de Y MB»; desde esta ronda cada parte lleva su unidad.
        expect(ec.textoSubida({ enviados: 1.5 * MB, total: 3 * MB })).toEqual({ principal: 'Subiendo archivos… 50 %', secundario: '1,5 MB de 3,0 MB', porcentaje: 50 });
        expect(ec.textoSubida({ enviados: 3 * MB, total: 3 * MB })).toEqual({
            principal: enElSpec('Armando la vista previa…'), secundario: enElSpec('El servidor está leyendo el archivo.'), porcentaje: null,
        });
        expect(ec.textoSubida({ enviados: 20_000, total: 45_000 })).toEqual({ principal: 'Subiendo archivos… 44 %', secundario: '20 KB de 44 KB', porcentaje: 44 });
        expect(ec.textoSubida({ enviados: 50_000, total: 3 * MB }).secundario).toBe('49 KB de 3,0 MB');
        expect(ec.textoSubida({ enviados: 2.2 * MB, total: 0 }).secundario).toBe('2,2 MB enviados');
        expect(ec.textoSubida({ enviados: 30_000, total: 0 }).secundario).toBe('29 KB enviados');
        const filas: unknown[] = [];
        const malos: string[] = [];
        const casos: Array<[number, number]> = [
            [0, 0], [500_000, 0], [0, 3 * MB], [1, 3 * MB], [3 * MB - 1, 3 * MB], [3 * MB, 3 * MB], [4 * MB, 3 * MB],
            [0, 1], [1, 1], [120, 240], [60_000_000, 262_144_000], [5e12, 1e13],
            [-5, 100], [50, -100], [NaN, 100], [50, NaN], [Infinity, 100], [50, Infinity], [NaN, 0],
        ];
        for (const [enviados, total] of casos) {
            const r = ec.textoSubida({ enviados, total });
            filas.push({ enviados: String(enviados), total: String(total), ...r });
            if (BASURA.test(`${r.principal} ${r.secundario}`) || Number.isNaN(r.porcentaje as number)) malos.push(`${enviados}/${total} -> ${r.principal} | ${r.secundario} | ${r.porcentaje}`);
        }
        const reales = malos.filter((m) => !/NaN\/|\/NaN|Infinity/.test(m.split(' -> ')[0]));
        expect(reales, 'con entradas finitas').toEqual([]);
    });

    it('borde de 0,1 MB (104.857,6 bytes), redondeos de KB y «menos de 1 KB»', () => {
        const sec = (enviados: number) => ec.textoSubida({ enviados, total: 0 }).secundario.replace(' enviados', '');
        const filas = [0, 1, 511, 512, 1023, 1024, 1535, 1536, 99_999, 102_400, 104_345, 104_857, 104_858, 104_859, 157_286, 157_287, 1_048_575, 1_048_576].map((b) => ({ bytes: b, da: sec(b) }));
        expect(sec(0)).toBe('');
        expect(sec(1)).toBe('menos de 1 KB');
        expect(sec(511)).toBe('menos de 1 KB');
        expect(sec(512)).toBe('1 KB');
        expect(sec(1024)).toBe('1 KB');
        expect(sec(1536)).toBe('2 KB');
        expect(sec(104_345)).toBe('102 KB');
        expect(sec(104_857)).toBe('102 KB');
        expect(sec(104_858)).toBe('0,1 MB');
        expect(sec(1_048_576)).toBe('1,0 MB');
    });

    it('subida al 0 %: sin cantidades hasta el primer byte enviado (tercera pasada)', () => {
        const MB = 1_048_576;
        expect(ec.textoSubida({ enviados: 0, total: 0 })).toEqual({ principal: 'Subiendo archivos…', secundario: '', porcentaje: null });
        expect(ec.textoSubida({ enviados: 0, total: 250 * MB })).toEqual({ principal: 'Subiendo archivos…', secundario: '', porcentaje: 0 });
        expect(ec.textoSubida({ enviados: 1, total: 250 * MB })).toEqual({ principal: 'Subiendo archivos… 0 %', secundario: 'menos de 1 KB de 250,0 MB', porcentaje: 0 });
        expect(ec.textoSubida({ enviados: 511, total: 0 })).toEqual({ principal: 'Subiendo archivos…', secundario: 'menos de 1 KB enviados', porcentaje: null });
        expect(ec.textoSubida({ enviados: 512, total: 0 }).secundario).toBe('1 KB enviados');
        // Un total de 0 bytes "ya enviado" no existe: 0 de 0 no es «Armando».
        expect(ec.textoSubida({ enviados: 0, total: 0 }).principal).toBe('Subiendo archivos…');
        const raros = ([[-5, 100], [NaN, 100], [NaN, 0], [50, NaN], [50, -100], [100, 300], [0.4, 0], [Infinity, 100], [50, Infinity]] as Array<[number, number]>)
            .map(([enviados, total]) => ({ enviados: String(enviados), total: String(total), ...ec.textoSubida({ enviados, total }) }));
        for (const r of raros) expect(`${r.principal} ${r.secundario} ${r.porcentaje}`, JSON.stringify(r)).not.toMatch(/NaN|undefined|Infinity/);
    });

    it('el porcentaje de la subida nunca muestra 100 % mientras faltan bytes, ni «Armando» antes de terminar', () => {
        const r = ec.textoSubida({ enviados: 999_999_999, total: 1_000_000_000 });
        expect(r.principal).toBe('Subiendo archivos… 99 %');
    });
});

describe('formateadores que no tiran (tercera pasada)', () => {
    const RAROS: Array<[string, unknown]> = [
        ['undefined', undefined], ['null', null], ['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['-1234', -1234], ['-0', -0], ['0', 0],
        ['1234.5', 1234.5], ['1e21', 1e21], ["'12' (string)", '12'], ["'' (string)", ''], ["'abc'", 'abc'], ['true', true], ['{}', {}], ['[]', []], ['12n (bigint)', 12n],
    ];

    it('formatearNumero: nunca tira; «0» si no es un número finito', () => {
        const filas = RAROS.map(([nombre, v]) => { let da: string; try { da = ec.formatearNumero(v as number); } catch (e) { da = `TIRA: ${(e as Error).message}`; } return { valor: nombre, da }; });
        expect(filas.filter((f) => f.da.startsWith('TIRA'))).toEqual([]);
        expect(filas.filter((f) => /NaN|undefined|null|Infinity|∞|object/.test(f.da))).toEqual([]);
        expect(ec.formatearNumero(undefined)).toBe('0');
        expect(ec.formatearNumero(null)).toBe('0');
        expect(ec.formatearNumero(NaN)).toBe('0');
        expect(ec.formatearNumero(Infinity)).toBe('0');
        expect(ec.formatearNumero(-1234)).toBe('-1.234');
        expect(ec.formatearNumero(14_466)).toBe('14.466');
        expect(ec.formatearNumero(0)).toBe('0');
    });

    it('formatearEspera y formatearMegas: nunca tiran ni devuelven NaN/Infinity', () => {
        const filas = RAROS.map(([nombre, v]) => {
            let espera: string; let megas: string;
            try { espera = ec.formatearEspera(v as number); } catch (e) { espera = `TIRA: ${(e as Error).message}`; }
            try { megas = ec.formatearMegas(v as number); } catch (e) { megas = `TIRA: ${(e as Error).message}`; }
            return { valor: nombre, espera, megas };
        });
        expect(filas.filter((f) => /TIRA|NaN|Infinity|∞|undefined/.test(f.espera + f.megas))).toEqual([]);
        expect(ec.formatearEspera(NaN)).toBe('menos de 1 min');
        expect(ec.formatearEspera(Infinity)).toBe('menos de 1 min');
        expect(ec.formatearMegas(NaN)).toBe('0,0');
        expect(ec.formatearMegas(Infinity)).toBe('0,0');
        expect(ec.formatearMegas(1_572_864)).toBe('1,5');
    });

    it('OBSERVADO — un número que llega como string ahora se muestra como 0 (antes se mostraba tal cual)', () => {
        const cola = ec.etiquetaFase({ fase: 'EN_COLA', enColaDelante: '3' as unknown as number }).secundario;
        expect(cola).not.toMatch(/NaN|undefined/);
    });
});

describe('campos ausentes (DTO de la Fase A, null, undefined)', () => {
    it('descartadasPorFiltro / fueraDeCorte / nuevos / actualizados', () => {
        for (const [nombre, v] of AUSENTES) {
            expect(ec.descartadasPorFiltro({ descartadas: 7, descartadasPorFiltro: v as number }), nombre).toBe(7);
            expect(ec.descartadasFueraDeCorte({ fueraDeCorte: v as number }), nombre).toBe(0);
            expect(ec.casosNuevos({ nuevos: v as number }), nombre).toBeNull();
            expect(ec.casosActualizados({ actualizados: v as number }), nombre).toBeNull();
        }
        expect(ec.descartadasPorFiltro({ descartadas: 7, descartadasPorFiltro: 3 })).toBe(3);
        expect(ec.descartadasPorFiltro({ descartadas: 7, descartadasPorFiltro: 0 })).toBe(0);
        expect(ec.descartadasPorFiltro(dtoFaseA({ descartadas: 7 }))).toBe(7);
        expect(ec.casosNuevos({ nuevos: 0 })).toBe(0);
        expect(ec.casosNuevos({})).toBeNull();
    });

    it('vista previa: descartadas − fueraDeCorte', () => {
        const f = ec.descartadasPorFiltroEnVistaPrevia;
        expect(f({ descartadas: 700, fueraDeCorte: 400 })).toBe(300);
        expect(f({ descartadas: 700 })).toBe(700);
        expect(f({ descartadas: 700, fueraDeCorte: null })).toBe(700);
        expect(f({ descartadas: 400, fueraDeCorte: 400 })).toBe(0);
        expect(f({ descartadas: 100, fueraDeCorte: 400 })).toBe(0);
        expect(f({})).toBe(0);
        expect(f({ descartadas: null, fueraDeCorte: null })).toBe(0);
    });
});

describe('presentarResultado — SIN_FILAS (§9.8.2)', () => {
    enElSpec('"El filtro de la plantilla descartó las {descartadasPorFiltro} filas."');
    enElSpec('"{fueraDeCorte} filas son de otros cortes de la división."');
    const sinFilas = (over: Record<string, unknown>, fabrica = dtoFaseB) => ec.presentarResultado(terminal('SIN_FILAS', { procesadas: 0, ok: 0, err: 0, ...over }, fabrica));

    it('con filtro, con corte, con los dos y con ninguno', () => {
        expect(sinFilas({ descartadas: 300 }).detalle).toBe('El filtro de la plantilla descartó las 300 filas.');
        expect(sinFilas({ descartadas: 14_000, fueraDeCorte: 14_000 }).detalle).toBe('14.000 filas son de otros cortes de la división.');
        expect(sinFilas({ descartadas: 14_300, fueraDeCorte: 14_000 }).detalle).toBe(
            'El filtro de la plantilla descartó las 300 filas. 14.000 filas son de otros cortes de la división.',
        );
        expect(sinFilas({ descartadas: 0 }).detalle).toBeNull();
        expect(sinFilas({ descartadas: 0, fueraDeCorte: 0 }).detalle).toBeNull();
        expect(sinFilas({}).titulo).toBe('El archivo no tenía filas para procesar');
    });

    it('con un DTO de la Fase A (sin los campos nuevos) da el texto de la Fase A', () => {
        expect(sinFilas({ descartadas: 300 }, dtoFaseA).detalle).toBe('El filtro de la plantilla descartó las 300 filas.');
        expect(sinFilas({ descartadas: 0 }, dtoFaseA).detalle).toBeNull();
        for (const [, v] of AUSENTES) {
            const d = sinFilas({ descartadas: 300, fueraDeCorte: v, descartadasPorFiltro: v }).detalle;
            expect(d).toBe('El filtro de la plantilla descartó las 300 filas.');
        }
    });

    it('singular (1 fila) — observado', () => {
    });

    it('ningún resultado da basura con un DTO de la Fase A', () => {
        const malos: string[] = [];
        for (const resultado of ['OK', 'CON_ERRORES', 'SIN_FILAS', 'CON_ADVERTENCIAS', 'FALLIDA', 'OTRO']) {
            for (const fabrica of [dtoFaseA, dtoFaseB]) {
                const r = ec.presentarResultado(terminal(resultado, { descartadas: 5, error: 'Motivo.', errorPostProceso: 'Se cortó.' }, fabrica));
                if (BASURA.test(`${r.titulo} ${r.detalle ?? ''}`)) malos.push(`${resultado}: ${r.detalle}`);
            }
        }
        expect(malos).toEqual([]);
    });
});

describe('presentarResultado — FALLIDA: motivo + «Antes del corte se cargaron al menos N filas» en su propio párrafo', () => {
    const fallida = (over: Record<string, unknown>) => ec.presentarResultado(terminal('FALLIDA', { procesadas: 0, ok: 0, err: 0, ...over })).detalle as string;
    const SALTO = 'Primera oración.\n\nQué hacer con esta carga.';

    it('con salto, sin salto, con y sin filas cargadas', () => {
        expect(fallida({ error: SALTO, ok: 14_400, err: 66 })).toBe('Primera oración.\n\nQué hacer con esta carga.\n\nAntes del corte se cargaron al menos 14.400 filas y 66 dieron error; el cierre de la carga no corrió.');
        expect(fallida({ error: SALTO, ok: 1790 })).toBe('Primera oración.\n\nQué hacer con esta carga.\n\nAntes del corte se cargaron al menos 1.790 filas; el cierre de la carga no corrió.');
        expect(fallida({ error: SALTO })).toBe('Primera oración.\n\nQué hacer con esta carga.');
        expect(fallida({ error: 'Un solo párrafo.', ok: 5 })).toBe('Un solo párrafo.\n\nAntes del corte se cargaron al menos 5 filas; el cierre de la carga no corrió.');
        expect(fallida({ error: 'Sin punto final', ok: 0 })).toBe('Sin punto final.');
        // Solo errores antes del corte (ok 0): no hay oración de "cargadas".
        expect(fallida({ error: 'X.', ok: 0, err: 9 })).toBe('X.');
    });

    it('bordes del motivo: ni doble punto, ni pegado, ni párrafo vacío', () => {
        const casos: Array<[string, unknown]> = [
            ['null', null], ['undefined', undefined], ['vacío', ''], ['solo espacios', '   '], ['solo saltos', '\n\n'], ['solo un punto', '.'],
            ['termina en salto', 'Motivo.\n\n'], ['termina en dos puntos seguidos', 'Motivo..'], ['termina en puntos suspensivos', 'Motivo...'],
            ['termina en espacio', 'Motivo. '], ['empieza con salto', '\n\nMotivo.'], ['tres saltos internos', 'Uno.\n\n\n\nDos.'], ['salto simple', 'Uno.\nDos.'],
            ['\\r\\n', 'Uno.\r\n\r\nDos.'],
        ];
        const filas: unknown[] = []; const malos: string[] = [];
        for (const [nombre, error] of casos) {
            for (const ok of [0, 1200]) {
                const d = fallida({ error, ok });
                filas.push({ error: nombre, ok, detalle: d });
                const parrafos = d.split('\n\n');
                const problemas = [
                    /\.\./.test(d) && 'doble punto', /^\s*\.?\s*(\n|$)/.test(d) && 'primer párrafo vacío o un punto solo',
                    parrafos.some((x) => x.trim() === '' || x.trim() === '.') && 'párrafo vacío', /\n{3,}/.test(d) && 'más de una línea en blanco seguida',
                    /[^\n]Antes del corte/.test(d) && 'la oración quedó pegada al motivo', BASURA.test(d) && 'basura',
                ].filter(Boolean);
                if (problemas.length) malos.push(`${nombre} (ok ${ok}): ${problemas.join(', ')} -> ${JSON.stringify(d)}`);
            }
        }
        // Lo que el backend puede mandar de verdad: null, un párrafo, o dos separados por una línea en blanco.
        const reales = malos.filter((m) => /^(null|undefined|vacío|termina en salto|termina en espacio) /.test(m));
        expect(reales).toEqual([]);
    });

    it('separador de miles en todos los detalles con números', () => {
        expect(ec.presentarResultado(terminal('CON_ERRORES', { ok: 14_400, err: 1066, procesadas: 15_466 })).detalle).toBe('1.066 de 15.466 filas no se cargaron. Mirá el motivo de cada una en el detalle.');
        expect(ec.presentarResultado(terminal('CON_ERRORES', { ok: 0, err: 15_466, procesadas: 15_466 })).detalle).toBe('Las 15.466 filas dieron error.');
        const adv = ec.presentarResultado(terminal('CON_ADVERTENCIAS', { ok: 14_400, err: 1066, procesadas: 15_466, errorPostProceso: 'Se cortó.' })).detalle as string;
        expect(adv.startsWith('Se cargaron 14.400 filas y 1.066 dieron error. Pero el post-proceso no terminó: Se cortó. ')).toBe(true);
    });
});

describe('minutosSinSenal', () => {
    const base = (over: Record<string, unknown> = {}) => dtoFaseB({ heartbeatAt: iso(T0 - 30_000), servidorAhora: iso(T0), ...over });

    it('aplica solo a LEYENDO, PROCESANDO y POST_PROCESO en curso', () => {
        const filas = ['BORRADOR', 'EN_COLA', 'LEYENDO', 'PROCESANDO', 'POST_PROCESO', 'TERMINADA', 'OTRA'].map((fase) => ({
            fase, minutos: ec.minutosSinSenal(base({ fase, heartbeatAt: iso(T0 - 600_000) }), 0, 0, 0),
        }));
        expect(filas).toEqual([
            { fase: 'BORRADOR', minutos: null }, { fase: 'EN_COLA', minutos: null }, { fase: 'LEYENDO', minutos: 10 },
            { fase: 'PROCESANDO', minutos: 10 }, { fase: 'POST_PROCESO', minutos: 10 }, { fase: 'TERMINADA', minutos: null }, { fase: 'OTRA', minutos: null },
        ]);
        expect(ec.minutosSinSenal(base({ enCurso: false }), 0, 0, 0)).toBeNull();
    });

    it('edad del latido con la hora del servidor + lo transcurrido en el cliente; el reloj de la PC no influye', () => {
        // Reloj de la PC 3 horas adelantado respecto del servidor: recibidoEn y ahora son del cliente.
        const cliente = T0 + 3 * 3_600_000;
        expect(ec.minutosSinSenal(base(), cliente, cliente, cliente)).toBe(0);
        expect(ec.minutosSinSenal(base(), cliente, cliente, cliente + 89_000)).toBe(1); // 30 + 89 = 119 s
        expect(ec.minutosSinSenal(base(), cliente, cliente, cliente + 90_000)).toBe(2); // 120 s
        // Reloj atrasado 3 horas.
        const atras = T0 - 3 * 3_600_000;
        expect(ec.minutosSinSenal(base(), atras, atras, atras + 90_000)).toBe(2);
        // `ahora` anterior a `recibidoEn` (useAhora va atrasado hasta 30 s): no resta.
        expect(ec.minutosSinSenal(base({ heartbeatAt: iso(T0 - 125_000) }), cliente, cliente, cliente - 20_000)).toBe(2);
    });

    it('sin heartbeatAt usa startedAt; sin servidorAhora cae a vistoEn; fechas basura no dan NaN', () => {
        expect(ec.minutosSinSenal(base({ heartbeatAt: null, startedAt: iso(T0 - 180_000) }), 0, 0, 0)).toBe(3);
        const sinServidor = sin(base(), 'servidorAhora');
        expect(ec.minutosSinSenal(sinServidor, 1_000, 1_000, 1_000 + 125_000)).toBe(2);
        for (const mal of ['no-es-fecha', '', null, undefined]) {
            const r = ec.minutosSinSenal(base({ servidorAhora: mal, heartbeatAt: mal, startedAt: mal }), 5_000, 5_000, 5_000 + 61_000);
            expect(r, `fecha ${String(mal)}`).toBe(1);
        }
        // Latido "del futuro" (relojes del servidor desfasados entre sí): nunca negativo.
        expect(ec.minutosSinSenal(base({ heartbeatAt: iso(T0 + 600_000) }), 0, 0, 0)).toBe(0);
    });
});

describe('minutosEnColaSinTomar (desde que ESTA pantalla la vio como la próxima)', () => {
    const cola = (over: Record<string, unknown> = {}) =>
        dtoFaseB({ fase: 'EN_COLA', estadoProceso: 'PROCESANDO', startedAt: null, heartbeatAt: null, encoladaAt: iso(T0 - 30 * 60_000), servidorAhora: iso(T0), enColaDelante: 0, ...over });
    const DESDE = 1_000_000;

    it('solo EN_COLA con enColaDelante === 0; la edad de encoladaAt ya no cuenta', () => {
        expect(ec.minutosEnColaSinTomar(cola(), DESDE, DESDE)).toBe(0); // 30 min encolada, recién vista como la próxima
        expect(ec.minutosEnColaSinTomar(cola(), DESDE, DESDE + 119_999)).toBe(1);
        expect(ec.minutosEnColaSinTomar(cola(), DESDE, DESDE + 120_000)).toBe(2);
        expect(ec.minutosEnColaSinTomar(cola(), DESDE, DESDE - 50_000)).toBe(0); // `ahora` atrasado: nunca negativo
        expect(ec.minutosEnColaSinTomar(cola(), null, DESDE + 600_000)).toBeNull();
        const filas = [undefined, null, 0, 1, 2, -1, NaN, '0' as unknown, false as unknown].map((v) => ({
            enColaDelante: String(v), tipo: typeof v, minutos: ec.minutosEnColaSinTomar(cola({ enColaDelante: v }), DESDE, DESDE + 150_000),
        }));
        for (const v of [undefined, null, 1, 2, '0', false]) expect(ec.minutosEnColaSinTomar(cola({ enColaDelante: v }), DESDE, DESDE + 150_000), String(v)).toBeNull();
        const sinCampo = sin(cola(), 'enColaDelante');
        expect(ec.minutosEnColaSinTomar(sinCampo, DESDE, DESDE + 150_000)).toBeNull();
        for (const fase of ['BORRADOR', 'LEYENDO', 'PROCESANDO', 'POST_PROCESO', 'TERMINADA']) expect(ec.minutosEnColaSinTomar(cola({ fase }), DESDE, DESDE + 150_000), fase).toBeNull();
        expect(ec.minutosEnColaSinTomar(cola({ enCurso: false }), DESDE, DESDE + 150_000)).toBeNull();
        // No depende de las fechas del DTO: sin encoladaAt ni servidorAhora mide igual.
        const pelado = sin(cola({ encoladaAt: null }), 'servidorAhora');
        expect(ec.minutosEnColaSinTomar(pelado, DESDE, DESDE + 150_000)).toBe(2);
    });
});

describe('firmaDeAvance', () => {
    it('cambia con fase, subfase, procesadas, ok y err; no con lo demás', () => {
        const a = dtoFaseB({ fase: 'POST_PROCESO', subfase: 'Consolidando casos: 500 de 8.875' });
        const f0 = ec.firmaDeAvance(a);
        for (const cambio of [{ fase: 'PROCESANDO' }, { subfase: 'Consolidando casos: 1.000 de 8.875' }, { subfase: null }, { procesadas: 3001 }, { ok: 2991 }, { err: 11 }]) {
            expect(ec.firmaDeAvance({ ...a, ...cambio }), JSON.stringify(cambio)).not.toBe(f0);
        }
        for (const igual of [{ rev: 99 }, { heartbeatAt: iso(T0 + 5000) }, { servidorAhora: iso(T0 + 5000) }, { progreso: 55 }, { velocidad: 3 }, { etaSegundos: 9 }, { descartadas: 77 }, { nuevos: 4 }, { enColaDelante: 2 }]) {
            expect(ec.firmaDeAvance({ ...a, ...igual }), JSON.stringify(igual)).toBe(f0);
        }
        // subfase undefined (Fase A) y null son lo mismo: no es un "cambio".
        const sin = { ...a, subfase: null }; const und = { ...a }; delete (und as any).subfase;
        expect(ec.firmaDeAvance(sin)).toBe(ec.firmaDeAvance(und));
    });
});

describe('constantes de §9.8.1', () => {
    it('umbrales', () => {
        expect(ec.SIN_SENAL_MIN).toBe(2);
        expect(ec.EN_COLA_SIN_TOMAR_MIN).toBe(2);
        expect(ec.SIN_CAMBIOS_MIN).toBe(10);
        expect(ec.SIN_SENAL_AVISAR_MIN).toBe(15);
        expect(ec.REFRESCO_COLA_MS).toBe(5_000);
        expect((ec as any).SIN_NOVEDADES_MIN).toBeUndefined();
        expect((ec as any).minutosSinNovedades).toBeUndefined();
    });
});
