# Orthodox Routes — Initial Design System V1

**Status:** archived; superseded by [Design System V2](../ORTHODOX_ROUTES_DESIGN_SYSTEM_V2.md)

**Preview:** `/design-preview`

**Scope:** visual foundations and six isolated control screens

## 1. Purpose and authority

This document records visual-system decisions for the first complete public version of Orthodox Routes. It does not redefine the product, its permissions, data visibility, states, or journeys.

- [Product Scope V1](../ORTHODOX_ROUTES_PRODUCT_SCOPE_V1.md) remains authoritative for product purpose and first-version boundaries.
- [Information Architecture V2](../ORTHODOX_ROUTES_INFORMATION_ARCHITECTURE_V2.md) remains authoritative for screens, navigation, terminology, roles, permissions, states, visibility, and journeys.
- The six approved visual references establish visual direction only.
- The direct `/design-preview` route is an isolated review artifact. It is not the redesigned application, a functional map, authentication, or transport workflow.

When a visual reference conflicts with Product Scope, IA V2, or an explicit approved task decision, the documents and explicit decision win. The church-page action hierarchy in this version intentionally uses a primary filled **Нужна поездка** action and a secondary outlined **Могу подвезти** action.

## 2. Visual principles

1. Keep the interface calm, spacious, almost white, and clearly non-commercial.
2. Keep the church at the center of transport coordination without making the interface ornamental or ceremonial.
3. Use hierarchy, whitespace, and typography before adding containers.
4. Use full cards only for independent decision objects: churches, driver offers, passenger requests, agreements, and actionable notifications.
5. Use map and church photography as supporting context; never make either the only source of essential information.
6. Prefer subtle borders to shadows. Reserve elevation for sheets, overlays, floating controls, and selected map callouts.
7. Distinguish meaning with wording, iconography, structure, and state labels; color is supplementary.

Avoid dark page canvases, bright green, gold-heavy styling, religious ornament, all-caps micro-headings, excessive card nesting, and repeated bold type.

## 3. Semantic color tokens

The preview defines tokens on its scoped root. Production adoption must preserve semantic names rather than copying values into individual components.

| Token | Value | Intended use |
| --- | --- | --- |
| `canvas` | `#FCFCFA` | Page canvas |
| `surface` | `#FFFFFF` | Primary content and controls |
| `surface-subtle` | `#F4F7F3` | Quiet grouped content |
| `surface-warm` | `#F5F1E8` | Quiet contextual panels where a warm neutral is useful |
| `text` | `#172019` | Primary text |
| `text-secondary` | `#58625B` | Secondary body content |
| `text-subtle` | `#687169` | Hints and tertiary text at normal text sizes |
| `border` | `#E3E8E3` | Decorative separators and card boundaries |
| `border-strong` | `#D4DDD5` | Stronger grouping boundaries |
| `border-control` | `#7D8A80` | Essential control boundaries on white |
| `neutral-control-border` | `#CFD3D1` | Default filter and compact-label boundaries |
| `neutral-control-text` | `#2F3431` | Default filter text |
| `neutral-icon` | `#606663` | Default filter icons and map-marker centers |
| `marker-border` | `#858B87` | Default map-pin outline |
| `primary` | `#2E6A57` | Primary action, active state, key icon |
| `primary-pressed` | `#255747` | Hover and pressed primary action |
| `primary-pale` | `#ECF4F0` | Selected and supportive green surface |
| `primary-border` | `#D8E4DC` | Soft accent boundary for selected and supportive states |
| `status-confirmed` | `#ECF4F0` / `#2E6A57` | Confirmed status background / text |
| `status-planned` | `#EDF2F5` / `#3F5F73` | Planned or upcoming status background / text |
| `status-pending` | `#FBF2DF` / `#79551D` | Awaiting-response status background / text |
| `status-completed` | `#F0F2F0` / `#58625B` | Completed status background / text |
| `status-error` | `#FAEEEE` / `#A33A32` | Cancelled or error status background / text |
| `error` | `#A33A32` | Error text and boundary |
| `info` | `#315A7D` | Informational emphasis |
| `focus` | `#1F6FB2` | Keyboard focus ring |

### 3.1. Verified contrast use

Ratios were calculated with the WCAG relative-luminance formula:

