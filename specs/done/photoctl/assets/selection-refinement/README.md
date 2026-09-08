# Manual selection correction witness

The retained A7C II RAW establishes that a real SAM selection can be corrected on
the same layer through the CLI, then undone and redone. This is manual control,
not improved automatic segmentation or acceptance of a finished road mask.

## Comparable captures

Both states use the same native photographic preview and a cyan 40% coverage
overlay. The overview is 1440 pixels wide; the detail shows base rectangle
`[2300,2500,800,600]` at 2×, and the focus enlarges the corrected pavement patch
at 4×. Context is the same detail without the overlay. No color, viewport or
photographic state changes between the selection captures.

The public `segment --layer … --operation add --brush …` added polygon
`[[2970,2573],[3052,2560],[3052,2583],[2970,2596]]` to a SAM road selection.
The [measurements](metrics.json) record 1,377 changed mask samples, all additive
and inside the correction bounds. The displayed detail changes 5,508 pixels;
the operation is not a no-op. Undo restores the initial revision and redo restores
the corrected revision. No new SAM or provider request is part of correction.

## Visual verdict

Independent unprimed review inspected every overview, detail, focus and context
capture. The corrected state is locally more complete: the patch covers genuine
pavement behind the fence wire. Accept this bounded correction witness.

Both states still miss part of the outer bend and tint foreground fence/wire
pixels. The added polygon ends at a straight edge near the post; it deliberately
does not finish the rest of the road. These are remaining selection-quality
issues visible in the crops, not evidence of improved automatic edge finding.
Users can make further additions/subtractions using the same operation.

The retained set includes both states at every framing; the focus is needed
because the change is barely visible at overview scale. It does not establish
the separate workbench browser-presentation checkpoint.
