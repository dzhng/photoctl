# Pairing contact-sheet layout evidence

The `wb sheet` card is the workbench's only presentation of RAW+JPEG membership.
This set captures it rendered by the production sheet owner
(`apps/workbench/src/sheet.ts`) against the current built CLI, for three local
copies of permanent camera pairs. `commands.json` holds the public `init`,
`import --link` and `list` results behind both states; `metrics.json` records
the pixel differences quoted below.

## Capture route

Headless Google Chrome on this Mac (`--headless=new --screenshot`) renders the
report's local `file:` URL directly; no browser extension, local server or
policy bypass is involved. This is the route the user's own preview-shots
convention prescribes for regression capture, and it is distinct from the
earlier in-app browser refusal, which concerned a different tool.

Headless Chrome silently clamps its window to roughly 500 CSS pixels wide. A
`--window-size=390` capture therefore lays the page out at the clamped width
and clips it, which produced a false "horizontal overflow" finding in the first
critique. Narrow captures here render the report inside a fixed 390-pixel
`iframe` in a wider window, giving a true 390-pixel layout viewport. Do not
quote clamped narrow captures as layout evidence.

## States

- `both-online-*`: three photos, every RAW and JPEG original online.
- `mixed-availability-*`: DSC08819's RAW moved away (JPEG online), DSC00103's
  JPEG moved away (RAW online), DSC00107 fully available. Only scratch copies
  were moved; fixtures and originals are untouched.
- `before/`: the pre-correction card for the mixed state, desktop and true
  390-pixel viewport.

## Critique rounds and what changed

Three unprimed critiques ran on the full capture sets plus 2× badge crops.

1. **Original card.** Member pills shared the culling row and the photo-level
   pill's exact styling; per-member state was text-only; wrapping mixed the
   photo-level pill into the culling attributes. The overflow finding was the
   capture clamp above, not the page.
2. **Grouped members.** A headed "Originals" group with per-member dots and
   dashed/dimmed offline pills fixed the colour cue, but the inline heading
   labelled only the first pill, so a wrapped member detached from its group,
   and the photo-level pill remained an unlabelled chip among culling facts.
3. **Final card.** The "Originals" heading occupies its own line, the culling
   row holds only rating/flag/label, and the photo-level state is a labelled
   `Primary online`/`Primary offline` pill beside the filename, styled like the
   member pills. The critique found every state decodable, text contrast at or
   above 7:1, no overflow at 390 pixels and equal card heights.

The final desktop mixed capture differs from the original over 3.3% of pixels
(grayscale MAE 5.06); the two final states differ only in their badges (0.24%).
The change is real, not a re-anchored no-op.

## Open presentation questions for the user

The final critique's remaining findings are product choices, not defects the
slice settled:

- Member pills show kind, role and state (`JPEG · Online`), not filenames. The
  public list row's `originals` entries carry `id`, `kind` and `online` only;
  naming each member would extend that public shape.
- The header pill mirrors the public top-level `online` field, which the slice
  defines as the primary's state. The critique reads it as a duplicate of the
  `RAW · Primary` member pill and asks for a "partially available" summary
  instead.
- Pre-existing sheet design outside this checkpoint's variable: full UUID line,
  portrait thumbnails letterboxed on a darker field, unstyled `Show JSON`
  disclosure, and the auto-fill grid leaving a fourth column empty with three
  photos.

These are recorded in the choices ledger as U27. The membership-badge layout is
otherwise ready for the user's acceptance; no automatic verdict is claimed.
