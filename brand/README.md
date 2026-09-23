# Brand assets

Chess Dad's mark is a crowned king with a handlebar moustache and a full beard,
supplied as artwork on a solid black ground. `source/logo-lockup.jpg` is the
original and the single source of truth — everything else here is derived from
it, so the mark, the favicon and the app icons cannot drift apart.

## What ships

| File | Purpose |
| --- | --- |
| `public/logo-lockup.jpg` | Full logo: king plus the "Chess Dad" wordmark. Used by the README. |
| `public/logo-mark.png` | The mark alone, square, for the nav and anywhere a compact logo is needed. |
| `src/app/icon.png` | Favicon for modern browsers. |
| `src/app/favicon.ico` | 16/32/48 ICO for older browsers. |
| `src/app/apple-icon.png` | 180px icon for iOS home screens. |

`icon.png`, `apple-icon.png` and `favicon.ico` are picked up by the Next.js
metadata file conventions, so no `<link>` tags are written by hand.

## Two deliberate decisions

**The black ground stays.** The artwork is a JPEG on flat black, and the piece
is drawn *with* black outlines and a black beard. Keying the background out
would eat the outline and the beard along with it, so the mark keeps its own
background. On the app's near-black chrome the square edge is invisible.

**The mark is cropped to the head (78%), not the whole figure.** A full king is
roughly 1:2.1 — far too thin to read inside a square at the 28px the nav uses or
the 16px a favicon gets. The crown-through-beard cut keeps the character
readable at those sizes while the lockup still shows the whole piece.

## Regenerating

Needs `sharp`, which is the only dependency. It is deliberately kept out of the
app's own `package.json`:

```bash
cd brand
npm install
node make-brand.mjs source/logo-lockup.jpg ..
```

The script trims the letterbox, finds the gap between the king and the wordmark,
measures both bounding boxes, and writes every asset. To change the framing,
adjust `MARK_CROP` or `PAD` at the top of `make-brand.mjs`.

To use different artwork, drop it in `source/` and update the path — the script
makes no assumptions beyond "a mark stacked above a wordmark on a flat ground".
