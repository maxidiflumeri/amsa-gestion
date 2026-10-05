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
import { MulticlavesProcessor } from './multiclaves.processor';

/**
 * Registro de procesadores por categoría.
 * Para agregar una nueva categoría, basta con crear un procesador
 * que implemente ICategoryProcessor y registrar acá su fábrica.
 *
 * Se guardan **fábricas** y no instancias: los processors guardan estado en campos de instancia
 * (deudores tocados, contadores, cachés) y lo limpian con un `reset()` al final de `afterAll`. Si una
 * carga falla o su `afterAll` tira, ese `reset()` no corre; con una instancia compartida la carga
 * siguiente de la misma categoría arrastraba el estado de la anterior. Con una instancia nueva por
 * carga eso no puede pasar. Los constructores no reciben argumentos ni hacen IO.
 */
const fabricas: Array<() => ICategoryProcessor> = [
    () => new DeudoresProcessor(),
    () => new FacturasProcessor(),
    () => new PagosProcessor(),
    () => new ContactosProcessor(),
    () => new EnriquecimientoProcessor(),
    () => new DeudoresYFacturasProcessor(),
    () => new ActualizacionesProcessor(),
    () => new AccionesProcessor(),
    () => new MultirregistroProcessor(),
    () => new MultiarchivoProcessor(),
    () => new MulticlavesProcessor(),
];

const registry = new Map<string, () => ICategoryProcessor>();
for (const fabrica of fabricas) {
    // Una instancia de muestra para leer la categoría; no se reusa.
    registry.set(fabrica().category, fabrica);
}

/**
 * Obtiene un procesador **nuevo** para una categoría dada (uno por carga).
 * @throws Error si la categoría no está soportada.
 */
export function getProcessor(category: string): ICategoryProcessor {
    const fabrica = registry.get(category);
    if (!fabrica) {
        throw new Error(`Categoría de importación no soportada: ${category}`);
    }
    return fabrica();
}

/**
 * Lista de categorías soportadas (para validación del frontend).
 */
export function getSupportedCategories(): string[] {
    return Array.from(registry.keys());
}
