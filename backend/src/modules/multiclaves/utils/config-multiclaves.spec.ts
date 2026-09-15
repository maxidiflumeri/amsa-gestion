import { CONFIG_MULTICLAVES_DEFAULT, resolverConfigMulticlaves } from './config-multiclaves';

describe('resolverConfigMulticlaves', () => {
    it('sin configuracion.multiclaves, devuelve los defaults', () => {
        expect(resolverConfigMulticlaves(null)).toEqual(CONFIG_MULTICLAVES_DEFAULT);
        expect(resolverConfigMulticlaves({})).toEqual(CONFIG_MULTICLAVES_DEFAULT);
        expect(resolverConfigMulticlaves({ mora: { tasa: 5 } })).toEqual(CONFIG_MULTICLAVES_DEFAULT);
    });

    it('toma los valores válidos configurados', () => {
        const cfg = resolverConfigMulticlaves({
            multiclaves: {
                gestionAlGenerar: 'GES-099',
                leyendaTalonCedente: 'Otra leyenda',
                mediosDePago: ['PAGO FACIL'],
                templateCuponId: 7,
            },
        });
        expect(cfg).toEqual({
            templateCuponId: 7,
            gestionAlGenerar: 'GES-099',
            leyendaTalonCedente: 'Otra leyenda',
            mediosDePago: ['PAGO FACIL'],
        });
    });

    it('un gestionAlGenerar con forma inválida cae al default (no bloquea el cupón por un typo)', () => {
        const cfg = resolverConfigMulticlaves({ multiclaves: { gestionAlGenerar: 'convenio_acordado' } });
        expect(cfg.gestionAlGenerar).toBe('GES-050');
    });

    it('mediosDePago vacío o con basura cae al default', () => {
        expect(resolverConfigMulticlaves({ multiclaves: { mediosDePago: [] } }).mediosDePago).toEqual(
            CONFIG_MULTICLAVES_DEFAULT.mediosDePago,
        );
        expect(resolverConfigMulticlaves({ multiclaves: { mediosDePago: [1, 2] } }).mediosDePago).toEqual(
            CONFIG_MULTICLAVES_DEFAULT.mediosDePago,
        );
    });

    it('no pisa la config de mora: solo lee la clave multiclaves', () => {
        const configuracion = { mora: { tasa: 5 }, multiclaves: { gestionAlGenerar: 'GES-050' } };
        resolverConfigMulticlaves(configuracion);
        expect(configuracion.mora).toEqual({ tasa: 5 }); // lectura pura, no muta nada
    });
});
