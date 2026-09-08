# Installed command and saved credentials

The package installation owns the `openphoto` executable and its native/helper
dependencies. The commands package owns credential storage and request fallback;
the CLI owns prompting only. Configure uses the normal JSON envelope but runs
locally before library or daemon acquisition. No catalog schema changes.

Verify through the built CLI: private save, replacement preserving other values,
invalid input without changes or secret output, hidden terminal input/cancellation,
saved-key use, explicit overrides, and rotation with a running daemon. Verify a
clean tarball install outside the checkout loads both native decoders and runs
configure. Version synchronization must update the renamed native pins.

The user can run `openphoto configure` or `openphoto configure --help`. Internal
file organization and test fixtures are delegated; preserve the contracts above
without extra credential stores, migration layers, or release publication.
