# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Report it through GitHub's private advisory form:
[**Report a vulnerability**](https://github.com/OyadotAI/oya-browser/security/advisories/new).

You should get an acknowledgement within 3 working days and a fix or a
timeline within 14 days. If you do not hear back, open a public issue saying
only that you sent a private report — no details.

## Supported versions

Fixes land on `main` and ship in the next tagged release. Older tags are not
patched.

## What is in scope

The control plane (`server/`), the browser runtime (`browser/`), the console
(`ui/`), the SDK and CLI (`packages/`), and the deployment manifests
(`Dockerfile`, `docker-compose.yml`, `k8s/`).

Things we already know and treat as by design, so please don't report them as
vulnerabilities:

- **`OYA_ALLOW_PRIVATE_TARGETS=true` reaches private addresses.** That is the
  whole point of the flag; it is off by default and documented as
  single-operator only.
- **`API_KEYS` grants API access without a database.** Env grants existence,
  not authority — host-level operations need `OYA_OPERATOR_TOKEN`.
- **A self-hosted install generates `server/data/.secret` when
  `OYA_PROFILE_SECRET` is unset.** Operator-supplied is better and the server
  says so on boot, but a generated key beats storing credentials in plaintext.
- **Anti-detection.** Fingerprint and stealth behaviour is the product, not a
  bug class.

## Handling credentials

The server encrypts profile snapshots, proxy credentials and MFA seeds at rest
with AES-256-GCM under a KEK derived from `OYA_PROFILE_SECRET`. If you find a
path where any of those leave the process in plaintext — an API response, a
log line, an error message — that is a valid report.
