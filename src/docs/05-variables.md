# Variables

Variables are the values a workspace needs but should not have written into a
workflow: an API key, a base URL, an account id. They are referenced from
function signatures, and passed to the function as parameters.

## Values and secrets

![Variables in their catalogs; a value shows what it holds, a secret only whether anything is stored](/screens/variables.png)

Every variable is one or the other, and they are listed separately.

- **Values** are shown. A hostname or an account id is not a secret, and
  hiding it only makes it harder to check.
- **Secrets** are hidden. Reveal one from its row when you need to see it; the
  hidden field cannot be edited until it is revealed, so nobody overwrites what
  they cannot read.

Secrets are encrypted where they are stored. What is written down is
`orkx1:iv:ct` — a version, a nonce, and AES-256-GCM ciphertext — so a database
dump carries no keys.

A variable is a string, a number or a boolean. There are no object variables:
a shape belongs in an object, where it can be validated.

## Catalogs

Variables are grouped into **catalogs**, the way skills are. A name must be
unique within its catalog, not across the workspace, so two catalogs may each
have a `base-url` and mean different things by it.

The catalogs column can be folded away when it is not what you are working on.

## Using one

Add an **External parameters** section to a function, and name the variable
there. When the function runs, the variable's value arrives as its own
parameter — it is never spliced into the body as text.

A variable in use cannot be deleted; the error says what is still using it.

A plugin's parameters read variables the same way. On the workspace's **Plugins**
page, a parameter can be answered either with a value typed in or with one of
these variables, and a parameter the plugin declared as a secret can only be
answered with a variable. The reference is read when the plugin runs, not when
it is set, so rotating a token is one edit here rather than one per plugin.

Editing is inline: click the field, change it, and save with the check. Renaming
is the same edit. Deleting a catalog requires it to be empty first.
