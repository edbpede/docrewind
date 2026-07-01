// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Content-script affordance tests (plan §1.6, Vitest tier). Covers explicit-
// activation-only behavior, shadow-root isolation, and the typed-messaging
// trigger. Doc detection / id extraction is bun-tested in lib/core/docs-url.

import { fireEvent, render as renderTL } from "@solidjs/testing-library";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
import ReplayAffordance from "@/components/replay/ReplayAffordance";
import { asDocId } from "@/lib/core/domain/ids";
import { onMessage, removeAllListeners, sendMessage } from "@/lib/platform/messaging";

describe("ReplayAffordance", () => {
  it("renders a button and does NOT activate on mount", () => {
    const onActivate = vi.fn();
    const { getByRole } = renderTL(() => <ReplayAffordance onActivate={onActivate} />);
    // The label pairs an icon glyph with text (§9.11), so assert containment.
    expect(getByRole("button").textContent).toContain("Replay revisions");
    expect(onActivate).not.toHaveBeenCalled(); // no auto-load (PRD §9.2)
  });

  it("activates only on explicit click", async () => {
    const onActivate = vi.fn();
    const { getByRole } = renderTL(() => <ReplayAffordance onActivate={onActivate} />);
    await fireEvent.click(getByRole("button"));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("opts into the smaller chip only when compact (dense Classroom chrome)", () => {
    const { getByRole, unmount } = renderTL(() => (
      <ReplayAffordance onActivate={() => {}} compact />
    ));
    // Compact swaps the whole secondary class (self-contained, not a size override).
    expect(getByRole("button").classList).toContain("btn-secondary-compact");
    expect(getByRole("button").classList).not.toContain("btn-secondary");
    unmount();
    // Default (Docs titlebar) keeps the full-size secondary pill.
    const { getByRole: getDefault } = renderTL(() => <ReplayAffordance onActivate={() => {}} />);
    expect(getDefault("button").classList).toContain("btn-secondary");
    expect(getDefault("button").classList).not.toContain("btn-secondary-compact");
  });

  it("mounts inside a shadow root, isolated from the light DOM", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const dispose = render(
      () => <ReplayAffordance onActivate={() => {}} />,
      shadow as unknown as HTMLElement,
    );
    expect(shadow.querySelector("button")).not.toBeNull();
    // Encapsulated: a light-DOM query cannot see the shadow button.
    expect(document.body.querySelector("button")).toBeNull();
    dispose();
    host.remove();
  });
});

describe("content-script trigger wiring", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    removeAllListeners();
  });

  it("a click sends a typed activateReplay message", async () => {
    let received: { docId: string; userIndex: number | null } | null = null;
    onMessage("activateReplay", ({ data }) => {
      received = { docId: data.docId, userIndex: data.userIndex };
    });

    const docId = asDocId("docCONTENT");
    const { getByRole } = renderTL(() => (
      <ReplayAffordance
        onActivate={() => {
          void sendMessage("activateReplay", { docId, userIndex: 1 });
        }}
      />
    ));
    await fireEvent.click(getByRole("button"));
    await vi.waitFor(() => expect(received).not.toBeNull());
    expect(received).toEqual({ docId: "docCONTENT", userIndex: 1 });
  });
});
