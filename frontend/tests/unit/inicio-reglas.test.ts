// pages/inicio: reglas de bloques y columnas (docs/inicio-spec.md §1 y §6.2) y los cálculos de formato. Todo puro.
import { describe, expect, it } from 'vitest';
import { accesosRapidos, bloquesVisibles, distribuir } from '@fe/pages/inicio/reglasBloques';
import { diaConNombre, diaCorto, esFinDeSemana, fechaLarga, haceCuanto, iniciales, saludo, variacion } from '@fe/pages/inicio/formato';
import { PERMISOS_ADMIN, PERMISOS_OPERADOR } from '../lib/banco-inicio';

const con = (permisos: string[]) => (p: string) => permisos.includes(p);
const ids = (permisos: string[], hayImportaciones = false) => {
    const v = bloquesVisibles(con(permisos), { hayImportaciones });
    return { v, d: distribuir(v) };
};

describe('bloques por rol (columnas sin huecos)', () => {
    it('OPERADOR (13 permisos): principal = [Retomá], lateral = [gráfico, Tus reportes]; sin agenda, actividad ni importaciones', () => {
        const { v, d } = ids(PERMISOS_OPERADOR);
        expect(d).toEqual({ principal: ['B6'], lateral: ['B5', 'B10'], modo: 'dos' });
        expect(v.B4).toBe(true);
        expect(v.B7).toBe(false);
        expect(v.B9).toBe(false);
        expect(v.B8).toBe(false);
    });

    it('OPERADOR con una carga propia (no pasa en prod, pero la regla lo cubre): B8 entra en el lateral', () => {
        expect(ids(PERMISOS_OPERADOR, true).d.lateral).toEqual(['B5', 'B8', 'B10']);
    });

    it('ADMIN con importaciones: principal = [agenda, Retomá], lateral = [gráfico, importaciones, actividad, reportes]', () => {
        expect(ids(PERMISOS_ADMIN, true).d).toEqual({ principal: ['B7', 'B6'], lateral: ['B5', 'B8', 'B9', 'B10'], modo: 'dos' });
    });

    it('ADMIN sin importaciones: B8 no se dibuja', () => {
        expect(ids(PERMISOS_ADMIN, false).d.lateral).toEqual(['B5', 'B9', 'B10']);
    });

    it('principal vacía: todo el lateral pasa a una grilla de 2 columnas', () => {
        expect(ids(['reportes.ver', 'auditoria.ver']).d).toEqual({ principal: [], lateral: ['B9', 'B10'], modo: 'solo-lateral' });
    });

    it('lateral vacía: la principal ocupa todo el ancho', () => {
        expect(ids(['promesas.ver']).d).toEqual({ principal: ['B7'], lateral: [], modo: 'solo-principal' });
    });

    it('sin ningún permiso no hay bloques', () => {
        const { v, d } = ids([]);
        expect(Object.values(v).every((x) => x === false)).toBe(true);
        expect(d.modo).toBe('vacio');
    });

    it('Retomá pide comentarios.ver Y deudores.ver; los indicadores y el gráfico, uno de los dos comentarios.*', () => {
        expect(ids(['comentarios.ver']).v.B6).toBe(false);
        expect(ids(['deudores.ver']).v.B6).toBe(false);
        expect(ids(['comentarios.crear']).v).toMatchObject({ B4: true, B5: true, B6: false });
    });

    it('la agenda aparece con promesas.ver, o con convenios.crear junto con convenios.ver (auditoría: solo crear la dejaba vacía)', () => {
        expect(ids(['promesas.ver']).v.B7).toBe(true);
        expect(ids(['convenios.crear', 'convenios.ver']).v.B7).toBe(true);
        expect(ids(['convenios.crear']).v.B7).toBe(false);
        expect(ids(['convenios.ver']).v.B7).toBe(false);
    });
});

describe('accesos rápidos', () => {
    const etiquetas = (p: string[]) => accesosRapidos(con(p)).map((a) => a.etiqueta);
    it('OPERADOR: Gestión, Historial de importaciones y Reportes', () => {
        expect(etiquetas(PERMISOS_OPERADOR)).toEqual(['Gestión', 'Historial de importaciones', 'Reportes']);
    });
    it('ADMIN: Gestión, Nueva importación, Reportes y Tableros (el historial no, porque puede importar)', () => {
        expect(etiquetas(PERMISOS_ADMIN)).toEqual(['Gestión', 'Nueva importación', 'Reportes', 'Tableros']);
    });
    it('nunca más de 4', () => {
        expect(accesosRapidos(() => true).length).toBeLessThanOrEqual(4);
    });
});

describe('formato', () => {
    it('saludo según la hora', () => {
        expect([saludo(7), saludo(12), saludo(19), saludo(20), saludo(0)]).toEqual(['Buen día', 'Buenas tardes', 'Buenas tardes', 'Buenas noches', 'Buen día']);
    });
    it('fecha larga, día corto y día con nombre', () => {
        expect(fechaLarga('2026-10-16')).toBe('Viernes 16 de octubre');
        expect(diaCorto('2026-10-03')).toBe('3/10');
        expect(diaConNombre('2026-10-19')).toBe('Lunes 19');
        expect(esFinDeSemana('2026-10-17')).toBe(true);
        expect(esFinDeSemana('2026-10-16')).toBe(false);
        expect(fechaLarga('basura')).toBe('');
    });
    it('hace cuánto', () => {
        const ahora = Date.parse('2026-10-16T15:00:00Z');
        expect(haceCuanto('2026-10-16T14:59:30Z', ahora)).toBe('hace un momento');
        expect(haceCuanto('2026-10-16T14:55:00Z', ahora)).toBe('hace 5 min');
        expect(haceCuanto('2026-10-16T12:00:00Z', ahora)).toBe('hace 3 h');
        expect(haceCuanto('2026-10-14T15:00:00Z', ahora)).toBe('hace 2 d');
        expect(haceCuanto('2026-10-16T16:00:00Z', ahora)).toBe('hace un momento');
        expect(haceCuanto('no es una fecha', ahora)).toBe('');
    });
    it('variación: ▲ desde +5 %, ▼ desde −5 %, igual en el medio', () => {
        expect(variacion(38, 34)).toEqual({ tipo: 'sube', porcentaje: 12 });
        expect(variacion(20, 34)).toEqual({ tipo: 'baja', porcentaje: 41 });
        expect(variacion(35, 34)).toEqual({ tipo: 'igual', porcentaje: 3 });
        expect(variacion(105, 100).tipo).toBe('sube');
        expect(variacion(95, 100).tipo).toBe('baja');
    });
    it('sin base o con base 0 nunca da NaN, Infinity ni −100 %', () => {
        expect(variacion(0, null)).toEqual({ tipo: 'sin-base' });
        expect(variacion(5, undefined)).toEqual({ tipo: 'sin-base' });
        expect(variacion(5, 0)).toEqual({ tipo: 'base-cero' });
        expect(variacion(0, 0)).toEqual({ tipo: 'base-cero' });
        expect(variacion(Number.NaN, 5)).toEqual({ tipo: 'sin-base' });
    });
    it('iniciales', () => {
        expect(iniciales('ana pérez')).toBe('AP');
        expect(iniciales('Cher')).toBe('C');
        expect(iniciales('  ')).toBe('?');
    });
});
