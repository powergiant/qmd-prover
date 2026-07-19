# qmd-prover

qmd-prover is an add-on for your AI coding assistant (either **Claude Code** or **Codex**) that
helps it write and check real mathematics.

The most important thing to understand first: **you do not run any of this yourself.** You talk to
your AI assistant in plain English — "prove this theorem", "check my notes", "what is still
unproved?" — and the assistant runs every command for you and explains the results back in plain
words. Throughout this page you will see commands and code. They are shown only so you can see what
the assistant is doing behind the scenes. You never type them.

## What it is, in one paragraph

The mathematics lives in **`.qmd` files**. A `.qmd` file is a plain-text document that mixes
ordinary writing, mathematical notation, and clearly labeled theorem and proof blocks.
[Quarto](https://quarto.org/) can later turn a `.qmd` file into a polished web page or PDF.

You give your assistant a goal, and it can work in either of two ways:

- **From scratch.** Give it a result you want proved, and it invents the definitions, lemmas, and
  proofs the result needs and builds them up on its own.
- **From your own notes.** Hand it a rough proof sketch or a set of half-finished arguments, and it
  writes them up properly, fills the gaps, and checks the result against what you wrote.

Either way, the assistant checks the work in two layers — first with plain non-AI checks on how the
document is put together, and then (if you set it up) with a second, independent AI that reviews each
proof. It then tells you, in plain language, what is proved, what is still unproved, and what is
stuck.

## A few words you will need

You only need a handful of terms to follow the rest of this page. Each is defined once, here.

- **Goal.** A main result you want proved. Its wording is *protected*: once you state a goal, the
  assistant can prove it and build on it, but it cannot change or weaken what you asked for without
  telling you.
- **Dependency.** When one proof uses another result, we say the first *depends on* the second. If
  you change or remove the second, the first may no longer hold.
- **Dependency graph.** The full map of which results depend on which other results across your whole
  project. The assistant builds and maintains this map for you.
- **Verifier.** A separate AI (Claude or Codex) that reads one proof at a time and judges whether it
  is correct, using only the exact statements that proof cites. This layer is optional. It is AI
  review, not a mathematical certificate of correctness.
- **The status of a result.** Every result is in one of a few plain states:
  - **open** — stated, but not proved yet.
  - **unverified** — it has a proof that passed the mechanical checks, but no verifier has reviewed
    that proof yet (for example, because you have not set up a verifier).
  - **verified** — it has a proof that passed the checks, *and* every result its proof relies on is
    verified too. This is the only state you should build on.
  - **blocked** — it has a proof, but that proof relies on something that is not verified yet.
  - **disproved** — the assistant found a specific counterexample showing the statement is false.

## What it does for you

- **Readable, linked mathematics.** The assistant writes ordinary `.qmd` files (by convention inside
  a `workspace/` folder), with each definition, lemma, and theorem in its own labeled block and each
  proof in a separate block linked to the statement it proves. Whenever a proof uses another result
  or a specialized definition, it points to that fact by a short label (`@id`) right where it is
  used. Those pointers make every assumption visible.
- **One project, one map of dependencies.** The assistant reads every `.qmd` file in the project
  together. Each pointer becomes a link in the dependency graph, so it can trace exactly what any
  result depends on, even across different files.
- **Your goals are protected.** The statements of your main goals are locked. The assistant can prove
  them and build on them, but it cannot reword them or weaken them without your approval.
- **Two layers of checking.** First come the *mechanical checks*, which use no AI. They confirm the
  document is put together correctly: every block is labeled, every proof links to a real statement,
  every pointer targets a real result, no argument is circular (A relying on B relying back on A),
  and nothing that was already checked has changed since. Then, if you have set up a verifier, a
  separate Claude or Codex reviews each individual proof against the exact statements it cites and
  reports any errors or gaps.
- **Honest overall status.** A proof that looks fine on its own is not enough. A result is marked
  *verified* only when its own checks pass and every result it depends on is verified too — and every
  result those depend on, in turn. The assistant determines this for the whole project and will not
  let an unproved step count as established.
- **Output you can browse.** The assistant can build a navigation view and a picture of the
  dependency graph, and then use Quarto to publish everything as an HTML web page or a PDF.

## Requirements

- **Node.js version 20 or later** — the program that runs the tool.
- **Pandoc** — required. It is the reader that parses every `.qmd` file. It must be available on your
  system (either on your `PATH`, or its location recorded in the settings — see below). If you
  already have Quarto installed, a copy of Pandoc comes bundled inside it, so you may not need a
  separate one.
- **Quarto** — optional. Only needed for the final step of producing a rendered HTML page or PDF.
- **An AI verifier** — optional. This is the `claude` or `codex` command-line program, installed and
  logged in. Without one, all the mechanical checks still run; the proofs simply stay unverified.

---

## Quickstart

Everything below is done by talking to your assistant. The commands are shown so you can see what is
happening, but you type English, not shell commands.

### 1. Install the add-on

Open Codex or Claude Code in any folder and say:

> **"Install the qmd-prover skill from `github.com/powergiant/qmd-prover`. First read its `readme.md`
> carefully. Then check that Node, Pandoc, and Quarto are set up, and get it ready."**

The assistant follows the recipe in
[For AI assistants: installing from GitHub](#for-ai-assistants-installing-from-github) below. It
downloads the project, installs the `qmd-prover` command on your `PATH`, places the skill in your
assistant's skills folder, checks your tools, and records any file locations it needs.

If you would rather install it by hand, the add-on has two halves that install separately: the
`qmd-prover` command (the engine, installed once on your `PATH`) and the skill (the instructions your
assistant reads, placed per project or globally). Download the project and run both:

```bash
git clone https://github.com/powergiant/qmd-prover
cd qmd-prover
npm install

# 1. Install the engine once — puts the `qmd-prover` command on your PATH:
npm install -g .                     # (developers: use `npm link` instead, backed by this checkout)

# 2. Place the skill so your assistant can read it, using the command from step 1:
qmd-prover install --global          # every project → ~/.claude/skills/qmd-prover
qmd-prover install --global --codex  # Codex          → ~/.codex/skills/qmd-prover
qmd-prover install                   # just this project → ./.claude/skills/qmd-prover (run from it)
```

The engine needs only Node and Pandoc; the skill is documentation, so the two are versioned and
installed independently. Run `qmd-prover version` to confirm the engine is on your `PATH`. If your
assistant reports that `qmd-prover` is not found, the engine step above has not been done yet.

### 2. Start a project and state your first goal

If the install step above already set up the project and recorded a goal, this step is done and you
can skip it — you will see an `AGENTS.md` file in the project, and (once the assistant has checked the
project at least once) a `.qmd-prover/` folder. If that setup did not happen, ask the assistant to do
the following.

Go to the folder where your mathematics will live and say:

> **"Set up qmd-prover here, then record my main goal: _every finite integral domain is a field_."**

The assistant runs the setup step. This writes an `AGENTS.md` file (a set of rules the assistant
follows inside the project). The `.qmd-prover/` folder, with its settings file, is created a little
later — the first time the assistant checks the project. The assistant records your goal as a
*protected* result — a labeled block that looks like this:

```markdown
::: {#thm-main-finite-domain-field .theorem .goal name="Finite integral domains are fields"}
Every finite integral domain is a field.
:::
```

No proof is needed yet. A goal with no proof is simply *open*.

A settings file, `.qmd-prover/config.yml`, is created with safe defaults the first time the assistant
checks the project. You do not need to change it; see [Settings and commands](#settings-and-commands)
below for the two things you might later ask the assistant to change.

### 3. Develop and check

> **"Prove `thm-main-finite-domain-field`. Add whatever lemmas you need, then check the project and
> tell me what is verified and what is still blocked."**

The assistant writes the definitions, lemmas, and proof into files under `workspace/`. After each
coherent piece of work, it *checks* — meaning it reads the relevant files, rebuilds the dependency
graph, and runs the checks. It can check just one fact, one file, or the whole project, and it uses
the narrowest check that fits. It fixes anything the mechanical checks flag, and then reports back in
plain words: what is verified, what is still open, and what is blocked. You never run the commands
yourself.

### 4. See it rendered (optional)

> **"Render the project so I can browse it."**

Rendering turns your work into something you can read and click through. It happens in two stages,
and the assistant runs both:

1. **qmd-prover builds the navigation.** It reads all your `.qmd` files, determines the current status
   of every result, and draws a **picture of the dependency graph** — an image in which every
   definition, lemma, and theorem is a dot, every dependency is a line between dots, and each dot is
   colored by its state (verified, open, or blocked). These are written into
   `.qmd-prover/generated/`. If the project still has structural problems, this stage stops first, so
   a broken graph is never published.
2. **Quarto produces the document.** Your `.qmd` files, together with that generated navigation, are
   turned by [Quarto](https://quarto.org/) into a finished web page or PDF — with theorem numbering,
   cross-references, and the dependency graph included. This stage needs Quarto installed (see
   [Requirements](#requirements)).

The result is a browsable version of your project: each result linked to its proof and to everything
it depends on, so a reader can see immediately which results are finished and which still depend on
unfinished work. You just ask the assistant to render; it runs both stages for you.

---

## How you use it day to day

- **You talk; the assistant runs the commands.** You describe what you want in plain English — "prove
  this", "where is it stuck?", "improve that lemma" — and the assistant picks the right operations,
  runs them, and turns the results back into plain language. You do not memorize commands or read raw
  output.
- **Work in small steps you can check.** The usual pattern is: state something, prove a little, have
  it checked, fix what is flagged, and repeat. Checking is quick, so it is worth doing often rather
  than writing a large amount and checking only at the end. A step can be one lemma or a whole file —
  make it as big as the argument needs.
- **Ask for the current state whenever you want.** At any point you can ask "what is proved, what is
  open, what is blocked?" and the assistant checks the project and gives you the picture: which goals
  are done, which results are still being worked on, and exactly what is missing for each blocked
  result.
- **Only build on results that are verified.** A result is safe to build on only when its whole chain
  of dependencies passes the checks — its own proof plus every result it uses, and every result those
  use in turn. A proof that looks correct by itself but depends on an unproved lemma is *blocked*, not
  done, and the assistant will tell you so rather than treat it as established.
- **Your statements stay as you wrote them.** The statements of your main goals are locked: the
  assistant can prove them and build on them, but it cannot change or weaken them without telling you.
  If it ever concludes that a goal is actually false, it does not change your statement — it shows you
  a specific counterexample and lets you decide what to do.
- **Failed attempts are kept, not deleted.** When an approach does not work, the assistant marks it as
  rejected and sets it aside. It stays visible in case it is useful later, but it is never reused as
  if it were an established fact.
- **Be aware of verifier cost.** The independent verifier calls a real AI model, so it uses time and
  tokens — more at higher effort settings. While you are still working things out, ask the assistant
  to check narrowly (one fact or one file). Run a full-project check when you want the complete
  picture, or before you rely on a result.

---

## Settings and commands

**You normally never run a command or edit a settings file yourself — you just ask the assistant.**
This section exists only so you know what it is doing on your behalf, and what you can ask it to
change.

**The commands.** Everything runs through a single tool that the assistant calls in the background.
Its main actions are:

- **set up** (`init`) — prepares the project.
- **check** (`inspect`) — reads the `.qmd` files, rebuilds the dependency graph, and runs the checks.
- **render** — builds the navigation and dependency-graph picture for publishing.
- a set of **dependency questions** — for exploring the graph (for example, what a result depends on,
  or what would be affected if it changed).

You speak in English; the assistant chooses and runs the right command and turns the result back into
plain language. The full list is in the [command reference](skills/qmd-prover/references/cli.md).

**The settings file.** Project settings live in `.qmd-prover/config.yml`, created with safe defaults
the first time the assistant checks the project. You do not need to change it. There are two things
you might ask the assistant to adjust:

- **Turn on independent verification.** By default there is no AI verifier, so proofs get the
  mechanical checks but stay unverified. To have each proof independently reviewed, tell the assistant
  which command-line tool you have logged in — Claude or Codex — and it records the choice:

  ```yaml
  verification:
    backend: codex   # or: claude   (none = mechanical checks only)
    effort: high     # low | medium | high | xhigh | max
  ```

  Proofs then move from unverified to *verified*, *blocked*, or *disproved*. **A note on cost:** every
  fresh review calls a real AI model, and a higher `effort` setting uses more time and tokens.
- **Tool locations.** If Pandoc or Quarto is not found automatically on your system, the assistant
  records its exact location here so every command can find it.

Every setting is explained in the
[settings reference](skills/qmd-prover/references/config.md) — but again, you ask the assistant to
change it rather than editing it yourself.

---

## For AI assistants: installing from GitHub

> **If you are an AI assistant asked to install qmd-prover from GitHub, do the following.** Do not
> skip the environment checks, and never use a mutation flag or change project policy without explicit
> user approval.

1. **Get the source.** Clone or download `https://github.com/powergiant/qmd-prover`. It has two
   halves: the `qmd-prover` command (the engine) and the `skills/qmd-prover/` documentation folder.

2. **Install the engine once, on the host's `PATH`.** Confirm Node 20+ first; `npm install -g .`
   builds and installs the `qmd-prover` command.

   ```bash
   git clone https://github.com/powergiant/qmd-prover
   cd qmd-prover
   node --version        # must be >= 20
   npm install
   npm install -g .      # installs the `qmd-prover` command (developers: `npm link` instead)
   qmd-prover version    # confirm it is on PATH; prints tool/schema/protocol/contract versions
   ```

3. **Install the skill (documentation) with the command from step 2.** `qmd-prover install` runs in
   your current directory, so a bare install targets this project and `--global` targets every
   project. (Add `--codex` for Codex.)

   ```bash
   qmd-prover install            # this project → ./.claude/skills/qmd-prover
   qmd-prover install --global   # every project → ~/.claude/skills/qmd-prover
   ```

   The skill carries no executable; it relies on the `qmd-prover` command from step 2 being on `PATH`.

   **Activation.** You do not need the host to register the skill before using it. To drive qmd-prover
   **in this session**, read the installed `SKILL.md` (the path is printed in the install output, e.g.
   `~/.claude/skills/qmd-prover/SKILL.md`, or use `skills/qmd-prover/SKILL.md` in this checkout) and
   follow it directly. For the host to discover the skill and invoke it on its own, it must be present
   at session start — so tell the user to start a new session when convenient; until then the
   read-the-file path works fully.

4. **Check that Pandoc and Quarto are installed, and set up their paths.** Run `doctor`; it reports
   Node, Pandoc, the optional verifier, and Quarto, plus the exact path it resolved for each:

   ```bash
   qmd-prover doctor --print
   ```

   - **Pandoc is required.** If `doctor` reports it unavailable, locate or install it. It ships
     inside Quarto, so if the user has Quarto you can point at that copy instead of a separate
     install — e.g. on Apple-Silicon macOS: `/Applications/quarto/bin/tools/aarch64/pandoc`.
   - **Quarto** is only needed for final rendering; leave it unset otherwise.
   - Record any path the tool cannot find on `PATH` in the project config (step 6), or via the
     `QMD_PROVER_PANDOC` / `QMD_PROVER_QUARTO` environment variables, which take precedence.

5. **Run `init`** from the project root:

   ```bash
   qmd-prover init
   ```

   Read the returned inventory. If the status is `intent-required` (existing `AGENTS.md`, QMD, or
   `.qmd-prover` state), summarize what exists and **ask** the user before running
   `init --adopt-existing`. For an `AGENTS.md` without the contract, ask before `--append-contract`;
   for a different contract version, ask before `--sync-contract`. For `already-initialized`, setup
   is current. `init` never edits mathematics and creates no theorem.

6. **Run one inspection to scaffold the config, then check it.** The first compile writes
   `.qmd-prover/config.yml` (with `backend: none` defaults) and a `.gitignore`:

   ```bash
   qmd-prover inspect project
   ```

   Open `.qmd-prover/config.yml` and confirm it. Set `tools.pandoc` / `tools.quarto` to the absolute
   paths from step 4 if either was not on `PATH`, and choose a verifier backend when the user wants
   independent checking:

   ```yaml
   tools:
     pandoc: /Applications/quarto/bin/tools/aarch64/pandoc
     quarto: ""
   verification:
     backend: none        # none | claude | codex | command
     model: ""            # "" lets the CLI use its own default model
     effort: high
   ```

   Every setting is documented in [the configuration reference](skills/qmd-prover/references/config.md).

7. **Re-run `doctor`** until each required tool reads `available`. The verifier must show
   `available` before you rely on any global verification result. Never declare your own work
   verified — only a configured, available verifier produces verification state.

---

## References

- [Command reference](skills/qmd-prover/references/cli.md) — every command, filter, exit code, and
  the verifier protocol.
- [Settings reference](skills/qmd-prover/references/config.md) — every `.qmd-prover/config.yml`
  setting.
- [Project contract](skills/qmd-prover/references/AGENTS.md) — the rules the assistant follows inside
  a project (declarations, proofs, imports/exports, verification discipline).
- [Design docs](docs/design.md) — architecture and internals for maintainers.

## Project layout

```text
skills/qmd-prover/       the add-on
  SKILL.md, references/  the skill: instructions the assistant reads (installed as docs)
  src/, scripts/         the engine: TypeScript source and its compiled `qmd-prover` command
tests/                   compiler, verification, concurrency, and rendering tests
tooling/                 development and installation tools
docs/                    maintainer design and architecture docs
examples/                a worked example project
```

The `bin` in `package.json` maps the `qmd-prover` command to `skills/qmd-prover/scripts/qmd-prover.js`,
so `npm install -g .` (or `npm link` for development) puts it on the `PATH`.

## Development

```bash
npm install
npm run typecheck
npm test        # AST-producing Pandoc adapter + mock verifiers; no real Pandoc or credentials needed
```

`npm install -g .` (or `npm link`) installs the `qmd-prover` engine on the `PATH`; `qmd-prover
install [--global] [--codex]` then copies the docs-only skill into the assistant's skills directory.
From a checkout without installing the engine, `tsx tooling/install-skill.ts [--local|--global]
[--codex] [--dir <project>]` does the same copy. The source checkout stays the source of truth.

## License

MIT — see [LICENSE](LICENSE).
