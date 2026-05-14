import { NeotelInvalidResponseError } from '../errors/neotel.errors';

/**
 * Parsea las respuestas XML mínimas de la API ASMX de Neotel.
 *
 * Formatos observados:
 *   void:    (cuerpo vacío o solo whitespace)
 *   string:  <?xml ...?><string xmlns="...">valor</string>
 *   boolean: <?xml ...?><boolean xmlns="...">true</boolean>
 */
export class XmlResponseParser {
    static parseVoid(_xml: string): void {
        return;
    }

    static parseString(xml: string): string {
        const trimmed = xml.trim();
        if (!trimmed) return '';

        // <string xmlns="...">contenido</string>  (con o sin namespace)
        const match = trimmed.match(/<string(?:[^>]*)>([\s\S]*?)<\/string>/i);
        if (match) return match[1];

        // Respuesta plana sin wrapper XML (algunos endpoints de Neotel devuelven texto plano)
        // Heurística: si no contiene '<', devolver directamente
        if (!trimmed.includes('<')) return trimmed;

        throw new NeotelInvalidResponseError(xml);
    }

    static parseBoolean(xml: string): boolean {
        const trimmed = xml.trim();

        const match = trimmed.match(/<boolean(?:[^>]*)>(true|false)<\/boolean>/i);
        if (match) return match[1].toLowerCase() === 'true';

        // Respuesta plana
        if (trimmed === 'true') return true;
        if (trimmed === 'false') return false;

        throw new NeotelInvalidResponseError(xml);
    }

    static parse<T>(xml: string, expects: 'void' | 'string' | 'boolean'): T {
        switch (expects) {
            case 'void':    return this.parseVoid(xml) as T;
            case 'string':  return this.parseString(xml) as T;
            case 'boolean': return this.parseBoolean(xml) as T;
        }
    }
}
