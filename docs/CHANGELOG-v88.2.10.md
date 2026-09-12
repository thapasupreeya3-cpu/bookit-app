# The Care Web v88.2.10 — clear credential review status

Built on v88.2.9. This update addresses the misleading yellow “Essential files received” banner in Settings > Credentials & checks.

## Changes

- The summary now reflects actual evidence: green with a check icon for verified essential requirements, blue with a clock for files awaiting office review, and amber with an attention icon when essential files are missing. The completed/received summary no longer has a yellow warning stripe.
- Status wording and icons accompany every colour. File badges distinguish verified, awaiting office review, missing/expired, expiring soon, and earlier records.
- “View document status” moves focus and scrolls directly to the essential checklist, without leaving Settings or altering records.
- Individual verified files show their recorded verification date. Expiry dates and review notes remain visible.
- A compact “How verification works” explanation tells workers who checks the files and how to read the result. Uploads are not automatically presented as verified.
- Right-to-work requirements covered by an identity document identify that document and provide a supporting-file shortcut. Real Training completions explain why no separate upload is needed for that completion.
- Existing document types, file replacement/removal actions, office requests and verification rules are retained. No backend, schema, runtime dependency, media or font changes. Next actions retains v88.2.9's grouping and priority order.

## How to check documents

Workers: Settings > Credentials & checks > View document status. Read the badge, recorded date and any office note beside the relevant file. Open View to inspect the original file.

Office: Admin > Verification > Worker documents, then select the person and document. The existing office review process records verification or a request for a correction; a worker's upload alone does not approve it. A green essential-document summary does not confer whole-account activation or replace other screening/recruitment requirements.

## Validation and preview

The existing automated release gate covers syntax, API/workflow behavior, Settings, navigation, document upload/replacement/removal and other regression checks. Four focused credential scenarios cover received-versus-verified state, mixed evidence and old records, direct checklist navigation and supporting evidence explanations. See `docs/TEST-RESULTS.md` for the executed results and limits.

`docs/credential-status-preview.html` contains three fictional examples using the shipped component. Preview upload/account actions are disabled. The examples and scripts were checked in a VM. They have not been inspected in a real browser: local browser access was blocked earlier in this session. Live rendering, browser colour overrides, focus and screen-reader behavior still need checking after deployment. No live deployment or real messages were sent.

## Install

Use **The-Care-Web-v88.2.10-credential-status-fix-only.zip** over v88.2.9. Extract the ZIP and upload the extracted contents into the existing repository root, replacing matching files and merging folders. Commit and redeploy; `/api/version` should report **88.2.10**. No files need deleting and no schema change is needed from v88.2.9.

If earlier updates were skipped, use **The-Care-Web-v88.2.10-all-updates-only.zip** instead and follow its included instructions. Apply one update package only. Preserve runtime files, uploads and configuration; compare with newer repository edits not supplied here.
