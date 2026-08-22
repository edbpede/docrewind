<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A grouped settings row carrying a byte budget as a unit-suffixed number field.
  // Keeps `type="number"` + `min` and the original label association so
  // `findByLabelText` and `.value` stay stable.
  //
  // Split out of `OptionsApp.svelte`: Svelte allows one component per file, and this
  // is a reused row shape rather than a one-off fragment.

  interface BudgetRowProps {
    readonly id: string;
    readonly label: string;
    readonly value: number;
    readonly onInput: (mib: number) => void;
  }

  let { id, label, value, onInput }: BudgetRowProps = $props();
</script>

<!--
  Explicit `for`/`id` association (not a wrapping label) so the input's
  accessible name is EXACTLY the title — the friendly "MB" suffix must not leak
  into it (tests query `findByLabelText("Global cap (MB)")` etc.).
-->
<div class="dr-row">
  <label for={id} class="dr-row-label">
    {label}
  </label>
  <span class="dr-field">
    <input
      {id}
      type="number"
      min={1}
      class="dr-field-input"
      {value}
      onchange={(event) => onInput(Number(event.currentTarget.value))}
    />
    <span class="dr-field-suffix" aria-hidden="true">MB</span>
  </span>
</div>
