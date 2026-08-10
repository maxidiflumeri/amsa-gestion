import { validarArchivosHomogeneos } from './archivos-homogeneos';

/** Archivo de multer con el contenido dado. */
const f = (originalname: string, contenido = 'cod;nombre\n001;PEREZ\n') => ({
    originalname,
    buffer: Buffer.from(contenido, 'latin1'),
});

describe('validarArchivosHomogeneos', () => {
    it('no dice nada de un lote válido', () => {
        expect(() => validarArchivosHomogeneos([f('suc003.txt'), f('suc006.txt')])).not.toThrow();
    });

    it('no valida nada con un solo archivo: es el caso clásico', () => {
        expect(() => validarArchivosHomogeneos([f('cartera.csv')])).not.toThrow();
        expect(() => validarArchivosHomogeneos([])).not.toThrow();
    });

    it('rechaza el mismo archivo subido dos veces, que duplicaría sus filas', () => {
        expect(() => validarArchivosHomogeneos([f('suc003.txt'), f('suc003.txt')]))
            .toThrow(/repetidos.*suc003\.txt/s);
    });

    it('rechaza mezclar Excel con archivos de texto', () => {
        expect(() => validarArchivosHomogeneos([f('cartera.xlsx'), f('suc003.txt')]))
            .toThrow(/mezcla planillas de Excel/);
    });

    it('acepta varios Excel juntos sin mirarles el contenido', () => {
        expect(() => validarArchivosHomogeneos([f('a.xlsx', 'binario'), f('b.xls', 'otro binario')]))
            .not.toThrow();
    });

    it('rechaza un archivo con otro encabezado, nombrando los dos', () => {
        // El caso real: colar un TXT de partidas entre los de cuentas.
        expect(() => validarArchivosHomogeneos([
            f('AGAEJ0_cuentas_003.txt', 'Of. Cobro División\n9000001028003\n'),
            f('AGAEJ0_partidas_003.txt', 'F. Proc.  Of. Cobro\n21.06.20269000001028\n'),
        ])).toThrow(/"AGAEJ0_partidas_003.txt".*"AGAEJ0_cuentas_003.txt"/s);
    });

    it('no compara encabezados si la plantilla dice que no hay', () => {
        // Sin encabezado la primera línea es un dato y difiere legítimamente entre archivos.
        expect(() => validarArchivosHomogeneos(
            [f('a.txt', '001;PEREZ\n'), f('b.txt', '002;GOMEZ\n')],
            { tieneHeader: false },
        )).not.toThrow();
    });

    it('compara encabezados cuando la plantilla no lo aclara', () => {
        expect(() => validarArchivosHomogeneos([f('a.txt', 'cod;nombre\n'), f('b.txt', 'otro;header\n')]))
            .toThrow(/encabezado distinto/);
    });

    it('ignora las líneas en blanco antes del encabezado', () => {
        expect(() => validarArchivosHomogeneos([
            f('a.txt', '\ncod;nombre\n001;PEREZ\n'),
            f('b.txt', 'cod;nombre\n002;GOMEZ\n'),
        ])).not.toThrow();
    });

    it('compara el encabezado byte a byte, sin decodificar mal los acentos', () => {
        // Los TXT del cedente vienen en Latin-1: leerlos como UTF-8 convertiría las Ñ de los dos
        // archivos en el mismo carácter de reemplazo y taparía una diferencia real.
        expect(() => validarArchivosHomogeneos([
            f('a.txt', 'Año;Sección\n'),
            f('b.txt', 'Ano;Seccion\n'),
        ])).toThrow(/encabezado distinto/);
    });
});
