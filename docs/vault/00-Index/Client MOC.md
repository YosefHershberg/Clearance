---
title: Client MOC
type: moc
tags:
  - moc
  - client
---

# Client MOC

React 19 + Vite + TypeScript. Tailwind v4. shadcn/ui on top of Base UI primitives.

## Entry & shell
- [[main]] — bootstraps React, mounts [[ThemeProvider]] + [[App]]
- [[App]] — root component (currently a placeholder)

## Components
- [[ThemeProvider]] — theme context (light/dark/system)
- [[ModeToggle]] — UI control to switch theme
- [[Button]] — shadcn button on Base UI primitive
- [[DropdownMenu]] — shadcn dropdown on Base UI primitive

## Hooks
> [!info] No custom hooks yet
> `client/src/hooks/` is empty.

## State
- Theme state lives in [[ThemeProvider]] (React context + `localStorage`).
> [!info] No global server-state library yet
> Client `package.json` does not include TanStack Query despite [client/CLAUDE.md](../../../client/CLAUDE.md) mentioning it.

## Pages
> [!info] No router and no pages
> Client `package.json` does not include React Router despite [client/CLAUDE.md](../../../client/CLAUDE.md) mentioning it.

## API client
- [[Client API Client]] — placeholder; nothing exists yet

## Utilities
- [[cn]] — Tailwind class merger (clsx + tailwind-merge)
