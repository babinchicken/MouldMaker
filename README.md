# Mould Maker

Turns a master model into a printable silicone-mould kit, entirely in the browser.

Drop in an STL of the thing you want to reproduce — a Buddha statue, say — and you
get back three files:

| Part | What it is |
| --- | --- |
| `master-with-base.stl` | Your model, sat on a square plinth |
| `jacket-front.stl` | Front half of the rigid cover |
| `jacket-back.stl` | Back half |

Print all three. Stand the master on its plinth, clamp the two jacket halves
around it, and pour silicone in through the sprue. The jacket holds a constant
gap around the master, so what cures in that gap is a **conformal silicone skin
of exactly that thickness** — 3mm by default.

## Why a skin and not a block

Silicone costs orders of magnitude more per gram than filament. Burying a 90mm
statue in a solid block of it takes the better part of a litre; a 3mm skin around
the same statue takes about 30ml. The jacket is what makes that possible: it is
both the box you pour into and the rigid support that stops the skin bulging when
you later cast into it.

## How the parts fit together

```
            ┌─────────┐   standing square: flat pad so the clamped
            │  ▁▁▁▁▁  │   assembly stands on its head end too.
            └─┬─────┬─┘   The sprue drops through it.
      ╭───────┴─────┴───────╮
      │   ╭─────────────╮   │  ← jacket wall (3mm)
      │   │  ░░░░░░░░░  │   │  ← silicone gap (3mm)  ← this is the mould
  ════╡   │   master    │   ╞════ ← clamping flange, bolted through
      │   │             │   │
      ╰───┴─────────────┴───╯
   ┌──┴──┴─────────────┴──┴──┐  ← optional brim: a dammed step the silicone
   ╰─────────────────────────╯     spreads into, forming a flat flange
    ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔   ← plinth, wider than the jacket so it
                                    seats on it and seals the bottom
```

The plinth top, looking down — the jacket's own footprint sunk into it, so the foot
lands in one place and nowhere else:

```
   ┌───────────────────────────┐
   │   ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁    │ ← raised lip (the plinth, 2mm proud)
   │ ▕                     ▏   │
  ═╡ ▕     recess, cut to  ▏   ╞═ ← channels where the flange ears
   │ ▕     the jacket foot ▏   │    cross the lip: they also stop the
   │ ▕▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▏    │    jacket rotating on the seat
   └───────────────────────────┘
```

- **Plinth** — unioned onto the master and deliberately wider than the jacket, so
  the jacket's bottom rim lands on it. That contact is what closes the bottom of
  the cavity; nothing else seals it.
- **Flange** — a lip around the parting plane on both halves, with bolt holes and
  a pair of registration cones so the halves can only close one way. Both the cone
  and its socket reach *past* the parting plane rather than stopping flush with it;
  a feature that only touches the plane meets the flange over zero thickness, which
  Manifold reads as disconnected, and the fragment cleanup then quietly deletes it.
- **Keyed seat** (0–2.5mm, 2mm by default) — the flange keys the halves to *each
  other*; this keys the closed pair to the *master*. Without it the jacket sits on a
  flat lip, free to slide and spin, and any drift there opens a gap for silicone to
  weep out of and moves the parting seam off where it was designed. So the top of
  the plinth is raised and the jacket's own footprint cut back out of it, leaving a
  recess shaped like the foot. Note the order of assembly this implies: close the
  halves around the master just clear of the plinth, then lower the pair in — they
  will not slide in sideways. That last move is why the depth is capped below the
  silicone thickness. The cavity is the master grown by exactly that much, so any
  translation shorter than it cannot bring jacket and master into contact, whatever
  shape the master is.
- **Seam bearing** — which way the halves pull apart, as an angle in the XY plane.
  0° parts left from right, 90° front from back, and anything between splits on
  that diagonal. Use it to steer the seam off a face or an ornament: a parting line
  leaves a witness mark on every casting, and it is far easier to move the seam
  than to dress the mark off afterwards. The flange, bolts, vents and the standing
  pad all follow the bearing round.
- **Standing square** — a flat pad on top of the jacket. The pour openings pass
  through it, and it gives the assembly a stable flat face at the narrow end. The
  sprue can be arranged three ways: one bore off the seam, one in each half (pour
  down the first, air and overflow rise up the second), or one wider bore split down
  the seam itself.
- **Bores find their own depth.** Every channel starts just under the *lowest* the
  cavity's roof gets anywhere inside that bore's own circle. Two things go wrong with
  any shallower rule. Measuring from the cavity's single highest point leaves a bore
  a few millimetres off the crown ending in solid jacket, because the dome has
  already fallen away beneath that line. Measuring from the highest point *within the
  circle* opens only the crest of the mouth: round from the pad, a crescent from the
  inside. Going by the lowest point costs a millimetre or two of depth on a vent and
  rather more on an off-centre sprue, and costs nothing else — what lies under it is
  cavity, already void, so the silicone skin is never touched. A bore that finds no
  cavity beneath it is left undrilled and said so in the notes, rather than shipped
  blind, and the narrowest mouth on the kit is reported as a percentage.
- **Silicone estimate** — what the readout asks you to mix is the skin, plus the
  brim, plus the silicone left standing in the sprue and the vents. Only the skin
  comes from the distance field; the other two are cut or added by boolean after the
  field has been measured, so each one has to be carried back separately or the
  figure quietly asks for too little. It is also given as a weight, since silicone
  is sold and mixed by weight rather than by volume.
- **Silicone brim** (0–50mm, off by default) — the same idea as a slicer brim. The
  jacket grows a dammed step at its foot for the silicone to spread out into, and
  the plinth's top face forms the underside, so the finished mould comes out with a
  flat flange all round. That flange is what you clamp, and what a plaster or
  fibreglass mother mould keys against when you make one over the silicone later.
  It is the same thickness as the skin, and the plinth widens automatically to keep
  a floor under the dam.

