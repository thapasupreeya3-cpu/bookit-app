# Find your addresses and check booking email

Use your existing The Care Web website. A second website is not required.

1. Install this update, redeploy and refresh the browser. Open **Admin → Settings → Email setup**. This page is new in v88.4.5.
2. Read **Participants receive emails from** and **Default reply address**. These show the configured website sender. To read participants' replies, open that address in your email provider's mailbox. The website's outgoing delivery history is not an inbox and setting a sender address does not create a mailbox.
3. Check your own receiving address beside **Send me a test email**. Click it once, wait about 15 seconds, then click **Check test status**. It sends to the signed-in account, including when helping a participant.
4. If the test is **Queued**, it is waiting for the delivery worker. **Accepted by email service** means the provider accepted the message. Check your inbox and junk folder to establish that it arrived. If it is **Retrying** or **Failed**, read the recorded error.
5. Open **Admin → Today → Email delivery**. Search recent messages and priority failures by recipient, person, subject or booking number. Review recipient spelling, attempts and timestamps. Recorded delivery or bounce evidence takes precedence over transport acceptance. Older sent emails may lack a subject because previous releases erased it with the body.
6. Find participant addresses in **Admin → People → People directory**. This lists the latest 100 accounts. For older accounts, use **People → Verification**, filter participants and search by name or email.
7. Ask the participant or worker to open **Settings → Emails & notifications**, check the displayed receiving address and switch on **Booking requests, confirmations and cancellations** if they want those emails. Booking updates bypass digest/quiet-hour delays, but respect that preference.

## If sending is not configured

Email and Stripe are separate connections. Activating Stripe does not configure email.

Your server supports either of these configurations:

- **Mailbox SMTP:** `SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`, and the provider's implicit-TLS `SMTP_PORT` (commonly 465). This transport does not implement STARTTLS on port 587. `MAIL_FROM` must be the authenticated mailbox or an address it is authorised to send as.
- **Resend:** `RESEND_API_KEY` and a `MAIL_FROM` address authorised for a verified sending domain. When both transports are configured, Resend takes priority.
- **Website links:** set `APP_URL=https://thecareweb.com.au` for this website.

On your existing Lightsail installation, these values belong in the protected `/etc/bookit.env` server configuration. Edit it in the Lightsail SSH session, then restart the website with `sudo systemctl restart bookit`. Confirm it is running with `sudo systemctl is-active bookit`, then use the website's test button. Do not put passwords or API keys in a public repository or send them in a screenshot.

Provider authentication errors require correcting credentials/sender authorisation. Timeouts require checking the host, implicit-TLS port and outbound connection. Provider acceptance with no inbox arrival requires checking junk, the exact recipient and the provider's delivery/bounce records. Neither the source release nor a configured status proves live credentials or DNS records are correct.

## What booking emails are sent

| Event | Recipients |
|---|---|
| Booking requested | Worker request; participant acknowledgement; active helpers with booking access |
| Worker accepts or declines | Participant and active helpers with booking access |
| Booking cancelled or changed | Participant, active helpers and affected worker(s) |
| Repeating visits ended | Participant, active helpers and workers for affected future visits |

Helpers select the named participant before opening Bookings. Routine booking updates are not automatically copied to an administrator. The office monitors bookings and outgoing email history, while existing office exceptions retain their established alerts.

Relevant booking messages retry after temporary failures. Superseded or expired messages and messages for revoked access are cancelled. Existing preferences are preserved; this update does not turn notifications on without the account holder's choice. It does not retroactively recreate every missing historical email. An SMTP connection lost after provider acceptance can cause a repeated email on retry; transport acknowledgement alone cannot guarantee exactly-once arrival.
