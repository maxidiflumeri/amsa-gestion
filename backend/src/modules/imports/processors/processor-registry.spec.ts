import { getProcessor, getSupportedCategories } from './processor-registry';

/**
 * El registry es lo que conecta la categoría de la remesa con su processor, y también lo que
 * alimenta el combo de categorías del frontend (`getCategories()`). Un processor sin registrar
 * queda como código muerto que nadie nota; una categoría registrada sin su valor en el enum de
 * Prisma deja elegir algo que la DB no puede guardar. Estos tests cubren el primer caso.
 */
describe('processor-registry', () => {
    const CATEGORIAS = [
        'DEUDORES', 'FACTURAS', 'PAGOS', 'CONTACTOS', 'ENRIQUECIMIENTO',
        'DEUDORES_Y_FACTURAS', 'ACTUALIZACIONES', 'ACCIONES',
        'MULTIRREGISTRO', 'MULTIARCHIVO',
    ];

    it.each(CATEGORIAS)('resuelve el processor de %s', (categoria) => {
        expect(getProcessor(categoria).category).toBe(categoria);
    });

    it('expone exactamente esas categorías al frontend', () => {
        expect(getSupportedCategories().sort()).toEqual([...CATEGORIAS].sort());
    });

    it('falla claro con una categoría desconocida', () => {
        expect(() => getProcessor('INEXISTENTE')).toThrow(/no soportada/);
    });

    it('las dos carteras de Toyota usan processors distintos pese a compartir la lógica', () => {
        expect(getProcessor('MULTIRREGISTRO')).not.toBe(getProcessor('MULTIARCHIVO'));
    });
});
