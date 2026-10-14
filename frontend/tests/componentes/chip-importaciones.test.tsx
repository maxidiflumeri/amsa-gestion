// C2b, paquete B: el chip de la barra superior (TH-1 a TH-4). Vive dentro de NotificacionesBell.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fijarAncho } from '../lib/ancho';
import { RAIZ_FE } from '../lib/raiz';
import { clic, esperar, limpio, pasar } from '../lib/montar';
import { armarCampanita, campanitaAbierta, corriendo, enCola, finalizada, type BancoCampanita } from '../lib/banco-campanita';

let b: BancoCampanita | null = null;
afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

const chipDeImportaciones = () => Array.from(b!.v.contenedor.querySelectorAll('.MuiChip-root')).find((c) => /Import/i.test(c.textContent ?? '')) ?? null;
const botonDeImportaciones = () => b!.v.contenedor.querySelector<HTMLButtonElement>('button[aria-label^="Import"], button[aria-label^="Cancelando"], button[aria-label$="importaciones"]');
const textoDelChip = () => limpio(chipDeImportaciones()?.textContent ?? '');

describe('TH-1 — el chip sigue a las cargas en curso', () => {
    it('sin cargas no hay chip; con una aparece «Importando 43 %» y se actualiza; con tres, «3 importaciones»; al terminar la última, desaparece', async () => {
        b = await armarCampanita();
        expect(chipDeImportaciones()).toBeNull();
        expect(b.v.contenedor.querySelectorAll('.MuiChip-root')).toHaveLength(0);

        b.pub('import:progreso', corriendo(201, { rev: 11, progreso: 43 }));
        await esperar(() => textoDelChip() === 'Importando 43 %', { que: 'el chip con el avance' });
        b.pub('import:progreso', corriendo(201, { rev: 12, progreso: 51 }));
        await esperar(() => textoDelChip() === 'Importando 51 %', { que: 'el chip actualizado' });

        b.pub('import:progreso', enCola(202, 1));
        b.pub('import:progreso', enCola(203, 2));
        await esperar(() => textoDelChip() === '3 importaciones', { que: 'el chip con tres' });

        b.pub('import:finalizada', finalizada(202));
        b.pub('import:finalizada', finalizada(203));
        await esperar(() => textoDelChip() === 'Importando 51 %', { que: 'el chip con la que queda' });
        b.pub('import:finalizada', finalizada(201));
        await esperar(() => chipDeImportaciones() === null, { que: 'el chip desaparecido' });
    });

    it('una en cola dice «Importación en cola»; con la cancelación pedida, «Cancelando importación»', async () => {
        b = await armarCampanita();
        b.pub('import:progreso', enCola(202, 0));
        await esperar(() => textoDelChip() === 'Importación en cola', { que: 'el chip de la cola' });
        b.pub('import:progreso', enCola(202, 0, { rev: 3, cancelacionPedidaAt: new Date().toISOString() }));
        await esperar(() => textoDelChip() === 'Cancelando importación', { que: 'el chip cancelando' });
    });

    it('arranca con las cargas que ya estaban en curso al abrir la pantalla (hidratación por HTTP)', async () => {
        b = await armarCampanita({ enCurso: [corriendo(201, { progreso: 20 }), corriendo(202, { progreso: 70 })] });
        await esperar(() => textoDelChip() === '2 importaciones', { que: 'el chip hidratado' });
    });
});

describe('TH-2 — abrir la campanita desde el chip', () => {
    it('un clic en el chip abre la campanita con la sección de cargas en curso', async () => {
        b = await armarCampanita({ enCurso: [corriendo(201, { progreso: 43 })] });
        await esperar(() => chipDeImportaciones() !== null, { que: 'el chip' });
        expect(campanitaAbierta()).toBe(false);
        await clic(chipDeImportaciones(), 'el chip');
        await esperar(() => campanitaAbierta(), { que: 'la campanita' });
        await esperar(() => /Importaciones en curso \(1\)/.test(limpio(document.body.textContent ?? '')), { que: 'la sección de en curso' });
    });
});

describe('TH-3 — en un celular queda solo el ícono', () => {
    it('a 360 px: un IconButton con el texto como `aria-label` y ningún chip ni texto visible', async () => {
        b = await armarCampanita({ ancho: 360, enCurso: [corriendo(201, { progreso: 43 })] });
        const boton = await esperar(() => botonDeImportaciones(), { que: 'el botón del chip' });
        expect(boton.getAttribute('aria-label')).toBe('Importando 43 %');
        expect(limpio(boton.textContent ?? '')).toBe('');
        expect(b.v.contenedor.querySelectorAll('.MuiChip-root')).toHaveLength(0);
        expect(limpio(b.v.contenedor.textContent ?? '')).not.toMatch(/Importando/);
        await clic(boton, 'el ícono');
        await esperar(() => campanitaAbierta(), { que: 'la campanita' });
    });

    it('a 1280 px es un Chip con el texto visible y sin botón de ícono aparte', async () => {
        b = await armarCampanita({ ancho: 1280, enCurso: [corriendo(201, { progreso: 43 })] });
        await esperar(() => chipDeImportaciones() !== null, { que: 'el chip' });
        expect(textoDelChip()).toBe('Importando 43 %');
        expect(botonDeImportaciones()).toBeNull();
    });

    it('al cambiar el ancho en vivo, pasa de chip a ícono', async () => {
        b = await armarCampanita({ ancho: 1280, enCurso: [corriendo(201, { progreso: 43 })] });
        await esperar(() => chipDeImportaciones() !== null, { que: 'el chip' });
        fijarAncho(360);
        await pasar(100);
        await esperar(() => chipDeImportaciones() === null && botonDeImportaciones() !== null, { que: 'el ícono' });
    });

    it('en modo oscuro monta y muestra el mismo texto', async () => {
        b = await armarCampanita({ modo: 'dark', enCurso: [corriendo(201, { progreso: 43 })] });
        await esperar(() => textoDelChip() === 'Importando 43 %', { que: 'el chip en oscuro' });
    });
});

describe('TH-4 — la barra superior no consume el contexto', () => {
    const leer = (rel: string) => fs.readFileSync(path.join(RAIZ_FE, 'src', rel), 'utf8');

    it('AppBar.tsx no importa `useNotificaciones` ni el contexto de notificaciones: si lo hiciera, se redibujaría con cada evento de progreso', () => {
        const fuente = leer('components/layout/AppShell/AppBar.tsx');
        expect(fuente).not.toMatch(/useNotificaciones/);
        expect(fuente).not.toMatch(/NotificacionesContext/);
        expect(fuente).not.toMatch(/ChipImportaciones/);
    });

    it('el chip se dibuja desde NotificacionesBell, que ya consumía el contexto', () => {
        expect(leer('components/layout/AppShell/NotificacionesBell.tsx')).toMatch(/<ChipImportaciones/);
        expect(leer('components/layout/AppShell/ChipImportaciones.tsx')).toMatch(/useNotificaciones/);
    });
});