| Pair | Ratio | Approved use |
| --- | ---: | --- |
| `text` on `canvas` | 16.26:1 | All text sizes |
| `text-secondary` on white | 6.34:1 | Body and secondary text |
| `text-subtle` on white | 5.05:1 | Hints at 12 px and above |
| White on `primary` | 6.33:1 | Primary buttons |
| White on `primary-pressed` | 8.29:1 | Hover and pressed primary buttons |
| `primary` on white | 6.33:1 | Links, icons, outlined actions |
| `primary` on `primary-pale` | 5.66:1 | Selected states and confirmed badges |
| Planned text on planned surface | 6.01:1 | Planned and upcoming status |
| Pending text on pending surface | 6.03:1 | Awaiting-response status |
| Completed text on completed surface | 5.63:1 | Completed status |
| Error text on error surface | 5.77:1 | Cancelled and error status |
| `error` on white | 6.54:1 | Validation and general error text |
| `info` on white | 7.27:1 | Informational text |
| `focus` on white | 5.28:1 | Focus ring |
| `border-control` on white | 3.61:1 | Essential control boundaries |

The lighter border tokens are decorative and must not be the only visible boundary of an interactive control. Status, selection, and error cannot rely on color alone.

## 4. Typography

Use a robust system sans-serif stack: `ui-sans-serif`, `system-ui`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, then a generic `sans-serif` fallback. Do not add a package or remote font.

| Role | Mobile | Desktop | Weight | Line height |
| --- | ---: | ---: | ---: | ---: |
| Page title | 30 px | 38 px | 600 | 1.15–1.2 |
| Section title | 21 px | 22–24 px | 600 | 1.25 |
| Card title | 16 px | 16–18 px | 600 | 1.25–1.35 |
| Body | 16 px | 16 px | 400 | 1.5 |
| Secondary | 14 px | 14 px | 400 | 1.45 |
| Compact metadata | 12–13 px | 12–13 px | 400–500 | 1.35 |

Use weights 400, 500, and 600. Do not use text below 12 px. Travel decisions, safety, exact meeting details, dates, and contact disclosure use at least 14 px. Essential content wraps and is never hidden with ellipsis.

## 5. Spacing, shape, and elevation

The base unit is 4 px. Preferred spacing values are 8, 12, 16, 24, 32, 40, and 48 px. Use 4 px only for tightly related metadata.

- Standard controls: 44 px minimum height.
- Important actions: 48–52 px height.
- Control radii: 10–14 px.
- Card radii: 16–20 px.
- Large mobile sheet radius: 28 px.
- Floating icon actions: circular, at least 44 × 44 px.
- Ordinary cards: subtle border, no shadow.
- Major sheet: soft vertical shadow around 8–34 px spread.
- Floating control or selected map callout: compact shadow around 5–32 px spread.

Whitespace separates semantic sections. The scoped `space-section` token is 40 px and separates church identity, services, rides, and other independent major sections. A bordered card is not added merely to create visual separation; internal card padding remains compact.

## 6. Buttons and states

### 6.1. Hierarchy

- **Primary:** deep-green fill, white text, semantic icon where useful.
- **Secondary outline:** white surface, green border and text.
- **Quiet action:** pale or transparent surface with text and an optional icon.
- **Destructive:** error text/border; filled error color only for a final destructive confirmation.
- **Icon-only:** 44 × 44 px minimum and an accessible name.

On the church page, **Нужна поездка** is the primary action with a deep-green fill and contrasting light text. **Могу подвезти** is the secondary action with a white surface, green border, and green text. They retain identical width, height, padding, border radius, target size, responsive behavior, and placement. This hierarchy prioritizes the passenger's most urgent entry point without reducing the driver action's discoverability or target size.

### 6.2. Interaction states

- Hover changes surface or border without changing geometry.
- Pressed uses the darker primary token and may translate by at most 1 px.
- Focus uses the 3 px blue focus ring with 3 px offset.
- Loading keeps the control width stable, uses a text label such as **Отправляем…**, and announces status.
- Disabled controls include a visible explanation near the control and use the native `disabled` attribute.
- Success and error retain a readable text message and do not move focus unexpectedly.

## 7. Forms and validation

