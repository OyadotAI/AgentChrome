# Carelon Portal — order-request test cases

**Source:** `Carelon Portal _ Notion.pdf`, exported September 9, 2026. References below use PDF page numbers.
**Status:** Designed; not executed against Carelon.
**Scope:** Login → email verification → member lookup → ordering physician → scan → diagnosis → clinical questionnaire → review → facility → final review → submission.

## Source boundaries

Pages 1–9 contain the illustrated flow. Pages 10–18 contain no flow content. Several screenshots are horizontally cropped, so the portal URL, some navigation controls, search fields, and final request status cannot be reliably read. Use the actual configured test portal and observed controls when executing; do not invent selectors or infer a successful authorization decision.

The screenshot on page 1 shows an invalid-credentials state. Pages 2–3 show email verification with a five-minute validity notice. Page 9 shows an order summary with an order ID and anticipated determination date, but does not establish that the order was approved. The clinical answers below reproduce the illustrated branch solely as a test fixture; they are not recommendations for a real patient.

## Preconditions and test data

- A Carelon test environment with a permitted test account, access to its verification mailbox, and a seeded member eligible for the illustrated imaging workflow.
- A seeded ordering physician and servicing facility with known identifiers, addresses, and contact details. Similar display names should exist for the identity-matching test.
- A future service date supported by the seeded member's test coverage. The PDF's displayed date is historical fixture data, not a date to reuse automatically.
- An isolated browser profile for this account. Start with a signed-out browser for authentication cases.
- Use `test-data.example.json` as the input shape. Replace its synthetic values with matching seeded test records; invented member IDs will not resolve in a real portal.
- For submission cases, use a test environment that permits creating and cleaning up test orders. Creating this specification does not execute or submit an order.

| Input | Main-flow fixture |
| --- | --- |
| Login | Test account credentials supplied at runtime; verification code from that account's mailbox |
| Member | Seeded first name, last name, full member ID including any prefix, date of birth |
| Service | Fixture service date; applicable imaging service category |
| Ordering physician | Exact seeded physician, confirmed using identifier/address; valid fax |
| Scan | `Maxillofacial Area (Sinus) - CT` **without contrast** (p. 5) |
| Diagnosis | `J32.0 — Chronic maxillary sinusitis` (pp. 5–7) |
| Clinical scenario | `Sinusitis` (pp. 6–7) |
| Main reason | `Preoperative planning` (review on p. 7) |
| Functional endoscopic sinus surgery planned | `No` (review on p. 7) |
| Treatment for this episode | `No treatment` (p. 7) |
| Concern for a complication of sinusitis | `No` (p. 7) |
| Additional information | Test contact first/last name, phone and fax; optional clinical text empty for the illustrated branch |
| Facility | Exact seeded servicing facility, confirmed using identifier/address |

## CARELON-001 — complete one imaging order request

**Priority:** P0. **Type:** End to end. **Initial state:** Signed out, no existing order for this run.
**Expected outcome:** One submitted order with the correct member, service date, physician, scan, diagnosis, clinical answers, and facility; a recorded order ID and actual portal status. Approval is not a pass condition.

