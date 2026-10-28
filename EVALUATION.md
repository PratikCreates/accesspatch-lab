# AccessPatch: research and evaluation notes

## Problem and competition

WebAIM's 2026 study reports 56.1 automatically detected errors per home page across one million home pages. It warns that automated testing cannot establish accessibility or conformance. Developers and disabled people were not interviewed for this project; demand for this particular tool is unvalidated. Deque already offers accessibility testing and AI-supported remediation, so this is not a claim of a new category.

- https://webaim.org/projects/million/
- https://www.deque.com/axe/ai/
- https://survey.stackoverflow.co/2025/ai

## Observed results

- The bundled signup example is synthetic. In a headless Chromium UI run, the NVIDIA model selected three pre-authored repairs; the three deliberately limited checks went from 0/3 to 3/3. This is not an accessibility score or proof of compliance.
- An actual earlier project page, Streetlight, was submitted to `local_propose`. The model produced no accepted repairs. Nine-Tab before/after traces were identical. External CSS and JavaScript were blocked in the test, causing hidden controls to appear in the focus path; this test therefore does not reproduce the deployed page.
- Four one-shot model cases: a grounded email label was accepted; a previously labeled field remained unchanged; an unsafe empty-alt suggestion for an unknown image was dropped; a native-button conversion was dropped because the model supplied an incomplete tag. After a prompt clarification, one additional live test produced a complete accepted conversion. These small examples are not a benchmark of general accuracy. The first four calls averaged 1.154 seconds and cost approximately $0.0006501 combined, based on the catalog's reported rates and returned usage. Other calls are not included in that cost.
- Independent adversarial tests found WebSocket and WebRTC egress and label-override/parser problems. The demonstrated paths received defenses and regression tests. This remains a trusted-local-only tool; browser controls are not OS-level isolation and cannot guarantee network containment.
- Mantine issue #9299 and PR #9301 document a genuine submenu focus bug and its fix, but AccessPatch has not reproduced or repaired that React application. The issue was already fixed upstream and is not an unresolved bug discovered here: https://github.com/mantinedev/mantine/issues/9299 and https://github.com/mantinedev/mantine/pull/9301.

## Outstanding submission work

A public hosted demo, public licensed source repository, and public YouTube video under three minutes are required by the event rules. None has been published or submitted. Vercel project creation returned 403; a Nebius Sandbox access probe required a Project ID that was not available locally. The current local browser runner is not safe to expose as a public multi-user service. Do not present it as submission-ready.

Official rules: https://nebiusglobalaihackathon.devpost.com/rules
