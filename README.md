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

## Run

```sh
pnpm install
pnpm dev        # Vite + Electron with hot reload
pnpm build      # typecheck + build the renderer
pnpm start      # run the built app
pnpm dist       # portable .exe in ./release
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
