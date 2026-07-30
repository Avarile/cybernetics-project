# Branding Inventory & Functional Analysis — apps/web

Scope: `apps/web` (plus shared `packages/*` it depends on for branding).

Context: the codebase is mid-rebrand. Most **user-visible display strings** were already
changed from "Plane" to "Cybernetics", but a large number of **URLs, domains, copyright
headers, component/variable/asset names, and some untranslated feature names** still say
"Plane". This inconsistency is called out below as its own finding.

---

## 1. Text Branding

### Already-rebranded strings (say "Cybernetics", not "Plane")

- `apps/web/app/root.tsx:36` — `APP_TITLE = "Cybernetics | Simple, extensible, open-source project management tool."` (browser tab title, og:title)
- `apps/web/app/root.tsx:67,109,120` — `<meta name="application-name" content="Cybernetics">`, og:image:alt / twitter:image:alt = "Cybernetics - Modern project management"
- `apps/web/app/layout.tsx:28,40,49,55,70` — same title/meta duplicated (Next.js-style layout, likely legacy/parallel to root.tsx)
- `packages/constants/src/metadata.ts` — `SITE_NAME`, `SITE_TITLE` = `"Cybernetics | Simple, extensible, open-source project management tool."`; `SPACE_SITE_NAME`/`SPACE_SITE_TITLE` = `"Cybernetics Publish | ..."` (used for the public "Plane Pages" publish site)
- `apps/web/public/manifest.json`, `apps/web/public/site.webmanifest.json` — `"name"`/`"short_name": "Cybernetics"` (PWA manifest, app install name)
- `apps/web/core/components/core/page-title.tsx:19` — default `document.title` fallback = `"Cybernetics | Simple, extensible..."` (used by `<PageHead>` across the app)
- `apps/web/core/components/auth-screens/header.tsx:73` — `<PageHead title={pageTitle + " - Cybernetics"} />` (auth pages: sign in/up)
- `apps/web/app/(all)/accounts/{forgot,reset,set}-password/layout.tsx`, `apps/web/app/(all)/sign-up/layout.tsx` — route `meta.title` = `"... - Cybernetics"`
- `apps/web/core/components/account/auth-forms/auth-header.tsx` — subheaders: "Welcome back to Cybernetics.", "Create your Cybernetics account."
- `apps/web/core/components/auth-screens/footer.tsx:35` — tagline "Join 10,000+ teams building with Cybernetics"
- `apps/web/core/components/instance/not-ready-view.tsx:40,42` — alt="Cybernetics Logo", heading "Welcome to Cybernetics" (first-run/setup screen)
- `apps/web/ce/components/instance/maintenance-message.tsx:20` — "Looks like Cybernetics didn't start up correctly!"
- `apps/web/ce/components/onboarding/tour/root.tsx` — onboarding tour copy: "Welcome to Cybernetics, {name}", "We're glad you decided to try out Cybernetics...", concept copy referencing "Cybernetics"
- `apps/web/ce/components/onboarding/tour/sidebar.tsx:56` — "Get more out of Cybernetics."
- `apps/web/core/components/onboarding/**` (invite-members.tsx, steps/profile/root.tsx, steps/role/root.tsx, steps/profile/consent.tsx, steps/team/root.tsx, steps/usecase/root.tsx) — onboarding copy: "Create your profile... how you'll appear in Cybernetics", "Let's set up Cybernetics for how you work", "I agree to Cybernetics marketing communications", "What brings you to Cybernetics?", etc.
- `apps/web/core/components/integration/single-integration-card.tsx` — "Connect with GitHub/Slack with your Cybernetics workspace..."
- `apps/web/core/components/workspace/billing/comparison/plans.tsx` — dozens of pricing/feature-comparison descriptions reference "Cybernetics" (e.g., "Cybernetics Query Language", "make Cybernetics secure with any IdP", "self-hosted Cybernetics instance")
- `apps/web/app/(all)/[workspaceSlug]/(projects)/projects/(detail)/[projectId]/intake/page.tsx:70` — `workspace: "Cybernetics"`
- `apps/web/app/(all)/workspace-invitations/page.tsx` — "...organize different streams of work in your Cybernetics account" (x3)
- `apps/web/core/layouts/auth-layout/workspace-wrapper.tsx:174` — `alt="Cybernetics logo"` on a "no workspace" empty-state image
- `apps/web/core/components/common/latest-feature-block.tsx:36` — `alt="Cybernetics Work items"`
- `packages/i18n/src/locales/en/common.json` — `"powered_by_plane_pages": "Powered by Cybernetics Pages"`, `"plane_didnt_start_up_this_could_be_because...": "Cybernetics didn't start up..."`
- `packages/i18n/src/locales/en/auth.json:273` — `"new_to_plane": "New to Cybernetics?"`
- `packages/i18n/src/locales/en/home.json:55` — `"new_at_plane": { "title": "New at Cybernetics" }`
- `packages/i18n/src/locales/en/tour.json:190` — `"switch_to_plane_section": { "title": "Discover why teams switch to Cybernetics", "description": "Compare Cybernetics with the tools you use today..." }`
- `packages/i18n/src/locales/en/integration.json` — `"plane_project_connection": "Cybernetics Project Connection"`, `"plane_project_connection_description": "...to Cybernetics projects"`
- `packages/i18n/src/locales/en/workspace-settings.json` — API-tokens/webhooks empty-state copy: "Cybernetics APIs can be used to integrate your data in Cybernetics with any external system."
- Note: i18n **key names** still use `plane` (e.g. `new_at_plane`, `switch_to_plane_section`, `plane-intelligence`) even though the translated value says "Cybernetics" — internal identifiers, not user-facing, but relevant if grepping for "plane".

