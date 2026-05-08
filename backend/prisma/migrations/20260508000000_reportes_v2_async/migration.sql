-- AlterTable: agregar campos de ejecución async (F6) a ejecucion_reporte_v2
ALTER TABLE `ejecucion_reporte_v2`
  ADD COLUMN `empresaId` INTEGER NULL,
  ADD COLUMN `filasProcesadas` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `progreso` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `formato` VARCHAR(191) NULL,
  ADD COLUMN `archivoTamano` INTEGER NULL,
  ADD COLUMN `cancelado` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `jobId` VARCHAR(191) NULL,
  ADD COLUMN `iniciadoEn` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `ejecucion_reporte_v2_empresaId_idx` ON `ejecucion_reporte_v2`(`empresaId`);