## Running it

```bash
npm install
```

```bash
npm run dev
```

A test master (a lathed seated figure with genuine undercuts) can be generated
with:

```bash
node scripts/makeTestModel.mjs test-buddha.stl
```

## Model size

**STL carries no units.** A file says "90" without saying whether that is
millimetres, metres or nothing in particular. Models from AI generators are the
awkward case: they typically arrive normalised to a unit cube, or in metres, or at
whatever scale the generator settled on.

So the master is *always* scaled to the **Model height** you set, and the panel
reports what it did (`Scaled from 1.00 file units (×100)`). If your file is
already at print size, type that height.

Without this the two failure modes are both bad: a 900-unit export asks for 347M
grid samples and gives up, and a 1-unit export silently builds a 17mm jacket around
a 1mm speck — no error, just a useless result. Feeding the same shape in at 1, 90
and 900 units now produces byte-for-byte the same kit.

## How it works

The master is never converted into a solid. Downloaded statue STLs are routinely
non-manifold — duplicate vertices, flipped faces, parts modelled as overlapping
lumps — and a boolean library would refuse most of them outright. Instead:

1. **Distance field.** A BVH over the raw triangle soup gives the distance from
   every point on a grid to the nearest surface. Points beyond the band we care
   about are rejected at the root of the tree, which is what keeps this to
   seconds.
2. **Inside/outside by connectivity, not normals.** The obvious way to sign the
   field — take the closest triangle's normal — fails on exactly the models this
   is for: a figure assembled from overlapping parts has surfaces buried inside
   solid material, and points near those get told they are outside. That punches
   bubbles through the offsets and sheds the jacket into loose fragments. So the
   exterior is instead flood-filled inwards from the edge of the grid, with the
   thin layer of cells straddling the surface acting as a barrier. "Outside" then
   means "reachable from outside", which no amount of interior geometry confuses.
3. **Two level sets.** Marching tetrahedra at −3mm and −6mm give the cavity
   surface and the jacket's outer skin, both watertight by construction.
4. **Booleans from there on.** Flange, pad, split, bolt holes, sprue and vents are
   all Manifold operations on shapes that are already known-good solids.

Everything after step 1 runs in a Web Worker, so the UI keeps responding.

## Checking a build

`scripts/headlessCheck.mjs` runs the real pipeline in Node and reports Manifold's
own topology for each half — triangle count, genus, volume, and an edge audit over
the indexed mesh:

```bash
SCRATCH=/tmp node scripts/headlessCheck.mjs /tmp/test-buddha.stl
```

Each half should come back a closed 2-manifold. Genus counts the tunnels through
it, so it should equal the number of holes you asked for — with bolts, sprue and
vents disabled it should be exactly 0. Anything negative means the half has broken
into disconnected fragments.

A half reporting more than one connected piece is a warning, not just noise: a
feature that fails to fuse — a registration pin that only meets the flange over
zero thickness, say — shows up here and nowhere else.

`scripts/auditGeometry.mjs` then measures the exported STLs back against the
master: the jacket's closest approach should sit just under the silicone
thickness (the shortfall is grid discretisation), with the vertex population
clustered at the silicone thickness on the inner face and one jacket wall beyond
it on the outer.

## What it handles

**Triangle count is not the constraint.** The distance field is sampled on a grid
whose size depends on the model's physical size and the resolution setting, not on
how many triangles describe it — a 2M-triangle scan costs barely more than a
6k-triangle one.

| Input | Result |
| --- | --- |
| 484k triangles, 23 MB | ~6s in Node, ~25s in the browser |
| 1.9M triangles, 92 MB | ~9.5s in Node |
| Any source scale (1 / 90 / 900 units) | Identical output |

**Model size is the constraint.** Measured on a statue-proportioned figure
(footprint ≈ 0.66 × height):

| Height | Resolution | Grid | |
| --- | --- | --- | --- |
| 100mm | 1.0mm | 0.9M | 6s |
| 200mm | 1.0mm | 5.0M | 22s |
| 250mm | 1.0mm | 9.1M | 33s |
| 270mm | 1.0mm | 11.3M | 39s |
| 300mm | 1.2mm | 8.8M | 31s |
| 300mm | 1.0mm | 14.8M | refused |
| 400mm | 1.5mm | 10.3M | refused |

So roughly **250mm at the default 1.0mm**, and **300mm if you go to 1.2mm**. Going
one step coarser buys a lot, because sample count grows with the cube of
1 / resolution.

The ceiling is Manifold's fixed WASM heap, and sample count alone does not predict
it — 400mm at 1.5mm fails at 10.3M samples while 270mm at 1.0mm survives 11.3M,
because the level sets' own triangle counts differ. The 10M limit therefore sits at
the top of the range where everything tested passed, and the check runs before any
heavy work, so an over-large request comes back immediately with the resolution
that *would* fit rather than trapping forty seconds in.

## Limits

- **STL only.** GLB, OBJ and PLY are not read yet, which matters because most
  generators offer those first.
- **Undercuts are not detected.** A two-part jacket pulls off a statue with deep
  undercuts perfectly well — it's the *silicone* that has to flex over them, and
  it will — but the jacket halves themselves can lock on very extreme geometry.
  Check the preview before printing.
- The parting plane always runs through the model's **centre**. Only its bearing is
  adjustable, not its offset — you can turn the seam, but not slide it off to one
  side, and it does not seek the widest section.
- Grid resolution has to resolve the thinner of the silicone gap and the jacket
  wall; the app refuses settings coarser than half that.
