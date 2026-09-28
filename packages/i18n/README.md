# Internationalization

Alloy uses English source text as message keys. `t("Settings")` translates
with the active client locale; `translate(locale, "Settings")` uses an
explicit locale, including on the server. Unknown runtime messages fall back
to their original text.

## Add or change a message

1. Write a literal English key in `t()` or `translate()`.
2. Add its translation to the matching feature file in each non-English
   catalog registered in `src/locales.ts`. German lives in `src/catalogs/de/`;
   see the ownership guide below. Reuse an existing key rather than copying
   it into another feature file.
3. Run `pnpm test:i18n` from the repository root, then `pnpm verify`.

Use named placeholders rather than building translated sentences:

```ts
t("Hello {name}", { name })
tp(count, "{count} game", "{count} games")
```

Include both plural forms explicitly. The helpers currently support `one`
and `other`, which cover English and German. A language with additional
cardinal forms needs an extension to the plural API before it can ship.

For text stored in metadata and translated later, mark the source:

```ts
const label = message("Resolution")
translate(locale, label)
```

Import these helpers directly from `@alloy/i18n`. Named import aliases and
namespace imports are supported by the source checks. Keep theme names,
codec names, and other non-translated search aliases separate from marked
messages.

## What the tests check

`pnpm test:i18n` runs the same tests as the normal `pnpm test` CI job:

- Parse production TypeScript and TSX across `packages/*/src` for literal
  `t`, `translate`, `tp`, `translatePlural`, and `message` calls.
- Require every non-English catalog to translate those keys and all keys
  already registered in any catalog. The latter includes known server and
  recorder errors translated through dynamic lookup.
- Reject empty translations, missing or renamed placeholders, and lost
  leading or trailing whitespace in sentence fragments.
- Reject duplicate keys across feature files, even when their translations
  are identical. Typechecking also rejects duplicate keys within one object.
- Exercise language selection, persistence, English fallback, interpolation,
  and plural behavior.

Missing-key failures include the source file and line. The extractor has its
own regression tests, including aliases, multiline calls, and plural keys.
Babel is a test-only dependency and is not part of the client runtime.

These checks prove coverage of declared messages, not linguistic quality.
They cannot identify arbitrary unmarked JSX text or predict third-party
error strings. Mark application-owned deferred text with `message()`;
reserve unmarked dynamic lookup for runtime messages. Unchanged translations
are allowed because terms such as `Webhooks` and product names are valid in
both languages.

## Add a language

1. Create `src/catalogs/<language>/` with the same feature files as German.
   Use the German catalog as a key inventory, but translate the English keys.
   Each file exports an object with `satisfies TranslationCatalog`.
2. Combine the feature files in that directory's `index.ts` using
   `mergeCatalogs` from `../catalog`. Do not spread another language's
   catalog into it to hide missing entries.
3. Import the combined catalog in `src/locales.ts` and add an entry with the
   base language code, its native display label, a language tag for formatting,
   and the catalog.
4. Run `pnpm test:i18n` and fill all missing entries. Check that the language's
   plural rules fit the API described above.
5. Check the app in that language, especially settings search, plural text,
   and text that can overflow controls.

The locale type, supported-language list, language picker labels, detection,
formatting tags, runtime lookup, and coverage tests derive from that one
registry. There is no second language list to update.

## Catalog organization

Each language has feature files that combine into one flat runtime catalog:

```text
src/catalogs/
  catalog.ts
  de/
    common.ts
    account.ts
    settings.ts
    media.ts
    desktop.ts
    admin.ts
    errors.ts
    index.ts
```

Choose a file by what the message describes, not just where a component lives:

| File          | Owns                                                               |
| ------------- | ------------------------------------------------------------------ |
| `common.ts`   | Reusable UI actions, labels, and formatting fragments              |
| `account.ts`  | Profiles, sign-in, passkeys, linked accounts, and account data     |
| `settings.ts` | General settings, language, appearance, themes, and navigation     |
| `media.ts`    | Clips, screenshots, library, uploads, editing, and playback        |
| `desktop.ts`  | Recording, capture, audio devices, server connections, and updates |
| `admin.ts`    | Server configuration, providers, moderation, games, and webhooks   |
| `errors.ts`   | Shared failure UI and runtime/server errors                        |

Sort entries by their English key using JavaScript's default string order.
Keep each key in exactly one file per language. Settings search reuses keys
from the feature they describe, so recording keywords stay with desktop text
and administration keywords stay with admin text. Do not duplicate a key just
because a second feature uses it; move broadly reusable messages to `common`
when that makes their ownership clearer.

Keep feature-specific validation and action errors with the feature. Use
`errors` for shared failure UI and messages translated through runtime lookup.

`catalog.ts` defines the shared catalog type and `mergeCatalogs`, which throws
on duplicate keys instead of silently overwriting them. The language's
`index.ts` lists its feature catalogs explicitly. Add new feature files there
and mirror them in the other languages.

The file boundaries do not change lookup keys or the public `t()` API.
Translations are still bundled together; this structure does not introduce
runtime namespaces or lazy loading.
