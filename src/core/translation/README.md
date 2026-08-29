# Translation core

This directory owns BabelBox's DOM-to-translation-candidate policy. Callers
outside the directory import `public.ts`; WXT treats a directory-level
`index.ts` as an entrypoint, so this package intentionally has no `index.ts`.

## Pipeline

1. `filters.ts` normalizes editable global/site rules and resolves the current URL policy.
2. `dom.ts` applies the policy plus BabelBox DOM ownership guards.
3. `registry.ts` selects runtime-only site adapters for the current URL.
4. `engine.ts` resolves configured include rules, adapter decisions and generic layout boundaries.
5. `text.ts` extracts readable source text and rejects identifiers/target text.
6. `serialization.ts` prepares safe rich-text input for providers.
7. `src/features/full-page-translation/content/runtime.ts` is the runtime port
   for scheduling, provider requests and rendering. Hover and full-page
   translation both enter through the same
   `TranslationCandidateCore` and the same `translateTarget` function.

## Decision model

Global and site filters use top-to-bottom, first-match CSS rules with `exclude`
or `include` actions. A matching site rule wins on the same element, then the
global rule list and hidden/editable switches apply. A child include cannot reopen an
excluded ancestor. Scripts/styles, form inputs, code, `translate=no`, SVG/math,
and the supported-site selectors are stored as editable defaults rather than
engine constants. BabelBox-owned DOM is always excluded.

Runtime adapters can still return `pass`, `skip-self`, `prune-subtree` or
`force-target`, but default translation filtering does not live in adapters.
Adapters are sorted by priority, while registration order is stable for ties.
Invalid configured selectors only invalidate that match and never abort the page scan.

Every accepted candidate includes a reason and optional adapter id. Hover and
full-page translation use the same candidate result, including in open Shadow DOM.

## Verification contract

`tests/translationCore.test.ts` covers generic and adapter decisions. The real
site contract lives in `tests/browser-translation-cases.json` and is executed by
`scripts/run-site-translation-test.cjs` or
`scripts/run-site-translation-matrix.cjs`. A required case must pass both hover
and full-page translation, restore its original DOM, translate again without
duplicate/nested wrappers, preserve forbidden DOM and keep interactions stable.
