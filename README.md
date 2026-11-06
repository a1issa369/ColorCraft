# ColorCraft

A colour grading teacher for beginner photographers. Drop in a photo and it reads the exposure, contrast and colour, explains in plain words what it sees, and lets you fix each problem with one slider or one tap. Runs entirely in the browser: no uploads, no accounts, no dependencies, no build step.


## Try it

Open the live demo (GitHub Pages, once enabled) or run it locally:

```
node scripts/serve.js 8080     # then open http://localhost:8080
npm test                       # 152 tests, Node 22+
python3 scripts/mutation_check.py
```

No photo handy? Three real sample photos sit on the home page, each looping a before and after wipe. The "after" is made by the same engine as the editor, from the look and adjustments listed in `src/ui/featured.js`, and opening a card puts the original photo in the editor. To use your own, drop JPEGs into `assets/samples/` and edit that list.

## What it does

- **Read**: brightness histogram, a colour scope, and findings such as "Underexposed", "Highlights are clipping", "Leans warm". Each finding explains itself and has an *Apply this fix* button. *Fix everything for me* runs the auto grade.
- **Adjust**: eight sliders (exposure, contrast, highlights, shadows, temperature, tint, saturation, fade), each with a one line explanation, plus a **colour mix** panel (hue, saturation and brightness for eight colour families). Double click a slider to reset it.
- **Curves**: a Lightroom-style tone curve with RGB, Red, Green and Blue lines drawn over a live histogram. Drag to bend, tap to add a point, double tap to remove one. Works with touch, mouse and keyboard.
- **Looks**: 18 starting points in five groups (Natural, Film, Cinematic, Moody, Mono) with a strength slider. A look is just slider values, a curve and a colour mix, so nothing is hidden.
- **Match**: pick a photo whose grade you like and ColorCraft learns its brightness and its colour toning, separately for darks, mids and lights. Separate colour and tone sliders. *Turn into editable curves* bakes the match into the Red, Green and Blue lines so you can fine tune it.
- **Gradient masks**: limit an edit to part of the photo. A gradient is strongest at its start dot and fades to nothing at its end dot, so you can darken a sky without touching the ground. Drag the dots, flip the side, show the area as a red overlay, and give each mask its own exposure, contrast, highlights, shadows, temperature and saturation. Up to three, with one-tap starters (darken the sky, lift the ground, warm the horizon).
- **Undo and redo**: buttons plus Ctrl or Cmd+Z, Shift+Ctrl or Cmd+Z and Ctrl+Y. A whole slider or curve drag is one step, and it covers sliders, curves, colour mix, looks, Fix everything and the reference match.
- Before and after handle (drag or arrow keys), hold to see the original, save a full size JPEG (up to 4000 px), copy your settings as text.

## How it works

All colour maths is in `src/core` with no browser dependencies, so it is testable in Node.

| Piece | Approach |
| --- | --- |
| Colour spaces | sRGB, linear light and CIE Lab (D65), converted through lookup tables for speed |
| Exposure, white balance | gains applied in linear light, where doubling the light really is one stop |
| Highlights, shadows | a gain looked up by each pixel's brightness, smoothly weighted so the other end is untouched |
| Contrast | a power curve pivoted at middle grey |
| Colour cast | a soft-weighted "gray world" estimate: average the mid and bright pixels, giving strongly coloured pixels less say |
| Tone curves | monotone cubic (Fritsch-Carlson) splines through draggable points, combined into one lookup table per channel |
| Colour mix | hue, saturation and brightness per colour family, with weights shared smoothly between neighbouring families so nothing jumps at an edge |
| Cast fix | a 2x2 solve, because temperature and tint nudge each other's axis |
| Auto grade | apply fixes, measure again, correct what is left, up to three rounds, keep the best round |
| Match | brightness histogram matching, plus Reinhard-style (2001) colour transfer in Lab done separately for six brightness bands, with the spread ratio clamped to 0.6 to 1.6 and the shift capped |
| Match to curves | per channel, average the output for each input value, force the result to rise (pool adjacent violators), then simplify to at most 7 draggable points |
| Palette | k-means in Lab with a deterministic start, so the same photo always gives the same swatches |

## Tradeoffs

- **Gray world is a guess.** A photo of a blue sea really is blue. The cast finding is worded as "leans cool, if it does not feel right...", and the estimator down-weights strong colours instead of trusting them, but it can still be wrong on single colour scenes.
- **The preview is a 1280 px copy.** Sliders stay smooth on a phone. Export re-grades the full image (capped at 4000 px) with the same code, so what you see is what you save.
- **No raw support, no local masks, no curves.** This teaches global grading. It is not a Lightroom replacement.
- **Colour is managed as sRGB only.** Wide gamut photos are treated as sRGB.
- **Vanilla JavaScript, no framework.** I planned React and TypeScript, but the package registry was unreachable in my build environment, so I wrote it with zero dependencies. That turned out to suit it: the whole app is static files.

## Speed

Every slider tick regrades the photo, and the cost stacks: a plain tint change is about 30 ms on a 1280 px preview, a colour mix adds about 100 ms and a reference match about 140 ms (measured on a slow cloud machine). Three things keep it smooth:

