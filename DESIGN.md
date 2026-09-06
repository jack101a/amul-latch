---
name: Latch Dark Reserve
description: Minimalist, utilitarian dark design system for the Amul Protein Restock Watcher.
colors:
  background: "#0c0d0b"
  foreground: "#f2efe6"
  card: "#141612"
  card-foreground: "#f2efe6"
  muted: "#1c1e19"
  muted-foreground: "#9a9b93"
  subtle: "#6e6f68"
  border: "#2a2c27"
  primary: "#e8e4d4"
  primary-foreground: "#0c0d0b"
  destructive: "#c45c4a"
  stock: "#6f8f6a"
  warn: "#c4a574"
typography:
  display-lg:
    fontFamily: Fraunces
    fontSize: 48px
    fontWeight: 400
    lineHeight: 1.0
    letterSpacing: -0.02em
  body-md:
    fontFamily: IBM Plex Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  code-sm:
    fontFamily: IBM Plex Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
rounded:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 20px
  xl: 28px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
---

# Latch Design Specification

## Overview
Latch utilizes a refined, low-emission dark theme inspired by industrial telemetry consoles, Swiss typographic discipline, and warm ivory accents. It avoids generic pure blacks and neon colors in favor of balanced earth tones (`#0c0d0b`) paired with vintage Fraunces display serif and utilitarian IBM Plex sans & mono typography.

## Colors
- **Background (`#0c0d0b`)**: Deep organic black charcoal providing comfortable viewing for 24/7 background monitoring.
- **Card (`#141612`)**: Elevated dark graphite surface with hairline borders (`#2a2c27`).
- **Foreground (`#f2efe6`)**: Warm milk-ivory text for effortless readability.
- **Stock / Status Active (`#6f8f6a`)**: Sage green indicator for in-stock and active connections.
- **Warning / Action Pending (`#c4a574`)**: Warm amber for payment authorization and checkout progression.
- **Destructive (`#c45c4a`)**: Brick crimson for out-of-stock and system alerts.

## Typography
- **Headings & Brand**: `Fraunces` serif providing an editorial, trustworthy dairy craft feel.
- **Interface & Data**: `IBM Plex Sans` for balanced UI hierarchy.
- **Telemetry & SKUs**: `IBM Plex Mono` for tabular inventory numbers, timestamps, and PIN codes.

## Components
- **Product Card**: Micro-elevated card with hairline borders, image ratio 5:4, and clear quantity stepper.
- **Status Telemetry Pill**: Pulsing sage green indicator communicating live background polling.
- **Session Verification Card**: Distinct green/amber card displaying authenticated customer profile, phone/email, and verified delivery address.
