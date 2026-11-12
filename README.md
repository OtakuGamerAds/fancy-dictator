# Fancy Dictator

Press a shortcut, speak, and watch [Soniox](https://soniox.com) write your words live, straight
into a session you can read, edit, copy and translate while it is still being recorded.

- `Ctrl+Alt+Space` opens the window and starts recording a new session. With the window open
  it stops and starts recording, as the box does (talking again goes into the session shown);
  it never hides the window (**—** does).
- The box is the talk button: click anywhere in it to start the mic. What you say goes into
  the session shown under it, filling in as you speak (the newest words stay in view unless you
  scroll up to read; **Scroll to end** follows them again). Talking again carries on in the
  session shown, in a new bubble (each recording its own, even with one voice), and so does
  speaking again after 10 seconds of silence; the **new session** button (the pen, at the top
  right) starts a new one (it stays shown, empty, if a recording into it ends with nothing said).
- What Soniox hears is muted while nobody speaks (the hiss gate of livecall-caption-web-v2: a
  "Remove Silence" gate told by a voice detector 40 ms ahead), so the hiss and murmur between
  words are not written as words, live and in Replay's transcriptions. The recordings kept are
  as heard.
- What is written is left to Soniox, told what we want before it hears anything (its context):
  Arabic mixed with the other languages picked, each word written in the language it is said in
  ("الـ preference", not "البريفرنس"), without hesitations (آه، أمم); and **Your words**
  (Settings): names and English or German words you say, written as you list them ("rename",
  not "رينيم"; "Claude Code", not "كلود كود"). It starts with a list of software words; add your
  own.
- Words stay faint (still being decided) until Soniox has heard a few seconds past them: a
  dictation does not ask Soniox where you stop (its endpoints), which would settle the words at
  every pause; Stop settles the rest at once. On real recordings this wrote mixed languages
  better and nothing worse. A conversation keeps the endpoints: its bubbles end at them.
- **Translate** (beside the languages in the box) translates what is said live, into the
  language picked, with Soniox's own real-time translation: each bubble's translation shows
  under it as it is said, and is saved with the session. The bubble and its translation are
  edited each on their own (one never changes the other). Selecting words to translate them
  (below) works as well, apart from it. Replay's transcriptions are not translated.
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
- **Stop** (or `Ctrl+Enter`, `Esc`, or the shortcut again) ends the recording; the session is
  saved where it is shown. Under the box is one session at a time, the latest; the arrows under
  it, or the list between them (each session named by when it was recorded), show another.
  Hiding the window ends a recording too.
- The bar under the session: the sessions in the middle, and the shown one's copy (a
  conversation's offers one speaker only too) and delete on the right. **Clear all sessions**
  is at the end of the sessions' list.
  Long bubbles fold to 3 lines (while recording, all but the one being said): click into one to
  edit it, even while it is being recorded (a saved session is saved when you click away), or
  unfold them all with **Show all** on the bar. Words dragged over (or double-clicked) in a
  bubble can be typed over at once; words still coming land after them, and the list holds
  still while you edit. Drag across as many bubbles as you like to select and copy them.
- Select words in a session (while it is being recorded too) and the left of the bar offers to
  translate them: the language (remembered) and the translate icon. The translation shows under
  the bubble they were selected in, with its own copy icon. Google Translate's free service does
  it (no key); only the selected words are sent.
- Each session keeps the voice it was dictated with, one clip per recording (talking again
  adds the next), shown on a line where that recording began: press ▶ on one to listen again,
  and click along it to jump there.
- **Replay** (Settings → Replay, keeping the last 1 to 90 minutes; 60 to start with) keeps recording your mic and
  the computer's audio on this device, deleting what is older, so a conversation can be caught
  after it started: **replay** in the box shows the timeline; click it to listen, drag
  its **In** and **Out** marks to the part to keep (as in a video editor), and **Transcribe**
  turns it into a session as if it had been recorded live from In (Soniox's async API; nothing
  leaves the device before). **Keep going live** carries on recording into the same session
  (Out is then now). **Clean up after** (on by default) forgets everything up to Out once the
  session is made, so Replay starts over from there. The app's own sound (Replay played back,
  messages' recordings) is left out of the computer's audio. Windows shows the microphone in use
  while Replay is on.
- The languages Soniox listens for are picked at the bottom-left of the box.
- The toolbar has settings and updates at the left; new session, the sessions arrow and **—**
  (hide) at the right.
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
