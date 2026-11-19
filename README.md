# ledger.pencil

The gated site for Pencil ledgers, served at `ledger.pencilbot.ai`.

A Pencil ledger records the transactional objects tied to a subject
property and marks each one verified, not verified, or unknown. This
repository turns ledger files into pages and puts a gate in front of them.
The skill, doctrine, and case studies live in the separate
`project-pencil` repository.

**Status: first build. Not deployed.** It holds two demonstration ledgers
with invented facts.

## What is here

| Path | Purpose |
|---|---|
| `ledgers/<slug>/ledger.json` | One ledger per subject. The source of truth. |
| `build.py` | Validates every ledger and writes the site into `dist/`. Stops if any ledger is invalid. |
| `tools/pencil_ledger.py` | The Pencil ledger script, copied from `project-pencil` (`skill/pencil/scripts/`). Keep the two in step. |
| `site/` | Stylesheet, the in-browser hash check, and response headers. |
| `functions/_middleware.js` | The gate. Runs in front of every request and fails closed. |
| `tests/test_gate.mjs` | Tests for the gate and for the hash check. |

## How a page is made

`build.py` reads a ledger file, runs it through the same validator the
skill uses, and renders the counts, discoveries, alignment, cures and
entries that the script computes. The page cannot say anything the ledger
file does not. Each page prints the ledger's hash, and a button recomputes
that hash in the reader's browser from the downloadable `ledger.json`.

A ledger shows "Draft. Not reviewed by a human. Not for release." until a
named reviewer has signed it with the script's `review` command.

## Build and test locally

```
python3 build.py            # writes dist/
node tests/test_gate.mjs    # gate and hash tests
```

Python 3 and Node 18 or later. No packages to install.

## The gate

Two layers, both required:

1. **Cloudflare Access** in front of the hostname decides who may sign in.
2. **`functions/_middleware.js`** verifies the signed Access token on every
   request: signature against the team's published keys, audience, issuer,
   and expiry. A request that did not come through Access gets a 403 and no
   content. If the gate's settings are missing, the site serves nothing.

The second layer is what protects the `*.pages.dev` addresses, which a
policy on the custom domain does not cover.

## Deploying on Cloudflare

1. **Create the Pages project.** Workers & Pages → Create → Pages → Connect
   to Git → this repository. Build command `python3 build.py`. Build output
   directory `dist`. Production branch `main`.
2. **Create the Access application.** Zero Trust → Access → Applications →
   Add → Self-hosted. Application domain `ledger.pencilbot.ai`. Add an
   Allow policy listing the email addresses that may sign in. Copy the
   Application Audience (AUD) tag from the application's overview.
3. **Set the gate's variables.** Pages project → Settings → Variables and
   Secrets, for Production and Preview:
   - `ACCESS_TEAM_DOMAIN` = `https://<your-team>.cloudflareaccess.com`
   - `ACCESS_AUD` = the AUD tag from step 2
   - `ALLOWED_EMAILS` (optional) = comma-separated addresses, as a second
     check inside the site
4. **Add the custom domain.** Pages project → Custom domains →
   `ledger.pencilbot.ai`.
5. **Redeploy**, then check: signed in, the index loads; in a private
   window, you are sent to the Access sign-in; and the project's
   `*.pages.dev` address returns 403.

## Adding a ledger

1. Create `ledgers/<slug>/ledger.json` (lowercase letters, digits, hyphens).
2. Run `python3 build.py`. Fix anything the validator reports.
3. Commit and push. Pages builds and publishes it.

## Before any real ledger goes in

- **Keep this repository private.** Everything under `ledgers/` is
  readable by anyone who can read the repository, whatever the site's gate
  does.
- **One gate for the whole site, for now.** Everyone who can sign in can
  see every ledger and the index. Per-ledger access (an owner and that
  ledger's recipients only) needs either one Access application per path
  or a per-ledger list checked in the middleware. Not built yet.
- **The open questions in `project-pencil/DOCTRINE.md`** on reliance,
  counterparty evidence, and withholding should be ruled on first.