### Still says "Plane" (not rebranded) — literal display text

- `packages/i18n/src/locales/en/navigation.json:28,31` — `"pi_chat": "Plane AI"`, `"plane_pro": "Plane Pro"` (sidebar/nav labels)
- `packages/i18n/src/locales/en/common.json:835` — `"pi_chat": "Plane AI"` (duplicate elsewhere)
- `packages/i18n/src/locales/en/workspace-settings.json:478-479,483` — `"plane-intelligence": { "title": "Plane AI", "heading": "Plane AI" }`, `"runners": { "title": "Plane Runner" }` (settings sidebar entries)
- `packages/i18n/src/locales/en/wiki.json:91` — "...with Plane Pro." (upsell copy, untranslated)
- `packages/i18n/src/locales/en/power-k.json:143` — `"open_plane_documentation": "Open Plane documentation"` (command palette / Power-K menu)
- `packages/i18n/src/locales/en/automation.json:17` — `"section_plane_events": "Plane events"`
- `packages/i18n/src/locales/en/tour.json:116,175` — "...summarize chats directly in Plane AI.", "Try Plane AI chat"
- `packages/i18n/src/locales/en/integration.json` — many GitHub/GitLab integration strings still say "Plane": "Sync issues... between GitHub and Plane", "Add PR State Mapping for Plane project", "Link GitHub Repository to a Plane Project", "Link Plane project", "Plane Project" label, placeholder examples `plane-github-enterprise`, `gh.plane.town`, `glab.plane.town`
- `packages/i18n/src/locales/en/empty-state.json:17` — "We are unable to fetch your plane account currently..." (lowercase "plane", looks like a leftover/typo not caught by the rebrand pass)
- `packages/i18n/src/locales/en/template.json:173` — `"placeholder": "Plane"` (a form field placeholder example)
- `packages/i18n/src/locales/en/auth.json:155` — `"plane": "Plane"` (SSO/provider label, likely "Sign in with Plane" style key)
- Translated locales (cs, de, es, fr, id, it, ja, ko, pl, pt-BR, ro, ru, sk, tr-TR, ua, vi-VN, zh-CN, zh-TW) all mirror the `plane.so` domain placeholders in `auth.json` (`domain_placeholder`/`domain_invalid` examples) and `template.json` (`https://plane.so`, `help@plane.so` placeholders) — present across essentially every locale file, not just `en`.

