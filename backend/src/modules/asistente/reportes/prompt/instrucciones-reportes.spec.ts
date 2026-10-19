import { CAPACIDADES_TODAS } from '../tipos-reportes';
import { instruccionesReportes } from './instrucciones-reportes';

describe('instrucciones de reportes', () => {
    it('«más de 90 días» es hoy-91 (con hoy-90 se incluyen los de exactamente 90 días); «90 o más» es hoy-90', () => {
        const t = instruccionesReportes(CAPACIDADES_TODAS);
        expect(t).toContain('«Más de 90 días de mora» es `fechaVencimiento` `lte` `"hoy-91"`');
        expect(t).not.toContain('«Más de 90 días de mora» es `fechaVencimiento` `lte` `"hoy-90"`');
        expect(t).toContain('«90 días de mora o más» es `lte` `"hoy-90"`');
    });

    it('sin E1 no se habla de fechas relativas, y sin E4 no hay alineación', () => {
        const t = instruccionesReportes({ ...CAPACIDADES_TODAS, E1: false, E4: false });
        expect(t).not.toContain('hoy-91');
        expect(t).not.toContain('alineacion');
    });
});
