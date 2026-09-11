# Thermal Intelligence console — design system

Operational surface for SIH26162 (industrial fire and persistent thermal source detection). The
console is used for minutes at a time by analysts scanning a map and a queue, so the visual system
optimises for scan speed and calm: minimal, dark, precise.

## 1. Direction

**Atmosphere:** a control room at night. Near-black neutral surfaces layered by tone, hairline
borders instead of shadows, and one warm ember accent that belongs to the subject (fire) and is used
sparingly: the product mark, the active state, focus.

**Signature material:** matte panels with a 1 px top highlight and a very soft drop shadow, so a
panel reads as a plate resting on the background rather than a box drawn on it. No glass blur on
content panels; the only translucent surfaces are the map overlays (legend, toolbar), which sit on
imagery and need separation.

**Color story:** neutral zinc ramp for chrome; classification hues are the only saturated colours
and are reserved for data (markers, chips, bars). Status colours are muted and never compete with
class colours. Text uses three tones: primary (#f2f2f4), secondary (#a6a6ae), muted (#71717a).

**The memorable moment:** the map. Thousands of ember-coloured points glowing on a dark canvas,
framed by quiet chrome, with the selected detection ringed by a soft halo and crosshair brackets.

References used: Linear (chrome density, hairlines, muted label caps), Vercel (neutral ramp, type
tracking), Supabase (dark data tables). ui-ux-pro-max lookup: "Real-Time / Operations" pattern,
dark-tech palette; its glassmorphism suggestion was kept only for map overlays.

## 2. Tokens (source of truth: `src/styles/app.css` `@theme`)

| Group | Token | Value | Use |
|---|---|---|---|
| Surface | `--color-background` | `#0b0b0d` | page |
| | `--color-surface-lowest` | `#09090b` | map canvas, inputs, wells |
| | `--color-surface-low` | `#101012` | panel headers, rails |
| | `--color-surface-container` | `#141417` | panels |
| | `--color-surface-high` | `#1b1b1f` | hover, active rows |
| | `--color-surface-highest` | `#232329` | pressed, chips |
| | `--color-surface-bright` | `#2b2b32` | skeletons |
| Text | `--color-on-surface` | `#f2f2f4` | primary |
| | `--color-on-surface-variant` | `#a6a6ae` | secondary, labels |
| | `--color-outline` | `#71717a` | muted, hints |
| Line | `--color-outline-variant` | `rgb(255 255 255 / 0.08)` | every border |
| Accent | `--color-accent` | `#ff7a45` | mark, active, focus |
| | `--color-primary` | `#f2f2f4` | primary control text |
| | `--color-tertiary` | `#e2b86a` | "awaiting" amber |
| | `--color-error` | `#ff6b6b` | errors |
| Class | wildfire / agricultural / industrial / gas-flare / persistent / unknown | `#ff5d57` `#ff9f3f` `#ffd257` `#c084fc` `#60a5fa` `#8b8f98` | data only |
| Risk | critical / high / medium / low | `#ff5d57` `#ffb03b` `#cbd0d8` `#6f737c` | data only |
| Status | online / offline / pending | `#34d399` `#ff5d57` `#ffb03b` | health only |
| Radius | `--radius-sm/md/lg/xl` | 6 / 10 / 14 / 18 px | controls / panels / overlays / modals |
| Type | label 11/500 caps 0.06em; body-sm 12/16; body 13.5/20; data 13 mono; data-lg 18 mono; headline 17/600 −0.015em; display 26/600 −0.02em | | |
| Space | 4 px grid; gutter 12, compact 8, toolbar 52, sidebar 320 / 280 | | |

Rules: no raw hex in components; borders are always `outline-variant`; colour on text only for
data values and status; motion 150-200 ms ease-out, opacity/transform/colour only; reduced motion
respected globally.

## 3. Primitives (`src/components/ui`)

Panel (plate material, rounded-md, header 36 px), Metric (label / value / hint), Select, chips
(ClassificationBadge, RiskBadge, ProvenanceTag: rounded-sm, 10 % tint fill, 30 % tint border),
StatusDot (the only circle besides markers' halo), States (loading / empty / error), Icon
(Material Symbols, decorative).

## 4. Chrome

TopNav 52 px: ember mark + wordmark, pill navigation with a filled active state, health pill on the
right. StatusStrip 26 px: muted, mono for URL and time. KPI ribbon: display numerals over caps
labels, hairline dividers, hover lift on drillable cells. Map: rounded inset canvas, translucent
toolbar and legend, markers as 9 px rounded squares with a 1 px ring; the selected marker gets a
halo plus brackets.

Map rendering modes (segmented control, top-right): **Points** (one marker per detection), **Heat**
(leaflet.heat canvas density surface, ember ramp `#7c2d12 → #ea580c → #ff9f3f → #ffd257 → #fff7ed`,
weighted by log-scaled FRP by default, or by risk score or uniform count from the layer picker), and
**Both** (subdued heat beneath the markers). In Heat mode only the selected detection keeps its
marker so the selection is never lost; the legend switches to a gradient bar.
