import { Injectable } from '@nestjs/common';

/**
 * Un turno por persona (docs/asistente-spec.md §7.4.6). Hay una sola instancia de backend, así que alcanza con un
 * `Map` en memoria; si algún día hay dos, pasar a `SET NX EX 120` en Redis.
 */
@Injectable()
export class TurnosActivos {
    private readonly activos = new Map<number, AbortController>();

    /** Toma el turno de esta persona. Devuelve su `AbortController`, o null si ya tiene uno en curso. */
    tomar(usuarioId: number): AbortController | null {
        if (this.activos.has(usuarioId)) return null;
        const ac = new AbortController();
        this.activos.set(usuarioId, ac);
        return ac;
    }

    /** Libera solo si el turno es ese (un `finally` tardío no libera el turno de otro). */
    liberar(usuarioId: number, ac: AbortController): void {
        if (this.activos.get(usuarioId) === ac) this.activos.delete(usuarioId);
    }

    cantidad(): number {
        return this.activos.size;
    }
}
