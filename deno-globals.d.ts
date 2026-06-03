/// <reference types="@types/deno" />

// Deno's own `deno check` and `deno lint` provide the authoritative
// undefined-identifier analysis for this repository.
declare const Deno: typeof globalThis.Deno
