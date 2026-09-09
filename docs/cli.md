# Using OpenPhoto from the command line

OpenPhoto keeps originals, catalog state and delivered images separate. Import
establishes what the library knows; edits change retained state; preview and
export materialize that state. A successful command can carry warnings about
offline sources, unavailable providers or degraded output, so read the response
as well as its exit status.

## Discover commands before creating a library

```sh
openphoto --help --human
openphoto help segment --human
openphoto layer transform --help --human
```

Root help lists the public commands. Each command's help describes its accepted
arguments, meaningful subcommands and examples. `help COMMAND` and
`COMMAND --help` are equivalent; nested commands also accept help. Help needs
no library, credentials, running daemon or model download. Omit `--human` to
receive the same information as JSON.

The executable [command inventory](../packages/commands/src/dispatch.ts) owns
dispatch and discovery together. The workflows below explain how the commands
fit together; use executable help for the complete current syntax.

## Choose a library, then import

```sh
export PHOTOCTL_LIBRARY="$PWD/library"
openphoto init --embed manual
openphoto import ./photos --link --recursive
openphoto list --human
```

`PHOTOCTL_LIBRARY` selects the catalog for subsequent commands. Without it the
default is `~/Pictures/photoctl`. `init --path` selects where that invocation
creates a library; it does not persist a new default for later invocations.
`PHOTOCTL_CACHE` optionally selects a cache root independently of catalog storage.

Linking retains originals in their existing location; copying makes a
library-owned copy. RAW/JPEG companion policy controls whether related files
become one logical photo or separate photos. Offline originals remain cataloged;
previews may use retained pixels and report their source and resolution limits.

Photo IDs come from import or list results. Most commands accept an unambiguous
ID prefix; `show` also accepts a registered file path. Layers and retained graph
nodes have distinct identities. Use the identity returned by the operation or
its inspection command, rather than substituting a filename or photo ID.

## Read results and keep automation streams separate

Default stdout contains a schema-1 JSON envelope. Successful responses use
`ok: true` with `data`, or per-item `results` and a batch `summary`; errors use
`ok: false` and a stable `code`. Warnings describe limitations without discarding
usable work. Inspect per-item results when a batch partly succeeds.

Stderr carries JSON progress and daemon events. Keep it separate from stdout
when parsing results. `list --stream` and `search --stream` instead emit one JSON
row or hit per stdout line. `--human` is for terminal reading, not machine parsing.

Commands normally use a library daemon to share work and cached state. Daemon
help explains its lifecycle controls. `--no-daemon` runs directly and may stop
the selected library's daemon; it is an execution choice, not a different
catalog format. Help never starts or stops a daemon, with or without that flag.

## Inspect, develop and deliver

```sh
openphoto show PHOTO --preview-size 1600
openphoto develop PHOTO --set exposure=0.5
openphoto show PHOTO --preview-size native
openphoto undo PHOTO
openphoto redo PHOTO
openphoto export PHOTO --to ./delivery --format jpeg --quality 95
```

Replace `PHOTO` with an imported ID. `show` returns a preview path and its
geometry, source and color information. Development settings, selection layers,
generated edits and markup belong to retained editing state. Inspect a preview
after changing that state; history lets you reconsider edits without rewriting
the original.

Development help exposes keys and ranges from the operator inventory, plus
structured-value examples. Presets reuse development choices. Automatic
enhancement is a standalone mutation with its own undo-auto operation. Culling
metadata supports filtering and search without changing image pixels.

Export writes delivery images to a directory, with explicit format, resizing,
metadata and collision policy. Linear render/decode commands serve inspection
and downstream processing. Writing catalog metadata back beside originals is
explicit through XMP commands. A catalog backup is not a substitute for backing
up externally linked originals.

## Provision local models explicitly

```sh
openphoto doctor --human
openphoto doctor --fetch-models
```

