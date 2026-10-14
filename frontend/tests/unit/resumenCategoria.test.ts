// C3a: las líneas de "Qué hizo la carga" (docs/imports-progreso-c3-spec.md §6.2).
import { describe, expect, it } from 'vitest';
import { lineasDeResumen, type CargaParaResumen } from '@fe/utils/resumenCategoria';
import type { ResumenCategoria } from '@fe/types/importProgreso';
import { BASURA } from '../lib/fabricas';

const carga = (over: Partial<CargaParaResumen> = {}): CargaParaResumen => ({ ok: 100, err: 0, cancelada: false, resultado: 'OK', ...over });
const textos = (r: ResumenCategoria | null | undefined, c = carga()) => lineasDeResumen(r, c).map((l) => l.texto);
const avisos = (r: ResumenCategoria, c = carga()) => lineasDeResumen(r, c).filter((l) => l.tono === 'aviso').map((l) => l.texto);

describe('DEUDORES y DEUDORES_Y_FACTURAS', () => {
    it('CA-3: 100 filas ok, 97 casos nuevos: 3 filas cayeron sobre un caso de la misma carga (aviso)', () => {
        const r: ResumenCategoria = { tipo: 'DEUDORES', casosNuevos: 97, contactosCopiados: 0 };
        expect(textos(r)).toEqual([
            '97 casos nuevos',
            '3 filas cayeron sobre un caso que esta misma carga ya había creado: el archivo repite la identidad del caso y la última fila pisó a la anterior',
        ]);
        expect(avisos(r)).toHaveLength(1);
    });
    it('singulares: 1 fila cayó, 1 caso nuevo, 1 contacto copiado', () => {
        const r: ResumenCategoria = { tipo: 'DEUDORES', casosNuevos: 1, contactosCopiados: 1 };
        expect(textos(r, carga({ ok: 2 }))).toEqual([
            '1 caso nuevo',
            '1 fila cayó sobre un caso que esta misma carga ya había creado: el archivo repite la identidad del caso y la última fila pisó a la anterior',
            '1 contacto copiado de casos anteriores del mismo cliente',
        ]);
    });
    it('ok = casosNuevos: sin la línea de aviso; los ceros no se muestran, pero "casos nuevos" sí (siempre)', () => {
        expect(textos({ tipo: 'DEUDORES', casosNuevos: 100, contactosCopiados: 0 })).toEqual(['100 casos nuevos']);
        expect(textos({ tipo: 'DEUDORES', casosNuevos: 0, contactosCopiados: 0 }, carga({ ok: 0 }))).toEqual(['0 casos nuevos']);
    });
    it('miles con punto', () => {
        expect(textos({ tipo: 'DEUDORES_Y_FACTURAS', casosNuevos: 12345, casosConFacturas: 12345, contactosCopiados: 1500 }, carga({ ok: 12345 }))).toEqual([
            '12.345 casos nuevos',
            'Facturas en 12.345 casos',
            '1.500 contactos copiados de casos anteriores del mismo cliente',
        ]);
    });
});

describe('DEUDORES_Y_FACTURAS (una fila por factura es lo normal)', () => {
    it('un deudor con 3 facturas (ok 3, 1 caso): sin la línea de "cayeron"; muestra casos con facturas', () => {
        const r: ResumenCategoria = { tipo: 'DEUDORES_Y_FACTURAS', casosNuevos: 1, casosConFacturas: 1, contactosCopiados: 0 };
        const t = textos(r, carga({ ok: 3 }));
        expect(t).toEqual(['1 caso nuevo', 'Facturas en 1 caso']);
        expect(avisos(r, carga({ ok: 3 }))).toEqual([]);
    });
    it('plurales y contactos copiados; casosConFacturas en cero no se muestra; casos nuevos sí', () => {
        expect(textos({ tipo: 'DEUDORES_Y_FACTURAS', casosNuevos: 5, casosConFacturas: 4, contactosCopiados: 1 }, carga({ ok: 40 }))).toEqual([
            '5 casos nuevos', 'Facturas en 4 casos', '1 contacto copiado de casos anteriores del mismo cliente',
        ]);
        expect(textos({ tipo: 'DEUDORES_Y_FACTURAS', casosNuevos: 0, casosConFacturas: 0, contactosCopiados: 0 }, carga({ ok: 0 }))).toEqual(['0 casos nuevos']);
    });
});

