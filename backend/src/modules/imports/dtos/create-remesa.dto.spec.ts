/**
 * Validación del DTO de creación de remesa.
 *
 * Existe por un bug concreto: al pasar el `numeroRemesa` a correlativo generado en el backend, el
 * frontend empezó a mandar el campo vacío, pero el DTO seguía con `@IsNotEmpty()` y la creación de
 * remesa reventaba con "numeroRemesa should not be empty" antes de llegar al servicio. Los tests
 * del correlativo no lo detectaron porque prueban la función pura, no el contrato HTTP.
 */
// Los decoradores de class-validator/class-transformer lo necesitan. En la app lo levanta NestJS
// desde el bootstrap; en jest hay que pedirlo explícitamente.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRemesaDto } from './import.dto';

/** Payload mínimo válido, tal como llega del wizard (multipart → todo string). */
const base = {
    empresaId: '1',
    nombre: 'Remesa de prueba',
    categoria: 'MULTIRREGISTRO',
    plantillaId: '3',
};

const validar = async (payload: Record<string, unknown>) =>
    validate(plainToInstance(CreateRemesaDto, payload));

describe('CreateRemesaDto — numeroRemesa', () => {
    it('acepta el numeroRemesa VACÍO (el backend genera el correlativo)', async () => {
        const errores = await validar({ ...base, numeroRemesa: '' });
        expect(errores.map((e) => e.property)).not.toContain('numeroRemesa');
    });

    it('acepta que el campo ni siquiera venga', async () => {
        const errores = await validar(base);
        expect(errores.map((e) => e.property)).not.toContain('numeroRemesa');
    });

    it('acepta un numeroRemesa escrito a mano', async () => {
        const errores = await validar({ ...base, numeroRemesa: '00042' });
        expect(errores.map((e) => e.property)).not.toContain('numeroRemesa');
    });

    it('sigue rechazando los campos que sí son obligatorios', async () => {
        const errores = await validar({ numeroRemesa: '00001' });
        const props = errores.map((e) => e.property);
        expect(props).toEqual(expect.arrayContaining(['nombre', 'categoria']));
    });
});
