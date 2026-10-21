// Asistente de IA, Fase B: el editor de reportes cuando abre una propuesta, y lo que sumó para editarla a mano
// (docs/asistente-reportes-spec.md §12, §16.1, §16.4, §16.5 y §20.2).
import React, { act, useState } from 'react';
import { Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import ReportesBuilder from '@fe/pages/reportes/ReportesBuilder';
import GroupingBuilder from '@fe/pages/reportes/components/GroupingBuilder/GroupingBuilder';
import PropertiesPanel from '@fe/pages/reportes/components/PropertiesPanel/PropertiesPanel';
import VariableInput from '@fe/pages/reportes/components/ExecutionForm/VariableInput';
import { acompanarColumnas } from '@fe/pages/reportes/utils/anchoFijo';
import { validatePlantilla } from '@fe/pages/reportes/utils/validatePlantilla';
import { describirFechaRelativa, parseFechaRelativa, resolverFechaRelativa } from '@fe/pages/reportes/utils/fechaRelativa';
import type { Columna, Filtro, NodoCatalogo, Plantilla, Total } from '@fe/types/reportes';
import { ServidorFalso, type Respuesta } from '../lib/servidor-falso';
import { boton, clic, dialogo, escribir, esperar, iniciarSesion, limpio, montar, pasar, type Montado } from '../lib/montar';

const navegador: { ir: NavigateFunction | null } = { ir: null };
function Ubicacion() {
    navegador.ir = useNavigate();
    const { pathname, search } = useLocation();
    return <span data-testid="ruta" data-search={search}>{pathname}</span>;
}
const ruta = () => document.querySelector('[data-testid="ruta"]')?.textContent ?? '';
const busqueda = () => document.querySelector('[data-testid="ruta"]')?.getAttribute('data-search') ?? '';
const irA = async (d: string) => { await act(async () => { navegador.ir!(d); }); };

const nodo = (path: string, label: string, tipoEscalar: NodoCatalogo['tipoEscalar'], extra: Partial<NodoCatalogo> = {}): NodoCatalogo =>
    ({ path, nombre: path.split('.').pop()!, label, tipo: 'escalar', tipoEscalar, ...extra });
const CATALOGO: NodoCatalogo[] = [
    nodo('documento', 'Documento', 'texto'),
    nodo('montoTotal', 'Monto total', 'numero'),
    nodo('fechaVencimiento', 'Vencimiento', 'fecha'),
    { path: 'empresa', nombre: 'empresa', label: 'Empresa', tipo: 'relacion-1-1', hijos: [nodo('empresa.nombre', 'Nombre', 'texto')] },
];

const col = (over: Partial<Columna>): Columna => ({ id: `c-${over.label}`, path: 'documento', label: 'x', tipo: 'texto', ...over });
const filtroFecha = (valor: unknown): Filtro => ({ id: 'f-1', path: 'fechaVencimiento', operador: 'lte', valor, variable: false, tipoEscalar: 'fecha' });

function plantillaAsistente(over: Partial<Plantilla> = {}) {
    return {
        nombre: 'Cartera Toyota +90', descripcion: 'Igual al ejemplo del cedente', raiz: 'deudor', empresaId: null, formatoSalida: 'txt',
        definicion: {
            columnas: [
                col({ label: 'DNI', path: 'documento' }),
                col({ label: 'Saldo', path: 'montoTotal', tipo: 'numero', decimales: 2, separadorDecimal: ',', separadorMiles: '.' }),
                col({ label: 'Días de mora', path: 'fechaVencimiento', tipo: 'dias' }),
                col({ label: 'Teléfono 2', path: 'contactos[tipo=telefono][1].valor', tipo: 'telefono' }),
            ],
            filtros: [{ id: 'f-empresa', path: 'empresa.nombre', operador: 'eq', valor: 'TOYOTA', variable: false, tipoEscalar: 'texto' }, filtroFecha('hoy-90')],
            ordenamientos: [], agrupaciones: [], totales: [], cardinalidadDefault: 'concatenar',
        },
        opcionesFormato: {
            txt: { anchoFijo: [11, 30, 12, 10], alineacion: ['izquierda', 'izquierda', 'derecha', 'izquierda'], relleno: [' ', ' ', '0', ' '], encoding: 'latin1', lineEnding: '\n', incluirHeader: false },
        },
        asistentePropuestaId: 31,
        ...over,
    };
}

interface Banco { srv: ServidorFalso; v: Montado; propuestas: number[]; plantillaDePropuesta: () => Respuesta; altas: Array<Record<string, any>>; parches: Array<Record<string, any>> }
let b: Banco | null = null;
afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

async function armar(rutaInicial: string, over: { plantilla?: () => Respuesta } = {}): Promise<Banco> {
    const srv = new ServidorFalso();
    await srv.levantar();
    iniciarSesion(['reportes.ver', 'reportes.crear', 'asistente.usar', 'asistente.reportes'], 3);
    const banco = { srv, propuestas: [], altas: [], parches: [] } as unknown as Banco;
    banco.plantillaDePropuesta = over.plantilla ?? (() => ({ body: plantillaAsistente() }));
    srv.en('GET', /^\/reportes\/catalogo$/, () => ({ body: CATALOGO }));
    srv.en('GET', /^\/empresas$/, () => ({ body: [{ id: 1, nombre: 'TOYOTA' }] }));
    srv.en('GET', /^\/import\/empresas$/, () => ({ body: [{ id: 1, nombre: 'TOYOTA' }] }));
    srv.en('GET', /^\/parametros$/, () => ({ body: [] }));
    srv.en('GET', /^\/reportes\/formatos-telefono$/, () => ({ body: [] }));
    srv.en('GET', /^\/asistente\/propuestas\/(\d+)\/plantilla$/, (m) => { banco.propuestas.push(Number(m[1])); return banco.plantillaDePropuesta(); });
    const guardadas: Record<number, any> = {
        5: { id: 5, nombre: 'Plantilla cinco', raiz: 'deudor', formatoSalida: 'xlsx', definicion: { columnas: [col({ label: 'DNI' })], filtros: [], ordenamientos: [], agrupaciones: [], totales: [], cardinalidadDefault: 'concatenar' } },
        7: { id: 7, nombre: 'Plantilla siete', raiz: 'deudor', formatoSalida: 'xlsx', definicion: { columnas: [col({ label: 'Saldo', path: 'montoTotal', tipo: 'numero' })], filtros: [], ordenamientos: [], agrupaciones: [], totales: [], cardinalidadDefault: 'concatenar' } },
    };
    srv.en('GET', /^\/reportes\/plantillas\/(\d+)$/, (m) => ({ body: guardadas[Number(m[1])] }));
    srv.en('PATCH', /^\/reportes\/plantillas\/(\d+)$/, (m, p) => { banco.parches.push({ id: Number(m[1]), ...JSON.parse(p.cuerpo.toString('utf8')) }); return { body: { id: Number(m[1]) } }; });
    srv.en('POST', /^\/reportes\/plantillas$/, (_m, p) => { banco.altas.push(JSON.parse(p.cuerpo.toString('utf8'))); return { status: 201, body: { id: 88 } }; });
    banco.v = await montar(
        <>
            <Ubicacion />
            <Routes>
                <Route path="/reportes/nuevo" element={<ReportesBuilder />} />
                <Route path="/reportes/:id/editar" element={<ReportesBuilder />} />
                <Route path="/reportes" element={<div data-testid="lista">LISTA</div>} />
            </Routes>
        </>,
        { ruta: rutaInicial },
    );
    return banco;
}

const campo = (etiqueta: RegExp): HTMLInputElement => {
    const l = Array.from(document.querySelectorAll('label')).find((x) => etiqueta.test(x.textContent ?? ''));
    const el = l ? document.getElementById(l.getAttribute('for') ?? '') : null;
    if (!el) throw new Error(`No hay un campo «${etiqueta}»`);
    return el as HTMLInputElement;
};
const pantalla = () => limpio(document.body.textContent ?? '');
const cargada = () => esperar(() => campo(/Nombre de la plantilla/).value !== '' || pantalla().includes('Nueva plantilla'), { que: 'el editor' });
const pestania = (nombre: string) => Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find((t) => limpio(t.textContent ?? '') === nombre) ?? null;
/** El combobox de un TextField select, a partir del texto de su etiqueta. */
function combo(etiqueta: RegExp, raiz: ParentNode = document): HTMLElement {
    const l = Array.from(raiz.querySelectorAll('label')).find((x) => etiqueta.test(x.textContent ?? ''));
    const c = l ? raiz.querySelector<HTMLElement>(`[role="combobox"][aria-labelledby~="${l.id}"]`) : null;
    if (!c) throw new Error(`No hay un select «${etiqueta}»`);
    return c;
}
async function elegir(etiqueta: RegExp, opcion: RegExp, raiz: ParentNode = document) {
    const c = combo(etiqueta, raiz);
    await act(async () => { c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
    const li = await esperar(() => Array.from(document.querySelectorAll('li[role="option"]')).find((o) => opcion.test(o.textContent ?? '')), { que: `la opción ${opcion}` });
    await clic(li, `la opción ${opcion}`);
    await esperar(() => !document.querySelector('li[role="option"]'), { que: 'el menú cerrado' });
}
const hoyMas = (dias: number) => {
    const d = new Date(); d.setDate(d.getDate() + dias);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

describe('?propuesta= en «Nueva plantilla»', () => {
    it('carga la plantilla de la propuesta con el aviso y como cambios sin guardar', async () => {
        b = await armar('/reportes/nuevo?propuesta=31');
        await esperar(() => campo(/Nombre de la plantilla/).value === 'Cartera Toyota +90', { que: 'la plantilla cargada' });
        expect(b.propuestas).toEqual([31]);
        const aviso = document.querySelector('[data-testid="aviso-asistente"]')!;
        expect(limpio(aviso.textContent ?? '')).toBe('Esta plantilla la armó amaIA y todavía no existe. Revisala y tocá Guardar.');
        expect(aviso.querySelectorAll('strong')).toHaveLength(2);
        expect(pantalla()).toContain('Nueva plantilla');
        // Sin guardar: el aviso del navegador al salir funciona, y Cancelar pregunta.
        const salir = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(salir);
        expect(salir.defaultPrevented).toBe(true);
        await clic(boton('Cancelar'), 'Cancelar');
        await esperar(() => dialogo(/Cambios sin guardar/), { que: 'la confirmación de salir' });
        // El parámetro ya cumplió: no queda en la URL (recargar no pisa lo que se edite).
        expect(busqueda()).toBe('');
        expect(ruta()).toBe('/reportes/nuevo');
    });

    it('avisa al panel que la propuesta se abrió recién cuando cargó; si se rechaza el reemplazo, no', async () => {
        const abiertas: unknown[] = [];
        const oyente = (e: Event) => abiertas.push((e as CustomEvent).detail);
        window.addEventListener('asistente:propuesta-abierta', oyente);
        try {
            b = await armar('/reportes/nuevo');
            await cargada();
            await escribir(campo(/Nombre de la plantilla/), 'Lo mío');
            await irA('/reportes/nuevo?propuesta=31');
            await esperar(() => dialogo(/Reemplazar lo que tenés armado/), { que: 'la confirmación' });
            await clic(boton('Seguir con lo mío'), 'Seguir con lo mío');
            await pasar(200);
            expect(abiertas).toEqual([]);
            await irA('/reportes/nuevo?propuesta=31');
            await esperar(() => dialogo(/Reemplazar lo que tenés armado/), { que: 'la confirmación otra vez' });
            await clic(boton('Reemplazar lo que tenés armado'), 'Reemplazar');
            await esperar(() => abiertas.length === 1, { que: 'el aviso' });
            expect(abiertas).toEqual([{ propuestaId: 31 }]);
        } finally {
            window.removeEventListener('asistente:propuesta-abierta', oyente);
        }
    });

    it('un editor limpio no pide confirmar; uno con cosas sin guardar sí, y «Seguir con lo mío» las conserva', async () => {
        b = await armar('/reportes/nuevo');
        await cargada();
        await escribir(campo(/Nombre de la plantilla/), 'Lo que estaba armando');
        await irA('/reportes/nuevo?propuesta=31');
        await esperar(() => dialogo(/Reemplazar lo que tenés armado/), { que: 'la confirmación' });
        expect(b.propuestas).toEqual([]);
        await clic(boton('Seguir con lo mío'), 'Seguir con lo mío');
        await esperar(() => busqueda() === '', { que: 'el parámetro descartado' });
        expect(campo(/Nombre de la plantilla/).value).toBe('Lo que estaba armando');
        expect(b.propuestas).toEqual([]);
        expect(document.querySelector('[data-testid="aviso-asistente"]')).toBeNull();

        await irA('/reportes/nuevo?propuesta=31');
        await esperar(() => dialogo(/Reemplazar lo que tenés armado/), { que: 'la confirmación otra vez' });
        await clic(boton('Reemplazar lo que tenés armado'), 'Reemplazar lo que tenés armado');
        await esperar(() => campo(/Nombre de la plantilla/).value === 'Cartera Toyota +90', { que: 'la propuesta cargada' });
        expect(b.propuestas).toEqual([31]);
        expect(document.querySelector('[data-testid="aviso-asistente"]')).not.toBeNull();
    });

    it('tocar «Abrir en el editor» estando ya en /reportes/nuevo (cambia solo la query) también carga: el efecto depende de la propuesta, no solo del id', async () => {
        b = await armar('/reportes/nuevo');
        await cargada();
        await irA('/reportes/nuevo?propuesta=31');
        await esperar(() => campo(/Nombre de la plantilla/).value === 'Cartera Toyota +90', { que: 'la propuesta cargada' });
        expect(b.propuestas).toEqual([31]);
    });

    it('una propuesta que no existe (404) avisa y deja el editor vacío', async () => {
        b = await armar('/reportes/nuevo?propuesta=99', { plantilla: () => ({ status: 404, body: { message: 'La propuesta no existe' } }) });
        await esperar(() => busqueda() === '', { que: 'el parámetro descartado' });
        await pasar(200);
        expect(campo(/Nombre de la plantilla/).value).toBe('');
        expect(document.querySelector('[data-testid="aviso-asistente"]')).toBeNull();
    });

    it('Guardar manda la plantilla con asistentePropuestaId y vuelve a la lista; avisa a la tarjeta del panel', async () => {
        b = await armar('/reportes/nuevo?propuesta=31');
        await esperar(() => campo(/Nombre de la plantilla/).value === 'Cartera Toyota +90', { que: 'la plantilla cargada' });
        const avisos: unknown[] = [];
        const oyente = (e: Event) => avisos.push((e as CustomEvent).detail);
        window.addEventListener('asistente:propuesta-guardada', oyente);
        await clic(boton('Guardar'), 'Guardar');
        await esperar(() => b!.altas.length === 1, { que: 'el alta' });
        window.removeEventListener('asistente:propuesta-guardada', oyente);
        const alta = b.altas[0];
        expect(alta.asistentePropuestaId).toBe(31);
        expect(alta.nombre).toBe('Cartera Toyota +90');
        expect(alta.definicion.columnas.map((c: Columna) => c.tipo)).toEqual(['texto', 'numero', 'dias', 'telefono']);
        expect(alta.definicion.columnas[1]).toMatchObject({ decimales: 2, separadorDecimal: ',', separadorMiles: '.' });
        expect(alta.definicion.filtros[1]).toMatchObject({ operador: 'lte', valor: 'hoy-90' });
        expect(alta.opcionesFormato.txt.anchoFijo).toEqual([11, 30, 12, 10]);
        await esperar(() => ruta() === '/reportes', { que: 'la lista' });
        expect(avisos).toEqual([{ propuestaId: 31, plantillaId: 88, nombre: 'Cartera Toyota +90' }]);
    });

    it('editar una plantilla que ya existe no lleva asistentePropuestaId ni el aviso', async () => {
        b = await armar('/reportes/nuevo');
        await cargada();
        expect(document.querySelector('[data-testid="aviso-asistente"]')).toBeNull();
        await escribir(campo(/Nombre de la plantilla/), 'Una a mano');
        await irA('/reportes/nuevo');
        await pasar(100);
        expect(b.propuestas).toEqual([]);
    });
});

describe('Opciones que no se editan acá', () => {
    it('muestra el ancho fijo con su alineación y relleno, latin1 y fin de línea, y cada una se puede quitar', async () => {
        b = await armar('/reportes/nuevo?propuesta=31');
        await esperar(() => campo(/Nombre de la plantilla/).value === 'Cartera Toyota +90', { que: 'la plantilla cargada' });
        const caja = document.querySelector<HTMLElement>('[data-testid="opciones-solo-lectura"]')!;
        const t = limpio(caja.textContent ?? '');
        expect(t).toContain('Opciones que no se editan acá');
        expect(t).toContain('Ancho fijo: 4 columnas (anchos 11, 30, 12, 10 · 1 alineada a la derecha · 1 rellena con ceros)');
        expect(t).toContain('Codificación latin1');
        expect(t).toContain('Fin de línea \\n');
        expect(t).not.toContain('Sin BOM');

        await clic(caja.querySelector('button[aria-label="Quitar: Codificación latin1"]'), 'Quitar latin1');
        await esperar(() => !limpio(document.querySelector('[data-testid="opciones-solo-lectura"]')!.textContent ?? '').includes('latin1'), { que: 'latin1 fuera' });
        await clic(boton('Guardar'), 'Guardar');
        await esperar(() => b!.altas.length === 1, { que: 'el alta' });
        const txt = b.altas[0].opcionesFormato.txt;
        expect(txt.encoding).toBeUndefined();
        expect(txt.anchoFijo).toEqual([11, 30, 12, 10]);
        expect(txt.alineacion).toEqual(['izquierda', 'izquierda', 'derecha', 'izquierda']);
        expect(txt.lineEnding).toBe('\n');
    });

    it('quitar el ancho fijo saca también la alineación y el relleno; sin opciones raras el recuadro no aparece; «Sin BOM» en CSV', async () => {
        b = await armar('/reportes/nuevo?propuesta=31');
        await esperar(() => campo(/Nombre de la plantilla/).value === 'Cartera Toyota +90', { que: 'la plantilla cargada' });
        await clic(document.querySelector('button[aria-label^="Quitar: Ancho fijo"]'), 'Quitar el ancho fijo');
        await clic(document.querySelector('button[aria-label="Quitar: Codificación latin1"]'), 'Quitar latin1');
        await clic(document.querySelector('button[aria-label^="Quitar: Fin de línea"]'), 'Quitar el fin de línea');
        await esperar(() => !document.querySelector('[data-testid="opciones-solo-lectura"]'), { que: 'el recuadro vacío fuera' });
        await clic(boton('Guardar'), 'Guardar');
        await esperar(() => b!.altas.length === 1, { que: 'el alta' });
        expect(b.altas[0].opcionesFormato.txt).toEqual({ incluirHeader: false });

        await b.v.desmontar(); await b.srv.bajar(); b = null;
        b = await armar('/reportes/nuevo?propuesta=31', { plantilla: () => ({ body: plantillaAsistente({ formatoSalida: 'csv', opcionesFormato: { csv: { separador: ';', bom: false } } }) }) });
        await esperar(() => campo(/Nombre de la plantilla/).value === 'Cartera Toyota +90', { que: 'el CSV cargado' });
        expect(limpio(document.querySelector('[data-testid="opciones-solo-lectura"]')!.textContent ?? '')).toContain('Sin BOM');
    });
});

/** El panel de propiedades con estado, como lo usa el editor. */
function Arnes({ inicial, registro }: { inicial: Columna; registro: Array<[string, unknown]> }) {
    const [c, setC] = useState(inicial);
    return <PropertiesPanel columna={c} catalogo={CATALOGO} onColumnChange={(f, v) => { registro.push([f as string, v]); setC((x) => ({ ...x, [f]: v })); }} />;
}

describe('PropertiesPanel: días desde la fecha y decimales', () => {
    it('«Días desde la fecha» se habilita solo con campos de fecha', async () => {
        const v = await montar(<Arnes inicial={col({ label: 'Saldo', path: 'montoTotal', tipo: 'numero' })} registro={[]} />);
        await act(async () => { combo(/Tipo de dato/).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
        const opcion = await esperar(() => Array.from(document.querySelectorAll('li[role="option"]')).find((o) => /Días desde la fecha/.test(o.textContent ?? '')), { que: 'la opción' });
        expect(opcion.getAttribute('aria-disabled')).toBe('true');
        expect(pantalla()).toContain('«Días desde la fecha» se habilita solo con campos de fecha.');
        await v.desmontar();

        const registro: Array<[string, unknown]> = [];
        const v2 = await montar(<Arnes inicial={col({ label: 'Vence', path: 'fechaVencimiento', tipo: 'fecha' })} registro={registro} />);
        await elegir(/Tipo de dato/, /Días desde la fecha/);
        expect(registro).toContainEqual(['tipo', 'dias']);
        expect(pantalla()).toContain('Muestra cuántos días pasaron entre la fecha y hoy.');
        // Con ese tipo no hay formato ni decimales que configurar.
        expect(Array.from(document.querySelectorAll('label')).some((l) => /^Formato/.test(l.textContent ?? ''))).toBe(false);
        expect(Array.from(document.querySelectorAll('label')).some((l) => /Decimales/.test(l.textContent ?? ''))).toBe(false);
        await v2.desmontar();
    });

    it('una columna numérica tiene decimales y separadores; vacío vuelve al comportamiento de siempre', async () => {
        const registro: Array<[string, unknown]> = [];
        const v = await montar(<Arnes inicial={col({ label: 'Saldo', path: 'montoTotal', tipo: 'numero' })} registro={registro} />);
        await escribir(campo(/^Decimales/), '2');
        expect(registro).toContainEqual(['decimales', 2]);
        await elegir(/Separador decimal/, /Punto/);
        expect(registro).toContainEqual(['separadorDecimal', '.']);
        await elegir(/Separador de miles/, /Sin separador/);
        expect(registro).toContainEqual(['separadorMiles', '']);
        await elegir(/Separador de miles/, /Predeterminado/);
        expect(registro).toContainEqual(['separadorMiles', undefined]);
        await escribir(campo(/^Decimales/), '');
        expect(registro).toContainEqual(['decimales', undefined]);
        await v.desmontar();
        // Un texto no tiene nada de esto.
        const v2 = await montar(<Arnes inicial={col({ label: 'DNI', path: 'documento', tipo: 'texto' })} registro={[]} />);
        expect(Array.from(document.querySelectorAll('label')).some((l) => /Decimales/.test(l.textContent ?? ''))).toBe(false);
        await v2.desmontar();
    });

    it('un campo con una expresión que el explorador no ofrece (el 2.º teléfono) trae su ayuda; uno común no', async () => {
        const v = await montar(<Arnes inicial={col({ label: 'Teléfono 2', path: 'contactos[tipo=telefono][1].valor', tipo: 'texto' })} registro={[]} />);
        const ayuda = document.querySelector('[data-testid="ayuda-expresion"]')!;
        expect(limpio(ayuda.textContent ?? '')).toBe('Este campo lo armó amaIA con una expresión que el explorador no ofrece (por ejemplo, el 2.º teléfono). Podés renombrarlo o borrarlo; para cambiarle el campo, borrala y agregá otra.');
        await v.desmontar();
        const v2 = await montar(<Arnes inicial={col({ label: 'DNI', path: 'documento' })} registro={[]} />);
        expect(document.querySelector('[data-testid="ayuda-expresion"]')).toBeNull();
        await v2.desmontar();
    });
});

describe('Filtros de fecha relativa', () => {
    it('el chip dice «hace 90 días» y no «hoy-90»', async () => {
        b = await armar('/reportes/nuevo?propuesta=31');
        await esperar(() => campo(/Nombre de la plantilla/).value === 'Cartera Toyota +90', { que: 'la plantilla cargada' });
        await clic(pestania('Filtros'), 'la pestaña Filtros');
        await esperar(() => pantalla().includes('hace 90 días'), { que: 'el chip' });
        expect(pantalla()).not.toContain('hoy-90');
        // El operador se rotula bien aunque el filtro lo haya armado el asistente.
        expect(pantalla()).toContain('Hasta');
    });

    it('en el editor: conmutador Fecha fija / Relativa a hoy, días, antes o después, y a qué fecha corresponde hoy', async () => {
        b = await armar('/reportes/nuevo?propuesta=31');
        await esperar(() => campo(/Nombre de la plantilla/).value === 'Cartera Toyota +90', { que: 'la plantilla cargada' });
        await clic(pestania('Filtros'), 'la pestaña Filtros');
        await clic(Array.from(document.querySelectorAll('p, div')).find((x) => x.children.length === 0 && limpio(x.textContent ?? '') === 'hace 90 días') ?? null, 'el chip del filtro de fecha');
        const dlg = await esperar(() => dialogo(/Editar filtro/), { que: 'el editor del filtro' });
        const relativa = Array.from(dlg.querySelectorAll('button')).find((x) => /Relativa a hoy/.test(x.textContent ?? ''))!;
        expect(relativa.getAttribute('aria-pressed')).toBe('true');
        expect((Array.from(dlg.querySelectorAll('input[type="number"]'))[0] as HTMLInputElement).value).toBe('90');
        expect(limpio(dlg.textContent ?? '')).toContain(`hace 90 días: ${hoyMas(-90)}`);
        expect(limpio(dlg.textContent ?? '')).toContain('antes de hoy');

        // Fija: el calendario de siempre.
        await clic(Array.from(dlg.querySelectorAll('button')).find((x) => /Fecha fija/.test(x.textContent ?? '')) ?? null, 'Fecha fija');
        expect(dlg.querySelector('input[type="date"]')).not.toBeNull();
        // Vuelve a relativa: arranca en «hoy».
        await clic(Array.from(dlg.querySelectorAll('button')).find((x) => /Relativa a hoy/.test(x.textContent ?? '')) ?? null, 'Relativa a hoy');
        expect(limpio(dlg.textContent ?? '')).toContain(`hoy: ${hoyMas(0)}`);
        await escribir(dlg.querySelector('input[type="number"]') as HTMLInputElement, '7');
        await elegir(/Cuándo/, /después de hoy/, dlg);
        expect(limpio(dlg.textContent ?? '')).toContain(`dentro de 7 días: ${hoyMas(7)}`);
        await clic(boton('Guardar', dlg), 'Guardar el filtro');
        await esperar(() => pantalla().includes('dentro de 7 días'), { que: 'el chip actualizado' });
        await clic(boton('Guardar'), 'Guardar la plantilla');
        await esperar(() => b!.altas.length === 1, { que: 'el alta' });
        expect(b.altas[0].definicion.filtros[1].valor).toBe('hoy+7');
    });

    it('al ejecutar, un valor por defecto relativo se muestra resuelto', async () => {
        const filtro: Filtro = { id: 'f-1', path: 'fechaVencimiento', operador: 'lte', variable: true, labelVariable: 'Vencimiento hasta', obligatorio: true, valorPorDefecto: 'hoy-90', tipoEscalar: 'fecha' };
        const v = await montar(<VariableInput filtro={filtro} value="hoy-90" onChange={() => undefined} />);
        expect(pantalla()).toContain(`hace 90 días: ${hoyMas(-90)}`);
        await v.desmontar();
    });

    it('las funciones de fecha relativa', () => {
        expect(parseFechaRelativa('hoy')).toBe(0);
        expect(parseFechaRelativa('hoy-90')).toBe(-90);
        expect(parseFechaRelativa('hoy+7')).toBe(7);
        expect(parseFechaRelativa('2026-07-21')).toBeNull();
        expect(parseFechaRelativa('hoy-99999')).toBeNull();
        expect(describirFechaRelativa('hoy-1')).toBe('hace 1 día');
        expect(describirFechaRelativa('hoy+1')).toBe('dentro de 1 día');
        expect(describirFechaRelativa('2026-07-21')).toBe('2026-07-21');
        expect(resolverFechaRelativa('hoy-90', new Date(2026, 9, 19))).toBe('21/07/2026');
    });
});

describe('Totales atados a una columna', () => {
    const dias = col({ id: 'c-dias', label: 'Días de mora', path: 'fechaVencimiento', tipo: 'dias' });
    const venc = col({ id: 'c-venc', label: 'Vencimiento', path: 'fechaVencimiento', tipo: 'fecha' });
    const saldo = col({ id: 'c-saldo', label: 'Saldo', path: 'montoTotal', tipo: 'numero' });

    function ArnesTotales({ columnas, inicial, registro }: { columnas: Columna[]; inicial: Total[]; registro: Total[][] }) {
        const [totales, setTotales] = useState(inicial);
        return <GroupingBuilder agrupaciones={[]} totales={totales} columnas={columnas} onChange={(_a, t) => { registro.push(t); setTotales(t); }} />;
    }
    // Este Select es un FormControl con InputLabel (sin id): se llega al combobox desde su etiqueta.
    const comboTotal = () => Array.from(document.querySelectorAll('label')).find((l) => limpio(l.textContent ?? '') === 'Columna')!.parentElement!.querySelector<HTMLElement>('[role="combobox"]')!;
    const elegirColumna = async (opcion: RegExp) => {
        await act(async () => { comboTotal().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); });
        const li = await esperar(() => Array.from(document.querySelectorAll('li[role="option"]')).find((o) => opcion.test(o.textContent ?? '')), { que: `la opción ${opcion}` });
        await clic(li, 'la opción');
        await esperar(() => !document.querySelector('li[role="option"]'), { que: 'menú cerrado' });
    };

    it('una columna «Días desde la fecha» cuenta como numérica: Agregar crea el total atado a su id', async () => {
        const registro: Total[][] = [];
        const v = await montar(<ArnesTotales columnas={[venc, dias]} inicial={[]} registro={registro} />);
        await clic(Array.from(document.querySelectorAll('button')).filter((x) => /^Agregar$/.test(limpio(x.textContent ?? '')))[1], 'Agregar total');
        expect(registro.at(-1)).toEqual([{ path: 'fechaVencimiento', columnaId: 'c-dias', funcion: 'sum', label: 'Total Días de mora' }]);
        await v.desmontar();
    });

    it('elegir una columna manda su id y su campo; dos columnas con el mismo campo se distinguen', async () => {
        const registro: Total[][] = [];
        const v = await montar(<ArnesTotales columnas={[dias, venc, saldo]} inicial={[{ path: 'fechaVencimiento', columnaId: 'c-dias', funcion: 'avg' }]} registro={registro} />);
        expect(limpio(comboTotal().textContent ?? '')).toBe('Días de mora');
        await elegirColumna(/^Vencimiento$/);
        expect(registro.at(-1)![0]).toMatchObject({ path: 'fechaVencimiento', columnaId: 'c-venc', funcion: 'avg' });
        await elegirColumna(/^Saldo$/);
        expect(registro.at(-1)![0]).toMatchObject({ path: 'montoTotal', columnaId: 'c-saldo' });
        await v.desmontar();
    });

    it('un total guardado sin columnaId se muestra en la única columna con ese campo; con dos queda sin elegir', async () => {
        const v = await montar(<ArnesTotales columnas={[dias, saldo]} inicial={[{ path: 'montoTotal', funcion: 'sum' }]} registro={[]} />);
        expect(limpio(comboTotal().textContent ?? '')).toBe('Saldo');
        await v.desmontar();
        const v2 = await montar(<ArnesTotales columnas={[dias, venc]} inicial={[{ path: 'fechaVencimiento', funcion: 'sum' }]} registro={[]} />);
        expect(limpio(comboTotal().textContent ?? '').replace(/\u200b/g, '')).toBe('');
        await v2.desmontar();
    });
});

describe('Cambiar de ruta con el editor en uso', () => {
    it('editando la 5 con cambios, «Abrir en el editor» y «Seguir con lo mío»: vuelve a /reportes/5/editar con lo suyo y Guardar actualiza (PATCH), no crea una copia', async () => {
        b = await armar('/reportes/5/editar');
        await esperar(() => campo(/Nombre de la plantilla/).value === 'Plantilla cinco', { que: 'la 5 cargada' });
        await escribir(campo(/Nombre de la plantilla/), 'Plantilla cinco, editada');
        await irA('/reportes/nuevo?propuesta=31');
        await esperar(() => dialogo(/Reemplazar lo que tenés armado/), { que: 'la confirmación' });
        await clic(boton('Seguir con lo mío'), 'Seguir con lo mío');
        await esperar(() => ruta() === '/reportes/5/editar', { que: 'la vuelta a la 5' });
        await pasar(200);
        expect(campo(/Nombre de la plantilla/).value).toBe('Plantilla cinco, editada');
        expect(b.propuestas).toEqual([]);
        await clic(boton('Guardar'), 'Guardar');
        await esperar(() => b!.parches.length === 1, { que: 'el PATCH' });
        expect(b.parches[0]).toMatchObject({ id: 5, nombre: 'Plantilla cinco, editada' });
        expect(b.altas).toHaveLength(0);
    });

    it('«Ver la plantilla» de otra (/reportes/7/editar) con cambios sin guardar pregunta antes de pisarlos; «Seguir editando» los conserva', async () => {
        b = await armar('/reportes/5/editar');
        await esperar(() => campo(/Nombre de la plantilla/).value === 'Plantilla cinco', { que: 'la 5 cargada' });
        await escribir(campo(/Nombre de la plantilla/), 'Cambio sin guardar');
        await irA('/reportes/7/editar');
        await esperar(() => dialogo(/Cambios sin guardar/), { que: 'la confirmación' });
        await clic(boton('Seguir editando'), 'Seguir editando');
        await esperar(() => ruta() === '/reportes/5/editar', { que: 'la vuelta a la 5' });
        expect(campo(/Nombre de la plantilla/).value).toBe('Cambio sin guardar');
        expect(b.srv.cuantos('GET', /^\/reportes\/plantillas\/7$/)).toBe(0);

        await irA('/reportes/7/editar');
        await esperar(() => dialogo(/Cambios sin guardar/), { que: 'la confirmación otra vez' });
        await clic(boton('Descartar los cambios'), 'Descartar los cambios');
        await esperar(() => campo(/Nombre de la plantilla/).value === 'Plantilla siete', { que: 'la 7 cargada' });
    });

    it('sin cambios, cambiar de plantilla carga directo y sin preguntar', async () => {
        b = await armar('/reportes/5/editar');
        await esperar(() => campo(/Nombre de la plantilla/).value === 'Plantilla cinco', { que: 'la 5 cargada' });
        await irA('/reportes/7/editar');
        await esperar(() => campo(/Nombre de la plantilla/).value === 'Plantilla siete', { que: 'la 7 cargada' });
        expect(dialogo()).toBeNull();
    });

    it('de editar la 5 a «Nueva plantilla» (por ejemplo con «Sí, llevarme»): sin cambios se limpia el editor para que Guardar cree una nueva, no pise la 5', async () => {
        b = await armar('/reportes/5/editar');
        await esperar(() => campo(/Nombre de la plantilla/).value === 'Plantilla cinco', { que: 'la 5 cargada' });
        await irA('/reportes/nuevo');
        await esperar(() => campo(/Nombre de la plantilla/).value === '', { que: 'el editor limpio' });
    });
});

describe('Ancho fijo: sigue a las columnas', () => {
    const c = (id: string): Columna => col({ id, label: id });
    const txt = (o: object) => ({ txt: { anchoFijo: [11, 12, 10], alineacion: ['izquierda', 'derecha', 'izquierda'], relleno: [' ', '0', ' '], ...o } }) as any;

    it('quitar una columna saca su ancho, alineación y relleno (y no corre los de las demás)', () => {
        const r = acompanarColumnas(txt({}), [c('dni'), c('saldo'), c('vence')], [c('saldo'), c('vence')])!.txt!;
        expect(r.anchoFijo).toEqual([12, 10]);
        expect(r.alineacion).toEqual(['derecha', 'izquierda']);
        expect(r.relleno).toEqual(['0', ' ']);
    });

    it('agregar entra con un default visible (10, izquierda, espacios) y reordenar los mueve con la columna', () => {
        const base = [c('dni'), c('saldo'), c('vence')];
        const agregada = acompanarColumnas(txt({}), base, [...base, c('nueva')])!.txt!;
        expect(agregada.anchoFijo).toEqual([11, 12, 10, 10]);
        expect(agregada.alineacion).toEqual(['izquierda', 'derecha', 'izquierda', 'izquierda']);
        expect(agregada.relleno).toEqual([' ', '0', ' ', ' ']);
        const reordenada = acompanarColumnas(txt({}), base, [c('vence'), c('dni'), c('saldo')])!.txt!;
        expect(reordenada.anchoFijo).toEqual([10, 11, 12]);
        expect(reordenada.relleno).toEqual([' ', ' ', '0']);
    });

    it('sin ancho fijo, o con un arreglo que ya no coincidía, no toca nada', () => {
        const sin = { txt: { separador: ';' } };
        expect(acompanarColumnas(sin, [c('a')], [])).toBe(sin);
        const raro = txt({ anchoFijo: [5, 5] });
        expect(acompanarColumnas(raro, [c('a'), c('b'), c('d')], [c('a')])).toBe(raro);
        expect(acompanarColumnas(undefined, [c('a')], [])).toBeUndefined();
    });

    it('validatePlantilla: error si los largos no coinciden con las columnas, y si hay ceros sin alineación a la derecha', () => {
        const p = (opcionesFormato: any, n = 3): Partial<Plantilla> => ({
            nombre: 'x', formatoSalida: 'txt', opcionesFormato,
            definicion: { columnas: Array.from({ length: n }, (_, i) => c(`c${i}`)), filtros: [], ordenamientos: [], cardinalidadDefault: 'concatenar' },
        });
        expect(validatePlantilla(p(txt({}))).filter((e) => e.type === 'error')).toEqual([]);
        const largos = validatePlantilla(p(txt({}), 2)).map((e) => e.message);
        expect(largos.some((m) => /El ancho fijo tiene 3 anchos y hay 2 columnas/.test(m))).toBe(true);
        const ceros = validatePlantilla(p(txt({ alineacion: ['izquierda', 'izquierda', 'izquierda'] }))).map((e) => e.message);
        expect(ceros).toContain('En «c1» el relleno con ceros solo se puede usar con alineación a la derecha');
        const sinAlin = validatePlantilla(p(txt({ alineacion: undefined }))).map((e) => e.message);
        expect(sinAlin.some((m) => /relleno con ceros/.test(m))).toBe(true);
        // En otro formato no aplica.
        expect(validatePlantilla({ ...p(txt({})), formatoSalida: 'csv' }).filter((e) => /ancho fijo|relleno/.test(e.message))).toEqual([]);
    });

    it('un total sobre «Días desde la fecha» no da el aviso de columna no numérica', () => {
        const dias = col({ label: 'Días de mora', path: 'fechaVencimiento', tipo: 'dias' });
        const r = validatePlantilla({
            nombre: 'x', formatoSalida: 'xlsx',
            definicion: { columnas: [dias], filtros: [], ordenamientos: [], totales: [{ path: 'fechaVencimiento', funcion: 'avg', columnaId: dias.id }], cardinalidadDefault: 'concatenar' },
        });
        expect(r.filter((e) => /no numérica/.test(e.message))).toEqual([]);
    });
});
