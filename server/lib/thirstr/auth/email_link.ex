defmodule Thirstr.Auth.EmailLink do
  @moduledoc """
  Email magic link (F-01 R-01.3): 15 min, single use, always 202.
  The email address is used once to send the link and then forgotten; only its
  peppered hash is stored. Work happens off the request path so known and unknown
  addresses respond with identical timing (AC-01.3).
  """
  import Swoosh.Email
  alias Thirstr.{Accounts, Ids, Mailer, Valkey}

  def request(email, opts) when is_binary(email) do
    email = Ids.normalize_email(email)
    if valid_email?(email), do: dispatch(fn -> deliver(email, opts) end)
    :ok
  end

  def request(_, _), do: :ok

  defp dispatch(fun) do
    if Application.get_env(:thirstr, :email_link_async, true),
      do: Task.Supervisor.start_child(Thirstr.TaskSup, fun),
      else: fun.()
  end

  @doc """
  RF-7 (required-fields.md): add a sign-in email to an existing account (Apple, Google or
  passkey sign-ups). Same link flow; consuming it attaches the email to `account_id`.
  Always :ok, so it never tells whether the address is already used elsewhere.
  """
  def request_attach(email, account_id) when is_binary(email) do
    email = Ids.normalize_email(email)
    if valid_email?(email), do: dispatch(fn -> deliver(email, attach: account_id) end)
    :ok
  end

  def request_attach(_, _), do: :ok

  defp deliver(email, opts) do
    token = Ids.random_token()
    ttl = Accounts.auth_cfg(:magic_link_ttl_s)

    Valkey.put_term(
      "ml:" <> Base.encode16(Ids.hash("magic", token)),
      %{
        email_hash: Ids.hash("email", email),
        age_confirmed: opts[:age_confirmed] == true,
        attach: opts[:attach]
      },
      ttl
    )

    link = Application.fetch_env!(:thirstr, :app_url) <> "/auth/email?token=" <> token

    {subject, intro} =
      if opts[:attach],
        do:
          {"Confirm your Thirstr sign-in email",
           "Tap to add this email to your Thirstr account, so you can always sign back in:"},
        else: {"Your Thirstr sign-in link", "Tap to sign in to Thirstr:"}

    new()
    |> to(email)
    |> from({"Thirstr", Application.get_env(:thirstr, :mail_from, "hello@thirstr.fun")})
    |> subject(subject)
    |> text_body("""
    #{intro}

    #{link}

    The link works once and expires in 15 minutes. If you did not ask for it, ignore this email.
    """)
    |> Mailer.deliver()
  end

  @doc "Consumes the token. Returns {:ok, account, :created | :existing}."
  def verify(token) when is_binary(token) do
    case Valkey.take_term("ml:" <> Base.encode16(Ids.hash("magic", token))) do
      nil ->
        {:error, :unauthorized}

      %{email_hash: h, attach: id} when is_binary(id) ->
        Accounts.attach_email(id, h)

      %{email_hash: h, age_confirmed: age} ->
        Accounts.find_or_create_by(:email_hash, h, age_confirmed: age)
    end
  end

  def verify(_), do: {:error, :validation}

  # RFC 2606 reserved TLDs never get mail: smoke tests and probes use them, so nothing is sent
  # (no SES bounce, no reputation hit) while the endpoint still answers 202 like for any address.
  @reserved_tlds [".invalid", ".test", ".example", ".localhost"]

  defp valid_email?(e) do
    byte_size(e) <= 254 and Regex.match?(~r/^[^\s@]+@[^\s@]+\.[^\s@]+$/, e) and
      not String.ends_with?(e, @reserved_tlds)
  end
end
