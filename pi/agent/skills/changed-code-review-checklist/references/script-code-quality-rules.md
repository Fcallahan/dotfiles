# Python and Shell Code Quality Rules

Apply these rules to changed production, CI, deployment, and repository-maintenance scripts. Do not apply them to disposable commands that are not checked in.

## Shared rules

- Run every configured analyzer that covers the changed language before completion. Formatters and syntax checks do not replace SonarCloud, ShellCheck, complexity checks, or repository-specific quality gates.
- Treat new-code quality gates as completion gates. Resolve analyzer findings before committing when the analyzer can be run locally; otherwise inspect the changed code against these rules before pushing.
- Replace repeated nontrivial literals, command formats, regular expressions, and error messages with one named constant or one focused helper. Do not introduce a constant for a literal used only once.
- Keep each function below the repository's configured cognitive-complexity limit. Target 15 or lower when no local threshold is available. Extract classification, validation, formatting, and reporting into focused helpers rather than hiding complexity in nested conditions.
- Prefer the smallest behavior-preserving refactor. Re-run positive and negative-path checks after decomposition.

## Shell

- Assign positional parameters to descriptive local variables at the start of every function before validation, branching, logging, or reuse.

```bash
# Good
group_project() {
  local group="$1"
  case "$group" in
    # ...
  esac
}

# Avoid
group_project() {
  case "$1" in
    # ...
  esac
}
```

- Declare variables separately from command-substitution assignment when the command's exit status matters. Mark them readonly after successful assignment when appropriate; this avoids masking failures (`SC2155`).
- Keep `printf` format strings static. If a quality rule explicitly requires a shared readonly format constant, document and narrowly suppress `SC2059` only when the constant is controlled and cannot contain user input. Otherwise prefer one helper containing one literal format string.
- Quote expansions and arrays, enable strict mode for standalone CI scripts, and handle empty globs explicitly.
- Run `bash -n` and `shellcheck` on every changed checked-in shell script.

## Python

- Keep orchestration functions small. Move artifact classification, XML parsing, validation, and reporting into focused helpers with explicit inputs and return values.
- Assign command-line positional arguments to meaningfully named local variables before passing them into application logic.
- Do not use broad exception handling to reduce complexity; preserve failures that should stop CI.
- Use stable test identities and deterministic collections when validating partitions or generated artifacts.
- Run `python3 -m py_compile` and a complexity tool such as `radon cc -s` on changed checked-in Python scripts when available.
