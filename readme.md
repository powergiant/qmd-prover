# qmd-prover

qmd-prover is an add-on for your AI coding assistant — **Claude Code** or **Codex** — that helps it
write and check real mathematics. It sets up a discipline for writing proofs, and then checks that the discipline was followed.

**The discipline.** Your mathematics is written in plain-text `.qmd` files. A `.qmd` file is just an
ordinary text file (the kind you can open in any editor) written in a format called *Quarto
markdown*. Inside it, every definition, lemma, theorem, and proof sits in its own **block**. A block
is opened and closed by a line of three colons, `:::`, and its first line gives it a short label and
says what kind of thing it is. Here is a complete, tiny example — one definition, one theorem, and
its proof:

```markdown
::: {#def-even .definition name="Even number"}
An integer $n$ is **even** when $n = 2k$ for some integer $k$.
:::

::: {#thm-sum-even .theorem name="Sum of two even numbers"}
If $a$ and $b$ are even, then $a + b$ is even.
:::

::: {.proof of="thm-sum-even"}
By @def-even, write $a = 2k$ and $b = 2m$. Then $a + b = 2(k + m)$,
which is even by @def-even.
:::
```

Reading that from the pieces:

- **`:::` … `:::`** fences one block off from the rest of the text. Everything between the two lines
  of colons belongs to that block. (The `$…$` in the middle is just how mathematical notation is
  written; it renders as real symbols later.)
- **`#def-even`** is the block's **label** — its short name, its `@id`. Every statement has one, and
  it is unique across the whole project.
- **`.definition` / `.theorem` / `.proof`** says what kind of block it is. `name="…"` is the plain
  title a reader sees.
- The proof is **its own separate block**, and **`of="thm-sum-even"`** links it to the statement it
  proves. A statement and its proof are never mixed together.
- **`@def-even`** inside the proof is a **pointer**: it says "this step uses the definition labeled
  `def-even`." Every time a proof leans on another result, it names that result this way, right at the
  spot where it uses it. Those pointers are what make every assumption visible.

You never type any of this — the assistant writes it. What matters is that the discipline is fixed, so
the assistant (and the checks) can always tell which result depends on which.

Among all the results you build, one theorem is the one you ultimately want proved — that theorem is
your **goal**. In the example above, the theorem `thm-sum-even` would be the goal, and the definition
exists only to support it.

**How the discipline is checked.** Because every proof follows the discipline, the work can be checked
in two layers:

- **Mechanical checks (no AI).** A plain program reads all the references `@id` and confirms the
  wiring is sound: every block has a unique label, every proof links to a real statement, every `@id`
  points at a result that actually exists, and no chain of citations loops back on itself. This
  catches global proof structure — it says nothing about whether the mathematics is correct.
- **The verifier (AI).** A second, independent AI reads one proof at a time and answers a single
  question: do the exact results this proof cites really imply the statement it claims?

Why the verifier is stronger than just asking an AI "is this right?":

- It is a *separate* AI from the one that wrote the proof, so it is not marking its own homework.
- It judges one proof against only what that proof cites — nothing else to distract it.

The verifier is optional, and it is AI review — not a mathematical certificate of correctness.
Without one, every proof still gets the mechanical checks; the proofs simply stay unverified.

**Why the discipline is worth it.** Because every proof names exactly what it stands on, three things
become possible:

- **A full map of your project.** By collecting every `@id` pointer, the assistant builds a
  *dependency graph* — a map of which result relies on which, across every file. Nothing is hidden.
- **Progress you can see at any time.** Because the graph records what each result needs, you can ask
  "what is proved, what is open, what is stuck?" and get an honest answer for the whole project. Each
  result is in exactly one plain state, and each state tells you what to do next: **open** (stated,
  nothing written yet), **unverified** (a proof is written but nobody has checked it), **rejected**
  (the checker found the proof wrong), **blocked** (this proof is fine, but something underneath it
  is not proved), **broken** (the file itself has a mistake, such as a pointer to a result that does
  not exist), **verified** (proved, and everything underneath it is proved too), or **disproved**
  (shown false by a counterexample).
