# AccessPatch demo storyboard

## Recording

[AccessPatch-demo.mp4](./AccessPatch-demo.mp4) is an 18.2-second, silent screen recording captured from the running local app in headless Chromium. The recording shows actual app interactions, a live Nemotron proposal from `/api/propose`, real `/api/verify` results, and a local baseline inspection. No Computer Use session or YouTube upload was used.

The demo uses the bundled synthetic community-garden signup HTML. The local-file section also loads that bundled sample; it is not a real user page. The local-file inspection in the video uses the selected `Tab` journey and does not send that file through the local-file model-proposal flow.

## Time-coded storyboard and suggested narration

| Time | On screen | Suggested narration |
|---|---|---|
| 0:00–0:04 | AccessPatch opens on the synthetic fixture. The baseline shows 0/3 checks passed and the browser focus trace. | “This is AccessPatch’s controlled, synthetic signup fixture. The first Chromium run records three narrow checks and the current keyboard path.” |
| 0:04–0:10 | Request repair options. The live response appears with three selectable repair IDs. | “Nemotron, through Nebius Token Factory, proposes three changes. For this fixture, the model selects from pre-authored edits; it does not write executable code.” |
| 0:10–0:14 | Select the returned repairs and verify. The comparison shows 0/3 before and 3/3 after, with focus traces and the diff. | “The selected candidate passes all three fixture checks. Review the before and after focus trace and source diff. This result applies to this fixture only; it is not a compliance claim.” |
| 0:14–0:18 | The optional local-file panel shows its trust warning, one-shot consent, and the captured Tab baseline. | “A separate local mode accepts one trusted HTML file and a user-chosen key sequence. It runs in a browser context, not OS-level isolation, and can differ from the deployed page.” |

## Actual model response shown

The fixture request returned model `nvidia/Nemotron-3.5-Super-VL` and this summary:

> The image lacks an alt attribute, the email input lacks a programmatically associated label, and the sign-up control is a non-native div. Repairs target these three observed failures.

The returned repair IDs were `image_alt`, `email_label`, and `submit_semantics`. The recorded verification reported **0 of 3** checks before and **3 of 3** after. These are the fixture’s limited checks for image alt presence, label association, and native button semantics.

## Limitations to say aloud or keep visible

- A passing result is not WCAG compliance and does not establish full accessibility. The fixture checks only three conditions.
- The model response is a suggestion. In fixture mode, the edits are pre-authored and applied deterministically; a reviewer selects them before verification.
- Focus is browser-observed. Displayed role and name are DOM-based approximations, not platform accessibility-tree values.
- The local-file mode executes trusted HTML with JavaScript enabled in a fresh Chromium context. This is not OS-level containment. HTTP and WebSocket requests are intercepted, service workers and downloads are blocked, but other network paths are not guaranteed blocked.
- External CSS and JavaScript may be unavailable. Visually hidden controls can appear in a focus trace, and results can differ from the deployed page. The local run is evidence for the selected journey only.
- The local-file model path requires a separate, explicit consent to send source to Nebius. That consent was not used for the local-file inspection shown in this recording.

The MP4 is a silent screen capture. The narration above is a script, not audio present in the file.
