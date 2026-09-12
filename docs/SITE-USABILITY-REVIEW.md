# Website usability review — v88.2.8

Current update reviewed v88.2.7 and corrects the issues in CHANGELOG-v88.2.8.md. The earlier broad page review is retained below. No deployed site, GitHub repository or live account was accessed.

## Navigation after the update

| Audience | Primary header choices | Account menu actions |
| --- | --- | --- |
| Visitor | Support services, Pricing, Find workers, About | Sign in / Get started |
| Worker | Bookings, Open shifts, Next actions | Profile, Credentials, Earnings, Settings, Refer a friend, Incident, Help, Log out |
| Participant | Find workers, Bookings, Support plan, Next actions | Profile, Support plan, Settings, Refer a friend, Incident, Help, Log out |
| Coordinator | Bookings, My clients, Next actions | Profile, My clients, Settings, Refer a friend, Help, Log out |
| Admin | Dashboard, Verification, Next actions | Profile, Verification, Settings, Help, Log out |

Messages and Accessibility remain header controls. Mobile navigation retains the same choices; the visitor's Get started link is in the main menu on small phones. The footer retains access to public information pages.

## Current document and navigation changes

The full 25-type document dropdown, missing-essential checklist and individual file actions now live at Settings → Credentials. Worker upload controls were removed from Bookings. Old personal Next actions setup links open canonical Settings pages. Contact notes, worker emergency contacts, digest/quiet hours, calendar subscriptions and optional document assistance remain accessible. Referrals have a direct avatar-menu shortcut. See the current changelog and test results for details.

## Earlier broad review coverage (v88.2.7)

- 54 explicit route entries (including Home's empty-route alias) and dynamic worker, job, Settings, admin and form routes were exercised through the shipped router with a DOM test harness.
- All mapped page containers and titles exist. No duplicate static HTML IDs or unlabelled static form controls were found by the source audit. Dynamically generated control accessibility still needs browser and assistive-technology checks.
- Literal internal navigation links in the main page, frontend modules and backend modules resolve to known route families. Links containing runtime substitutions need their owning functional tests; this is not a crawler of every live URL.
- The actual Settings renderers are tested with an isolated live API for worker sections, Profile, participant/coordinator/admin settings, errors and stale requests.
- Existing workflow tests execute participant, worker and office panels with scoped API responses. They cover booking, availability, leave, notes, payroll, invoices, access and other process behavior. Verification tests cover the existing review and PDF/HTML evidence functionality.
- Ten new scenarios execute role visibility, menu contents, every route's dispatch, credential destinations, PDF/image link selection, mobile keyboard handling, booking failure recovery, manual uploads without optional assistance, partial-success retries and navigation/account changes during file preparation.
- Static route existence does not prove every page interaction works in every browser. Payment-provider, email/SMS delivery, production permissions and browser-only layout/media behavior were not exercised against external services.

## Page inventory

Every entry below passed container, title and router-dispatch checks. Dynamic data rendering is covered by the relevant functional suites where applicable, not by this structural check alone.

| Route | Page |
| --- | --- |
| `/journey` | Your next actions — The Care Web |
| `/login` | Sign in — The Care Web |
| `/not-found` | Page not found — The Care Web |
| `(empty / Home)` | The Care Web — Find NDIS support workers who fit your life |
| `/` | The Care Web — Find NDIS support workers who fit your life |
| `/services` | Support services — The Care Web |
| `/services/employment` | Employment support (0102) — The Care Web |
| `/services/personal-care` | Personal care (0107) — The Care Web |
| `/services/transport` | Travel & transport (0108) — The Care Web |
| `/services/daily-tasks` | Daily tasks & shared living (0115/0138) — The Care Web |
| `/services/household` | Household tasks (0120) — The Care Web |
| `/services/community` | Community participation (0125) — The Care Web |
| `/services/overnight` | Overnight support: sleepovers and active nights — The Care Web |
| `/refer-a-worker` | Refer a support worker — The Care Web |
| `/form` | Fill in a form — The Care Web |
| `/shifts` | Open shifts — The Care Web |
| `/how-it-works` | How it works — The Care Web |
| `/pricing` | Pricing — The Care Web |
| `/find-workers` | Find support workers — The Care Web |
| `/support-workers` | Become a support worker — The Care Web |
| `/safety` | Safety & quality — The Care Web |
| `/verification` | How we check every worker — The Care Web |
| `/specialist-supports` | Specialist supports — The Care Web |
| `/about` | About us — The Care Web |
| `/faq` | FAQ & help — The Care Web |
| `/contact` | Contact us — The Care Web |
| `/legal` | Privacy & terms — The Care Web |
| `/get-started` | Get started — The Care Web |
| `/messages` | Messages — The Care Web |
| `/bookings` | My bookings — The Care Web |
| `/support-plan` | Your support plan — The Care Web |
| `/clients` | My clients — The Care Web |
| `/calculator` | What will a shift cost? — The Care Web |
| `/jobs` | Open jobs — The Care Web |
| `/post-job` | Post a job — The Care Web |
| `/my-jobs` | My job posts — The Care Web |
| `/my-applications` | My applications — The Care Web |
| `/statements` | Invoices & statements — The Care Web |
| `/security` | Security & sign-in — The Care Web |
| `/earnings` | My earnings — The Care Web |
| `/ladder` | The Care Web ladder — The Care Web |
| `/training` | Training — The Care Web |
| `/for-plan-managers` | For plan managers — The Care Web |
| `/for-families` | For families & carers — The Care Web |
| `/locations` | Where The Care Web works — The Care Web |
| `/account` | Settings — The Care Web |
| `/access` | People with access — The Care Web |
| `/invite` | You've been invited — The Care Web |
| `/easy-read` | Easy Read — The Care Web |
| `/reset` | Choose a new password — The Care Web |
| `/verified` | Email confirmed — The Care Web |
| `/verify-failed` | Link expired — The Care Web |
| `/pay-success` | Payment submitted — The Care Web |
| `/admin` | Admin — The Care Web |

## Remaining acceptance checks on the deployed site

1. At phone, tablet and desktop widths, open the header and account menu. Check that the logo, message icon, accessibility button and avatar do not overlap. Repeat with larger text and keyboard navigation.
2. As a worker, open Settings → Credentials. Use the full type dropdown or an essential row to add a permitted file. Replace a specific file, review its saved entry, open its PDF/image, and confirm removal of an unverified upload. Existing files and decisions must remain visible.
3. As a participant and coordinator, confirm the relevant navigation and the currently selected participant. Check bookings, plan, documents, invoices and helper access with normal authorized test accounts.
4. As an admin, open Verification, worker/participant evidence, PDF and HTML previews. Confirm the earlier compact document controls and verification actions still behave as expected.
5. Check configured messaging and payment integrations in their authorized test environments. The automated local checks do not send real messages or payments.

These are explicit validation limits, not a statement that further issues were observed. This release does not claim every possible site behavior is now perfect.
