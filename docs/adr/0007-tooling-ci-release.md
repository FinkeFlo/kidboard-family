# ADR-0007: Tooling, CI, release and dependency updates

- Status: accepted
- Date: 2026-11-22

## Decision
* **Lint/format:** ESLint 9 flat config (`typescript-eslint` strict-type-checked,
  `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react` for
  `no-danger`, `eslint-plugin-simple-import-sort`), Prettier 3 +
  `prettier-plugin-tailwindcss`, EditorConfig.
* **Git hooks:** lefthook (single binary, no `.husky` scripts) running Prettier/ESLint on
  staged files and commitlint (`@commitlint/config-conventional`) on commit-msg.
  Chosen over husky + lint-staged: one tool, one config file.
* **CI:** GitHub Actions – pnpm install with cache, lint, typecheck, test, build,
  Playwright smoke (Chromium), gitleaks secret scan. Third-party actions pinned to commit
  SHAs with version comments.
* **Release:** release-please (single version for the repo, Conventional Commits →
  `CHANGELOG.md`, GitHub release + tag). Changesets is aimed at publishing many npm
  packages, which KidBoard does not do.
* **Dependencies:** Dependabot (built into GitHub, no app install needed), weekly,
  grouped (dev tooling, React, Cloudflare, GitHub Actions). Renovate considered; requires
  installing an app on the account.
