-- CreateTable
CREATE TABLE `Transaccion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `usuarioId` INTEGER NOT NULL,
    `deudorId` INTEGER NULL,
    `entidad` VARCHAR(191) NOT NULL,
    `entidadId` VARCHAR(191) NULL,
    `tipo` VARCHAR(191) NOT NULL,
    `resumen` VARCHAR(191) NULL,
    `data` JSON NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` VARCHAR(191) NULL,

    INDEX `Transaccion_deudorId_createdAt_idx`(`deudorId`, `createdAt`),
    INDEX `Transaccion_usuarioId_createdAt_idx`(`usuarioId`, `createdAt`),
    INDEX `Transaccion_entidad_entidadId_idx`(`entidad`, `entidadId`),
    INDEX `Transaccion_tipo_createdAt_idx`(`tipo`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Transaccion` ADD CONSTRAINT `Transaccion_usuarioId_fkey` FOREIGN KEY (`usuarioId`) REFERENCES `Usuario`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaccion` ADD CONSTRAINT `Transaccion_deudorId_fkey` FOREIGN KEY (`deudorId`) REFERENCES `Deudor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