### Domain / URL / handle references (all still `plane.so` / `@planepowers`)

- `apps/web/app/root.tsx`, `apps/web/app/layout.tsx` — `og:url`/`og:image` = `https://app.plane.so/...`, `twitter:site: "@planepowers"`
- `packages/constants/src/metadata.ts` — `SITE_URL`, `SPACE_SITE_URL` = `https://app.plane.so/`; `SPACE_TWITTER_USER_NAME = "planepowers"`; `SPACE_SITE_DESCRIPTION` mentions "built on top of plane.so"
- `packages/constants/src/endpoints.ts` — `WEBSITE_URL` default `https://plane.so`, `SUPPORT_EMAIL` default `support@plane.so`, `MARKETING_*` links to `plane.so/pricing`, `/contact`, `/one`
- `packages/constants/src/payment.ts` — `TALK_TO_SALES_URL`, upgrade/pricing links all point at `plane.so` / `app.plane.so`
- `apps/web/app/(all)/[workspaceSlug]/(settings)/settings/projects/page.tsx:35` — "Learn more about projects" link → `https://plane.so/`
- `apps/web/app/(all)/workspace-invitations/page.tsx:118` — link → `https://forum.plane.so`
- `apps/web/app/error/prod.tsx` — `mailto:support@plane.so`, `https://status.plane.so/`, label `@planepowers` → `https://x.com/planepowers` (production error page contact info)
- `apps/web/ce/components/instance/maintenance-message.tsx:12` — `mailto:support@plane.so`
- `apps/web/ce/components/pages/editor/embed/issue-embed-upgrade-card.tsx:30` — link → `https://plane.so/pro`
- `apps/web/core/components/account/terms-and-conditions.tsx` — `termsOfService`/`privacyPolicy` → `https://plane.so/legals/...`
- `apps/web/core/components/common/latest-feature-block.tsx:23` — link → `https://plane.so/changelog`
- `apps/web/core/components/estimates/root.tsx:114` — docs link → `https://docs.plane.so/...`
- `apps/web/core/components/global/product-updates/fallback.tsx`, `footer.tsx` — links to `plane.so/changelog`, `go.plane.so/p-docs`, `go.plane.so/p-changelog`, `support@plane.so`, `forum.plane.so`, `plane.so/pages` (this component also renders "Powered by Cybernetics Pages" next to the Plane logo — direct "powered by" branding placement)
- `apps/web/core/components/inbox/sidebar/inbox-list-item.tsx:132` — special-cases sender email `intake@plane.so` (see Tier 1 functional analysis below)
- `apps/web/core/components/power-k/config/help-commands.ts` — opens `https://docs.plane.so/`, `https://forum.plane.so` from command palette
- `apps/web/core/components/workspace/billing/comparison/plans.tsx:1239` — "talk to sales" link → `https://plane.so/talk-to-sales`
- `apps/web/core/components/workspace/sidebar/help-section/root.tsx` — help menu items link to `go.plane.so/p-docs`, `sales@plane.so`, `forum.plane.so` (sidebar "Help" dropdown)
- `packages/propel/.storybook/manager.ts` — Storybook theme: `brandTitle: "Plane UI"`, `brandUrl: "https://plane.so"`, `brandImage: "plane-lockup-light.svg"` (internal dev tooling, not shipped to users)

### Copyright / license header (present in essentially every source file)

- Every `.ts`/`.tsx` file in `apps/web` and `packages/*` (~3000+ files) starts with:
  ```
  /**
   * Copyright (c) 2023-present Plane Software, Inc. and contributors
   * SPDX-License-Identifier: AGPL-3.0-only
   * See the LICENSE file for details.
   */
  ```
  This is the single largest source of literal "Plane" text matches in the repo (boilerplate license banner, not user-facing UI, but relevant if the goal is a full brand purge).

### Package / project metadata

