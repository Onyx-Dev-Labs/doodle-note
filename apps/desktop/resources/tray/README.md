# Dog menu-bar assets

`dog.svg` is the filled curly, floppy-eared mascot with transparent facial details.
Rebuild all exports after artwork changes:

```sh
pnpm install --frozen-lockfile
node apps/desktop/scripts/build-tray-assets.cjs
```

The generator reuses the locked sharp toolchain. Transparent PNGs are exported at
18×18 (72 dpi) and 36×36 (144 dpi). Preserve the `Template` and `@2x` names for
native appearance and Retina selection. Only the idle image is a template.
The recording variants retain color so macOS does not flatten the red eyes;
light/dark variants follow native theme changes, with a contrasting edge for
wallpaper visibility. The red eyes appear only in confirmed `recording` state,
clearing during finishing, idle and failed starts. Starting a second recording
remains disabled throughout preparation, capture and finishing.

macOS `extraResources` copies all PNGs to `Resources/tray` without Vite hashing.
Desktop tests verify dimensions, RGBA format, density and packaging. The native
tray harness verifies red pixels, template modes, theme switching and lifecycle.
