# Stitch Rebuild — BuildCheck Product Screens

**Date:** 2026-04-23
**Status:** Draft — awaiting user review before generating screens
**Owner:** design exploration (Stitch), intended to feed client token updates in a follow-up

## 1. Context

The current Stitch project ("Visual System Architect", id `13266888537111944117`) carries a generic 5-screen personnel-admin mockup (Login, Dashboard Overview, Personnel Records, Personnel Form, Activity Log). None of it reflects the real app — **BuildCheck**, an Israeli building-permit compliance pre-checker for architects and project owners. Users upload a DXF (בקשת היתר) and a תב"ע PDF; the system runs a multi-phase extraction pipeline and Claude-based compliance analysis, then returns a requirement-by-requirement report and a chat surface over the uploaded drawings.

The Clearance codebase is mid-delivery of that vision: Phases 0 → 4c are merged (auth, admin, projects, file storage, job queue, DXF explore → codegen → execute → sheet render pipeline, client sheet viewer). Phases 5 → 10 are planned (TAVA+OCR, compliance agent, add-on agents, chat with SSE, polish, one-shot prompt).

This spec rebuilds the Stitch project to match BuildCheck's real product surface.

## 2. Decisions (from brainstorm)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | **Hybrid (C)** — shipped screens at high fidelity + 2–3 preview screens for phases 5–8 | Honest about today's state; gives unbuilt phases a visual target |
| Design-system role | **Stitch leads (B)** — rebrand in Stitch first, then port tokens back into the client in a follow-up | Stitch as design exploration; current `client/src/index.css` (Geist, neutral + purple tint) becomes a migration target |
| Visual personality | **Lumina-retuned (D)** — keep coral/slate palette but retune proportions for a compliance app (denser tables, less hero imagery, tighter rhythm) | Warm accent against slate reads as "professional tool, not marketing site" — balances authority with approachability |
| Typography | **Rubik (B)** — single family covering both Hebrew and Latin | Manrope lacks Hebrew; Rubik's geometric-but-soft personality matches the retuned Lumina look and holds up at table sizes |
| Direction | **RTL default** for all user-facing screens | All user copy is Hebrew; code/logs English stays out of the UI |
| Color modes | **Light only** in Stitch for now | Dark-mode tokens already exist in `client/src/index.css`; Stitch mirror stays light to keep screen count manageable |

## 3. Design tokens (Stitch design-system update)

Keep Lumina's token shape; retune values where needed. Full markdown design-system doc will be swapped into the Stitch `designMd` via `mcp__stitch__update_design_system`.

**Fonts**
- `bodyFont`, `headlineFont`, `labelFont`: `RUBIK`
- `Rubik` wired across `headline-xl/lg/md`, `body-lg/md`, `label-caps` typography tokens

**Colors (retained from Lumina)**
- Primary #FF7F50 (coral) — CTAs, active states, status accents
- Secondary #475569 (slate) — subheadings, icon backgrounds
- Tertiary #1E293B (deep slate) — headings and high-contrast text
- Neutral #F8FAFC — section backgrounds
- Functional desaturated red/amber/green for error/warning/success

**Layout adjustments (retune for compliance density)**
- Container max 1280px (unchanged)
- Section padding: **80px** (was 120px) — compliance tools prefer tighter vertical rhythm
- Stack-md: 20px (was 24px) — denser card interiors
- Table row density preset — 44px row height baseline, 12px vertical cell padding

**Shape**
- Base radius 0.25rem (unchanged)
- Images/sheet thumbnails: 0.5rem (unchanged)

**RTL**
- All Stitch screens authored with Hebrew copy and RTL flow (logo/nav on the right, primary CTAs on the right, breadcrumbs in RTL order)
- Hebrew copy mirrors the real client where it exists; placeholder Hebrew for unbuilt features

## 4. Screen list (8 screens)

### Shipped (matches current codebase through Phase 4c)

