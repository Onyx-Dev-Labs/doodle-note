---
status: accepted
---

# Extend existing sync for complete Pencil notes and preserved conflicts

The first release must synchronize original editable Pencil ink with readable previews and preserve conflicting note versions when devices edit independently. The existing sync format cannot meet these requirements unchanged, so compatible cloud and viewer changes are part of the product scope.

Keeping the existing format unchanged would leave handwritten content behind or allow competing edits to overwrite one another. Sean accepted extending the existing service to preserve complete notes and user work, with iPad ink editing and iPhone/desktop visibility; real-time collaboration remains outside v1.

Private attachment storage, conflict/version representation, old-client compatibility, and deletion semantics remain architecture decisions to resolve. This record approves product direction, not production deployment or permission changes.
