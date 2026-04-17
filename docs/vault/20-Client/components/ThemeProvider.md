---
title: ThemeProvider
type: component
layer: client
tags:
  - client
  - component
  - state
  - theming
source: client/src/components/theme-provider.tsx
---

# ThemeProvider

React context provider for the app theme (`light` | `dark` | `system`). Persists choice to `localStorage` under `clearance-theme` and toggles the `dark` class on `<html>`.

Exposes the `useTheme()` hook for consumers.

## API

- `<ThemeProvider>{children}</ThemeProvider>` — wraps the tree
- `useTheme()` → `{ theme, setTheme }` — throws if used outside the provider

## Links
- Wrapped at → [[main]]
- Consumed by → [[ModeToggle]]
- Source: [client/src/components/theme-provider.tsx:14](../../../client/src/components/theme-provider.tsx)

> [!bug] Listener leak on `system`
> `mq.addEventListener('change', () => apply('system'))` and the cleanup `removeEventListener` use **different** function references, so the listener is never actually removed. See [client/src/components/theme-provider.tsx:31](../../../client/src/components/theme-provider.tsx).
