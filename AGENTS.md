# Agent rules for underscore-web-sdk

This file is committed to a **public** repository. Every word in this
file, in commit messages, in PR descriptions, in CI workflow comments,
and in code comments is visible to the internet.

## Public-repo disclosure rules

These rules are non-negotiable. Violating them leaks private
infrastructure details to the public.

1. **Never reference the private backend repo by org or path.**
   Do not write `po-studio/underscore`, `po-studio/*`, or any GitHub
   URL pointing to the private repo. Use "the underscore backend" or
   "the backend repo" in prose. CI workflows that need to clone it
   must use `secrets.*` or environment variables for the repo path —
   never hardcode it.

2. **Never reference Linear tickets, project names, or IDs.**
   No `UND-XX`, no `Closes UND-XX`, no Linear URLs. Use plain
   language in commit messages and PR descriptions. The private repo
   can reference Linear; this one cannot.

3. **Never reference internal route names, script paths, or file
   paths from the backend repo.** Do not mention `/cli/auth`,
   `web/scripts/sdk-live-runner.ts`, `canvases/*.canvas.tsx`, or
   any other path that exists only in the private repo. Describe
   behavior generically: "provisions a test user and mints API keys".

4. **Never reference internal tooling by name.** Do not mention
   `@clerk/testing`, `@clerk/backend`, specific Playwright fixture
   file names, or test orchestrator scripts that live in the private
   repo. Say "the test harness" or "the CI runner" instead.

5. **Never put secret values, AWS account IDs, ARNs, or
   infrastructure details in code, comments, or docs.** Use
   `secrets.*` references in CI. If a value must appear in a
   comment, use a placeholder like `<your-account-id>`.

6. **PR descriptions must be self-contained.** A PR description on
   this repo should make sense to an external contributor who has
   never seen the private backend. No "sister PR in ..." references.
   No links to private repos, private dashboards, or private canvases.

7. **Commit messages: conventional commits, no ticket IDs.**
   Format: `<type>(<scope>): <description>`. No `(UND-XX)` suffix.
   The private repo uses ticket IDs in commits; this repo does not.

## Code and CI conventions

- SDK is published to npm as `@underscore-audio/sdk`. Wizard is
  `@underscore-audio/wizard`. Both are public packages.
- Publish is tag-triggered (`v*`). Never publish on push to main.
- The e2e gate job (`e2e-against-deployed`) tests the SDK against
  a pinned backend SHA stored in `.underscore-version`. It self-skips
  when Clerk test secrets are not configured.
- Pre-commit hook runs lint-staged + typecheck + unit tests. Live
  tests are never run by the hook.
- Environment variable names (`UNDERSCORE_BASE_URL`,
  `UNDERSCORE_PUBLISHABLE_KEY`, etc.) and key prefixes (`us_pub_`,
  `us_sec_`) are part of the public SDK contract and fine to mention.

## When in doubt

If you're unsure whether something is safe to include in a public
commit, PR, or comment: leave it out. You can always add detail in
the private repo's commit that references this one.
