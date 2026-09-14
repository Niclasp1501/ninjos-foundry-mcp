# Contributing

Thank you for helping to improve Ninjo's Foundry MCP.

This project is **not open source**. Please read [LICENSE](LICENSE) before you
contribute; it decides what applies. This page only explains how contributing works in
practice.

## Bug reports and suggestions

Always welcome. Please use the issue forms:

- [Bug report](https://github.com/Niclasp1501/ninjos-foundry-mcp/issues/new?template=bug_report.yml)
- [Feature request](https://github.com/Niclasp1501/ninjos-foundry-mcp/issues/new?template=feature_request.yml)

Setup questions are usually answered in
[docs/INSTALLATION.en.md](docs/INSTALLATION.en.md). Security vulnerabilities go through
private reporting, see [SECURITY.md](SECURITY.md).

## Code contributions

**Please open an issue and wait for an agreement before you write code.** Pull requests
without a prior agreement may be closed without review. This is not about the quality of
your work:

- The licence lets the author use a contribution under its terms and under any other
  terms the author later chooses for this project, including a more permissive or a
  commercial licence (section "Contributions" of [LICENSE](LICENSE)). By submitting a
  contribution you agree to that. Only submit work you wrote yourself and have the right
  to contribute.
- Code from other projects cannot be accepted, whatever its licence.
- Agreeing on the approach first saves you from work that cannot be merged.

A fork on GitHub may be used to prepare a contribution or to adjust the module for your
own table. It grants no other rights (section "Forks on GitHub" of the licence).

## When a contribution is agreed

- Node 24 or later. `npm ci`, then `npm run check` (typecheck, language files, tests)
  must pass.
- TypeScript, strict. Formatting follows `.prettierrc.json`. `npm ci` installs a commit
  hook that formats the staged files with Prettier; without it, run `npm run format`.
- Tests never use the ports 31414 to 31416 and never need a running Foundry world.
- Tool names, parameters, ports, settings keys and environment variables stay compatible
  with existing installations.
- Every write checks the write switch and the permission level, and reads its result
  back before it reports success. Errors name their cause.
- Text shown in Foundry goes through language keys, in English and German.
- Commit messages in English, following
  [Conventional Commits](https://www.conventionalcommits.org), with the reason for the
  change in the body.
