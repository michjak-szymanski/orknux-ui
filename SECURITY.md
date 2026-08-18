# Security

Report vulnerabilities privately, through GitHub's
**[Report a vulnerability](https://github.com/michjak-szymanski/orknux-ui/security/advisories/new)**
form. Please do not open a public issue for something you believe is
exploitable.

This is the front end: it holds no credentials of its own and enforces no
access — what a person may see and change is decided by
[orknux-server](https://github.com/michjak-szymanski/orknux-server), which
answers every request this makes. A screen that *displays* something it should
not is worth reporting here; a screen that is *allowed* to fetch it is a
server-side finding, and
[orknux-server's SECURITY.md](https://github.com/michjak-szymanski/orknux-server/blob/main/SECURITY.md)
describes what counts.

Worth reporting against this repository:

- a secret, token or key rendered into the page or left in `localStorage`;
- markdown, a skill, a chat message or a node name that executes as script
  when it is displayed;
- a link or an image in user content that reaches somewhere it should not.
