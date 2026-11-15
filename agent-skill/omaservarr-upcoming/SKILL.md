---
name: omaservarr-upcoming
description: Show upcoming TV episodes, movie releases and album releases from Sonarr, Radarr and Lidarr, and what was imported recently. Trigger on "what's airing this week", "upcoming episodes", "when is the next episode of X", "what's coming out", "what got added recently".
---

# Omaservarr: upcoming and recent

## Upcoming

```sh
omaservarr upcoming        # next 7 days
omaservarr upcoming 14     # next 14 days (1 to 60)
```

One line per item, tab-aligned: local date and time, service, title. Movies
are listed under whichever of their digital, physical or cinema dates falls
in the window, and the line says which one.

Only monitored items are included.

## Recently imported

```sh
omaservarr recent
```

The 30 latest imports across all services, newest first: date, service,
title, quality.

## When to use which

- "What's on this week", "what airs tonight" -> `upcoming`
- "When is the next episode of X" -> `upcoming 60`, then filter for X. If X
  is not in the output, say nothing is scheduled in the next 60 days rather
  than guessing a date.
- "Did X get downloaded", "what's new" -> `recent`

## Rendering

Group upcoming items by day, soonest first:

```
Today
  21:00  The Bear - S04E03 (Sonarr)
Fri 20 Nov
  Dune: Part Two (2024) - digital (Radarr)
```

Answer a narrow question narrowly. Don't dump the whole calendar when the
user asked about one show.

## No mutations

This skill only reads. No confirmation needed.
