# Dog menu-bar assets

`dog.svg` is a small-size outline of DoodleNote's curly, floppy-eared mascot.
The checked-in transparent PNGs are raster exports at 18×18 (72 dpi) and
36×36 (144 dpi). Preserve the `Template` and `@2x` names: Electron/macOS uses
them to select the appearance and Retina representation. The tray explicitly
marks the native image as a template as well.

The macOS `extraResources` entry copies both PNGs to `Resources/tray` without
Vite hashing. The desktop tests verify their dimensions, transparency format,
density and packaging mapping. Future artwork changes must update both exports.
