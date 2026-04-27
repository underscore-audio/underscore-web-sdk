# Security

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security bugs.

Email **security@underscore.audio** with:

- a description of the issue
- steps to reproduce or a proof-of-concept
- the affected version(s)

You will receive a response within 48 hours. If the issue is confirmed,
we will release a patch and credit you in the changelog (unless you
prefer to remain anonymous).

## Supported versions

Only the latest published version on npm receives security fixes.

## Key handling

- **Publishable keys** (`us_pub_...`) are safe to ship in browser code.
  They have `synth:read` scope only and cannot trigger generation or
  access private data.
- **Secret keys** (`us_sec_...`) must never appear in browser code,
  client bundles, or public repositories. Use environment variables and
  a server-side proxy — see `examples/backend-proxy/` for the
  recommended pattern.
