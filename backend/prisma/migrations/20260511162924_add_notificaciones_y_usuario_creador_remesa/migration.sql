-- AlterTable
ALTER TABLE `remesa` ADD COLUMN `usuarioCreadorId` INTEGER NULL;

-- CreateTable
CREATE TABLE `notificacion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `usuarioId` INTEGER NOT NULL,
    `tipo` ENUM('IMPORTACION_INICIADA', 'IMPORTACION_FINALIZADA', 'IMPORTACION_ERROR', 'REPORTE_LISTO', 'REPORTE_ERROR', 'CONVENIO_VENCIDO', 'SISTEMA') NOT NULL,
    `entidadTipo` ENUM('REMESA', 'REPORTE_EJECUCION', 'CONVENIO', 'GENERICO') NULL,
    `entidadId` INTEGER NULL,
    `titulo` VARCHAR(200) NOT NULL,
    `mensaje` VARCHAR(1000) NOT NULL,
    `payload` JSON NULL,
    `leida` BOOLEAN NOT NULL DEFAULT false,
    `leidaEn` DATETIME(3) NULL,
    `rutaAccion` VARCHAR(500) NULL,
    `creadoEn` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizadoEn` DATETIME(3) NOT NULL,

    INDEX `notificacion_usuarioId_leida_creadoEn_idx`(`usuarioId`, `leida`, `creadoEn` DESC),
    INDEX `notificacion_entidadTipo_entidadId_idx`(`entidadTipo`, `entidadId`),
    INDEX `notificacion_creadoEn_idx`(`creadoEn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `remesa_usuarioCreadorId_idx` ON `remesa`(`usuarioCreadorId`);

-- AddForeignKey
ALTER TABLE `remesa` ADD CONSTRAINT `remesa_usuarioCreadorId_fkey` FOREIGN KEY (`usuarioCreadorId`) REFERENCES `usuario`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notificacion` ADD CONSTRAINT `notificacion_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `usuario`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