Doctor without the fetch flag inspects availability and verifies pinned model
hashes. The fetch flag acquires the release's ZIM artifacts into the selected
library's `models` directory. The default host is Hugging Face, in the official
NAVER repository selected by the
[pinned model manifest](../packages/library/src/pinned-model-manifest.ts).
Doctor help reports the exact immutable upstream URL for this release. Valid cached
files are reused. Missing or invalid files are downloaded to temporary files,
checked against SHA-256 and installed atomically; failed temporary downloads are
cleaned up. Retry the same command after resolving a failed download. Model
license and notice files accompany the installed artifacts.

A mirror changes where those same pinned bytes are fetched:

```sh
openphoto settings set models_base_url '"https://models.example.com/pinned/"'
openphoto doctor --fetch-models
openphoto settings reset models_base_url
```

Saving the setting does not download, and settings replace whole JSON values.
Installation, help and ordinary segmentation do not silently fetch models.
The local ZIM runtime supplies pixel masks; text grounding additionally uses a
gateway model. Follow the root guide's
[credential setup](../README.md#installation-and-credentials) for that separate
credential boundary. Image generation, semantic search and automatic analysis
also depend on configured providers; their supported controls vary by model.

## Choose an image model

Image commands use the [release defaults](../packages/providers/src/table.ts)
unless overridden by library settings or a command's `--model`. A command override
wins for that request; changing defaults does not rewrite saved choices or past
executions. Any concrete model ID can be sent through the gateway; accepting the
ID is not a promise that its provider supports every operation.

Masked edits normally ask the model to edit a context crop, then composite its
result locally through the effective selection. Pixels outside that coverage
stay unchanged; expansion and feathering deliberately change the coverage.
The model does not receive the exact selection outline on this path, so clipping
can discard useful details even when protection is exact. Reference images are
forwarded when requested; provider errors are surfaced rather than silently
dropping the reference or switching models.

The [size planner](../packages/providers/src/image-frame.ts) owns known model
constraints. Supported dimensions go through directly; unsupported dimensions
can require enlargement and declared padding, not an arbitrary crop afterward.
Recorded execution metadata distinguishes the requested canvas from its retained
content. Models without a known size policy receive the requested dimensions.

## Select the intended subject

A point says where to select. Text says what to select. Combining them lets a
click choose an instance while the description preserves the requested scope:

```sh
openphoto segment PHOTO --at 0.45,0.35 --norm
openphoto segment PHOTO --text 'whole person including hair and clothing, excluding the bouquet' --at 0.45,0.35 --norm --dry-run
openphoto segment PHOTO --text 'whole person including hair and clothing, excluding the bouquet' --at 0.45,0.35 --norm
openphoto layer list PHOTO
openphoto show PHOTO
```

These coordinates are examples, not a universal person location. Inspect your
photo and choose the intended point. Point-only segmentation uses local ZIM;
text-plus-click additionally grounds the requested subject through the gateway.
Repeated `--at` prompts are supported. A no-match or ambiguous result calls for
a clearer description or an instance click. A dry run resolves candidates
without creating a layer, but can still perform model and provider work.
Command success does not establish that a mask includes all hair and clothing
or excludes nearby objects: inspect the selection before using it for an edit.

Coordinates use the oriented, uncropped base image reported by `show.data.dims`.
Preview pixels can differ because of scaling, region selection, crop or rotation.
Map a displayed click with `show.data.preview_info.view_to_base`; for its affine
coefficients, `baseX = a*x + c*y + e` and `baseY = b*x + d*y + f`.
Then pass base pixels directly, or divide by `dims.w` and `dims.h` for `--norm`.
Point fractions must lie inside the image; the far edge itself is outside it.

A box alone creates a manual rectangle. A box plus point prompts constrains
model segmentation; text cannot combine with a box. A brush is a JSON polygon
and cannot combine with model prompts. Manual add/subtract/replace refinement
names an existing layer:

```sh
openphoto segment PHOTO --box 0.1,0.1,0.3,0.5 --norm
openphoto segment PHOTO --layer LAYER --operation subtract --brush '[[10,10],[50,10],[50,50]]'
```

Replace `LAYER` with the returned selection layer ID. Both refinement flags are
required, together with exactly one manual box or brush. Selection geometry,
layer transforms and generation masks are separate controls: inspect layer help
for placement and fill help for masked generation, movement and canvas expansion.
