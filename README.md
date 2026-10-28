# AccessPatch

AccessPatch is a local accessibility repair and verification experiment. It uses NVIDIA Nemotron on Nebius Token Factory to propose changes, then shows a diff for human review. Browser checks and keyboard traces are observations, not proof of accessibility compliance.

## Start

Requires Python 3.10+, Node.js, Playwright, Chromium or Chrome, and a Nebius Token Factory API key. The workspace runtime already includes Playwright on this machine. Elsewhere, install the `playwright` Node package and a compatible Chromium browser. Set `ACCESSPATCH_BROWSER` to a Chrome/Chromium executable if Playwright cannot find one, and `NODE_PATH` if Playwright is installed outside the project. Set `NEBIUS_API_KEY` in your environment or a parent `.env.txt`. Never commit credentials.

Run `python server.py` from the AccessPatch directory and open http://127.0.0.1:8001. The server binds to localhost only. Run tests with `python test_server.py` (the browser integration test requires the browser dependencies).

## What it does

The bundled garden-signup page contains three seeded defects. Nemotron selects from three pre-authored changes; the model does not author executable code for that fixture. The user chooses changes and sees a real Chromium before/after audit, keyboard focus trace, and source diff. The observed checks cover only image alt presence, label association, and native button semantics.

The local-file workflow accepts a **trusted**, self-contained HTML file and an explicit keyboard journey. It runs the page with JavaScript enabled in a fresh browser context, intercepting HTTP and WebSocket requests and blocking service workers and downloads; other network paths are not guaranteed blocked. It records browser focus after each key. Displayed roles and names are simple DOM-based approximations, not platform accessibility tree values. External HTTP assets and APIs are blocked; other network paths are not guaranteed blocked, and behavior can differ from the actual deployed page. The browser's OS sandbox remains enabled, but a browser context is **not OS-level containment**. Do not open untrusted pages. This tool must not be hosted or exposed to public traffic. It does not execute repositories, install packages, or run shell commands from a user page.

With separate consent, up to 12,000 characters of source are sent to Nebius for a model repair proposal. The server accepts only bounded additions of selected attributes to exact existing tags and conversion of simple text-only divs to native buttons and drops malformed or unsafe operations; it does not accept generated scripts. It also rejects empty alt text unless the original tag explicitly indicates decoration, and avoids adding aria-label when a known label is already associated. These guards do not prove a change is correct. A reviewer must examine the diff; the candidate is never automatically applied. A separate user action runs original and candidate through the same journey, and the candidate can be downloaded. Inspect mode accepts up to 500 KB.

Observations and model suggestions are fallible. The checks do not test screen-reader behavior, contrast, semantics in depth, full dynamic behavior, or WCAG compliance. Inspect names and states with appropriate assistive technology and conduct human testing. No data is persisted by the server; source is sent to Nebius only when the user requests a proposal. Model and service providers' own data handling applies.
