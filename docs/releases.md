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
reads the local credential file automatically for development signing.

Run `npm run release:secrets` once to configure the two repository Actions secrets.
A local subprocess loads the ignored file and pipes each value to `gh secret set`
through stdin. Values are never command arguments, printed output, release state,
or Git contents. Only the two signing values are sent to GitHub's encrypted secret
store; the local file is not uploaded. Production jobs use `GITHUB_TOKEN` for GitHub
writes, so no personal GitHub token is needed.

## Release procedure

1. Increase the three-part numeric version in both `extension/manifest.json` and
   `package.json` for each release. Update the npm lockfile with `npm install --package-lock-only`.
2. Run the local checks and commit/push the source to `main`. Browser checks use
   the dedicated testing profile; GitHub's Ubuntu jobs run unit tests, lint, and build.
3. Create and push the matching stable tag, for example `git tag v0.2.1` and
   `git push origin v0.2.1`. Never move or reuse release tags.
4. **Release build and submit** validates all version fields and the tagged commit's
   membership in `main`, then builds one ZIP without Mozilla credentials. A separate
   job saves a draft release and the ZIP before any signing requests. A serialized
   worker uploads those exact bytes to AMO and advances validation/version creation.
5. **Finalize releases** runs after submission, every ten minutes at UTC minutes
   7/17/27/37/47/57, and on manual dispatch. Each run checks pending work once and
   exits; awaiting validation or approval is successful, with no idle review wait.
6. When approved, the worker publishes `rotblock-<version>.xpi`, verifies the public
   download, and only then updates `updates.json` and GitHub's latest-release marker.
   Install/update in the testing profile and restart Zen for release verification.

Normal `main` commits and pull requests only run checks. Releases remain **unlisted**
on Mozilla and publicly hosted on GitHub; this does not create an AMO store listing.

## Recovery and integrity

Draft release bodies contain a machine-readable `rotblock-release-state:v1` section
with the tag, original source SHA, ZIP/payload hashes, upload/version IDs, and phase.
It contains no credentials. The unsigned ZIP remains a draft-only asset until the
signed download is verified. Progress survives runner cancellation, expired Actions
artifacts, manual review delays, and a lost API response. Retrying looks up the
exact Mozilla version before submitting again. There is no automatic review expiry.

Mozilla reformats manifest JSON during signing. Verification compares that JSON's
canonical parsed contents, every other extension file's exact bytes, the embedded
ID/version, and known signature metadata. Only Mozilla signature files are excluded
from the payload digest. The signed file must also match Mozilla's API SHA-256.
Firefox verifies the cryptographic signature at installation.

The worker will not replace existing asset bytes, publish a moved tag or changed
payload, downgrade update metadata, or make an older release latest. Metadata writes
retry with a fresh file SHA after conflicts. A public download failure preserves
the previous update manifest; a later run resumes even if the release is already
public. Completed historical releases are left unchanged.

Use **Actions → Finalize releases → Run workflow** (or `npm run publish`) for a
fresh status pass. An optional `retry_tag` such as `v0.2.1` retries just that release,
including a blocked one, after resolving the reported problem. Rejections, disabled
versions, and integrity failures require attention; transient API errors preserve
progress for the next run. The workflow summary identifies each release's result.

Submission uses a durable queue before the shared worker lock, so GitHub replacing
a queued worker does not lose a release request. All production finalizers share
the same concurrency group. `npm run release:resume` is the internal Actions worker;
local recovery should dispatch the workflow to retain that serialization.

GitHub schedules can be delayed and may be disabled after 60 days of repository
inactivity in public repositories. Re-enable the workflow in Actions if needed;
manual dispatch can resume pending work. No external callback service is required.

For automated Add-ons Manager inspection, use `npm run browser:system`.
This opts the dedicated testing session into geckodriver's browser UI access.
Normal inspection sessions do not enable it; signature verification stays enabled.

The update JSON contains the version, HTTPS download URL, hash, and Gecko minimum
version from the signed manifest. The browser handles checking and installation.
Run `git pull --ff-only` after publication to obtain the bot's update-manifest commit.
Bot commits use `GITHUB_TOKEN` and do not recursively trigger push workflows.
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

The 0.2.1 Actions rollout passed 45 local automated tests and the tag-triggered
build checks. GitHub returned a synthetic `untagged-*` name for the draft release;
recovery now finds it through the bound source commit and release state, then
restores the intended tag when publishing. Rerunning only the failed worker reused
the saved build without moving the tag or rebuilding. The recovered signing job
finished in 14 seconds and its automatic follow-up exited in 22 seconds while
approval was pending. An independent check verified Mozilla's signed package hash
and original payload, and found no credential values in tracked files, packages,
release state, or the successful signing/follow-up logs.

Mozilla approved 0.2.1, but GitHub had not started either of the next scheduled
slots during verification. Manual dispatch of the same serialized finalizer
published the signed release in 16 seconds. Its anonymous public download matched
Mozilla's SHA-256, release state reached `complete`, the unsigned asset was removed,
and both `updates.json` and GitHub's latest release pointed to 0.2.1. Scheduled
delivery remains unobserved; the schedule is enabled and manual recovery works.
Zen's normal update command upgraded permanent 0.2.0 to signed 0.2.1. The extension
remained active with `signedState: 2` after restart, retained the exact total of 39
through update and restart, and passed all 13 live blocker checks afterward.
The everyday Zen profile was untouched.
The signed popup page rendered its counts and seven-day chart correctly. An extra
toolbar-click automation check was inconsistent in Zen and remains inconclusive;
no popup script error appeared in the browser console.

There are no runtime npm dependencies in the extension. At implementation time,
`npm audit` reports an upstream `node-forge` advisory through web-ext's Android
debugging dependency. The current published node-forge version has no patched
release available. The desktop extension package contains none of this tooling.
Recheck the advisory when upgrading development dependencies.
