import { Injectable } from '@nestjs/common';

/**
 * Cuántas pruebas contra la base corren a la vez en todo el backend (docs/asistente-reportes-spec.md §7.6). Hay una sola
 * instancia del backend, así que alcanza con memoria. Quien no consigue lugar en `esperaMs` se rinde.
 */
@Injectable()
export class SemaforoReportes {
    private libres: number;
    private readonly cola: (() => void)[] = [];

    constructor(cupos = 2) {
        this.libres = cupos;
    }

    /** Devuelve la función que libera el lugar, o null si no hubo lugar a tiempo. */
    async adquirir(esperaMs: number): Promise<(() => void) | null> {
        if (this.libres > 0) {
            this.libres--;
            return this.liberador();
        }
        return new Promise((resolver) => {
            const espera = () => {
                clearTimeout(timer);
                resolver(this.liberador());
            };
            const timer = setTimeout(() => {
                const i = this.cola.indexOf(espera);
                if (i >= 0) this.cola.splice(i, 1);
                resolver(null);
            }, esperaMs);
            this.cola.push(espera);
        });
    }

    private liberador(): () => void {
        let hecho = false;
        return () => {
            if (hecho) return;
            hecho = true;
            const siguiente = this.cola.shift();
            if (siguiente) siguiente();
            else this.libres++;
        };
    }
}
