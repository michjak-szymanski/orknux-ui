# Command line

`orkx` is the same platform from a terminal: sign in, pick a workspace, start a
workflow and read what it did, talk to a chat, manage variables and plugins, ask
whether the installation is configured the way it believes it is.

It is a client and nothing more. Every rule about what you may see and do is the
server's, applied by the server — the CLI keeps no second copy of them, so it
can never be more permissive than this interface is.

## Installing

```bash
install.cmd                      # Windows: %LOCALAPPDATA%\Programs\orkx, added to your PATH
./install.sh                     # POSIX: ~/.local/bin
```

Per-user throughout — no administrator rights, and the machine-wide PATH is
never touched. **Then open a new terminal.** A PATH change does not reach a
shell that is already open, nor a new one started from it.

There is also `orkx.jar`, which runs on any JDK 25. The native binary starts in
about 14 ms against the jar's 146 ms, which is worth having for something run
this often.

## Pointing it at a server

```bash
orkx server use http://localhost:8080
orkx server info                              # where it is pointed, and as whom
```

`server use` checks the address rather than merely writing it down, which tells
a live installation from a typo or some other application on that port. Moving
to a different server drops the stored session: a session cookie belongs to the
server that issued it.

## Signing in

```bash
orkx login                                    # prompts for username and password
orkx login --server https://orknux.example.com --username alice
echo "$PASSWORD" | orkx login -u alice --password-stdin
```

This is the directory sign-in. Where an installation is configured for OIDC
instead, there is no password for the CLI to send and the server says so —
signing in happens in a browser, and `orkx` is not the way in.

The session is written to `session.json` under `%APPDATA%\orknux`,
`$XDG_CONFIG_HOME/orknux` or `~/.config/orknux`. The cookie in that file is the
whole credential, so it is written owner-only and replaced atomically.

## Choosing a workspace

```bash
orkx workspace list                           # * marks the one in use
orkx workspace use 7
```

Almost everything on the server is scoped to a workspace, and the server holds
no notion of a current one — so the choice is the client's to keep. `use` checks
the id, which is also the access check: the server answers with the workspace
only if your roles grant it.

## Workflows and runs

```bash
orkx workflow list                            # what there is, and where each last got to
orkx workflow run nightly-sync                # by name, or by id
orkx workflow run 3 --input '{"since":"yesterday"}'

orkx execution list                           # newest first
orkx execution get 42                         # one run, its steps, and what failed
orkx execution logs 42 --step slack           # only the lines one step wrote
orkx execution restart 42
```

`--input` is handed to the first node as JSON, which is what a trigger would
otherwise have supplied. A run started here is recorded as `MANUAL`, because a
person started it, and a disabled workflow still runs — that is how one is
tested.

`restart` **starts something**, carrying the original input over so the new run
acts on the same event: if that workflow answered somebody, it answers them
again.

## Chat

```bash
orkx chat list                                # pinned first
orkx chat search planning                     # by name
orkx chat search planning --messages          # …and by what was said

orkx chat open 5                              # interactive; /exit or Ctrl+D to leave
echo "summarise last night's runs" | orkx chat open 5
```

Answers stream as they are composed, so a large local model is not a blank
screen for minutes. An agent answers in one piece instead: it works through a
tool loop first, and there is nothing worth showing until that settles.

`--recipient` takes a **model id or an agent id**, and those are separate
catalogues — so the same number is usually both, and `model:1` or `agent:1` says
which.

## Variables

```bash
orkx variable list                            # or --catalog for one folder's
orkx var get billing/apiKey
orkx var set -c billing -n apiKey --value-stdin --type secret
```

`get` prints the value and nothing else, so `KEY=$(orkx var get billing/apiKey)`
is the whole of it. Reading a secret records that somebody asked; the note
saying so goes to standard error, where a capture will not pick it up.

## Plugins

```bash
orkx plugin list                              # what is loaded, and what each brings
orkx plugin generate -o ./mine.js             # a starter, written by this server
orkx plugin load --file ./mine.js
orkx plugin unload 4
```

`generate` asks the server for the template rather than carrying one, so its API
version and value types are the ones that installation will actually judge it
by. A plugin's **key is its identity, not its filename**: loading the same key
again replaces what is there, which is how a plugin is iterated on.

## Checking an installation

Two questions, two commands:

```bash
orkx admin doctor                             # is it configured correctly?
orkx admin monitoring                         # can it reach the things it needs?
```

`doctor` catches what monitoring cannot. A secret key that was never set lets
the server start and every dependency answer — monitoring entirely green — while
every credential write fails hours later:

```
FAIL  Secret key       Not set - every credential write will fail, and stored ones cannot be read.
FAIL  Stored secrets   4 cannot be read, because the key above is not usable.
ok    Schema           At v72, with nothing failed.

2 failed, of 6 checks.
```

Both exit `6` when something is wrong, so either works as a check without
anything having to read the words:

```bash
orkx admin monitoring > /dev/null || echo "something is unwell"
```

Both are for administrators, and the server is what enforces that.

## Completion

```bash
orkx completion bash       >> ~/.bashrc
orkx completion powershell | Out-String | Invoke-Expression
```

Printed rather than installed: where a shell keeps its completions is the
shell's business. Both are generated from the live command tree, so a command
that exists is a command that completes.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | it worked |
| 1 | the server refused you |
| 2 | bad arguments |
| 3 | nothing usable at that address |
| 4 | the exchange worked; something on this machine did not |
| 5 | no such thing there, or none you may see |
| 6 | asked and answered, and something is unwell |

Colour is decoration and never information — a status is coloured *and* spelled
out — and it turns itself off when the output is not a terminal. `NO_COLOR`,
`CLICOLOR=0` and `TERM=dumb` are all honoured; `--color always` overrides them.
