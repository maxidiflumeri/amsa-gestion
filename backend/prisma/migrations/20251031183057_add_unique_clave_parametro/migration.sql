/*
  Warnings:

  - A unique constraint covering the columns `[clave]` on the table `Parametro` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX `Parametro_clave_key` ON `Parametro`(`clave`);
