import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class ReportesService {
  private readonly logger = new Logger(ReportesService.name);

  constructor(private prisma: PrismaService) {}

  // ── Plantillas ───────────────────────────────────────────────────────────

  async findAllPlantillas(empresaId?: number) {
    return this.prisma.plantilla_reporte.findMany({
      where: {
        activo: true,
        ...(empresaId !== undefined
          ? { OR: [{ empresaId: null }, { empresaId }] }
          : {}),
      },
      include: { empresa: { select: { id: true, nombre: true } } },
      orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }],
    });
  }

  async findOnePlantilla(id: number) {
    const p = await this.prisma.plantilla_reporte.findUnique({
      where: { id },
      include: { empresa: { select: { id: true, nombre: true } }, ejecuciones: { take: 5, orderBy: { createdAt: 'desc' }, include: { usuario: { select: { nombre: true } } } } },
    });
    if (!p) throw new NotFoundException('Plantilla no encontrada');
    return p;
  }

  async createPlantilla(data: any) {
    this.logger.log(`Creando plantilla: ${data.nombre}`);
    return this.prisma.plantilla_reporte.create({ data });
  }

  async updatePlantilla(id: number, data: any) {
    await this.findOnePlantilla(id);
    this.logger.log(`Actualizando plantilla ${id}`);
    return this.prisma.plantilla_reporte.update({ where: { id }, data });
  }

  async deletePlantilla(id: number) {
    await this.findOnePlantilla(id);
    this.logger.log(`Desactivando plantilla ${id}`);
    return this.prisma.plantilla_reporte.update({ where: { id }, data: { activo: false } });
  }

  // ── Formatos de teléfono ─────────────────────────────────────────────────

  async findAllFormatosTel() {
    return this.prisma.formato_telefono.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } });
  }

  async createFormatoTel(data: { nombre: string; descripcion?: string; patron: string }) {
    this.logger.log(`Creando formato de teléfono: ${data.nombre}`);
    return this.prisma.formato_telefono.create({ data });
  }

  // ── Fuentes y Columnas dinámicas ──────────────────────────────────────────────────

  getFuentesDisponibles() {
    const customFuentes = [
      { id: 'deudores', nombre: 'Deudores (Principal)' },
      { id: 'comentarios', nombre: 'Comentarios' },
      { id: 'pagos', nombre: 'Pagos' },
      { id: 'convenios', nombre: 'Convenios' },
    ];
    
    // Obtener modelos de Prisma, ignorando los que ya tienen fuente personalizada avanzada
    const ignorar = ['deudor', 'comentario', 'pago', 'convenio'];
    const prismaModels = Prisma.dmmf.datamodel.models
      .filter(m => !ignorar.includes(m.name))
      .map(m => ({
        id: m.name,
        nombre: m.name.charAt(0).toUpperCase() + m.name.slice(1)
      }));

    // Fusionar
    const combined = [...customFuentes, ...prismaModels];
    const unique = Array.from(new Map(combined.map(item => [item.id, item])).values());
    
    return unique; // Opcional: sort((a, b) => a.nombre.localeCompare(b.nombre))
  }

  getColumnasDisponibles(fuente: string) {
    const mapa: Record<string, { campo: string; label: string; tipo: string }[]> = {
      deudores: [
        { campo: 'documento', label: 'Documento', tipo: 'texto' },
        { campo: 'nombre', label: 'Nombre', tipo: 'texto' },
        { campo: 'apellido', label: 'Apellido', tipo: 'texto' },
        { campo: 'montoTotal', label: 'Monto Total', tipo: 'numero' },
        { campo: 'fechaVencimiento', label: 'Fecha Vencimiento', tipo: 'fecha' },
        { campo: 'empresa.nombre', label: 'Empresa', tipo: 'texto' },
        { campo: 'remesa.nombre', label: 'Remesa', tipo: 'texto' },
        { campo: 'remesa.numeroRemesa', label: 'Nro Remesa', tipo: 'texto' },
        { campo: 'estadoSituacion.descripcion', label: 'Situación', tipo: 'texto' },
        { campo: 'estadoGestion.descripcion', label: 'Gestión', tipo: 'texto' },
        { campo: 'motivoNoPago.descripcion', label: 'Motivo No Pago', tipo: 'texto' },
        { campo: 'contacto.telefono', label: 'Teléfono', tipo: 'telefono' },
        { campo: 'contacto.whatsapp', label: 'WhatsApp', tipo: 'telefono' },
        { campo: 'contacto.email', label: 'Email', tipo: 'texto' },
      ],
      comentarios: [
        { campo: 'deudor.documento', label: 'Documento', tipo: 'texto' },
        { campo: 'deudor.nombre', label: 'Nombre', tipo: 'texto' },
        { campo: 'deudor.apellido', label: 'Apellido', tipo: 'texto' },
        { campo: 'fecha', label: 'Fecha', tipo: 'fecha' },
        { campo: 'texto', label: 'Comentario', tipo: 'texto' },
        { campo: 'usuario.nombre', label: 'Gestor', tipo: 'texto' },
        { campo: 'origen', label: 'Origen', tipo: 'texto' },
      ],
      pagos: [
        { campo: 'deudor.documento', label: 'Documento', tipo: 'texto' },
        { campo: 'deudor.nombre', label: 'Nombre', tipo: 'texto' },
        { campo: 'deudor.apellido', label: 'Apellido', tipo: 'texto' },
        { campo: 'deudor.empresa.nombre', label: 'Empresa', tipo: 'texto' },
        { campo: 'fecha', label: 'Fecha de Pago', tipo: 'fecha' },
        { campo: 'importe', label: 'Importe', tipo: 'numero' },
        { campo: 'origenArchivo', label: 'Origen', tipo: 'texto' },
        { campo: 'observacion', label: 'Observación', tipo: 'texto' },
      ],
      convenios: [
        { campo: 'deudor.documento', label: 'Documento', tipo: 'texto' },
        { campo: 'deudor.nombre', label: 'Nombre', tipo: 'texto' },
        { campo: 'deudor.apellido', label: 'Apellido', tipo: 'texto' },
        { campo: 'deudor.empresa.nombre', label: 'Empresa', tipo: 'texto' },
        { campo: 'tipo', label: 'Tipo', tipo: 'texto' },
        { campo: 'estado', label: 'Estado', tipo: 'texto' },
        { campo: 'montoTotal', label: 'Monto Total', tipo: 'numero' },
        { campo: 'cantCuotas', label: 'Cant. Cuotas', tipo: 'numero' },
        { campo: 'montoCuota', label: 'Monto Cuota', tipo: 'numero' },
        { campo: 'fechaInicio', label: 'Fecha Inicio', tipo: 'fecha' },
      ],
    };

    if (mapa[fuente]) {
      return mapa[fuente];
    }

    // Análisis dinámico mediante DMMF
    const modeloBase = Prisma.dmmf.datamodel.models.find(m => m.name === fuente);
    if (!modeloBase) {
      return [];
    }

    const mapPrismaType = (prismaType: string) => {
      if (['Int', 'Float', 'Decimal'].includes(prismaType)) return 'numero';
      if (['DateTime'].includes(prismaType)) return 'fecha';
      if (['Boolean'].includes(prismaType)) return 'boolean';
      return 'texto';
    };

    const columnas: { campo: string; label: string; tipo: string }[] = [];

    for (const field of modeloBase.fields) {
      if (field.kind === 'scalar' || field.kind === 'enum') {
        columnas.push({
          campo: field.name,
          label: field.name.charAt(0).toUpperCase() + field.name.slice(1),
          tipo: mapPrismaType(field.type),
        });
      } else if (field.kind === 'object' && !field.isList) {
        // Relación x-a-uno: traer campos escalares
        const modelRel = Prisma.dmmf.datamodel.models.find(m => m.name === field.type);
        if (modelRel) {
          for (const relField of modelRel.fields) {
            if (relField.kind === 'scalar' || relField.kind === 'enum') {
              columnas.push({
                campo: `${field.name}.${relField.name}`,
                label: `${field.name} - ${relField.name}`,
                tipo: mapPrismaType(relField.type),
              });
            }
          }
        }
      }
    }

    return columnas;
  }

  async getCamposExtra(empresaId?: number) {
    let result: any[];
    if (empresaId) {
      result = await this.prisma.$queryRaw`SELECT DISTINCT JSON_KEYS(camposAdicionales) as keys_arr FROM deudor WHERE empresaId = ${empresaId} AND camposAdicionales IS NOT NULL`;
    } else {
      result = await this.prisma.$queryRaw`SELECT DISTINCT JSON_KEYS(camposAdicionales) as keys_arr FROM deudor WHERE camposAdicionales IS NOT NULL`;
    }

    const set = new Set<string>();
    result.forEach((row: any) => {
      try {
        const keys = typeof row.keys_arr === 'string' ? JSON.parse(row.keys_arr) : row.keys_arr;
        if (Array.isArray(keys)) keys.forEach(k => set.add(k));
      } catch (e) {}
    });

    return Array.from(set).sort();
  }

  // ── Estadísticas de remesa ───────────────────────────────────────────────

  async estadisticasRemesa(remesaId: number) {
    this.logger.log(`Calculando estadísticas para remesa ${remesaId}`);

    const [deudores, pagos, convenios] = await Promise.all([
      this.prisma.deudor.findMany({
        where: { remesaId },
        include: { estadoSituacion: true, estadoGestion: true, motivoNoPago: true },
      }),
      this.prisma.pago.findMany({
        where: { deudor: { remesaId } },
      }),
      this.prisma.convenio.findMany({
        where: { deudor: { remesaId } },
        include: { cuotas: true },
      }),
    ]);

    const totalCasos = deudores.length;
    const montoTotal = deudores.reduce((s, d) => s + (d.montoTotal || 0), 0);
    const totalPagado = pagos.reduce((s, p) => s + p.importe, 0);
    const porcentajeCobro = montoTotal > 0 ? (totalPagado / montoTotal) * 100 : 0;

    // Agrupar por situación
    const porSituacion = agrupar(deudores, d => d.estadoSituacion?.descripcion || 'Sin situación', totalCasos);
    const porGestion = agrupar(deudores, d => d.estadoGestion?.descripcion || 'Sin gestión', totalCasos);
    const porMotivoNoPago = agrupar(
      deudores.filter(d => d.motivoNoPago),
      d => d.motivoNoPago!.descripcion,
      totalCasos,
    );

    const convenioStats = {
      activos: convenios.filter(c => c.estado === 'ACTIVO').length,
      cumplidos: convenios.filter(c => c.estado === 'FINALIZADO').length,
      incumplidos: convenios.filter(c => c.estado === 'INCUMPLIDO').length,
      montoRecuperado: convenios
        .flatMap(c => c.cuotas)
        .filter(q => q.estado === 'PAGADA')
        .reduce((s, q) => s + q.importe, 0),
    };

    return {
      resumen: { totalCasos, montoTotal, totalPagado, porcentajeCobro: Math.round(porcentajeCobro * 10) / 10 },
      porSituacion,
      porGestion,
      porMotivoNoPago,
      convenios: convenioStats,
      pagos: { cantidad: pagos.length, montoTotal: totalPagado },
    };
  }
}

function agrupar(items: any[], keyFn: (i: any) => string, total: number) {
  const mapa = new Map<string, number>();
  for (const item of items) {
    const k = keyFn(item);
    mapa.set(k, (mapa.get(k) || 0) + 1);
  }
  return Array.from(mapa.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([descripcion, cantidad]) => ({
      descripcion,
      cantidad,
      porcentaje: total > 0 ? Math.round((cantidad / total) * 1000) / 10 : 0,
    }));
}
