// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import {
  DEFAULT_ALLOWED_ASSOCIATIONS,
  DEFAULT_REVIEW_ON_DRAFT,
  DEFAULT_TRIGGER_COMMAND,
} from "../policy";

const workflow = await Bun.file(
  new URL("../../../.github/workflows/ai-review.yml", import.meta.url),
).text();

describe("ai-review workflow hardening", () => {
  it("checks out only the trusted base branch without persisting credentials", () => {
    const trustedBaseRef = "ref: $" + "{{ github.event.repository.default_branch }}";
    expect(workflow).toContain(trustedBaseRef);
    expect(workflow).toContain("persist-credentials: false");
  });

  it("installs dependencies without implicit package lifecycle scripts", () => {
    expect(workflow).toContain("bun install --frozen-lockfile --ignore-scripts");
  });

  it("keeps the automatic draft gate aligned with shared policy defaults", () => {
    expect(DEFAULT_REVIEW_ON_DRAFT).toBe(false);
    expect(workflow).toContain("github.event.pull_request.draft == false");
  });

  it("keeps the issue-comment gate aligned with shared policy defaults", () => {
    expect(workflow).toContain(
      `startsWith(github.event.comment.body, '${DEFAULT_TRIGGER_COMMAND}')`,
    );
    expect(workflow).toContain(JSON.stringify([...DEFAULT_ALLOWED_ASSOCIATIONS]));
  });
});
