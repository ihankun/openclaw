# Electron Dashboard Guide

This directory is the Electron-owned Control UI fork. Keep its presentation independently
maintainable while preserving compatibility with the current root Gateway contracts.

## i18n Rules

- Foreign-language locale bundles in `dashboard/src/i18n/locales/*.ts` are copied generated output.
- Do not hand-edit non-English locale bundles or `dashboard/src/i18n/.i18n/*` unless a targeted generated-output fix is explicitly requested.
- The dashboard source of truth is `dashboard/src/i18n/locales/en.ts` plus the runtime wiring in:
  - `scripts/control-ui-i18n.ts`
  - `dashboard/src/i18n/lib/types.ts`
  - `dashboard/src/i18n/lib/registry.ts`
- The root i18n generator still targets `ui/`. Do not run it against this fork without first
  adding an explicit dashboard target.
- If dashboard locale outputs need regeneration, add that target to the root generator rather
  than copying newly generated root UI output implicitly.

## Scope

- Keep dashboard-specific rules here.
- Leave repo-global architecture, verification, and git workflow rules in the root `AGENTS.md`.
