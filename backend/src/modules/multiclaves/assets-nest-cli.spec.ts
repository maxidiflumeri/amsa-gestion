/**
 * Sin la entrada de `nest-cli.json`, el logo de Personal anda en `npm run start:dev` (que corre
 * sobre `src/`) pero desaparece en la imagen de producción (que corre sobre `dist/`, sólo con lo
 * que `nest build` copió) — el bug típico de "anda en dev, no en prod" (spec §7.5, §13, §16.1).
 *
 * Este test es la única red que no depende de acordarse de correr `npm run build && test -f
 * dist/...` a mano: si alguien borra la entrada del glob, falla acá mismo, sin necesitar un build.
 * El chequeo real post-build (`dist/modules/multiclaves/assets/logo-personal.png` existe) se corre
 * aparte, documentado en el CHANGELOG y en la verificación de la fase 2.
 */
import * as fs from 'fs';
import * as path from 'path';

describe('nest-cli.json — assets de multiclaves', () => {
    it('declara el glob que copia assets/ de multiclaves a dist', () => {
        const nestCli = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../nest-cli.json'), 'utf8'));
        const assets: string[] = nestCli?.compilerOptions?.assets ?? [];
        expect(assets).toContain('modules/multiclaves/assets/**/*');
    });

    it('el placeholder del logo existe en el repo (assets/logo-personal.png)', () => {
        const ruta = path.resolve(__dirname, 'assets/logo-personal.png');
        expect(fs.existsSync(ruta)).toBe(true);
    });
});
