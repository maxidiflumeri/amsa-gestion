import { hashDefinicion } from './hash-plantilla';

describe('hashDefinicion', () => {
    const base = {
        columnas: [{ id: 'a', path: 'documento', label: 'DNI' }],
        filtros: [{ id: 'f', path: 'empresa.nombre', operador: 'eq', valor: 'TOYOTA' }],
        ordenamientos: [],
        cardinalidadDefault: 'concatenar',
    };

    it('no depende de los ids ni del orden de las claves', () => {
        const otro = {
            cardinalidadDefault: 'concatenar',
            ordenamientos: [],
            filtros: [{ valor: 'TOYOTA', operador: 'eq', path: 'empresa.nombre', id: 'otro' }],
            columnas: [{ label: 'DNI', path: 'documento', id: 'b' }],
        };
        expect(hashDefinicion(otro)).toBe(hashDefinicion(base));
    });

    it('cambia si cambia un filtro o una columna, y no confunde undefined con un valor', () => {
        expect(hashDefinicion({ ...base, filtros: [{ ...base.filtros[0], valor: 'TELECOM' }] })).not.toBe(hashDefinicion(base));
        expect(hashDefinicion({ ...base, columnas: [{ ...base.columnas[0], label: 'Doc' }] })).not.toBe(hashDefinicion(base));
        expect(hashDefinicion({ ...base, columnas: [{ ...base.columnas[0], formato: undefined } as never] })).toBe(hashDefinicion(base));
    });
});

describe('hashDefinicion ignora lo que el editor agrega por su cuenta', () => {
    const base = {
        columnas: [{ id: 'a', path: 'documento', label: 'DNI' }],
        filtros: [{ id: 'f', path: 'fechaVencimiento', operador: 'lte', valor: '2026-01-01' }],
        ordenamientos: [],
        cardinalidadDefault: 'concatenar',
    };
    it('abrir un filtro y guardar (variable:false, tipoEscalar) no cambia el hash', () => {
        const editado = { ...base, filtros: [{ ...base.filtros[0], variable: false, obligatorio: false, tipoEscalar: 'fecha', enumValues: ['a'], labelVariable: '' }] };
        expect(hashDefinicion(editado)).toBe(hashDefinicion(base));
    });
    it('pero variable:true sí es un cambio', () => {
        expect(hashDefinicion({ ...base, filtros: [{ ...base.filtros[0], variable: true }] })).not.toBe(hashDefinicion(base));
    });
});
