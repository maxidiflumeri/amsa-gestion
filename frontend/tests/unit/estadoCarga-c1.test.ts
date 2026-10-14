// C1 — funciones puras de utils/estadoCarga.ts y textos contra §10 del spec.
import { describe, expect, it } from 'vitest';
import * as U from '@fe/utils/estadoCarga';
import { BASURA, sin, T0, dtoFaseB, iso, terminal, dtoC1, terminalC1, canceladaC1, enColaC1, TXT_CANCELADA_DEUDORES } from '../lib/fabricas';
import { enElSpec10, estaEnSpec10 } from '../lib/spec';

describe('una cancelada nunca es exitosa ni «Importación finalizada»', () => {
    it('presentarResultado: warning, «Importación cancelada», y el detalle es `error` tal cual', () => {
        const p = U.presentarResultado(canceladaC1());
        expect(p).toEqual({ severidad: 'warning', titulo: enElSpec10('Importación cancelada'), detalle: TXT_CANCELADA_DEUDORES });
        expect(p.detalle).not.toMatch(/Antes del corte se cargaron al menos/);
    });
    it('aunque `resultado` venga con otro valor (OK, CANCELADA, null, desconocido), `cancelada: true` manda', () => {
        const visto: Record<string, string> = {};
        for (const resultado of ['OK', 'CANCELADA', null, 'CON_ERRORES', 'ALGO_NUEVO', 'FALLIDA']) {
            const p = U.presentarResultado(canceladaC1({ resultado }));
            visto[String(resultado)] = `${p.severidad}/${p.titulo}`;
            expect(p.titulo, String(resultado)).toBe('Importación cancelada');
            expect(p.severidad).toBe('warning');
        }
    });
    it('una cancelada SIN el campo `cancelada` (pestaña vieja / backend que no lo manda): FALLIDA con su motivo, nunca «finalizada»', () => {
        const d = sin(canceladaC1(), 'cancelada');
        const p = U.presentarResultado(d);
        expect(p.titulo).toBe('La importación falló');
        expect(p.severidad).toBe('error');
    });
    it('columna cruda `resultado: "CANCELADA"` SIN `cancelada:true` (si el backend filtrara el valor de la columna): cae en «Importación finalizada» azul', () => {
        const d = terminalC1('CANCELADA', { cancelada: false, error: TXT_CANCELADA_DEUDORES, procesadas: 3000, ok: 2990, err: 10, estadoProceso: 'FALLIDA' });
        const p = U.presentarResultado(d);
        // No es un hallazgo del frontend por sí solo: §10.4.2 obliga al backend a traducir. Se deja medido.
        expect(p.titulo).toBe('Importación finalizada');
    });
    it('cancelada sin `error`: sin detalle, sin basura', () => {
        const p = U.presentarResultado(canceladaC1({ error: null }));
        expect(p).toEqual({ severidad: 'warning', titulo: 'Importación cancelada', detalle: null });
    });
});

describe('peorResultado: una cancelada va entre FALLIDA y CON_ADVERTENCIAS', () => {
    const ok = terminalC1('OK', { remesaId: 1 });
    const adv = terminalC1('CON_ADVERTENCIAS', { remesaId: 2, errorPostProceso: 'x' });
    const can = canceladaC1({ remesaId: 3 });
    const fal = terminalC1('FALLIDA', { remesaId: 4, error: 'x' });
    const sin = terminalC1('SIN_FILAS', { remesaId: 5 });
    const err0 = terminalC1('CON_ERRORES', { remesaId: 6, ok: 0, err: 5 });
    it('orden', () => {
        expect(U.peorResultado([ok, adv, can, fal, sin, err0])!.remesaId).toBe(4);
        expect(U.peorResultado([ok, adv, can, sin, err0])!.remesaId).toBe(3);
        expect(U.peorResultado([ok, adv, sin, err0])!.remesaId).toBe(2);
        expect(U.peorResultado([ok, can])!.remesaId).toBe(3);
        expect(U.peorResultado([can, ok])!.remesaId).toBe(3);
    });
});

