# Security Policy

## Supported Versions

Only the latest stable release and the current `dev` branch receive security
fixes. Older releases are not patched; update to the newest release before
reporting.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability. This includes
problems that could expose private data, bypass authentication or authorization,
run code unexpectedly, escape filesystem boundaries, or compromise an Alloy
server or desktop client.

Report vulnerabilities privately through
[GitHub security advisories](https://github.com/zekurio/alloy/security/advisories/new).

Use this outline so we can understand and reproduce the report quickly:

```markdown
## Summary

A short description of the vulnerability.

## Affected component and version

The Alloy release, commit, or flake revision and the affected component:
server, web, desktop, recorder, or another package.

## Impact

Who or what could be affected, what an attacker could gain, and any conditions
required for exploitation.

## Reproduction

Numbered steps, a minimal proof of concept, and any relevant configuration.
Please remove secrets and personal data from logs or screenshots.

## Suggested remediation

Optional ideas for fixing or mitigating the issue.

## Disclosure

Any known disclosure timeline or other parties already notified.
```

Reports that do not describe a security boundary or impact may be redirected to
the public issue tracker.

## What to Expect

You should get an initial response within a week. Please give us a chance to
confirm the report and ship a fix before disclosing it publicly. We may ask for
more information or invite you to collaborate on the private advisory.

Alloy does not currently offer a bug bounty or guarantee payment for reports.

## For Server Operators

Alloy is self-hosted software. Server operators are responsible for keeping
their deployments updated and protecting their own infrastructure, secrets,
backups, and network configuration.
