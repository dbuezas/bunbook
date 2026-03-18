# Release Skill

Use when the user types /release. Bumps the package version, updates the changelog, commits, tags, and builds the vsix.

## Steps

1. **Determine the version bump**: Ask the user which semver component to bump (patch, minor, or major). Default to patch.

2. **Bump the version** in both `package.json` and `cli/package.json` by editing the `"version"` field in each.

3. **Generate the changelog entry**:
   - Find the latest git tag (e.g. `v0.0.5`) using `git describe --tags --abbrev=0`.
   - Get the full diff since that tag: `git diff <tag>..HEAD` and also `git log <tag>..HEAD --oneline` for context.
   - Read the actual code changes to understand what was done. Don't trust commit messages — they may be vague or inaccurate. Base the changelog on what the code actually changed.
   - Summarize the changes into concise, user-facing bullet points grouped by theme (fixes, features, improvements). Omit changelog-only commits and trivial formatting changes. Each bullet should clearly describe the user-facing impact.
   - Prepend a new `## <new-version>` section at the top of `CHANGELOG.md` (after the `# Changelog` header), following the existing format.

4. **Commit the changes**: Stage `package.json` and `CHANGELOG.md`, then commit with message `v<new-version>`.

5. **Create the git tag**: `git tag v<new-version>`.

6. **Build the vsix**: Run `bun start` to build, package, and install the extension locally.

7. **Push to remote**: Run `git push && git push --tags` to push the commit and tag, triggering the GitHub Actions publish workflow.

## Important

- The changelog file is `CHANGELOG.md` (uppercase). Do NOT create or edit `changelog.md` (lowercase).
- Both `package.json`, `cli/package.json`, and `CHANGELOG.md` must be in a single commit. Never commit one without the others.
- Stage all three files explicitly by name: `git add package.json cli/package.json CHANGELOG.md`.
- The commit and tag must happen in one command chain: `git add ... && git commit -m "v<version>" && git tag v<version>`.
- Follow the existing CHANGELOG.md format exactly (see existing entries for style).
- Do NOT include the `Co-Authored-By` trailer in the commit message for this skill.
- The tag format is `v<version>` (e.g. `v0.0.6`).
- If there are no commits since the last tag, inform the user and abort.
