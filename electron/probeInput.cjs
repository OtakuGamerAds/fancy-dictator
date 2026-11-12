/**
 * `FD_PROBE=select pnpm probe`: words of a dictation being recorded are clicked, dragged over,
 * double-clicked and typed into with real mouse and keyboard input (Chromium's own, as a person
 * gives it), while a scripted Soniox keeps sending words (the page's __fdSnapshot.live).
 * Prints what happened at each step: editing or not, what is selected, the bubbles' words, and
 * whether the caret blinks.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function probeInput(win) {
  const wc = win.webContents;
  win.show();
  win.focus();
  wc.focus();
  const live = (call) => wc.executeJavaScript(`window.__fdSnapshot.live.${call}`);
  const state = () => live("state()");
  const rectOf = (bubble, word) => live(`rectOf(${bubble}, ${JSON.stringify(word)})`);
  const mouse = (type, x, y, clickCount = 1, down = false) =>
    wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: "left", clickCount, ...(down ? { modifiers: ["leftButtonDown"] } : {}) });
  const click = async (x, y, count = 1) => {
    for (let c = 1; c <= count; c++) {
      mouse("mouseMove", x, y);
      mouse("mouseDown", x, y, c);
      await sleep(40);
      mouse("mouseUp", x, y, c);
      await sleep(80);
    }
    await sleep(250);
  };
  const drag = async (x1, y1, x2, y2) => {
    mouse("mouseMove", x1, y1);
    mouse("mouseDown", x1, y1);
    for (let i = 1; i <= 8; i++) {
      await sleep(30);
      mouse("mouseMove", x1 + ((x2 - x1) * i) / 8, y1 + ((y2 - y1) * i) / 8, 1, true);
    }
    await sleep(30);
    mouse("mouseUp", x2, y2);
    await sleep(300);
  };
  const type = async (text) => {
    for (const ch of text) {
      wc.sendInputEvent({ type: "keyDown", keyCode: ch });
      wc.sendInputEvent({ type: "char", keyCode: ch });
      wc.sendInputEvent({ type: "keyUp", keyCode: ch });
      await sleep(40);
    }
    await sleep(200);
  };
  const key = async (keyCode) => {
    wc.sendInputEvent({ type: "keyDown", keyCode });
    wc.sendInputEvent({ type: "keyUp", keyCode });
    await sleep(200);
  };
  const mid = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
  /** Is the caret blinking? Its spot is captured every 60 ms for 2.4 s while words keep coming. */
  const blink = async () => {
    const caret = await live("caretRect()");
    if (!caret) return "no caret";
    const rect = { x: Math.max(0, Math.round(caret.left) - 2), y: Math.round(caret.top), width: 5, height: Math.max(4, Math.round(caret.bottom - caret.top)) };
    const values = [];
    for (let i = 0; i < 40; i++) {
      const image = await wc.capturePage(rect);
      const bitmap = image.toBitmap();
      let sum = 0;
      for (let p = 0; p < bitmap.length; p += 4) sum += bitmap[p] + bitmap[p + 1] + bitmap[p + 2];
      values.push(sum);
      await sleep(60);
    }
    const low = Math.min(...values);
    const high = Math.max(...values);
    if (high - low < 200) return `steady (${values.length} looks alike)`;
    const on = values.map((v) => v > (low + high) / 2);
    let flips = 0;
    for (let i = 1; i < on.length; i++) if (on[i] !== on[i - 1]) flips++;
    return `${flips} flips in 2.4 s`;
  };
  const steps = {};
  // FD_PROBE_MESSAGES: a real Soniox session's messages (recorded), played into a recording.
  if (process.env.FD_PROBE_MESSAGES) {
    const messages = JSON.parse(require("fs").readFileSync(process.env.FD_PROBE_MESSAGES, "utf8"));
    steps.started = await live("start()");
    const t0 = Date.now();
    for (const { at, data } of messages) {
      if (JSON.parse(data).finished) continue; // the recording's own Stop ends it
      const wait = t0 + at / 4 - Date.now();
      if (wait > 0) await sleep(wait);
      await live(`raw(${JSON.stringify(data)})`);
    }
    await sleep(300);
    steps.live = { bubbles: (await state()).bubbles, translations: await live("translations()") };
    wc.send("hotkey", { opened: true });
    await sleep(1500);
    steps.saved = { bubbles: (await state()).bubbles, translations: await live("translations()") };
    await live("stop()");
    return steps;
  }
  const settle = async () => {
    // Editing ends with Esc (the bubble takes it); otherwise Esc would stop the recording.
    if ((await state()).editing) await key("Escape");
    await wc.executeJavaScript("getSelection().removeAllRanges()");
    await live("stream(false)");
    await sleep(200);
  };

  try {
    await run(steps);
  } catch (error) {
    steps.failed = String(error?.stack ?? error).split(/\n/).slice(0, 2).join(" ");
    steps.failedAt = await state();
  }
  await live("stop()");
  return steps;

  async function run(steps) {
  steps.started = await live("start()");
  // Two bubbles: the first, then 11 s of silence, then the second (being said).
  await live(`say("Hello there, this is the first bubble with some words.", "", true)`);
  await live(`say("Now the second bubble starts here and goes on", " and on", false, 11000)`);
  await sleep(300);
  steps.before = await state();

  // 1. A click into the settled words of the bubble being said, while words keep coming.
  await live("stream(true)");
  let r = await rectOf(1, "second");
  await click(mid(r).x, mid(r).y);
  steps.clickWhileStreaming = await state();
  steps.clickBlink = await blink();
  await type("X");
  steps.typedAtClick = await state();
  await settle();

  // 2. Words dragged over in one bubble, then typed over.
  await live("stream(true)");
  const a = await rectOf(0, "first");
  const b = await rectOf(0, "bubble");
  await drag(a.left + 1, mid(a).y, b.right - 1, mid(b).y);
  steps.dragInBubble = await state();
  await type("Y");
  steps.typedOverDrag = await state();
  await settle();

  // 3. A word double-clicked, then typed over.
  await live("stream(true)");
  r = await rectOf(0, "Hello");
  await click(mid(r).x, mid(r).y, 2);
  steps.doubleClick = await state();
  await type("Z");
  steps.typedOverDoubleClick = await state();
  await settle();

  // 4. Across both bubbles: selected, to copy (not edited).
  await live("stream(true)");
  const from = await rectOf(0, "words");
  const to = await rectOf(1, "starts");
  await drag(from.left + 1, mid(from).y, to.right - 1, mid(to).y);
  steps.acrossBubbles = await state();
  await settle();

  // 5. A click on the faint words: the caret goes after the settled ones.
  await live("stream(true)");
  await sleep(200);
  const faint = await wc.executeJavaScript(`(() => {
    const all = document.querySelectorAll("#root li [data-turn-text] bdi, #root li > div > p[data-selectable] bdi");
    const r = all[all.length - 1]?.getBoundingClientRect();
    return r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  })()`);
  if (faint) {
    await click(faint.x, faint.y);
    steps.clickFaint = await state();
  } else steps.clickFaint = "no faint words";
  await settle();

  // 5b. Live translation: under its bubble, edited on its own (and the bubble on its own).
  await live("stream(false)");
  await live(`translate("Hallo, das ist die erste Blase mit ein paar Wörtern.")`);
  await sleep(200);
  steps.translationShown = await live("translations()");
  let t = await live(`translationRectOf(0, "erste")`);
  await click(mid(t).x, mid(t).y);
  await type("T");
  steps.translationEdited = { translations: await live("translations()"), bubble0: (await state()).bubbles[0] };
  await live(`translate(" Noch mehr.")`);
  await sleep(200);
  steps.translationGrewWhileEdited = await live("translations()");
  await settle();
  r = await rectOf(0, "there");
  await click(mid(r).x, mid(r).y);
  await type("B");
  steps.bubbleEditedAlone = { bubble0: (await state()).bubbles[0], translations: await live("translations()") };
  await settle();

  // 6. Words dragged over in the bubble being said, held a second while words settle, typed
  // over: none of the words settled meanwhile goes missing.
  await live("stream(true)");
  const c = await rectOf(1, "starts");
  const d = await rectOf(1, "here");
  await drag(c.left + 1, mid(c).y, d.right - 1, mid(d).y);
  steps.dragInLiveBubble = (await state()).selected;
  await sleep(1000);
  await type("Q");
  await sleep(800);
  steps.typedOverLiveDrag = (await state()).activeBubble;
  steps.missingAfterLiveEdit = await live("missing()");
  await settle();

  // 7. A long session (the list scrolls): an early bubble edited while words keep coming. The
  // caret stays where it is on screen, and blinks.
  for (let i = 0; i < 8; i++) await live(`say("Bubble number ${i} has a long sentence in it so that the list grows taller than the card.", "", true, 11000)`);
  await live(`say(" and this one is being said", " now", false, 11000)`);
  await sleep(300);
  await live("scrollTop()");
  await sleep(300);
  await live("stream(true)");
  r = await rectOf(1, "goes");
  await click(mid(r).x, mid(r).y);
  const caretBefore = await live("caretRect()");
  steps.longListBlink = await blink();
  const caretAfter = await live("caretRect()");
  steps.longListCaretMoved = caretBefore && caretAfter ? Math.round(caretAfter.top - caretBefore.top) : "no caret";
  steps.longListEditing = (await state()).editing;

  // 8. The recording stopped (the shortcut) while a bubble is being edited: it stays edited.
  await type("K");
  wc.send("hotkey", { opened: true });
  await sleep(1500);
  const after = await state();
  steps.stoppedWhileEditing = { editing: after.editing, caretInEditing: after.caretInEditing, kept: !!after.activeBubble?.includes("K") };
  await type("J");
  steps.typedAfterStop = (await state()).activeBubble?.slice(0, 60);
  await key("Escape");
  await sleep(400);
  steps.savedAfterStop = (await state()).bubbles[1]?.slice(0, 60);
  steps.savedTranslations = await live("translations()");

  }
};
