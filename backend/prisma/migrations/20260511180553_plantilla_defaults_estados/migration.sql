-- AlterTable
ALTER TABLE `plantillaimport` ADD COLUMN `defaultEstadoGestionId` INTEGER NULL,
    ADD COLUMN `defaultEstadoSituacionId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `plantillaimport_defaultEstadoSituacionId_idx` ON `plantillaimport`(`defaultEstadoSituacionId`);

-- CreateIndex
CREATE INDEX `plantillaimport_defaultEstadoGestionId_idx` ON `plantillaimport`(`defaultEstadoGestionId`);

-- AddForeignKey
ALTER TABLE `plantillaimport` ADD CONSTRAINT `plantillaimport_defaultEstadoSituacionId_fkey` FOREIGN KEY (`defaultEstadoSituacionId`) REFERENCES `parametro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plantillaimport` ADD CONSTRAINT `plantillaimport_defaultEstadoGestionId_fkey` FOREIGN KEY (`defaultEstadoGestionId`) REFERENCES `parametro`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
