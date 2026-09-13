# The Care Web — location privacy and operation

Version 88.4.1 adds a private participant address and an agreed starting location for each visit. Worker profiles show the worker’s stated suburb and declared service areas. The feature does not collect live worker GPS coordinates or expose worker residential addresses.

## Everyday use

- **Settings → Address & arrival details:** save unit, street, suburb, state, postcode and relevant parking/access instructions. An authorised helper selects their participant and needs booking access.
- **Booking → Where will support start?:** choose the saved address, another address, a community meeting point or **Confirm later**.
- **Bookings → Support location:** read the location recorded for that visit. Calendar users choose **Open booking** first. Eligible upcoming visits offer **Change support location**, with an explicit confirmation before saving.
- **Worker profile → Based in / Areas I cover:** use declared areas to assess whether the worker covers the requested locality. Workers maintain these under **Settings → Availability & service areas**.

A missing or incomplete address is a prompt to arrange the meeting location. It is not an invoice, payment, browsing or booking gate.

## Who sees the exact location?

| Viewer | Saved participant address | Individual visit location |
|---|---|---|
| Participant | Own address | Own visits |
| Active authorised helper with booking access | Selected participant only | Selected participant’s visits |
| Helper without booking access, or revoked helper | No access | No access through these routes |
| Office administrator | Selected participant | Visit administration |
| Currently assigned worker, visit requested | No profile-address access | Locality only: suburb, state and postcode |
| Currently assigned worker, visit accepted or completed | No profile-address access | Recorded visit address and arrival instructions |
| Unrelated worker, replacement candidate or open-shift viewer | No access | No exact address |
| Blocked worker, former worker after reassignment, or a cancelled/declined/voided visit | No access | No exact address through the booking-location route |
| Public visitor | No access | No access |

An accepted worker receives the location recorded for their particular visit, rather than access to the participant’s current address book. Information already viewed, copied or shared outside the website cannot be recalled by changing access.

## A profile save does not move a visit

Private address data lives in `participant_addresses`; visit copies live in `booking_locations`. These tables are separate from the broad account and booking responses. A new booking receives its own copy when it is created. Choosing a different location on the booking form changes that new visit’s copy.

Saving the participant’s default address later leaves existing bookings alone. Updating an existing visit is a separate action. The server checks the caller’s booking authority, whether the visit is still eligible for a change and the revision the person reviewed. If the location or visit changed while the form was open, the caller must reload before saving. Completed visits are not editable through this feature.

On upgrade, historical bookings with no saved exact address are labelled unconfirmed and retain only their available locality. The upgrade does not invent a historical street address from the participant’s current profile.

Closing a participant account removes these new saved-address and exact visit-location records through the existing account-closure workflow. Existing service, invoice and incident record retention remains governed by that workflow; this feature is not a general erasure tool.

## Arrival instructions, directions and messages

Keep parking/access instructions relevant to arriving for the visit. They are private location information and follow the same visit permissions as the address.

An authorised viewer can choose **Directions on Google Maps ↗** to open Google Maps with the recorded destination. That action sends the destination to Google. Displaying the location does not itself ask a maps provider to track either person, and there is no live worker map or automatic arrival-time claim.

An explicit change to an upcoming visit queues a generic worker notification linking back to the booking. Exact street, unit and arrival instructions are not inserted into that notification. The worker signs in to see whatever location their current role and assignment permit. Queued and sent email statuses retain their existing meaning; they do not prove the worker has read the change. On an accepted visit, the assigned worker can choose **Confirm location seen**. The acknowledgement belongs to the recorded location revision; a later change requires a new acknowledgement. It is an informational follow-up, not a new visit, attendance or payment gate.

## Travel estimates remain estimates

Existing out-of-area checks use the visit locality and the worker’s declared area. They retain the warning and confirmation workflow. A profile’s stated suburb is not the worker’s current location. Distance and drive-time figures are planning estimates, not arrival promises or live tracking.

The full user guide preserves the supplied Google Routes instructions, including typical-traffic wording, checked-time labels, six-hour traffic-aware caching and fallback estimates. This release does not verify the deployment’s current Google keys, outbound addresses, quotas or billing account.

## Technical entry points

| API | Purpose |
|---|---|
| `GET /api/me/service-address` | Read the authorised participant’s saved address and revision |
| `PUT /api/me/service-address` | Save validated address fields with the revision check |
| `GET /api/bookings/:id/location` | Read the role-appropriate visit location |
| `PUT /api/bookings/:id/location` | Explicitly change an eligible upcoming visit’s location |
| `POST /api/bookings/:id/location/ack` | Assigned accepted worker acknowledges the current location revision |

The implementation is in `lib/service-locations.js` and the connected booking/account interface. Address state, postcode, text type and length checks validate input; they do not verify that a real property or meeting point exists. No new location-provider account or API key is needed to save an address or choose a meeting point.

Use the release verification report for the completed test results. Automated permission and workflow checks are separate from a visual check of the deployed site and an actual worker receiving and reading a notification.
