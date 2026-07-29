# CSS structure

`styles.css` is the only entry point. Its imports are ordered deliberately because
the later refinement and legibility modules override base layout values.

- `01-foundation.css`: reset, global tokens, and shared element defaults.
- `10–14-control-*.css`: console shell and page-specific layouts.
- `20–25-obs-*.css`: fixed 1920×1080 OBS layouts by output page.
- `30-control-teams.css`: team editor and battle-row controls.
- `40-obs-teams.css`: team status broadcast.
- `50-refinements.css`: blue console theme, difficulty colors, OBS typography,
  source colors, and saved-state feedback.
- `60-responsive.css`: console layout breakpoints.
- `70-legibility.css`: final minimum font sizes for console and OBS use.

Keep page-specific selectors inside their page root (`.control-shell`,
`.obs-songs`, `.obs-results`, or `.obs-bracket`) and use native CSS nesting.
Do not add one-off overrides to `styles.css`.