- **Draft preview while dragging.** Changes are drawn from a 512 px copy while a slider or curve is moving, and redrawn at full size about 180 ms after the last change. Saving always renders the full photo.
- **Lookup tables instead of per-pixel work.** The colour mix and the reference match precompute everything that depends only on hue or lightness, once per change instead of once per pixel.
- **Reused buffers and released photos.** Pixel buffers are allocated once per photo and reused, and the previous photo's decoded image is closed when a new one opens, so long sessions do not pile up memory.

Measured on the same machine with contrast, shadows and a reference match on, dragging a slider went from 4.3 to 16.9 frames per second.

## Colours that go out of range

Stacked boosts (exposure, saturation, a look's colour push) can ask for a colour the screen cannot show, such as a blue above 100 percent. Chopping it at the limit flattens bright neon and sky into one value. The last step of the pipeline instead pulls such a pixel toward its own grey until it fits, which keeps its hue and brightness. On a vivid test ramp this keeps noticeably more distinct colours than clipping did, and the tests pin that down.

## How the masks work

A mask is a soft map from 0 to 1 over the photo, measured in real pixels so the angle is true on a wide photo. The photo is graded as usual, then each mask's own small edit is computed and blended in by that map: full strength where the map is 1, none where it is 0. Masks go last, on top of looks and the reference match, in the order you made them. The strength map is cached while you drag a slider and rebuilt only when a dot moves. With three masks on, a slider tick costs about 50 ms against about 33 ms with none (measured on a slow cloud machine).

Gradients only for now. A paintbrush and a pick-by-brightness mask are the next steps, and there is no automatic sky or subject selection.

## Tradeoffs for the curves and matching

- **Matching is not a neural network.** There is no training data and no way to ship weights while staying dependency free, and a fitted curve can be explained and edited. The cost is that it only copies a grade (tones and colour toning), never content, so a neon street reference cannot teach a sunrise to look like a neon street.
- **One reference photo is a weak teacher.** Reference and photo should be lit and composed roughly alike. Colour toning is learned from whatever colours the reference contains, so a reference full of one object leaks that object's colour.
- **Baked curves are an approximation.** A colour match is not separable by channel, and the curve sits in the middle of the pipeline, before saturation, colour mix and split toning. The bake looks close but is not identical to the live match, and the UI says so.

## Things that broke

- **Fitted curves drifted from straight.** My first curve fitter put each knot at the centre of its bin. When pixels bunch up on one side of a bin, the average output sits off the centre and the "unchanged" green line came out wobbly when only red and blue had been edited. Knots now sit at the average input of their bin, and a test checks the untouched channel stays straight.
- **Baked curves were undraggable.** The first bake produced 15 points per channel. Now simplified to at most 7.
- **The curve hid under the pinned photo on phones.** Switching to the Curves tab now scrolls the editor into the space under the photo.
- **It got slower the more I used it.** Costs stack: each feature switched on made every slider tick slower, so a session with a few edits and a reference was about 8 times slower than a plain one. I could not reproduce memory growing from photo to photo in the page itself, so the fix targets the per-tick cost and also closes old photo bitmaps, which the browser keeps outside the page's own memory.
- **"Shadows are crushed" on a silhouette.** It is intentional there, so the finding now says to leave it if so.

- **The first cast estimator was biased.** I averaged only "nearly neutral" pixels. On scenes with little true grey it locked onto whatever was least colourful, which was often the cast itself. Switching to a soft weighting fixed it, and a test now checks that a large vivid patch cannot drag the estimate.
- **Fixes fought each other.** Pulling highlights down flattens the photo, which triggers a contrast fix, which clips highlights again. A one shot fix list could make things worse, so the auto grade measures after each round and keeps the best one. On degenerate flat images it used to diverge; "keep the best round" stopped that.
- **Boosting saturation amplified casts.** A cast counts as colour, so a tinted photo looked colourful and a muted one looked fine. The auto grade now settles the cast first and judges saturation after.
- **Black and white photos were called muted.** Tinted monochrome (sepia) has chroma but only one hue. The muted check now compares how varied the colours are against how strong they are.
- **Sample photos hid bugs.** My first "too orange" sample read as cool because the scene was blue dominant. I rebalanced the scene and tested that each broken sample is diagnosed the way it was broken. The synthetic scenes still back the tests, but the home page now uses real photos, which is where "Fix everything" turned out to strip the gold from a sunset: it treats a strong cast as a mistake, so those cards use a look instead.
- **Float noise in the UI.** A fix showed as `0.7000000000000001`. Fix values are now rounded to slider steps, and a test pins that.

## Testing

152 tests cover the colour maths (round trips, known values), each slider's direction and isolation, the diagnosis rules, the white balance solver and the transfer. `scripts/mutation_check.py` then breaks 44 lines of the maths on purpose (flip a sign, move a pivot, drop a clamp) and requires the suite to fail every time; it initially let 6 through, and 2 of the 11 mutations added with the curves work, which is how several of the tests above were found.

The browser layer (`src/main.js`, `src/ui`) is checked by hand with Playwright screenshots at phone and desktop widths, not by automated tests.

## Layout

```
src/core    colour maths, masks and undo history, no DOM
src/ui      histogram, scope and curve editor drawing, slider copy
src/main.js wiring: loading, rendering, tabs
tests       node:test suites
scripts     dev server, mutation check
```
