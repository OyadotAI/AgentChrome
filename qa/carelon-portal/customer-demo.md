# Carelon customer demo: sinus CT request

**Test case:** CARELON-DEMO-001  
**Portal:** https://www.providerportal.com  
**Mode:** Guided live demo, stop before submission  
**Last execution:** Partially verified on September 10, 2026

## What this demonstrates

Use an existing authenticated desktop browser to find a member, select a precise procedure, and check for an existing request before continuing. The customer can watch the same browser through Oya's live viewer.

## Setup

- Connect the Oya desktop browser and open its live viewer.
- Reuse the signed-in Carelon tab. Complete login or verification manually if the session has expired.
- Supply the demo member's name, birth date, member ID, and health plan at runtime. Patient identifiers and credentials are intentionally excluded from this shareable test case.
- Confirm the intended service date. The previous run used **September 20, 2026**, taken from the supplied PDF; this is not a rolling default.
- Procedure: **70486 — CT scan of face without contrast**.
- Diagnosis for a later request step: **J32.0 — Chronic maxillary sinusitis**.
- The user permits selection of an available doctor and facility. Use the portal's listed records and contact information.

## Demo steps and expected results

| Step | Action | Expected result | Previous run |
| --- | --- | --- | --- |
| 1 | Open the connected desktop's live viewer. | The actual desktop frame renders. | Verified; viewer input/focus not fully tested. |
| 2 | Open the existing Carelon tab. | Authenticated portal is visible. | Verified. |
| 3 | Enter service date and supplied member identifiers; select Find This Member. | Name, birth date, member ID/prefix, and plan match the intended member. | Verified. |
| 4 | Search for 70486 and select the exact no-contrast result. | Selected procedure reads CT scan of face without contrast. | Verified. |
| 5 | Select Diagnostic Imaging and review the prefilled member contact details. | Phone/type and Start Order Request appear. | Verified. |
| 6 | Activate Start Order Request and inspect Member History. | Existing requests are visible for duplicate review. | Verified: one matching request was In Progress. |
| 7 | If a matching request exists, stop and show its date, exam, and status. | No second request is submitted. | This was the actual demo endpoint. |

**Presenter wording:** “The browser found the member and selected the exact procedure. Carelon shows an existing request for the same exam and service date, so we stop here to avoid submitting a duplicate.”

Do not describe this result as an approved authorization, a completed end-to-end order, or proof that the portal automatically blocks duplicates. The agent stopped after inspecting the warning and existing request.

## Optional continuation: separate end-to-end demonstration

Only continue when the member history and intended service date establish that a new request is appropriate. Follow CARELON-001 in [test-cases.md](test-cases.md): select an available ordering provider, review its fax, select the exact exam and diagnosis, enter supported clinical answers, review contact information, and select an available facility. Stop at the review screen for this demo.

These later steps were documented from the supplied PDF but **were not executed in the live run**. Clinical answers in the PDF are reference-flow examples; confirm their applicability before entering them for a new request. Final submission and withdrawal are outside this demo's scope.

## Repeatability and evidence

On every replay, inspect current member history; request status and session validity can change. Do not assert that the historical In Progress status remains current without reading it again. Capture actual outcomes in [execution-report.md](execution-report.md).

The corresponding structured definition is [customer-demo.json](customer-demo.json). It is a guided test specification, not an executable automation script. Temporary patient screenshots and local session credentials are not included in the shareable artifacts.
