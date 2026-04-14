import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class DeudoresFuente {
  private readonly logger = new Logger(DeudoresFuente.name);

  constructor(private prisma: PrismaService) {}

  async ejecutar(filtrosFijos: any, filtrosVars: any, columnasConfig: any[]): Promise<Record<string, any>[]> {
    this.logger.log('Iniciando extracción y filtrado en DeudoresFuente');
    
    const filtros = { ...filtrosFijos, ...filtrosVars };
    if (filtrosFijos?.camposAux || filtrosVars?.camposAux) {
      filtros.camposAux = { ...(filtrosFijos?.camposAux || {}), ...(filtrosVars?.camposAux || {}) };
    }

    const where: any = {};

    this.logger.log(`Ejecutando fuente deudores con filtros: ${JSON.stringify(filtros)}`);

    // Empresa
    if (filtros.empresaId) where.empresaId = Number(filtros.empresaId);

    // Remesa
    if (filtros.remesaId) where.remesaId = Number(filtros.remesaId);

    // Situación: claves exactas o rango + exclusiones
    if (filtros.situacion) {
      const s = filtros.situacion;
      if (s.claves?.length) {
        // Buscar IDs de esos parámetros
        const params = await this.prisma.parametro.findMany({ where: { clave: { in: s.claves } }, select: { id: true } });
        where.estadoSituacionId = { in: params.map(p => p.id) };
      } else if (s.rango) {
        let paramsQuery: any = { grupo: 'situacion' };
        if (s.excluir?.length) {
          paramsQuery.clave = { notIn: s.excluir };
        }
        const params = await this.prisma.parametro.findMany({ where: paramsQuery, select: { id: true, clave: true } });
        // Filtrar por rango alfanumérico
        const filtrados = params.filter(p => p.clave >= (s.rango.desde || '') && p.clave <= (s.rango.hasta || 'ZZZ'));
        where.estadoSituacionId = { in: filtrados.map(p => p.id) };
      }
    }

    // Gestión: mismo patrón
    if (filtros.gestion) {
      const g = filtros.gestion;
      if (g.claves?.length) {
        const params = await this.prisma.parametro.findMany({ where: { clave: { in: g.claves } }, select: { id: true } });
        where.estadoGestionId = { in: params.map(p => p.id) };
      }
    }

    // Motivo no pago
    if (filtros.motivoNoPago?.claves?.length) {
      const params = await this.prisma.parametro.findMany({ where: { clave: { in: filtros.motivoNoPago.claves } }, select: { id: true } });
      where.motivoNoPagoId = { in: params.map(p => p.id) };
    }

    // Monto
    if (filtros.monto) {
      const montoWhere: any = {};
      if (filtros.monto.desde !== undefined) montoWhere.gte = filtros.monto.desde;
      if (filtros.monto.hasta !== undefined) montoWhere.lte = filtros.monto.hasta;
      where.montoTotal = montoWhere;
      // excluirRangos: filtramos en memoria después
    }

    // Vencimiento
    if (filtros.vencimientoDesde || filtros.vencimientoHasta) {
      where.fechaVencimiento = {};
      if (filtros.vencimientoDesde) where.fechaVencimiento.gte = new Date(filtros.vencimientoDesde);
      if (filtros.vencimientoHasta) where.fechaVencimiento.lte = new Date(filtros.vencimientoHasta);
    }

    // Tiene contacto (filtrado en memoria después de query)
    const necesitaContactos = filtros.tieneEmail || filtros.tieneTelefono || filtros.tieneWhatsapp ||
      columnasConfig.some(c => ['contacto.telefono', 'contacto.whatsapp', 'contacto.email'].includes(c.campo));

    const deudores = await this.prisma.deudor.findMany({
      where,
      include: {
        empresa: { select: { nombre: true } },
        remesa: { select: { nombre: true, numeroRemesa: true } },
        estadoSituacion: { select: { descripcion: true, clave: true } },
        estadoGestion: { select: { descripcion: true, clave: true } },
        motivoNoPago: { select: { descripcion: true, clave: true } },
        ...(necesitaContactos ? { contactos: true } : {}),
        campoExtras: true,
      },
    });

    this.logger.log(`Query devolvió ${deudores.length} deudores`);

    // Filtro en memoria: excluirRangos de monto
    let resultado = deudores;
    if (filtros.monto?.excluirRangos?.length) {
      resultado = resultado.filter(d => {
        const m = d.montoTotal || 0;
        return !filtros.monto.excluirRangos.some((r: any) => m >= r.desde && m <= r.hasta);
      });
    }

    // Filtro contactos
    if (filtros.tieneEmail) resultado = resultado.filter(d => d.contactos?.some((c: any) => c.tipo === 'email'));
    if (filtros.tieneTelefono) resultado = resultado.filter(d => d.contactos?.some((c: any) => c.tipo === 'telefono'));
    if (filtros.tieneWhatsapp) resultado = resultado.filter(d => d.contactos?.some((c: any) => c.tipo === 'whatsapp'));

    // Filtros auxiliares dinámicos
    if (filtros.camposAux) {
      for (const [clave, valor] of Object.entries(filtros.camposAux as Record<string, string>)) {
        if (!valor) continue;
        resultado = resultado.filter(d => {
          if (!d.camposAdicionales) return false;
          try {
            const extras = typeof d.camposAdicionales === 'string' ? JSON.parse(d.camposAdicionales) : d.camposAdicionales;
            const extVal = typeof extras === 'object' && extras !== null ? extras[clave] : undefined;
            return extVal?.toString().toLowerCase().includes((valor as string).toLowerCase());
          } catch (e) {
            return false;
          }
        });
      }
    }

    this.logger.log(`Después de filtros en memoria: ${resultado.length} deudores`);

    // Expandir filas si hay múltiples contactos del mismo tipo solicitado
    const rows: Record<string, any>[] = [];
    
    for (const d of resultado) {
      // 1. Mapear datos base (sin contactos)
      const baseRow = mapearFilaBase(d, columnasConfig);
      let expansiones = [ baseRow ];

      // 2. Por cada tipo de contacto, si la columna fue solicitada, expandir
      const tiposContacto = ['telefono', 'whatsapp', 'email'];
      for (const tipo of tiposContacto) {
        const campoContacto = `contacto.${tipo}`;
        const columnaSolicitada = columnasConfig.find((c: any) => c.campo === campoContacto);
        
        if (columnaSolicitada) {
          const label = columnaSolicitada.label || campoContacto;
          const contactosDelTipo = d.contactos?.filter((c: any) => c.tipo === tipo) || [];
          
          if (contactosDelTipo.length > 0) {
            // Duplicar filas existentes por cada contacto de este tipo
            expansiones = expansiones.flatMap(row => 
              contactosDelTipo.map((c: any) => {
                let valor = c.valor || '';
                if ((tipo === 'telefono' || tipo === 'whatsapp') && filtros.formatoTel) {
                  valor = formatearTelefono(valor, filtros.formatoTel);
                }
                return { ...row, [label]: valor };
              })
            );
          } else {
            // No tiene este contacto, agregar como vacío a todas las expansiones actuales
            expansiones.forEach(row => { row[label] = ''; });
          }
        }
      }

      rows.push(...expansiones);
    }

    return rows;
  }
}

