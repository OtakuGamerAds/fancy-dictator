// Adapted from T3 Code (https://github.com/pingdotgg/t3code), MIT License — see THIRD_PARTY_LICENSE_T3CODE.txt
// T3 resolves the audio's URL from its asset server once the chip scrolls into view; here the
// app serves each recording of a message at fd-audio://audio/<id>/<clip> (electron/main.cjs).
import { useEffect, useRef, useState } from "react";

import { AudioPreview } from "./AudioPreview";

export function InlineAudioPreview(props: {
  readonly name: string;
  /** The message whose audio this plays, and which of its recordings. */
  readonly audioId: string;
  readonly clip: number;
  readonly variant?: "chip" | "bubble";
}) {
  const container = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const src = visible
    ? `fd-audio://audio/${encodeURIComponent(props.audioId)}/${props.clip}?try=${attempt}`
    : undefined;
  const failed = src !== undefined && failedSrc === src;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- IntersectionObserver defers loading the audio until the element scrolls into view
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <span ref={container}>
      <AudioPreview
        compact
        variant={props.variant ?? "chip"}
        name={props.name}
        src={src ?? ""}
        revision={`${props.audioId}/${props.clip}`}
        failed={failed}
        onRetry={() => {
          setFailedSrc(null);
          setAttempt((value) => value + 1);
        }}
        onError={() => setFailedSrc(src ?? null)}
      />
    </span>
  );
}