- `/package.json` (repo root) — `"name": "plane"`, `"description": "Open-source project management that unlocks customer value"`
- `apps/web/package.json` — `"name": "web"` (not branded)
- `/README.md` (repo root) — heavily "Plane"-branded (not under `apps/web`, but part of the monorepo): logo alt text "Plane Logo"/"Plane Screens"/"Plane Views"/etc., body copy "Meet Plane...", "Plane Cloud", "Self-host Plane", links to `plane.so`, `forum.plane.so`, `github.com/makeplane/plane`. `apps/web` itself has no README.

---

## 2. Logo/Image Branding

### Logo/brand SVG components (shared UI package `@plane/propel`)

- `packages/propel/src/icons/brand/plane-logo.tsx` — exports `PlaneLogo`, the small angular "plane" mark icon (SVG path, ~85x52 viewBox)
  - Used in: `apps/web/app/(all)/invitations/page.tsx`, `apps/web/app/(all)/create-workspace/page.tsx`, `apps/web/core/components/global/product-updates/footer.tsx` (next to "Powered by Cybernetics Pages"), `apps/web/core/layouts/auth-layout/workspace-wrapper.tsx` (workspace list / auth wrapper header)
- `packages/propel/src/icons/brand/plane-lockup.tsx` — exports `PlaneLockup`, full wordmark+icon lockup (SVG, 253x53 viewBox)
  - Used in: `apps/web/core/components/auth-screens/header.tsx` (sign in/sign up page header), `apps/web/core/components/onboarding/header.tsx` (onboarding flow header), `apps/web/core/components/instance/not-ready-view.tsx` (instance setup/"Welcome to Cybernetics" screen), `apps/web/ce/components/onboarding/tour/root.tsx` (product tour modal)
- `packages/propel/src/icons/brand/plane-wordmark.tsx` — exports `PlaneWordmark` (text-only wordmark SVG, 146x44) — **no usages found in `apps/web` or `packages`** (confirmed via grep); dead code
- `packages/propel/src/icons/sub-brand/plane-icon.tsx` — exports `PlaneNewIcon` (small square glyph)
  - Used in: `apps/web/ce/components/app-rail/app-rail-hoc.tsx` (the app-rail/dock sidebar item for "Projects")
- `packages/propel/src/icons/sub-brand/pi-chat.tsx` — exports `PiChatLogo` for the "Plane AI"/Pi Chat feature icon
- `packages/propel/src/icons/registry.ts` — registers `PlaneNewIcon` under key `"sub-brand.plane"` in a central icon registry (single call site confirmed: `packages/propel/src/icons/constants.tsx:62`, `<Icon name="sub-brand.plane" />`)
- `packages/propel/src/icons/brand/index.ts` and `.../sub-brand/index.ts` — barrel files exporting all of the above brand icons

### Component wrappers around logos

- `apps/web/core/components/common/logo-spinner.tsx` — `LogoSpinner` component, picks `logo-spinner-dark.gif` or `logo-spinner-light.gif` based on theme; used as the app's loading/hydration-fallback spinner (`apps/web/app/root.tsx` `HydrateFallback`, `apps/web/core/layouts/auth-layout/workspace-wrapper.tsx` loading state)
- `apps/web/core/components/workspace/logo.tsx` — `WorkspaceLogo` (renders a user-uploaded workspace logo image or a fallback initial letter; not brand logo per se, but named "logo" and worth noting — sits in sidebar/workspace switcher)
- `apps/web/core/components/pages/editor/header/logo-picker.tsx` — logo/emoji picker used for page/project icons (not company brand, but matched the "logo" search)

### Image/GIF/SVG assets

- `apps/web/app/assets/auth/gradient-logo.webp` — used in `apps/web/core/components/instance/not-ready-view.tsx` (alt="Cybernetics Logo")
- `apps/web/app/assets/auth/gradient-bg-logo.webp` — decorative background logo, same file (`not-ready-view.tsx`)
- `apps/web/app/assets/images/logo-spinner-dark.gif` / `logo-spinner-light.gif` — used by `LogoSpinner` component above
- `apps/web/app/assets/plane-logos/` (folder name itself still "plane-logos"):
  - `black-horizontal-with-blue-logo.png`
  - `white-horizontal-with-blue-logo.png`
  - `blue-without-text.png`
  - `white-horizontal.svg`
  - **No references found to any of these 4 files anywhere in `apps/web` source** (confirmed) — orphaned/unused legacy brand assets.