| Step | Action | Expected result | Source |
| --- | --- | --- | --- |
| 1 | Open the configured portal. Enter the test username and password and activate the sign-in/verification action shown by the current page. | Authentication advances to the account's email-verification step. The invalid-credentials error is absent. | pp. 1–2 |
| 2 | Check the masked recipient and select **Send Email**. | Verification-code entry appears for the same account; the five-minute validity notice is shown. | pp. 2–3 |
| 3 | Obtain the current code from the test mailbox, enter it, and select **Verify Code** before it expires. | Login completes and the member/service workflow is reachable. The code is not included in test logs. | p. 3 |
| 4 | Enter the service date, member first/last name, full member ID and date of birth. Select **Find This Member**. | The returned member matches all identifying fixture fields. A different or ambiguous member is not selected. | p. 3 |
| 5 | Verify the member's displayed plan and date of service. Choose the applicable imaging category and start the request using the current page's navigation. | The intended service workflow opens; member, plan and date stay consistent. Exact category/start-control labels are partly cropped in the PDF. | pp. 3–4 |
| 6 | Find the seeded ordering physician in **Recent**, **Search Results**, or **Expanded Search** as appropriate. Verify identity and select the physician. | The selected ordering physician matches the fixture. The **Ordering Provider Fax Number** dialog appears when required. | p. 4 |
| 7 | Enter or confirm the fixture fax number and select **Save**. | The dialog closes and the selected physician is retained. | p. 4 |
| 8 | Search for and add **Maxillofacial Area (Sinus) - CT without contrast**. | **EXAMS REQUESTED (1)** contains exactly this exam and contrast choice, with no unintended exam. | p. 5 |
| 9 | Continue to diagnosis. Search for `J32.0` and select **Chronic maxillary sinusitis** from the results. | The selected diagnostic code and description appear together. Typing a query alone is not treated as selection. | pp. 5–6 |
| 10 | Select **Sinusitis** as the clinical scenario. | The corresponding clinical questionnaire opens. | p. 6 |
| 11 | Choose **Preoperative planning** as the main reason. Answer the functional endoscopic sinus surgery question **No**, select **No treatment**, and answer the complication question **No**. Apply answers where the portal requires it. | The completed questionnaire represents exactly the supplied fixture; no unanswered question is silently guessed. | pp. 6–7; full answer set visible in p. 7 review |
| 12 | In **ADDITIONAL INFORMATION**, enter the required test contact names, phone and fax. Leave optional clinical text empty. Select **Continue**. | Required contact fields validate and the dialog closes. The illustrated branch supports proceeding with no additional clinical text. | p. 7 |
| 13 | Review the diagnosis, scenario and all clinical answers. Compare every field with the fixture; use the available **Edit** actions if needed. | Review shows `J32.0`, Sinusitis, preoperative planning, surgery planned No, No treatment, complication No, and no additional information. Record any portal notice without interpreting it as approval. | p. 7 |
| 14 | Continue to **Facility Selection**. Find and select the intended servicing facility, checking identity and address. Use **In Network** or **Expanded Search** if necessary. | The selected facility matches the fixture. Displayed prices or first-row position do not override the requested facility. | pp. 8–9 |
| 15 | Inspect the final request preview. Compare member, service date, plan, ordering physician, facility, exam/contrast, diagnosis and clinical information with the fixture. | All expected values match. No duplicate exam or incorrect provider/facility is present. | p. 9; some preview fields are cropped |
| 16 | In the permitted test environment, activate the final submission control **once**, after the preview is verified. Wait for the result. | The portal reaches an order summary. The exact submission button label is not visible in the supplied PDF and must be identified from the live page. | p. 9 |
| 17 | Capture the generated order ID, displayed request status, and anticipated determination date if present. Check order history when available. | Exactly one matching order exists. The actual status is recorded verbatim; an order ID alone does not prove approval. If the status is unavailable, mark status verification blocked. | p. 9; history reconciliation is an added QA check |
| 18 | End the test session and follow the test environment's cleanup process for the created order. | Test browser/session is closed; any retained order is identified in the run record. Do not withdraw or alter a production order as cleanup. | Added QA check |

**Failure rule:** Stop at the first identity mismatch, unrecognized clinical question, missing required fixture input, or uncertain submission outcome. Preserve the current checkpoint and report the issue. If submission times out, reconcile order history before attempting another submission.

## Additional cases

The table distinguishes **Observed** behavior illustrated by the PDF from **Proposed** acceptance checks that require confirmation against the actual portal. All cases start as **Not run**. P0 blocks the main flow or risks incorrect/duplicate orders; P1 covers important validation and recovery behavior.

