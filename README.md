# Fancy Dictator

Press a shortcut, speak, and watch [Soniox](https://soniox.com) write your words live.
Copy the text, or send it to your recent messages.

- `Ctrl+Alt+Space` opens the window and starts recording; pressed again it stops the
  recording, or hides the window when nothing is recording.
- The send button (or `Ctrl+Enter`) turns the box into a message in the history below,
  like sending in T3 Code. Hiding the window does the same, so it always opens clean.
- The languages Soniox listens for are picked beside the send button.
- The first ✕ clears the box (`Ctrl+Z` brings it back); the next one hides the window.
- Lives in the tray; right-click the tray icon for Settings or Quit.

## Install, update, uninstall

Like T3 Code:

- **Install:** download `Fancy-Dictator-Setup-x.y.z.exe` from
  [Releases](https://github.com/OtakuGamerAds/fancy-dictator/releases/latest) and run it. It
  installs for your user only (no admin), adds a Start menu shortcut, and starts the app.
- **Update:** the app checks for a new version at startup and every 4 minutes. When there is
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
pnpm snapshot   # render every view to ./snapshots/*.png
pnpm probe      # check mic → worklet → Soniox socket (expects a 401 for the fake key)
```

## Where things come from

| Part | Source |
| --- | --- |
| Stack, theme tokens, UI primitives (`src/components/ui`), composer metrics, undo notice | [T3 Code](https://github.com/pingdotgg/t3code), MIT — see `THIRD_PARTY_LICENSE_T3CODE.txt` |
| Soniox real-time session settings (`stt-rt-v5`, endpoint detection) | live-caption-sermons |

Settings and history are stored in `%APPDATA%/fancy-dictator`. The Soniox key is
encrypted with Windows' DPAPI through Electron `safeStorage`.