describe('FACTURAS, CONTACTOS y ENRIQUECIMIENTO', () => {
    it('FACTURAS: facturas en N casos y clientes inexistentes en aviso', () => {
        const r: ResumenCategoria = { tipo: 'FACTURAS', casosConFacturas: 40, clientesInexistentes: 2 };
        expect(textos(r)).toEqual(['Facturas en 40 casos', '2 clientes del archivo no existen en la remesa de origen (sus filas figuran como error)']);
        expect(avisos(r)).toHaveLength(1);
        expect(textos({ tipo: 'FACTURAS', casosConFacturas: 1, clientesInexistentes: 1 })).toEqual(['Facturas en 1 caso', '1 cliente del archivo no existe en la remesa de origen (su fila figura como error)']);
        expect(textos({ tipo: 'FACTURAS', casosConFacturas: 5, clientesInexistentes: 0 })).toEqual(['Facturas en 5 casos']);
    });
    it.each(['CONTACTOS', 'ENRIQUECIMIENTO'] as const)('%s: contactos principales cargados y filas sin contacto principal válido (aviso)', (tipo) => {
        const r: ResumenCategoria = { tipo, contactosCargados: 90, filasSinContactoValido: 10 };
        expect(textos(r)).toEqual([
            '90 contactos principales cargados',
            '10 filas no tenían un contacto principal válido (vacío, o un teléfono o mail que no se pudo normalizar): ese contacto no se cargó y la fila no figura como error',
        ]);
        expect(avisos(r)).toHaveLength(1);
        expect(textos({ tipo, contactosCargados: 1, filasSinContactoValido: 1 })).toEqual([
            '1 contacto principal cargado',
            '1 fila no tenía un contacto principal válido (vacío, o un teléfono o mail que no se pudo normalizar): ese contacto no se cargó y la fila no figura como error',
        ]);
        expect(textos({ tipo, contactosCargados: 7, filasSinContactoValido: 0 })).toEqual(['7 contactos principales cargados']);
    });
});

describe('PAGOS', () => {
    it('los pagos negativos son un aviso ("aumentan la deuda"); los ya cargados y las facturas marcadas, normales', () => {
        const r: ResumenCategoria = { tipo: 'PAGOS', casosConPagos: 50, yaCargados: 5, negativos: 2, facturasMarcadas: 48, claves: null };
        expect(textos(r)).toEqual([
            'Pagos en 50 casos',
            '5 pagos ya estaban cargados y no se duplicaron',
            '2 pagos con importe negativo: aumentan la deuda del caso',
            '48 facturas marcadas como pagadas',
        ]);
        expect(avisos(r)).toEqual(['2 pagos con importe negativo: aumentan la deuda del caso']);
    });
    it('singulares', () => {
        expect(textos({ tipo: 'PAGOS', casosConPagos: 1, yaCargados: 1, negativos: 1, facturasMarcadas: 1, claves: null })).toEqual([
            'Pagos en 1 caso',
            '1 pago ya estaba cargado y no se duplicó',
            '1 pago con importe negativo: aumenta la deuda del caso',
            '1 factura marcada como pagada',
        ]);
    });
    it('con claves: las que no se pudieron resolver, en aviso; con claves null o en cero, nada', () => {
        const claves = { cargada: 10, noCargada: 3, otraEmpresa: 1, ilegible: 2, tramitesEnVariosCasos: 4, casosFueraDeRemesaOrigen: 6 };
        const r: ResumenCategoria = { tipo: 'PAGOS', casosConPagos: 0, yaCargados: 0, negativos: 0, facturasMarcadas: 0, claves };
        expect(textos(r)).toEqual([
            '3 claves no están cargadas',
            '1 clave es de otra empresa',
            '2 referencias ilegibles',
            '6 casos fuera de las remesas de origen',
        ]);
        expect(avisos(r)).toHaveLength(4);
        expect(textos({ ...r, claves: { ...claves, noCargada: 0, otraEmpresa: 0, ilegible: 0, casosFueraDeRemesaOrigen: 0 } } as ResumenCategoria)).toEqual([]);
    });
});

