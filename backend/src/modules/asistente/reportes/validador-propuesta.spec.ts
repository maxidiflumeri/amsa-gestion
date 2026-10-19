import * as fs from 'fs';
import * as path from 'path';
import { CatalogoService } from '../../reportes/catalogo/catalogo.service';
import { perfilarArchivo } from '../adjuntos/perfil-ejemplo';
import { ContextoValidacion, reglasDelAlta, validarPropuesta } from './validador-propuesta';
import { CAPACIDADES_TODAS, EntradaProbar, Vocabulario } from './tipos-reportes';

const EMPRESAS = ['TOYOTA', 'TOYOTA PLAN DE AHORRO', 'TELECOM', 'AYSA'].map((nombre, i) => ({ id: i + 1, nombre, casos: 100 }));
const VOCAB: Record<string, Vocabulario> = {
    'empresa.nombre': { valores: EMPRESAS.map((e) => e.nombre), cerrado: true },
    'contactos.tipo': { valores: ['telefono', 'email', 'direccion'], cerrado: true },
    'promesas.estado': { valores: ['VIGENTE', 'CUMPLIDA', 'INCUMPLIDA', 'ANULADA'], cerrado: true },
    'estadoSituacion.clave': { valores: ['SIT-020', 'SIT-041', 'SIT-050'], cerrado: true },
};
const dir = path.join(__dirname, '..', '__fixtures__', 'reportes');
const perfilF01 = perfilarArchivo(fs.readFileSync(path.join(dir, 'ejemplo_cartera_toyota.xlsx')), 'ejemplo_cartera_toyota.xlsx');

let catalogo: ContextoValidacion['catalogo'];
beforeAll(async () => {
    catalogo = await new CatalogoService(null as never).getCatalogo('deudor', 3);
});

function ctx(extra: Partial<ContextoValidacion> = {}): ContextoValidacion {
    return {
        catalogo,
        vocabulario: (p) => VOCAB[p] ?? null,
        empresas: EMPRESAS,
        clavesAdicionales: ['MODELO', 'PATENTE'],
        capacidades: CAPACIDADES_TODAS,
        formatosTelefonoIds: new Set([1, 2]),
        ...extra,
    };
}

/** La propuesta de la maqueta: 9 columnas, TOYOTA, más de 90 días de mora, Excel. */
function maqueta(): EntradaProbar {
    const col = (label: string, path: string, extra: Record<string, unknown> = {}) => ({ label, path, ...extra });
    return {
        nombre: 'Cartera Toyota +90',
        empresa: 'TOYOTA',
        formatoSalida: 'xlsx',
        opciones: {},
        definicion: {
            columnas: [
                col('DNI', 'documento'),
                col('Cliente', 'nombre'),
                col('Nro Cliente', 'nroCliente'),
                col('Saldo', 'saldo', { tipo: 'numero', decimales: 2, separadorDecimal: ',', separadorMiles: '.' }),
                col('Vencimiento', 'fechaVencimiento', { tipo: 'fecha', formato: 'DD/MM/YYYY' }),
                col('Días de mora', 'fechaVencimiento', { tipo: 'dias' }),
                col('Teléfono', 'contactos[tipo=telefono][0].valor', { tipo: 'telefono' }),
                col('Email', 'contactos[tipo=email][0].valor'),
                col('Situación', 'estadoSituacion.descripcion'),
            ],
            filtros: [
                { path: 'empresa.nombre', operador: 'eq', valor: 'TOYOTA' },
                { path: 'fechaVencimiento', operador: 'lte', valor: 'hoy-90' },
            ],
            ordenamientos: [],
            cardinalidadDefault: 'concatenar',
        },
        mapeo: [
            { columnaEjemplo: 'DNI', label: 'DNI', estado: 'exacta', nota: '' },
            { columnaEjemplo: 'Cliente', label: 'Cliente', estado: 'aproximada', nota: 'Solo el nombre: el ejemplo trae apellido y nombre juntos.' },
            { columnaEjemplo: 'Nro Cliente', label: 'Nro Cliente', estado: 'exacta', nota: '' },
            { columnaEjemplo: 'Saldo', label: 'Saldo', estado: 'exacta', nota: '' },
            { columnaEjemplo: 'Vencimiento', label: 'Vencimiento', estado: 'exacta', nota: '' },
            { columnaEjemplo: 'Días de mora', label: 'Días de mora', estado: 'exacta', nota: '' },
            { columnaEjemplo: 'Teléfono', label: 'Teléfono', estado: 'aproximada', nota: 'Es el primero cargado, no el de prioridad 1.' },
            { columnaEjemplo: 'Email', label: 'Email', estado: 'exacta', nota: '' },
            { columnaEjemplo: 'Situación', label: 'Situación', estado: 'exacta', nota: '' },
        ],
    };
}

const conEjemplo = () => ctx({ ejemploPrincipal: { perfil: perfilF01, hoja: 0 } });

function errores(e: EntradaProbar, c: ContextoValidacion = conEjemplo()): string[] {
    return validarPropuesta(e, c).errores;
}

