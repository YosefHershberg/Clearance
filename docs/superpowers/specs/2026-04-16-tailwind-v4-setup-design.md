---
title: Tailwind CSS v4 Setup
date: 2026-04-16
status: approved
---

## Goal

Install and configure Tailwind CSS v4 in the `client/` package, replacing all existing hand-written CSS (except a universal box-sizing/margin/padding reset).

## Approach

Use the `@tailwindcss/vite` first-party plugin — the officially recommended path for Vite projects. No PostCSS config needed.

## Changes

### 1. Install packages (client/)

```
tailwindcss         (core, v4)
@tailwindcss/vite   (Vite plugin)
```

Both as devDependencies.

### 2. `client/vite.config.ts`

Add `tailwindcss()` to the plugins array.

### 3. `client/src/index.css`

Replace entire file with:

```css
@import "tailwindcss";

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
```

### 4. `client/src/App.css`

Delete the file and remove its import from `App.tsx`.

## Out of scope

- No `tailwind.config.js` — Tailwind v4 uses CSS-first config via `@theme` when customization is needed.
- No CSS migration — existing component styles are being removed intentionally.
