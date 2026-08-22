<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Toolchain smoke fixture for `test/smoke.test.ts`. The Solid version of that
  // test rendered bare inline JSX; Svelte has no inline-component form, so the
  // same "does the WXT/Vitest/compiler pipeline produce real DOM?" check needs a
  // real component file. Deliberately trivial: no props, no state, no styles.
</script>

<div>ok</div>
