// processors/processor-registry.ts
import { ICategoryProcessor } from './processor.interface';
import { DeudoresProcessor } from './deudores.processor';
import { FacturasProcessor } from './facturas.processor';
import { PagosProcessor } from './pagos.processor';
import { ContactosProcessor } from './contactos.processor';
import { EnriquecimientoProcessor } from './enriquecimiento.processor';
import { DeudoresYFacturasProcessor } from './deudores-facturas.processor';
import { ActualizacionesProcessor } from './actualizaciones.processor';
import { AccionesProcessor } from './acciones.processor';
import { MultirregistroProcessor } from './multirregistro.processor';
import { MultiarchivoProcessor } from './multiarchivo.processor';

/**
 * Registro de procesadores por categoría.
 * Para agregar una nueva categoría, basta con crear un procesador
 * que implemente ICategoryProcessor y registrarlo acá.
 */
const processors: ICategoryProcessor[] = [
    new DeudoresProcessor(),
    new FacturasProcessor(),
    new PagosProcessor(),
    new ContactosProcessor(),
    new EnriquecimientoProcessor(),
    new DeudoresYFacturasProcessor(),
    new ActualizacionesProcessor(),
    new AccionesProcessor(),
    new MultirregistroProcessor(),
    new MultiarchivoProcessor(),
];

const registry = new Map<string, ICategoryProcessor>();
for (const p of processors) {
    registry.set(p.category, p);
}

/**
 * Obtiene el procesador para una categoría dada.
 * @throws Error si la categoría no está soportada.
 */
export function getProcessor(category: string): ICategoryProcessor {
    const proc = registry.get(category);
    if (!proc) {
        throw new Error(`Categoría de importación no soportada: ${category}`);
    }
    return proc;
}

/**
 * Lista de categorías soportadas (para validación del frontend).
 */
export function getSupportedCategories(): string[] {
    return Array.from(registry.keys());
}