- **Nothing rests on unproved work.** Following the graph to the bottom, a result is called *verified*
  only when its own proof passes *and* every result beneath it is verified too — so you never build on
  an unproved step by accident.

---

## Quickstart

You do everything by talking to your assistant. Here is the whole path, from an empty folder to a
checked proof.

### 1. Make a folder and open your assistant inside it

Make a new, empty folder to hold this project — put it anywhere you like — and open your AI coding
assistant (Claude Code or Codex) so that it is working *inside* that folder. Everything for this
project — your notes, the proofs, the settings — lives in this one folder. In a terminal that is
three lines:

```bash
mkdir ~/Documents/Projects/godel-completeness
cd ~/Documents/Projects/godel-completeness
claude      # or: codex
```

If you are on Windows, make sure that you are using PowerShell (search for it in the Start menu),

If you use the Claude Code/Codex desktop or web app instead of a terminal, there is nothing to type: when
the app asks which folder to work in (or offers an *Open folder* button), pick the folder you just
made. Everything below then happens in that same window.

From here on you only talk to it. You do not type any more commands.

### 2. Install the add-on

Say to your assistant:

> **"Install the qmd-prover skill from `github.com/powergiant/qmd-prover`. First read its `readme.md`
> carefully. Then check that Node, Pandoc, and Quarto are set up, and set it up in this folder."**

