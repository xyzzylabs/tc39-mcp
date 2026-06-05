// Shared Zod argument fragments for the edition-aware tools. Every tool
// that reads a (spec, edition) reuses these instead of repeating the
// `.enum().default().describe()` chain inline — one place to update when
// a new ECMA edition lands, instead of a dozen.
//
// The docs generator (`src/docs/build_api_reference.ts`) resolves these
// imports, so `docs/tools.md` still renders the full type + default +
// description for `spec`/`edition` on every tool.

import { z } from "zod";
import { SPEC_VALUES, EDITION_VALUES } from "../editions.js";

/** Which TC39 spec a tool reads. Defaults to ECMA-262. */
export const specArg = z
  .enum(SPEC_VALUES)
  .default("262")
  .describe(
    "Which TC39 spec to read: '262' (core language, default) or '402' (Internationalization API).",
  );

/** Which edition of the chosen spec. Defaults to the spec-aware `latest`. */
export const editionArg = z
  .enum(EDITION_VALUES)
  .default("latest")
  .describe(
    "Edition within the chosen spec. ECMA-262: es2016 … es2026, main. ECMA-402: es2016 … es2026, main. Aliases: latest, draft, next.",
  );
