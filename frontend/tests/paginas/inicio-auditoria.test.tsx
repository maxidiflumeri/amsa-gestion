// Inicio, Fase 1: lo que cambió después de la auditoría (docs/inicio-spec.md). Cada caso falla con el código anterior.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { navConfig } from '@fe/components/layout/AppShell/navConfig';
import { bloquesVisibles } from '@fe/pages/inicio/reglasBloques';
import { diaLocalIso } from '@fe/utils/fechas';
import { RAIZ_FE } from '../lib/raiz';
import { terminal, dtoFaseB } from '../lib/fabricas';
import { esperar, pasar } from '../lib/montar';
import { PERMISOS_ADMIN, PERMISOS_OPERADOR, armarInicio, dibujado, miDiaAdmin, titulos, type BancoInicio } from '../lib/banco-inicio';

let b: BancoInicio | null = null;
afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

describe('el menú tiene Inicio', () => {
    it('es el primer ítem, va a "/" y no pide permiso', () => {
        expect(navConfig[0]).toMatchObject({ label: 'Inicio', path: '/' });
        expect(navConfig[0].requiredPermissions ?? []).toEqual([]);
    });
});

describe('el operador de prod no ve una agenda vacía', () => {
    it('con sus 13 permisos (incluye "Ver convenios") no hay agenda', () => {
        const tiene = (p: string) => PERMISOS_OPERADOR.includes(p);
        expect(bloquesVisibles(tiene, { hayImportaciones: false }).B7).toBe(false);
    });
});

describe('las filas no enlazan a Gestión sin "Ver deudores"', () => {
    it('solo promesas.ver: la agenda se ve, pero sus filas no son enlaces', async () => {
        b = await armarInicio({ permisos: ['promesas.ver'], miDia: miDiaAdmin() });
        await esperar(() => document.querySelectorAll('[data-testid="fila-caso-sin-enlace"]').length > 0, { que: 'las filas de la agenda' });
        expect(document.querySelectorAll('a[href^="/gestion"]').length).toBe(0);
    });

    it('con "Ver deudores" sí son enlaces', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin() });
        await dibujado();
        await esperar(() => document.querySelectorAll('a[href^="/gestion?deudor="]').length > 0, { que: 'los enlaces al caso' });
    });
});

describe('una importación propia que termina', () => {
    it('vuelve a pedir "Tu día" y el bloque Importaciones no desaparece', async () => {
        const mia = dtoFaseB({ remesaId: 200, usuarioId: 3, nombre: 'Mi carga' });
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin({ importacionesHoy: [] }), enCurso: [mia] });
        await esperar(() => titulos().includes('Importaciones'), { que: 'el bloque con la carga en curso' });
        const antes = b.pedidosMiDia();
        b.miDia = miDiaAdmin({ importacionesHoy: [{ remesaId: 200, empresa: 'AYSA', nombre: 'Mi carga', numeroRemesa: '00200', resultado: 'OK', terminadaEn: new Date().toISOString(), ok: 10, err: 0 }] });
        b.srv.emitir('import:finalizada', terminal('OK', { remesaId: 200, usuarioId: 3, nombre: 'Mi carga', rev: 99 }));
        await esperar(() => b!.pedidosMiDia() > antes, { que: 'el pedido nuevo de mi-dia' });
        await pasar(300);
        expect(titulos()).toContain('Importaciones');
    });
});

describe('Actividad reciente', () => {
    // Sin modo estricto, como en prod: en desarrollo React monta dos veces y el primer pedido se descarta.
    it('se pide una sola vez al abrir Inicio (antes: al montar y otra vez al llegar "Tu día")', async () => {
        b = await armarInicio({ permisos: PERMISOS_ADMIN, miDia: miDiaAdmin(), estricto: false });
        await dibujado();
        await pasar(1500);
        expect(b.pedidosTransacciones()).toBe(1);
    });
});

describe('solo la columna lateral con una cantidad impar de bloques', () => {
    it('el último ocupa el ancho entero', async () => {
        b = await armarInicio({ permisos: ['reportes.ver', 'auditoria.ver', 'comentarios.crear'], miDia: miDiaAdmin() });
        await dibujado();
        const items = Array.from(document.querySelectorAll('[data-ancho]'));
        expect(items.length).toBe(3);
        expect(items[2].getAttribute('data-ancho')).toBe('entero');
        expect(items[0].getAttribute('data-ancho')).toBe('mitad');
    });
});

describe('fechas sin hora en la ficha', () => {
    it('el calendario de promesas usa el día local: a las 23:30 del 16/10 sigue siendo el 16', () => {
        const noche = new Date(2026, 9, 16, 23, 30);
        expect(diaLocalIso(0, noche)).toBe('2026-10-16');
        expect(diaLocalIso(7, noche)).toBe('2026-10-23');
        expect(diaLocalIso(0, new Date(2026, 9, 16, 0, 10))).toBe('2026-10-16');
    });

    it('la ficha no muestra fechas de promesas ni de cuotas con toLocaleDateString (se veían un día antes)', () => {
        const leer = (r: string) => fs.readFileSync(path.join(RAIZ_FE, 'src', r), 'utf8');
        expect(leer('components/deudores/ficha/tabs/FichaPagosTab.tsx')).not.toMatch(/new Date\(p\.fechaPromesa\)\.toLocaleDateString/);
        expect(leer('components/deudores/ficha/tabs/FichaConveniosTab.tsx')).not.toMatch(/new Date\(cuota\.fechaVencimiento\)\.toLocaleDateString/);
        expect(leer('components/deudores/ficha/FichaDeudor.tsx')).not.toMatch(/new Date\(promesa\.fechaPromesa\)\.toLocaleDateString/);
        expect(leer('components/deudores/ficha/modals/NuevoPagoModal.tsx')).not.toMatch(/toISOString\(\)\.split\('T'\)/);
    });
});

describe('un cambio mientras "Tu día" se está pidiendo', () => {
    it('se vuelve a pedir apenas termina el pedido en vuelo (si no, quedaba viejo hasta 5 minutos)', async () => {
        const mia = dtoFaseB({ remesaId: 210, usuarioId: 3, nombre: 'Mi carga' });
        b = await armarInicio({
            permisos: PERMISOS_ADMIN, miDia: miDiaAdmin({ importacionesHoy: [] }), enCurso: [mia], estricto: false,
            antes: (bb) => {
                // Todos los pedidos tardan 1,2 s: la carga termina mientras el primero está en vuelo.
                bb.dictar = async () => { await new Promise((r) => setTimeout(r, 1200)); return null; };
            },
        });
        await esperar(() => b!.pedidosMiDia() === 1, { que: 'el primer pedido en vuelo' });
        b.srv.emitir('import:finalizada', terminal('OK', { remesaId: 210, usuarioId: 3, nombre: 'Mi carga', rev: 99 }));
        await esperar(() => b!.pedidosMiDia() === 2, { que: 'el segundo pedido, después del primero', ms: 6000 });
    });
});