| ID | Priority | Case / setup | Steps | Expected result | Basis |
| --- | --- | --- | --- | --- | --- |
| CARELON-002 | P1 | Invalid credentials; signed-out test browser | Enter an invalid test password and activate the login action. | Stay signed out; show a credentials-mismatch error; no member data is exposed. | Observed, p. 1 |
| CARELON-003 | P0 | Email verification succeeds | Request a code; enter the current code before its displayed five-minute expiry; select Verify Code. | Reach the authenticated workflow for the expected account. | Observed, pp. 2–3 |
| CARELON-004 | P1 | Invalid verification code | Request a code; enter an incorrect code once. | Remain unauthenticated with an actionable validation message. Exact wording/rate-limit behavior must be confirmed. | Proposed, based on pp. 2–3 |
| CARELON-005 | P1 | Expired code and resend | Wait beyond the displayed five-minute validity; try the old code; select Resend Email; use the new code. | Expired code is rejected; resend permits login with a valid new code. Do not assume an unexpired earlier code is invalidated unless verified. | Expiry/resend observed, pp. 2–3; rejection check proposed |
| CARELON-006 | P0 | Missing or malformed member search data | Omit each required field in turn, then test an invalid date format. Select Find This Member. | Invalid input does not resolve or advance to an unrelated member; corrections are clear. | Proposed, based on p. 3 |
| CARELON-007 | P0 | No match or ambiguous member | Search with a deliberately nonmatching fixture; then use a seeded ambiguous-name fixture. | No-match is handled without choosing another member; ambiguous results require exact identity verification. | Proposed, based on p. 3 |
| CARELON-008 | P0 | Service date/plan mismatch | Use a seeded date outside the member's test eligibility or a deliberately wrong plan fixture. | The test stops on a mismatch or records the portal's eligibility response; no order is submitted under a different date/plan. Portal-specific eligibility rules need confirmation. | Proposed, based on pp. 3–4 |
| CARELON-009 | P0 | Similar physician names | Search for physicians with similar names and different identifiers or addresses; select the intended record. | Review and request preview retain the exact intended ordering physician. | Search modes observed, p. 4; ambiguity check proposed |
| CARELON-010 | P1 | Physician fax validation and unavailable path | Enter malformed/empty fax data and try Save. Separately exercise Fax Unavailable with a suitable test fixture. | Invalid fax does not silently become a valid contact. The explicit unavailable path is handled as the portal defines; its downstream requirements are recorded. | Save/Fax Unavailable observed, p. 4; validation proposed |
| CARELON-011 | P0 | Wrong scan or contrast variant | Add a contrasting exam variant, inspect the request, withdraw/correct it, then select the required CT without contrast. | Final exam list contains only the intended exam/contrast. | Exam list and withdraw controls observed, pp. 5–6; correction check proposed |
| CARELON-012 | P1 | Diagnosis query versus selected diagnosis | Enter a nonexistent diagnosis; then enter J32.0 without selecting a result; finally select its matching result. | A failed/unselected search is not accepted as a diagnosis; selected code and description appear together. | Search tips/selection observed, pp. 5–6 |
| CARELON-013 | P0 | Clinical branch changes | Complete the illustrated branch; edit the main reason to another offered option. | Newly required questions are detected; obsolete answers are not silently carried into the final review. Expected answers for the alternate branch must come from its own fixture. | Options/Edit observed, pp. 6–7; branch behavior proposed |
| CARELON-014 | P0 | Incomplete or contradictory clinical answers | Leave a required question unanswered. Separately try No treatment together with a treatment option. | The runner cannot submit an incomplete/contradictory fixture. Record whether the portal blocks, deselects, or flags the combination; do not assume a specific implementation. | Required fields/checklist observed, pp. 6–7; consistency check proposed |
| CARELON-015 | P1 | Additional-information validation | Omit each starred contact field; then fill them. Exercise optional clinical text at 0, 600, and 601 characters. | Required contacts validate; empty optional text is allowed for this branch; the displayed 600-character limit is enforced without silent data corruption. | Fields, optional note and limit observed, p. 7 |
| CARELON-016 | P0 | Review corrections persist | From review, edit the diagnosis or a clinical answer using its Edit action; return to review and final preview. | Both views show the latest approved fixture values, not stale values. | Edit controls observed, p. 7; persistence check proposed |
| CARELON-017 | P0 | Facility identity and search | Select a same-name/wrong-address facility, return to the list, search for the intended fixture, and correct the selection. | Final servicing facility matches the intended identifier/address. Ordering physician and servicing facility remain distinct. | Facility list, return/search modes observed, pp. 8–9; correction check proposed |
| CARELON-018 | P0 | Duplicate submission attempt | In a controlled test environment, double-activate submission or retry after a delayed response. | At most one matching order is created. An automation runner issues no second submit until order history resolves the first attempt. Portal idempotency is a proposed acceptance check. | Proposed, based on p. 9 |
| CARELON-019 | P0 | Submission timeout / unknown outcome | Interrupt the response after submitting; reconnect and inspect order history using the same member/date/exam/facility tuple. | Resume from the existing order if found. Otherwise report an unresolved outcome and do not blindly submit again. | Proposed recovery check |
| CARELON-020 | P1 | Session expires during entry | Expire the test session after selecting the exam; attempt to continue; authenticate again. | No unauthorized continuation. Detect whether a draft survived; verify recovered values before proceeding. Do not claim draft recovery is supported until tested. | Proposed recovery check |
| CARELON-021 | P0 | Oya stream disconnect during entry | Run through Oya; interrupt the live viewer while keeping the browser alive; reopen the viewer and compare the page with the last checkpoint. | The runner reconnects to the same browser, verifies current state, and avoids replaying completed clicks or creating another request. | Proposed Oya integration check |
| CARELON-022 | P1 | New-tab live view and focus | From the Oya browser panel, open Stream; enter a test field, use a dropdown, and scroll while the dashboard refreshes. | The tab shows frames rather than event text; input reaches the selected Carelon field in order; focus does not jump to the dashboard. | Proposed Oya regression check |
| CARELON-023 | P0 | Order summary is not an approval claim | Use a test fixture that yields pending/review-needed status; inspect the summary and automation result. | Record order ID and actual status independently. Never report approved merely because submission succeeded or an anticipated determination date exists. | Summary/date observed, p. 9; non-approval check proposed |
| CARELON-024 | P1 | Withdraw a test exam/request | In an unsubmitted test request, use Withdraw Exam or Withdraw Request as appropriate, responding to any confirmation shown. | Only the intended test item is withdrawn; the runner verifies the resulting list/state and does not claim a submission occurred. | Controls observed, pp. 5–7; final behavior proposed |