- Each field has a visible label, except a search field whose purpose remains unambiguous and still has an accessible label.
- Inputs are at least 44 px high.
- One mobile step presents one main question.
- Progress includes text, not bars alone.
- Errors appear beside the field, explain how to correct it, and are connected with `aria-describedby`.
- Invalid fields use `aria-invalid="true"`, an error boundary, and error text.
- After submit, focus moves to an error summary or the first invalid field.
- Valid values remain intact after an error or Back action.
- Sticky actions must not cover the focused field; the content area reserves sufficient bottom space.
- Privacy explanations appear before publication and describe the approximate public area in user language.

## 8. Chips, tabs, badges, cards, and list rows

- **Chips** filter an existing set. The selected chip has `aria-pressed="true"`, filled treatment, and readable text.
- **Tabs** switch IA-defined peer sections. Use tab semantics and preserve the selected section when practical.
- **Badges** communicate status in plain language. Shape and text remain understandable without color.
- **Church cards** contain name, city/country, nearest service, active driver-offer count, passenger-request count, and an image only where it improves scanning. Selection uses `aria-pressed`, a soft accent border, a pale selected surface, and synchronization with the map marker. It never uses a checkmark, down-chevron, badge, or accordion metaphor.
- **Ride cards** use the same white surface and border. A compact, rounded neutral chip appears before the title: **Предлагают места** for a driver offer and **Ищут места** for a passenger request. Both chips share the same quiet surface and border; the icon is secondary reinforcement, while wording and the exact action label carry the distinction.
- **Agreement cards** may show exact location and contacts only in the confirmed participant context.
- **List rows** use dividers within one semantic group; they do not become nested cards.
- **Service date tiles** use a white surface, neutral border, and neutral text. Green is reserved for restrained service-status text rather than the date itself.

Driver action: **Попросить подвезти**. Passenger-request action: **Предложить подвезти**. Do not replace either with generic wording.

## 9. Navigation

### 9.1. Authenticated mobile

The bottom navigation contains exactly:

1. **Храмы**;
2. **Поездки**;
3. **Уведомления**.

The label **Поездки** opens a page headed **Мои поездки**. The active item uses `aria-current="page"`, an icon, text, and color. Focus and content remain visible above the sticky bar. Focused form flows do not show product bottom navigation.

### 9.2. Authenticated desktop

The primary header navigation contains exactly **Храмы**, **Мои поездки**, and **Поддержать**. Right-side controls contain language, notifications, and profile. Contextual transport creation does not appear in global navigation.

The Initial Design System treats these names as IA control labels while acknowledging that IA V2 still requires empirical card sorting and tree testing before final navigation validation.

Default country and proximity filters use white surfaces, dedicated neutral-gray control borders, neutral dark text, and neutral-gray icons. Their default border, text, and icons do not use an accent token. An already selected country value does not make the filter a primary action. Green appears only for a genuine active interaction and then uses the soft accent palette.

Navigation and action icons use one preview-only inline SVG system: simple 24 px geometry, 1.75 px strokes, rounded caps and joins, and no emoji, text glyphs, or decorative detail. The mobile church icon is a minimal chapel/dome symbol, while Trips uses a clean front-facing car. The temporary brand mark remains separate and is not a final logo.

## 10. Maps

- A map never replaces the church list, address, selected-place summary, or ride card.
- Preview maps are deterministic local SVG/CSS illustrations only. They do not use tiles, geocoding, routing, network requests, API keys, or exact user coordinates.
- Use a pale land surface, quiet roads, a restrained coastline, place labels, and high-contrast markers.
- Default markers use a familiar vertical teardrop map-pin silhouette with a white surface, neutral outline, and neutral center dot. The selected pin is slightly larger, filled with `primary`, uses a high-contrast center, and has an additional outline. No marker contains a miniature church illustration or an abstract rotated-card shape.
- Passenger location samples show a translucent approximate radius and a textual explanation.
- Icon-only zoom and location controls have accessible names.
- Real implementation must provide a list/search alternative and protected public representations defined by IA V2.

## 11. Screen anatomy

### 11.1. Church page

Order: hero or identity, location and address, nearest service, paired primary/secondary actions, upcoming services, ride filters, ride cards, general agreement counts, and optional map/sidebar depending on viewport. On mobile this becomes one reading flow; on desktop the map and general counts may form a right sidebar. The desktop church photo and map card share the same top edge, the map has no redundant visible heading, and the photo uses an intentional crop that keeps the dome and façade balanced.