describe('ACTUALIZACIONES', () => {
    const base = { tipo: 'ACTUALIZACIONES' as const, coincidencias: 80, casosNuevos: 5, reasignados: 2, contactosCopiados: 0 };
    const aus = (a: Partial<Extract<ResumenCategoria, { tipo: 'ACTUALIZACIONES' }>['ausentes']>): ResumenCategoria => ({
        ...base, ausentes: { accion: 'PAGO_TODO', resultado: 'APLICADO', pagosGenerados: 0, desasignados: 0, salteadosSinMonto: 0, ...a },
    });
    const PRIMERA = '80 filas coincidieron con casos de la cartera · 5 casos nuevos · 2 reasignados';

    it('la primera línea siempre sale, con singulares', () => {
        expect(textos(aus({ resultado: 'OMITIDO_SOLO_DATOS' }))[0]).toBe(PRIMERA);
        expect(textos({ ...base, coincidencias: 1, casosNuevos: 1, reasignados: 1, ausentes: { accion: 'IGNORAR', resultado: 'OMITIDO_SOLO_DATOS', pagosGenerados: 0, desasignados: 0, salteadosSinMonto: 0 } })[0])
            .toBe('1 fila coincidió con un caso de la cartera · 1 caso nuevo · 1 reasignado');
        expect(textos(aus({ resultado: 'NO_LLEGO' }), carga({ resultado: null }))).toEqual([PRIMERA]);
    });
    it('APLICADO + PAGO_TODO: ausentes dados por pagados y, en aviso, los que no tenían importe', () => {
        const r = aus({ pagosGenerados: 12, salteadosSinMonto: 3 });
        expect(textos(r)).toEqual([PRIMERA, '12 casos ausentes del archivo se dieron por pagados', '3 ausentes sin importe no se tocaron']);
        expect(avisos(r)).toEqual(['3 ausentes sin importe no se tocaron']);
        expect(textos(aus({ pagosGenerados: 1, salteadosSinMonto: 1 })).slice(1)).toEqual(['1 caso ausente del archivo se dio por pagado', '1 ausente sin importe no se tocó']);
    });
    it('APLICADO + DESASIGNAR e IGNORAR', () => {
        expect(textos(aus({ accion: 'DESASIGNAR', desasignados: 7 })).slice(1)).toEqual(['7 casos ausentes del archivo se desasignaron']);
        expect(textos(aus({ accion: 'DESASIGNAR', desasignados: 1 })).slice(1)).toEqual(['1 caso ausente del archivo se desasignó']);
        expect(textos(aus({ accion: 'DESASIGNAR', desasignados: 0 })).slice(1)).toEqual([]);
        expect(textos(aus({ accion: 'IGNORAR' })).slice(1)).toEqual(['Los casos ausentes del archivo no se tocaron (la plantilla dice ignorarlos)']);
    });
    it('CA-5: ABORTADO_SIN_COINCIDENCIAS es un aviso que dice qué revisar', () => {
        const r = aus({ resultado: 'ABORTADO_SIN_COINCIDENCIAS' });
        expect(textos(r).slice(1)).toEqual(['No se dio por pagado a ningún ausente: ninguna fila del archivo coincidió con un caso que ya estuviera en la remesa de origen. Revisá el archivo, la plantilla y la remesa de origen.']);
        expect(avisos(r)).toHaveLength(1);
    });
    it('ABORTADO_SIN_COINCIDENCIAS con DESASIGNAR: aviso propio', () => {
        const r = aus({ accion: 'DESASIGNAR', resultado: 'ABORTADO_SIN_COINCIDENCIAS' });
        expect(textos(r).slice(1)).toEqual(['No se desasignó a ningún ausente: ninguna fila del archivo coincidió con un caso que ya estuviera en la remesa de origen. Revisá el archivo, la plantilla y la remesa de origen.']);
        expect(avisos(r)).toHaveLength(1);
    });
    it('OMITIDO_SOLO_DATOS: normal', () => {
        const r = aus({ resultado: 'OMITIDO_SOLO_DATOS' });
        expect(textos(r).slice(1)).toEqual(['Los ausentes no se tocaron: la plantilla solo actualiza datos, o el archivo no trajo importes']);
        expect(avisos(r)).toEqual([]);
    });
    it('SIN_REMESA_ORIGEN: aviso salvo que la plantilla ignore a los ausentes', () => {
        expect(avisos(aus({ resultado: 'SIN_REMESA_ORIGEN' }))).toHaveLength(1);
        expect(avisos(aus({ resultado: 'SIN_REMESA_ORIGEN', accion: 'IGNORAR' }))).toEqual([]);
    });
    it('NO_LLEGO: "no corrió" en cancelada o fallida; "no llegó a terminar" en otra terminal', () => {
        const r = aus({ resultado: 'NO_LLEGO' });
        expect(textos(r, carga({ cancelada: true, resultado: 'FALLIDA' }))).toEqual([PRIMERA, 'El cierre de los ausentes no corrió']);
        expect(avisos(r, carga({ cancelada: false, resultado: 'FALLIDA' }))).toEqual(['El cierre de los ausentes no corrió']);
        // Terminal que no es cancelada ni fallida (p. ej. CON_ADVERTENCIAS por un fallo de la consolidación): aviso
        expect(textos(r, carga({ resultado: 'CON_ADVERTENCIAS' }))).toEqual([PRIMERA, 'El cierre de los ausentes no llegó a terminar: mirá el aviso de la carga.']);
        expect(avisos(r, carga({ resultado: 'CON_ADVERTENCIAS' }))).toHaveLength(1);
        // En curso (resultado null): no se dice nada
        expect(textos(r, carga({ resultado: null }))).toEqual([PRIMERA]);
    });
});

