# Google Play build (Trusted Web Activity)

The Android app is the web app in a Trusted Web Activity: Chrome shows the site full
screen, with no address bar, when the site vouches for the app.

## Build

```sh
npm i -g @bubblewrap/cli
cd android
bubblewrap init --manifest=https://hoctusach.github.io/english-games/manifest.webmanifest   # or reuse twa-manifest.json
bubblewrap build        # makes app-release-bundle.aab (upload this) and a signed .apk
```

Keep `android.keystore` and its passwords safe and out of git (see `.gitignore`).
Turn on **Play App Signing** in Play Console; the key that signs what users install
is then Google's, not yours.

## Digital Asset Links (needed to hide the address bar)

The file must be served at the **root of the domain**:
`https://hoctusach.github.io/.well-known/assetlinks.json`

A project site (`/english-games/`) cannot serve it. Pick one:

1. Create the repo `hoctusach/hoctusach.github.io` with `.well-known/assetlinks.json`
   (copy `assetlinks.template.json`; put the **App signing key SHA-256** from
   Play Console → Setup → App signing). Add an empty `.nojekyll` file so the dot-folder is served.
2. Or use a custom domain for the site and put the file there.

Check it with <https://developers.google.com/digital-asset-links/tools/generator>.
Without it the app still works, but with a browser bar on top.

## Before each release

- Bump `appVersionCode` (and `appVersion`).
- `targetSdkVersion` must meet Google Play's current requirement (36 from 31 Aug 2026).
