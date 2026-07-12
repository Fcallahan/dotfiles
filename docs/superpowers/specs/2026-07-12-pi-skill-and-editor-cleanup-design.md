# Pi Skill and Editor Cleanup Design

## Goal

Remove duplicate Jira skill warnings and make PiGate's input editor visually distinct from the conversation.

## Skill collision cleanup

The duplicate `jira-cli-workflow` and `pr-jira-code-review` skills under `~/.claude/skills` and `~/.agents/skills` are byte-for-byte identical.

Use the `~/.claude/skills` directories as the canonical copies. Replace the corresponding `~/.agents/skills` directories with relative symlinks to those canonical directories. Pi may still discover both paths, so the durable collision fix is also to stop explicitly loading `~/.claude/skills` from Pi settings if that configured source is what creates the duplicate discovery. Verify Pi's effective settings and startup output after the filesystem change.

Preserve skill names and contents. Do not alter unrelated duplicate skills.

## Editor treatment

Enable the Pi Zentui editor and retain the existing custom status line. Style the editor as the approved “clear frame” treatment:

- show the current working path above the editor through Zentui's editor metadata;
- use an accent-colored editor border;
- use the active theme's distinct editor background;
- retain compact model/provider/thinking context;
- do not add a `MESSAGE` label.

Use existing Zentui configuration and theme tokens rather than introducing a custom editor extension.

## Validation

1. Parse all modified JSON configuration.
2. Confirm both Jira skill aliases resolve to their canonical directories and their `SKILL.md` files remain readable.
3. Start Pi in a non-destructive diagnostic/help mode and confirm the two named collision warnings are absent.
4. Confirm Zentui loads with its editor enabled and the configured accent border token.
5. Preserve all unrelated uncommitted dotfiles changes.

## Scope

Only the two reported skill collisions and PiGate editor presentation are included. Existing plan-build work, model settings, status-line customization, and other duplicate skills are out of scope.
