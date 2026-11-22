# Runbook: App Store / Play review build (I-01 R-I01.26, #17)

Adult creator platforms (OnlyFans, JustFor.Fans) must not show on the build Apple or Google reviews. Server hides them per build number; no app change, no new build.

## Before submitting build N
```elixir
# hide OnlyFans/JFF links, chips and link cards for build N only (iOS)
Thirstr.Flags.set("adult_links", true, %{"off_builds" => %{"ios" => [N]}}, "store review build N")
```
- Android: add `"android" => [N]`.
- Effect (`Linked.for_client`, app `adultAllowed`): profile "Elsewhere" hides OF/JFF, linked-accounts picker hides them, shared OF/JFF links arrive as plain text (no card, no picture).
- Check: `curl -s https://api.thirstr.fun/v1/config -H 'x-thirstr-build: N' -H 'x-thirstr-platform: ios' | jq .flags.adult_links` → `false`.

## Review notes (App Store Connect → App Review Information)
- Demo account: reviewer account from the password manager (never in Git). Safe Mode off, no adult links on its profile.
- Note: "Members can link their public social profiles (X, Bluesky, Instagram) and share public posts into chats. Previews are generated on device; explicit previews are blurred by default. Users can report any link."

## After approval
Keep N in `off_builds` while N is live (reviewers re-check updates). Remove a build once it is no longer installable:
```elixir
Thirstr.Flags.set("adult_links", true, %{"off_builds" => %{"ios" => [N2]}}, "review: only N2")
```
Kill everywhere (store complaint): `Thirstr.Flags.set("adult_links", false, %{}, "kill: <reason>")`.

Every change: one line in the CHANGELOG or incident log.
