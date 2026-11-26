# Contributing

[English](#english) | [Deutsch](#deutsch)

## English

Thanks for helping! Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first.

### Setup

Requires Node 22 and pnpm 10 (via corepack).

```sh
pnpm install
pnpm dev            # web (Vite) + worker (wrangler dev)
```

The worker serves `apps/web/dist` (`assets.directory`). `pnpm dev` therefore first runs
`scripts/ensure-web-dist.mjs`, which builds the web app once if `apps/web/dist` is missing
(fresh clone). Delete `apps/web/dist` or run `pnpm build` to refresh it; use the Vite dev
server URL for live reload.

`pnpm dev:demo` starts only the web app (Vite) with synthetic demo data relative to today
(Mia and Ben, a week of events and meals, a countdown) - no worker, secrets or calendar
needed.

For local worker secrets copy `.dev.vars.example` to `.dev.vars` in the repository root,
next to the only `wrangler.jsonc` (see [docs/CONFIG.md](docs/CONFIG.md)). Deploying:
[docs/DEPLOY.md](docs/DEPLOY.md).

### Commands and quality gate

```sh
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e       # Playwright (tablet viewports)
pnpm format         # auto-format
pnpm screenshots    # regenerate docs/screenshots (after pnpm build)
```

The gate must be green before every commit and pull request.

### Commits

[Conventional Commits](https://www.conventionalcommits.org/), e.g.
`feat(web): add week view (T-18)`. [lefthook](https://lefthook.dev/) runs checks and
commitlint on commit; do not bypass the hooks.

### Plan and ADR workflow

- [docs/PLAN.md](docs/PLAN.md) is binding: work its tasks (T-xx) in order and link the task in
  your pull request.
- Significant technical decisions get an ADR in [docs/adr/](docs/adr/) (copy the template).
- Plan changes are made consciously: edit PLAN.md, add a change-log entry, separate commit
  `docs(plan): ...`.

### Rules

- **i18n:** UI strings only via `apps/web/src/i18n/locales/{de,en}.json`; both locales complete.
- **No secrets:** never commit iCal URLs, tokens, `.env` or `.dev.vars` files, or real calendar
  data. Fixtures are synthetic.
- **Tests required:** new behavior comes with tests next to the code (`*.test.ts(x)`).
- Code, comments and commit messages in English; user docs in English and German.
- Calendar titles are untrusted plain text: never use `dangerouslySetInnerHTML`.

## Deutsch

Danke für deine Hilfe! Bitte lies zuerst den [Verhaltenskodex](CODE_OF_CONDUCT.md) (englisch).

### Einrichtung

Benötigt Node 22 und pnpm 10 (über corepack): `pnpm install`, dann `pnpm dev`. Der Worker
liefert `apps/web/dist` aus; `pnpm dev` baut die Web-App daher einmalig, falls das Verzeichnis
fehlt (frischer Klon, `scripts/ensure-web-dist.mjs`). Lokale
Worker-Secrets: `.dev.vars.example` im Repository-Root nach `.dev.vars` kopieren (neben der
einzigen `wrangler.jsonc`, siehe [docs/CONFIG.md](docs/CONFIG.md)). Deployment:
[docs/DEPLOY.de.md](docs/DEPLOY.de.md).

### Befehle und Qualitätsprüfung

`pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build` muss vor jedem
Commit und Pull Request grün sein. E2E-Tests: `pnpm test:e2e`, Formatieren: `pnpm format`.
`pnpm dev:demo` startet nur die Web-App mit synthetischen Demo-Daten (relativ zu heute);
`pnpm screenshots` (nach `pnpm build`) erzeugt `docs/screenshots` neu.

### Commits

[Conventional Commits](https://www.conventionalcommits.org/), z. B.
`feat(web): add week view (T-18)`. lefthook prüft beim Commit (inkl. commitlint); Hooks nicht
umgehen.

### Plan- und ADR-Ablauf

- [docs/PLAN.md](docs/PLAN.md) ist verbindlich: Aufgaben (T-xx) der Reihe nach bearbeiten und
  im Pull Request verlinken.
- Wichtige technische Entscheidungen bekommen ein ADR in [docs/adr/](docs/adr/).
- Planänderungen bewusst: PLAN.md ändern, Change-Log-Eintrag, eigener Commit `docs(plan): ...`.

### Regeln

- **i18n:** UI-Texte nur über `apps/web/src/i18n/locales/{de,en}.json`, beide Sprachen komplett.
- **Keine Geheimnisse:** niemals iCal-URLs, Tokens, `.env`/`.dev.vars` oder echte Kalenderdaten
  einchecken. Fixtures sind synthetisch.
- **Tests Pflicht:** neues Verhalten kommt mit Tests neben dem Code.
- Code, Kommentare und Commits auf Englisch; Nutzerdokumentation auf Englisch und Deutsch.
