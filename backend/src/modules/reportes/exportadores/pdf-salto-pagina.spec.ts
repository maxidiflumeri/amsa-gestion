import { GroupingService } from '../executor/grouping.service';
import { PdfExportador } from './pdf.exportador';

/**
 * El switch "salto de página por grupo" del armador se guardaba en la plantilla y **no lo leía
 * nadie**: el PDF salía siempre como una sola tabla corrida.
 */
describe('PDF: salto de página por grupo', () => {
    const columnas = ['Empresa', 'DNI'];
    const filas = [
        { Empresa: 'A', DNI: '1' },
        { Empresa: 'A', DNI: '2' },
        { Empresa: 'B', DNI: '3' },
        { Empresa: 'C', DNI: '4' },
    ];

    const agrupar = (saltoPagina: boolean) =>
        new GroupingService().aplicarAgrupacionYTotales(
            filas, [{ path: 'Empresa', saltoPagina } as any], [], columnas,
        );

    /** Cuenta los objetos /Page del PDF generado. */
    const paginasDe = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

    it('la agrupación marca las cabeceras según la configuración', () => {
        const cabeceras = agrupar(true).filter((f) => f.tipo === 'cabecera');
        expect(cabeceras.length).toBe(3);
        expect(cabeceras.every((c) => c.saltoPagina)).toBe(true);
    });

    it('sin salto configurado, las cabeceras no quedan marcadas', () => {
        const cabeceras = agrupar(false).filter((f) => f.tipo === 'cabecera');
        expect(cabeceras.some((c) => c.saltoPagina)).toBe(false);
    });

    it('sin salto, los tres grupos entran en una sola página', async () => {
        const buf = await new PdfExportador().generar(agrupar(false), columnas, {});
        expect(paginasDe(buf)).toBe(1);
    });

    it('con salto, cada grupo arranca en su propia página', async () => {
        const buf = await new PdfExportador().generar(agrupar(true), columnas, {});
        expect(paginasDe(buf)).toBe(3);
    });

    it('no mete una hoja en blanco adelante del primer grupo', async () => {
        // El corte va *antes* de cada cabecera, así que la primera no debe cortar nada.
        const buf = await new PdfExportador().generar(agrupar(true), columnas, {});
        expect(paginasDe(buf)).toBe(3); // 3 grupos, no 4
    });

    it('un reporte sin agrupaciones sigue saliendo en una tabla', async () => {
        const buf = await new PdfExportador().generar(filas, columnas, {});
        expect(paginasDe(buf)).toBe(1);
    });
});