- `apps/web/public/plane-logos/plane-mobile-pwa.png` — referenced by `apps/web/public/site.webmanifest.json` (PWA install icon, 192x192 and 512x512 entries)
- `apps/web/app/assets/favicon/{favicon-16x16.png, favicon-32x32.png, favicon.ico}` — imported directly in `apps/web/app/root.tsx` and `apps/web/app/layout.tsx` `<link rel="icon">`/`<link rel="shortcut icon">` tags
- `apps/web/app/assets/icons/{icon-180x180.png, icon-512x512.png}` — used as `<link rel="apple-touch-icon">` in `root.tsx`/`layout.tsx`
- `apps/web/app/assets/og-image.png` — imported in `root.tsx` as the `og:image`/`twitter:image` social-share preview image
- `apps/web/public/favicon/android-chrome-192x192.png`, `android-chrome-512x512.png`, `apps/web/public/favicon/site.webmanifest` — a **second, confirmed-unused** favicon/manifest set (no code references found); likely legacy/orphaned from an older favicon-generator output, separate from the actively-used `app/assets/favicon` set
- `apps/web/public/icons/{icon-192x192.png, icon-348x348.png, icon-512x512.png}` — referenced only by `apps/web/public/manifest.json` (a second, separately-referenced manifest from `site.webmanifest.json`; both are linked via `<link rel="manifest">` in `root.tsx`/`layout.tsx`)
- `apps/web/core/layouts/auth-layout/workspace-wrapper.tsx` imports `apps/web/app/assets/workspace/workspace-not-available.png` with `alt="Cybernetics logo"` — the image itself is a generic "workspace not available" illustration, but its alt text names the brand.

### Manifest / PWA name fields (duplicated across 3 files, inconsistent naming)

- `apps/web/public/manifest.json` — `"name": "Cybernetics"`, `"short_name": "Cybernetics"`
- `apps/web/public/site.webmanifest.json` — `"name": "Cybernetics"`, `"short_name": "Cybernetics"`, `"description": "Cybernetics helps you plan your issues, cycles, and product modules."`
- `apps/web/public/favicon/site.webmanifest` — `"name": ""`, `"short_name": ""` (blank — orphaned/unused as noted above)

---

## 3. Functional Attachment Analysis

Verified by grepping actual usage (not just presence of the string) for each ambiguous case.

### Tier 1 — Functionally coupled (do not touch without a matching code change)

| Item                                                                                                                      | Why it's not just cosmetic                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createdByDetails.email?.includes("intake@plane.so")` in `apps/web/core/components/inbox/sidebar/inbox-list-item.tsx:132` | **Actual conditional logic**, not display text. It detects Plane's own intake-bot sender address and swaps in a special avatar/name. If the backend really sends from that literal address and you change/remove the string, the special-case UI silently stops firing (no crash, just lost behavior). Confirmed via grep — the only branching logic tied to a brand string found in `apps/web`. |
| Copyright/SPDX headers (`Copyright (c) 2023-present Plane Software, Inc.`, ~3000 files)                                   | Legal artifact under AGPL-3.0, not runtime logic — but not a "safe rebrand" edit either. Stripping the original copyright holder while keeping the AGPL license can be a license-compliance problem. Needs a legal decision, not a find-replace.                                                                                                                                                 |
| i18n **key names** (`new_at_plane`, `switch_to_plane_section`, `plane-intelligence`, `powered_by_plane_pages`, etc.)      | The _value_ (what users see) is already safely replaced with "Cybernetics" — proof this is low-risk. But the _key string_ is referenced via `t('key')` call sites throughout the code. Renaming the key (not the value) requires updating every call site or it breaks at runtime (missing translation).                                                                                         |
| `packages/propel/src/icons/registry.ts` key `"sub-brand.plane"`                                                           | Confirmed single call site: `packages/propel/src/icons/constants.tsx:62` uses `<Icon name="sub-brand.plane" />`. It's an internal lookup key, not persisted user data, so renaming is mechanical/TypeScript-checked — but both sides must move together or the icon silently fails to resolve.                                                                                                   |

