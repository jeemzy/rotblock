# Signing and releasing rotblock

Repository: `jeemzy/rotblock`, branch `main`.
Stable add-on ID: `rotblock@jeemzy.github.io`.
Update URL: `https://raw.githubusercontent.com/jeemzy/rotblock/main/updates.json`.
Keep that URL reachable for existing installations.

## Mozilla account setup

Sign into the [AMO Developer Hub](https://addons.mozilla.org/developers/), complete
developer registration, and accept its developer agreement. Generate the JWT issuer
and secret on the [API credentials page](https://addons.mozilla.org/developers/addon/api/key/).
Mozilla signing is required even though the extension is not publicly listed on AMO.

Copy `.env.example` to `rotblock.env` (or `.env`) and fill it locally, or set environment variables:

```text
WEB_EXT_API_KEY=<JWT issuer>
WEB_EXT_API_SECRET=<JWT secret>
```

`rotblock.env`, `.env`, and other `*.env` files are ignored by Git. Do not paste
credentials into chat, source, release notes, or command arguments. `npm run sign`
reads the local credential file automatically; publishing does not load Mozilla credentials.

## Release procedure

1. Increase the three-part numeric version in both `extension/manifest.json` and
   `package.json` for each release. Update the npm lockfile with `npm install --package-lock-only`.
2. Run `npm test`, `npm run lint`, `npm run build`, and `npm run test:live` with
   the dedicated testing profile available. Commit and push the source to `main`.
3. Run `npm run sign`. It validates the package and submits it as **unlisted**.
   Mozilla may require review. Keep the signed XPI returned by Mozilla unchanged.
4. Run `npm run publish -- "path/to/the/signed.xpi"` with GitHub CLI authenticated
   and write access to `jeemzy/rotblock`.
5. Install the signed XPI in a testing profile, restart Zen, and check persistence.
   For the first update test, sign `0.1.1`, publish it, then use the Add-ons Manager's
   **Check for Updates** command from an installation of signed `0.1.0`.

For automated Add-ons Manager inspection, use `npm run browser:system`.
This opts the dedicated testing session into geckodriver's browser UI access.
Normal inspection sessions do not enable it; signature verification stays enabled.

Publishing checks the XPI's embedded ID and version plus Mozilla signature metadata.
Firefox verifies the actual cryptographic signature at installation. The script
creates a GitHub Release with `rotblock-<version>.xpi`, downloads that public asset,
and compares its SHA-256 hash before updating `updates.json` through the GitHub API.
An unavailable or mismatched download leaves update metadata unchanged. Retrying an
existing release verifies the existing asset rather than overwriting it. A newer
published version prevents downgrade, and the API update uses the current file SHA
to avoid silently overwriting a simultaneous update.

The update JSON contains the version, HTTPS download URL, hash, and Gecko minimum
version. The browser handles checking and installation. Run `git pull --ff-only`
after publishing to obtain the remote update-manifest commit before further work.
GitHub's raw-file endpoint may keep the previous manifest cached for five minutes.
An immediate browser update check can therefore report no updates; retry once the
cached manifest expires.

## Development verification and limits

`artifacts/live-verification.json` records live checks locally and is ignored by Git.
Unsigned temporary installs are for testing; they do not prove permanent installation
or signed automatic updates. Those checks require two actual Mozilla-signed releases.

On 2026-10-17, Mozilla-signed 0.1.0 installed permanently in the dedicated Zen
profile, remained active after restart, and passed all 13 live checks. The Add-ons
Manager reported `signedState: 2` and `temporarilyInstalled: false`, with signature
verification enabled. Selenium disables extension updates during automation;
the signed update check enables normal extension updates only in the test profile.
Zen's **Check for Updates** command then upgraded 0.1.0 to signed, permanent
0.1.1 through the public update manifest and GitHub release download.
After another restart, 0.1.1 remained signed and active, redirected a direct
Shorts URL home, hid all visible Shorts links, and preserved regular video links.

The 0.2.0 popup adds local aggregate statistics with only the `storage` permission.
Development verification passed 25 automated tests and 13 live blocker checks.
Zen's toolbar action opened the popup at 360 CSS pixels wide. Live checks covered
cross-tab updates, reset confirmation, duplicate/recycled cards, and preservation
of the same total (39) across a testing-browser restart. No video IDs or URLs were
present in stored statistics; only the schema version, lifetime total, and seven
local-calendar day buckets were stored.
The signed 0.2.0 release then upgraded permanent 0.1.1 through Zen's **Check for
Updates** command. After a restart, 0.2.0 remained active and signed (state 2),
the popup retained the same total of 39, and direct Shorts URLs still redirected.

There are no runtime npm dependencies in the extension. At implementation time,
`npm audit` reports an upstream `node-forge` advisory through web-ext's Android
debugging dependency. The current published node-forge version has no patched
release available. The desktop extension package contains none of this tooling.
Recheck the advisory when upgrading development dependencies.
