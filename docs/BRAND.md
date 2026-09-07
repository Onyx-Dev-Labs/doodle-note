# DoodleNote brand assets

The DoodleNote identity pairs the doodle-dog mascot with a warm cream, ink, and sage palette.

## Official assets

| Asset                | Source                                                                                                                                            | Use                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Wordmark and tagline | [`apps/desktop/resources/doodlenote-logo.png`](../apps/desktop/resources/doodlenote-logo.png)                                                     | Repository, documentation, and large-format product identification                |
| Master app icon      | [`apps/desktop/resources/icon-master.png`](../apps/desktop/resources/icon-master.png)                                                             | Source for generated platform icons; do not replace generated files independently |
| macOS icon           | [`apps/desktop/resources/icon.icns`](../apps/desktop/resources/icon.icns)                                                                         | Electron packaging                                                                |
| Windows icon         | [`apps/desktop/resources/icon.ico`](../apps/desktop/resources/icon.ico)                                                                           | Electron packaging                                                                |
| iOS icon             | [`apps/mobile-native/Sources/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png`](../apps/mobile-native/Sources/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png) | Xcode asset catalog                                                               |

Regenerate the desktop and in-app derivatives from the master on macOS:

```sh
pnpm --filter desktop brand:build
```

The existing generator updates desktop PNG/ICNS/ICO, web and renderer mascots, and the historical iOS target. It does not update the fresh native app. The native iPhone/iPad icon copies the approved master unchanged into the asset catalog listed above; Native mobile CI uses `cmp` to verify parity, and Xcode compiles its platform variants. See [native icon provenance](../apps/mobile-native/docs/app-icon.md). Platform icons remain full bleed and opaque so operating-system masking does not introduce pale gutters.

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
