// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Slides presentation reconstruction engine. Applies decoded Slides operations to
// the mutable {@link PresentationModel}. This is the CLOSED-WORLD core: it switches
// over the `SlidesOperation` union with a `never` exhaustiveness default (adding a
// variant in `slides-decoder/types.ts` without an arm here is a compile error) —
// independent of the Docs and Sheets `apply.ts` gates.
//
// Open-world degradation is honest, never silent: a `SlidesUnknownOp` or a
// `modelVersion` mismatch appends a privacy-safe {@link SlidesFidelityNotice} that
// the UI surfaces calmly. It NEVER throws.
//
// PURE: no browser / fetch / Worker.

import type { ShapeId, SlidesDecodedRevision, SlidesOperation } from "../slides-decoder/types";
import type { PresentationModel, ShapeModel, SlidesFidelityNotice } from "./model";

/** Text-box / background Punch type codes (mirrors the render projection). */
const TYPE_TEXT = 108;
const TYPE_BACKGROUND = 158;

/** Append a fidelity notice, de-duplicated by (kind, detail). */
function pushNotice(model: PresentationModel, notice: SlidesFidelityNotice): void {
  if (model.fidelityNotices.some((n) => n.kind === notice.kind && n.detail === notice.detail)) {
    return;
  }
  model.fidelityNotices.push(notice);
}

/**
 * Flag a value-bearing shape the render pass can never place. A null transform means
 * the 6-number matrix failed to decode, so render drops the shape: harmless for an
 * empty text placeholder or a background frame (they draw nothing), but a text box
 * carrying real text or an embedded media object would vanish silently. Record an
 * honest, content-free `unplaced-shape` notice (deduped by type code) so
 * `hasFidelityNotice()` reports the loss instead of hiding it — the same "degradation
 * is honest, never silent" contract the unknown-op / version-mismatch notices uphold.
 * Called after each mutation that can decide a shape's placeability; a later re-create
 * that supplies a transform makes the shape placeable but cannot retract the notice,
 * so this over-reports in that rare case rather than ever under-reporting a real loss.
 */
function noteUnplaceableShape(model: PresentationModel, shape: ShapeModel): void {
  if (shape.transform !== null || shape.shapeType === TYPE_BACKGROUND) return;
  const hasValue = shape.shapeType === TYPE_TEXT ? shape.text.trim().length > 0 : true;
  if (hasValue) {
    pushNotice(model, { kind: "unplaced-shape", detail: String(shape.shapeType) });
  }
}

/** Splice `text` into `shape.text` at a clamped UTF-16 offset. */
function insertText(shape: ShapeModel, offset: number, text: string): void {
  const at = Math.min(Math.max(0, offset), shape.text.length);
  shape.text = shape.text.slice(0, at) + text + shape.text.slice(at);
}

/** Delete the clamped half-open UTF-16 range `[start, end)` from `shape.text`. */
function deleteText(shape: ShapeModel, start: number, end: number): void {
  const a = Math.min(Math.max(0, start), shape.text.length);
  const b = Math.min(Math.max(a, end), shape.text.length);
  shape.text = shape.text.slice(0, a) + shape.text.slice(b);
}

/** Get a shape by id, or undefined (a text op on a missing shape is ignored). */
function getShape(model: PresentationModel, id: ShapeId): ShapeModel | undefined {
  return model.shapes.get(id);
}

/**
 * Apply one decoded Slides operation to the model. Closed-world: the `default` arm
 * is a `never` exhaustiveness gate.
 */
export function applySlidesOperation(model: PresentationModel, op: SlidesOperation): void {
  switch (op.op) {
    case "txn":
      for (const sub of op.ops) {
        applySlidesOperation(model, sub);
      }
      return;
    case "page-size":
      model.pageSize = { width: op.width, height: op.height };
      return;
    case "create-shape": {
      const existing = model.shapes.get(op.shapeId);
      if (existing === undefined) {
        const created: ShapeModel = {
          id: op.shapeId,
          pageId: op.parentId,
          shapeType: op.shapeType,
          transform: op.transform,
          text: "",
        };
        model.shapes.set(op.shapeId, created);
        model.shapeOrder.push(op.shapeId);
        noteUnplaceableShape(model, created);
      } else {
        // Re-create (rare): refresh geometry/parent, keep accumulated text. Keep the
        // last known-good transform when the re-create carries none (a decode that
        // failed the 6-number matrix), so a valid shape is never silently un-placed.
        existing.pageId = op.parentId;
        existing.shapeType = op.shapeType;
        if (op.transform !== null) existing.transform = op.transform;
        noteUnplaceableShape(model, existing);
      }
      return;
    }
    case "define-page": {
      const page = model.pages.get(op.pageId);
      if (page === undefined) {
        model.pages.set(op.pageId, {
          id: op.pageId,
          pageType: op.pageType,
          layoutType: null,
        });
      } else {
        page.pageType = op.pageType;
      }
      if (op.pageType === "slide" && !model.slideOrder.includes(op.pageId)) {
        model.slideOrder.push(op.pageId);
      }
      // First themed palette (the master theme) wins; later duplicates are ignored.
      if (op.theme !== null && model.theme === null) {
        model.theme = op.theme;
      }
      return;
    }
    case "declare-placeholder": {
      const page = model.pages.get(op.pageId);
      if (page !== undefined && op.layoutType !== null) {
        page.layoutType = op.layoutType;
      }
      return;
    }
    case "insert-text": {
      const shape = getShape(model, op.shapeId);
      if (shape !== undefined) {
        insertText(shape, op.offset, op.text);
        // Inserting real text into a shape whose geometry never decoded turns a
        // harmless empty placeholder into a value-bearing shape render will drop.
        noteUnplaceableShape(model, shape);
      }
      return;
    }
    case "delete-text": {
      const shape = getShape(model, op.shapeId);
      if (shape !== undefined) deleteText(shape, op.start, op.end);
      return;
    }
    case "shape-prop":
    case "create-page":
    case "page-membership":
    case "text-style":
    case "marker":
    case "list-entity":
    case "default-style":
      // Recognized but inert in v1 — no model change, no notice. NOTE (scope): v1
      // models slide ADDITION (a `define-page` with pageType 0 appends to
      // `slideOrder`), which is the common "deck built up over its history" path and
      // the live-verified case. Slide REMOVAL and REORDER — if Google expresses them
      // via `create-page` (9) / `page-membership` (13), which also fire during the
      // benign initial template build — are a known v1 limitation: they are neither
      // applied nor noticed here, so a mid-history delete/reorder can leave a ghost
      // slide. This is a deliberate additive-only scope, not a silent op drop (every
      // UNRECOGNIZED op still degrades to `unknown` and IS noticed above).
      return;
    case "unknown":
      pushNotice(model, { kind: "unknown-op", detail: op.opCode });
      return;
    default: {
      // Closed-world exhaustiveness gate: a new SlidesOperation variant without an
      // arm above is a compile error here (the runtime throw is unreachable —
      // decode already degrades every unrecognized opcode to SlidesUnknownOp).
      const _exhaustive: never = op;
      throw new Error(`applySlidesOperation: unhandled ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Apply every operation in one decoded revision, raising a mismatch notice first. */
export function applySlidesRevision(
  model: PresentationModel,
  revision: SlidesDecodedRevision,
): void {
  if (revision.modelVersionMismatch) {
    pushNotice(model, {
      kind: "model-version-mismatch",
      detail: String(revision.modelVersion),
    });
  }
  for (const op of revision.operations) {
    applySlidesOperation(model, op);
  }
}