It downloads the project, installs the `qmd-prover` command, places the skill where it can read it,
checks your tools, and sets up the folder. When it finishes, your folder contains a new **`AGENTS.md`**
file — the rules the assistant follows in this project — a **`_quarto.yml`** file saying how the
project is turned into a readable book, and, once it has checked the project the
first time, a **`.qmd-prover/`** folder holding the settings and saved state. The worked example in
[`examples/godel-completeness/`](examples/godel-completeness) has exactly these files, and the rest of
this Quickstart follows that same example. (The exact recipe the assistant runs is in
[For AI assistants: installing qmd-prover](#for-ai-assistants-installing-qmd-prover) below.)

### 3. Put your note in

Write down what you want to prove, however rough, in a plain text file inside the folder. One sentence
is enough. The example project starts from a single-line note, `completeness.md`:

```text
The godel completeness say that the free first order logic is complete.
```

Misspellings and vague wording are fine — the assistant turns the note into a precise statement in the
next step. (If you would rather just say it out loud to the assistant, you can skip the file.)

### 4. Turn your note into a precise goal

Ask the assistant to turn the rough note into a proper, locked goal:

> **"Read my note `completeness.md` and formulate the main theorem it describes as a qmd-prover
> goal."**

The assistant writes a new file — in the example, `completeness.qmd` — holding that theorem as a
labeled block. For the Gödel example the block is:

```markdown
::: {#thm-main-godel-completeness .theorem .goal name="Gödel completeness theorem"}
For every first-order signature $L$, every set $\Gamma$ of $L$-sentences, and
every $L$-sentence $\varphi$, if every $L$-structure satisfying $\Gamma$ also
satisfies $\varphi$, then $\Gamma \vdash \varphi$ in the proof calculus
developed in this project.
:::
```

The `.goal` marks it as your main goal: its wording is now locked, so the assistant can prove it and
build on it but cannot quietly change or weaken it. It has no proof yet, so its state is simply *open*.

### 5. Ask it to prove

> **"Prove the main goal. Add whatever lemmas you need, then check the project and tell me what is
> proved and what is still blocked."**

It writes the definitions, lemmas, and proofs into a `workspace/` folder, checks its own work as it
goes, fixes whatever the checks flag, and reports back in plain words: what is verified, what is still
open, and what is blocked. In the example this fills `workspace/` with files like `foundations.qmd`,
`semantics.qmd`, `henkin.qmd`, and `main-proof.qmd`, each holding one part of the argument.

### 6. Check the progress while it works (optional)

A real proof can take a while. To look in on it *without interrupting* the session that is working,
open a **second** assistant session in the same folder. Then ask:

> **"What is proved, what is open, and what is blocked right now?"**

This second session reads the same project files and gives you the current picture without disturbing
the one that is still proving.

<!-- ### 8. See it rendered (optional)

> **"Render the project so I can browse it."**

The assistant turns your work into a web page (or PDF) you can read and click through: each result
linked to its proof and to everything it depends on, plus a colored picture of the dependency graph.
This last step needs Quarto installed (see [Requirements](#requirements)). -->

---


## Advanced: install and run it yourself

If you are comfortable with a terminal, you can install qmd-prover and run its commands directly,
instead of asking the assistant to.

### Install by hand

**What you need:** Node.js 20+ and Pandoc are required (Pandoc comes bundled inside Quarto, so Quarto
alone covers it). Quarto itself is optional, needed only to render to HTML or PDF. An AI verifier —
the `claude` or `codex` CLI, logged in — is optional; without it, proofs stay unverified.

qmd-prover has two halves that install separately: the `qmd-prover` command (the engine, installed
once on your `PATH`) and the skill (the documentation your assistant reads). Download the project and
install both:

```bash
git clone https://github.com/powergiant/qmd-prover
cd qmd-prover
npm install

# 1. Install the engine once — puts the `qmd-prover` command on your PATH:
npm install -g .                     # links this checkout onto your PATH — keep the folder

# 2. Place the skill so your assistant can read it:
qmd-prover install --global          # every project → ~/.claude/skills/qmd-prover
qmd-prover install --global --codex  # Codex          → ~/.codex/skills/qmd-prover
qmd-prover install                   # just this project (run from inside it)
```

The engine needs only Node and Pandoc; the skill is documentation, so the two are versioned and
installed independently. Run `qmd-prover version` to confirm the engine is on your `PATH`.

`npm install -g .` does not copy the project anywhere — npm links a local folder rather than copying
it, so the `qmd-prover` command points back at this checkout. Keep the folder where it is; deleting
or moving it breaks the command. (`npm link` does the same thing, so either is fine.) If you would
rather have a standalone copy that no longer depends on the checkout, install the packed tarball
instead — `npm install -g "$(npm pack)"`.

### The basic commands to know

Run all of these from inside your project folder:

```bash
qmd-prover doctor --print        # check your tools: Node, Pandoc, the verifier, Quarto
qmd-prover init                  # set up the project (writes AGENTS.md)
qmd-prover inspect project       # read every file, rebuild the graph, check everything
qmd-prover inspect fact @ID      # check one result and what it depends on
qmd-prover inspect path FILE     # check everything in one file or folder
qmd-prover render                # build the navigation and dependency-graph picture
```

`inspect` is the one you use most: it reads your `.qmd` files, rebuilds the dependency graph, and
reports what is verified, open, or blocked. Use the narrowest one that fits — a single fact, one
file, or the whole project. The complete list is in the
[command reference](skills/qmd-prover/references/cli.md).

### Turn on the independent verifier

Settings live in `.qmd-prover/config.yml`, created with safe defaults the first time you run
`qmd-prover inspect project`. By default there is no AI verifier, so proofs pass the mechanical checks
but stay *unverified*. To have each proof independently reviewed, set which command-line tool you have
logged in:

```yaml
verification:
  backend: codex   # or: claude   (none = mechanical checks only)
  effort: high     # low | medium | high | xhigh | max
```

Every review calls a real AI model, and a higher `effort` uses more time and tokens. If Pandoc or
Quarto is not found on your `PATH`, record its exact location under `tools:` in the same file. Every
setting is explained in the [settings reference](skills/qmd-prover/references/config.md).

---

## For AI assistants: installing qmd-prover


> **If you are an AI assistant asked to install qmd-prover from GitHub, follow these steps.** Do not
> skip the environment checks, and never use a mutation flag or change project policy without explicit
> user approval.

**1. Get the source.** Clone or download `https://github.com/powergiant/qmd-prover`. It has two
halves: the `qmd-prover` command (the engine) and the `skills/qmd-prover/` documentation folder.

**2. Install the engine once, on the host's `PATH`.** First check whether it is already there: run
`qmd-prover version`. If it prints version numbers, the engine is installed — skip to step 3.
Otherwise confirm Node 20+ and install it:

```bash
qmd-prover version    # already prints versions? the engine is installed — skip to step 3
git clone https://github.com/powergiant/qmd-prover
cd qmd-prover
node --version        # must be >= 20
npm install
npm install -g .      # links this checkout onto PATH as the `qmd-prover` command; do not delete it after
qmd-prover version    # confirm it is now on PATH; prints tool/schema/protocol/contract versions
```

**3. Install the skill (documentation).** Prefer the per-project (local) install: a bare
`qmd-prover install` places the skill under `./.claude/skills/qmd-prover`, so its version stays matched
to this project. Use `--global` only when the user wants one shared copy across every project. Add
`--codex` for Codex.

```bash
qmd-prover install            # recommended: this project → ./.claude/skills/qmd-prover
qmd-prover install --global   # every project → ~/.claude/skills/qmd-prover
```

The skill carries no executable; it relies on the `qmd-prover` command from step 2 being on `PATH`.
To drive qmd-prover **in this same session**, read the installed `SKILL.md` (its path is printed in
the install output, e.g. `~/.claude/skills/qmd-prover/SKILL.md`) and follow it directly — the host
does not auto-register a skill added mid-session. For the host to discover it on its own, tell the
user to start a new session when convenient; until then the read-the-file path works fully.

**4. Check that Pandoc and Quarto are installed, and set their paths.** `doctor` reports Node,
Pandoc, the optional verifier, and Quarto, plus the exact path it resolved for each:

```bash
qmd-prover doctor --print
```

- **Pandoc is required.** If `doctor` reports it unavailable, locate or install it. It ships inside
  Quarto, so if the user has Quarto you can point at that copy instead of a separate install — e.g.
  on Apple-Silicon macOS: `/Applications/quarto/bin/tools/aarch64/pandoc`.
- **Quarto** is only needed for final rendering; leave it unset otherwise.
- Record any path the tool cannot find on `PATH` in the project config (step 6), or via the
  `QMD_PROVER_PANDOC` / `QMD_PROVER_QUARTO` environment variables, which take precedence.

**5. Run `init`** from the project root and read the returned inventory:

```bash
qmd-prover init
```

If the status is `intent-required` (an existing `AGENTS.md`, QMD files, or `.qmd-prover` state),
summarize what exists and **ask** the user before running `init --adopt-existing`. For an `AGENTS.md`
without the contract, ask before `--append-contract`; for a different contract version, ask before
`--sync-contract`. For `already-initialized`, setup is current. `init` never edits mathematics and
creates no theorem.

**6. Run one inspection to scaffold the config, then confirm it.** The first compile writes
`.qmd-prover/config.yml` (with `backend: none` defaults) and a `.gitignore`:

```bash
qmd-prover inspect project
```

Set `tools.pandoc` / `tools.quarto` to the absolute paths from step 4 if either was not on `PATH`,
and choose a verifier backend when the user wants independent checking:

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

**7. Re-run `doctor`** until each required tool reads `available`. The verifier must show `available`
before you rely on any global verification result. Never declare your own work verified — only a
configured, available verifier produces verification state.

---

## References

- [Command reference](skills/qmd-prover/references/cli.md) — every command, filter, exit code,
  diagnostic code, and the verifier protocol.
- [Settings reference](skills/qmd-prover/references/config.md) — every `.qmd-prover/config.yml`
  setting, environment variable, and file under `.qmd-prover/`.
- [Status reference](skills/qmd-prover/references/status.md) — what each state of a result means and
  what to do about it.
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
so `npm install -g .` (or `npm link`, which is equivalent here) puts it on the `PATH`.

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

Both `npm install -g .` and `npm link` symlink this folder into the global `node_modules`; npm links
local paths rather than packing and copying them, so the `files` whitelist in `package.json` does not
apply and the whole checkout — `src/`, `tests/`, `node_modules/` — sits behind the command. That also
means the installed engine runs whatever is in `scripts/` right now, so rerun `npm run build` after
editing `src/`. Only a tarball install (`npm install -g "$(npm pack)"`, or a future published
package) produces the pruned, compiled-only copy that the `files` list describes.

## License

MIT — see [LICENSE](LICENSE).
