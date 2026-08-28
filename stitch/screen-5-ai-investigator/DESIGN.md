---
name: Thermal Intelligence System
colors:
  surface: '#131315'
  surface-dim: '#131315'
  surface-bright: '#39393b'
  surface-container-lowest: '#0e0e10'
  surface-container-low: '#1b1b1d'
  surface-container: '#1f1f21'
  surface-container-high: '#2a2a2b'
  surface-container-highest: '#353436'
  on-surface: '#e4e2e4'
  on-surface-variant: '#c6c6cd'
  inverse-surface: '#e4e2e4'
  inverse-on-surface: '#303032'
  outline: '#909097'
  outline-variant: '#45464d'
  surface-tint: '#bec6e0'
  primary: '#bec6e0'
  on-primary: '#283044'
  primary-container: '#0f172a'
  on-primary-container: '#798098'
  inverse-primary: '#565e74'
  secondary: '#b9c7e0'
  on-secondary: '#233144'
  secondary-container: '#3c4a5e'
  on-secondary-container: '#abb9d2'
  tertiary: '#dec29a'
  on-tertiary: '#3e2d11'
  tertiary-container: '#231500'
  on-tertiary-container: '#957d5a'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#d5e3fd'
  secondary-fixed-dim: '#b9c7e0'
  on-secondary-fixed: '#0d1c2f'
  on-secondary-fixed-variant: '#3a485c'
  tertiary-fixed: '#fcdeb5'
  tertiary-fixed-dim: '#dec29a'
  on-tertiary-fixed: '#271901'
  on-tertiary-fixed-variant: '#574425'
  background: '#131315'
  on-background: '#e4e2e4'
  surface-variant: '#353436'
typography:
  headline-sm:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  data-lg:
    fontFamily: JetBrains Mono
    fontSize: 16px
    fontWeight: '500'
    lineHeight: 20px
  data-md:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.05em
spacing:
  unit: 4px
  sidebar-width: 320px
  toolbar-width: 48px
  gutter: 12px
  margin-compact: 8px
---

## Brand & Style

The design system is engineered for high-stakes geospatial monitoring and thermal intelligence. The brand personality is clinical, authoritative, and precise, mimicking the aesthetic of a government command center or a scientific laboratory. 

The visual style is **Scientific Minimalism**. It prioritizes data integrity and rapid information scanning over decorative elements. The interface utilizes high-contrast dark environments to ensure that thermal hotspots and map overlays remain the primary focal points. Layouts are strictly functional, utilizing thin lines and a rigid grid to organize complex datasets into digestible streams.

## Colors

The palette is optimized for dark-room environments and long-duration monitoring. 

- **Basemap & Surfaces:** A deep slate/charcoal (#0f172a) serves as the foundation to minimize eye strain and maximize the luminosity of data points.
- **Functional Accents:** Color is used exclusively for classification. Do not use accent colors for purely decorative UI elements.
- **Status & Risk:** Semantic colors for Green/Yellow/Red follow standard emergency management protocols.
- **Interactions:** Hover states and selections should use a desaturated blue-gray to remain distinct from thermal classifications.

## Typography

This design system employs a dual-font approach. **Inter** is used for all UI controls, navigation, and instructional text to ensure maximum readability at small scales. **JetBrains Mono** (monospaced) is used for all coordinate data, timestamps, thermal readings, and numerical values to prevent "jumping" during real-time data refreshes.

Maintain high information density by utilizing `body-sm` as the primary reading size. Use `label-caps` for metadata headers and sidebar categories to establish clear hierarchy without increasing font size.

## Layout & Spacing

The layout follows a **Fixed-Component Fluid-Map** model. The central viewport is a fluid GIS map, flanked by fixed-width functional sidebars. 

- **Grid:** Use a 4px baseline grid. All spacing increments must be multiples of 4.
- **Sidebars:** Primary data controls are housed in a 320px left sidebar. Real-time alerts and "fire-feed" lists are housed in a right-aligned collapsible panel.
- **Density:** Padding is kept to a minimum (8px to 12px) to allow as much data as possible to be visible above the fold.
- **Breakpoints:** On smaller screens, sidebars must be collapsible into icon-only rails to preserve map visibility.

## Elevation & Depth

This system avoids shadows to maintain a "flat-lens" scientific feel. Hierarchy is instead communicated through **Tonal Layering** and **Borders**:

- **Level 0 (Map):** The base layer.
- **Level 1 (Sidebars/Panels):** Raised using a slightly lighter fill (#1e293b) and a 1px solid border (#334155).
- **Level 2 (Modals/Popovers):** Highest priority elements use the same slate fill but are surrounded by a high-contrast border and a very subtle 10% opacity black glow to separate them from the background.
- **Outlines:** Use 1px borders for all container separations. Do not use rounded corners.

## Shapes

The shape language is strictly **Sharp (0px)**. 

All buttons, cards, input fields, and map markers must utilize square corners. This reinforces the "engineered" and "technical" nature of the platform. Circular shapes are reserved exclusively for status indicators (LED-style dots) and map point-features where necessary for legibility.

## Components

- **Buttons:** Rectangular with 1px borders. Primary buttons use a subtle gray fill; destructive or high-alert buttons use the specific category accent color as a solid background.
- **Data Tables:** Highly compact. Use monospaced fonts for numerical columns. Zebra-striping is forbidden; use 1px horizontal dividers only.
- **Map Markers:** Small 8px squares for thermal sources, color-coded by classification. Active/Selected markers should have a "crosshair" bracket appearing around them.
- **Inputs:** Dark background (#020617) with a 1px border. Focus state is indicated by a white 1px border.
- **Chips:** Small, square-edged labels for "Wildfire" or "Risk Level." Use a 10% opacity tint of the category color for the background and the 100% opacity color for the text.
- **Navigation:** Icon-heavy, vertical rail. Icons should be simple, geometric line art (2px stroke).