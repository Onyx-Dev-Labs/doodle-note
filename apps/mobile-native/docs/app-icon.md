# Native app icon

Sean requested the DoodleNote logo as the iPhone/iPad app icon. `Sources/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png` is a byte-for-byte copy of the approved `apps/desktop/resources/icon-master.png` identified in `docs/BRAND.md`. Both files have SHA-256 `e1aad933253e4488e59fabf8473918c407790fbe835f54411530863e3d927ed7`. It is 1024 × 1024, full bleed and opaque. No historical iOS asset is used.

The app target sets `ASSETCATALOG_COMPILER_APPICON_NAME` to `AppIcon`. Xcode compiles the single universal iOS source into the platform icon variants and records the primary icon in the built app's Info.plist. No custom corner mask or image regeneration is applied.

When the approved master changes, copy it into this native asset set and rebuild with XcodeGen. Verify the files are identical with `cmp`, inspect `CFBundleIcons` and `CFBundleIcons~ipad` in the built app, and confirm generated icon assets/Assets.car exist. Simulator and distribution/install verification remain separate; this source change does not publish an App Store build.