describe('ACCIONES', () => {
    it('casos afectados siempre; comentarios y contactos si hay; cancelados saltados y filas sin caso (aviso)', () => {
        const r: ResumenCategoria = { tipo: 'ACCIONES', deudoresAfectados: 40, comentariosCreados: 40, contactosEliminados: 3, saltadosCancelados: 2, filasSinMatch: 5 };
        expect(textos(r)).toEqual(['40 casos afectados · 40 comentarios · 3 contactos eliminados', '2 casos cancelados se saltearon', '5 filas no encontraron ningún caso']);
        expect(avisos(r)).toEqual(['5 filas no encontraron ningún caso']);
        expect(textos({ tipo: 'ACCIONES', deudoresAfectados: 1, comentariosCreados: 1, contactosEliminados: 1, saltadosCancelados: 1, filasSinMatch: 1 })).toEqual([
            '1 caso afectado · 1 comentario · 1 contacto eliminado', '1 caso cancelado se salteó', '1 fila no encontró ningún caso',
        ]);
        expect(textos({ tipo: 'ACCIONES', deudoresAfectados: 0, comentariosCreados: 0, contactosEliminados: 0, saltadosCancelados: 0, filasSinMatch: 0 })).toEqual(['0 casos afectados']);
    });
});

describe('MULTIRREGISTRO y MULTIARCHIVO', () => {
    const base = { altas: 10, actualizados: 20, reasignados: 0, desasignados: 1, contactosCopiados: 0, bajas: 0, bajasPago: 0, bajasRetiradas: 0, bajasYaAplicadas: 0, bajasSinMatch: 0, bajasAmbiguas: 0, casosDadosDeBaja: 0 };
    it.each(['MULTIRREGISTRO', 'MULTIARCHIVO'] as const)('%s: movimientos sin los ceros', (tipo) => {
        expect(textos({ tipo, ...base })).toEqual(['10 altas · 20 actualizados · 1 desasignado']);
    });
    it('bajas: por pago y retiradas por el cedente; ya aplicadas (D1) y sin match o ambiguas (aviso); casos dados de baja', () => {
        const r: ResumenCategoria = { tipo: 'MULTIRREGISTRO', ...base, altas: 0, actualizados: 0, desasignados: 0, bajas: 7, bajasPago: 5, bajasRetiradas: 2, bajasYaAplicadas: 5, bajasSinMatch: 2, bajasAmbiguas: 1, casosDadosDeBaja: 3 };
        expect(textos(r)).toEqual([
            '7 bajas: 5 por pago, 2 retiradas por el cedente',
            '5 bajas por pago ya estaban aplicadas y no se volvieron a registrar',
            '2 bajas sin factura que coincida, 1 ambigua',
            '3 casos quedaron sin facturas vigentes y salieron de gestión',
        ]);
        expect(avisos(r)).toEqual(['2 bajas sin factura que coincida, 1 ambigua']);
    });
    it('singulares', () => {
        const r: ResumenCategoria = { tipo: 'MULTIARCHIVO', ...base, altas: 1, actualizados: 0, desasignados: 0, bajas: 1, bajasPago: 1, bajasYaAplicadas: 1, bajasSinMatch: 1, casosDadosDeBaja: 1 };
        expect(textos(r)).toEqual([
            '1 alta', '1 baja: 1 por pago', '1 baja por pago ya estaba aplicada y no se volvió a registrar', '1 baja sin factura que coincida', '1 caso quedó sin facturas vigentes y salió de gestión',
        ]);
    });
});

