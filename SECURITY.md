# Security policy / Sicherheitsrichtlinie

## Reporting a vulnerability / Sicherheitslücke melden

Please report vulnerabilities **privately** through a
[GitHub Security Advisory](https://github.com/FinkeFlo/kidboard/security/advisories/new)
("Report a vulnerability" on the repository's Security tab). Do not open public issues or
pull requests for security problems. You can write in English or German. We aim to
acknowledge a report within a few days.

Bitte melde Sicherheitslücken **privat** über eine
[GitHub Security Advisory](https://github.com/FinkeFlo/kidboard/security/advisories/new)
(Reiter "Security", "Report a vulnerability"). Keine öffentlichen Issues oder Pull Requests
für Sicherheitsthemen. Englisch oder Deutsch ist beides willkommen.

## Supported versions / Unterstützte Versionen

KidBoard is pre-1.0. Only the latest release (and the `main` branch) receives security fixes.

| Version        | Supported |
| -------------- | --------- |
| latest release | yes       |
| older          | no        |

## In scope / Im Geltungsbereich

- Leakage of secret iCal URLs (client bundle, API responses, logs, error messages, caches)
- Bypass of the access token (or of the parent PIN lockout) or of the CORS allow-list
- Cross-site scripting through calendar titles or descriptions
- Server-side request forgery or resource exhaustion via feed fetching
- Secrets or real calendar data committed to the repository

## Out of scope / Nicht im Geltungsbereich

- Vulnerabilities in Google Calendar, Cloudflare, Vercel or other third-party services
- Attacks that require physical access to an unlocked kiosk tablet
- Findings from automated scanners without a demonstrated impact

## If your iCal URL leaked / Wenn deine iCal-URL öffentlich wurde

Treat it as compromised: in Google Calendar reset the secret address ("Reset" next to the
secret iCal address), then update the `CAL_<ID>_URL` secret. / Betrachte sie als kompromittiert:
In Google Kalender die geheime Adresse zurücksetzen und das Secret `CAL_<ID>_URL` aktualisieren.
