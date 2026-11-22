defmodule Thirstr.Reports do
  @moduledoc """
  F-15 reports (R-15.9) with message franking (R-07.11), community auto-quarantine (R-15.7),
  beta auto-hide on severe reports (R-15.13), enforcement notices and appeals (R-15.14, R-AD.9).

  A report holds only what the reporter chose to attach. Attached chat messages are kept only when
  their franking commitment matches a tag the server stored at delivery from the reported profile to
  the reporter, so nobody can fabricate messages in a report.
  """
  alias Thirstr.{Moderation, Nearby, Repo}
  alias Thirstr.Accounts.Account

  @reasons ~w(spam_bot scam underage harassment non_consensual hate impersonation other)
  # A-01 order: minor safety, violence/non-consensual, scam, harassment/hate, spam, other
  @severity %{
    "underage" => 1,
    "non_consensual" => 2,
    "scam" => 3,
    "harassment" => 4,
    "hate" => 4,
    "impersonation" => 5,
    "spam_bot" => 5,
    "other" => 6
  }
  @contexts ~w(profile chat photo party tonight moment)
  @max_messages 20
  # R-15.24 DSA Art. 16 types; csam notifiers may stay anonymous (Art. 16(2)(c)).
  @legal_types ~w(csam intimate_images threats hate_speech fraud impersonation ip other)
  @legal_severity %{
    "csam" => 1,
    "intimate_images" => 2,
    "threats" => 2,
    "fraud" => 3,
    "hate_speech" => 4,
    "impersonation" => 5,
    "ip" => 6,
    "other" => 6
  }
  @decisions ~w(removed restricted suspended banned warned no_action)

  def legal_types, do: @legal_types

  def reasons, do: @reasons
  def severity(reason), do: Map.fetch!(@severity, reason)

  @doc "POST /reports {profile_id, reason, context, note?, messages?: [{plain, fk}]} (S-50)."
  def create(%Account{} = a, params) do
    reason = params["reason"]
    context = params["context"] || "profile"
    note = params["note"] && String.slice(String.trim(to_string(params["note"])), 0, 500)

    with :ok <- check(reason in @reasons, :reason, "pick a reason"),
         :ok <- check(context in @contexts, :context, "unknown context"),
         {:ok, legal} <- legal(params, reason),
         {:ok, t} <- target(params["profile_id"]),
         :ok <- check(t.account_id != a.id, :profile_id, "you can't report yourself"),
         {:ok, franked} <- franked(a, t.id, params["messages"] || []) do
      sev = min(severity(reason), legal[:severity] || 6)
      # R-15.34: repeat misuse → lowest priority (child safety still first).
      sev = if sev > 1 and deprioritised?(a.id), do: 6, else: sev

      %{rows: [[ref]]} =
        Repo.query!(
          """
          INSERT INTO reports (id, reporter_account, target_account, target_profile, reason, context, note,
                               franked, severity, created_at, ref, illegal, legal_type, country,
                               explanation, good_faith, channel)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10, $11, $12, $13, $14, 'app')
          ON CONFLICT (reporter_account, target_account, reason) WHERE state = 'open' DO UPDATE
            SET note = coalesce(EXCLUDED.note, reports.note),
                franked = coalesce(EXCLUDED.franked, reports.franked),
                illegal = reports.illegal OR EXCLUDED.illegal,
                legal_type = coalesce(EXCLUDED.legal_type, reports.legal_type),
                country = coalesce(EXCLUDED.country, reports.country),
                explanation = coalesce(EXCLUDED.explanation, reports.explanation),
                good_faith = reports.good_faith OR EXCLUDED.good_faith,
                severity = least(reports.severity, EXCLUDED.severity)
          RETURNING ref
          """,
          [
            Nearby.dump(a.id),
            Nearby.dump(t.account_id),
            Nearby.dump(t.id),
            reason,
            context,
            blank(note),
            if(franked == [], do: nil, else: %{"messages" => franked}),
            sev,
            new_ref(),
            legal[:illegal] || false,
            legal[:type],
            legal[:country],
            legal[:explanation],
            legal[:good_faith] || false
          ]
        )

      escalate(t.account_id, reason)
      linked_report(t.id, reason, note)
      {:ok, %{attached: length(franked), ref: ref}}
    end
  end

  # R-15.24: "It's illegal" (reason other + illegal) or any reason + "This may also be illegal".
  defp legal(%{"illegal" => true} = p, _reason) do
    explanation = String.trim(to_string(p["explanation"] || ""))
    type = p["legal_type"]
    country = p["country"] |> to_string() |> String.upcase()

    cond do
      type not in @legal_types ->
        {:error, {:validation, %{legal_type: ["pick what kind of illegal content"]}}}

      not Regex.match?(~r/^[A-Z]{2}$/, country) ->
        {:error, {:validation, %{country: ["pick a country"]}}}

      String.length(explanation) < 20 ->
        {:error,
         {:validation, %{explanation: ["say what is illegal about it (20 characters or more)"]}}}

      p["good_faith"] != true ->
        {:error, {:validation, %{good_faith: ["confirm the report is accurate and complete"]}}}

      true ->
        {:ok,
         %{
           illegal: true,
           type: type,
           country: country,
           explanation: String.slice(explanation, 0, 1000),
           good_faith: true,
           severity: Map.fetch!(@legal_severity, type)
         }}
    end
  end

  defp legal(_, _), do: {:ok, %{}}

  # Reference shown to the notifier (R-15.26): R-XXXX-XXXX, Crockford base32, no 0/O/1/I.
  @alphabet ~c"23456789ABCDEFGHJKMNPQRSTVWXYZ"
  def new_ref do
    chars =
      for <<b <- :crypto.strong_rand_bytes(8)>>, do: Enum.at(@alphabet, rem(b, length(@alphabet)))

    {a, b} = Enum.split(chars, 4)
    "R-" <> List.to_string(a) <> "-" <> List.to_string(b)
  end

  # Any non-deleted profile can be reported, including ones already hidden from the reporter.
  defp target(id) when is_binary(id) do
    with {:ok, _} <- Ecto.UUID.cast(id),
         %{rows: [[pid, aid]]} <-
           Repo.query!(
             "SELECT p.id::text, a.id::text FROM profiles p JOIN accounts a ON a.id = p.account_id WHERE p.id = $1 AND a.status <> 'deleted'",
             [Nearby.dump(id)]
           ) do
      {:ok, %{id: pid, account_id: aid}}
    else
      _ -> {:error, :not_found}
    end
  end

  defp target(_), do: {:error, :not_found}

  # R-07.11: tag = HMAC-SHA256(fk, plaintext); must match a tag stored for (reported → one of mine).
  defp franked(_a, _target, list) when not is_list(list) or length(list) > @max_messages,
    do: {:error, {:validation, %{messages: ["up to #{@max_messages} messages"]}}}

  defp franked(a, target, list) do
    mine =
      Repo.query!("SELECT id FROM profiles WHERE account_id = $1", [Nearby.dump(a.id)]).rows
      |> List.flatten()

    out =
      Enum.flat_map(list, fn m ->
        with %{"plain" => p, "fk" => k} <- m,
             {:ok, plain} <- Base.decode64(p),
             {:ok, fk} <- Base.decode64(k),
             tag = :crypto.mac(:hmac, :sha256, fk, plain),
             true <- tagged?(tag, target, mine),
             {:ok, w} <- Jason.decode(plain) do
          [summary(w)]
        else
          _ -> []
        end
      end)

    {:ok, out}
  end

  defp tagged?(tag, target, mine) do
    Repo.query!(
      "SELECT 1 FROM franking_tags WHERE tag = $1 AND from_profile_id = $2 AND to_profile_id = ANY($3)",
      [tag, Nearby.dump(target), mine]
    ).num_rows > 0
  end

  # Only what a moderator needs: kind, text, time. Media keys and ids are dropped.
  defp summary(w) do
    %{
      "t" => w["t"],
      "text" => is_binary(w["text"]) && String.slice(w["text"], 0, 2000),
      "at" => w["at"]
    }
    |> Map.merge(link_summary(w))
  end

  # I-01 R-I01.24: "Not his account" on a linked chip is an impersonation report noted `linked:<platform>`.
  defp linked_report(profile, "impersonation", "linked:" <> platform),
    do: Thirstr.Linked.impersonation_reported(profile, platform)

  defp linked_report(_, _, _), do: :ok

  # I-01 R-I01.24: a reported link card keeps its URL and title (never the thumbnail).
  defp link_summary(%{"t" => "link.preview"} = w) do
    %{
      "url" => is_binary(w["url"]) && String.slice(w["url"], 0, 2000),
      "title" => is_binary(w["title"]) && String.slice(w["title"], 0, 300)
    }
  end

  defp link_summary(_), do: %{}

  # R-15.7 community quarantine and R-15.13 beta auto-hide (decisions.md).
  defp escalate(target_account, reason) do
    {bot, severe} =
      case Repo.query!(
             """
             SELECT count(DISTINCT r.reporter_account) FILTER (WHERE r.reason IN ('spam_bot', 'scam')
                                                              AND a.verified_at IS NOT NULL
                                                              AND r.created_at > now() - interval '24 hours'),
                    count(DISTINCT r.reporter_account) FILTER (WHERE r.severity <= 3)
             FROM reports r JOIN accounts a ON a.id = r.reporter_account
             WHERE r.target_account = $1 AND r.state = 'open'
             """,
             [Nearby.dump(target_account)]
           ).rows do
        [[b, s]] -> {b, s}
        _ -> {0, 0}
      end

    if bot >= 3 or severe >= 2 do
      case Repo.get(Account, target_account) do
        %Account{} = t -> Moderation.auto_quarantine(t, "reports:" <> reason)
        _ -> :ok
      end
    end

    :ok
  end

  # ------------------------------------------------------------------ notices & appeals (R-AD.9)

  @visible ~w(warn remove_photo hide_field suspend ban)

  @doc "GET /me/notices: enforcement notices with rule and appeal state. Quarantine is never shown."
  def notices(%Account{} = a) do
    rows =
      Repo.query!(
        """
        SELECT id::text, action, reason, created_at, ends_at, appeal_state, seen,
               ground, law_ref, facts, detected_by, decided_by, appeal_until, appeal_text,
               appeal_reason, appeal_decided_at, reviewed_by_other
        FROM moderation_actions WHERE target_account = $1 AND action = ANY($2)
        ORDER BY created_at DESC LIMIT 50
        """,
        [Nearby.dump(a.id), @visible]
      ).rows
      |> Nearby.utc()

    %{
      notices:
        Enum.map(rows, fn [
                            id,
                            act,
                            reason,
                            at,
                            ends,
                            appeal,
                            seen,
                            ground,
                            law,
                            facts,
                            det,
                            dec,
                            until,
                            atext,
                            areason,
                            adecided,
                            other
                          ] ->
          %{
            id: id,
            action: act,
            reason: reason,
            at: at,
            ends_at: ends,
            appeal: appeal,
            seen: seen,
            # Statement of reasons (DSA Art. 17, R-15.28)
            ground: ground,
            law_ref: law,
            facts: facts,
            detected_by: det,
            decided_by: dec,
            appeal_until: until,
            appeal_text: atext,
            appeal_reason: areason,
            appeal_decided_at: adecided,
            reviewed_by_other: other
          }
        end)
    }
  end

  def seen(%Account{} = a) do
    Repo.query!("UPDATE moderation_actions SET seen = true WHERE target_account = $1", [
      Nearby.dump(a.id)
    ])

    :ok
  end

  @doc "POST /me/notices/:id/appeal {text}: one appeal per action (R-15.14)."
  def appeal(%Account{} = a, id, params) do
    text = String.slice(String.trim(to_string(params["text"] || "")), 0, 1000)

    with {:ok, _} <- Ecto.UUID.cast(id),
         :ok <- check(text != "", :text, "tell us what happened") do
      case Repo.query!(
             """
             UPDATE moderation_actions SET appeal_state = 'open', appeal_text = $3
             WHERE id = $1 AND target_account = $2 AND appeal_state IS NULL AND action = ANY($4)
               AND (appeal_until IS NULL OR appeal_until > now())
             """,
             [Nearby.dump(id), Nearby.dump(a.id), text, @visible]
           ).num_rows do
        1 -> :ok
        _ -> {:error, {:conflict, "You already asked for a review, or the 6 months have passed"}}
      end
    else
      :error -> {:error, :not_found}
      e -> e
    end
  end

  # ------------------------------------------------------------------ outcomes for notifiers (DSA Art. 16(5), R-15.27)

  @doc "GET /me/reports: the reporter's own reports with outcome. Never names the reported person."
  def mine(%Account{} = a) do
    rows =
      Repo.query!(
        """
        SELECT id::text, ref, reason, context, illegal, legal_type, created_at, state, decision,
               decided_at, automated, notifier_review_state, notifier_review_reason, notifier_seen
        FROM reports WHERE reporter_account = $1
        ORDER BY created_at DESC LIMIT 50
        """,
        [Nearby.dump(a.id)]
      ).rows
      |> Nearby.utc()

    window = Thirstr.Moderation.appeal_window_s()

    %{
      reports:
        Enum.map(rows, fn [
                            id,
                            ref,
                            reason,
                            ctx,
                            illegal,
                            lt,
                            at,
                            state,
                            dec,
                            decided,
                            auto,
                            rstate,
                            rreason,
                            seen
                          ] ->
          %{
            id: id,
            ref: ref,
            reason: reason,
            context: ctx,
            illegal: illegal,
            legal_type: lt,
            at: at,
            state: if(state == "open", do: "open", else: "decided"),
            decision:
              dec || (state == "dismissed" && "no_action") || (state == "actioned" && "removed") ||
                nil,
            decided_at: decided,
            automated: auto,
            review: rstate,
            review_reason: rreason,
            review_until:
              if(decided && (dec == "no_action" or state == "dismissed"),
                do: DateTime.add(decided, window, :second)
              ),
            seen: seen
          }
        end)
    }
  end

  def mine_seen(%Account{} = a) do
    Repo.query!("UPDATE reports SET notifier_seen = true WHERE reporter_account = $1", [
      Nearby.dump(a.id)
    ])

    :ok
  end

  @doc "POST /me/reports/:id/review {text}: notifier asks for a review of a no-action decision (R-15.32)."
  def review(%Account{} = a, id, params) do
    text = String.slice(String.trim(to_string(params["text"] || "")), 0, 1000)

    with {:ok, _} <- Ecto.UUID.cast(id),
         :ok <- check(text != "", :text, "tell us what we missed") do
      case Repo.query!(
             """
             UPDATE reports SET notifier_review_state = 'open', notifier_review_text = $3, notifier_review_at = now()
             WHERE id = $1 AND reporter_account = $2 AND notifier_review_state IS NULL
               AND (decision = 'no_action' OR (decision IS NULL AND state = 'dismissed'))
               AND coalesce(decided_at, resolved_at) > now() - make_interval(secs => $4)
             """,
             [Nearby.dump(id), Nearby.dump(a.id), text, Thirstr.Moderation.appeal_window_s()]
           ).num_rows do
        1 -> :ok
        _ -> {:error, {:conflict, "A review isn't possible for this report"}}
      end
    else
      :error -> {:error, :not_found}
      e -> e
    end
  end

  @doc """
  Moderator decision on a report (console A-02 calls this for dismiss and every enforcement):
  sets decision + decided_at, tells the reporter (content-free push or email for web notices)
  and runs the misuse check (R-15.34). `decision` in removed | restricted | suspended | banned |
  warned | no_action.
  """
  def decide(report_id, decision, opts \\ []) when decision in @decisions do
    case Repo.query!(
           """
           UPDATE reports SET decision = $2, decided_at = now(), automated = $3, unfounded = $4,
                              notifier_seen = (reporter_account IS NULL)
           WHERE id = $1 RETURNING reporter_account::text, channel, notifier_contact_enc, ref
           """,
           [
             Nearby.dump(report_id),
             decision,
             opts[:automated] == true,
             decision == "no_action" and opts[:unfounded] == true
           ]
         ).rows do
      [[reporter, channel, contact, ref]] ->
        if reporter, do: Thirstr.Notify.event(reporter, "report.update", %{})

        if channel == "web" and contact,
          do: Thirstr.Reports.Web.outcome_email(contact, ref, decision)

        if reporter && decision == "no_action",
          do: misuse_check(reporter)

        :ok

      _ ->
        {:error, :not_found}
    end
  end

  @doc "Notifier review decision (R-15.32/R-15.33); `overturned` reopens the report for action."
  def decide_review(report_id, decision, actor, reason) when decision in ~w(upheld overturned) do
    reason = reason && String.slice(String.trim(to_string(reason)), 0, 300)

    case Repo.query!(
           """
           UPDATE reports SET notifier_review_state = $2::text, notifier_review_reason = $3, notifier_seen = false,
                              state = CASE WHEN $2::text = 'overturned' THEN 'open' ELSE state END,
                              unfounded = CASE WHEN $2::text = 'overturned' THEN false ELSE unfounded END
           WHERE id = $1 AND notifier_review_state = 'open' RETURNING reporter_account::text
           """,
           [Nearby.dump(report_id), decision, reason]
         ).rows do
      [[reporter]] ->
        _ = actor
        if reporter, do: Thirstr.Notify.event(reporter, "report.update", %{})
        :ok

      _ ->
        {:error, :not_found}
    end
  end

  # R-15.34: ≥ 5 reports in 30 d, ≥ 80 % no action, ≥ 3 judged manifestly unfounded → warning
  # (reason report_misuse). Repeat within 90 d of a warning → reports deprioritised for 30 d.
  defp misuse_check(reporter) do
    [[total, none, unfounded]] =
      Repo.query!(
        """
        SELECT count(*), count(*) FILTER (WHERE decision = 'no_action' OR state = 'dismissed'),
               count(*) FILTER (WHERE unfounded)
        FROM reports WHERE reporter_account = $1 AND created_at > now() - interval '30 days'
        """,
        [Nearby.dump(reporter)]
      ).rows

    warned_recently =
      Repo.query!(
        "SELECT 1 FROM moderation_actions WHERE target_account = $1 AND reason = 'report_misuse' AND created_at > now() - interval '30 days'",
        [Nearby.dump(reporter)]
      ).num_rows > 0

    if total >= 5 and none * 5 >= total * 4 and unfounded >= 3 and not warned_recently do
      Thirstr.Moderation.log_action(reporter, "warn", "report_misuse", "system", %{
        facts: "#{unfounded} of your last #{total} reports were clearly unfounded."
      })

      Thirstr.Notify.event(reporter, "moderation.notice", %{})
    end

    :ok
  end

  @doc "R-15.34: reporters warned for misuse twice in 90 d get their reports at the lowest priority for 30 d."
  def deprioritised?(reporter) do
    Repo.query!(
      """
      SELECT count(*) >= 2 AND max(created_at) > now() - interval '30 days'
      FROM moderation_actions WHERE target_account = $1 AND reason = 'report_misuse'
        AND created_at > now() - interval '90 days'
      """,
      [Nearby.dump(reporter)]
    ).rows == [[true]]
  end

  defp check(true, _f, _m), do: :ok
  defp check(_, f, m), do: {:error, {:validation, %{f => [m]}}}
  defp blank(""), do: nil
  defp blank(x), do: x
end
