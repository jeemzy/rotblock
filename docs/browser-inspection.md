# YouTube DOM inspection

Observed on 2026-10-17 in Zen 1.23.3b / Gecko 158, using the dedicated rotblock
profile, desktop YouTube in English, initially signed out, then signed in for the
follow-up below. These are observations for the
future blocker, not a guarantee that YouTube will keep this markup.

## Search results

On `/results?search_query=cooking`, one captured result set contained 29 Shorts
links and 65 regular watch links. Shorts appeared both as individual search results
and in a shelf.

| Surface | Observed structure | Preservation rule |
| --- | --- | --- |
| Individual Shorts result | `ytd-video-renderer` containing `a#thumbnail[href^="/shorts/"]` and `a#video-title` | Ordinary videos use the same renderer; require a Shorts thumbnail URL before targeting the card. |
| Shorts shelf | `grid-shelf-view-model` containing `ytm-shorts-lockup-view-model-v2` and `ytm-shorts-lockup-view-model` | The observed shelf had 10 Shorts links and zero watch links. Check a shelf's content rather than targeting every grid shelf. |
| Regular result | `ytd-video-renderer` with `a#thumbnail[href^="/watch?"]` | Preserve this card and its surrounding mixed results section. |
| Collapsed sidebar | `ytd-mini-guide-entry-renderer > a#endpoint[href="/shorts/"]` | Target the individual entry, not the guide container. |
| Expanded sidebar | `ytd-guide-entry-renderer` containing `a#endpoint[role="link"][title="Shorts"]` | The observed anchor has no `href`; URL-only scans miss this entry. Preserve neighboring entries. |

Never target shared ancestors such as `ytd-item-section-renderer`,
`ytd-section-list-renderer`, or `ytd-app`: they also contain regular videos.
Parse link URLs when implementing behavior; CSS prefix examples above describe
the observed relative URLs only.

During implementation, a Shorts search result also contained a normal `/watch`
timestamp link in its description snippet. Individual search cards therefore use
their primary `a#thumbnail` URL for classification. Mixed shelves and sections
still preserve their regular watch links. This case has a regression test.

## Channel page

On `/@NickDiGiovanni`, the channel tabs are `yt-tab-shape[role="tab"]`, with
`tab-title` and `aria-selected` attributes. The Shorts tab has `tab-title="Shorts"`
but no anchor or `href`. Home, Videos, Playlists, Posts, and Store are neighboring tabs.
An anchor-only selector would miss the Shorts tab. Titles were observed in English;
do not assume localized labels are stable identifiers.

The channel's Shorts shelf was `ytd-reel-shelf-renderer`, containing
`yt-horizontal-list-renderer` and the same `ytm-shorts-lockup-view-model-v2`
cards. The observed shelf contained 12 Shorts links and no watch links.

## Signed-in home and subscriptions

Manual sign-in in normal Zen persisted when the same dedicated profile was
reopened through Selenium. This was verified using YouTube's logged-in state and
the presence of the profile-avatar button, without recording account identity.

On the initial home-page capture, 20 Shorts links and 45 watch links were present.
Shorts used `ytm-shorts-lockup-view-model-v2` inside `ytd-rich-item-renderer`
and `ytd-rich-shelf-renderer`. Two Shorts shelves each contained 10 Shorts links
and no watch links. Regular home cards used `yt-lockup-view-model`, also inside
`ytd-rich-item-renderer`; do not hide that shared renderer indiscriminately.

Subscriptions initially contained 10 Shorts links and 198 watch links. A
`ytd-rich-shelf-renderer[is-shorts]` contained all 10 Shorts links and no watch
links. A separate ordinary `ytd-rich-shelf-renderer` had six watch links and no
Shorts links, confirming that the broad shelf tag would remove normal content.
Counts refer to DOM links, not unique videos, and change as YouTube loads content.

The following candidates were checked against the subscriptions DOM. None of the
matched containers contained a regular `/watch?` link in that sample:

- `ytd-rich-shelf-renderer[is-shorts]`: one shelf.
- `ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])`: one enclosing section.
- `ytm-shorts-lockup-view-model-v2`: five cards.
- `ytd-rich-item-renderer:has(a[href^="/shorts/"])`: five card wrappers.

Scrolling subscriptions preserved the inspected Shorts shelf while watch-link
count increased to 199. Clicking Home from the sidebar navigated without a full
document reload and fired both `yt-navigate-start` and `yt-navigate-finish` on
`document`. The instrumentation remained alive and the account remained signed in.
These events can trigger rescanning, with DOM observation covering later inserts.

## Evidence and remaining coverage

Local JSON captures and PNG screenshots are in `artifacts/` and ignored by Git.
The reusable `inspect()` console command captures the current structure without
modifying the page. The signed-in structure captures omit `aria-label` values to
avoid recording video-title labels. Additional local evidence includes the
selector collision check and observed navigation events. Other languages,
alternate layouts, and the eventual blocker itself remain to be tested.
