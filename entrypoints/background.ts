// SPDX-License-Identifier: AGPL-3.0-or-later
export default defineBackground(() => {
  // Phase 4 implements resumable revision retrieval here. Per the WXT background
  // contract, ALL browser.* usage must stay inside this callback — top-level
  // browser.* runs in WXT's Node build context and throws.
});
