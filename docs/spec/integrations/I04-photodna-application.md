# PhotoDNA Cloud Service application: prepared answers

Issue #179. **Jean-Yves submits this himself** (operator; Claude does not sign up). Apply: microsoft.com/photodna › Cloud Service › Apply (onboarding portal `myphotodna.microsoftmoderator.com`). Vetting is done by a third party, case by case; free with a monthly transaction cap. The form's exact fields are only visible after starting; the answers below cover what such applications ask (organisation, service, use, volumes, reporting, contacts). Fields marked ✎ need his data.

| Question | Answer |
|---|---|
| Organisation legal name | ✎ (Swiss operating entity of Thirstr) |
| Country / address | ✎ Switzerland, ‹registered address› |
| Website | https://thirstr.fun |
| Contact name, role | ✎ ‹your name›, founder and operator (trust & safety lead) |
| Contact email | ✎ a role address on the domain, e.g. `safety@thirstr.fun` (create in SES/forwarding first) |
| Type of organisation | Online service provider hosting user-generated content (mobile social/dating app) |
| Describe your service | Thirstr is a social and dating app for adult men (18+), on iOS and Android, launching in Europe first, then worldwide. Members post a profile with up to 5 public photos and short-lived photo "Moments". Accounts require age and selfie verification. Private chats are end-to-end encrypted. |
| Where is user content uploaded | Public profile photos and Moments, uploaded from the app to our servers (EU region) before anyone else can see them. |
| How will you use PhotoDNA | Every public image is checked against PhotoDNA **before publication**. A match blocks the image, quarantines the account, preserves evidence, and a trained person confirms before we report. We do not scan end-to-end encrypted chats. |
| Expected volume | Closed beta: < 2 000 images/month. Open beta (~10k members): ~60 000 images/month (≈ 6 per member at sign-up + changes). 100k members: ~400 000/month. |
| Current moderation | Self-hosted nudity classifier on all public images, human review queue with blur-by-default tools, user reporting with message franking, age and selfie verification, shadow quarantine for bots, audit log of every moderator action. |
| Reporting process | Confirmed matches are reported to NCMEC (CyberTipline, as an ESP) and to Swiss federal police (fedpol), plus the national hotline of the user's country where known. Evidence preserved 1 year in an encrypted, access-logged store. |
| Who reviews matches | The founder (sole moderator in beta), later a vetted EU moderation vendor; reviewers see images blurred and grayscale by default. |
| Data protection | Hosted in the EU (Fly.io, Tigris). No raw IPs stored. GDPR/Swiss FADP compliant; DPIA in progress. |
| Technical contact | ✎ same as above |
| Agree to terms (internal use, CSAM purpose only, NCMEC reporting acknowledgement) | Yes |

## After approval
1. Put the key in Fly secrets (`PHOTODNA_KEY`, `PHOTODNA_URL`) on staging, then prod (owner OK).
2. Claude finishes the adapter from the developer portal spec, tests in the integration environment, switches staging to `photodna`, runs the backfill (R-15.46).
3. Register as ESP with NCMEC CyberTipline (separate application, owner).
4. Calendar: subscription term is 30 days; renewal reminder.
