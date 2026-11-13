import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build as buildFrontend} from 'vite';
import {Arch, Platform, build as packageDesktop} from 'electron-builder';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const config = {};

// pnpm has already unpacked the matching Electron runtime on Windows x64.
// Reuse it to avoid extracting and renaming a second copy on Windows.
if (process.platform === 'win32' && process.arch === 'x64') {
  config.electronDist = dirname(require('electron'));
}

await buildFrontend({root});
await packageDesktop({
  projectDir: root,
  targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
  config,
  publish: 'never',
});
