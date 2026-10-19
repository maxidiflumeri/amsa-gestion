import { CatalogoService } from '../../../reportes/catalogo/catalogo.service';
import { MODELOS_BLOQUEADOS, NOMBRE_SENSIBLE } from '../../../reportes/validador/campos-sensibles';
import { catalogoCompacto, esVisibleParaElModelo, nodosVisibles } from './catalogo-compacto';

const servicio = new CatalogoService(null as never);

describe('catálogo compacto', () => {
    let nodos: Awaited<ReturnType<CatalogoService['getCatalogo']>>;
    beforeAll(async () => {
        nodos = await servicio.getCatalogo('deudor', 3);
    });

    it('es determinista: dos armados iguales, byte a byte', async () => {
        const otro = await new CatalogoService(null as never).getCatalogo('deudor', 3);
        expect(catalogoCompacto(otro)).toBe(catalogoCompacto(nodos));
    });

    it('una línea por nodo visible, más la línea de leyenda', () => {
        const lineas = catalogoCompacto(nodos).split('\n');
        expect(lineas).toHaveLength(nodosVisibles(nodos).length + 1);
    });

    it('no incluye remesa.filtroFilas ni remesa.divisionValores', () => {
        const t = catalogoCompacto(nodos);
        expect(t).not.toContain('remesa.filtroFilas');
        expect(t).not.toContain('remesa.divisionValores');
    });

    it('no incluye lo que campos-sensibles.ts bloquea', () => {
        const paths = nodosVisibles(nodos).map((n) => n.path);
        for (const p of paths) {
            for (const seg of p.split('.')) expect(NOMBRE_SENSIBLE.test(seg)).toBe(false);
        }
        const t = catalogoCompacto(nodos);
        expect(t).not.toMatch(/sipPassword|googleId|agenteTelefonia|\.dni\b/);
        for (const m of MODELOS_BLOQUEADOS) expect(esVisibleParaElModelo(m)).toBe(false);
    });

    it('de un usuario solo se ve quién es', () => {
        const usuario = nodosVisibles(nodos).filter((n) => /(^|\.)usuario\./.test(n.path)).map((n) => n.path.split('.').pop());
        for (const campo of usuario) expect(['id', 'nombre', 'email']).toContain(campo);
    });

    it('trae lo que el modelo necesita para la maqueta', () => {
        const t = catalogoCompacto(nodos);
        for (const p of ['documento', 'saldo', 'fechaVencimiento', 'empresa.nombre', 'estadoSituacion.descripcion', 'contactos.valor', 'pagos.importe', 'promesas.estado']) {
            expect(t).toContain(`\n${p} [`);
        }
    });

    it('el tamaño es chico (cabe entero en el system cacheado)', () => {
        const largo = catalogoCompacto(nodos).length;
        expect(largo).toBeGreaterThan(5_000);
        expect(largo).toBeLessThan(30_000);
    });
});

describe('descripciones propias del asistente', () => {
    it('referenciaClave e idExterno se distinguen', async () => {
        const t = catalogoCompacto(await new CatalogoService(null as never).getCatalogo('deudor', 3));
        expect(t).toMatch(/\npagos\.referenciaClave \[.*NO es un ID de operación/);
        expect(t).toMatch(/\npagos\.idExterno \[.*PAYMENT_ID/);
    });
});
