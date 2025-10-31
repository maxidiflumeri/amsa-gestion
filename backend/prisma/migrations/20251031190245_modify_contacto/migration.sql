/*
  Warnings:

  - A unique constraint covering the columns `[deudorId,tipo,valor]` on the table `Contacto` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `contacto` ADD COLUMN `subtipo` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Contacto_deudorId_tipo_idx` ON `Contacto`(`deudorId`, `tipo`);

-- CreateIndex
CREATE UNIQUE INDEX `Contacto_deudorId_tipo_valor_key` ON `Contacto`(`deudorId`, `tipo`, `valor`);
