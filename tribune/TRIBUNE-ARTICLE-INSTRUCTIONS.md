# The Sandlot Tribune — Article Creation Instructions

Use this file as your complete reference when writing a Tribune edition. You do not need to ask the user to re-explain anything in here.

---

## What Is The Sandlot Tribune?

The Sandlot Tribune is the official newspaper of **The Sandlot Dynasty League (TSDL)**, an 18-team fantasy baseball dynasty league. The Tribune covers league news, transactions, roster moves, trades, and other storylines with the voice and format of a real sports newspaper.

**Tone:** Factual but entertaining. Think NYT Sports or The Athletic — authoritative, occasionally sardonic, never breathless. Treat real fantasy baseball events (trades, pickups, roster decisions) with the same journalistic weight as real MLB news. Use fictional bylines drawn from famous real-world baseball writers (Ken Rosenthal, Jeff Passan, Buster Olney, Tim Kurkjian, Peter Gammons, etc.).

**Do NOT:** Say "fantasy baseball" or "fantasy league" in the article body. Write as if this is a real league with real stakes.

---

## File Structure

```
sandlottribune/
└── tribune/
    ├── index.html              ← EDITIONS array lives here
    ├── TRIBUNE-ARTICLE-INSTRUCTIONS.md   ← this file
    └── editions/
        ├── tex-sale.html       ← example HTML fragment
        └── lad-milb.html       ← example HTML fragment
```

New editions are saved as HTML fragments in `tribune/editions/<slug>.html`.
The `tribune/index.html` EDITIONS array must be updated to register the new edition.

---

## HTML Fragment Format

Each edition file contains **only the article body** — no `<html>`, `<head>`, or `<body>` tags. It is injected directly into the Tribune reader's `.trib-paper-content` div.

### Standard Article Template

```html
<div class="trib-body trib-drop-cap">

  <div class="trib-section-label">Section Name Here</div>

  <h2 class="trib-headline">Main Headline Goes Here</h2>
  <p class="trib-deck">
    A single compelling sentence that expands on the headline and draws the reader in.
  </p>
  <div class="trib-byline">
    By [Author Name] &nbsp;&bull;&nbsp; The Sandlot Tribune &nbsp;&bull;&nbsp; [Date]
  </div>

  <hr class="trib-rule trib-rule--thick">

  <div class="trib-col-layout-2">

    <p>
      <span class="trib-dateline">SANDLOT DYNASTY LEAGUE, [Month Day]</span> —
      Opening paragraph. The first letter of this paragraph will auto-render as a drop cap
      because of the .trib-drop-cap class on the wrapper div.
    </p>

    <p>Second paragraph. Continue the story.</p>

    <div class="trib-sidebar">
      <div class="trib-sidebar-hed">Sidebar Heading</div>
      <p>Short sidebar content — key facts, stats, or context that supplements the main story.</p>
    </div>

    <p>More body paragraphs as needed.</p>

    <div class="trib-pull-quote">
      "A memorable quote or key sentence pulled from the article."
      <cite style="display:block;font-size:0.78rem;margin-top:8px;font-style:normal;letter-spacing:0.08em;text-transform:uppercase;">— Attribution</cite>
    </div>

    <p>Closing paragraph(s).</p>

  </div>

</div>
```

---

## Full CSS Class Reference

### Wrappers
| Class | Purpose |
|-------|---------|
| `trib-body` | Required outer wrapper on every edition fragment |
| `trib-drop-cap` | Add to `trib-body` to make the first letter of the first `<p>` a large drop cap |

### Header Elements (always `column-span: all` — appear above the columns)
| Class | Element | Purpose |
|-------|---------|---------|
| `trib-section-label` | `<div>` | All-caps section tag (e.g. "Ownership & League News", "Transactions & Moves", "Trade Analysis") |
| `trib-headline` | `<h2>` | Main article headline — Playfair Display 900, large |
| `trib-deck` | `<p>` | Italic subhead/deck beneath the headline |
| `trib-byline` | `<div>` | Author, publication, date — use `&nbsp;&bull;&nbsp;` as separator |
| `trib-rule` | `<hr>` | Thin horizontal rule |
| `trib-rule--thick` | Add to `trib-rule` | 3px solid rule (use between byline and body) |

### Column Layouts
| Class | Element | Purpose |
|-------|---------|---------|
| `trib-col-layout-2` | `<div>` | 2-column newspaper layout with column rule |
| `trib-col-layout-3` | `<div>` | 3-column layout (for shorter pieces) |

