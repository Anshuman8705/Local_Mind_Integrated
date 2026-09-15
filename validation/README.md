# Validation evidence for increment 1

`md-alignment-results.json` records exactly which checks ran and which did not. `md-alignment-tests.log` is the captured output of `python scripts/check_md_alignment.py`. The test runner compiles the real dependency-free TypeScript modules and calls their functions; the Python tests call the actual parser, numbering, outline and answer-validation helpers.

The 70 passing targeted checks do not mean the full application passed. In particular, new Django/ORM tests are included but could not be executed here, and the new phone test app still needs a native build and measurements on real target phones.
