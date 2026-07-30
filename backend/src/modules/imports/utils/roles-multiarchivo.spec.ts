import { resolverRolesArchivos } from './roles-multiarchivo';
import { TOYOTA_TCFA_MULTIARCHIVO as CFG } from '../plantillas/toyota-tcfa';

const f = (...nombres: string[]) => nombres.map((originalname) => ({ originalname }));

describe('resolverRolesArchivos', () => {
    it('reconoce el paquete completo sin importar el orden en que se subió', () => {
        expect(resolverRolesArchivos(
            f('CoDeudores.txt', 'Bajas.txt', 'DetalleDeuda.txt', 'Deudores.txt'), CFG,
        )).toEqual({ codeudores: 0, bajas: 1, detalle: 2, deudores: 3 });
    });

    it('acepta los archivos obligatorios solos', () => {
        expect(resolverRolesArchivos(f('Deudores.txt', 'DetalleDeuda.txt'), CFG))
            .toEqual({ deudores: 0, detalle: 1 });
    });

    it('tolera sufijos de fecha del cedente', () => {
        // Si mañana empiezan a mandar `Deudores_20260529.txt` no hay que tocar código.
        expect(resolverRolesArchivos(f('Deudores_20260529.txt', 'DetalleDeuda_20260529.txt'), CFG))
            .toEqual({ deudores: 0, detalle: 1 });
    });

    it('no confunde CoDeudores con Deudores', () => {
        // El patrón `^Deudores` está anclado justamente por esto: cargar los 55 codeudores como si
        // fueran deudores generaría casos basura y pisaría la deuda de la cartera.
        const r = resolverRolesArchivos(f('Deudores.txt', 'DetalleDeuda.txt', 'CoDeudores.txt'), CFG);
        expect(r.deudores).toBe(0);
        expect(r.codeudores).toBe(2);
    });

    it('ignora el path completo que mandan algunos navegadores', () => {
        expect(resolverRolesArchivos(f('C:\\Users\\maxi\\Deudores.txt', '/tmp/DetalleDeuda.txt'), CFG))
            .toEqual({ deudores: 0, detalle: 1 });
    });

    it('encuentra los archivos sin distinguir mayúsculas', () => {
        expect(resolverRolesArchivos(f('DEUDORES.TXT', 'detalledeuda.txt'), CFG))
            .toEqual({ deudores: 0, detalle: 1 });
    });
});

describe('resolverRolesArchivos — errores accionables', () => {
    it('avisa qué archivo obligatorio falta', () => {
        expect(() => resolverRolesArchivos(f('Deudores.txt', 'Bajas.txt'), CFG))
            .toThrow(/Falta el archivo de detalle de deuda/);
        expect(() => resolverRolesArchivos(f('DetalleDeuda.txt'), CFG))
            .toThrow(/Falta el archivo de deudores/);
    });

    it('nombra el archivo que no pudo clasificar en vez de ignorarlo', () => {
        // Ignorarlo en silencio haría un import a medias que parece exitoso.
        expect(() => resolverRolesArchivos(f('Deudores.txt', 'DetalleDeuda.txt', 'Pagos.txt'), CFG))
            .toThrow(/"Pagos.txt"/);
    });

    it('rechaza dos archivos para el mismo rol nombrando a los dos', () => {
        expect(() => resolverRolesArchivos(f('Deudores.txt', 'Deudores (1).txt', 'DetalleDeuda.txt'), CFG))
            .toThrow(/dos archivos para el rol "deudores".*Deudores\.txt.*Deudores \(1\)\.txt/s);
    });

    it('rechaza un patrón ambiguo de la plantilla en vez de adivinar', () => {
        // `Deudores` sin anclar también matchea `CoDeudores.txt`.
        const ambigua = { ...CFG, archivos: { ...CFG.archivos, deudores: 'Deudores' } };
        expect(() => resolverRolesArchivos(f('CoDeudores.txt', 'DetalleDeuda.txt'), ambigua))
            .toThrow(/matchea más de un rol/);
    });

    it('avisa si el patrón de la plantilla no es un regex válido', () => {
        const rota = { ...CFG, archivos: { ...CFG.archivos, deudores: '^Deudores[' } };
        expect(() => resolverRolesArchivos(f('Deudores.txt'), rota))
            .toThrow(/no es una expresión regular válida/);
    });

    it('avisa si no se subió nada o si la plantilla no declara patrones', () => {
        expect(() => resolverRolesArchivos([], CFG)).toThrow(/No se subió ningún archivo/);
        expect(() => resolverRolesArchivos(f('Deudores.txt'), { ...CFG, archivos: {} as any }))
            .toThrow(/no declara los patrones/);
    });
});
