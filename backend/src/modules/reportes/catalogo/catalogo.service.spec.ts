import { CatalogoService } from './catalogo.service';
import { NodoCatalogo } from '../dto/catalogo.dto';

/**
 * El catálogo sale del DMMF de Prisma, así que no hace falta base: se construye con el schema real.
 * Estos tests son sobre todo un cerco contra la vuelta del ruido — se había llenado de campos que
 * nadie podía usar y de ramas que eran la misma cosa vista desde otro lado.
 */
describe('CatalogoService — árbol de campos', () => {
  const service = new CatalogoService({} as any);
  let nodos: NodoCatalogo[];
  let paths: string[];
  let hojas: string[];

  beforeAll(async () => {
    nodos = await service.getCatalogo('deudor', 3);
    paths = [];
    hojas = [];
    const walk = (ns: NodoCatalogo[]) => {
      for (const n of ns) {
        paths.push(n.path);
        if (n.hijos) walk(n.hijos);
        else hojas.push(n.path);
      }
    };
    walk(nodos);
  });

  describe('lo que tiene que estar', () => {
    it('trae los campos con los que se arma cualquier reporte', () => {
      for (const p of ['documento', 'nroCliente', 'montoTotal', 'saldo', 'empresa.nombre',
        'remesa.numeroRemesa', 'estadoSituacion.clave', 'estadoGestion.descripcion',
        'contactos.valor', 'facturas.importe', 'pagos.fecha', 'convenios.cuotas.importe']) {
        expect(hojas).toContain(p);
      }
    });

    it('conserva las colecciones que cuelgan de otra colección: son del caso', () => {
      expect(paths).toContain('convenios.cuotas');
    });

    it('ofrece la política de la remesa, por id y por nombre', () => {
      // El id lo pide la base de Neotel; el nombre es el que se lee.
      expect(hojas).toContain('remesa.politicaId');
      expect(hojas).toContain('remesa.politica.nombre');
    });

    it('conserva quién hizo cada cosa', () => {
      expect(hojas).toContain('comentarios.usuario.nombre');
      expect(hojas).toContain('pagos.usuario.nombre');
    });
  });

  describe('lo que no tiene que estar', () => {
    it('no navega a una colección a través de una relación 1-1', () => {
      // "todas las llamadas del sistema que comparten el estado de gestión de este deudor"
      expect(paths).not.toContain('estadoGestion.llamadas');
      expect(paths.some(p => p.startsWith('estadoGestion.llamadas'))).toBe(false);
      // "todas las remesas de la empresa", que no son las del caso
      expect(paths.some(p => p.startsWith('empresa.remesa'))).toBe(false);
      expect(paths.some(p => p.includes('promesasComoAnterior'))).toBe(false);
    });

    it('no repite una rama que ya cuelga de la raíz', () => {
      expect(paths).not.toContain('remesa.empresa');
      expect(paths).not.toContain('transacciones.empresa');
      expect(paths).not.toContain('contactos.llamadas');
      expect(paths).not.toContain('llamadas.contacto');
    });

    it('no muestra claves foráneas: el dato está en la relación', () => {
      const fks = hojas.filter(p => /Id$/.test(p.split('.').pop() as string));
      // Salvo las declaradas como excepción, donde el id ES el dato que pide el sistema destino.
      expect(fks).toEqual(['remesa.politicaId']);
    });

    it('de los modelos de referencia solo trae lo que sirve', () => {
      // parametro tiene grupo, orden, activo, empresaId… nada de eso va a un reporte
      const parametro = hojas.filter(p => p.startsWith('estadoSituacion.'));
      expect(parametro.sort()).toEqual(['estadoSituacion.clave', 'estadoSituacion.descripcion']);
      const usuario = hojas.filter(p => p.startsWith('pagos.usuario.'));
      expect(usuario.sort()).toEqual(['pagos.usuario.email', 'pagos.usuario.nombre']);
    });

    it('no muestra la plomería de la importación ni los internals de Neotel', () => {
      for (const p of ['remesa.archivoHash', 'remesa.okFilas', 'remesa.estadoProceso',
        'llamadas.recordingUrl', 'llamadas.idContactoNeotel', 'llamadas.rawDataNeotel']) {
        expect(paths).not.toContain(p);
      }
    });

    it('se mantiene en un tamaño que una persona puede recorrer', () => {
      // Llegó a tener 388 campos elegibles, la mitad sin sentido desde un deudor.
      expect(hojas.length).toBeLessThan(150);
    });
  });

  describe('orden y explicaciones', () => {
    it('las ramas de primer nivel arrancan por la identificación del caso', () => {
      expect(nodos.slice(0, 5).map(n => n.nombre)).toEqual([
        'id', 'documento', 'nroCliente', 'nombre', 'apellido',
      ]);
    });

    it('la auditoría queda al final, después del historial', () => {
      expect(nodos[nodos.length - 1].nombre).toBe('transacciones');
    });

    it('los campos que no se entienden por el nombre traen su explicación', () => {
      const nodoDe = (path: string): NodoCatalogo | undefined => {
        let actual: NodoCatalogo | undefined;
        let nivel = nodos;
        for (const parte of path.split('.')) {
          actual = nivel.find(n => n.nombre === parte);
          if (!actual) return undefined;
          nivel = actual.hijos || [];
        }
        return actual;
      };
      expect(nodoDe('contactos.relacion')?.descripcion).toContain('CODEUDOR');
      expect(nodoDe('montoTotal')?.descripcion).toBeTruthy();
      expect(nodoDe('pagos.origen')?.descripcion).toContain('MANUAL');
      // Los que se explican solos no llevan descripción: sería ruido.
      expect(nodoDe('apellido')?.descripcion).toBeUndefined();
    });

    it('ningún campo se llama igual que su path técnico sin humanizar', () => {
      const sinLabel = paths.filter(p => {
        const nodo = p.split('.').reduce<NodoCatalogo | undefined>((acc, parte) => {
          const nivel = acc ? acc.hijos || [] : nodos;
          return nivel.find(n => n.nombre === parte);
        }, undefined);
        return nodo?.label === nodo?.nombre && /[A-Z]/.test(nodo?.nombre || '');
      });
      expect(sinLabel).toEqual([]);
    });
  });
});
