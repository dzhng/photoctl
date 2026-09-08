# OpenPhoto decisions

## Sound — medium confidence

### Image embeddings use the gateway's native Google content protocol

**When:** installation/live-provider checkpoint.

When a user indexes a photo, the application sends both its JPEG bytes and a
fixed caption through the gateway's native image-embedding route. A text search
still uses the OpenAI-compatible text route. The attempted image payload on that
text route was rejected by the real service. Keeping it, or quietly dropping the
JPEG and embedding only the caption, would make image indexing unusable.

**Gap:** the original plan did not establish an accepted multimodal wire contract.
**Reach:** transport now depends on the AI SDK 6 native gateway protocol. Image
indexing explicitly requires the verified Gemini embedding model; another model
needs its own proven image contract before it can be selected for this operation.
No catalog schema changes. **Verdict:** sound because real image changes alter
the returned vector while an identical image repeats it. **Confidence:** medium;
the native protocol is an external dependency that may evolve.

### Replacing a saved key preserves values, not dotenv formatting

**When:** installation/configuration checkpoint.

If the user already has another setting in their private dotenv file, configure
reads its value, replaces the gateway key, and rewrites the file atomically.
Comments and spacing are not preserved. A round-trip parser check keeps quoted
values and literal backslash sequences intact; an unrepresentable value fails
without replacing the existing file. Appending another copy of the key would
leave obsolete credentials on disk and make interpretation ambiguous.

**Gap:** preservation of formatting and duplicate keys was not specified.
**Reach:** this is a value store, not a lossless dotenv editor. **Verdict:** sound
because unrelated values survive and superseded secrets do not. **Confidence:**
medium; preserving comments could be a future convenience, not a second store.

## Sound — high confidence

### Live smoke acceptance requires evidence that image bytes matter

**When:** live embedding checkpoint.

A provider can return a valid-sized vector even if it ignores the image. The
smoke therefore submits red, blue, then the same red image, with identical text.
It accepts only when changing the image has a larger effect than repeating it.
Only synthetic image hashes and bounded numerical observations enter the report;
provider bodies and credentials do not. Each explicit smoke makes three serial
requests with no automatic retries, outside default tests and CI.

**Gap:** a successful response alone did not define useful live evidence.
**Reach:** this checks the multimodal transport, not the accuracy of search or
segmentation. **Verdict:** sound because caption-only success is explicitly
rejected. **Confidence:** high.
