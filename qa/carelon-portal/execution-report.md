# Carelon test execution report

**Updated:** 2026-09-10T04:33:56.151623+00:00
**Portal:** https://www.providerportal.com/Default.aspx
**Browser:** Existing Oya desktop session, MK-Local-demo.
**Result:** 3 cases partially exercised; 21 cases not executed. No complete end-to-end case passed. No final submission or withdrawal action was taken.

## Verified against the actual desktop session

- The existing Carelon tab was authenticated. Login and email verification were not replayed.
- **CARELON-001, partial:** Entered the user-supplied member identifiers and the September 20, 2026 service date from the supplied PDF (communicated assumption). Find This Member returned a matching name, birth date, member ID/prefix, and health plan. Selected the exact autocomplete result `70486 — CT scan of face without contrast`, selected Diagnostic Imaging, retained the existing member phone/type, and activated Start Order Request.
- The next page displayed a duplicate-check warning and one existing **In Progress** request for the same service date and maxillofacial/sinus CT. The displayed order ID also matches the historical PDF example. The browser was left at this checkpoint; no new ordering-provider, clinical-answer, facility, or final-submission action followed. This does not establish backend duplicate prevention or approval.
- **CARELON-022, partial:** A separate Chrome viewer connected to the actual Oya desktop stream and rendered a 2560 × 1516 frame. The viewer URL contained no API key. Input ordering, dropdown behavior, and focus through dashboard refresh remain unverified.
- **CARELON-006, partial:** Activating Find This Member on the empty form displayed validation for service date and birth-date format, first-name minimum 1 character, last-name minimum 2 characters, and member-ID minimum 6 number characters. Individual omission and malformed-value variants remain unexecuted.

## Harness corrections

1. The initial harness used MCP-style action/parameter names. The REST command interface uses `analyze` and a `selector` parameter for element actions.
2. Passing an analyzer-returned randomized attribute selector caused incorrect targeting because the desktop resolver parsed the first digits anywhere in that string. The temporary helper now validates the observed element ID against the most recent analysis and sends it as a numeric string. Subsequent member-field entry, lookup, and procedure selection were verified. No application-source correction was made in this run.
3. The live-view probe initially searched for an image accessibility role. The viewer image is decorative; the corrected probe successfully observed real frames. This was a probe error, not a stream failure.

## Current checkpoint and remaining work

The browser remains signed in on Member History, showing an existing matching request and the portal's instruction to check for duplicates. Clarify whether to inspect that existing request or use a different intended service date before advancing another request. The service date was taken from the PDF, not newly confirmed by the user.

The rest of the positive flow and negative/recovery cases remain unexecuted. Alternate fixtures and appropriate test conditions are needed for duplicate submission, withdrawal, and contradictory clinical variants; these were not exercised on this real member. The example fixture remains synthetic.

## Evidence

- `live-view-result.json`: sanitized live-view probe result.
- Screenshots and the element map remain in temporary local files because they can contain patient/account details. Patient identifiers were not copied into these repository test artifacts.
