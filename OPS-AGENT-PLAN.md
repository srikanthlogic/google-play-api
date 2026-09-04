# GPlayAPI Ops Agent — Plan (finalized 2026-09-04)

Automated ops watchdog for the Fly.io deployments. Implementation:
`Skills/gplay-ops-agent/` (outside this repo; tickets land here).

## Resolved decisions

| Decision | Choice |
| --- | --- |
| Cadence | Twice daily (~09:30 + ~21:30 IST) via scheduled agent |
| Severity floor | HIGH + MEDIUM only |
| Apps watched | `gplayapiv2` only; add `googleplayapi` when v2 hits prod |
| Run summaries | Piped to Discord `#incidents` (LogicPlay guild) |
| Ticket store | GitHub issues on `srikanthlogic/google-play-api`, label `ops` |

## Pipeline

1. **Collect** — `flyctl logs -a gplayapiv2` (short Fly retention → recent
   window), live probes (`/healthz`, `/v2/apps/:sample`, `/api/apps/:sample`
   frozen shape, unknown-param → problem+json), latest `deploy-v2dev.yml`
   run status via `gh`.
2. **Detect** — rules: 5xx clusters (HIGH), retry-exhausted (HIGH),
   upstream schema drift (HIGH), deploy failure (HIGH), probe failures
   (HIGH/MEDIUM), upstream blocks + 429s (MEDIUM).
3. **Dedup** — stable fingerprint per finding (rule + normalized endpoint +
   message). New → issue; known + open → comment with cumulative count;
   known + closed by human → new ticket. State: skill `data/state.json`.
4. **Report** — agent posts terse scan result to `#incidents`; clean runs
   are one line, findings get table + links.

## Conventions

- Titles: `[ops][v2] <SEVERITY> <rule>: <summary>`; labels `ops`,
  `severity:high|medium`, `v2`.
- Bodies include evidence, log samples (PII-safe: scraper metadata only,
  no request bodies), dedup fingerprint, links.
- Secrets: `FLY_IO_TOKEN` (read-scope Fly token) passed as `FLY_API_TOKEN`
  to flyctl; `gh` uses repo auth.