describe('MULTICLAVES', () => {
    it('trámites con y sin caso, y los ya cargados', () => {
        expect(textos({ tipo: 'MULTICLAVES', yaCargadas: 4, tramites: 30, conCaso: 25, sinCaso: 5, casosReconsolidados: 25 })).toEqual(['30 trámites: 25 con caso, 5 sin caso · 4 ya estaban cargados']);
        expect(textos({ tipo: 'MULTICLAVES', yaCargadas: 1, tramites: 1, conCaso: 1, sinCaso: 0, casosReconsolidados: null })).toEqual(['1 trámite: 1 con caso, 0 sin caso · 1 ya estaba cargado']);
    });
    it('con los trámites sin informar (null), solo lo que se sabe', () => {
        expect(textos({ tipo: 'MULTICLAVES', yaCargadas: 4, tramites: null, conCaso: null, sinCaso: null, casosReconsolidados: null })).toEqual(['4 ya estaban cargados']);
        expect(textos({ tipo: 'MULTICLAVES', yaCargadas: 0, tramites: null, conCaso: null, sinCaso: null, casosReconsolidados: null })).toEqual([]);
    });
});

describe('lo que no hay o no se conoce', () => {
    it('null, undefined (backend anterior), un tipo desconocido y un objeto vacío: sin líneas', () => {
        expect(lineasDeResumen(null, carga())).toEqual([]);
        expect(lineasDeResumen(undefined, carga())).toEqual([]);
        expect(lineasDeResumen({ tipo: 'TIPO_DEL_FUTURO', x: 1 } as unknown as ResumenCategoria, carga())).toEqual([]);
        expect(lineasDeResumen({} as unknown as ResumenCategoria, carga())).toEqual([]);
    });
    it('números que faltan, NaN o negativos: nunca NaN ni undefined en pantalla', () => {
        const rotos = { tipo: 'PAGOS', casosConPagos: undefined, yaCargados: NaN, negativos: -3, facturasMarcadas: null, claves: undefined } as unknown as ResumenCategoria;
        expect(textos(rotos)).toEqual([]);
        const deudores = { tipo: 'DEUDORES', casosNuevos: undefined } as unknown as ResumenCategoria;
        const t = textos(deudores, carga({ ok: 0 })).join(' ');
        expect(BASURA.test(t)).toBe(false);
        expect(t).toBe('0 casos nuevos');
    });
});