**S1. Login** (`/login`)
- Single card, centered, Rubik. Hebrew labels ("אימייל", "סיסמה", primary CTA "התחברות").
- Error state: generic "פרטי התחברות שגויים" (matches server's generic credential-error policy, spec §2.6).
- No signup, no forgot-password link (admin-reset only, spec §1.4).

**S2. Projects list** (`/projects`)
- Top bar: app name, user menu (avatar), mode toggle, logout.
- Main: "פרויקטים" heading, "צור פרויקט חדש" primary CTA (coral), search input.
- Grid of project cards: project name, createdAt, last-analysis status chip ("לא נותח" / "בניתוח" / "הושלם"), owner, hover → edit/delete ellipsis.
- Empty state: muted illustration slot + "טרם יצרת פרויקט" + CTA.

**S3. Project detail** (`/projects/:id`)
- Breadcrumb (RTL): "פרויקטים" ← project name.
- Two-column layout: left 30% metadata + DXF dropzone; right 70% sheet thumbnail grid.
- DXF dropzone: drag-target for .dxf; below it an extraction status pill (`PENDING` / `RUNNING` / `COMPLETED` / `FAILED`) with elapsed timer, matches `ExtractionStatusPill.tsx`.
- Sheet grid: 3-column thumbnails, each card shows sheet title, page label, classification badge (e.g. "תכנית קומה", "חתך") — matches the real `DxfPreviewGrid.tsx`.
- Side-panel on a sheet click opens S4.

**S4. Sheet lightbox** (`/projects/:id` overlay)
- Full-viewport dark-slate overlay (`rgba(30,41,59,0.9)`).
- Centered sheet SVG, arrow nav left/right, ESC close. Matches `DxfPreviewLightbox.tsx`.
- Footer strip: classification badge + sheet title + index/total.

**S5. Admin users** (`/admin/users`)
- Top bar + "ניהול משתמשים" heading + "צור משתמש" primary CTA (coral).
- Table: email, role (ADMIN locked pill), active toggle, created at, last login, row actions (reset password, toggle active, delete).
- Create-user dialog mock as a secondary frame.
- Admin row shown locked (no actions) per spec §2.2 invariants.

### Preview (forward-looking — phases 5–8)

**S6. TAVA upload + requirements** (Phase 5, `/projects/:id/tava`)
- PDF dropzone for תב"ע.
- Below: extracted-requirements list as a collapsible accordion by source page, each requirement row showing the original Hebrew sentence + parsed tags (setback / height / parking / etc.).
- Empty state: "העלה תב"ע לפני ניתוח".

**S7. Compliance analysis results** (Phase 6, `/projects/:id/analysis`)
- Header: dxfFile + tavaFile names, "הפעל ניתוח מחדש" secondary action.
- Summary strip: total requirements · pass · fail · inconclusive (colored pills).
- Requirement-by-requirement list: each row shows the Hebrew requirement, pass/fail/inconclusive pill, citation chip(s) linking back to sheets (opens S4), Claude's rationale in muted text.
- Filter bar at top: status, addon agent (fire / water / electricity / accessibility per spec §2 add-ons).

**S8. Chat with drawings** (Phase 8, `/projects/:id/chat`)
- Split: sheet viewer on the right 60% (same component as S3 right column), chat panel on the left 40%.
- Chat panel: message list (user bubbles right, assistant bubbles left — both RTL-native), SSE streaming indicator on assistant turn, input box with send button + attach-file icon, system message "שוחח על השרטוטים של פרויקט זה".

## 5. Out of scope (this spec)

- Light/dark mode parity in Stitch (client already has both; Stitch mirror stays light).
- Mobile layouts (v1 is desktop-only per spec §1.4).
- 403 / 404 / error pages (exist in client but don't add product narrative value at this stage).
- Job runner / audit log admin views (exist server-side but not surfaced to admin UI in v1).
- Porting rebranded tokens back into `client/src/index.css` — handled in a follow-up after Stitch screens are reviewed.

## 6. Deliverables from this spec

1. Updated Stitch design system (`mcp__stitch__update_design_system`) — Rubik + retuned Lumina tokens + RTL defaults. Target: new design-system markdown with the token frontmatter above.
2. 8 new Stitch screens (`mcp__stitch__generate_screen_from_text`) matching the descriptions in §4, Hebrew RTL copy, Rubik type.
3. Retire the 5 generic screens on the current Stitch project (Login, Dashboard Overview, Personnel Records, Personnel Form, Activity Log) OR create a new Stitch project to avoid mixing — confirm with user before deleting anything.

## 7. Risks / open questions

- **Stitch Hebrew rendering** — Stitch's previews must actually render Rubik Hebrew correctly; if Stitch substitutes a fallback, some screens may need Latin placeholder copy with Hebrew shown in captions.
- **Retire vs. new project** — unclear whether user wants the current Stitch project overwritten or a fresh one. Default: overwrite after approval. Confirm before delete.
- **Classification-badge vocabulary** — real client uses a finite set from `DxfPreviewGrid.tsx`; if the set shifts before Phase 5 lands, the preview-screen copy becomes stale.
- **Stitch preview fidelity vs. code** — preview screens for phases 5–8 are design-ahead; actual implementation may diverge, and that's expected.