describe('motivoNoCancelable (§10.8.4)', () => {
    const POST = enElSpec10('La importación ya procesó todas las filas y está cerrando: en este paso no se puede cancelar.');
    const ACC = enElSpec10('Una acción masiva que ya empezó no se cancela: esperá a que termine y usá Revertir.');
    const YA = enElSpec10('Ya se pidió cancelar.');
    it('los tres motivos', () => {
        expect(U.motivoNoCancelable(dtoC1({ fase: 'POST_PROCESO' }))).toBe(POST);
        expect(U.motivoNoCancelable(dtoC1({ tipo: 'ACCIONES' }))).toBe(ACC);
        expect(U.motivoNoCancelable(dtoC1({ cancelacionPedidaAt: iso(T0) }))).toBe(YA);
        expect(U.motivoNoCancelable(dtoC1({ tipo: 'ACCIONES', fase: 'POST_PROCESO' }))).toBe(POST);
    });
    it('cancelable, terminal, o sin el campo: null', () => {
        expect(U.motivoNoCancelable(dtoC1())).toBeNull();
        expect(U.motivoNoCancelable(terminalC1('OK'))).toBeNull();
        expect(U.motivoNoCancelable(dtoFaseB({ fase: 'POST_PROCESO' }))).toBeNull();
        expect(U.motivoNoCancelable(enColaC1({ tipo: 'ACCIONES' }))).toBeNull();
    });
    it('en curso, `cancelable:false` y ninguno de los tres motivos: null (botón deshabilitado SIN explicación)', () => {
        const casos = [dtoC1({ cancelable: false }), enColaC1({ cancelable: false }), dtoC1({ fase: 'LEYENDO', cancelable: false })];
        for (const c of casos) expect(U.motivoNoCancelable(c)).toBeNull();
    });
});

describe('cancelacionLlegoTarde (§10.8.4, desvío 1)', () => {
    it('qué resultados dicen «terminó completa»', () => {
        const pedido = { cancelacionPedidaAt: iso(T0 - 1000) };
        const visto: Record<string, boolean> = {};
        for (const r of ['OK', 'CON_ERRORES', 'SIN_FILAS', 'CON_ADVERTENCIAS', 'FALLIDA']) visto[r] = U.cancelacionLlegoTarde(terminalC1(r, pedido));
        visto['CON_ERRORES ok=0'] = U.cancelacionLlegoTarde(terminalC1('CON_ERRORES', { ...pedido, ok: 0, err: 9 }));
        visto['cancelada'] = U.cancelacionLlegoTarde(canceladaC1());
        visto['en curso'] = U.cancelacionLlegoTarde(dtoC1(pedido));
        visto['sin pedido'] = U.cancelacionLlegoTarde(terminalC1('OK'));
        visto['Fase B'] = U.cancelacionLlegoTarde(terminal('OK'));
        expect(visto.OK).toBe(true);
        expect(visto.FALLIDA).toBe(false);
        expect(visto.cancelada).toBe(false);
        expect(visto['en curso']).toBe(false);
        expect(visto['sin pedido']).toBe(false);
        expect(visto['Fase B']).toBe(false);
    });
});

