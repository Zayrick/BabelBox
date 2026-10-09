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
7. `src/features/full-page-translation/content/` is the runtime port.
   `pipeline.ts` turns a candidate into a provider request and renders it;
   hover and full-page translation share the same `TranslationCandidateCore`
   and the same `translateTarget` function. `session.ts` owns full-page
   discovery, visibility scheduling and host mutation handling.

## Runtime ownership

Every BabelBox DOM write in a full-page session runs through `ownWrite()`, which
drains the session MutationObserver before and after the write. The session
therefore only sees host mutations and never infers ownership from text or
attribute values. Text nodes rewritten by single/control rendering are recorded
with their owner, original and written value; source extraction maps a target's
own rewritten text back to its original and skips text written by other targets.

When a host re-renders identical source, the page-scoped translation memo
re-applies the result without a request. When a host undoes a fresh BabelBox
write (removes the target or writes the source back within one second) three
times for the same source, the session leaves that source untranslated.

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

`tests/translationCore.test.ts` covers generic and adapter decisions;
`tests/fullPageTranslation.test.ts` runs the real runtime against a real
MutationObserver, including hosts that fight BabelBox's DOM writes. The real
site contract lives in `tests/browser-translation-cases.json` and is executed by
`scripts/run-site-translation-test.cjs` or
`scripts/run-site-translation-matrix.cjs`. A required case must pass both hover
and full-page translation, restore its original DOM, translate again without
duplicate/nested wrappers, preserve forbidden DOM and keep interactions stable.
