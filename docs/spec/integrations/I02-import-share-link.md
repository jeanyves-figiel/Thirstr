# I-02 Profile share link & GDPR-export import

## Share link / QR
- R-I02.1 The profile can generate a share link `https://<domain>/p/{random_slug}` + QR. Slug rotatable/revocable. The page shows the Friends lens (safe photos, no hookup fields).
- R-I02.2 Web page shows: main photo (blurred unless viewer opens in app), display name, "Chat me safely on Thirstr", store badges. No distance, no other fields.
- R-I02.3 Opening link in app → profile S-20 (if allowed by visibility).
- R-I02.4 Intended for bios on other apps. No tracking params, no analytics on the page.

## Import from other apps (v1.1, spec now)
- R-I02.5 User requests their data export from Grindr / Romeo / Scruff / Hornet (GDPR Art. 20) and picks the ZIP/JSON in our app.
- R-I02.6 Parser runs **on device**; extracts own profile text fields + own photos only (never other users' data or chats).
- R-I02.7 Mapping table per source app → our fields; user reviews every field before saving; photos go through F-15 classifier.
- R-I02.8 File deleted from app storage after import.
- R-I02.9 No live connection, no credentials of other apps ever requested (concept §15).

## Acceptance criteria
- AC-I02.1 Share page has no third-party scripts/cookies.
- AC-I02.2 Import never uploads the source archive.
