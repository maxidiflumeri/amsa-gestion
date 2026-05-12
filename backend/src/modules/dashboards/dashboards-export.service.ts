import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as path from 'path';
import { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { SnapshotResponse } from './interfaces/snapshot.interface';
import type { FormatoExportDashboard } from './dtos/export.dto';

const pdfMake = require('pdfmake');
const fontsDir = path.dirname(require.resolve('pdfmake/build/fonts/Roboto/Roboto-Regular.ttf'));

const HEADER_FILL = 'FF1565C0';
const HEADER_FONT_COLOR = 'FFFFFFFF';

const fmtMoney = (n: number | null | undefined): string => {
    if (n == null) return '—';
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
};
const fmtPercent = (n: number | null | undefined): string => {
    if (n == null) return '—';
    return `${n.toFixed(1)}%`;
};
const fmtNumber = (n: number | null | undefined): string => {
    if (n == null) return '—';
    return new Intl.NumberFormat('es-AR').format(n);
};

@Injectable()
export class DashboardsExportService {
    private readonly logger = new Logger(DashboardsExportService.name);

    private fonts = {
        Roboto: {
            normal: path.join(fontsDir, 'Roboto-Regular.ttf'),
            bold: path.join(fontsDir, 'Roboto-Medium.ttf'),
            italics: path.join(fontsDir, 'Roboto-Italic.ttf'),
            bolditalics: path.join(fontsDir, 'Roboto-MediumItalic.ttf'),
        },
    };

    async generar(
        formato: FormatoExportDashboard,
        snapshot: SnapshotResponse,
        nombreTablero?: string,
    ): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
        const safeNombre = (nombreTablero || 'tablero').replace(/[^a-z0-9_\-]+/gi, '_').slice(0, 40);
        const stamp = new Date().toISOString().slice(0, 10);
        const titulo = nombreTablero || 'Tablero de Remesa';
        if (formato === 'xlsx') {
            const buffer = await this.generarXlsx(snapshot, titulo);
            return {
                buffer,
                mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                filename: `${safeNombre}_${stamp}.xlsx`,
            };
        }
        const buffer = await this.generarPdf(snapshot, titulo);
        return {
            buffer,
            mimeType: 'application/pdf',
            filename: `${safeNombre}_${stamp}.pdf`,
        };
    }

    // ────────────────────────────────── XLSX ──────────────────────────────────

    private async generarXlsx(snap: SnapshotResponse, nombreTablero: string): Promise<Buffer> {
        const wb = new ExcelJS.Workbook();
        wb.creator = 'AMSA Gestión';
        wb.created = new Date();

        this.sheetKpis(wb, snap, nombreTablero);
        this.sheetDistribucion(wb, 'Por situación', snap.distribuciones.porSituacion);
        this.sheetDistribucion(wb, 'Por gestión', snap.distribuciones.porGestion);
        this.sheetDistribucion(wb, 'Por motivo', snap.distribuciones.porMotivo);
        this.sheetBuckets(wb, 'Mora', snap.distribuciones.porMora, false);
        this.sheetBuckets(wb, 'Deuda', snap.distribuciones.porDeuda, true);
        this.sheetSeriePagos(wb, snap);
        this.sheetSerieGestiones(wb, snap);
        this.sheetTopDeudores(wb, snap);
        this.sheetFunnel(wb, snap);

        const arr = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
        return Buffer.from(arr);
    }

    private styleHeaderRow(ws: ExcelJS.Worksheet, rowIdx: number, headers: string[]) {
        const row = ws.getRow(rowIdx);
        headers.forEach((h, i) => {
            const cell = row.getCell(i + 1);
            cell.value = h;
            cell.font = { bold: true, color: { argb: HEADER_FONT_COLOR } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = {
                top: { style: 'thin' }, bottom: { style: 'thin' },
                left: { style: 'thin' }, right: { style: 'thin' },
            };
        });
        row.commit();
    }

    private autoAjustar(ws: ExcelJS.Worksheet) {
        ws.columns.forEach((col) => {
            let max = 12;
            col.eachCell?.({ includeEmpty: false }, (cell) => {
                const v = cell.value;
                const len = v == null ? 0 : String(v).length;
                if (len > max) max = len;
            });
            col.width = Math.min(max + 2, 60);
        });
    }

    private sheetKpis(wb: ExcelJS.Workbook, snap: SnapshotResponse, nombreTablero: string) {
        const ws = wb.addWorksheet('KPIs');
        ws.getCell('A1').value = nombreTablero;
        ws.getCell('A1').font = { bold: true, size: 16 };
        ws.mergeCells('A1:B1');

        const meta: [string, string][] = [
            ['Empresa', snap.meta.empresaNombre ?? 'Todas'],
            ['Remesa', snap.meta.remesaNombre ?? 'Todas'],
            ['Desde', snap.meta.desde.slice(0, 10)],
            ['Hasta', snap.meta.hasta.slice(0, 10)],
            ['Generado', new Date(snap.meta.generadoEn).toLocaleString('es-AR')],
            ['Total deudores filtrados', String(snap.meta.totalDeudoresFiltrados)],
        ];
        let row = 3;
        for (const [k, v] of meta) {
            ws.getCell(`A${row}`).value = k;
            ws.getCell(`A${row}`).font = { bold: true };
            ws.getCell(`B${row}`).value = v;
            row++;
        }

        row += 1;
        this.styleHeaderRow(ws, row, ['Indicador', 'Valor']);
        row++;

        const kpis = snap.kpis;
        const filas: [string, string | number][] = [
            ['Cantidad de casos', fmtNumber(kpis.cantidadCasos)],
            ['Deuda total', fmtMoney(kpis.deudaTotal)],
            ['Pagos del período', fmtMoney(kpis.pagosPeriodo)],
            ['% Recupero', fmtPercent(kpis.porcentajeRecupero)],
            ['Casos con pago', fmtNumber(kpis.casosConPago)],
            ['Ticket promedio', fmtMoney(kpis.ticketPromedio)],
            ['Mora promedio (días)', kpis.moraPromediaDias != null ? Math.round(kpis.moraPromediaDias) : '—'],
            ['Promesas vigentes', fmtNumber(kpis.promesasVigentes)],
            ['% CPC', fmtPercent(kpis.porcentajeCpc)],
            ['Casos sin gestión', fmtNumber(kpis.casosSinGestion)],
            ['Casos incobrables', fmtNumber(kpis.casosIncobrables)],
            ['Casos legales', fmtNumber(kpis.casosLegales)],
        ];
        for (const [label, value] of filas) {
            ws.getCell(`A${row}`).value = label;
            ws.getCell(`B${row}`).value = value;
            row++;
        }
        this.autoAjustar(ws);
    }

    private sheetDistribucion(wb: ExcelJS.Workbook, nombre: string, items: SnapshotResponse['distribuciones']['porSituacion']) {
        const ws = wb.addWorksheet(nombre);
        this.styleHeaderRow(ws, 1, ['Clave', 'Etiqueta', 'Categoría', 'Cantidad', 'Porcentaje']);
        items.forEach((it, i) => {
            const r = ws.getRow(i + 2);
            r.getCell(1).value = it.clave ?? '';
            r.getCell(2).value = it.label;
            r.getCell(3).value = it.categoria ?? '';
            r.getCell(4).value = it.cantidad;
            r.getCell(5).value = it.porcentaje;
            r.getCell(5).numFmt = '0.00"%"';
        });
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        this.autoAjustar(ws);
    }

    private sheetBuckets(wb: ExcelJS.Workbook, nombre: string, items: SnapshotResponse['distribuciones']['porMora'], conSuma: boolean) {
        const ws = wb.addWorksheet(nombre);
        const headers = conSuma ? ['Rango', 'Cantidad', 'Porcentaje', 'Suma'] : ['Rango', 'Cantidad', 'Porcentaje'];
        this.styleHeaderRow(ws, 1, headers);
        items.forEach((it, i) => {
            const r = ws.getRow(i + 2);
            r.getCell(1).value = it.rango;
            r.getCell(2).value = it.cantidad;
            r.getCell(3).value = it.porcentaje;
            r.getCell(3).numFmt = '0.00"%"';
            if (conSuma) {
                r.getCell(4).value = it.suma ?? 0;
                r.getCell(4).numFmt = '"$"#,##0';
            }
        });
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        this.autoAjustar(ws);
    }

    private sheetSeriePagos(wb: ExcelJS.Workbook, snap: SnapshotResponse) {
        const ws = wb.addWorksheet(`Pagos por ${snap.series.granularidad}`);
        this.styleHeaderRow(ws, 1, ['Fecha', 'Importe', 'Cantidad']);
        snap.series.pagosPorPeriodo.forEach((s, i) => {
            const r = ws.getRow(i + 2);
            r.getCell(1).value = s.fecha;
            r.getCell(2).value = s.importe;
            r.getCell(2).numFmt = '"$"#,##0';
            r.getCell(3).value = s.cantidad;
        });
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        this.autoAjustar(ws);
    }

    private sheetSerieGestiones(wb: ExcelJS.Workbook, snap: SnapshotResponse) {
        const ws = wb.addWorksheet(`Gestiones por ${snap.series.granularidad}`);
        this.styleHeaderRow(ws, 1, ['Fecha', 'Cantidad']);
        snap.series.gestionesPorPeriodo.forEach((s, i) => {
            const r = ws.getRow(i + 2);
            r.getCell(1).value = s.fecha;
            r.getCell(2).value = s.cantidad;
        });
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        this.autoAjustar(ws);
    }

    private sheetTopDeudores(wb: ExcelJS.Workbook, snap: SnapshotResponse) {
        const ws = wb.addWorksheet('Top deudores');
        this.styleHeaderRow(ws, 1, ['Nombre', 'Documento', 'Monto', 'Estado situación', 'Estado gestión']);
        snap.top.deudores.forEach((d, i) => {
            const r = ws.getRow(i + 2);
            r.getCell(1).value = d.nombreCompleto;
            r.getCell(2).value = d.documento;
            r.getCell(3).value = d.monto;
            r.getCell(3).numFmt = '"$"#,##0';
            r.getCell(4).value = d.estadoSituacion ?? '';
            r.getCell(5).value = d.estadoGestion ?? '';
        });
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        this.autoAjustar(ws);
    }

    private sheetFunnel(wb: ExcelJS.Workbook, snap: SnapshotResponse) {
        const ws = wb.addWorksheet('Funnel');
        this.styleHeaderRow(ws, 1, ['Etapa', 'Cantidad', '% del total']);
        const base = Math.max(snap.funnel.asignados, 1);
        const filas = [
            ['Asignados', snap.funnel.asignados],
            ['Contactados', snap.funnel.contactados],
            ['Con promesa', snap.funnel.conPromesa],
            ['Con pago', snap.funnel.conPago],
        ] as [string, number][];
        filas.forEach(([etapa, val], i) => {
            const r = ws.getRow(i + 2);
            r.getCell(1).value = etapa;
            r.getCell(2).value = val;
            r.getCell(3).value = (val / base) * 100;
            r.getCell(3).numFmt = '0.00"%"';
        });
        this.autoAjustar(ws);
    }

    // ────────────────────────────────── PDF ──────────────────────────────────

    private async generarPdf(snap: SnapshotResponse, nombreTablero: string): Promise<Buffer> {
        pdfMake.setFonts(this.fonts);
        const content: Content[] = [];

        content.push({ text: nombreTablero, style: 'h1' });
        content.push({ text: 'AMSA Gestión — Tablero de remesa', style: 'subtitle', margin: [0, 0, 0, 8] });

        const metaRows = [
            ['Empresa', snap.meta.empresaNombre ?? 'Todas'],
            ['Remesa', snap.meta.remesaNombre ?? 'Todas'],
            ['Período', `${snap.meta.desde.slice(0, 10)} → ${snap.meta.hasta.slice(0, 10)}`],
            ['Generado', new Date(snap.meta.generadoEn).toLocaleString('es-AR')],
            ['Total casos filtrados', fmtNumber(snap.meta.totalDeudoresFiltrados)],
        ];
        content.push({
            table: {
                widths: [120, '*'],
                body: metaRows.map(([k, v]) => [{ text: k, bold: true }, v]),
            },
            layout: 'lightHorizontalLines',
            margin: [0, 0, 0, 16],
        });

        content.push({ text: 'Indicadores principales', style: 'h2' });
        const k = snap.kpis;
        const kpiRows: any[][] = [
            [{ text: 'Indicador', style: 'th' }, { text: 'Valor', style: 'th' }],
            ['Cantidad de casos', fmtNumber(k.cantidadCasos)],
            ['Deuda total', fmtMoney(k.deudaTotal)],
            ['Pagos del período', fmtMoney(k.pagosPeriodo)],
            ['% Recupero', fmtPercent(k.porcentajeRecupero)],
            ['Casos con pago', fmtNumber(k.casosConPago)],
            ['Ticket promedio', fmtMoney(k.ticketPromedio)],
            ['Mora promedio (días)', k.moraPromediaDias != null ? String(Math.round(k.moraPromediaDias)) : '—'],
            ['Promesas vigentes', fmtNumber(k.promesasVigentes)],
            ['% CPC', fmtPercent(k.porcentajeCpc)],
            ['Casos sin gestión', fmtNumber(k.casosSinGestion)],
            ['Incobrables', fmtNumber(k.casosIncobrables)],
            ['En proceso legal', fmtNumber(k.casosLegales)],
        ];
        content.push({
            table: { headerRows: 1, widths: ['*', 'auto'], body: kpiRows },
            layout: this.zebraLayout(),
            margin: [0, 4, 0, 16],
        });

        content.push({ text: 'Funnel de gestión', style: 'h2' });
        const base = Math.max(snap.funnel.asignados, 1);
        const funnelRows = [
            [{ text: 'Etapa', style: 'th' }, { text: 'Cantidad', style: 'th' }, { text: '% del total', style: 'th' }],
            ['Asignados', fmtNumber(snap.funnel.asignados), fmtPercent((snap.funnel.asignados / base) * 100)],
            ['Contactados', fmtNumber(snap.funnel.contactados), fmtPercent((snap.funnel.contactados / base) * 100)],
            ['Con promesa', fmtNumber(snap.funnel.conPromesa), fmtPercent((snap.funnel.conPromesa / base) * 100)],
            ['Con pago', fmtNumber(snap.funnel.conPago), fmtPercent((snap.funnel.conPago / base) * 100)],
        ];
        content.push({
            table: { headerRows: 1, widths: ['*', 'auto', 'auto'], body: funnelRows },
            layout: this.zebraLayout(),
            margin: [0, 4, 0, 16],
            pageBreak: 'after',
        });

        this.appendDistribucion(content, 'Distribución por situación', snap.distribuciones.porSituacion);
        this.appendDistribucion(content, 'Distribución por gestión', snap.distribuciones.porGestion);
        this.appendDistribucion(content, 'Distribución por motivo de no pago', snap.distribuciones.porMotivo);
        this.appendBuckets(content, 'Distribución por mora', snap.distribuciones.porMora, false);
        this.appendBuckets(content, 'Distribución por deuda', snap.distribuciones.porDeuda, true);

        content.push({ text: 'Top 10 deudores por monto', style: 'h2', pageBreak: 'before' });
        const topRows: any[][] = [
            [
                { text: 'Deudor', style: 'th' },
                { text: 'Documento', style: 'th' },
                { text: 'Monto', style: 'th', alignment: 'right' },
                { text: 'Estado situación', style: 'th' },
            ],
            ...snap.top.deudores.map((d) => [
                d.nombreCompleto,
                d.documento,
                { text: fmtMoney(d.monto), alignment: 'right' },
                d.estadoSituacion ?? '—',
            ]),
        ];
        content.push({
            table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto'], body: topRows },
            layout: this.zebraLayout(),
            margin: [0, 4, 0, 0],
        });

        const doc: TDocumentDefinitions = {
            pageSize: 'A4',
            pageMargins: [40, 50, 40, 50],
            content,
            styles: {
                h1: { fontSize: 20, bold: true, margin: [0, 0, 0, 2] },
                h2: { fontSize: 14, bold: true, margin: [0, 8, 0, 4], color: '#1565C0' },
                subtitle: { fontSize: 10, color: '#666' },
                th: { bold: true, color: 'white', fillColor: '#1565C0' },
            },
            defaultStyle: { font: 'Roboto', fontSize: 10 },
            footer: (currentPage, pageCount) => ({
                text: `Página ${currentPage} de ${pageCount}`,
                alignment: 'right',
                margin: [40, 0, 40, 20],
                fontSize: 9,
                color: '#888',
            }),
        };

        const output = pdfMake.createPdf(doc);
        const buffer = await output.getBuffer();
        return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    }

    private appendDistribucion(content: Content[], titulo: string, items: SnapshotResponse['distribuciones']['porSituacion']) {
        content.push({ text: titulo, style: 'h2' });
        if (!items.length) {
            content.push({ text: 'Sin datos.', italics: true, color: '#888', margin: [0, 0, 0, 12] });
            return;
        }
        const top = [...items].sort((a, b) => b.cantidad - a.cantidad).slice(0, 12);
        const rows: any[][] = [
            [
                { text: 'Etiqueta', style: 'th' },
                { text: 'Cantidad', style: 'th', alignment: 'right' },
                { text: '%', style: 'th', alignment: 'right' },
            ],
            ...top.map((it) => [
                it.label,
                { text: fmtNumber(it.cantidad), alignment: 'right' },
                { text: fmtPercent(it.porcentaje), alignment: 'right' },
            ]),
        ];
        content.push({
            table: { headerRows: 1, widths: ['*', 'auto', 'auto'], body: rows },
            layout: this.zebraLayout(),
            margin: [0, 4, 0, 12],
        });
    }

    private appendBuckets(content: Content[], titulo: string, items: SnapshotResponse['distribuciones']['porMora'], conSuma: boolean) {
        content.push({ text: titulo, style: 'h2' });
        if (!items.length) {
            content.push({ text: 'Sin datos.', italics: true, color: '#888', margin: [0, 0, 0, 12] });
            return;
        }
        const header: any[] = [
            { text: 'Rango', style: 'th' },
            { text: 'Cantidad', style: 'th', alignment: 'right' },
            { text: '%', style: 'th', alignment: 'right' },
        ];
        if (conSuma) header.push({ text: 'Suma', style: 'th', alignment: 'right' });
        const rows: any[][] = [
            header,
            ...items.map((it) => {
                const r: any[] = [
                    it.rango,
                    { text: fmtNumber(it.cantidad), alignment: 'right' },
                    { text: fmtPercent(it.porcentaje), alignment: 'right' },
                ];
                if (conSuma) r.push({ text: fmtMoney(it.suma ?? 0), alignment: 'right' });
                return r;
            }),
        ];
        content.push({
            table: { headerRows: 1, widths: conSuma ? ['*', 'auto', 'auto', 'auto'] : ['*', 'auto', 'auto'], body: rows },
            layout: this.zebraLayout(),
            margin: [0, 4, 0, 12],
        });
    }

    private zebraLayout() {
        return {
            fillColor: (rowIndex: number) => (rowIndex === 0 ? '#1565C0' : rowIndex % 2 === 0 ? '#F5F5F5' : null),
            hLineColor: () => '#cccccc',
            vLineColor: () => '#cccccc',
        };
    }
}
