<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A grouped settings row carrying a boolean as a friendly switch. A real
  // `<input type="checkbox">` is kept (visually-hidden via `sr-only peer`) so the
  // label association, `checked` state, and the existing tests/e2e selectors stay
  // intact; the switch track + knob are painted with `peer-checked:` utilities. The
  // one-line help sits OUTSIDE the `<label>` so the input's accessible name remains
  // exactly the title text.
  //
  // Split out of `OptionsApp.svelte`: Svelte allows one component per file, and this
  // is a reused row shape rather than a one-off fragment.

  interface SwitchRowProps {
    readonly label: string;
    readonly help: string;
    readonly checked: boolean;
    readonly onChange: (next: boolean) => void;
  }

  let { label, help, checked, onChange }: SwitchRowProps = $props();
</script>

<div class="dr-row-stack">
  <label class="flex cursor-pointer items-center justify-between gap-4">
    <span class="dr-row-label">{label}</span>
    <span class="relative inline-flex shrink-0 items-center">
      <input
        type="checkbox"
        class="peer sr-only"
        {checked}
        onchange={(event) => onChange(event.currentTarget.checked)}
      />
      <span
        class="block h-[1.6rem] w-[2.75rem] rounded-full bg-hairline-strong transition-colors duration-200 ease-[var(--dr-ease-out)] peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface"
        aria-hidden="true"
      ></span>
      <span
        class="pointer-events-none absolute left-[0.2rem] size-[1.2rem] rounded-full bg-white shadow-[var(--dr-shadow-sm)] transition-transform duration-200 ease-[var(--dr-ease-out)] peer-checked:translate-x-[1.15rem]"
        aria-hidden="true"
      ></span>
    </span>
  </label>
  <p class="dr-row-help">{help}</p>
</div>