describe('segunda pasada: texto del pedido tardío y «Cancelando…» en la lista', () => {
    it('`textoCancelacionTardia`: «terminó completa» solo con OK', () => {
        const visto = Object.fromEntries(['OK', 'CON_ERRORES', 'SIN_FILAS', 'CON_ADVERTENCIAS', null, 'ALGO'].map((r) => [String(r), (U as any).textoCancelacionTardia(r)]));
        expect(visto.OK).toBe('Se pidió cancelar esta importación cuando ya estaba cerrando: terminó completa.');
        for (const [k, x] of Object.entries(visto)) if (k !== 'OK') expect(x, k).toBe('Se pidió cancelar esta importación cuando ya estaba cerrando: el pedido llegó tarde y la carga terminó igual.');
    });
    it('`estadoEnGrupo` con la cancelación pedida: «Cancelando…» en cualquier fase en curso; nunca en una terminada', () => {
        const pedido = { cancelacionPedidaAt: iso(T0) };
        expect(U.estadoEnGrupo(dtoC1(pedido))).toEqual({ texto: 'Cancelando…', color: 'warning' });
        expect(U.estadoEnGrupo(enColaC1(pedido)).texto).toBe('Cancelando…');
        expect(U.estadoEnGrupo(dtoC1({ ...pedido, fase: 'POST_PROCESO' })).texto).toBe('Cancelando…');
        expect(U.estadoEnGrupo(terminalC1('OK', pedido)).texto).toBe('Finalizada');
        expect(U.estadoEnGrupo(canceladaC1()).texto).toBe('Cancelada');
        expect(U.estadoEnGrupo(terminalC1('FALLIDA', { ...pedido, error: 'x' })).texto).toBe('Falló');
    });
});

describe('estadoEnGrupo (§10.8.3)', () => {
    it('una frase por estado', () => {
        const casos: Array<[string, any]> = [
            ['en cola', enColaC1()],
            ['procesando 43', dtoC1({ progreso: 43 })],
            ['procesando sin total', dtoC1({ totalEsperado: 0 })],
            ['leyendo', dtoC1({ fase: 'LEYENDO' })],
            ['post', dtoC1({ fase: 'POST_PROCESO' })],
            ['ok', terminalC1('OK')],
            ['con errores', terminalC1('CON_ERRORES')],
            ['con errores ok=0', terminalC1('CON_ERRORES', { ok: 0, err: 3 })],
            ['sin filas', terminalC1('SIN_FILAS')],
            ['advertencias', terminalC1('CON_ADVERTENCIAS', { errorPostProceso: 'x' })],
            ['fallida', terminalC1('FALLIDA', { error: 'x' })],
            ['fallida sin arrancar', terminalC1('FALLIDA', { error: 'x', startedAt: null })],
            ['cancelada', canceladaC1()],
            ['cancelada sin arrancar', canceladaC1({ startedAt: null })],
            ['borrador', dtoC1({ fase: 'BORRADOR', enCurso: false })],
            ['fase nueva', dtoC1({ fase: 'FASE_NUEVA' })],
            ['resultado desconocido', terminalC1('ALGO_NUEVO')],
        ];
        const visto = Object.fromEntries(casos.map(([n, d]) => [n, U.estadoEnGrupo(d)]));
        expect(visto['en cola'].texto).toBe('En cola');
        expect(visto['procesando 43'].texto).toBe('Procesando 43 %');
        expect(visto['ok']).toEqual({ texto: 'Finalizada', color: 'success' });
        expect(visto['fallida'].texto).toBe('Falló');
        expect(visto['fallida sin arrancar'].texto).toBe('No llegó a empezar');
        expect(visto['cancelada'].texto).toBe('Cancelada');
        expect(visto['cancelada']).not.toMatchObject({ color: 'success' });
        expect(visto['cancelada sin arrancar']).not.toMatchObject({ color: 'success' });
        for (const x of Object.values(visto)) expect((x as any).texto).not.toMatch(BASURA);
    });
});

describe('grupo: remesa actual y terminado', () => {
    it('la primera en curso por orden; si no hay, la última', () => {
        const a = terminalC1('OK', { remesaId: 1 }); const b = dtoC1({ remesaId: 2 }); const c = enColaC1({ remesaId: 3 });
        expect(U.remesaActualDelGrupo([a, b, c])!.remesaId).toBe(2);
        expect(U.remesaActualDelGrupo([a, terminalC1('OK', { remesaId: 2 }), c])!.remesaId).toBe(3);
        expect(U.remesaActualDelGrupo([a])!.remesaId).toBe(1);
        expect(U.remesaActualDelGrupo([])).toBeNull();
        expect(U.grupoTerminado([])).toBe(false);
        expect(U.grupoTerminado([a])).toBe(true);
        expect(U.grupoTerminado([a, b])).toBe(false);
    });
    it('un borrador dentro del grupo (ni en curso ni terminal) nunca deja terminar al grupo', () => {
        const borr = dtoC1({ remesaId: 9, fase: 'BORRADOR', enCurso: false });
        expect(U.grupoTerminado([terminalC1('OK'), borr])).toBe(false);
    });
});

