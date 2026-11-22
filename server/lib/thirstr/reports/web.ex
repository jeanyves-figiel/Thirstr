defmodule Thirstr.Reports.Web do
  @moduledoc """
  F-15 R-15.25 web notices (DSA Art. 16) for people without the app: `thirstr.fun/report`.
  The notifier's name and email are sealed with AES-256-GCM under a key derived from the
  server pepper, used only to send the receipt and the outcome, and deleted with the report
  (retention 1 y, data-model.md). Child sexual abuse notices may be anonymous (Art. 16(2)(c)).
  """
  import Swoosh.Email
  alias Thirstr.{Mailer, Nearby, Repo, Reports}

  @link ~r"(?:thirstr\.fun)?/?p/([A-Za-z0-9_-]{10})(?:[/?#].*)?$"

  @doc "Creates a web notice. Returns {:ok, ref} or {:error, {:validation, fields}}."
  def create(params) do
    type = params["legal_type"]
    explanation = String.trim(to_string(params["explanation"] || ""))
    name = String.slice(String.trim(to_string(params["name"] || "")), 0, 120)
    email = String.slice(String.trim(to_string(params["email"] || "")), 0, 200)
    anon_ok = type == "csam"

    errors =
      %{}
      |> err(type not in Reports.legal_types(), :legal_type, "pick what kind of illegal content")
      |> err(
        String.length(explanation) < 20,
        :explanation,
        "say what is illegal about it (20 characters or more)"
      )
      |> err(not anon_ok and name == "", :name, "add your name")
      |> err(
        (not anon_ok or email != "") and not valid_email?(email),
        :email,
        "add a valid email"
      )
      |> err(
        params["good_faith"] not in ["on", "true", true],
        :good_faith,
        "confirm the report is accurate and complete"
      )

    with true <- errors == %{} || {:error, {:validation, errors}},
         {:ok, t} <- target(params["link"]) do
      ref = Reports.new_ref()
      contact = if email != "", do: seal(%{"name" => name, "email" => email})
      sev = if type == "csam", do: 1, else: Reports.severity(reason_for(type))

      Repo.query!(
        """
        INSERT INTO reports (id, reporter_account, target_account, target_profile, reason, context, severity,
                             created_at, ref, illegal, legal_type, country, explanation, good_faith, channel,
                             notifier_contact_enc)
        VALUES (gen_random_uuid(), NULL, $1, $2, $3, 'profile', $4, now(), $5, true, $6, $7, $8, true, 'web', $9)
        """,
        [
          Nearby.dump(t.account_id),
          Nearby.dump(t.profile_id),
          reason_for(type),
          sev,
          ref,
          type,
          country(params["country"]),
          String.slice(explanation, 0, 1000),
          contact
        ]
      )

      if contact, do: dispatch(fn -> receipt_email(email, ref) end)
      {:ok, ref}
    end
  end

  defp reason_for("csam"), do: "underage"
  defp reason_for("intimate_images"), do: "non_consensual"
  defp reason_for("fraud"), do: "scam"
  defp reason_for("hate_speech"), do: "hate"
  defp reason_for("threats"), do: "harassment"
  defp reason_for("impersonation"), do: "impersonation"
  defp reason_for(_), do: "other"

  defp country(c) when is_binary(c) do
    c = String.upcase(String.trim(c))
    if Regex.match?(~r/^[A-Z]{2}$/, c), do: c
  end

  defp country(_), do: nil

  defp target(link) when is_binary(link) do
    with [_, slug] <- Regex.run(@link, String.trim(link)),
         %{rows: [[pid, aid]]} <-
           Repo.query!(
             """
             SELECT p.id::text, a.id::text FROM profile_shares s JOIN profiles p ON p.id = s.profile_id
             JOIN accounts a ON a.id = p.account_id WHERE s.slug = $1 AND a.status <> 'deleted'
             """,
             [slug]
           ) do
      {:ok, %{profile_id: pid, account_id: aid}}
    else
      _ -> {:error, {:validation, %{link: ["paste a Thirstr profile link (thirstr.fun/p/…)"]}}}
    end
  end

  defp target(_),
    do: {:error, {:validation, %{link: ["paste a Thirstr profile link (thirstr.fun/p/…)"]}}}

  defp err(m, true, k, msg), do: Map.put(m, k, [msg])
  defp err(m, _, _, _), do: m

  defp valid_email?(e), do: Regex.match?(~r/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/, e)

  # ------------------------------------------------------------------ sealing

  defp key,
    do:
      :crypto.mac(
        :hmac,
        :sha256,
        Application.fetch_env!(:thirstr, :pepper),
        "notifier-contact-v1"
      )

  def seal(map) do
    iv = :crypto.strong_rand_bytes(12)

    {ct, tag} =
      :crypto.crypto_one_time_aead(:aes_256_gcm, key(), iv, Jason.encode!(map), "nc1", true)

    iv <> tag <> ct
  end

  def open(<<iv::binary-12, tag::binary-16, ct::binary>>) do
    case :crypto.crypto_one_time_aead(:aes_256_gcm, key(), iv, ct, "nc1", tag, false) do
      :error -> nil
      plain -> Jason.decode!(plain)
    end
  end

  def open(_), do: nil

  # ------------------------------------------------------------------ emails (Art. 16(4)/(5))

  defp dispatch(fun) do
    if Application.get_env(:thirstr, :email_link_async, true),
      do: Task.Supervisor.start_child(Thirstr.TaskSup, fun),
      else: fun.()
  end

  defp receipt_email(email, ref) do
    mail(email, "We received your report #{ref}", """
    Thanks for telling us. Your report #{ref} reached Thirstr and is in our review queue.
    Reports about children, intimate images and threats are handled first.

    We'll email you what we decide. You don't need to do anything else.
    """)
  end

  @doc "Outcome email for a web notice; called by Reports.decide/3."
  def outcome_email(contact, ref, decision) do
    case open(contact) do
      %{"email" => email} ->
        dispatch(fn ->
          mail(email, "Update on your report #{ref}", outcome_text(ref, decision))
        end)

      _ ->
        :ok
    end
  end

  defp outcome_text(ref, "no_action") do
    """
    We reviewed your report #{ref}. We didn't find that the content breaks the law or our rules, so we left it up.

    If you think we got it wrong, reply to this email within 6 months and a person who didn't take this decision will look again. You can also turn to an independent dispute body (https://digital-strategy.ec.europa.eu/en/policies/dsa-out-of-court-dispute-settlement) or a court.
    """
  end

  defp outcome_text(ref, _decision) do
    """
    We reviewed your report #{ref} and took action on the content. For the privacy of everyone involved we don't share the details.

    Thanks for helping keep Thirstr safe.
    """
  end

  defp mail(email, subj, body) do
    new()
    |> to(email)
    |> from({"Thirstr", Application.get_env(:thirstr, :mail_from, "hello@thirstr.fun")})
    |> subject(subj)
    |> text_body(body)
    |> Mailer.deliver()
  end
end
