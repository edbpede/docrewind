<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Host component for `test/theme-sync.test.ts`. `useThemeSync` is a `.svelte.ts`
  // rune module built on `$effect`, which requires a component context to own the
  // subscriptions' setup and teardown — so it cannot be called from a bare test
  // body. Mounting and unmounting this host is exactly what drives that lifecycle.
  //
  // Deliberately empty otherwise: the assertions are all about `<html>` and the
  // two subscriptions, never about rendered markup.

  import { useThemeSync } from "@/components/common/theme-sync.svelte";

  useThemeSync();
</script>
