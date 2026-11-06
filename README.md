# Fancy Dictator

Press a shortcut, speak, and watch [Soniox](https://soniox.com) write your words live.
Copy the text, or send it to your recent messages.

- `Ctrl+Alt+Space` opens the window and starts recording; pressed again it stops the
  recording, or hides the window when nothing is recording.
- The empty box is the talk button: click anywhere in it to start the mic.
- **conversation** listens to the computer's audio too (the people on a call, a video). While
  recording, the mic and computer buttons next to **Stop** mute each one on its own (red while
  muted): unmuting the computer makes it a conversation, and both muted pauses the recording
  (nothing is sent to Soniox until one is back on). A conversation listens to both, each as its own Soniox stream (twice the cost while it
  runs), and writes a dialogue the way T3 Code shows a thread with a guest. Soniox also tells
  the voices of each stream apart, so two people on the call (or at your mic) are two
  speakers (up to 15 on each side). Speakers are numbered in the order they first spoke; each
  bubble has its speaker's name above it, as T3 names a guest, and a color: the first your
  message bubble, the next the guest's (pink), then blue, green and amber, then round again.
  Turns follow the order they started and are never split: if someone cuts in, the sentence
  being said stays whole and theirs comes after it. Without headphones the mic hears the call
  too; a turn from the mic that is mostly words the call just played is dropped as echo.
  Its copy icon copies the conversation ("Speaker 1: … / Speaker 2: …") or one speaker only. The saved message keeps each side's audio as its own clip ("Microphone", "Computer
  audio"), both starting when the recording did, so they line up.
- **Stop** (or `Ctrl+Enter`, `Esc`, or the shortcut again) ends the session: it is saved and
  moves below the box, which is empty for the next one. Below the box is one session at a
  time, the latest; **Show more** brings older ones. Hiding the window ends a session too.
- Copy a session with the copy icon on it (a conversation's offers one speaker only too).
  Click into any bubble's text to edit it; it is saved when you click away.
- Each message keeps the voice it was dictated with, one clip per recording ("Keep dictating"
  adds the next): press ▶ on one to listen again, and click along it to jump there.
- The languages Soniox listens for are picked at the bottom-left of the box.
- The toolbar has settings and updates at the left; the messages arrow and **—** (hide) at
  the right.
- Lives in the tray; right-click the tray icon for Settings or Quit.

## Install, update, uninstall

Like T3 Code:

- **Install:** download `Fancy-Dictator-Setup-x.y.z.exe` from
  [Releases](https://github.com/OtakuGamerAds/fancy-dictator/releases/latest) and run it. It
  installs for your user only (no admin), adds a Start menu shortcut, and starts the app.
- **Update:** the app checks for a new version at startup and every 4 minutes (it reads the
  latest release's files, so a new version shows up as soon as it is published). When there is
  one, an update button appears beside Settings: click to download (a ring shows progress),
  click again to restart into the new version.
- **Uninstall:** Windows Settings → Apps → Fancy Dictator → Uninstall. It also removes your
  settings and history.

The installer is not code-signed, so Windows SmartScreen may warn the first time
("More info" → "Run anyway").

## Publish a new version

1. Bump `version` in `package.json` and commit.
2. `pnpm release` — tags the commit, builds the installer, and publishes it to GitHub Releases
   (using the GitHub CLI's login). Installed apps pick it up through their update button.

## Run from source

```sh
pnpm install
pnpm dev        # Vite + Electron with hot reload
pnpm build      # typecheck + build the renderer
pnpm start      # run the built app
pnpm dist       # build the installer into ./release (no publishing)
pnpm snapshot   # render every view to ./snapshots/*.png (`pnpm snapshot 5e 5j`: only those)
pnpm probe      # check mic → worklet → Soniox socket (expects a 401 for the fake key) and the
                # conversation flow with scripted Soniox sockets; renders nothing
```

## Where things come from

| Part | Source |
| --- | --- |
| Stack, theme tokens, UI primitives (`src/components/ui`), composer metrics, undo notice | [T3 Code](https://github.com/pingdotgg/t3code), MIT — see `THIRD_PARTY_LICENSE_T3CODE.txt` |
| Soniox real-time session settings (endpoint detection) | live-caption-sermons |

Settings, history and the messages' audio (`audio/`, 48 kHz Opus, about 1 MB a minute per
source, recorded beside what is sent to Soniox so it sounds as recorded;
erased with its message once `Ctrl+Z` can no longer bring it back) are stored in
`%APPDATA%/fancy-dictator`. The Soniox key is
encrypted with Windows' DPAPI through Electron `safeStorage`.
