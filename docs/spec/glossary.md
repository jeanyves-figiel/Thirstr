# Glossary

| Term | Meaning |
|---|---|
| Account | One human. Holds 1 verification credential, 1–3 profiles, devices, settings. |
| Profile | The one public profile of an account, shown through lenses (see Mode). |
| Mode | Lens: Hookup · Friends · Sport. As viewer: whom you browse and what you see of them (Friends/Sport: safe photos, no hookup/health). As owner: `show_in` picks where you appear. Recolours UI. |
| Verified | Account passed liveness + photo match (F-03); holds anonymous credential. |
| Location level | Hidden · City · Area · Exact (F-05). |
| Cell | H3 hexagon. Res 9 ≈ 200 m (Area default), res 8 ≈ 500 m, res 7 ≈ 1.2 km, res 5 ≈ city. |
| k-anonymity | Cell shown at its resolution only if ≥ k (=5) visible users; else parent cell. |
| Exact pin | Opt-in precise point, TTL-bound, RAM-only server-side. |
| Now | Profile flag "available right now" + optional status (hosting, can travel, door open), TTL 1–6 h. |
| Tonight plan | Post for later today (time window + text + tag), expires end of night (06:00 local). |
| Party | Hosted gathering with capacity, rules, requests, guest chat. |
| Activity post | Sport/friends meetup post with time, place, RSVP. |
| Venue | Known place (sauna, bar, club, gym) supporting check-in. |
| Tap | Lightweight "interested" signal. |
| Vouch | Verified user attests to having met another in real life. |
| Safe Mode | Protection bundle for hostile countries (F-14). |
| Trusted contact | Person alerted by meet check-in (F-13). |
| Franking | Cryptographic proof allowing a recipient to report an E2EE message verifiably. |
| Creator | Profile type for accounts promoting paid content. |
| Quarantine | Shadow state: account's outbound signals delivered to nobody. |
