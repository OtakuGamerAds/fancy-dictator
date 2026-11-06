// Copied from T3 Code (https://github.com/pingdotgg/t3code), MIT License — see THIRD_PARTY_LICENSE_T3CODE.txt
/** Bubble classes for a guest's message. A pending one has a dashed edge and no fill. */
export function guestBubbleClassName(pending: boolean): string {
  return pending ? "border border-dashed border-guest/50 bg-transparent" : "bg-guest-surface";
}

/** The guest's name above their message, where "Sent by T3 Code" sits for server messages. */
export function GuestMessageName({ name }: { readonly name: string }) {
  return (
    <p className="me-1 text-2xs text-guest-foreground">
      {name}
      <span className="sr-only"> (guest)</span>
    </p>
  );
}
