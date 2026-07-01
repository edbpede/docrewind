// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Slides revision → slide attribution. Answers "which user-visible slide did this
// revision edit?" so the replay surface can FOLLOW edits across a multi-slide deck
// (the Slides analogue of the Docs follow-caret). The reconstruction core knows
// shapes by id and slides by page id, but a text op names only its shape — so
// resolving a revision to a slide needs BOTH the op stream AND the model state at
// that revision (to map shape → owning page → slide index). This pure join lives
// here rather than in `apply.ts` (which stays a closed-world mutation core).
//
// PURE: no browser / fetch / Worker.

import type {
  PageId,
  ShapeId,
  SlidesDecodedRevision,
  SlidesOperation,
} from "../slides-decoder/types";
import type { PresentationModel } from "./model";

/**
 * The 0-based index (within `model.slideOrder`) of the user-visible slide this
 * revision last touched, or null when the revision edits no slide that exists in
 * `model` — a pre-history/template op, an edit confined to a layout/master page, or
 * a text op on a shape that is not present at this frame.
 *
 * `model` MUST be the presentation state AFTER this revision is applied, so that a
 * shape created in the same revision — and a slide added in it — both resolve. When
 * a revision spans more than one slide (rare: a batched edit across the deck), the
 * LAST touched slide wins, matching where the caret would come to rest.
 *
 * Only slide-LOCATING edits count: text inserts/deletes, shape creation, and a new
 * slide page. Style/marker/membership/placeholder ops carry no "where the author is
 * working" signal, so they never move the follow target (and never throw — the join
 * is open-world tolerant, mirroring the decode funnel).
 */
export function slideIndexOfRevision(
  model: PresentationModel,
  revision: SlidesDecodedRevision,
): number | null {
  let touched: number | null = null;

  const slideIndexOfPage = (pageId: PageId): number | null => {
    const index = model.slideOrder.indexOf(pageId);
    return index >= 0 ? index : null;
  };

  const slideIndexOfShape = (shapeId: ShapeId): number | null => {
    const shape = model.shapes.get(shapeId);
    return shape === undefined ? null : slideIndexOfPage(shape.pageId);
  };

  const visit = (op: SlidesOperation): void => {
    switch (op.op) {
      case "txn":
        for (const sub of op.ops) visit(sub);
        return;
      case "create-shape": {
        const index = slideIndexOfPage(op.parentId);
        if (index !== null) touched = index;
        return;
      }
      case "insert-text":
      case "delete-text": {
        const index = slideIndexOfShape(op.shapeId);
        if (index !== null) touched = index;
        return;
      }
      case "define-page": {
        if (op.pageType === "slide") {
          const index = slideIndexOfPage(op.pageId);
          if (index !== null) touched = index;
        }
        return;
      }
      default:
        // page-size, shape-prop, create-page, page-membership, declare-placeholder,
        // text-style, marker, list-entity, default-style, unknown: not a
        // slide-locating edit. Ignored, never a throw.
        return;
    }
  };

  for (const op of revision.operations) visit(op);
  return touched;
}