function formatearTelefono(numero: string, patron: string): string {
  const limpio = numero.replace(/\D/g, '');
  const sinPlus = limpio.startsWith('54') ? limpio.slice(2) : limpio;
  return patron.replace('{numero}', sinPlus);
}

function mapearFilaBase(d: any, columnas: any[]): Record<string, any> {
  const fila: Record<string, any> = {};
  
  // 1. Inicializar TODAS las columnas en el orden solicitado por el usuario
  for (const col of columnas) {
    const label = col.label || col.campo;
    fila[label] = '';
  }

  // 2. Poblar los valores de la base
  for (const col of columnas) {
    if (col.campo.startsWith('contacto.')) continue; // Se procesan en la expansión
    
    const label = col.label || col.campo;

    if (col.campo.startsWith('extra.')) {
      const clave = col.campo.replace('extra.', '');
      try {
        const extras = typeof d.camposAdicionales === 'string' ? JSON.parse(d.camposAdicionales) : d.camposAdicionales;
        const valorAdicional = extras && typeof extras === 'object' ? extras[clave] : undefined;
        fila[label] = valorAdicional !== undefined && valorAdicional !== null ? valorAdicional.toString() : '';
      } catch (e) {
        fila[label] = '';
      }
      continue;
    }

    switch (col.campo) {
      case 'documento': fila[label] = d.documento || ''; break;
      case 'nombre': fila[label] = d.nombre || ''; break;
      case 'apellido': fila[label] = d.apellido || ''; break;
      case 'montoTotal': fila[label] = d.montoTotal !== null ? d.montoTotal : ''; break;
      case 'fechaVencimiento': fila[label] = d.fechaVencimiento ? new Date(d.fechaVencimiento).toLocaleDateString('es-AR') : ''; break;
      case 'empresa.nombre': fila[label] = d.empresa?.nombre || ''; break;
      case 'remesa.nombre': fila[label] = d.remesa?.nombre || ''; break;
      case 'remesa.numeroRemesa': fila[label] = d.remesa?.numeroRemesa || ''; break;
      case 'estadoSituacion.descripcion': fila[label] = d.estadoSituacion?.descripcion || ''; break;
      case 'estadoGestion.descripcion': fila[label] = d.estadoGestion?.descripcion || ''; break;
      case 'motivoNoPago.descripcion': fila[label] = d.motivoNoPago?.descripcion || ''; break;
    }
  }
  return fila;
}
