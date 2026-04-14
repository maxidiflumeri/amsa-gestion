import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class GenericaFuente {
  private readonly logger = new Logger(GenericaFuente.name);

  constructor(private prisma: PrismaService) {}

  async ejecutar(fuente: string, filtrosFijos: any, filtrosVars: any, columnasConfig: any[]) {
    const filtros = { ...filtrosFijos, ...filtrosVars };
    const where: any = {};
    const include: any = {};

    this.logger.log(`Ejecutando fuente genérica ${fuente} con filtros: ${JSON.stringify(filtros)}`);

    // Inferir includes a partir de las columnas seleccionadas
    for (const col of columnasConfig) {
      if (col.campo.includes('.')) {
        const partes = col.campo.split('.');
        const rel = partes[0];
        // En Prisma simplificado, soportamos 1 nivel de relación por ahora
        if (!include[rel]) {
          include[rel] = true;
        }
      }
    }

    // Filtros genéricos (intentamos aplicarlos si el usuario seleccionó campos comunes)
    if (filtros.empresaIds?.length) {
       // Asumimos que la tabla tiene empresaId o intentamos anidarlo (esto dependerá fuertemente del esquema)
       // Para simplificar, aplicamos el spread.
       where.empresaId = { in: filtros.empresaIds };
    }
    
    if (filtros.remesasIds?.length) {
       where.remesaId = { in: filtros.remesasIds };
    }

    // Obtener datos vía cliente genérico
    // NOTA: en Prisma 5.x podemos usar `(this.prisma as any)[fuente]`
    const delegate = (this.prisma as any)[fuente];
    if (!delegate) {
      throw new Error(`Fuente ${fuente} no reconocida por el modelo de Prisma.`);
    }

    const queryInfo = {
      where: Object.keys(where).length > 0 ? where : undefined,
      include: Object.keys(include).length > 0 ? include : undefined,
    };

    let resultados = [];
    try {
      resultados = await delegate.findMany(queryInfo);
    } catch (e) {
      this.logger.error(`Error al ejecutar consulta genérica para ${fuente}: ${e.message}`);
      // Fallback si fallan los filtros (por ej. si tratamos de filtrar por empresaId pero no existe en la tabla)
      delete queryInfo.where;
      this.logger.log(`Intentando consulta genérica sin filtros Where específicos: ${fuente}`);
      resultados = await delegate.findMany(queryInfo);
    }

    this.logger.log(`Query genérica devolvió ${resultados.length} filas`);

    return resultados.map((d: any) => this.mapearFilaGenerica(d, columnasConfig));
  }

  private mapearFilaGenerica(d: any, columnas: any[]): Record<string, any> {
    const fila: Record<string, any> = {};
    for (const col of columnas) {
      const label = col.label || col.campo;
      
      if (col.campo.includes('.')) {
        const partes = col.campo.split('.');
        const rel = partes[0];
        const field = partes[1];
        fila[label] = d[rel] ? d[rel][field] : '';
        // Tratar fechas en el hijo
        if (fila[label] instanceof Date) {
          fila[label] = (fila[label] as Date).toLocaleDateString('es-AR');
        }
      } else {
        fila[label] = d[col.campo];
        // Tratar fechas
        if (fila[label] instanceof Date) {
          fila[label] = (fila[label] as Date).toLocaleDateString('es-AR');
        }
      }
      
      // Asegurar que no sea undefined/null inyectado
      if (fila[label] === undefined || fila[label] === null) {
        fila[label] = '';
      }
    }
    return fila;
  }
}
