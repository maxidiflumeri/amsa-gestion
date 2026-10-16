// El asistente abierto en el paso «Importando» de una carga que ya está en curso (/carga?seguir=<remesaId>): es a
// donde lleva el chip de la barra superior (16/10/2026, a pedido del usuario). Sirve aunque la carga no se haya armado
// en esta pantalla o se haya salido de ella.
import { afterEach, describe, expect, it } from 'vitest';
import { armarBancoC1, type BancoC1 } from '../lib/banco-asistente';
import { dtoC1, enColaC1, terminalC1 } from '../lib/fabricas';
import { esperar } from '../lib/montar';

let b: BancoC1 | null = null;
afterEach(async () => { if (b) { await b.v.desmontar(); await b.srv.bajar(); } b = null; });

const division = (bb: BancoC1, gid = 'g-real') => {
    bb.totales[gid] = 5;
    bb.estados[150] = dtoC1({ remesaId: 150, numeroRemesa: '30001', fase: 'PROCESANDO', estadoProceso: 'PROCESANDO', totalEsperado: 14047, procesadas: 132, ok: 132, err: 0, progreso: 0, grupoId: gid, grupoOrden: 1, grupoTotal: 5 });
    [151, 152, 153, 154].forEach((id, i) => {
        bb.estados[id] = enColaC1({ remesaId: id, numeroRemesa: String(i + 2), totalEsperado: 1500, grupoId: gid, grupoOrden: i + 2, grupoTotal: 5, enColaDelante: i });
    });
    bb.cortesDeRemesa = { 150: '3082 · 3GH', 151: '3083 · 1G', 152: '3085 · 3G', 153: '3084 · 2G', 154: '3086 · 3GH' };
};

describe('seguir una carga en curso desde la URL', () => {
    it('una división: el paso «Importando» con las 5 remesas, la que corre y el corte de cada una', async () => {
        b = await armarBancoC1({ ruta: '/carga?seguir=150', sembrar: (bb) => division(bb) });
        await esperar(() => /Carga dividida: remesa 1 de 5/.test(b!.texto()), { que: 'el aviso de la división' });
        await esperar(() => /Remesas terminadas: 0 de 5/.test(b!.texto()), { que: 'el resumen del grupo' });
        await esperar(() => b!.texto().includes('3082 · 3GH') && b!.texto().includes('3086 · 3GH'), { que: 'los cortes' });
        expect(b.texto()).toContain('Ejecutando importación');
    });

    it('siguiendo cualquier remesa de la división se ve la división entera', async () => {
        b = await armarBancoC1({ ruta: '/carga?seguir=153', sembrar: (bb) => division(bb) });
        await esperar(() => /Remesas terminadas: 0 de 5/.test(b!.texto()), { que: 'el resumen del grupo' });
        expect(b.texto()).toMatch(/Carga dividida: remesa 1 de 5/);
    });

    it('una carga sola: su progreso en el paso «Importando»', async () => {
        b = await armarBancoC1({
            ruta: '/carga?seguir=160',
            sembrar: (bb) => { bb.estados[160] = dtoC1({ remesaId: 160, numeroRemesa: '160', fase: 'PROCESANDO', estadoProceso: 'PROCESANDO', totalEsperado: 5000, procesadas: 1200, ok: 1200, err: 0, progreso: 24 }); },
        });
        await esperar(() => /Total: 5\.000/.test(b!.texto()), { que: 'el progreso de la carga' });
        expect(b.texto()).not.toMatch(/Carga dividida/);
    });

    it('si la división ya terminó, pasa directo a «Resultado»', async () => {
        b = await armarBancoC1({
            ruta: '/carga?seguir=150',
            sembrar: (bb) => {
                bb.totales.gt = 2;
                bb.estados[150] = terminalC1('OK', { remesaId: 150, numeroRemesa: '150', grupoId: 'gt', grupoOrden: 1, grupoTotal: 2 });
                bb.estados[151] = terminalC1('OK', { remesaId: 151, numeroRemesa: '151', grupoId: 'gt', grupoOrden: 2, grupoTotal: 2 });
            },
        });
        await esperar(() => /Resultado de la importación/.test(b!.texto()), { que: 'el resultado' });
    });

    it('una remesa que no existe avisa y deja el asistente en el principio', async () => {
        b = await armarBancoC1({ ruta: '/carga?seguir=999' });
        await esperar(() => /No existe/.test(document.body.textContent ?? ''), { que: 'el aviso de error' });
        expect(b.texto()).not.toMatch(/Ejecutando importación/);
    });
});
