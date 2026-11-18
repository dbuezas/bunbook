/**
 * Language id of BunBook code cells.
 *
 * Cells deliberately do not use the plain "typescript" id: VS Code's built-in
 * TypeScript extension attaches to every "typescript" notebook cell and checks
 * each one as an isolated file, so it would add a second (wrong) set of hovers,
 * completions and diagnostics next to BunBook's. This id reuses the TypeScript
 * grammar for highlighting while keeping the built-in language service away.
 */
export const CELL_LANGUAGE = "bunbook-typescript";

/** Language id used by notebooks created before CELL_LANGUAGE existed. */
export const LEGACY_CELL_LANGUAGE = "typescript";

/** Languages BunBook executes and provides intellisense for. */
export const SUPPORTED_CELL_LANGUAGES = [CELL_LANGUAGE, LEGACY_CELL_LANGUAGE];
