import {
    PREFIJO_SIN_DNI,
    placeholderDocumento,
    esDocumentoPlaceholder,
    documentoDeFila,
} from './documento';
import { MappedRow } from '../processors/processor.interface';

describe('utils/documento', () => {
    describe('placeholderDocumento', () => {
        it('genera un placeholder estable a partir del nroCliente', () => {
            expect(placeholderDocumento('12345')).toBe(`${PREFIJO_SIN_DNI}12345`);
        });
        it('trimea el nroCliente', () => {
            expect(placeholderDocumento('  99 ')).toBe(`${PREFIJO_SIN_DNI}99`);
        });
        it('es determinístico (misma entrada → misma salida)', () => {
            expect(placeholderDocumento('7')).toBe(placeholderDocumento('7'));
        });
    });

    describe('esDocumentoPlaceholder', () => {
        it('true para un placeholder', () => {
            expect(esDocumentoPlaceholder('SIN-DNI-42')).toBe(true);
        });
        it('false para un DNI real', () => {
            expect(esDocumentoPlaceholder('30111222')).toBe(false);
        });
        it('false para null/undefined/vacío', () => {
            expect(esDocumentoPlaceholder(null)).toBe(false);
            expect(esDocumentoPlaceholder(undefined)).toBe(false);
            expect(esDocumentoPlaceholder('')).toBe(false);
        });
    });

    describe('documentoDeFila', () => {
        it('usa el DNI del archivo si viene', () => {
            const row: MappedRow = { documento: ' 30111222 ', nro_cliente: '5' };
            expect(documentoDeFila(row)).toBe('30111222');
        });
        it('usa el placeholder desde nro_cliente si no hay DNI', () => {
            const row: MappedRow = { documento: '', nro_cliente: '5' };
            expect(documentoDeFila(row)).toBe(`${PREFIJO_SIN_DNI}5`);
        });
        it('toma nro_cliente desde camposAdicionales (plantillas viejas)', () => {
            const row: MappedRow = { camposAdicionales: { nro_cliente: '77' } };
            expect(documentoDeFila(row)).toBe(`${PREFIJO_SIN_DNI}77`);
        });
        it('devuelve "" si no hay ni DNI ni nro_cliente', () => {
            const row: MappedRow = { nombre: 'Juan' };
            expect(documentoDeFila(row)).toBe('');
        });
    });
});