describe('permiso de cancelar y retomar', () => {
    const tiene = (ps: string[]) => (k: string) => ps.includes(k);
    it('ejecutar + (dueño o ver_progreso_otros)', () => {
        const c = dtoC1({ usuarioId: 3 });
        expect(U.puedeGestionarCarga(c, 3, tiene(['importacion.ejecutar']))).toBe(true);
        expect(U.puedeGestionarCarga(c, 8, tiene(['importacion.ejecutar']))).toBe(false);
        expect(U.puedeGestionarCarga(c, 8, tiene(['importacion.ejecutar', 'importacion.ver_progreso_otros']))).toBe(true);
        expect(U.puedeGestionarCarga(c, 3, tiene(['importacion.ver_progreso_otros']))).toBe(false);
        expect(U.puedeGestionarCarga(c, 3, tiene([]))).toBe(false);
        expect(U.puedeGestionarCarga(c, null, tiene(['importacion.ejecutar']))).toBe(false);
        expect(U.puedeGestionarCarga(c, undefined, tiene(['importacion.ejecutar']))).toBe(false);
    });
    it('id del usuario como string (JWT viejo en localStorage): el dueño NO se reconoce', () => {
        const r = U.puedeGestionarCarga(dtoC1({ usuarioId: 3 }), '3' as any, tiene(['importacion.ejecutar']));
    });
});

describe('retomable y cancelable: nunca deducidos', () => {
    it('solo `=== true`', () => {
        for (const v of [undefined, null, false, 'true', 1, 0, {}]) {
            expect(U.esRetomable({ retomable: v as any }), String(v)).toBe(false);
            expect(U.esCancelable({ cancelable: v as any }), String(v)).toBe(false);
            expect(U.estaCancelada({ cancelada: v as any }), String(v)).toBe(false);
        }
        expect(U.esRetomable({ retomable: true })).toBe(true);
        // Una FALLIDA sin arrancar, con todo en cero, sin el flag: NO es retomable para el frontend.
        expect(U.esRetomable(terminalC1('FALLIDA', { startedAt: null, procesadas: 0, ok: 0, err: 0 }))).toBe(false);
    });
});

describe('edad del pedido de cancelación', () => {
    it('con la hora del servidor; null sin pedido o sin servidorAhora', () => {
        const d = dtoC1({ cancelacionPedidaAt: iso(T0 - 125_000), servidorAhora: iso(T0) });
        expect(U.minutosDesdePedidoCancelacion(d, 1000, 1000)).toBe(2);
        expect(U.minutosDesdePedidoCancelacion(d, 1000, 1000 + 60_000)).toBe(3);
        expect(U.minutosDesdePedidoCancelacion(dtoC1(), 0, 0)).toBeNull();
        const sinHora = sin(dtoC1({ cancelacionPedidaAt: iso(T0) }), 'servidorAhora');
        expect(U.minutosDesdePedidoCancelacion(sinHora, 0, 10 * 60_000)).toBeNull();
        // Reloj del navegador adelantado respecto del servidor: no cuenta.
        expect(U.minutosDesdePedidoCancelacion(dtoC1({ cancelacionPedidaAt: iso(T0 + 60_000), servidorAhora: iso(T0) }), 0, 0)).toBe(0);
    });
});

