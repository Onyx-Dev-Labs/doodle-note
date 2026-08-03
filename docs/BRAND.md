# DoodleNote brand assets

The DoodleNote identity pairs the doodle-dog mascot with a warm cream, ink, and sage palette.

## Official assets

| Asset                | Source                                                                                                                                            | Use                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Wordmark and tagline | [`apps/desktop/resources/doodlenote-logo.png`](../apps/desktop/resources/doodlenote-logo.png)                                                     | Repository, documentation, and large-format product identification                |
| Master app icon      | [`apps/desktop/resources/icon-master.png`](../apps/desktop/resources/icon-master.png)                                                             | Source for generated platform icons; do not replace generated files independently |
| macOS icon           | [`apps/desktop/resources/icon.icns`](../apps/desktop/resources/icon.icns)                                                                         | Electron packaging                                                                |
| Windows icon         | [`apps/desktop/resources/icon.ico`](../apps/desktop/resources/icon.ico)                                                                           | Electron packaging                                                                |
| iOS icon             | [`apps/ios/DoodleNote/Assets.xcassets/AppIcon.appiconset/icon-1024.png`](../apps/ios/DoodleNote/Assets.xcassets/AppIcon.appiconset/icon-1024.png) | Xcode asset catalog                                                               |

Regenerate the desktop and in-app derivatives from the master on macOS:

```sh
pnpm --filter desktop brand:build
```

The generator updates the desktop PNG/ICNS/ICO, web mascot, iOS mascot, and renderer mascot together. Generated platform icons should remain full-bleed and opaque so operating-system masking does not introduce pale gutters.

## Core palette

| Name      | Hex       |
| --------- | --------- |
| Cream     | `#f7f5ee` |
| Ink       | `#26281f` |
| Bark      | `#3a3d33` |
| Sage      | `#708c5c` |
| Deep sage | `#506941` |
| Sage fill | `#e9efe0` |

Use “DoodleNote” as one word. Preserve the artwork's proportions and avoid recoloring, stretching, pre-rounding, or placing text over the mascot.