**Note:** All direct children of a column layout div flow across the columns. To force a column break, add `break-before: column` inline or use a `<div style="break-before:column;">`. The `trib-sidebar` and `trib-pull-quote` use `break-inside: avoid` automatically.

### Body Elements (inside column layouts)
| Class | Element | Purpose |
|-------|---------|---------|
| `trib-dateline` | `<span>` | Bold dateline at start of first paragraph (e.g. `SANDLOT DYNASTY LEAGUE, March 10`) |
| `trib-sidebar` | `<div>` | Boxed sidebar — bordered, lightly shaded. Use for key facts/stats. Add `trib-sidebar-hed` div inside for the sidebar heading. |
| `trib-sidebar-hed` | `<div>` | Sidebar heading inside `.trib-sidebar` |
| `trib-pull-quote` | `<div>` | Centered pull quote with top/bottom rules. Spans full column width. Use `<cite>` for attribution. |
| `trib-rule` | `<hr>` | Thin section divider within the body |
| `trib-caption` | `<p>` | Italic image caption (place directly after an `<img>`) |

### Images
```html
<img class="trib-photo" src="path/to/image.png" alt="Description">
<p class="trib-caption">Caption text here. (AP Photo / TSDL Archives)</p>
```

---

## EDITIONS Array Entry Format

After saving the fragment, add an entry to the `const EDITIONS = [...]` array in `sandlottribune/tribune/index.html`. Insert at the **top** of the appropriate year group (most recent first within the year).

```javascript
{
  slug:     'your-slug',         // URL-safe string, matches filename without .html
  vol:      'Vol. 5, No. 3',     // Increment No. from the previous 2026 edition
  date:     'March 15, 2026',    // Human-readable date
  dateIso:  '2026-03-15',        // ISO format for sorting
  year:     2026,                // Integer year
  headline: 'Your Headline Here',
  subhead:  'Optional brief subhead for the nav item (can omit)',
  type:     'html',              // Always 'html' for new editions; 'image' for archive scans
  src:      'editions/your-slug.html',
  section:  'Section Name',      // Matches trib-section-label in the fragment
},
```

**Current volume:** Vol. 5 = 2026 season. Vol. 1 = 2022 (the archived scanned pages).
**Next edition number:** Check the highest existing `No.` in the 2026 group and add 1.

---

## Git Workflow

After saving the edition file and updating `tribune/index.html`:

```bash
cd C:/Users/RTSch/sandlottribune
git add tribune/editions/<slug>.html tribune/index.html
git commit -m "Tribune: Add '<Headline>' edition"
git push
```

**Live URL after push:** `https://rtschwartz13.github.io/sandlottribune/tribune/?edition=<slug>`

(Confirm the GitHub Pages URL with the user if unsure — check the sandlottribune repo's Pages settings.)

---

## Section Label Examples

Use these or create your own:
- `Ownership & League News`
- `Transactions & Moves`
- `Trade Analysis`
- `Power Rankings`
- `Weekly Recap`
- `Season Preview`
- `Draft & Development`
- `Around The League`

---

## Tone Examples

**Good — authoritative, dry wit:**
> SANDLOT DYNASTY LEAGUE, March 7 — After months of behind-the-scenes maneuvering, the Texas Rangers franchise has officially cleared the final procedural hurdle necessary for a league-sanctioned ownership transfer, multiple sources familiar with the situation confirmed to The Sandlot Tribune on Thursday.

**Good — analytical:**
> The decision to pass on Kristian Campbell — widely seen as the consensus top prospect available in the expansion pool — drew considerable attention around the league. Sources close to the ownership group indicated the choice was deliberate, driven by positional depth and a preference for arms over bats at this stage of the franchise build.

**Avoid:**
- "In the world of fantasy baseball..."
- Exclamation points
- Casual slang or emoji
- First person ("I think...", "We saw...")
- Saying "fantasy" or "game"

---

## Providing Article Direction

When the user asks you to write a Tribune edition, they will tell you:
- **Topic** — what the article is about
- **Key facts** — player names, transaction details, context
- **Tone angle** — e.g., "make it dramatic", "keep it factual"

You should:
1. Determine an appropriate `slug` (URL-safe, lowercase, hyphens)
2. Choose a `vol` (increment from last 2026 edition in the EDITIONS array — read `tribune/index.html` to check)
3. Write the article body following the template above
4. Save to `tribune/editions/<slug>.html`
5. Update the EDITIONS array in `tribune/index.html`
6. Run the git workflow above