## Automation contract

This is a test specification, not a runnable Carelon integration. The PDF supplies screenshots, not DOM selectors or API contracts. A later implementation should:

1. Load the approved test fixture and credentials separately; never use the patient/account details embedded in the PDF as default test input.
2. Use observable page checkpoints, accessible control names, and exact fixture identities. Re-read the page after navigation/dialog changes rather than reuse stale element IDs or screenshot coordinates.
3. Pause for the account's current email code. Do not substitute TOTP for the illustrated email verification or automatically bypass it.
4. Answer only questions represented in the fixture. Report unfamiliar questions or missing data as blocked.
5. Separate the **preview checkpoint** from **submission**. A preview-only run passes only the preview stage; it does not pass CARELON-001's submitted-order outcome.
6. Retain browser ID/profile identity across viewer reconnects. Record REST commands in browser Activity; a persistent CDP connection is a separate Oya session.
7. Assert state after each action and reconcile uncertain submissions before any retry.

## Run record

For each case record: case ID, fixture/run ID, environment, browser/version, Oya browser ID (if used), start/end time, Pass/Fail/Blocked/Not run, last completed step, actual result, sanitized evidence reference, and defect reference. For a submission also record the generated order ID, exact displayed status, determination date if present, duplicate count, and cleanup result.

**Pass:** Every applicable expected result verified. **Fail:** An observed result contradicts a confirmed expectation. **Blocked:** Required data, access, expected behavior, or observable status is unavailable. Never convert a blocked assertion into a pass.
