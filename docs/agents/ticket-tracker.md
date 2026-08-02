# Ticket tracker: GitHub Projects

Internal tickets, PRDs, and agent findings for this repository live as **draft items in a GitHub Project**. Draft Project items are the default because they stay in the Project and do not add noise to the repository's Issues list.

Do not create a repository issue, convert a draft item to an issue, or fall back to Issues unless the user explicitly requests that change for a specific ticket.

## Target Project

- Project: https://github.com/users/imom39a/projects/2
- Project number: `2`
- Project owner: `imom39a`
- Linked repository: `imom39a/lightstreamer-workbench-extension`
- Repository Projects page: https://github.com/imom39a/lightstreamer-workbench-extension/projects

Before the first write, verify that Project `2` is still open, owned by `imom39a`, and linked to this repository. If it has been closed, deleted, transferred, or unlinked, stop and ask the user for the replacement Project. Do not guess among unrelated Projects owned by `imom39a`.

## Authentication

GitHub CLI reads require the `read:project` scope and writes require the `project` scope. Check access before publishing. If it is missing, report that the user must run:

```sh
gh auth refresh -s project
```

Do not substitute repository Issues when Project authorization is unavailable.

## Ticket conventions

- Create each ticket with `gh project item-create 2 --owner imom39a` so it is a draft Project item, not a repository issue.
- Derive a short, unique slug for each approved ticket batch and number it in dependency order: `<slug>-01 —`, `<slug>-02 —`, and so on. List existing items before publishing and do not reuse an existing batch key.
- Put the complete ticket description and acceptance criteria in the draft item's body.
- Represent blocking edges in the body's `Blocked by` section using the stable ticket key and title. Draft Project items do not use GitHub issue dependencies.
- Set newly published tickets to `Status: Todo`. Use `In Progress` when claimed and `Done` when completed.
- Verify the full published batch with `gh project item-list 2 --owner imom39a --format json`.

## Ticket body

```markdown
## What to build

The complete, user-visible behaviour delivered by this ticket.

## Acceptance criteria

- [ ] Verifiable criterion 1
- [ ] Verifiable criterion 2

## Blocked by

- `<slug>-01 — Blocking ticket`, or "None — can start immediately".

## Source

Link the source plan, spec, conversation artifact, Project item, or issue when one exists; otherwise omit this section.
```

## Reading and working the frontier

- List Project fields with `gh project field-list 2 --owner imom39a --format json`.
- List draft items with `gh project item-list 2 --owner imom39a --format json` and identify them by their `<slug>-NN` key.
- A ticket is on the frontier when every ticket in its `Blocked by` section has the Project's done status.
- Claim and completion are Project field updates. They are not issue assignment, labels, comments, or issue closure.

## Repository Issues boundary

Repository Issues remain available for repository-facing reports and triage. If an internal Project draft becomes appropriate for public collaboration or needs issue-only features, convert it only after the user explicitly asks for that conversion.