### Tier 2 — Cosmetic, safe to replace (verified no logic depends on them)

- **All `plane.so`/`app.plane.so`/`docs.plane.so`/`forum.plane.so`/`go.plane.so` URLs, `support@/sales@plane.so` emails, `@planepowers` handle** (in `packages/constants/src/{endpoints,payment,metadata}.ts` and scattered component links) — only ever used as href/mailto targets. No code branches on their value. 100% safe to repoint.
- **Logo SVG artwork** (`PlaneLogo`, `PlaneLockup`, `PlaneNewIcon`) — rendered as plain icons with zero conditional logic keyed off their shape. Swap the SVG paths freely.
- **`PlaneWordmark`** — grepped and confirmed zero usages anywhere in `apps/web` or `packages`. Fully dead code; delete or repurpose with no blast radius.
- **Orphaned assets** — confirmed no references anywhere: `apps/web/app/assets/plane-logos/*` (4 files) and `apps/web/public/favicon/android-chrome-*.png` + `public/favicon/site.webmanifest` (the blank-named manifest). Safe to delete outright.
- **Alt text, manifest `name`/`short_name` fields, meta titles, og tags, onboarding/marketing copy** — purely descriptive strings with no downstream logic. Already proven safe by the fact most of these were already changed to "Cybernetics" without incident. Only gotcha: they're duplicated across `root.tsx`/`layout.tsx` and 3 separate manifest files, so edits need to be applied in all copies to avoid re-introducing inconsistency.
- **Root `package.json` `"name": "plane"`** — grepped for workspace-protocol references (`"plane": "workspace:..."`) and bare imports (`from "plane"`) across the monorepo: none found. Safe to rename.
- **Root README.md branding** — outside `apps/web`, pure documentation, no functional impact either way.

### Tier 3 — Needs a product decision, not a safety verdict

- **"Plane AI" / "Plane Pro" / "Plane Runner"** (`navigation.json`, `workspace-settings.json`, `wiki.json`) — unlike the rest, these may be _intentionally_ left unrebranded because they name specific upstream Plane SaaS products (hosted AI add-on, hosted Pro tier) that this self-hosted fork still points users toward. Worth confirming with whoever owns the rebrand whether these should also become "Cybernetics AI/Pro/Runner," or stay as-is because they refer to a real third-party upstream service.

---

## Summary of key inconsistencies worth flagging to whoever owns this rebrand

1. Nearly all onboarding/marketing/settings **copy** was updated to "Cybernetics," but the **product/feature names** "Plane AI," "Plane Pro," "Plane Runner" were left untranslated in `packages/i18n/src/locales/en/{navigation,workspace-settings,tour,wiki}.json`.
2. All **outbound URLs, emails, and the Twitter handle** still point at `plane.so` / `@planepowers` domains (both in `packages/constants` and scattered directly in `apps/web` components) — none were repointed.
3. The actual **logo SVG components** (`PlaneLogo`, `PlaneLockup`, `PlaneWordmark`) and their source file paths (`.../icons/brand/plane-*.tsx`) still render the original Plane mark/wordmark graphic and keep "Plane" in the component/file name, even on now-"Cybernetics"-labeled screens (auth header, onboarding header, instance-not-ready screen).
4. Every source file carries a `Copyright (c) 2023-present Plane Software, Inc.` header — untouched by the rebrand.
5. Several legacy/orphaned brand image assets (`app/assets/plane-logos/*`, `public/favicon/android-chrome-*.png` + `site.webmanifest`) exist on disk but are not referenced by any code path — safe to remove.
6. The one genuine functional landmine is the hardcoded `intake@plane.so` check in the inbox sidebar — that's live behavior, not decoration.