describe('validador de propuestas', () => {
    it('la propuesta de la maqueta pasa y queda normalizada', () => {
        const r = validarPropuesta(maqueta(), conEjemplo());
        expect(r.errores).toEqual([]);
        const n = r.normalizada!;
        expect(n.empresaId).toBe(1);
        expect(n.opcionesFormato).toEqual({ xlsx: {} });
        expect(n.definicion.columnas).toHaveLength(9);
        expect(n.definicion.columnas.every((c) => typeof c.id === 'string' && (c.id as string).length > 10)).toBe(true);
        expect(n.definicion.columnas[3]).toMatchObject({ tipo: 'numero', decimales: 2 });
        expect(n.definicion.filtros[1]).toMatchObject({ operador: 'lte', valor: 'hoy-90' });
        // TOYOTA tiene otra empresa que empieza igual (TOYOTA PLAN DE AHORRO): el mensaje de la tarjeta tiene que nombrarla.
        expect(r.avisos).toHaveLength(1);
        expect(r.avisos[0]).toContain('Filtra solo por TOYOTA; hay otras empresas que empiezan igual (TOYOTA PLAN DE AHORRO)');
    });

    it('un campo de fecha sin tipo se declara fecha (si no, sale un Date crudo)', () => {
        const e = maqueta();
        delete (e.definicion.columnas[4] as { tipo?: string }).tipo;
        delete (e.definicion.columnas[4] as { formato?: string }).formato;
        const n = validarPropuesta(e, conEjemplo()).normalizada!;
        expect(n.definicion.columnas[4]).toMatchObject({ tipo: 'fecha', formato: 'DD/MM/YYYY' });
    });

    describe('columnas', () => {
        it('regla 1: sin columnas', () => {
            const e = maqueta();
            e.definicion.columnas = [];
            expect(errores(e)).toEqual(['La definición no tiene columnas: mandá la plantilla completa.']);
        });

        it('regla 2: label repetido (sin mayúsculas ni espacios de los costados)', () => {
            const e = maqueta();
            e.definicion.columnas[7].label = ' teléfono ';
            expect(errores(e).join('\n')).toContain('Label repetido «Teléfono»: dos columnas se pisarían.');
        });

        it('regla 4: un campo que no existe dice cuáles hay', () => {
            const e = maqueta();
            e.definicion.columnas[8].path = 'estadoSituacion.codigo';
            expect(errores(e).join('\n')).toMatch(/«estadoSituacion.codigo»: no existe «codigo» dentro de estadoSituacion\. Campos: clave, descripcion\./);
        });

        it('regla 4: no se aceptan campos que el catálogo oculta, aunque el motor los resuelva', () => {
            const e = maqueta();
            e.definicion.columnas[8].path = 'empresa.remesa.nombre';
            expect(errores(e).join('\n')).toMatch(/no existe «remesa» dentro de empresa/);
        });

        it('los campos sensibles no se pueden pedir', () => {
            for (const p of ['comentarios.usuario.agenteTelefonia.sipPasswordEnc', 'remesa.usuarioCreador.googleId', 'remesa.usuarioCreador.dni']) {
                const e = maqueta();
                e.definicion.columnas[8].path = p;
                expect(errores(e)).not.toEqual([]);
            }
        });

        it('regla 5: [0] en una relación de uno', () => {
            const e = maqueta();
            e.definicion.columnas[8].path = 'empresa[0].nombre';
            expect(errores(e).join('\n')).toContain('«empresa[0].nombre»: [0] solo va en una rama de muchos; empresa es de uno.');
        });

        it('regla 5: sum sobre algo que no es un número, y first sin campo', () => {
            const e = maqueta();
            e.definicion.columnas[8].path = 'contactos[sum].valor';
            expect(errores(e).join('\n')).toMatch(/\[sum\] solo se puede sobre números/);
            e.definicion.columnas[8].path = 'pagos[last]';
            expect(errores(e).join('\n')).toMatch(/después de \[last\] tiene que ir un campo/);
            e.definicion.columnas[8].path = 'pagos[count].importe';
            expect(errores(e).join('\n')).toMatch(/\[count\] va al final/);
            e.definicion.columnas[8].path = 'contactos[tipo=telefono][10].valor';
            expect(errores(e).join('\n')).toMatch(/índice \[10\]/);
        });

        it('regla 5: pagos[last].importe, pagos[sum].importe y pagos[count] valen', () => {
            const e = maqueta();
            e.definicion.columnas[8] = { label: 'Último pago', path: 'pagos[last].importe', tipo: 'numero', decimales: 2 };
            e.mapeo[8].label = 'Último pago';
            e.definicion.columnas.push({ label: 'Total pagado', path: 'pagos[sum].importe', tipo: 'numero' });
            e.definicion.columnas.push({ label: 'Cantidad de pagos', path: 'pagos[count]' });
            e.mapeo.push({ columnaEjemplo: null, label: 'Total pagado', estado: 'agregada', nota: '' }, { columnaEjemplo: null, label: 'Cantidad de pagos', estado: 'agregada', nota: '' });
            expect(errores(e)).toEqual([]);
        });

        it('regla 6: un valor de filtro dentro del path que no existe lista los valores', () => {
            const e = maqueta();
            e.definicion.columnas[6].path = 'contactos[tipo=celular][0].valor';
            expect(errores(e).join('\n')).toContain('«contactos[tipo=celular][0].valor»: «celular» no es un valor de contactos.tipo. Valores: telefono, email, direccion.');
        });

        it('regla 7: termina en una relación', () => {
            const e = maqueta();
            e.definicion.columnas[8].path = 'remesa';
            expect(errores(e).join('\n')).toMatch(/«remesa» termina en una relación; elegí un campo adentro \(remesa\./);
        });

        it('regla 8: datos adicionales necesitan empresa y clave', () => {
            const e = maqueta();
            e.definicion.columnas[8] = { label: 'Patente', path: 'camposAdicionales.PATENTE' };
            e.mapeo[8].label = 'Patente';
            expect(errores(e)).toEqual([]);
            e.definicion.columnas[8].path = 'camposAdicionales.DIAS';
            expect(errores(e).join('\n')).toMatch(/TOYOTA no tiene esa clave\. Claves: MODELO, PATENTE\./);
            e.empresa = null;
            expect(errores(e).join('\n')).toMatch(/no tiene empresa asociada/);
        });

        it('regla 9: tipos', () => {
            const e = maqueta();
            e.definicion.columnas[0].tipo = 'numero';
            expect(errores(e).join('\n')).toMatch(/el tipo numero necesita un campo numérico/);
            e.definicion.columnas[0].tipo = undefined;
            e.definicion.columnas[5].path = 'saldo';
            expect(errores(e).join('\n')).toMatch(/Columna «Días de mora»: el tipo dias necesita un campo de fecha\./);
            e.definicion.columnas[5].path = 'fechaVencimiento';
            e.definicion.columnas[4].formato = 'dd/mm/aaaa';
            expect(errores(e).join('\n')).toMatch(/el formato de fecha «dd\/mm\/aaaa» no vale/);
            e.definicion.columnas[4].formato = 'DD/MM/YYYY';
            e.definicion.columnas[3].decimales = 7;
            expect(errores(e).join('\n')).toMatch(/decimales va de 0 a 4/);
            e.definicion.columnas[3].decimales = 2;
            e.definicion.columnas[3].separadorMiles = ',';
            expect(errores(e).join('\n')).toMatch(/no pueden ser el mismo/);
            e.definicion.columnas[3].separadorMiles = '.';
            e.definicion.columnas[6].formatoTelefonoId = 99;
            expect(errores(e).join('\n')).toMatch(/formato de teléfono 99 no existe/);
        });

        it('regla 9: decimales y separadores sobre una columna que no es numero', () => {
            const e = maqueta();
            e.definicion.columnas[0].decimales = 2;
            expect(errores(e).join('\n')).toMatch(/solo van con tipo numero/);
        });

        it('regla 9: una columna fija no lleva tipo y el valor fijo es corto', () => {
            const e = maqueta();
            e.definicion.columnas[8] = { label: 'Situación', path: '', valorFijo: 'x'.repeat(101) };
            e.mapeo[8].estado = 'sin_campo';
            e.mapeo[8].nota = 'No hay.';
            expect(errores(e).join('\n')).toMatch(/valor fijo es demasiado largo/);
        });

        it('E2 y E3 apagadas: error claro y no se muestra', () => {
            const sin = ctx({ ejemploPrincipal: { perfil: perfilF01, hoja: 0 }, capacidades: { E1: false, E2: false, E3: false, E4: false } });
            const r = errores(maqueta(), sin).join('\n');
            expect(r).toMatch(/el tipo dias todavía no está disponible/);
            expect(r).toMatch(/decimales y separadores todavía no están disponibles/);
        });
    });

    describe('regla 10: expandir', () => {
        it('en ramas distintas es error; en una sola, aviso', () => {
            const e = maqueta();
            e.definicion.columnas[0] = { label: 'DNI', path: 'documento' };
            e.definicion.columnas[1] = { label: 'Cliente', path: 'pagos.importe', cardinalidad: 'expandir' };
            e.definicion.columnas[2] = { label: 'Nro Cliente', path: 'promesas.monto', cardinalidad: 'expandir' };
            expect(errores(e).join('\n')).toMatch(/expandir sobre ramas distintas \(pagos, promesas\)/);
            e.definicion.columnas[2] = { label: 'Nro Cliente', path: 'nroCliente' };
            const r = validarPropuesta(e, conEjemplo());
            expect(r.errores).toEqual([]);
            expect(r.avisos.join('\n')).toMatch(/una fila por cada elemento de pagos/);
        });
    });

    describe('filtros', () => {
        const con = (f: Record<string, unknown>) => {
            const e = maqueta();
            e.definicion.filtros = [e.definicion.filtros[0], f as never];
            return e;
        };

        it('regla 11: un operador que no vale para el tipo (nunca llega al motor)', () => {
            expect(errores(con({ path: 'fechaVencimiento', operador: 'gt', valor: '2026-01-01' })).join('\n')).toContain('Filtro «fechaVencimiento»: gt no vale para fechas; usá gte, lte, between.');
            expect(errores(con({ path: 'saldo', operador: 'mayorQue', valor: 10 })).join('\n')).toMatch(/mayorQue no vale para números/);
            expect(errores(con({ path: 'documento', operador: 'gt', valor: '1' })).join('\n')).toMatch(/no vale para texto/);
        });

        it('regla 12: número, fecha y rango', () => {
            expect(errores(con({ path: 'saldo', operador: 'gt', valor: 'mucho' })).join('\n')).toMatch(/«mucho» no es un número/);
            expect(errores(con({ path: 'fechaVencimiento', operador: 'lte', valor: '31/07/2026' })).join('\n')).toContain('«31/07/2026» no es una fecha válida; usá AAAA-MM-DD');
            expect(errores(con({ path: 'fechaVencimiento', operador: 'lte', valor: '2026-02-31' })).join('\n')).toMatch(/no es una fecha válida/);
            expect(errores(con({ path: 'fechaVencimiento', operador: 'between', valor: ['2026-01-01'] })).join('\n')).toMatch(/necesita dos valores/);
            expect(errores(con({ path: 'documento', operador: 'in', valor: [] })).join('\n')).toMatch(/lista con al menos un valor/);
            expect(errores(con({ path: 'saldo', operador: 'gt' })).join('\n')).toMatch(/falta el valor/);
        });

        it('E1: hoy-90 sin E1 es error (quedaría en 1990); con E1, y dentro de un between, pasa', () => {
            const sin = ctx({ ejemploPrincipal: { perfil: perfilF01, hoja: 0 }, capacidades: { ...CAPACIDADES_TODAS, E1: false } });
            expect(errores(maqueta(), sin).join('\n')).toMatch(/«hoy-90» no vale todavía/);
            expect(errores(con({ path: 'fechaVencimiento', operador: 'between', valor: ['hoy-7', 'hoy'] }))).toEqual([]);
            expect(errores(con({ path: 'fechaVencimiento', operador: 'lte', valor: 'hoy-4000' })).join('\n')).toMatch(/no es una fecha válida/);
        });

        it('regla 12/13: valores de vocabulario exactos; las empresas dicen cuáles hay', () => {
            const e = maqueta();
            e.definicion.filtros[0].valor = 'Toyota';
            expect(errores(e).join('\n')).toContain('«Toyota» no es una empresa. Nombres que la contienen: TOYOTA, TOYOTA PLAN DE AHORRO.');
            expect(errores(con({ path: 'promesas.estado', operador: 'eq', valor: 'vigente' })).join('\n')).toMatch(/«vigente» no es un valor de promesas.estado\. Valores: VIGENTE/);
            expect(errores(con({ path: 'promesas.estado', operador: 'eq', valor: 'VIGENTE' }))).toEqual([]);
            expect(errores(con({ path: 'estadoSituacion.clave', operador: 'in', valor: ['SIT-050', 'SIT-041'] }))).toEqual([]);
            expect(errores(con({ path: 'estadoSituacion.clave', operador: 'in', valor: ['SIT-050', 'SIT-999'] })).join('\n')).toMatch(/«SIT-999»/);
        });

        it('regla 14: variable sin labelVariable es error; sin obligatorio, aviso', () => {
            expect(errores(con({ path: 'fechaVencimiento', operador: 'between', variable: true })).join('\n')).toMatch(/necesita labelVariable/);
            const r = validarPropuesta(con({ path: 'fechaVencimiento', operador: 'between', variable: true, labelVariable: 'Vencimiento' }), conEjemplo());
            expect(r.errores).toEqual([]);
            expect(r.avisos.join('\n')).toMatch(/variable y no obligatorio/);
            const ok = validarPropuesta(con({ path: 'fechaVencimiento', operador: 'between', variable: true, labelVariable: 'Vencimiento', obligatorio: true }), conEjemplo());
            expect(ok.avisos.join('\n')).not.toMatch(/no obligatorio/);
        });

        it('regla 15: comparar datos adicionales con > avisa que se comparan como texto', () => {
            const e = maqueta();
            e.definicion.filtros = [{ path: 'camposAdicionales.MODELO', operador: 'gt', valor: '9' }, e.definicion.filtros[0]];
            expect(validarPropuesta(e, conEjemplo()).avisos.join('\n')).toMatch(/se comparan como texto/);
        });

        it('el filtro por cantidad: contactos[tipo=telefono][count] eq 0', () => {
            expect(errores(con({ path: 'contactos[tipo=telefono][count]', operador: 'eq', valor: 0 }))).toEqual([]);
            expect(errores(con({ path: 'contactos[tipo=telefono][count]', operador: 'contains', valor: '0' })).join('\n')).toMatch(/no vale para cantidades/);
        });

        it('operador isNull no lleva valor', () => {
            const r = validarPropuesta(con({ path: 'contactos[tipo=email][0].valor', operador: 'isNull', valor: 'x' }), conEjemplo());
            expect(r.errores).toEqual([]);
            expect(r.normalizada!.definicion.filtros[1]).not.toHaveProperty('valor');
        });
    });

    describe('ordenamientos, totales', () => {
        it('regla 16: no se ordena por una rama de muchos', () => {
            const e = maqueta();
            e.definicion.ordenamientos = [{ path: 'pagos.importe', direccion: 'asc' }];
            expect(errores(e).join('\n')).toMatch(/no por una rama de muchos/);
            e.definicion.ordenamientos = [{ path: 'saldo', direccion: 'desc' }, { path: 'empresa.nombre', direccion: 'asc' }];
            expect(errores(e)).toEqual([]);
        });

        it('un total sobre una columna numero con 0 decimales y punto de miles se lee mal: error', () => {
            const e = maqueta();
            e.definicion.columnas[3] = { label: 'Saldo', path: 'saldo', tipo: 'numero', decimales: 0, separadorDecimal: ',', separadorMiles: '.' };
            e.definicion.totales = [{ path: 'saldo', funcion: 'sum' }];
            const msg = errores(e).join('\n');
            expect(msg).toMatch(/el total \(sum\) se calcula sobre el texto ya formateado/);
            expect(msg).toMatch(/decimales de 1 a 4 o separadorMiles vacío/);
            e.definicion.columnas[3].decimales = 2;
            expect(errores(e)).toEqual([]);
            e.definicion.columnas[3].decimales = 0;
            e.definicion.columnas[3].separadorMiles = '';
            expect(errores(e)).toEqual([]);
        });

        it('un total sobre un path que no es una columna es error', () => {
            const e = maqueta();
            e.definicion.totales = [{ path: 'montoTotal', funcion: 'sum' }];
            expect(errores(e).join('\n')).toMatch(/tiene que ser el path de una de las columnas/);
        });
    });

    describe('regla 18: formato y opciones', () => {
        it('opciones que no existen en el formato', () => {
            const e = maqueta();
            e.opciones = { bom: false };
            expect(errores(e).join('\n')).toMatch(/La opción «bom» no existe en xlsx/);
        });

        it('csv con separador, sin BOM y latin1 pasa; separador largo no', () => {
            const e = maqueta();
            e.formatoSalida = 'csv';
            e.opciones = { separador: ';', bom: false, encoding: 'latin1', lineEnding: '\r\n' };
            const r = validarPropuesta(e, conEjemplo());
            expect(r.errores).toEqual([]);
            expect(r.normalizada!.opcionesFormato).toEqual({ csv: { separador: ';', bom: false, encoding: 'latin1', lineEnding: '\r\n' } });
            e.opciones = { separador: ';;;;' };
            expect(errores(e).join('\n')).toMatch(/1 a 3 caracteres/);
        });

        it('ancho fijo: cantidad de anchos, alineación y relleno', () => {
            const e = maqueta();
            e.formatoSalida = 'txt';
            e.opciones = { anchoFijo: [8, 20, 12, 12, 8, 5, 10, 30, 12] };
            expect(errores(e)).toEqual([]);
            e.opciones = { anchoFijo: [8, 20] };
            expect(errores(e).join('\n')).toContain('anchoFijo tiene 2 anchos y hay 9 columnas.');
            e.opciones = { anchoFijo: [8, 20, 12, 12, 8, 5, 10, 30, 12], separador: ';' };
            expect(errores(e).join('\n')).toMatch(/separador y anchoFijo no van juntos/);
            e.opciones = { anchoFijo: [8, 20, 12, 12, 8, 5, 10, 30, 12], alineacion: ['derecha'] };
            expect(errores(e).join('\n')).toMatch(/alineacion tiene 1 valores y hay 9 columnas/);
            const sin = ctx({ ejemploPrincipal: { perfil: perfilF01, hoja: 0 }, capacidades: { ...CAPACIDADES_TODAS, E4: false } });
            e.opciones = { anchoFijo: [8, 20, 12, 12, 8, 5, 10, 30, 12], relleno: new Array(9).fill('0') };
            expect(errores(e, sin).join('\n')).toMatch(/«relleno» todavía no está disponible/);
        });

        it('PDF con más de 8 columnas avisa', () => {
            const e = maqueta();
            e.formatoSalida = 'pdf';
            expect(validarPropuesta(e, conEjemplo()).avisos.join('\n')).toMatch(/más de 8/);
        });
    });

    describe('mapeo (reglas 19 a 21)', () => {
        it('faltan columnas del ejemplo', () => {
            const e = maqueta();
            e.mapeo = e.mapeo.filter((m) => m.label !== 'Email' && m.label !== 'Situación');
            e.definicion.columnas = e.definicion.columnas.filter((c) => c.label !== 'Email' && c.label !== 'Situación');
            expect(errores(e).join('\n')).toContain('Faltan en el mapeo columnas del ejemplo: Email, Situación.');
        });

        it('una columna de la plantilla sin mapeo, y un mapeo de una columna que no existe', () => {
            const e = maqueta();
            e.mapeo.pop();
            expect(errores(e).join('\n')).toMatch(/Falta en el mapeo la columna «Situación»/);
            const f = maqueta();
            f.mapeo[0].label = 'Inexistente';
            expect(errores(f).join('\n')).toMatch(/menciona la columna «Inexistente»/);
        });

        it('sin_campo exige columna fija; exacta no puede ser fija; aproximada pide nota', () => {
            const e = maqueta();
            e.mapeo[0].estado = 'sin_campo';
            expect(errores(e).join('\n')).toMatch(/sin_campo es una columna fija/);
            const f = maqueta();
            f.definicion.columnas[0] = { label: 'DNI', path: '' };
            expect(errores(f).join('\n')).toMatch(/dice exacta pero la columna es fija/);
            const g = maqueta();
            g.mapeo[1].nota = '';
            expect(errores(g).join('\n')).toMatch(/explicá en nota en qué difiere/);
        });

        it('una columna agregada a pedido tiene columnaEjemplo null', () => {
            const e = maqueta();
            e.definicion.columnas.push({ label: 'Tel 2', path: 'contactos[tipo=telefono][1].valor', tipo: 'telefono' });
            e.mapeo.push({ columnaEjemplo: null, label: 'Tel 2', estado: 'agregada', nota: '' });
            expect(errores(e)).toEqual([]);
            e.mapeo[9].columnaEjemplo = 'Teléfono';
            expect(errores(e).join('\n')).toMatch(/agregada es para columnas que no están en el ejemplo/);
        });

        it('una columna del ejemplo que no existe', () => {
            const e = maqueta();
            e.mapeo[0].columnaEjemplo = 'Cédula';
            expect(errores(e).join('\n')).toMatch(/«Cédula» no es una columna del ejemplo/);
        });

        it('regla 20: sin ejemplo, todo agregada', () => {
            expect(errores(maqueta(), ctx()).join('\n')).toMatch(/no hay archivo de ejemplo en la conversación/);
            const e = maqueta();
            e.mapeo = e.mapeo.map((m) => ({ ...m, estado: 'agregada' as const, columnaEjemplo: null }));
            expect(errores(e, ctx())).toEqual([]);
        });

        it('regla 21: columnas en otro orden que el ejemplo avisa', () => {
            const e = maqueta();
            [e.definicion.columnas[0], e.definicion.columnas[1]] = [e.definicion.columnas[1], e.definicion.columnas[0]];
            expect(validarPropuesta(e, conEjemplo()).avisos.join('\n')).toMatch(/mismo orden que el ejemplo/);
        });
    });

    describe('reglas 22 a 24', () => {
        it('empresa inexistente, y asociada sin filtro de empresa', () => {
            const e = maqueta();
            e.empresa = 'Toyotaa';
            expect(errores(e).join('\n')).toMatch(/La empresa asociada «Toyotaa» no existe/);
            const f = maqueta();
            f.definicion.filtros = [f.definicion.filtros[1]];
            expect(validarPropuesta(f, conEjemplo()).avisos.join('\n')).toContain('La plantilla se asocia a TOYOTA pero no filtra por empresa: va a traer todas las carteras.');
        });

        it('nombre y descripción; nombre repetido avisa; sin filtros avisa', () => {
            const e = maqueta();
            e.nombre = 'ab';
            expect(errores(e).join('\n')).toMatch(/de 3 a 120 caracteres/);
            const f = maqueta();
            const r = validarPropuesta(f, conEjemplo() && ctx({ ejemploPrincipal: { perfil: perfilF01, hoja: 0 }, nombresPlantillas: new Set(['cartera toyota +90']) }));
            expect(r.avisos.join('\n')).toMatch(/Ya existe una plantilla activa/);
            f.definicion.filtros = [];
            f.empresa = null;
            expect(validarPropuesta(f, conEjemplo()).avisos).toContain('Sin filtros trae la cartera entera.');
        });
    });

    it('la red del motor: lo que validarDefinicion rechaza y las reglas propias no ven, también es error', () => {
        // Un total sobre "camposAdicionales" no es algo que las reglas propias revisen; el motor sí revisa los paths.
        const e = maqueta();
        e.definicion.agrupaciones = [{ path: 'documento' }];
        expect(validarPropuesta(e, conEjemplo()).errores).toEqual([]);
    });

    describe('empresa exacta, codificación del ejemplo y referenciaClave (ajustes del 19/10)', () => {
        const empresas = ['TOYOTA', 'TOYOTA PLAN DE AHORRO', 'TOYOTA 0800', 'TELECOM'].map((nombre, id) => ({ id, nombre, casos: 1 }));
        const ctxE = (extra: Partial<ContextoValidacion> = {}) => ctx({ empresas, vocabulario: (p) => (p === 'empresa.nombre' ? { valores: empresas.map((e) => e.nombre), cerrado: true } : null), ...extra });

        it('filtrar por una empresa exacta que tiene otras con el mismo prefijo avisa que el mensaje las nombre', () => {
            const r = validarPropuesta(maqueta(), { ...conEjemplo(), ...ctxE({ ejemploPrincipal: { perfil: perfilF01, hoja: 0 } }) });
            expect(r.errores).toEqual([]);
            expect(r.avisos.join('\n')).toContain('Filtra solo por TOYOTA; hay otras empresas que empiezan igual (TOYOTA PLAN DE AHORRO, TOYOTA 0800): el mensaje de la tarjeta tiene que nombrarlas.');
        });

        it('si ya filtra por todas, o la empresa no tiene prefijos, no avisa', () => {
            const e = maqueta();
            e.definicion.filtros[0] = { path: 'empresa.nombre', operador: 'in', valor: ['TOYOTA', 'TOYOTA PLAN DE AHORRO', 'TOYOTA 0800'] };
            const c = ctxE({ ejemploPrincipal: { perfil: perfilF01, hoja: 0 } });
            expect(validarPropuesta(e, c).avisos.join('\n')).not.toContain('empiezan igual');
            e.definicion.filtros[0] = { path: 'empresa.nombre', operador: 'eq', valor: 'TELECOM' };
            e.empresa = 'TELECOM';
            expect(validarPropuesta(e, c).avisos.join('\n')).not.toContain('empiezan igual');
        });

        const csvLatin1 = perfilarArchivo(Buffer.from('Número;Importe\n30111222;10,50\n27888999;20,00\n', 'latin1'), 'e.csv');
        const propuestaCsv = (opciones: Record<string, unknown>): EntradaProbar => ({
            nombre: 'Pagos csv',
            empresa: null,
            formatoSalida: 'csv',
            opciones,
            definicion: { columnas: [{ label: 'Número', path: 'documento' }, { label: 'Importe', path: 'saldo', tipo: 'numero', decimales: 2 }], filtros: [{ path: 'saldo', operador: 'gt', valor: 0 }], ordenamientos: [], cardinalidadDefault: 'concatenar' },
            mapeo: [
                { columnaEjemplo: 'Número', label: 'Número', estado: 'exacta', nota: '' },
                { columnaEjemplo: 'Importe', label: 'Importe', estado: 'aproximada', nota: 'Es el saldo.' },
            ],
        });

        it('sin encoding se usa el del ejemplo (latin1); con el mismo, igual; el de un ejemplo utf8 también', () => {
            const c = ctx({ ejemploPrincipal: { perfil: csvLatin1, hoja: 0 } });
            expect(csvLatin1.texto?.encoding).toBe('latin1');
            const r = validarPropuesta(propuestaCsv({ separador: ';' }), c);
            expect(r.errores).toEqual([]);
            expect(r.normalizada!.opcionesFormato.csv).toEqual({ separador: ';', encoding: 'latin1' });
            expect(validarPropuesta(propuestaCsv({ encoding: 'latin1' }), c).avisos.join('\n')).not.toContain('ATENCIÓN');
            const utf8 = perfilarArchivo(Buffer.from('Número;Importe\n30111222;10,50\n', 'utf8'), 'u.csv');
            expect(validarPropuesta(propuestaCsv({}), ctx({ ejemploPrincipal: { perfil: utf8, hoja: 0 } })).normalizada!.opcionesFormato.csv).toEqual({ encoding: 'utf8' });
        });

        it('con otra distinta de la del ejemplo: aviso fuerte', () => {
            const r = validarPropuesta(propuestaCsv({ encoding: 'utf8' }), ctx({ ejemploPrincipal: { perfil: csvLatin1, hoja: 0 } }));
            expect(r.errores).toEqual([]);
            expect(r.avisos.join('\n')).toContain('ATENCIÓN: el archivo de ejemplo está en latin1 y la plantilla sale en utf8.');
            expect(r.normalizada!.opcionesFormato.csv.encoding).toBe('utf8');
        });

        it('un ejemplo de Excel o un xlsx de salida no reciben encoding', () => {
            const r = validarPropuesta(maqueta(), conEjemplo());
            expect(r.normalizada!.opcionesFormato).toEqual({ xlsx: {} });
        });

        const ejPagos = perfilarArchivo(Buffer.from('Documento;Nro Operación\n30111222;OP-90001\n27888999;OP-90002\n'), 'p.csv');
        const conClave = (estado: 'exacta' | 'aproximada'): EntradaProbar => ({
            nombre: 'Pagos',
            empresa: null,
            formatoSalida: 'xlsx',
            opciones: {},
            definicion: { columnas: [{ label: 'Documento', path: 'documento' }, { label: 'Nro Operación', path: 'pagos.referenciaClave' }], filtros: [{ path: 'saldo', operador: 'gt', valor: 0 }], ordenamientos: [], cardinalidadDefault: 'concatenar' },
            mapeo: [
                { columnaEjemplo: 'Documento', label: 'Documento', estado: 'exacta', nota: '' },
                { columnaEjemplo: 'Nro Operación', label: 'Nro Operación', estado: estado, nota: estado === 'exacta' ? '' : 'Parecido.' },
            ],
        });

        it('referenciaClave contra valores con forma XX-99999: error si dice exacta, aviso si dice aproximada', () => {
            const c = ctx({ ejemploPrincipal: { perfil: ejPagos, hoja: 0 } });
            const e = validarPropuesta(conClave('exacta'), c);
            expect(e.errores.join('\n')).toContain('referenciaClave es el número de convenio de 8 dígitos');
            expect(e.errores.join('\n')).toContain('XX-99999');
            const a = validarPropuesta(conClave('aproximada'), c);
            expect(a.errores).toEqual([]);
            expect(a.avisos.join('\n')).toContain('pagos.idExterno');
        });

        it('con valores de 8 dígitos, referenciaClave pasa', () => {
            const ej = perfilarArchivo(Buffer.from('Documento;Clave\n30111222;12345678\n27888999;87654321\n'), 'p.csv');
            const e = conClave('exacta');
            e.mapeo[1].columnaEjemplo = 'Clave';
            e.definicion.columnas[1].label = 'Clave';
            e.mapeo[1].label = 'Clave';
            expect(validarPropuesta(e, ctx({ ejemploPrincipal: { perfil: ej, hoja: 0 } })).errores).toEqual([]);
        });
    });

    describe('las mismas reglas que el alta (DTO, validarDefinicion, validarOpcionesFormato)', () => {
        const ANCHOS = [8, 20, 12, 12, 8, 5, 10, 30, 12];
        const txt = (opciones: Record<string, unknown>): EntradaProbar => ({ ...maqueta(), formatoSalida: 'txt', opciones: { anchoFijo: ANCHOS, ...opciones } as never });
        const conCol = (i: number, extra: Record<string, unknown>): EntradaProbar => {
            const e = maqueta();
            Object.assign(e.definicion.columnas[i], extra);
            return e;
        };

        it('lo que no se puede guardar: relleno «0» sin alineación a la derecha', () => {
            const m = errores(txt({ relleno: ['0', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '] })).join('\n');
            expect(m).toMatch(/relleno con ceros solo se puede usar con alineación a la derecha/);
        });

        it('relleno «0» con derecha sí pasa', () => {
            const rellenos = ['0', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '];
            const alin = ['derecha', 'izquierda', 'izquierda', 'izquierda', 'izquierda', 'izquierda', 'izquierda', 'izquierda', 'izquierda'];
            expect(errores(txt({ relleno: rellenos, alineacion: alin }))).toEqual([]);
        });

        it('lo que no se puede guardar: separadorMiles « », separadorDecimal «;» y valorFijo numérico', () => {
            expect(errores(conCol(3, { separadorMiles: ' ' })).join('\n')).toMatch(/separadorMiles es «\.», «,» o vacío/);
            expect(errores(conCol(3, { separadorDecimal: ';' })).join('\n')).toMatch(/separadorDecimal es «,» o «\.»/);
            const e = maqueta();
            e.definicion.columnas[8] = { label: 'Situación', path: '', valorFijo: 123 as never };
            e.mapeo[8].estado = 'sin_campo';
            e.mapeo[8].nota = 'No hay.';
            expect(errores(e).join('\n')).toMatch(/valorFijo es un texto/);
        });

        it('lo que se guarda pero sale distinto: incluirHeader «no», bom «false», relleno «x», alineación «centro»', () => {
            const csv = (o: Record<string, unknown>): EntradaProbar => ({ ...maqueta(), formatoSalida: 'csv', opciones: o as never });
            expect(errores(csv({ incluirHeader: 'no' })).join('\n')).toMatch(/«incluirHeader» es true o false/);
            expect(errores(csv({ bom: 'false' })).join('\n')).toMatch(/«bom» es true o false/);
            expect(errores(txt({ relleno: ['x', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '] })).join('\n')).toMatch(/«relleno» es una lista con « » o «0»/);
            expect(errores(txt({ alineacion: ['centro', 'izquierda', 'izquierda', 'izquierda', 'izquierda', 'izquierda', 'izquierda', 'izquierda', 'izquierda'] })).join('\n')).toMatch(/«alineacion» es una lista con «izquierda» o «derecha»/);
        });

        it('lo que se guarda pero sale distinto: tipo «porcentaje», cardinalidad «todos», cardinalidadDefault «cualquiera»', () => {
            expect(errores(conCol(3, { tipo: 'porcentaje' })).join('\n')).toMatch(/el tipo «porcentaje» no existe/);
            expect(errores(conCol(3, { cardinalidad: 'todos' })).join('\n')).toMatch(/la cardinalidad «todos» no existe/);
            const e = maqueta();
            (e.definicion as { cardinalidadDefault: string }).cardinalidadDefault = 'cualquiera';
            expect(errores(e).join('\n')).toMatch(/cardinalidadDefault «cualquiera» no existe/);
        });

        it('los largos de anchoFijo, alineación y relleno tienen que coincidir con las columnas', () => {
            expect(errores(txt({ anchoFijo: [8, 20] })).join('\n')).toMatch(/anchoFijo tiene 2 anchos y hay 9 columnas/);
            expect(errores(txt({ alineacion: ['derecha'] })).join('\n')).toMatch(/alineacion tiene 1 valores y hay 9 columnas/);
            expect(errores(txt({ relleno: ['0'] })).join('\n')).toMatch(/relleno tiene 1 valores y hay 9 columnas/);
        });

        it('el DTO del alta es la última red: una plantilla que class-validator rechaza no sale', () => {
            const n = validarPropuesta(maqueta(), conEjemplo()).normalizada!;
            expect(reglasDelAlta(n)).toEqual([]);
            expect(reglasDelAlta({ ...n, formatoSalida: 'doc' as never }).join('\n')).toMatch(/La plantilla no se podría guardar \(formatoSalida/);
            const rota = { ...n, definicion: { ...n.definicion, columnas: [{ ...n.definicion.columnas[0], decimales: 9 }] } };
            expect(reglasDelAlta(rota).join('\n')).toMatch(/decimales/);
        });
    });

    it('la normalización completa tipoEscalar (y enumValues) de cada filtro: el editor decide el input por ahí', () => {
        const e = maqueta();
        e.definicion.filtros = [
            e.definicion.filtros[0],
            { path: 'fechaVencimiento', operador: 'between', variable: true, labelVariable: 'Vencimiento', obligatorio: true },
            { path: 'saldo', operador: 'gt', valor: 10 },
            { path: 'contactos[tipo=telefono][count]', operador: 'eq', valor: 0 },
            { path: 'remesa.categoria', operador: 'eq', valor: 'DEUDORES' },
        ];
        const r = validarPropuesta(e, conEjemplo());
        expect(r.errores).toEqual([]);
        const f = r.normalizada!.definicion.filtros;
        expect(f.map((x) => x.tipoEscalar)).toEqual(['texto', 'fecha', 'numero', 'numero', 'enum']);
        expect((f[4].enumValues as string[]).includes('DEUDORES')).toBe(true);
        expect(f[0]).not.toHaveProperty('enumValues');
    });
});
