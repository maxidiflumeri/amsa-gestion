import { Injectable, Logger } from '@nestjs/common';
import { CatalogoService } from '../../reportes/catalogo/catalogo.service';
import { normalizar } from '../adjuntos/perfil-ejemplo';
import { MAX_CLAVES_ADICIONALES } from './funcion-reportes';
import { PuertoDatosAdicionales } from './turno-reportes.runner';
import { VocabulariosService } from './vocabularios.service';

/** Las claves de datos adicionales de una empresa (herramienta `datos_adicionales`). Sobre una muestra de sus casos más nuevos. */
@Injectable()
export class DatosAdicionalesService implements PuertoDatosAdicionales {
    private readonly logger = new Logger(DatosAdicionalesService.name);

    constructor(
        private readonly catalogo: CatalogoService,
        private readonly vocabularios: VocabulariosService,
    ) {}

    async claves(empresa: string): Promise<{ ok: true; claves: string[] } | { ok: false; parecidas: string[] }> {
        await this.vocabularios.preparar();
        const todas = this.vocabularios.empresas();
        const e = todas.find((x) => x.nombre === empresa);
        if (!e) {
            const q = normalizar(empresa);
            const parecidas = todas
                .map((x) => ({ n: x.nombre, k: normalizar(x.nombre) }))
                .filter((x) => x.k.includes(q) || q.includes(x.k) || x.k.split(/\s+/).some((p) => p.length > 2 && q.includes(p)))
                .slice(0, 5)
                .map((x) => x.n);
            return { ok: false, parecidas };
        }
        const t0 = Date.now();
        const claves = await this.catalogo.getCamposAdicionalesKeys(e.id);
        this.logger.log(`Claves de datos adicionales leídas (empresa=${e.id}): ${claves.length} en ${Date.now() - t0}ms`);
        return { ok: true, claves: claves.slice(0, MAX_CLAVES_ADICIONALES) };
    }
}
