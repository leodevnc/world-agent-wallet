# Dashboard design

## Purpose

Make shared budget, pending approvals and payment history easy to distinguish without changing the wallet's execution or authorization model.

## Presentation choices

- White content area and light-gray navigation, with subtle borders instead of decorative gradients.
- Black primary actions identify execution-related controls; secondary actions retain outlined styling.
- Larger supporting text and darker neutral labels improve readability. Status badges retain green, amber and red alongside explicit text, so color is not the only signal.
- Tabular numerals make budget amounts easier to compare.
- A desktop sidebar becomes a visible mobile navigation grid. Refresh remains available on narrow screens.
- Budget cards stack on small phones. Input fields and approval buttons wrap without widening the document.
- Activity rows remain in a horizontally scrollable table to preserve column relationships. Its named region can receive keyboard focus.
- A skip link, visible focus indicators and a named request-details dialog support keyboard navigation.

The visual direction is OpenAI-inspired, but the project uses its own name and mark and does not imply affiliation.

## Boundaries and tradeoffs

This update changes HTML structure, styling and browser checks, not payment adapters, API contracts, approval rules, ledger calculations or credentials. English defaults and user-provided content remain unchanged.

Keeping a table on mobile requires horizontal scrolling; it avoids hiding individual receipt fields. Smaller screens prioritize legibility over displaying all budget cards in one row. Status colors remain meaningful rather than decorative.

## Evidence

- 46 unit/integration tests and 3 browser tests passed on Linux Node.js 24.19.0.
- Syntax checks and the IDKit bundle build passed.
- Browser checks cover demo sign-in, payment, approval, rejection, policy changes and sign-out, plus theme colors, keyboard skip navigation, a focusable table and visible mobile navigation/refresh.
- Layout checks at 320, 390, 768 and 1440 pixels found no document overflow.
- Desktop and mobile screenshots were captured from the local in-memory demo and visually reviewed.

No real World account, wallet or funds were used. Browser requests outside the local fixture were blocked. These targeted checks are not a full accessibility audit or live-payment certification. See [validation.md](validation.md) for reproduction and the remaining integration limits.
