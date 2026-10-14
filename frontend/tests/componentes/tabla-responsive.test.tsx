// C2a: DataTableResponsive con y sin `encabezadoAntesDe` (FT-1 y FT-2).
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import DataTableResponsive, { type DataTableColumn } from '@fe/components/ui/DataTableResponsive';
import { fijarAncho } from '../lib/ancho';
import { montar, type Montado } from '../lib/montar';

type Fila = { id: number; nombre: string; grupo: string | null } & Record<string, unknown>;
const FILAS: Fila[] = [
    { id: 1, nombre: 'Uno', grupo: 'a' },
    { id: 2, nombre: 'Dos', grupo: 'a' },
    { id: 3, nombre: 'Tres', grupo: null },
];
const COLUMNAS: Array<DataTableColumn<Fila>> = [
    { key: 'nombre', label: 'Nombre', primary: true, render: (r) => r.nombre },
    { key: 'id', label: 'Identificador', render: (r) => String(r.id) },
];

let v: Montado | null = null;
afterEach(async () => { if (v) await v.desmontar(); v = null; });

const tabla = (encabezadoAntesDe?: (r: Fila, i: number) => React.ReactNode | null) => (
    <DataTableResponsive<Fila> columns={COLUMNAS} rows={FILAS} rowKey={(r) => String(r.id)} encabezadoAntesDe={encabezadoAntesDe} />
);

describe('FT-1 — sin la propiedad nueva dibuja lo mismo que antes', () => {
    it('escritorio: tantas filas como datos y ninguna de ancho completo', async () => {
        v = await montar(tabla());
        expect(v.contenedor.querySelectorAll('tbody tr')).toHaveLength(3);
        expect(v.contenedor.querySelectorAll('[data-encabezado-de-bloque]')).toHaveLength(0);
        expect(v.contenedor.querySelectorAll('td[colspan]')).toHaveLength(0);
    });
    it('celular: tantas tarjetas como datos y ningún bloque', async () => {
        fijarAncho(360);
        v = await montar(tabla());
        expect(v.contenedor.querySelector('table')).toBeNull();
        expect(v.contenedor.querySelectorAll('.MuiCard-root')).toHaveLength(3);
        expect(v.contenedor.querySelectorAll('[data-encabezado-de-bloque]')).toHaveLength(0);
    });
    it('una propiedad que no devuelve nada para ninguna fila tampoco agrega nada', async () => {
        v = await montar(tabla(() => null));
        expect(v.contenedor.querySelectorAll('tbody tr')).toHaveLength(3);
    });
});

describe('FT-2 — con la propiedad: la fila de ancho completo antes de las indicadas', () => {
    const encabezado = (r: Fila, i: number) => (r.grupo != null && (i === 0 || FILAS[i - 1].grupo !== r.grupo) ? `Encabezado ${r.grupo}` : null);
    it('escritorio: una fila con una sola celda que ocupa todas las columnas, antes de la primera', async () => {
        v = await montar(tabla(encabezado));
        const filas = Array.from(v.contenedor.querySelectorAll('tbody tr'));
        expect(filas).toHaveLength(4);
        expect(filas[0].textContent).toBe('Encabezado a');
        expect(filas[0].querySelectorAll('td')).toHaveLength(1);
        expect(filas[0].querySelector('td')!.getAttribute('colspan')).toBe(String(COLUMNAS.length));
        expect(filas[1].textContent).toContain('Uno');
    });
    it('celular: un bloque entre dos tarjetas', async () => {
        fijarAncho(360);
        v = await montar(tabla(encabezado));
        const hijos = Array.from(v.contenedor.querySelectorAll('.MuiStack-root > *'));
        expect(hijos).toHaveLength(4);
        expect(hijos[0].hasAttribute('data-encabezado-de-bloque')).toBe(true);
        expect(hijos[0].textContent).toBe('Encabezado a');
        expect(hijos[1].classList.contains('MuiCard-root')).toBe(true);
    });
});
