# rotblock

Always-on YouTube Shorts blocker for Firefox and Zen. Hides Shorts shelves,
cards, sidebar entries, and channel tabs, and redirects Shorts URLs to YouTube home.
Regular videos, search, subscriptions, playlists, comments, and embedded players
remain available. No popup, analytics, account connection, or data collection.

## Install

Download the Mozilla-signed `.xpi` from [GitHub Releases](https://github.com/jeemzy/rotblock/releases/latest).
In Zen, open `about:addons`, choose the gear menu, select
**Install Add-on From File**, and choose the XPI. This installation survives restarts.
The browser checks the repository's update manifest for new signed releases.

The build command produces an **unsigned ZIP for development**, which cannot be
used as a permanent signed installation. See [signing and releases](docs/releases.md).

For development, use Node.js 22 or newer and run `npm ci`, then:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Launch Zen with a temporary development extension and automatic reloading. |
| `npm run browser:extension` | Open the signed-in testing profile with the unpacked extension temporarily loaded. |
| `npm run browser:system` | Open the testing profile with explicit browser UI access for signed installation/update checks. |
| `npm run test:unit` | Run route, DOM, and release-publishing tests without opening a browser. |
| `npm test` | Run unit tests and the local Zen/profile integration checks. Close the testing session first. |
| `npm run test:live` | Check the extension on live YouTube using the signed-in profile. Close the testing session first. |
| `npm run lint` | Validate the self-distributed extension using Mozilla's linter. |
| `npm run build` | Build an unsigned versioned ZIP in `artifacts/extension/`. |
| `npm run sign` | Submit to Mozilla for unlisted signing using local credentials. |
| `npm run publish -- path/to/signed.xpi` | Upload, verify the download, then publish automatic-update metadata. |

Disable rotblock through Zen's Add-ons Manager and reload YouTube if needed.
The supported interface is desktop YouTube; navigation rules also cover
`youtube.com` and `m.youtube.com`. The add-on requires Firefox/Gecko 140 or newer.
It leaves ordinary `/watch` and `/embed` URLs usable, even for a short video.
No-href Shorts navigation labels were inspected in English; other languages and
future YouTube layouts may require selector adjustments.

## Start the testing browser

Requires Windows, Node.js 22 or newer, and Zen installed at
`G:\apps2\Zen Browser\zen.exe`. Set `ZEN_BINARY` to override that executable path.

```powershell
cd G:\projects\rotblock
npm ci
npm run browser
```

This opens a visible Zen window and a Node.js console with a connected Selenium
`driver`. Its persistent profile is `%LOCALAPPDATA%\rotblock\zen-profile`.
It does not copy or use your everyday profile. For YouTube sign-in, use the normal
launch described below; cookies and settings remain in this local profile.
Do not open two automation sessions against this profile at the same time.

At the `rotblock>` prompt:

```js
await driver.getCurrentUrl()
await driver.getTitle()
await driver.get('https://www.youtube.com/results?search_query=cooking')
await driver.executeScript(() => document.querySelectorAll('a[href*="/shorts/"]').length)
await inspect()
await screenshot()
```

YouTube loads results dynamically. Wait until they appear in the window before
capturing an inspection. `inspect()` returns tags, attributes, ancestor chains,
channel tabs, and separate Shorts/regular-link samples. It does not change the DOM.
Screenshots are saved in the ignored `artifacts` directory.

Type `.exit` to close the testing browser cleanly. Keep this console running while
inspecting. If the testing window is closed manually, exit and start a new session.
Browser state and screenshots can contain account information: keep the profile and
`artifacts` local. The profile is outside the project, and `artifacts` is ignored by Git.

## Sign into YouTube

Google may reject sign-in while Selenium is attached, displaying "This browser or
app may not be secure". Google lists automated browsers as a possible cause in its
[sign-in guidance](https://support.google.com/accounts/answer/7675428?hl=en).

1. Exit the automation console with `.exit` and close its testing window.
2. Run `npm run browser:login`. This starts ordinary Zen with the same dedicated
   profile, without geckodriver or a WebDriver session.
3. Complete sign-in manually in that window, then close that testing window.
4. Run `npm run browser` to resume inspection with the saved profile.

Keep your everyday Zen window open if you wish; it uses a separate profile.
Exit the testing instance fully, rather than closing only its last tab. A leftover
testing process can hold the profile lock and cause the next WebDriver launch to
report that its process unexpectedly closed.
Successful Google authentication still depends on Google's checks. This workflow
does not change automation-detection flags, export cookies, or change account security.

## Verification

Close any running testing session first, then run:

```powershell
npm test
```

The live integration check starts Zen twice. It verifies URL/title/DOM access,
PNG screenshots, read-only Shorts/regular-video inspection, modern channel tabs,
and local storage persistence across restarts using a local HTTP fixture.
The suite also checks that a session configuration failure closes the driver.

Selenium Manager obtains geckodriver from Mozilla and caches it locally. The helper
reads Gecko's version from Zen's `platform.ini`: using Zen's product version directly
incorrectly identifies Zen 1.23.3b as Firefox 1. Browser downloads and Selenium Manager
usage reporting are disabled. The testing profile skips Zen's first-run welcome
screen so content has a usable viewport.

See [observed YouTube structure](docs/browser-inspection.md) for the live findings.
