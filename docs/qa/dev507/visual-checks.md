# Isolated renderer checks at `35f965c`

The committed `apps/desktop/scripts/dev507-home-qa` harness renders actual React Home, answer and source components against the actual Home controller/shared service/atomic store, temporary synthetic originals and a deterministic mock generator. It uses a test-only loopback transport, not Electron IPC. The owned T3 tab used a fresh Incognito profile and no existing application/profile/account/device.

The nine lifecycle assertions in `home-lifecycle-nine.json` cover focus during Ask, late pre-save hydration, generation error, cancellation, genuine source invalidation, owner revocation, older/newer refresh ordering, late citation responses and unmount. OLD `02c0bb4`/`f59cd59` silently saved a valid answer while hiding its completion; fixed `35f965c` reconciles current validated history. Initial/fixed outputs are retained separately. Independent review later confirmed this bounded fix.

Screenshots use CSS viewports 1280×900 and 480×900; the browser captured device-pixel-ratio 2 PNGs. Themes are the application's actual `html[data-theme]` CSS values. The narrow layout stacks filters and measured document scrollWidth equals 480; normal vertical scrolling remains. The wide layout has no horizontal overflow.

- [Wide light](home-1280-light.png) and [wide dark](home-1280-dark.png).
- [Narrow light](home-480-light.png) and [narrow dark](home-480-dark.png).
- [Exact read-only original](source-480-light.png): “Orchid ships Friday.” is highlighted from the real original range, with no editor or generated replacement. Personal notes have no audio seek; the panel truthfully reports that limitation.

Opening the source dialog moved focus to its Close control. Escape closed it and restored focus to the invoking citation button. The dialog has a named heading and the original text a read-only label. Phase/error live regions are present during their relevant states; no full screen-reader or accessibility certification is claimed. The synthetic checks do not qualify native media decoding, audible playback, real model semantics, packaged lifecycle or calendar integration.