### 11.2. Church card

Name → city/country → nearest service → offer/request counts. The selected state uses `aria-pressed`, a subtle accent border, a very light selected surface, and a synchronized selected map pin. No trailing selection control is shown.

### 11.3. Ride card

Neutral type label → short origin title → service/date/time → seats or people → children/child-seat state → return state → one exact contextual action. Driver offers use **Предлагают места** then **Из Catanzaro Lido**. Passenger requests use **Ищут места** then **Из Matera**. Public ride cards never show contacts or exact user locations.

## 12. Loading, empty, error, expired, and denied patterns

- **Loading:** reserve final geometry with a skeleton, expose busy status, prevent unsafe actions, and provide retry after prolonged failure.
- **Fully empty account:** explain that there are no trips or listings and offer **Найти храм**.
- **No rides at a church:** offer **Нужна поездка** and **Могу подвезти** and retain general agreement counts when present.
- **General error:** explain failure and provide **Попробовать ещё раз**, churches, and help routes.
- **Expired ride/link:** state that it is unavailable, hide old places and details, and offer **Посмотреть актуальные поездки**.
- **Permission denied:** use the neutral heading **Нет доступа**, reveal no existence or content of closed data, and offer another-account sign-in and public-page return.
- **Field error:** identify the field and correction.
- **Success:** announce a short result and the next safe action.
- **Disabled action:** pair the disabled control with a visible reason.

My Trips status colors are deliberately restrained and always retain their text labels: confirmed uses soft green, planned/upcoming uses soft blue-gray, awaiting response uses soft amber, completed uses neutral gray, and cancelled/error uses restrained red when present. Color supplements wording and never replaces it.

## 13. Responsive rules

- Primary mobile control width: 390–430 px; content must still work at narrower widths.
- Mobile uses one content column and sticky bottom navigation or form actions, never both.
- Desktop directory uses a list/map split with a practical minimum list width of about 340 px.
- Desktop church pages use main content plus a compact sidebar.
- Desktop church photo and map card align to the same top edge; increased major-section spacing is preserved when the layout reflows.
- Desktop My Trips uses list/detail at 1024 px and above.
- At 200% zoom, desktop layouts may reflow or scroll within the isolated preview stage, but essential controls and reading order remain available.
- Long German and Ukrainian strings wrap. No fixed-height text containers or decision-critical ellipsis.

## 14. Accessibility requirements

Target WCAG 2.2 AA:

- semantic landmarks, headings, lists, tabs, and groups;
- complete keyboard operation without traps;
- visible focus and logical DOM/focus order;
- 44 × 44 px minimum targets for primary and icon actions;
- text, icon, focus, and essential control-boundary contrast;
- status and selection communicated with text/semantics in addition to color;
- accessible names for all icon-only controls;
- correctly associated form labels and errors;
- no essential content hidden at 200% zoom;
- `prefers-reduced-motion` disables non-essential transitions and shimmer;
- map has a text/list alternative;
- sticky controls do not obscure focused content.

## 15. Localization

Allow expansion rather than assigning language-specific widths. Wrap button labels when necessary while preserving target height, hierarchy, and all essential content. Test Russian plus representative long German and Ukrainian strings before production adoption. Keep city, country, time-zone, and official church-name language distinctions explicit where IA requires them.

## 16. What Initial Design System V1 does not cover

This version does not implement or select a final brand identity, remote font, dark theme, real maps, backend, authentication, notifications, PWA behavior, localization infrastructure, administration, payment, analytics, real ride matching, or production redesign. It does not change current prototype routes, data, storage, behavior, or components.

Component APIs may change during later visual-system increments. The isolated preview validates visual hierarchy and semantics; it is not a production component library or Storybook replacement.

## 17. Six control screens

The `/design-preview` selector provides:

1. mobile church directory and static map;
2. mobile church page and transport board;
3. mobile passenger-request form, step 2;
4. desktop church directory and static map;
5. desktop church page and transport board;
6. desktop **Мои поездки** list and confirmed agreement detail.

The page also includes a compact gallery for loading, fully empty account, no rides, general error, expired link, permission denied, field error, success feedback, and an explained disabled action.