describe('DTO de la Fase B (sin los ocho campos) en las funciones nuevas', () => {
    it('nada tira y nada inventa', () => {
        const b = dtoFaseB(); const t = terminal('FALLIDA', { error: 'x', startedAt: null });
        expect(U.datosDeGrupo(b)).toBeNull();
        expect(U.cancelacionPedidaAt(b)).toBeNull();
        expect(U.esCancelable(b)).toBe(false);
        expect(U.esRetomable(t)).toBe(false);
        expect(U.estaCancelada(t)).toBe(false);
        expect(U.motivoNoCancelable(b)).toBeNull();
        expect(U.cancelacionLlegoTarde(t)).toBe(false);
        expect(U.minutosDesdePedidoCancelacion(b, 0, 0)).toBeNull();
        expect(U.estadoEnGrupo(b).texto).not.toMatch(BASURA);
        expect(U.estadoEnGrupo(t).texto).not.toMatch(BASURA);
        expect(U.presentarResultado(t).titulo).toBe('La importación falló');
    });
});

describe('textos del frontend contra §10 (carácter por carácter donde el spec los fija)', () => {
    it('línea por categoría del diálogo de cancelar: qué afirma cada una', () => {
        const visto = Object.fromEntries(['DEUDORES', 'DEUDORES_Y_FACTURAS', 'ACTUALIZACIONES', 'PAGOS', 'FACTURAS', 'CONTACTOS', 'ENRIQUECIMIENTO', 'MULTICLAVES', 'MULTIRREGISTRO', 'MULTIARCHIVO', 'ACCIONES', 'OTRA'].map((t) => [t, U.lineaCancelarPorCategoria(t)]));
        for (const x of Object.values(visto)) expect(x).not.toMatch(BASURA);
    });
    it('textos fijos de §10.8 que el código tiene que tener tal cual (se buscan en el fuente)', async () => {
        const fs = await import('node:fs');
        const { RAIZ_FE: FE } = await import('../lib/raiz');
        const leer = (r: string) => fs.readFileSync(`${FE}/src/${r}`, 'utf8').replace(/\s*\n\s*/g, ' ');
        const fuentes = ['pages/ImportWizard.tsx', 'pages/ImportDetail.tsx', 'components/import/ImportProgress.tsx', 'components/import/ImportSummary.tsx', 'components/import/AvisosCarga.tsx', 'utils/estadoCarga.ts', 'components/layout/AppShell/ImportEnCursoItem.tsx'].map(leer).join('\n');
        const esperados = [
            'Las remesas se cargan una después de la otra en el servidor. Podés cerrar esta pantalla: siguen igual, y las ves en la campanita y en el Historial.',
            'Si lo cargás de nuevo, sus casos quedan duplicados',
            'Esta importación todavía no empezó. Si la cancelás no se carga ninguna fila, y después la podés retomar desde su detalle.',
            'Se pidió cancelar esta importación. Se corta al terminar la fila o el lote en curso; lo ya procesado queda cargado.',
            'Se pidió cancelar esta importación cuando ya estaba cerrando: terminó completa.',
            'Mientras no arranque, la podés cancelar desde acá (queda para retomar) o eliminar desde el Historial.',
            'Se vuelve a encolar la misma remesa, con el mismo archivo. No se cargó ninguna fila la vez anterior.',
            'Cancelar solo esta remesa', 'Cancelar todo lo que falta', 'Cancelar importación', 'Cargar las que faltan', 'Remesas que se van a cargar',
            'Importación cancelada', 'Cancelando…', 'Ya se pidió cancelar.',
            'La importación ya procesó todas las filas y está cerrando: en este paso no se puede cancelar.',
            'Una acción masiva que ya empezó no se cancela: esperá a que termine y usá Revertir.',
        ];
        const faltanEnSpec = esperados.filter((t) => !estaEnSpec10(t));
        const faltanEnCodigo = esperados.filter((t) => !fuentes.includes(t));
        expect(faltanEnSpec).toEqual([]);
        expect(faltanEnCodigo).toEqual([]);
    });
});
